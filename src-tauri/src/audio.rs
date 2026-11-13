use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{BufferSize, FromSample, SampleFormat, SizedSample, Stream, StreamConfig, SupportedBufferSize};
use crossbeam_queue::ArrayQueue;
use keyfall_dsp::{channels, ClipId, Engine, Instrument, Library, Pattern, Placement, Sample};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Sender, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread;

pub const DEFAULT_BUFFER: u32 = 128;
/// Channel of the local player's instrument; mirrors `LOCAL_CHANNEL` in `src/lib/audio/engine.svelte.ts`.
#[cfg_attr(mobile, allow(dead_code))]
pub const LOCAL_CHANNEL: usize = 0;
const FALLBACK_RATE: f32 = 48_000.;
const QUEUE: usize = 4096;
const MAX_FRAMES: usize = 4096;

pub enum Command {
    NoteOn { id: u32, channel: usize, midi: u8, velocity: f32 },
    NoteOff(u32),
    KeyOn { channel: usize, midi: u8, velocity: f32 },
    KeyOff { channel: usize, midi: u8 },
    Pedal { channel: usize, down: bool },
    ReleaseChannel(usize),
    ChannelGain(usize, f32),
    AllOff,
    Volume(f32),
    Instrument(usize, Instrument),
    Sample(Sample),
    ClearSamples,
    SeqPattern(ClipId, Arc<Pattern>),
    SeqTimeline(usize, Vec<Placement>),
    SeqLaunch(usize, Option<(ClipId, Arc<Pattern>)>, bool),
    SeqPlay(f64),
    SeqStop,
    SeqConfig(SequencerConfig),
}

#[derive(serde::Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct SequencerConfig {
    tempo: f64,
    quantum: f64,
    beats_per_bar: f64,
    metronome: bool,
    #[serde(rename = "loop")]
    loop_region: Option<(f64, f64)>,
}

/// Values replaced on the audio thread, freed by the next sender instead of inside the callback.
#[allow(dead_code)]
enum Garbage {
    Instrument(Instrument),
    Samples(Vec<Sample>),
    Pattern(Arc<Pattern>),
    Timeline(Vec<Placement>),
}

struct Shared {
    queue: ArrayQueue<Command>,
    trash: ArrayQueue<Garbage>,
    muted: AtomicBool,
    live: AtomicUsize,
    /// Input note to the notes it plays (transpose, scale lock, chords); empty plays notes as they are.
    note_map: Mutex<Vec<Vec<u8>>>,
    /// Sequencer status written by the audio callback when uncontended (`keyfall_dsp::STATUS_HEADER` layout).
    status: Mutex<Vec<f64>>,
}

/// Lock-free, allocation-free command path into the audio callback, usable from any thread.
#[derive(Clone)]
pub struct Commands(Arc<Shared>);

impl Commands {
    pub(crate) fn new() -> Self {
        Self(Arc::new(Shared {
            queue: ArrayQueue::new(QUEUE),
            trash: ArrayQueue::new(QUEUE),
            muted: AtomicBool::new(false),
            live: AtomicUsize::new(LOCAL_CHANNEL),
            note_map: Mutex::new(Vec::new()),
            status: Mutex::new(Vec::new()),
        }))
    }

    pub fn send(&self, command: Command) {
        while self.0.trash.pop().is_some() {}
        if self.0.queue.push(command).is_err() {
            eprintln!("audio: command queue full");
        }
    }

    /// Sends a note from a native fast path unless output is muted; returns whether it will sound.
    pub fn play(&self, command: Command) -> bool {
        let sounding = !self.0.muted.load(Ordering::Relaxed);
        if sounding {
            self.send(command);
        }
        sounding
    }

    /// Channel the player's own input plays on; set by the webview (local instrument or selected track).
    pub fn live_channel(&self) -> usize {
        self.0.live.load(Ordering::Relaxed)
    }

    pub fn set_live_channel(&self, channel: usize) {
        self.0.live.store(channel, Ordering::Relaxed);
    }

    /// The notes a played note sounds, mirroring `live.map` in `src/lib/studio/live.svelte.ts`.
    #[cfg_attr(mobile, allow(dead_code))]
    pub fn map_note(&self, midi: u8) -> Vec<u8> {
        match self.0.note_map.lock() {
            Ok(map) if !map.is_empty() => map.get(midi as usize).cloned().unwrap_or_default(),
            _ => vec![midi],
        }
    }

    pub fn set_note_map(&self, map: Vec<Vec<u8>>) {
        if let Ok(mut current) = self.0.note_map.lock() {
            *current = map.into_iter().map(|notes| notes.into_iter().map(|n| n.min(127)).collect()).collect();
        }
    }

    pub fn set_muted(&self, muted: bool) {
        self.0.muted.store(muted, Ordering::Relaxed);
    }
}

struct Core {
    engine: Engine,
    shared: Arc<Shared>,
}

impl Core {
    fn drain(&mut self) {
        while let Some(command) = self.shared.queue.pop() {
            if let Some(garbage) = self.apply(command) {
                let _ = self.shared.trash.push(garbage);
            }
        }
    }

    fn report(&mut self) {
        if let Ok(mut status) = self.shared.status.try_lock()
            && status.len() == self.engine.sequencer().status_len()
        {
            self.engine.sequencer().write_status(&mut status);
        }
    }

    fn apply(&mut self, command: Command) -> Option<Garbage> {
        let engine = &mut self.engine;
        match command {
            Command::NoteOn { id, channel, midi, velocity } => engine.note_on(id, channel, midi, velocity),
            Command::NoteOff(id) => engine.note_off(id),
            Command::KeyOn { channel, midi, velocity } => engine.key_on(channel, midi, velocity),
            Command::KeyOff { channel, midi } => engine.key_off(channel, midi),
            Command::Pedal { channel, down } => engine.pedal(channel, down),
            Command::ReleaseChannel(channel) => engine.release_channel(channel),
            Command::ChannelGain(channel, gain) => engine.set_channel_gain(channel, gain),
            Command::AllOff => engine.all_off(),
            Command::Volume(volume) => engine.set_volume(volume),
            Command::Instrument(channel, instrument) => return engine.set_instrument(channel, instrument).map(Garbage::Instrument),
            Command::Sample(sample) => return engine.add_sample(sample).map(|old| Garbage::Samples(vec![old])),
            Command::ClearSamples => return Some(Garbage::Samples(engine.clear_samples())),
            Command::SeqPattern(id, pattern) => {
                let trash = &self.shared.trash;
                engine.sequencer().update(id, &pattern, &mut |old| _ = trash.push(Garbage::Pattern(old)));
                return Some(Garbage::Pattern(pattern));
            }
            Command::SeqTimeline(lane, timeline) => return engine.sequencer().set_timeline(lane, timeline).map(Garbage::Timeline),
            Command::SeqLaunch(lane, clip, quantized) => engine.sequencer().launch(lane, clip, quantized),
            Command::SeqPlay(from) => engine.sequencer().play(from),
            Command::SeqStop => engine.transport_stop(),
            Command::SeqConfig(config) => {
                let sequencer = engine.sequencer();
                sequencer.tempo = config.tempo.clamp(20., 400.);
                sequencer.set_quantum(config.quantum);
                sequencer.set_meter(config.beats_per_bar);
                sequencer.set_metronome(config.metronome);
                sequencer.set_loop(config.loop_region);
            }
        }
        None
    }
}

#[derive(Clone, Default)]
struct Output {
    device: Option<String>,
    buffer: u32,
}

type DeviceRequest = (Output, SyncSender<Result<(), String>>);

#[derive(serde::Serialize, Clone, Copy)]
pub struct Latency {
    /// Worst case from note command to sound leaving the device, in milliseconds.
    output_ms: f32,
    buffer_frames: u32,
    sample_rate: u32,
}

#[derive(Default)]
struct Meter {
    device_us: AtomicU32,
    buffer_frames: AtomicU32,
    sample_rate: AtomicU32,
}

pub struct Audio {
    commands: Commands,
    library: Mutex<Library>,
    devices: Sender<DeviceRequest>,
    output: Mutex<Output>,
    meter: Arc<Meter>,
}

impl Audio {
    pub fn start() -> Self {
        let commands = Commands::new();
        let mut engine = Engine::new(FALLBACK_RATE);
        engine.configure_sequencer(channels::TRACKS, channels::FIRST_TRACK, channels::CLICK);
        *commands.0.status.lock().expect("fresh lock") = vec![0.; engine.sequencer().status_len()];
        let core = Arc::new(Mutex::new(Core { engine, shared: commands.0.clone() }));
        let (devices, requests) = mpsc::channel::<DeviceRequest>();
        let meter = Arc::new(Meter::default());
        let output = Output { device: None, buffer: DEFAULT_BUFFER };

        let thread_meter = meter.clone();
        let initial = output.clone();
        thread::Builder::new()
            .name("audio-output".into())
            .spawn(move || {
                let mut stream = open(&core, &thread_meter, &initial).inspect_err(|e| eprintln!("audio: {e}")).ok();
                for (output, reply) in requests {
                    drop(stream.take());
                    let result = open(&core, &thread_meter, &output);
                    let _ = reply.send(result.as_ref().map(|_| ()).map_err(Clone::clone));
                    stream = result.ok();
                }
            })
            .expect("spawn audio thread");

        Self { commands, library: Mutex::default(), devices, output: Mutex::new(output), meter }
    }

    pub fn set_buffer(&self, frames: u32) -> Result<(), String> {
        self.reopen(|output| output.buffer = frames)
    }

    pub fn latency(&self) -> Latency {
        let rate = self.meter.sample_rate.load(Ordering::Relaxed).max(1);
        let frames = self.meter.buffer_frames.load(Ordering::Relaxed);
        let device_ms = self.meter.device_us.load(Ordering::Relaxed) as f32 / 1000.;
        Latency { output_ms: device_ms + frames as f32 * 1000. / rate as f32, buffer_frames: frames, sample_rate: rate }
    }

    fn reopen(&self, change: impl FnOnce(&mut Output)) -> Result<(), String> {
        let output = {
            let mut current = self.output.lock().map_err(|e| e.to_string())?;
            change(&mut current);
            current.clone()
        };
        let (reply, response) = mpsc::sync_channel(1);
        self.devices.send((output, reply)).map_err(|e| e.to_string())?;
        response.recv().map_err(|e| e.to_string())?
    }

    pub fn sequencer_status(&self) -> Vec<f64> {
        self.commands.0.status.lock().map(|status| status.clone()).unwrap_or_default()
    }

    pub fn set_pattern(&self, id: ClipId, data: &[f32]) -> Result<(), String> {
        let pattern = Pattern::decode(data).ok_or("invalid pattern")?;
        let pattern = self.library.lock().map_err(|e| e.to_string())?.set_pattern(id, pattern);
        self.send(Command::SeqPattern(id, pattern));
        Ok(())
    }

    pub fn set_timeline(&self, lane: usize, data: &[f32]) -> Result<(), String> {
        let timeline = self.library.lock().map_err(|e| e.to_string())?.timeline(data);
        self.send(Command::SeqTimeline(lane, timeline));
        Ok(())
    }

    pub fn launch(&self, lane: usize, id: ClipId, quantized: bool) {
        let pattern = self.library.lock().ok().and_then(|library| library.pattern(id));
        self.send(Command::SeqLaunch(lane, pattern.map(|pattern| (id, pattern)), quantized));
    }

    pub fn set_pad(&self, channel: usize, midi: u8, sample: Option<Sample>) -> Result<(), String> {
        let instrument = self.library.lock().map_err(|e| e.to_string())?.set_pad(channel, midi, sample);
        self.send(Command::Instrument(channel, instrument));
        Ok(())
    }

    pub fn clear_kit(&self, channel: usize) -> Result<(), String> {
        let instrument = self.library.lock().map_err(|e| e.to_string())?.clear_kit(channel);
        self.send(Command::Instrument(channel, instrument));
        Ok(())
    }

    pub fn commands(&self) -> Commands {
        self.commands.clone()
    }

    pub fn send(&self, command: Command) {
        self.commands.send(command);
    }

    pub fn set_output(&self, device: Option<String>) -> Result<(), String> {
        self.reopen(|output| output.device = device)
    }
}

pub fn output_names() -> Vec<String> {
    let host = cpal::default_host();
    host.output_devices().map(|devices| devices.filter_map(|d| device_name(&d)).collect()).unwrap_or_default()
}

fn device_name(device: &cpal::Device) -> Option<String> {
    device.description().ok().map(|d| d.name().to_owned())
}

fn open(core: &Arc<Mutex<Core>>, meter: &Arc<Meter>, output: &Output) -> Result<Stream, String> {
    let host = cpal::default_host();
    let device = match output.device.as_deref() {
        Some(name) => host
            .output_devices()
            .map_err(|e| e.to_string())?
            .find(|d| device_name(d).is_some_and(|n| n == name))
            .ok_or_else(|| format!("output device not found: {name}"))?,
        None => host.default_output_device().ok_or("no default output device")?,
    };
    let supported = device.default_output_config().map_err(|e| e.to_string())?;
    let mut config: StreamConfig = supported.config();
    if let SupportedBufferSize::Range { min, max } = supported.buffer_size() {
        let frames = output.buffer.clamp(*min, *max);
        config.buffer_size = BufferSize::Fixed(frames);
        meter.buffer_frames.store(frames, Ordering::Relaxed);
    }
    meter.sample_rate.store(config.sample_rate, Ordering::Relaxed);

    {
        let mut core = core.lock().map_err(|e| e.to_string())?;
        core.engine.set_sample_rate(config.sample_rate as f32);
    }

    let stream = match supported.sample_format() {
        SampleFormat::F32 => build::<f32>(&device, &config, core.clone(), meter.clone()),
        SampleFormat::I16 => build::<i16>(&device, &config, core.clone(), meter.clone()),
        SampleFormat::U16 => build::<u16>(&device, &config, core.clone(), meter.clone()),
        SampleFormat::I32 => build::<i32>(&device, &config, core.clone(), meter.clone()),
        format => return Err(format!("unsupported sample format: {format}")),
    }?;
    stream.play().map_err(|e| e.to_string())?;
    Ok(stream)
}

fn build<T: SizedSample + FromSample<f32>>(device: &cpal::Device, config: &StreamConfig, core: Arc<Mutex<Core>>, meter: Arc<Meter>) -> Result<Stream, String> {
    let channels = config.channels as usize;
    let mut mono = Vec::<f32>::with_capacity(MAX_FRAMES);
    device
        .build_output_stream(
            *config,
            move |data: &mut [T], info: &cpal::OutputCallbackInfo| {
                let frames = data.len() / channels;
                let timestamp = info.timestamp();
                let device = timestamp.playback.duration_since(timestamp.callback);
                meter.device_us.store(device.as_micros() as u32, Ordering::Relaxed);
                meter.buffer_frames.store(frames as u32, Ordering::Relaxed);
                mono.resize(frames, 0.);
                match core.try_lock() {
                    Ok(mut core) => {
                        core.drain();
                        core.engine.render(&mut mono);
                        core.report();
                    }
                    Err(_) => mono.fill(0.),
                }
                for (frame, value) in data.chunks_mut(channels).zip(&mono) {
                    frame.fill(T::from_sample(*value));
                }
            },
            |e| eprintln!("audio stream: {e}"),
            None,
        )
        .map_err(|e| e.to_string())
}

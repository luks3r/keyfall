//! Audio input capture (microphone, line in). Prepared for audio tracks; one recording at a time.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample, StreamConfig};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Mutex;
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tauri::ipc::Channel;

const LEVEL_INTERVAL: Duration = Duration::from_millis(50);

pub struct Captured {
    pub sample_rate: u32,
    pub channels: u16,
    /// Interleaved samples.
    pub samples: Vec<f32>,
}

impl Captured {
    /// `[rate u32 LE][channels u16 LE][f32 LE samples…]`, mirrored by `src/lib/platform/native.ts`.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(6 + self.samples.len() * 4);
        bytes.extend(self.sample_rate.to_le_bytes());
        bytes.extend(self.channels.to_le_bytes());
        for sample in &self.samples {
            bytes.extend(sample.to_le_bytes());
        }
        bytes
    }
}

struct Input {
    stream: cpal::Stream,
    chunks: Receiver<Vec<f32>>,
    sample_rate: u32,
    channels: u16,
}

type Running = (Sender<()>, JoinHandle<Result<Captured, String>>);

#[derive(Default)]
pub struct Capture(Mutex<Option<Running>>);

pub fn input_names() -> Vec<String> {
    let host = cpal::default_host();
    host.input_devices().map(|devices| devices.filter_map(|d| d.description().ok().map(|d| d.name().to_owned())).collect()).unwrap_or_default()
}

impl Capture {
    /// Starts recording on its own thread (cpal streams are not `Send`); `level` gets the peak every 50 ms.
    pub fn start(&self, device: Option<String>, level: Channel<f32>) -> Result<(), String> {
        let mut slot = self.0.lock().map_err(|e| e.to_string())?;
        if slot.is_some() {
            return Err("already recording".into());
        }
        let (stop, stopped) = mpsc::channel();
        let (ready, started) = mpsc::sync_channel(1);
        let worker = thread::Builder::new()
            .name("audio-input".into())
            .spawn(move || record(device, stopped, level, ready))
            .map_err(|e| e.to_string())?;
        started.recv().map_err(|e| e.to_string())??;
        *slot = Some((stop, worker));
        Ok(())
    }

    pub fn stop(&self) -> Result<Captured, String> {
        let (stop, worker) = self.0.lock().map_err(|e| e.to_string())?.take().ok_or("not recording")?;
        let _ = stop.send(());
        worker.join().map_err(|_| "capture thread panicked".to_owned())?
    }
}

fn record(device: Option<String>, stopped: Receiver<()>, level: Channel<f32>, ready: mpsc::SyncSender<Result<(), String>>) -> Result<Captured, String> {
    let Input { stream, chunks, sample_rate, channels } = match open(device) {
        Ok(opened) => {
            let _ = ready.send(Ok(()));
            opened
        }
        Err(e) => {
            let _ = ready.send(Err(e.clone()));
            return Err(e);
        }
    };
    let mut samples = Vec::new();
    loop {
        let stop = stopped.recv_timeout(LEVEL_INTERVAL).is_ok();
        let mut peak = 0f32;
        for chunk in chunks.try_iter() {
            peak = chunk.iter().fold(peak, |m, s| m.max(s.abs()));
            samples.extend(chunk);
        }
        let _ = level.send(peak);
        if stop {
            break;
        }
    }
    drop(stream);
    samples.extend(chunks.try_iter().flatten());
    Ok(Captured { sample_rate, channels, samples })
}

fn open(device: Option<String>) -> Result<Input, String> {
    let host = cpal::default_host();
    let device = match device {
        Some(name) => host
            .input_devices()
            .map_err(|e| e.to_string())?
            .find(|d| d.description().is_ok_and(|desc| desc.name() == name))
            .ok_or_else(|| format!("input device not found: {name}"))?,
        None => host.default_input_device().ok_or("no default input device")?,
    };
    let supported = device.default_input_config().map_err(|e| e.to_string())?;
    let config: StreamConfig = supported.config();
    let (tx, rx) = mpsc::channel();
    let stream = match supported.sample_format() {
        SampleFormat::F32 => build::<f32>(&device, &config, tx),
        SampleFormat::I16 => build::<i16>(&device, &config, tx),
        SampleFormat::U16 => build::<u16>(&device, &config, tx),
        SampleFormat::I32 => build::<i32>(&device, &config, tx),
        format => return Err(format!("unsupported input format: {format}")),
    }?;
    stream.play().map_err(|e| e.to_string())?;
    Ok(Input { stream, chunks: rx, sample_rate: config.sample_rate, channels: config.channels })
}

/// Recording is not latency-critical, so the callback hands each block over as an owned buffer.
fn build<T: SizedSample>(device: &cpal::Device, config: &StreamConfig, tx: Sender<Vec<f32>>) -> Result<cpal::Stream, String>
where
    f32: FromSample<T>,
{
    device
        .build_input_stream(
            *config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                let _ = tx.send(data.iter().map(|&s| <f32 as FromSample<T>>::from_sample_(s)).collect());
            },
            |e| eprintln!("audio input: {e}"),
            None,
        )
        .map_err(|e| e.to_string())
}

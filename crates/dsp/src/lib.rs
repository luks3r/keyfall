mod library;
mod patch;
mod sequencer;
mod voice;

pub use library::{channels, Library};
pub use patch::{Instrument, Kit, PADS};
pub use sequencer::{ClipId, Cmd, Pattern, Placement, SeqNote, Sequencer, NO_CLIP, STATUS_HEADER, STATUS_PER_LANE, STOP_PENDING};

use std::sync::Arc;
use voice::Voice;

const MAX_VOICES: usize = 64;
pub const MAX_CHANNELS: usize = 64;
const MASTER_GAIN: f32 = 0.35;
/// The sequencer steps once per chunk, so its events land within this many frames (0.7 ms at 48 kHz).
const SEQUENCER_CHUNK: usize = 32;
const KEYS: usize = 128;
/// Voices started by `key_on` take ids from the upper half so they never collide with caller ids.
const KEY_IDS: u32 = 1 << 31;

#[derive(Clone, Debug)]
pub struct Sample {
    pub root: u8,
    pub rate: f32,
    pub data: Arc<[f32]>,
}

/// Keys held on one channel and the notes its sustain pedal keeps sounding. `holds` counts what holds each key:
/// two chords sharing a note both hold it, so letting go of one leaves it sounding for the other.
#[derive(Clone)]
struct Keys {
    voices: [u32; KEYS],
    holds: [u8; KEYS],
    sustained: u128,
    pedal: bool,
}

impl Default for Keys {
    fn default() -> Self {
        Self { voices: [0; KEYS], holds: [0; KEYS], sustained: 0, pedal: false }
    }
}

pub struct Engine {
    sample_rate: f32,
    volume: f32,
    instruments: Vec<Instrument>,
    gains: Vec<f32>,
    voices: Vec<Voice>,
    keys: Vec<Keys>,
    next_key: u32,
    sequencer: Sequencer,
    samples: Vec<Sample>,
    buffer: Vec<f32>,
}

impl Engine {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            sample_rate,
            volume: 0.8,
            instruments: vec![Instrument::default(); MAX_CHANNELS],
            gains: vec![1.; MAX_CHANNELS],
            voices: Vec::with_capacity(MAX_VOICES),
            keys: vec![Keys::default(); MAX_CHANNELS],
            next_key: KEY_IDS,
            sequencer: Sequencer::default(),
            samples: Vec::new(),
            buffer: Vec::new(),
        }
    }

    pub fn set_sample_rate(&mut self, sample_rate: f32) {
        self.sample_rate = sample_rate;
        self.voices.clear();
    }

    pub fn set_volume(&mut self, volume: f32) {
        self.volume = volume.clamp(0., 1.);
    }

    /// Mixer level of one channel, applied to its sounding voices immediately.
    pub fn set_channel_gain(&mut self, channel: usize, gain: f32) {
        if let Some(slot) = self.gains.get_mut(channel) {
            *slot = gain.clamp(0., 2.);
        }
    }

    /// Returns the replaced instrument so real-time callers can free it elsewhere.
    pub fn set_instrument(&mut self, channel: usize, instrument: Instrument) -> Option<Instrument> {
        self.instruments.get_mut(channel).map(|slot| std::mem::replace(slot, instrument))
    }

    /// Returns the sample it replaces, if any.
    pub fn add_sample(&mut self, sample: Sample) -> Option<Sample> {
        match self.samples.iter_mut().find(|s| s.root == sample.root) {
            Some(slot) => Some(std::mem::replace(slot, sample)),
            None => {
                self.samples.push(sample);
                None
            }
        }
    }

    pub fn clear_samples(&mut self) -> Vec<Sample> {
        std::mem::take(&mut self.samples)
    }

    /// Plays a key on a channel, restarting it if it is still sounding. Every `key_on` needs its own `key_off`.
    pub fn key_on(&mut self, channel: usize, midi: u8, velocity: f32) {
        let Some(keys) = self.keys.get_mut(channel) else { return };
        let key = midi as usize % KEYS;
        keys.holds[key] = keys.holds[key].saturating_add(1);
        let previous = std::mem::replace(&mut keys.voices[key], self.next_key);
        keys.sustained &= !(1 << key);
        let id = self.next_key;
        self.next_key = self.next_key.wrapping_add(1) | KEY_IDS;
        if previous != 0 {
            self.note_off(previous);
        }
        self.note_on(id, channel, midi, velocity);
    }

    /// Releases a key once nothing else holds it, or leaves it sounding while the channel's pedal is down.
    pub fn key_off(&mut self, channel: usize, midi: u8) {
        let Some(keys) = self.keys.get_mut(channel) else { return };
        let key = midi as usize % KEYS;
        if keys.holds[key] > 1 {
            keys.holds[key] -= 1;
            return;
        }
        keys.holds[key] = 0;
        if keys.voices[key] == 0 {
            return;
        }
        if keys.pedal {
            keys.sustained |= 1 << key;
            return;
        }
        let id = std::mem::take(&mut keys.voices[key]);
        self.note_off(id);
    }

    pub fn pedal(&mut self, channel: usize, down: bool) {
        let Some(keys) = self.keys.get_mut(channel) else { return };
        keys.pedal = down;
        if down {
            return;
        }
        let mut sustained = std::mem::take(&mut keys.sustained);
        while sustained != 0 {
            let key = sustained.trailing_zeros() as usize;
            sustained &= sustained - 1;
            let id = std::mem::take(&mut self.keys[channel].voices[key]);
            self.note_off(id);
        }
    }

    /// Releases every key and the pedal of one channel, e.g. when its player leaves.
    pub fn release_channel(&mut self, channel: usize) {
        let Some(keys) = self.keys.get_mut(channel) else { return };
        let released = std::mem::take(keys);
        for id in released.voices.into_iter().filter(|&id| id != 0) {
            self.note_off(id);
        }
    }

    pub fn note_on(&mut self, id: u32, channel: usize, midi: u8, velocity: f32) {
        if self.voices.len() >= MAX_VOICES {
            self.voices.remove(0);
        }
        let channel = if channel < MAX_CHANNELS { channel } else { 0 };
        if let Some(mut voice) = Voice::new(id, midi, velocity.clamp(0., 1.), &self.instruments[channel], &self.samples, self.sample_rate) {
            voice.channel = channel;
            self.voices.push(voice);
        }
    }

    pub fn note_off(&mut self, id: u32) {
        if let Some(voice) = self.voices.iter_mut().find(|v| v.id == id) {
            voice.release();
        }
    }

    pub fn all_off(&mut self) {
        self.keys.iter_mut().for_each(|keys| *keys = Keys::default());
        self.voices.iter_mut().for_each(Voice::stop);
    }

    /// Sets up sequencer lanes; call once at start-up, before audio runs (it allocates).
    pub fn configure_sequencer(&mut self, lanes: usize, first_channel: usize, click_channel: usize) {
        self.sequencer = Sequencer::new(lanes, first_channel, click_channel);
    }

    pub fn sequencer(&mut self) -> &mut Sequencer {
        &mut self.sequencer
    }

    /// Stops the transport and releases every sequenced note.
    pub fn transport_stop(&mut self) {
        let mut sequencer = std::mem::take(&mut self.sequencer);
        sequencer.stop(&mut |cmd| self.apply(cmd));
        self.sequencer = sequencer;
    }

    fn apply(&mut self, cmd: Cmd) {
        match cmd {
            Cmd::On { id, channel, pitch, velocity } => self.note_on(id, channel, pitch, velocity),
            Cmd::Off { id } => self.note_off(id),
        }
    }

    fn sequence(&mut self, frames: usize) {
        if !self.sequencer.playing {
            return;
        }
        let beats = frames as f64 * self.sequencer.tempo / 60. / self.sample_rate as f64;
        let mut sequencer = std::mem::take(&mut self.sequencer);
        sequencer.advance(beats, &mut |cmd| self.apply(cmd));
        self.sequencer = sequencer;
    }

    pub fn render(&mut self, out: &mut [f32]) {
        out.fill(0.);
        for chunk in out.chunks_mut(SEQUENCER_CHUNK) {
            self.sequence(chunk.len());
            for voice in &mut self.voices {
                voice.render(chunk, self.sample_rate, self.gains[voice.channel]);
            }
        }
        self.voices.retain(|v| !v.finished());
        let gain = MASTER_GAIN * self.volume;
        for sample in out.iter_mut() {
            *sample = soft_clip(*sample * gain);
        }
    }

    pub fn render_block(&mut self, frames: usize) -> &[f32] {
        let mut buffer = std::mem::take(&mut self.buffer);
        buffer.resize(frames, 0.);
        self.render(&mut buffer);
        self.buffer = buffer;
        &self.buffer
    }
}

fn soft_clip(x: f32) -> f32 {
    let x = x.clamp(-3., 3.);
    x * (27. + x * x) / (27. + 9. * x * x)
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f32 = 48_000.;

    fn synth(envelope: [f32; 6], filter: Option<[f32; 4]>, fm: Option<[f32; 3]>, partials: &[[f32; 4]]) -> Instrument {
        let mut data = vec![0.];
        data.extend(envelope);
        data.push(filter.is_some() as u8 as f32);
        data.extend(filter.unwrap_or_default());
        data.push(fm.is_some() as u8 as f32);
        data.extend(fm.unwrap_or_default());
        data.push(partials.len() as f32);
        data.extend(partials.iter().flatten());
        Instrument::decode(&data).expect("valid synth")
    }

    fn peak(engine: &mut Engine, frames: usize) -> f32 {
        let mut out = vec![0.; frames];
        engine.render(&mut out);
        out.iter().fold(0f32, |m, s| m.max(s.abs()))
    }

    fn patches() -> Vec<Instrument> {
        vec![
            synth([0.004, 2.2, 0., 0.07, 1., 1.], Some([300., 1.5, 4., 1.]), None, &[[1., 1., 0.55, 0.], [2., 0., 0.22, -4.]]),
            synth([0.002, 1.8, 0., 0.12, 1., 1.], None, Some([1., 1.6, 0.35]), &[[1., 0., 0.8, 0.]]),
            synth([0.5, 1.5, 0.8, 1., 0.8, 0.], Some([350., 1.2, 0.6, 2.]), None, &[[1., 2., 0.25, -9.], [1., 2., 0.25, 9.]]),
            synth([0.002, 0.25, 0.6, 0.03, 0.7, 0.], None, None, &[[1., 3., 0.3, 0.]]),
        ]
    }

    #[test]
    fn decoded_patches_sound_and_stay_bounded() {
        for (i, instrument) in patches().into_iter().enumerate() {
            let mut engine = Engine::new(RATE);
            engine.set_instrument(0, instrument);
            for (id, midi) in [48, 60, 64, 67, 72].into_iter().enumerate() {
                engine.note_on(id as u32, 0, midi, 1.);
            }
            let level = peak(&mut engine, RATE as usize);
            assert!(level > 0.05 && level <= 1., "patch {i}: {level}");
        }
    }

    #[test]
    fn decode_rejects_truncated_data() {
        assert!(Instrument::decode(&[]).is_none());
        assert!(Instrument::decode(&[0., 0.1, 0.2]).is_none());
        assert!(Instrument::decode(&[1., 0.2]).is_none());
    }

    #[test]
    fn released_voices_are_freed() {
        let mut engine = Engine::new(RATE);
        engine.set_instrument(0, synth([0.008, 1., 1., 0.04, 0.7, 0.], None, None, &[[1., 0., 0.5, 0.]]));
        engine.note_on(1, 0, 60, 0.8);
        peak(&mut engine, 4800);
        engine.note_off(1);
        peak(&mut engine, RATE as usize);
        assert!(engine.voices.is_empty());
    }

    #[test]
    fn sampler_resamples_nearest_root() {
        let mut engine = Engine::new(RATE);
        engine.set_instrument(0, Instrument::decode(&[1., 0.25, 1.4]).unwrap());
        let data: Arc<[f32]> = (0..4800).map(|i| (i as f32 * 0.05).sin()).collect();
        engine.add_sample(Sample { root: 60, rate: RATE, data });
        engine.note_on(1, 0, 62, 1.);
        assert!(peak(&mut engine, 1000) > 0.1);
        engine.note_on(2, 0, 72, 1.);
        peak(&mut engine, 4800);
        assert!(engine.voices.is_empty());
    }

    #[test]
    fn channels_use_their_own_instrument() {
        let mut engine = Engine::new(RATE);
        engine.set_instrument(1, synth([0.004, 1., 0., 0.1, 0., 0.], None, None, &[[1., 0., 0.5, 0.]]));
        engine.note_on(1, 1, 60, 1.);
        assert_eq!(peak(&mut engine, 2400), 0., "silent patch on channel 1");
        engine.note_on(2, 0, 60, 1.);
        assert!(peak(&mut engine, 2400) > 0.05, "default patch on channel 0");
        engine.note_on(3, MAX_CHANNELS + 5, 60, 1.);
        assert!(engine.voices.len() == 2, "unknown channel falls back to channel 0");
    }

    fn sounding(engine: &Engine) -> usize {
        engine.voices.iter().filter(|v| !v.released()).count()
    }

    #[test]
    fn keys_follow_the_sustain_pedal() {
        let mut engine = Engine::new(RATE);
        engine.key_on(0, 60, 1.);
        engine.key_on(0, 64, 1.);
        engine.key_off(0, 60);
        assert_eq!(sounding(&engine), 1);

        engine.pedal(0, true);
        engine.key_off(0, 64);
        engine.key_on(0, 67, 1.);
        engine.key_off(0, 67);
        assert_eq!(sounding(&engine), 2, "pedal holds released keys");

        engine.key_on(0, 67, 1.);
        assert_eq!(sounding(&engine), 2, "replaying a sustained key restarts it");
        engine.pedal(0, false);
        assert_eq!(sounding(&engine), 1, "pedal up releases only keys no longer held");
        engine.key_off(0, 67);
        assert_eq!(sounding(&engine), 0);
    }

    #[test]
    fn a_note_shared_by_two_chords_sounds_until_both_let_go() {
        let mut engine = Engine::new(RATE);
        for midi in [60, 64, 67] {
            engine.key_on(0, midi, 1.);
        }
        for midi in [64, 67, 71] {
            engine.key_on(0, midi, 1.);
        }
        assert_eq!(sounding(&engine), 4, "shared notes restart instead of doubling");
        for midi in [60, 64, 67] {
            engine.key_off(0, midi);
        }
        assert_eq!(sounding(&engine), 3, "the second chord keeps its shared notes");
        for midi in [64, 67, 71] {
            engine.key_off(0, midi);
        }
        assert_eq!(sounding(&engine), 0);
    }

    #[test]
    fn channels_keep_separate_keys() {
        let mut engine = Engine::new(RATE);
        engine.key_on(0, 60, 1.);
        engine.key_on(1, 60, 1.);
        engine.pedal(1, true);
        engine.key_off(1, 60);
        engine.key_off(0, 60);
        assert_eq!(sounding(&engine), 1);
        engine.release_channel(1);
        assert_eq!(sounding(&engine), 0);
        engine.key_on(MAX_CHANNELS, 60, 1.);
        assert_eq!(sounding(&engine), 0, "keys outside the channel range are ignored");
    }

    #[test]
    fn channel_gain_scales_only_its_channel() {
        let tone = || synth([0.001, 10., 1., 0.1, 1., 0.], None, None, &[[1., 0., 0.5, 0.]]);
        let mut engine = Engine::new(RATE);
        engine.set_instrument(2, tone());
        engine.set_instrument(3, tone());
        engine.key_on(2, 60, 1.);
        let full = peak(&mut engine, 2400);
        engine.set_channel_gain(2, 0.);
        assert_eq!(peak(&mut engine, 2400), 0., "muted channel is silent");
        engine.key_on(3, 64, 1.);
        assert!((peak(&mut engine, 2400) - full).abs() < full * 0.5, "other channel unaffected");
    }

    #[test]
    fn sequenced_clips_sound_on_the_beat() {
        let mut engine = Engine::new(RATE);
        engine.configure_sequencer(1, 1, 63);
        engine.set_instrument(1, synth([0.001, 1., 1., 0.05, 1., 0.], None, None, &[[1., 0., 0.5, 0.]]));
        let pattern = Arc::new(Pattern { length: 1., notes: vec![SeqNote { start: 0.5, end: 0.75, pitch: 60, velocity: 1. }] });
        engine.sequencer().launch(0, Some((1, pattern)), false);
        let half_beat = (RATE / 4.) as usize;
        assert_eq!(peak(&mut engine, half_beat - SEQUENCER_CHUNK), 0., "silent before beat 0.5 at 120 bpm");
        assert!(peak(&mut engine, SEQUENCER_CHUNK * 4) > 0.05);
        engine.transport_stop();
        peak(&mut engine, RATE as usize);
        assert!(engine.voices.is_empty());
    }

    #[test]
    fn kit_pads_play_their_sample_to_the_end() {
        let mut engine = Engine::new(RATE);
        let data: Arc<[f32]> = (0..2400).map(|i| (i as f32 * 0.1).sin()).collect();
        let kit = Kit::default().with_pad(36, Some(Sample { root: 36, rate: RATE, data }));
        engine.set_instrument(0, Instrument::Kit(Arc::new(kit)));
        engine.note_on(1, 0, 36, 1.);
        engine.note_on(2, 0, 37, 1.);
        assert_eq!(engine.voices.len(), 1, "empty pads are silent");
        engine.note_off(1);
        assert!(peak(&mut engine, 1200) > 0.1, "one-shot ignores note off");
        peak(&mut engine, 2400);
        assert!(engine.voices.is_empty(), "voice ends with its sample");
    }

    #[test]
    fn sampler_without_samples_is_silent() {
        let mut engine = Engine::new(RATE);
        engine.set_instrument(0, Instrument::decode(&[1., 0.25, 1.]).unwrap());
        engine.note_on(1, 0, 60, 1.);
        assert_eq!(peak(&mut engine, 512), 0.);
    }
}

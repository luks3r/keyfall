use std::sync::Arc;

pub const MAX_PARTIALS: usize = 8;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Wave {
    Sine,
    Triangle,
    Saw,
    Square,
}

impl Wave {
    fn from_index(index: f32) -> Self {
        match index as u32 {
            1 => Wave::Triangle,
            2 => Wave::Saw,
            3 => Wave::Square,
            _ => Wave::Sine,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Partial {
    pub ratio: f32,
    pub wave: Wave,
    pub gain: f32,
    pub detune: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct Filter {
    pub base: f32,
    pub track: f32,
    pub env: f32,
    pub decay: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct Fm {
    pub ratio: f32,
    pub index: f32,
    pub decay: f32,
}

#[derive(Clone, Debug)]
pub struct Patch {
    pub partials: Vec<Partial>,
    pub attack: f32,
    pub decay: f32,
    pub sustain: f32,
    pub release: f32,
    pub gain: f32,
    pub key_track: bool,
    pub filter: Option<Filter>,
    pub fm: Option<Fm>,
}

#[derive(Clone, Debug)]
pub enum Instrument {
    Synth(Arc<Patch>),
    Sampler { release: f32, gain: f32 },
    Kit(Arc<Kit>),
}

pub const PADS: usize = 128;

/// One sample per MIDI note, played at its own pitch and to its end (drum pads, one-shots).
#[derive(Clone, Debug)]
pub struct Kit {
    pub pads: Vec<Option<crate::Sample>>,
    pub gain: f32,
}

impl Default for Kit {
    fn default() -> Self {
        Self { pads: vec![None; PADS], gain: 1. }
    }
}

impl Kit {
    /// A copy with one pad replaced; build it off the audio thread and swap the whole kit in.
    pub fn with_pad(&self, midi: u8, sample: Option<crate::Sample>) -> Self {
        let mut kit = self.clone();
        if let Some(pad) = kit.pads.get_mut(midi as usize) {
            *pad = sample;
        }
        kit
    }
}

impl Default for Instrument {
    fn default() -> Self {
        Instrument::Synth(Arc::new(Patch {
            partials: vec![Partial { ratio: 1., wave: Wave::Sine, gain: 0.8, detune: 0. }],
            attack: 0.004,
            decay: 1.,
            sustain: 0.,
            release: 0.1,
            gain: 1.,
            key_track: false,
            filter: None,
            fm: None,
        }))
    }
}

const KIND_SAMPLER: f32 = 1.;
const SYNTH_HEADER: usize = 16;
const PARTIAL_FIELDS: usize = 4;
const MIN_TIME: f32 = 0.001;

impl Instrument {
    /// Decodes the flat layout written by `encodeSynth` / `encodeSampler` in `src/lib/audio/patch.ts`.
    pub fn decode(data: &[f32]) -> Option<Self> {
        let (&kind, rest) = data.split_first()?;
        if kind == KIND_SAMPLER {
            let &[release, gain] = rest.get(..2)? else { return None };
            return Some(Instrument::Sampler { release: release.max(MIN_TIME), gain });
        }
        let header: [f32; SYNTH_HEADER] = rest.get(..SYNTH_HEADER)?.try_into().ok()?;
        let [attack, decay, sustain, release, gain, key_track, filter_on, base, track, env, filter_decay, fm_on, ratio, index, fm_decay, count] = header;
        let partials = rest[SYNTH_HEADER..]
            .as_chunks::<PARTIAL_FIELDS>()
            .0
            .iter()
            .take((count as usize).min(MAX_PARTIALS))
            .map(|p| Partial { ratio: p[0].max(0.), wave: Wave::from_index(p[1]), gain: p[2], detune: p[3] })
            .collect();
        Some(Instrument::Synth(Arc::new(Patch {
            partials,
            attack: attack.max(MIN_TIME),
            decay: decay.max(MIN_TIME),
            sustain: sustain.clamp(0., 1.),
            release: release.max(MIN_TIME),
            gain,
            key_track: key_track != 0.,
            filter: (filter_on != 0.).then_some(Filter { base: base.max(1.), track, env, decay: filter_decay.max(MIN_TIME) }),
            fm: (fm_on != 0.).then_some(Fm { ratio: ratio.max(0.), index, decay: fm_decay.max(MIN_TIME) }),
        })))
    }
}

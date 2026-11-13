use crate::patch::{Instrument, Patch, Wave, MAX_PARTIALS};
use crate::Sample;
use std::f32::consts::TAU;
use std::sync::Arc;

const SILENCE: f32 = 1e-4;
const FILTER_RATE: u32 = 16;
const MAX_CUTOFF: f32 = 16_000.;
const SAMPLE_VELOCITY_CURVE: f32 = 1.6;
const KIT_RELEASE: f32 = 0.05;

pub fn frequency(midi: u8) -> f32 {
    440. * 2f32.powf((midi as f32 - 69.) / 12.)
}

fn time_coef(seconds: f32, sample_rate: f32) -> f32 {
    (-1. / (seconds.max(1e-4) * sample_rate)).exp()
}

fn poly_blep(t: f32, dt: f32) -> f32 {
    if t < dt {
        let t = t / dt;
        2. * t - t * t - 1.
    } else if t > 1. - dt {
        let t = (t - 1.) / dt;
        t * t + 2. * t + 1.
    } else {
        0.
    }
}

#[derive(Clone, Copy)]
struct Osc {
    phase: f32,
    inc: f32,
    gain: f32,
    wave: Wave,
}

impl Osc {
    fn next(&mut self, fm: f32) -> f32 {
        let (t, dt) = (self.phase, self.inc);
        let value = match self.wave {
            Wave::Sine => (TAU * t).sin(),
            Wave::Triangle => 4. * (t - 0.5).abs() - 1.,
            Wave::Saw => 2. * t - 1. - poly_blep(t, dt),
            Wave::Square => {
                let square = if t < 0.5 { 1. } else { -1. };
                square + poly_blep(t, dt) - poly_blep((t + 0.5).fract(), dt)
            }
        };
        self.phase += dt + fm;
        self.phase -= self.phase.floor();
        value * self.gain
    }
}

struct Modulator {
    phase: f32,
    inc: f32,
    depth: f32,
    coef: f32,
}

struct LowPass {
    z1: f32,
    z2: f32,
    g: f32,
    cutoff: f32,
    target: f32,
    coef: f32,
    tick: u32,
}

impl LowPass {
    fn process(&mut self, x: f32, sample_rate: f32) -> f32 {
        if self.tick.is_multiple_of(FILTER_RATE) {
            self.cutoff = self.target + (self.cutoff - self.target) * self.coef;
            self.g = 1. - (-TAU * self.cutoff / sample_rate).exp();
        }
        self.tick = self.tick.wrapping_add(1);
        self.z1 += self.g * (x - self.z1);
        self.z2 += self.g * (self.z1 - self.z2);
        self.z2
    }
}

struct Playback {
    data: Arc<[f32]>,
    pos: f64,
    step: f64,
}

impl Playback {
    fn next(&mut self) -> Option<f32> {
        let i = self.pos as usize;
        let (a, b) = (*self.data.get(i)?, *self.data.get(i + 1)?);
        let frac = (self.pos - i as f64) as f32;
        self.pos += self.step;
        Some(a + (b - a) * frac)
    }
}

#[derive(PartialEq)]
enum Stage {
    Attack,
    Decay,
    Release,
}

enum Source {
    Synth { oscs: [Osc; MAX_PARTIALS], count: usize, fm: Option<Modulator>, filter: Option<LowPass> },
    Sample(Playback),
}

pub struct Voice {
    pub id: u32,
    pub channel: usize,
    source: Source,
    stage: Stage,
    env: f32,
    peak: f32,
    attack_step: f32,
    sustain: f32,
    decay_coef: f32,
    release_coef: f32,
    finished: bool,
    /// Pads play to the end of their sample; only `stop` cuts them.
    one_shot: bool,
}

impl Voice {
    pub fn new(id: u32, midi: u8, velocity: f32, instrument: &Instrument, samples: &[Sample], sample_rate: f32) -> Option<Self> {
        match instrument {
            Instrument::Synth(patch) => Some(Self::synth(id, midi, velocity, patch, sample_rate)),
            Instrument::Kit(kit) => {
                let sample = kit.pads.get(midi as usize)?.as_ref()?;
                let playback = Playback { data: sample.data.clone(), pos: 0., step: (sample.rate / sample_rate) as f64 };
                let peak = velocity.powf(SAMPLE_VELOCITY_CURVE) * kit.gain;
                let mut voice = Self::envelope(id, Source::Sample(playback), peak, 1., f32::INFINITY, 0.001, KIT_RELEASE, sample_rate);
                voice.one_shot = true;
                Some(voice)
            }
            &Instrument::Sampler { release, gain } => {
                let sample = samples.iter().min_by_key(|s| (s.root as i16 - midi as i16).abs())?;
                let step = 2f64.powf((midi as f64 - sample.root as f64) / 12.) * (sample.rate / sample_rate) as f64;
                let playback = Playback { data: sample.data.clone(), pos: 0., step };
                let peak = velocity.powf(SAMPLE_VELOCITY_CURVE) * gain;
                Some(Self::envelope(id, Source::Sample(playback), peak, 1., f32::INFINITY, 0.002, release, sample_rate))
            }
        }
    }

    fn synth(id: u32, midi: u8, velocity: f32, patch: &Patch, sample_rate: f32) -> Self {
        let f = frequency(midi);
        let decay = patch.decay * if patch.key_track { ((108. - midi as f32) / 60.).clamp(0.2, 1.6) } else { 1. };

        let mut oscs = [Osc { phase: 0., inc: 0., gain: 0., wave: Wave::Sine }; MAX_PARTIALS];
        let count = patch.partials.len().min(MAX_PARTIALS);
        for (osc, partial) in oscs.iter_mut().zip(&patch.partials) {
            let hz = f * partial.ratio * 2f32.powf(partial.detune / 1200.);
            *osc = Osc { phase: 0., inc: hz / sample_rate, gain: partial.gain, wave: partial.wave };
        }

        let fm = patch.fm.map(|fm| Modulator {
            phase: 0.,
            inc: f * fm.ratio / sample_rate,
            depth: f * fm.index * velocity / sample_rate,
            coef: time_coef(fm.decay, sample_rate),
        });

        let filter = patch.filter.map(|filter| {
            let target = (filter.base + f * filter.track).min(MAX_CUTOFF);
            LowPass {
                z1: 0.,
                z2: 0.,
                g: 0.,
                cutoff: (target * (1. + filter.env * velocity)).min(MAX_CUTOFF),
                target,
                coef: time_coef(filter.decay / FILTER_RATE as f32, sample_rate),
                tick: 0,
            }
        });

        let source = Source::Synth { oscs, count, fm, filter };
        Self::envelope(id, source, velocity * patch.gain, patch.sustain, decay, patch.attack, patch.release, sample_rate)
    }

    #[allow(clippy::too_many_arguments)]
    fn envelope(id: u32, source: Source, peak: f32, sustain: f32, decay: f32, attack: f32, release: f32, sample_rate: f32) -> Self {
        Self {
            id,
            channel: 0,
            source,
            stage: Stage::Attack,
            env: 0.,
            peak,
            attack_step: peak / (attack * sample_rate).max(1.),
            sustain: peak * sustain,
            decay_coef: if decay.is_finite() { time_coef(decay, sample_rate) } else { 1. },
            release_coef: time_coef(release, sample_rate),
            finished: false,
            one_shot: false,
        }
    }

    pub fn release(&mut self) {
        if !self.one_shot {
            self.stage = Stage::Release;
        }
    }

    pub fn stop(&mut self) {
        self.stage = Stage::Release;
    }

    #[cfg(test)]
    pub fn released(&self) -> bool {
        matches!(self.stage, Stage::Release)
    }

    pub fn finished(&self) -> bool {
        self.finished
    }

    pub fn render(&mut self, out: &mut [f32], sample_rate: f32, gain: f32) {
        for sample in out.iter_mut() {
            if self.finished {
                return;
            }
            match self.stage {
                Stage::Attack => {
                    self.env += self.attack_step;
                    if self.env >= self.peak {
                        self.env = self.peak;
                        self.stage = Stage::Decay;
                    }
                }
                Stage::Decay => self.env = self.sustain + (self.env - self.sustain) * self.decay_coef,
                Stage::Release => self.env *= self.release_coef,
            }
            let fading = self.stage == Stage::Release || (self.stage == Stage::Decay && self.sustain == 0.);
            if fading && self.env < SILENCE {
                self.finished = true;
                return;
            }

            let value = match &mut self.source {
                Source::Sample(playback) => match playback.next() {
                    Some(value) => value,
                    None => {
                        self.finished = true;
                        return;
                    }
                },
                Source::Synth { oscs, count, fm, filter } => {
                    let offset = fm.as_mut().map_or(0., |m| {
                        let value = (TAU * m.phase).sin() * m.depth;
                        m.phase = (m.phase + m.inc).fract();
                        m.depth *= m.coef;
                        value
                    });
                    let mut value = 0.;
                    for osc in &mut oscs[..*count] {
                        value += osc.next(offset);
                    }
                    match filter {
                        Some(filter) => filter.process(value, sample_rate),
                        None => value,
                    }
                }
            };
            *sample += value * self.env * gain;
        }
    }
}

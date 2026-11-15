//! Clip sequencer inside the audio engine: launches, loops and notes land on the beat whatever the UI thread does.
//!
//! Two clocks run while playing. `clock` only moves forward and carries session clips and launch quantization;
//! `song` is the timeline position and wraps inside the loop region.

use std::sync::Arc;

pub type ClipId = u32;
pub const NO_CLIP: ClipId = 0;
/// Status value for a lane whose queued action is a stop.
pub const STOP_PENDING: ClipId = u32::MAX;

const MIN_NOTE: f64 = 1. / 64.;
const CLICK_BEATS: f64 = 0.1;
const ACCENT_PITCH: u8 = 96;
const BEAT_PITCH: u8 = 89;
const SOUNDING_CAPACITY: usize = 64;
/// Status layout: `[playing, clock, song, tempo]` then `[active clip, origin, queued clip]` per lane.
pub const STATUS_HEADER: usize = 4;
pub const STATUS_PER_LANE: usize = 3;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SeqNote {
    pub start: f64,
    pub end: f64,
    pub pitch: u8,
    pub velocity: f32,
}

/// Notes of one clip in clip-local beats, sorted by start, all starting inside `length`.
#[derive(Debug, Default, PartialEq)]
pub struct Pattern {
    pub length: f64,
    pub notes: Vec<SeqNote>,
}

impl Pattern {
    /// Decodes `[length, (start, length, pitch, velocity)…]` written by `encodePattern` in `src/lib/studio/engine.ts`.
    pub fn decode(data: &[f32]) -> Option<Self> {
        let (&length, rest) = data.split_first()?;
        if length.is_nan() || length <= 0. {
            return None;
        }
        let length = length as f64;
        let mut notes: Vec<SeqNote> = rest
            .as_chunks::<4>()
            .0
            .iter()
            .filter_map(|&[start, len, pitch, velocity]| {
                let start = start as f64;
                (start >= 0. && start < length).then(|| SeqNote {
                    start,
                    end: start + (len as f64).max(MIN_NOTE),
                    pitch: pitch.clamp(0., 127.) as u8,
                    velocity: velocity.clamp(0., 1.),
                })
            })
            .collect();
        notes.sort_by(|a, b| a.start.total_cmp(&b.start));
        Some(Self { length, notes })
    }
}

/// A clip on the timeline; its pattern repeats to fill `length`.
#[derive(Clone, Debug)]
pub struct Placement {
    pub start: f64,
    pub length: f64,
    pub pattern: Arc<Pattern>,
}

pub enum Cmd {
    On { id: u32, channel: usize, pitch: u8, velocity: f32 },
    Off { id: u32 },
}

struct Active {
    clip: ClipId,
    pattern: Arc<Pattern>,
    origin: f64,
}

enum Pending {
    Launch(ClipId, Arc<Pattern>),
    Stop,
}

struct Queued {
    pending: Pending,
    at: f64,
}

struct Lane {
    channel: usize,
    timeline: Vec<Placement>,
    active: Option<Active>,
    queued: Option<Queued>,
    sounding: Vec<(u32, f64)>,
}

/// Voices started here use ids with bit 30 set, apart from caller ids and the engine's key ids (bit 31).
const SEQ_IDS: u32 = 1 << 30;
const SEQ_MASK: u32 = SEQ_IDS - 1;

pub struct Sequencer {
    pub tempo: f64,
    pub playing: bool,
    clock: f64,
    song: f64,
    quantum: f64,
    beats_per_bar: f64,
    loop_region: Option<(f64, f64)>,
    metronome: bool,
    click_channel: usize,
    clicks: Vec<(u32, f64)>,
    lanes: Vec<Lane>,
    next_voice: u32,
}

/// Allocation-free, so the engine can `mem::take` it on the audio thread.
impl Default for Sequencer {
    fn default() -> Self {
        Self {
            tempo: 120.,
            playing: false,
            clock: 0.,
            song: 0.,
            quantum: 4.,
            beats_per_bar: 4.,
            loop_region: None,
            metronome: false,
            click_channel: 0,
            clicks: Vec::new(),
            lanes: Vec::new(),
            next_voice: 0,
        }
    }
}

/// What a lane's timeline or clip asks to play, collected per call so the lane can be borrowed mutably meanwhile.
struct Emit<'a, F: FnMut(Cmd)> {
    emit: &'a mut F,
    next_voice: &'a mut u32,
    sounding: &'a mut Vec<(u32, f64)>,
    channel: usize,
}

impl<F: FnMut(Cmd)> Emit<'_, F> {
    fn note(&mut self, pitch: u8, velocity: f32, end: f64) {
        let id = SEQ_IDS | (*self.next_voice & SEQ_MASK);
        *self.next_voice = self.next_voice.wrapping_add(1);
        (self.emit)(Cmd::On { id, channel: self.channel, pitch, velocity });
        self.sounding.push((id, end));
    }
}

/// Plays `pattern` for clip-local beats `[from, to)`, looping it; `clock_offset` turns local beats into clock beats.
fn play_pattern<F: FnMut(Cmd)>(pattern: &Pattern, from: f64, to: f64, limit: f64, clock_offset: f64, out: &mut Emit<'_, F>) {
    let length = pattern.length;
    let (from, to) = (from.max(0.), to.min(limit));
    if to <= from || length <= 0. {
        return;
    }
    let mut cycle = (from / length).floor();
    while cycle * length < to {
        let base = cycle * length;
        let (a, b) = (from.max(base) - base, to.min(base + length) - base);
        let first = pattern.notes.partition_point(|n| n.start < a);
        for note in pattern.notes[first..].iter().take_while(|n| n.start < b) {
            let end = (base + note.end.min(length)).min(limit);
            out.note(note.pitch, note.velocity, end + clock_offset);
        }
        cycle += 1.;
    }
}

impl Sequencer {
    pub fn new(lanes: usize, first_channel: usize, click_channel: usize) -> Self {
        Self {
            click_channel,
            clicks: Vec::with_capacity(SOUNDING_CAPACITY),
            lanes: (0..lanes)
                .map(|i| Lane {
                    channel: first_channel + i,
                    timeline: Vec::new(),
                    active: None,
                    queued: None,
                    sounding: Vec::with_capacity(SOUNDING_CAPACITY),
                })
                .collect(),
            ..Self::default()
        }
    }

    pub fn lanes(&self) -> usize {
        self.lanes.len()
    }

    pub fn set_quantum(&mut self, beats: f64) {
        self.quantum = beats.max(0.);
    }

    pub fn set_meter(&mut self, beats_per_bar: f64) {
        self.beats_per_bar = beats_per_bar.max(1.);
    }

    pub fn set_metronome(&mut self, on: bool) {
        self.metronome = on;
    }

    pub fn set_loop(&mut self, region: Option<(f64, f64)>) {
        self.loop_region = region.filter(|(start, end)| end > start);
    }

    /// Starts playing at song beat `from`; the clock starts there too, so launch quantization follows song bars.
    pub fn play(&mut self, from: f64) {
        self.playing = true;
        self.song = from;
        self.clock = from;
    }

    /// Stops the transport and every clip; returns the voices to release.
    pub fn stop(&mut self, emit: &mut impl FnMut(Cmd)) {
        self.playing = false;
        for lane in &mut self.lanes {
            lane.active = None;
            lane.queued = None;
            for (id, _) in lane.sounding.drain(..) {
                emit(Cmd::Off { id });
            }
        }
        for (id, _) in self.clicks.drain(..) {
            emit(Cmd::Off { id });
        }
    }

    /// Replaces a lane's timeline; returns the old one so the caller can free it off the audio thread.
    pub fn set_timeline(&mut self, lane: usize, timeline: Vec<Placement>) -> Option<Vec<Placement>> {
        self.lanes.get_mut(lane).map(|l| std::mem::replace(&mut l.timeline, timeline))
    }

    /// Launches `clip` (or stops with `None`) on the next quantum, or now when `quantized` is false.
    /// Launching while stopped starts the transport from the start of the current bar, and the clip with it.
    pub fn launch(&mut self, lane: usize, clip: Option<(ClipId, Arc<Pattern>)>, quantized: bool) {
        let starting = !self.playing && clip.is_some();
        if starting {
            self.play((self.song / self.beats_per_bar).floor() * self.beats_per_bar);
        }
        let at = if quantized && self.quantum > 0. && !starting { (self.clock / self.quantum).ceil() * self.quantum } else { self.clock };
        let Some(lane) = self.lanes.get_mut(lane) else { return };
        let pending = match clip {
            Some((id, pattern)) => Pending::Launch(id, pattern),
            None => Pending::Stop,
        };
        lane.queued = Some(Queued { pending, at });
    }

    /// New content for a clip that may be playing or queued; returns the replaced patterns.
    pub fn update(&mut self, clip: ClipId, pattern: &Arc<Pattern>, replaced: &mut impl FnMut(Arc<Pattern>)) {
        for lane in &mut self.lanes {
            if let Some(active) = lane.active.as_mut().filter(|a| a.clip == clip) {
                replaced(std::mem::replace(&mut active.pattern, pattern.clone()));
            }
            if let Some(Queued { pending: Pending::Launch(id, queued), .. }) = lane.queued.as_mut()
                && *id == clip
            {
                replaced(std::mem::replace(queued, pattern.clone()));
            }
        }
    }

    /// Song ranges covered by the next `beats`, split where the loop region wraps: `(from, to, clock at from)`.
    fn song_segments(&self, beats: f64) -> ([(f64, f64, f64); 2], usize, f64) {
        let (from, to) = (self.song, self.song + beats);
        match self.loop_region {
            Some((start, end)) if from < end && to >= end => {
                let first = end - from;
                ([(from, end, self.clock), (start, start + beats - first, self.clock + first)], 2, start + beats - first)
            }
            _ => ([(from, to, self.clock), (0., 0., 0.)], 1, to),
        }
    }

    /// Advances by `beats`, asking `emit` to start and release voices.
    pub fn advance(&mut self, beats: f64, emit: &mut impl FnMut(Cmd)) {
        if !self.playing || beats <= 0. {
            return;
        }
        let (from, to) = (self.clock, self.clock + beats);
        let (segments, count, song_after) = self.song_segments(beats);

        if self.metronome {
            let mut beat = from.ceil();
            while beat < to {
                let bar = self.beats_per_bar as i64;
                let accent = (beat as i64).rem_euclid(bar) == 0;
                let id = SEQ_IDS | (self.next_voice & SEQ_MASK);
                self.next_voice = self.next_voice.wrapping_add(1);
                emit(Cmd::On { id, channel: self.click_channel, pitch: if accent { ACCENT_PITCH } else { BEAT_PITCH }, velocity: 1. });
                self.clicks.push((id, beat + CLICK_BEATS));
                beat += 1.;
            }
        }
        self.clicks.retain(|&(id, end)| {
            let keep = end > to;
            if !keep {
                emit(Cmd::Off { id });
            }
            keep
        });

        for lane in &mut self.lanes {
            if lane.queued.as_ref().is_some_and(|q| q.at < to) {
                let queued = lane.queued.take().unwrap();
                for (id, _) in lane.sounding.drain(..) {
                    emit(Cmd::Off { id });
                }
                lane.active = match queued.pending {
                    Pending::Launch(clip, pattern) => Some(Active { clip, pattern, origin: queued.at }),
                    Pending::Stop => None,
                };
            }
            let mut out = Emit { emit: &mut *emit, next_voice: &mut self.next_voice, sounding: &mut lane.sounding, channel: lane.channel };
            match &lane.active {
                Some(active) => play_pattern(&active.pattern, from - active.origin, to - active.origin, f64::INFINITY, active.origin, &mut out),
                None => {
                    for &(song_from, song_to, clock_at) in &segments[..count] {
                        for placement in &lane.timeline {
                            let local = (song_from - placement.start, song_to - placement.start);
                            if local.1 <= 0. || local.0 >= placement.length {
                                continue;
                            }
                            let offset = clock_at - song_from + placement.start;
                            play_pattern(&placement.pattern, local.0, local.1, placement.length, offset, &mut out);
                        }
                    }
                }
            }
            lane.sounding.retain(|&(id, end)| {
                let keep = end > to;
                if !keep {
                    emit(Cmd::Off { id });
                }
                keep
            });
        }
        self.clock = to;
        self.song = song_after;
    }

    pub fn status_len(&self) -> usize {
        STATUS_HEADER + self.lanes.len() * STATUS_PER_LANE
    }

    /// Writes the status layout described at `STATUS_HEADER` into `out`.
    pub fn write_status(&self, out: &mut [f64]) {
        if out.len() < self.status_len() {
            return;
        }
        out[..STATUS_HEADER].copy_from_slice(&[self.playing as u8 as f64, self.clock, self.song, self.tempo]);
        for (lane, slot) in self.lanes.iter().zip(out[STATUS_HEADER..].as_chunks_mut::<STATUS_PER_LANE>().0) {
            let queued = lane.queued.as_ref().map_or(NO_CLIP, |q| match q.pending {
                Pending::Launch(id, _) => id,
                Pending::Stop => STOP_PENDING,
            });
            slot.copy_from_slice(&[
                lane.active.as_ref().map_or(NO_CLIP, |a| a.clip) as f64,
                lane.active.as_ref().map_or(0., |a| a.origin),
                queued as f64,
            ]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pattern(length: f64, notes: &[(f64, f64, u8)]) -> Arc<Pattern> {
        Arc::new(Pattern { length, notes: notes.iter().map(|&(start, end, pitch)| SeqNote { start, end, pitch, velocity: 1. }).collect() })
    }

    /// Runs `beats` in small steps and returns `(clock beat, pitch)` for every note on.
    fn run(seq: &mut Sequencer, beats: f64) -> Vec<(f64, u8)> {
        const STEP: f64 = 1. / 32.;
        let mut on = Vec::new();
        let mut t = 0.;
        while t < beats - 1e-9 {
            let at = seq.clock;
            seq.advance(STEP, &mut |cmd| {
                if let Cmd::On { pitch, .. } = cmd {
                    on.push((at, pitch));
                }
            });
            t += STEP;
        }
        on
    }

    #[test]
    fn decodes_and_sorts_patterns() {
        let p = Pattern::decode(&[2., 1., 0.5, 64., 0.8, 0., 0.25, 60., 1., 5., 1., 70., 1.]).unwrap();
        assert_eq!(p.notes.iter().map(|n| n.pitch).collect::<Vec<_>>(), [60, 64], "notes outside the length are dropped");
        assert!(Pattern::decode(&[0.]).is_none());
    }

    #[test]
    fn session_clips_loop_from_their_launch() {
        let mut seq = Sequencer::new(1, 32, 63);
        seq.launch(0, Some((1, pattern(1., &[(0., 0.5, 60)]))), false);
        assert!(seq.playing, "launching starts the transport");
        let on = run(&mut seq, 3.);
        assert_eq!(on, [(0., 60), (1., 60), (2., 60)]);
    }

    #[test]
    fn quantized_launches_wait_for_the_next_bar() {
        let mut seq = Sequencer::new(2, 32, 63);
        seq.play(0.);
        run(&mut seq, 1.5);
        seq.launch(1, Some((7, pattern(4., &[(0., 1., 48)]))), true);
        let mut status = vec![0.; seq.status_len()];
        seq.write_status(&mut status);
        assert_eq!(status[STATUS_HEADER + STATUS_PER_LANE + 2], 7., "queued until the bar");
        let on = run(&mut seq, 3.);
        assert_eq!(on, [(4., 48)]);
        seq.write_status(&mut status);
        assert_eq!(&status[STATUS_HEADER + STATUS_PER_LANE..][..3], &[7., 4., 0.]);
    }

    #[test]
    fn launching_while_stopped_starts_now_from_the_bar() {
        let mut seq = Sequencer::new(1, 32, 63);
        seq.set_quantum(4.);
        seq.play(0.);
        run(&mut seq, 5.5);
        seq.stop(&mut |_| {});
        seq.launch(0, Some((1, pattern(1., &[(0., 0.5, 60)]))), true);
        assert_eq!(seq.song, 4., "back to the start of the bar it stopped in");
        assert_eq!(run(&mut seq, 1.), [(4., 60)], "no wait for the next bar");
    }

    #[test]
    fn stopping_a_lane_falls_back_to_its_timeline() {
        let mut seq = Sequencer::new(1, 32, 63);
        seq.set_timeline(0, vec![Placement { start: 0., length: 8., pattern: pattern(2., &[(0., 1., 72)]) }]);
        seq.launch(0, Some((3, pattern(1., &[(0., 0.5, 36)]))), false);
        assert_eq!(run(&mut seq, 2.).iter().map(|n| n.1).collect::<Vec<_>>(), [36, 36]);
        seq.launch(0, None, true);
        let on = run(&mut seq, 4.);
        assert_eq!(on, [(2., 36), (3., 36), (4., 72)], "clip plays out the bar, then the timeline resumes at the song position");
    }

    #[test]
    fn timeline_wraps_inside_the_loop_region() {
        let mut seq = Sequencer::new(1, 32, 63);
        seq.set_timeline(0, vec![Placement { start: 0., length: 4., pattern: pattern(4., &[(0., 1., 60), (2., 3., 62)]) }]);
        seq.set_loop(Some((2., 4.)));
        seq.play(0.);
        let pitches: Vec<_> = run(&mut seq, 6.).iter().map(|n| n.1).collect();
        assert_eq!(pitches, [60, 62, 62], "beats 0, 2, then 2 again after wrapping at 4");
    }

    #[test]
    fn notes_are_released_and_stop_clears_everything() {
        let mut seq = Sequencer::new(1, 32, 63);
        seq.launch(0, Some((1, pattern(4., &[(0., 1., 60)]))), false);
        let mut offs = 0;
        let mut step = |seq: &mut Sequencer, beats| seq.advance(beats, &mut |cmd| offs += matches!(cmd, Cmd::Off { .. }) as usize);
        step(&mut seq, 0.5);
        step(&mut seq, 1.);
        assert_eq!(offs, 1, "note released at its end");
        seq.launch(0, Some((1, pattern(4., &[(0., 4., 60)]))), false);
        let mut released = 0;
        seq.advance(0.1, &mut |_| {});
        seq.stop(&mut |cmd| released += matches!(cmd, Cmd::Off { .. }) as usize);
        assert_eq!(released, 1);
        assert!(!seq.playing);
    }

    #[test]
    fn metronome_accents_downbeats() {
        let mut seq = Sequencer::new(0, 32, 63);
        seq.set_metronome(true);
        seq.play(0.);
        let pitches: Vec<_> = run(&mut seq, 5.).iter().map(|n| n.1).collect();
        assert_eq!(pitches, [ACCENT_PITCH, BEAT_PITCH, BEAT_PITCH, BEAT_PITCH, ACCENT_PITCH]);
    }
}

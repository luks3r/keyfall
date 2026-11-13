//! State hosts keep beside the engine and hand over as finished `Arc`s: clip patterns by id and pad kits per channel.

use crate::{ClipId, Instrument, Kit, Pattern, Placement, Sample};
use std::collections::HashMap;
use std::sync::Arc;

/// Engine channel layout shared with `src/lib/audio/engine.svelte.ts`.
pub mod channels {
    pub const LOCAL: usize = 0;
    pub const FIRST_TRACK: usize = 32;
    pub const TRACKS: usize = 31;
    pub const CLICK: usize = 63;
}

#[derive(Default)]
pub struct Library {
    patterns: HashMap<ClipId, Arc<Pattern>>,
    kits: HashMap<usize, Kit>,
}

const PLACEMENT_FIELDS: usize = 3;

impl Library {
    pub fn set_pattern(&mut self, id: ClipId, pattern: Pattern) -> Arc<Pattern> {
        let pattern = Arc::new(pattern);
        self.patterns.insert(id, pattern.clone());
        pattern
    }

    pub fn pattern(&self, id: ClipId) -> Option<Arc<Pattern>> {
        self.patterns.get(&id).cloned()
    }

    /// Drops patterns no longer referenced by the project.
    pub fn retain(&mut self, keep: &[ClipId]) {
        self.patterns.retain(|id, _| keep.contains(id));
    }

    /// Decodes `[start, length, clip id]…` written by `encodeTimeline` in `src/lib/studio/engine.ts`.
    pub fn timeline(&self, data: &[f32]) -> Vec<Placement> {
        data.as_chunks::<PLACEMENT_FIELDS>()
            .0
            .iter()
            .filter_map(|&[start, length, id]| {
                let pattern = self.pattern(id as ClipId)?;
                (length > 0.).then_some(Placement { start: start as f64, length: length as f64, pattern })
            })
            .collect()
    }

    /// Sets one pad of a channel's kit; returns the instrument to install on that channel.
    pub fn set_pad(&mut self, channel: usize, midi: u8, sample: Option<Sample>) -> Instrument {
        let kit = self.kits.entry(channel).or_default();
        *kit = kit.with_pad(midi, sample);
        Instrument::Kit(Arc::new(kit.clone()))
    }

    pub fn clear_kit(&mut self, channel: usize) -> Instrument {
        self.kits.remove(&channel);
        Instrument::Kit(Arc::new(Kit::default()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timelines_resolve_known_patterns_only() {
        let mut library = Library::default();
        library.set_pattern(3, Pattern { length: 4., notes: vec![] });
        let timeline = library.timeline(&[0., 8., 3., 8., 4., 9.]);
        assert_eq!(timeline.len(), 1);
        assert_eq!((timeline[0].start, timeline[0].length), (0., 8.));
    }
}

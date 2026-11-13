//! Native keyboard fast path: notes sound from the window's own key events, before the webview sees them.
//! The webview stays in charge of game logic and pushes the layout it would play.

#[cfg(target_os = "macos")]
mod macos;

use crate::audio::{Command, Commands};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Layout pushed by the webview: DOM `code` (with `Shift+` for the Shift layer) to absolute MIDI note.
#[derive(serde::Deserialize, Default)]
pub struct Layout {
    enabled: bool,
    shifted: bool,
    velocity: f32,
    notes: HashMap<String, u8>,
}

const SHIFT: &str = "Shift+";

#[derive(Default)]
struct State {
    layout: Layout,
    /// Physical key to the note and channel it started, so release reaches the same voice.
    held: HashMap<u16, (Vec<u8>, usize)>,
}

#[derive(Clone)]
pub struct Keys {
    state: Arc<Mutex<State>>,
    commands: Commands,
}

impl Keys {
    pub fn new(commands: Commands) -> Self {
        Self { state: Arc::default(), commands }
    }

    /// Whether this platform has a fast path; the webview then leaves the sound of mapped keys to it.
    pub const SUPPORTED: bool = cfg!(target_os = "macos");

    pub fn set_layout(&self, layout: Layout) {
        if let Ok(mut state) = self.state.lock() {
            state.layout = layout;
        }
    }

    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    fn key_down(&self, key: u16, code: &str, shift: bool) {
        let Ok(mut state) = self.state.lock() else { return };
        let layout = &state.layout;
        if !layout.enabled || state.held.contains_key(&key) {
            return;
        }
        let shifted = if shift && layout.shifted { layout.notes.get(&format!("{SHIFT}{code}")) } else { None };
        let Some(&midi) = shifted.or_else(|| layout.notes.get(code)) else { return };
        let velocity = layout.velocity;
        let channel = self.commands.live_channel();
        let notes = self.commands.map_note(midi);
        for &midi in &notes {
            self.commands.play(Command::KeyOn { channel, midi, velocity });
        }
        state.held.insert(key, (notes, channel));
    }

    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    fn key_up(&self, key: u16) {
        let Some((notes, channel)) = self.state.lock().ok().and_then(|mut state| state.held.remove(&key)) else { return };
        for midi in notes {
            self.commands.play(Command::KeyOff { channel, midi });
        }
    }

    /// Starts listening; call once on the main thread.
    pub fn install(&self) {
        #[cfg(target_os = "macos")]
        macos::install(self.clone());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(shifted: bool) -> Keys {
        let keys = Keys::new(Commands::new());
        let notes = HashMap::from([("Digit1".into(), 36), ("Shift+Digit1".into(), 37)]);
        keys.set_layout(Layout { enabled: true, shifted, velocity: 0.8, notes });
        keys
    }

    fn held(keys: &Keys, key: u16) -> Option<u8> {
        keys.state.lock().unwrap().held.get(&key).and_then(|(notes, _)| notes.first().copied())
    }

    #[test]
    fn plays_the_shift_layer_only_when_the_layout_has_one() {
        let layered = keys(true);
        layered.key_down(18, "Digit1", true);
        assert_eq!(held(&layered, 18), Some(37));
        layered.key_up(18);
        assert_eq!(held(&layered, 18), None);

        let plain = keys(false);
        plain.key_down(18, "Digit1", true);
        assert_eq!(held(&plain, 18), Some(36), "Shift is the pedal here, so the plain note plays");
    }

    #[test]
    fn plays_every_note_of_the_note_map() {
        let keys = keys(false);
        let mut map = vec![Vec::new(); 128];
        map[36] = vec![36, 40, 43];
        keys.commands.set_note_map(map);
        keys.key_down(18, "Digit1", false);
        assert_eq!(keys.state.lock().unwrap().held[&18].0, [36, 40, 43]);
    }

    #[test]
    fn ignores_unmapped_keys_and_disabled_layouts() {
        let keys = keys(false);
        keys.key_down(0, "KeyA", false);
        assert_eq!(held(&keys, 0), None);
        keys.set_layout(Layout::default());
        keys.key_down(18, "Digit1", false);
        assert_eq!(held(&keys, 18), None);
    }
}

use crate::audio::{Command, Commands};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use midir::{MidiInput, MidiInputConnection, MidiOutput, MidiOutputConnection};
use std::sync::Mutex;
use tauri::ipc::{Channel, Response};

const CLIENT: &str = "keyfall";
const NOTE_ON: u8 = 0x90;
const NOTE_OFF: u8 = 0x80;
const CONTROL_CHANGE: u8 = 0xb0;
const SUSTAIN_PEDAL: u8 = 64;
const VELOCITY_MAX: f32 = 127.;

pub struct Midi {
    commands: Commands,
    /// `(status kind, data byte)` pairs mapped to controls; they never sound.
    reserved: Arc<Mutex<HashSet<(u8, u8)>>>,
    input: Mutex<Option<MidiInputConnection<()>>>,
    output: Mutex<Option<MidiOutputConnection>>,
}

/// Engine commands for played MIDI messages, through the note map, so input sounds without a webview round trip.
/// Remembers what each held note started, so its release stops the same notes even if the map changed.
#[derive(Default)]
struct Notes {
    held: HashMap<u8, (Vec<u8>, usize)>,
}

impl Notes {
    fn commands(&mut self, message: &[u8], commands: &Commands) -> Vec<Command> {
        let &[status, data, value, ..] = message else { return Vec::new() };
        let data = data.min(127);
        let channel = commands.live_channel();
        match status & 0xf0 {
            NOTE_ON if value > 0 => {
                let notes = commands.map_note(data);
                let velocity = value as f32 / VELOCITY_MAX;
                let on = notes.iter().map(|&midi| Command::KeyOn { channel, midi, velocity }).collect();
                self.held.insert(data, (notes, channel));
                on
            }
            NOTE_ON | NOTE_OFF => self
                .held
                .remove(&data)
                .map(|(notes, channel)| notes.into_iter().map(|midi| Command::KeyOff { channel, midi }).collect())
                .unwrap_or_default(),
            CONTROL_CHANGE if data == SUSTAIN_PEDAL => vec![Command::Pedal { channel, down: value >= 64 }],
            _ => Vec::new(),
        }
    }
}

fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub fn input_names() -> Result<Vec<String>, String> {
    let midi = MidiInput::new(CLIENT).map_err(error)?;
    Ok(midi.ports().iter().filter_map(|p| midi.port_name(p).ok()).collect())
}

pub fn output_names() -> Result<Vec<String>, String> {
    let midi = MidiOutput::new(CLIENT).map_err(error)?;
    Ok(midi.ports().iter().filter_map(|p| midi.port_name(p).ok()).collect())
}

impl Midi {
    pub fn new(commands: Commands) -> Self {
        Self { commands, reserved: Arc::default(), input: Mutex::default(), output: Mutex::default() }
    }

    /// Plays input directly, then forwards `[sounded u8][message]` to the webview for game logic.
    pub fn open_input(&self, name: Option<String>, channel: Channel<Response>) -> Result<(), String> {
        let mut slot = self.input.lock().map_err(error)?;
        slot.take();
        let Some(name) = name else { return Ok(()) };
        let midi = MidiInput::new(CLIENT).map_err(error)?;
        let port = midi
            .ports()
            .into_iter()
            .find(|p| midi.port_name(p).is_ok_and(|n| n == name))
            .ok_or_else(|| format!("MIDI input not found: {name}"))?;
        let commands = self.commands.clone();
        let reserved = self.reserved.clone();
        let mut notes = Notes::default();
        let forward = move |_: u64, message: &[u8], _: &mut ()| {
            let mapped = message.get(1).is_some_and(|&data| reserved.lock().is_ok_and(|r| r.contains(&(message[0] & 0xf0, data))));
            let played = if mapped { Vec::new() } else { notes.commands(message, &commands) };
            let count = played.len();
            let sounded = count > 0 && played.into_iter().map(|command| commands.play(command)).filter(|&played| played).count() == count;
            let mut frame = Vec::with_capacity(message.len() + 1);
            frame.push(sounded as u8);
            frame.extend_from_slice(message);
            let _ = channel.send(Response::new(frame));
        };
        let connection = midi.connect(&port, "keyfall-in", forward, ()).map_err(error)?;
        *slot = Some(connection);
        Ok(())
    }

    /// Replaces the controls that must not sound; NOTE_ON entries also cover NOTE_OFF.
    pub fn reserve(&self, controls: Vec<(u8, u8)>) {
        let expanded = controls.into_iter().flat_map(|(kind, data)| {
            let off = (kind == NOTE_ON).then_some((NOTE_OFF, data));
            [(kind, data)].into_iter().chain(off)
        });
        if let Ok(mut reserved) = self.reserved.lock() {
            *reserved = expanded.collect();
        }
    }

    pub fn open_output(&self, name: Option<String>) -> Result<(), String> {
        let mut slot = self.output.lock().map_err(error)?;
        slot.take();
        let Some(name) = name else { return Ok(()) };
        let midi = MidiOutput::new(CLIENT).map_err(error)?;
        let port = midi
            .ports()
            .into_iter()
            .find(|p| midi.port_name(p).is_ok_and(|n| n == name))
            .ok_or_else(|| format!("MIDI output not found: {name}"))?;
        *slot = Some(midi.connect(&port, "keyfall-out").map_err(error)?);
        Ok(())
    }

    pub fn send(&self, message: &[u8]) {
        if let Ok(mut slot) = self.output.lock()
            && let Some(connection) = slot.as_mut()
        {
            let _ = connection.send(message);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(commands: &[Command]) -> Vec<(u8, bool)> {
        commands
            .iter()
            .filter_map(|c| match *c {
                Command::KeyOn { midi, .. } => Some((midi, true)),
                Command::KeyOff { midi, .. } => Some((midi, false)),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn maps_midi_messages_through_the_note_map() {
        let commands = Commands::new();
        let mut notes = Notes::default();
        assert_eq!(kinds(&notes.commands(&[0x91, 60, 127], &commands)), [(60, true)]);
        assert_eq!(kinds(&notes.commands(&[0x90, 60, 0], &commands)), [(60, false)]);
        let mut map = vec![Vec::new(); 128];
        map[60] = vec![60, 64, 67];
        commands.set_note_map(map);
        assert_eq!(kinds(&notes.commands(&[0x90, 60, 100], &commands)), [(60, true), (64, true), (67, true)]);
        commands.set_note_map(Vec::new());
        assert_eq!(kinds(&notes.commands(&[0x80, 60, 0], &commands)).len(), 3, "release stops what the press started");
        assert!(matches!(notes.commands(&[0xb0, 64, 100], &commands)[..], [Command::Pedal { down: true, .. }]));
        assert!(notes.commands(&[0xb0, 1, 100], &commands).is_empty());
        assert!(notes.commands(&[0xf8], &commands).is_empty());
    }
}

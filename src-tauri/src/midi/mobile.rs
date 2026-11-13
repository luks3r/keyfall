use crate::audio::Commands;
use tauri::ipc::{Channel, Response};

const UNSUPPORTED: &str = "MIDI devices are not supported on mobile yet";

pub struct Midi {
    _unsupported: (),
}

pub fn input_names() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}

pub fn output_names() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}

impl Midi {
    pub fn new(_commands: Commands) -> Self {
        Self { _unsupported: () }
    }

    pub fn open_input(&self, name: Option<String>, _channel: Channel<Response>) -> Result<(), String> {
        name.map_or(Ok(()), |_| Err(UNSUPPORTED.into()))
    }

    pub fn open_output(&self, name: Option<String>) -> Result<(), String> {
        name.map_or(Ok(()), |_| Err(UNSUPPORTED.into()))
    }

    pub fn reserve(&self, _controls: Vec<(u8, u8)>) {}

    pub fn send(&self, _message: &[u8]) {}
}

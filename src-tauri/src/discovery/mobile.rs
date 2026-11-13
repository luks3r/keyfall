use super::Found;
use tauri::ipc::Channel;

/// LAN discovery needs a Wi-Fi multicast lock on Android and a local-network entitlement on iOS; not wired yet.
#[derive(Default)]
pub struct Discovery {
    _unsupported: (),
}

impl Discovery {
    pub fn advertise(&self, _name: &str, _port: u16) -> Result<(), String> {
        Ok(())
    }

    pub fn withdraw(&self) {}

    pub fn browse(&self, _found: Channel<Vec<Found>>) -> Result<(), String> {
        Ok(())
    }

    pub fn stop(&self) {}
}

use super::{Found, SERVICE};
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use std::collections::BTreeMap;
use std::sync::Mutex;
use tauri::ipc::Channel;

fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Advertises the local room server and browses for others on the LAN.
#[derive(Default)]
pub struct Discovery {
    advertised: Mutex<Option<(ServiceDaemon, String)>>,
    browsing: Mutex<Option<ServiceDaemon>>,
}

impl Discovery {
    pub fn advertise(&self, name: &str, port: u16) -> Result<(), String> {
        self.withdraw();
        let daemon = ServiceDaemon::new().map_err(error)?;
        let host = format!("keyfall-{port}.local.");
        let info = ServiceInfo::new(SERVICE, name, &host, (), port, &[("name", name)][..]).map_err(error)?.enable_addr_auto();
        let fullname = info.get_fullname().to_owned();
        daemon.register(info).map_err(error)?;
        *self.advertised.lock().map_err(error)? = Some((daemon, fullname));
        Ok(())
    }

    pub fn withdraw(&self) {
        if let Some((daemon, fullname)) = self.advertised.lock().ok().and_then(|mut slot| slot.take()) {
            let _ = daemon.unregister(&fullname);
            let _ = daemon.shutdown();
        }
    }

    pub fn browse(&self, found: Channel<Vec<Found>>) -> Result<(), String> {
        self.stop();
        let daemon = ServiceDaemon::new().map_err(error)?;
        let events = daemon.browse(SERVICE).map_err(error)?;
        *self.browsing.lock().map_err(error)? = Some(daemon);
        std::thread::spawn(move || {
            let mut hosts = BTreeMap::<String, Found>::new();
            while let Ok(event) = events.recv() {
                let changed = match event {
                    ServiceEvent::ServiceResolved(service) => {
                        let Some(ip) = service.get_addresses_v4().into_iter().find(|ip| !ip.is_loopback()) else { continue };
                        let name = service.get_property_val_str("name").unwrap_or("Keyfall").to_owned();
                        let entry = Found { name, url: format!("http://{ip}:{}", service.get_port()) };
                        hosts.insert(service.get_fullname().to_owned(), entry.clone()) != Some(entry)
                    }
                    ServiceEvent::ServiceRemoved(_, fullname) => hosts.remove(&fullname).is_some(),
                    ServiceEvent::SearchStopped(_) => break,
                    _ => false,
                };
                if changed && found.send(hosts.values().cloned().collect()).is_err() {
                    break;
                }
            }
        });
        Ok(())
    }

    pub fn stop(&self) {
        if let Some(daemon) = self.browsing.lock().ok().and_then(|mut slot| slot.take()) {
            let _ = daemon.stop_browse(SERVICE);
            let _ = daemon.shutdown();
        }
    }
}

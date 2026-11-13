use serde::Serialize;

#[cfg_attr(mobile, allow(dead_code))]
pub const SERVICE: &str = "_keyfall._tcp.local.";

#[derive(Serialize, Clone, PartialEq)]
pub struct Found {
    pub name: String,
    pub url: String,
}

#[cfg(desktop)]
mod desktop;
#[cfg(desktop)]
pub use desktop::*;

#[cfg(mobile)]
mod mobile;
#[cfg(mobile)]
pub use mobile::*;

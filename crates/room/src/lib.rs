//! Keyfall room server: many rooms per server, one protocol for public servers and personal hosts.
//! The wire format is specified in `PROTOCOL.md`.

pub mod protocol;
mod server;

pub use server::Config;

use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{ConnectInfo, State};
use axum::http::{header, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::serve::ListenerExt;
use axum::Router;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use tokio::net::TcpListener;

pub const DEFAULT_PORT: u16 = 7777;
pub const HEALTH: &str = "keyfall-room";

const MAX_FRAME_BYTES: usize = 2 << 20;

pub trait Assets: Send + Sync + 'static {
    fn get(&self, path: &str) -> Option<(Vec<u8>, String)>;
}

pub struct NoAssets;

impl Assets for NoAssets {
    fn get(&self, _: &str) -> Option<(Vec<u8>, String)> {
        None
    }
}

pub struct DirAssets(pub PathBuf);

impl Assets for DirAssets {
    fn get(&self, path: &str) -> Option<(Vec<u8>, String)> {
        let relative = Path::new(path.trim_start_matches('/'));
        if relative.components().any(|c| !matches!(c, Component::Normal(_))) {
            return None;
        }
        let file = self.0.join(relative);
        let bytes = std::fs::read(&file).ok()?;
        Some((bytes, mime_guess::from_path(&file).first_or_octet_stream().to_string()))
    }
}

#[derive(Clone)]
struct App {
    server: Arc<server::Server>,
    assets: Arc<dyn Assets>,
}

/// `http://<lan-ip>:<port>` for every non-loopback IPv4 interface, so clients can build invite links.
pub fn lan_urls(port: u16) -> Vec<String> {
    let mut ips: Vec<Ipv4Addr> = local_ip_address::list_afinet_netifas()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(_, ip)| match ip {
            IpAddr::V4(v4) if !v4.is_loopback() && !v4.is_link_local() => Some(v4),
            _ => None,
        })
        .collect();
    ips.sort_by_key(|ip| (lan_rank(*ip), *ip));
    ips.dedup();
    ips.into_iter().map(|ip| format!("http://{ip}:{port}")).collect()
}

/// Home Wi-Fi ranges first; VPN / carrier-grade NAT addresses (e.g. Tailscale's 100.64/10) last.
fn lan_rank(ip: Ipv4Addr) -> u8 {
    match ip.octets() {
        [192, 168, ..] => 0,
        [10, ..] => 1,
        [172, b, ..] if (16..32).contains(&b) => 2,
        _ => 3,
    }
}

pub async fn serve(listener: TcpListener, assets: Arc<dyn Assets>, config: Config) -> std::io::Result<()> {
    let urls = lan_urls(listener.local_addr()?.port());
    let app = App { server: Arc::new(server::Server::new(config, urls)), assets };
    let router = Router::new()
        .route("/ws", get(upgrade))
        .route("/health", get(|| async { HEALTH }))
        .fallback(get(static_file))
        .with_state(app);
    let listener = listener.tap_io(|tcp| {
        if let Err(e) = tcp.set_nodelay(true) {
            eprintln!("TCP_NODELAY: {e}");
        }
    });
    axum::serve(listener, router.into_make_service_with_connect_info::<SocketAddr>()).await
}

/// Cross-origin isolation lets the web client share memory with its audio thread.
const ISOLATION: [(&str, &str); 2] =
    [("cross-origin-opener-policy", "same-origin"), ("cross-origin-embedder-policy", "require-corp")];

async fn static_file(State(app): State<App>, uri: Uri) -> Response {
    let path = match uri.path() {
        "/" => "/index.html",
        path => path,
    };
    match app.assets.get(path).or_else(|| app.assets.get("/index.html")) {
        Some((bytes, mime)) => ([(header::CONTENT_TYPE.as_str(), mime.as_str()), ISOLATION[0], ISOLATION[1]], bytes).into_response(),
        None => (StatusCode::NOT_FOUND, "keyfall room server: no web app bundled").into_response(),
    }
}

async fn upgrade(ws: WebSocketUpgrade, State(app): State<App>, ConnectInfo(address): ConnectInfo<SocketAddr>) -> Response {
    ws.max_message_size(MAX_FRAME_BYTES).on_upgrade(move |socket| server::session(socket, app.server, address.ip()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_home_lan_over_vpn_addresses() {
        let mut ips = [Ipv4Addr::new(100, 76, 148, 17), Ipv4Addr::new(10, 0, 0, 2), Ipv4Addr::new(192, 168, 1, 236)];
        ips.sort_by_key(|ip| (lan_rank(*ip), *ip));
        assert_eq!(ips[0], Ipv4Addr::new(192, 168, 1, 236));
        assert_eq!(ips[2], Ipv4Addr::new(100, 76, 148, 17));
    }
}

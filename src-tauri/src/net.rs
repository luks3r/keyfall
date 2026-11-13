use crate::audio::{Command, Commands};
use futures_util::{SinkExt, StreamExt};
use keyfall_room::protocol::{relayed_note, Note};
use keyfall_room::Assets;
use serde::Serialize;
pub use tokio_tungstenite::tungstenite::Message as SocketMessage;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::async_runtime::JoinHandle;
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Wry};
use tokio::net::TcpListener;
use tokio::sync::mpsc::{self, UnboundedSender};
use tokio_tungstenite::tungstenite::Message;

struct BundledAssets(AppHandle<Wry>);

impl Assets for BundledAssets {
    fn get(&self, path: &str) -> Option<(Vec<u8>, String)> {
        let asset = self.0.asset_resolver().get(path.to_owned())?;
        Some((asset.bytes, asset.mime_type))
    }
}

#[derive(Serialize, Clone)]
pub struct HostInfo {
    pub port: u16,
    urls: Vec<String>,
}

#[derive(Default)]
pub struct Host(Mutex<Option<(HostInfo, JoinHandle<()>)>>);

impl Host {
    pub async fn start(&self, app: AppHandle<Wry>, port: u16, name: &str) -> Result<HostInfo, String> {
        if let Some((info, _)) = self.0.lock().map_err(|e| e.to_string())?.as_ref() {
            return Ok(info.clone());
        }
        let listener = TcpListener::bind(("0.0.0.0", port)).await.map_err(|e| format!("port {port}: {e}"))?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let config = keyfall_room::Config::personal(name);
        let task = tauri::async_runtime::spawn(async move {
            if let Err(e) = keyfall_room::serve(listener, Arc::new(BundledAssets(app)), config).await {
                eprintln!("room server: {e}");
            }
        });
        let info = HostInfo { port, urls: keyfall_room::lan_urls(port) };
        *self.0.lock().map_err(|e| e.to_string())? = Some((info.clone(), task));
        Ok(info)
    }

    pub fn info(&self) -> Option<HostInfo> {
        self.0.lock().ok()?.as_ref().map(|(info, _)| info.clone())
    }

    pub fn stop(&self) {
        if let Ok(mut slot) = self.0.lock()
            && let Some((_, task)) = slot.take()
        {
            task.abort();
        }
    }
}

/// Socket events reach the webview as raw frames: `[0][utf-8 text]`, `[1][binary]`, `[2]` (closed),
/// or `[3][binary]` for a relayed note this side already played. Mirrored in `src/lib/platform/native.ts`.
const TEXT: u8 = 0;
const BINARY: u8 = 1;
const CLOSED: u8 = 2;
const PLAYED: u8 = 3;

/// Peer id to audio channel; the webview assigns channels and their instruments.
type Routes = Arc<Mutex<HashMap<u16, usize>>>;

fn command(channel: usize, note: Note) -> Command {
    match note {
        Note::On { midi, velocity } => Command::KeyOn { channel, midi, velocity },
        Note::Off { midi } => Command::KeyOff { channel, midi },
        Note::Sustain(down) => Command::Pedal { channel, down },
    }
}

/// Plays a relayed note on its peer's channel; returns whether it sounded.
fn play(frame: &[u8], routes: &Routes, commands: &Commands) -> bool {
    let Some((from, note)) = relayed_note(frame) else { return false };
    let Some(channel) = routes.lock().ok().and_then(|routes| routes.get(&from).copied()) else { return false };
    commands.play(command(channel, note))
}

fn tagged(tag: u8, payload: &[u8]) -> Response {
    let mut frame = Vec::with_capacity(payload.len() + 1);
    frame.push(tag);
    frame.extend_from_slice(payload);
    Response::new(frame)
}

struct Socket {
    tx: UnboundedSender<Option<Message>>,
    routes: Routes,
}

pub struct Sockets {
    commands: Commands,
    next: AtomicU32,
    open: Mutex<HashMap<u32, Socket>>,
}

impl Sockets {
    pub fn new(commands: Commands) -> Self {
        Self { commands, next: AtomicU32::default(), open: Mutex::default() }
    }

    pub async fn open(&self, url: &str, events: Channel<Response>) -> Result<u32, String> {
        let (stream, _) = tokio_tungstenite::connect_async_with_config(url, None, true).await.map_err(|e| e.to_string())?;
        let (mut sink, mut source) = stream.split();
        let (tx, mut rx) = mpsc::unbounded_channel::<Option<Message>>();
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let routes = Routes::default();
        self.open.lock().map_err(|e| e.to_string())?.insert(id, Socket { tx, routes: routes.clone() });
        let commands = self.commands.clone();

        tauri::async_runtime::spawn(async move {
            while let Some(Some(message)) = rx.recv().await {
                if sink.send(message).await.is_err() {
                    break;
                }
            }
            let _ = sink.close().await;
        });
        tauri::async_runtime::spawn(async move {
            while let Some(Ok(message)) = source.next().await {
                let frame = match &message {
                    Message::Text(text) => tagged(TEXT, text.as_bytes()),
                    Message::Binary(bytes) => tagged(if play(bytes, &routes, &commands) { PLAYED } else { BINARY }, bytes),
                    _ => continue,
                };
                let _ = events.send(frame);
            }
            let _ = events.send(tagged(CLOSED, &[]));
        });
        Ok(id)
    }

    pub fn send(&self, id: u32, message: Message) {
        if let Some(socket) = self.open.lock().ok().as_ref().and_then(|open| open.get(&id)) {
            let _ = socket.tx.send(Some(message));
        }
    }

    pub fn route(&self, id: u32, peer: u16, channel: Option<usize>) {
        let Some(routes) = self.open.lock().ok().and_then(|open| open.get(&id).map(|socket| socket.routes.clone())) else { return };
        let Ok(mut routes) = routes.lock() else { return };
        match channel {
            Some(channel) => routes.insert(peer, channel),
            None => routes.remove(&peer),
        };
    }

    pub fn close(&self, id: u32) {
        if let Some(socket) = self.open.lock().ok().and_then(|mut open| open.remove(&id)) {
            let _ = socket.tx.send(None);
        }
    }
}

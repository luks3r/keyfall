use crate::protocol::{self, blob, error, event, VERSION};
use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::net::IpAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc::{self, UnboundedSender};

const CODE_CHARS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN: usize = 5;
const MAX_CODE_LEN: usize = 12;
const MAX_NAME_LEN: usize = 40;
const TOKEN_LEN: std::ops::RangeInclusive<usize> = 16..=128;
const TAG_BYTES: usize = 3;
const HOST_KEYS: [&str; 2] = ["song", "transport"];
const PROFILE_KEY: &str = "profile";

/// What a server allows. A personal host is a server with `max_rooms: 1`.
#[derive(Clone, Debug)]
pub struct Config {
    pub name: String,
    pub max_rooms: usize,
    pub rooms_per_ip: usize,
    pub grace: Duration,
    pub max_blob: usize,
    pub blob_budget: usize,
    pub messages_per_second: f64,
}

impl Config {
    pub fn public(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            max_rooms: 500,
            rooms_per_ip: 4,
            grace: Duration::from_secs(60),
            max_blob: 1 << 20,
            blob_budget: 64 << 20,
            messages_per_second: 200.,
        }
    }

    pub fn personal(name: impl Into<String>) -> Self {
        Self { max_rooms: 1, rooms_per_ip: 1, blob_budget: 16 << 20, ..Self::public(name) }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct Identity([u8; 32]);

impl Identity {
    fn from_token(token: &str) -> Self {
        Self(Sha256::digest(token.as_bytes()).into())
    }

    fn tag(&self) -> String {
        protocol::hex(&self.0[..TAG_BYTES])
    }
}

struct Peer {
    tx: UnboundedSender<Message>,
    identity: Identity,
    profile: Value,
}

impl Peer {
    fn seated(&self) -> bool {
        !self.profile["seat"].is_null()
    }

    fn send(&self, message: &Value) {
        let _ = self.tx.send(Message::Text(message.to_string().into()));
    }
}

struct Room {
    name: String,
    public: bool,
    pin: Option<String>,
    max_players: Option<usize>,
    owner: Identity,
    creator_ip: IpAddr,
    host: u16,
    next_peer: u16,
    peers: BTreeMap<u16, Peer>,
    banned: HashSet<Identity>,
    state: Map<String, Value>,
    generation: u64,
}

impl Room {
    fn broadcast(&self, message: &Value, except: u16) {
        let text: axum::extract::ws::Utf8Bytes = message.to_string().into();
        for (id, peer) in &self.peers {
            if *id != except {
                let _ = peer.tx.send(Message::Text(text.clone()));
            }
        }
    }

    fn broadcast_binary(&self, frame: Vec<u8>, except: u16) {
        let bytes = axum::body::Bytes::from(frame);
        for (id, peer) in &self.peers {
            if *id != except {
                let _ = peer.tx.send(Message::Binary(bytes.clone()));
            }
        }
    }

    fn seated(&self) -> usize {
        self.peers.values().filter(|peer| peer.seated()).count()
    }

    fn summary(&self, code: &str) -> Value {
        let host = self.peers.get(&self.host).map(|peer| peer.profile["name"].clone()).unwrap_or_default();
        json!({
            "code": code,
            "name": self.name,
            "host": host,
            "players": self.seated(),
            "spectators": self.peers.len() - self.seated(),
            "maxPlayers": self.max_players,
            "locked": self.pin.is_some(),
            "mode": self.state.get("transport").map(|t| t["mode"].clone()),
            "song": self.state.get("song").map(|s| s["name"].clone()),
        })
    }
}

#[derive(Default)]
struct Blobs {
    data: HashMap<[u8; 32], Arc<[u8]>>,
    order: VecDeque<[u8; 32]>,
    bytes: usize,
}

impl Blobs {
    fn insert(&mut self, data: &[u8], budget: usize) -> [u8; 32] {
        let hash: [u8; 32] = Sha256::digest(data).into();
        if self.data.contains_key(&hash) {
            return hash;
        }
        while self.bytes + data.len() > budget {
            let Some(oldest) = self.order.pop_front() else { break };
            if let Some(evicted) = self.data.remove(&oldest) {
                self.bytes -= evicted.len();
            }
        }
        self.bytes += data.len();
        self.order.push_back(hash);
        self.data.insert(hash, data.into());
        hash
    }
}

pub(crate) struct Server {
    config: Config,
    rooms: Mutex<HashMap<String, Room>>,
    blobs: Mutex<Blobs>,
    urls: Vec<String>,
    counter: AtomicU64,
}

fn now_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64() * 1000.).unwrap_or_default()
}

fn clean_code(raw: &str) -> String {
    raw.chars().filter(char::is_ascii_alphanumeric).take(MAX_CODE_LEN).collect::<String>().to_ascii_uppercase()
}

fn clean_name(raw: &str) -> String {
    raw.trim().chars().take(MAX_NAME_LEN).collect()
}

impl Server {
    pub(crate) fn new(config: Config, urls: Vec<String>) -> Self {
        Self { config, rooms: Mutex::default(), blobs: Mutex::default(), urls, counter: AtomicU64::new(0) }
    }

    fn info(&self) -> Value {
        let rooms = self.rooms.lock().expect("rooms lock").len();
        json!({
            "t": "info",
            "v": VERSION,
            "name": self.config.name,
            "caps": { "maxRooms": self.config.max_rooms, "rooms": rooms, "maxBlob": self.config.max_blob, "events": true },
            "urls": self.urls,
            "now": now_ms(),
        })
    }

    fn list(&self) -> Value {
        let rooms = self.rooms.lock().expect("rooms lock");
        let mut list: Vec<Value> = rooms.iter().filter(|(_, room)| room.public).map(|(code, room)| room.summary(code)).collect();
        list.sort_by(|a, b| a["code"].as_str().cmp(&b["code"].as_str()));
        json!({ "t": "rooms", "rooms": list })
    }

    fn new_code(&self, rooms: &HashMap<String, Room>, seed: &Identity) -> String {
        loop {
            let mut hasher = Sha256::new();
            hasher.update(self.counter.fetch_add(1, Ordering::Relaxed).to_le_bytes());
            hasher.update(now_ms().to_le_bytes());
            hasher.update(seed.0);
            let digest = hasher.finalize();
            let code: String = digest.iter().take(CODE_LEN).map(|b| CODE_CHARS[*b as usize % CODE_CHARS.len()] as char).collect();
            if !rooms.contains_key(&code) {
                return code;
            }
        }
    }

    fn schedule_cleanup(self: &Arc<Self>, code: String, generation: u64) {
        let server = Arc::clone(self);
        tokio::spawn(async move {
            tokio::time::sleep(server.config.grace).await;
            let mut rooms = server.rooms.lock().expect("rooms lock");
            if rooms.get(&code).is_some_and(|room| room.peers.is_empty() && room.generation == generation) {
                rooms.remove(&code);
            }
        });
    }
}

struct Bucket {
    tokens: f64,
    rate: f64,
    last: Instant,
}

impl Bucket {
    fn new(rate: f64) -> Self {
        Self { tokens: rate * 2., rate, last: Instant::now() }
    }

    fn take(&mut self) -> bool {
        let now = Instant::now();
        self.tokens = (self.tokens + now.duration_since(self.last).as_secs_f64() * self.rate).min(self.rate * 2.);
        self.last = now;
        let allowed = self.tokens >= 1.;
        if allowed {
            self.tokens -= 1.;
        }
        allowed
    }
}

struct Connection {
    server: Arc<Server>,
    tx: UnboundedSender<Message>,
    ip: IpAddr,
    identity: Option<Identity>,
    room: Option<(String, u16)>,
    closed: bool,
}

impl Connection {
    fn send(&self, message: &Value) {
        let _ = self.tx.send(Message::Text(message.to_string().into()));
    }

    fn fail(&mut self, code: &str, message: &str, close: bool) {
        self.send(&json!({ "t": "error", "code": code, "message": message }));
        if close {
            self.closed = true;
        }
    }

    fn text(&mut self, text: &str) {
        let Ok(message) = serde_json::from_str::<Value>(text) else { return self.fail(error::PROTOCOL, "invalid JSON", false) };
        let kind = message["t"].as_str().unwrap_or_default();

        let Some(identity) = self.identity else {
            if kind != "hello" {
                return self.fail(error::PROTOCOL, "send hello first", true);
            }
            if message["v"].as_u64() != Some(VERSION.into()) {
                return self.fail(error::VERSION, &format!("server speaks protocol v{VERSION}"), true);
            }
            let token = message["token"].as_str().unwrap_or_default();
            if !TOKEN_LEN.contains(&token.len()) {
                return self.fail(error::PROTOCOL, "token must be 16-128 characters", true);
            }
            self.identity = Some(Identity::from_token(token));
            return self.send(&self.server.info());
        };

        match (kind, self.room.clone()) {
            ("list", _) => self.send(&self.server.list()),
            ("info", _) => self.send(&self.server.info()),
            ("ping", _) => self.send(&json!({ "t": "pong", "c": message["c"], "s": now_ms() })),
            ("create", None) => self.create(identity, &message),
            ("join", None) => self.join(identity, &message),
            ("create" | "join", Some(_)) => self.fail(error::PROTOCOL, "already in a room", false),
            (_, None) => self.fail(error::PROTOCOL, "join a room first", false),
            ("set", Some((code, id))) => self.set(&code, id, &message),
            ("say", Some((code, id))) => self.with_room(&code, |room| room.broadcast(&json!({ "t": "say", "from": id, "value": message["value"] }), id)),
            ("get", Some(_)) => self.get(&message),
            ("kick", Some((code, id))) => self.kick(&code, id, &message),
            _ => self.fail(error::PROTOCOL, "unknown message", false),
        }
    }

    fn binary(&mut self, frame: &[u8]) {
        let Some((code, id)) = self.room.clone() else { return };
        match frame.first().copied() {
            Some(blob::PUT) => {
                let data = &frame[1..];
                if data.len() > self.server.config.max_blob {
                    return self.fail(error::TOO_LARGE, "blob over server limit", false);
                }
                let hash = self.server.blobs.lock().expect("blobs lock").insert(data, self.server.config.blob_budget);
                self.send(&json!({ "t": "stored", "hash": protocol::hex(&hash) }));
            }
            Some(kind) if (event::NOTE_ON..=event::LAST).contains(&kind) => {
                let Some(relayed) = protocol::relay_event(frame, id) else { return };
                self.with_room(&code, |room| {
                    if room.peers.get(&id).is_some_and(Peer::seated) {
                        room.broadcast_binary(relayed, id);
                    }
                });
            }
            _ => {}
        }
    }

    fn with_room(&self, code: &str, action: impl FnOnce(&mut Room)) {
        if let Some(room) = self.server.rooms.lock().expect("rooms lock").get_mut(code) {
            action(room);
        }
    }

    fn create(&mut self, identity: Identity, message: &Value) {
        let config = &self.server.config;
        let mut rooms = self.server.rooms.lock().expect("rooms lock");
        if rooms.len() >= config.max_rooms {
            drop(rooms);
            return self.fail(error::LIMIT, "server room limit reached", false);
        }
        if rooms.values().filter(|room| room.creator_ip == self.ip).count() >= config.rooms_per_ip {
            drop(rooms);
            return self.fail(error::LIMIT, "too many rooms from this address", false);
        }
        let code = self.server.new_code(&rooms, &identity);
        let options = &message["room"];
        let room = Room {
            name: clean_name(options["name"].as_str().unwrap_or_default()),
            public: options["public"].as_bool().unwrap_or(true),
            pin: options["pin"].as_str().filter(|pin| !pin.is_empty()).map(str::to_owned),
            max_players: options["maxPlayers"].as_u64().map(|n| n as usize),
            owner: identity,
            creator_ip: self.ip,
            host: 0,
            next_peer: 0,
            peers: BTreeMap::new(),
            banned: HashSet::new(),
            state: Map::new(),
            generation: 0,
        };
        rooms.insert(code.clone(), room);
        drop(rooms);
        self.enter(identity, &code, &message["profile"]);
    }

    fn join(&mut self, identity: Identity, message: &Value) {
        let code = clean_code(message["code"].as_str().unwrap_or_default());
        let check = {
            let rooms = self.server.rooms.lock().expect("rooms lock");
            match rooms.get(&code) {
                None => Err((error::NOT_FOUND, "no such room")),
                Some(room) if room.banned.contains(&identity) => Err((error::BANNED, "you were removed from this room")),
                Some(room) if room.pin.as_deref().is_some_and(|pin| message["pin"].as_str() != Some(pin)) => Err((error::PIN, "wrong or missing PIN")),
                Some(_) => Ok(()),
            }
        };
        match check {
            Ok(()) => self.enter(identity, &code, &message["profile"]),
            Err((code, text)) => self.fail(code, text, false),
        }
    }

    fn enter(&mut self, identity: Identity, code: &str, profile: &Value) {
        let mut rooms = self.server.rooms.lock().expect("rooms lock");
        let Some(room) = rooms.get_mut(code) else { return };
        let id = room.next_peer;
        room.next_peer = room.next_peer.wrapping_add(1);
        room.generation += 1;
        let mut profile = profile.clone();
        if room.max_players.is_some_and(|max| room.seated() >= max) && !profile["seat"].is_null() {
            profile["seat"] = Value::Null;
        }
        if room.peers.is_empty() || identity == room.owner {
            room.host = id;
        }
        let peers: Vec<Value> = room.peers.iter().map(|(id, peer)| json!({ "id": id, "tag": peer.identity.tag(), "profile": peer.profile })).collect();
        let welcome = json!({
            "t": "welcome",
            "you": id,
            "tag": identity.tag(),
            "host": room.host,
            "owner": identity == room.owner,
            "room": { "code": code, "name": room.name, "public": room.public, "locked": room.pin.is_some(), "maxPlayers": room.max_players },
            "peers": peers,
            "state": room.state,
            "profile": profile,
            "now": now_ms(),
            "urls": self.server.urls,
        });
        self.send(&welcome);
        room.broadcast(&json!({ "t": "join", "id": id, "tag": identity.tag(), "profile": profile }), id);
        if room.host == id && !room.peers.is_empty() {
            room.broadcast(&json!({ "t": "host", "id": id }), id);
        }
        room.peers.insert(id, Peer { tx: self.tx.clone(), identity, profile });
        self.room = Some((code.to_owned(), id));
    }

    fn set(&mut self, code: &str, id: u16, message: &Value) {
        let Some(key) = message["key"].as_str() else { return };
        let value = message["value"].clone();
        let mut rooms = self.server.rooms.lock().expect("rooms lock");
        let Some(room) = rooms.get_mut(code) else { return };
        if key == PROFILE_KEY {
            let wants_seat = !value["seat"].is_null();
            let seated = room.peers.get(&id).is_some_and(Peer::seated);
            if wants_seat && !seated && room.max_players.is_some_and(|max| room.seated() >= max) {
                drop(rooms);
                return self.fail(error::FULL, "all player seats are taken", false);
            }
            if let Some(peer) = room.peers.get_mut(&id) {
                peer.profile = value.clone();
            }
        } else if HOST_KEYS.contains(&key) {
            if room.host != id {
                drop(rooms);
                return self.fail(error::FORBIDDEN, "only the host can change this", false);
            }
            room.state.insert(key.to_owned(), value.clone());
        } else {
            return;
        }
        room.broadcast(&json!({ "t": "set", "from": id, "key": key, "value": value }), id);
    }

    fn get(&mut self, message: &Value) {
        let Some(hash) = message["hash"].as_str().and_then(protocol::parse_hex::<{ blob::HASH_LEN }>) else {
            return self.fail(error::PROTOCOL, "hash must be 64 hex characters", false);
        };
        let data = self.server.blobs.lock().expect("blobs lock").data.get(&hash).cloned();
        match data {
            Some(data) => {
                let _ = self.tx.send(Message::Binary(protocol::blob_frame(&hash, &data).into()));
            }
            None => self.fail(error::NOT_FOUND, "blob not stored on this server", false),
        }
    }

    fn kick(&mut self, code: &str, id: u16, message: &Value) {
        let Some(target) = message["id"].as_u64().and_then(|t| u16::try_from(t).ok()) else { return };
        let mut rooms = self.server.rooms.lock().expect("rooms lock");
        let Some(room) = rooms.get_mut(code) else { return };
        if room.host != id || target == id {
            drop(rooms);
            return self.fail(error::FORBIDDEN, "only the host can remove others", false);
        }
        let Some(peer) = room.peers.remove(&target) else { return };
        room.banned.insert(peer.identity);
        peer.send(&json!({ "t": "error", "code": error::BANNED, "message": "you were removed from this room" }));
        let _ = peer.tx.send(Message::Close(None));
        room.broadcast(&json!({ "t": "leave", "id": target }), target);
    }

    fn leave(&mut self) {
        let Some((code, id)) = self.room.take() else { return };
        let mut rooms = self.server.rooms.lock().expect("rooms lock");
        let Some(room) = rooms.get_mut(&code) else { return };
        if room.peers.remove(&id).is_none() {
            return;
        }
        if room.peers.is_empty() {
            room.generation += 1;
            let generation = room.generation;
            drop(rooms);
            return self.server.schedule_cleanup(code, generation);
        }
        room.broadcast(&json!({ "t": "leave", "id": id }), id);
        if room.host == id {
            room.host = *room.peers.keys().next().expect("non-empty room");
            room.broadcast(&json!({ "t": "host", "id": room.host }), u16::MAX);
        }
    }
}

pub(crate) async fn session(socket: WebSocket, server: Arc<Server>, ip: IpAddr) {
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    let writer = tokio::spawn(async move {
        while let Some(message) = rx.recv().await {
            let closing = matches!(message, Message::Close(_));
            if sink.send(message).await.is_err() || closing {
                break;
            }
        }
    });

    let mut bucket = Bucket::new(server.config.messages_per_second);
    let mut connection = Connection { server, tx, ip, identity: None, room: None, closed: false };
    while let Some(Ok(message)) = stream.next().await {
        if !bucket.take() {
            continue;
        }
        match message {
            Message::Text(text) => connection.text(&text),
            Message::Binary(frame) => connection.binary(&frame),
            // Keep reading: the next poll flushes tungstenite's automatic close reply, then the stream ends.
            _ => {}
        }
        if connection.closed {
            break;
        }
    }
    let _ = connection.tx.send(Message::Close(None));
    connection.leave();
    drop(connection);
    let _ = writer.await;
}

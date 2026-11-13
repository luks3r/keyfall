use futures_util::{SinkExt, StreamExt};
use keyfall_room::protocol::{blob, event, VERSION};
use keyfall_room::{serve, Config, NoAssets};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

type Client = WebSocketStream<MaybeTlsStream<TcpStream>>;

const GRACE: Duration = Duration::from_millis(150);

async fn start(config: Config) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("ws://{}/ws", listener.local_addr().unwrap());
    tokio::spawn(serve(listener, Arc::new(NoAssets), Config { grace: GRACE, ..config }));
    url
}

async fn send(client: &mut Client, value: Value) {
    client.send(Message::text(value.to_string())).await.unwrap();
}

async fn next(client: &mut Client) -> Message {
    loop {
        let message = tokio::time::timeout(Duration::from_secs(2), client.next()).await.expect("message in time").unwrap().unwrap();
        if matches!(message, Message::Text(_) | Message::Binary(_)) {
            return message;
        }
    }
}

async fn recv(client: &mut Client) -> Value {
    match next(client).await {
        Message::Text(text) => serde_json::from_str(&text).unwrap(),
        other => panic!("expected JSON, got {other:?}"),
    }
}

async fn connect(url: &str, token: &str) -> Client {
    let (mut client, _) = connect_async(url).await.unwrap();
    send(&mut client, json!({ "t": "hello", "v": VERSION, "token": format!("{token}-0123456789") })).await;
    let info = recv(&mut client).await;
    assert_eq!(info["t"], "info");
    client
}

async fn create(url: &str, token: &str, room: Value) -> (Client, Value) {
    let mut client = connect(url, token).await;
    send(&mut client, json!({ "t": "create", "room": room, "profile": { "name": token, "seat": 0 } })).await;
    let welcome = recv(&mut client).await;
    assert_eq!(welcome["t"], "welcome", "{welcome}");
    (client, welcome)
}

async fn join_room(url: &str, token: &str, code: &Value, extra: Value) -> (Client, Value) {
    let mut client = connect(url, token).await;
    let mut message = json!({ "t": "join", "code": code, "profile": { "name": token, "seat": 1 } });
    message.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    send(&mut client, message).await;
    let reply = recv(&mut client).await;
    (client, reply)
}

#[tokio::test]
async fn rejects_wrong_version_and_missing_hello() {
    let url = start(Config::public("test")).await;
    let (mut client, _) = connect_async(&url).await.unwrap();
    send(&mut client, json!({ "t": "hello", "v": 99, "token": "0123456789abcdef" })).await;
    assert_eq!(recv(&mut client).await["code"], "version");

    let (mut client, _) = connect_async(&url).await.unwrap();
    send(&mut client, json!({ "t": "list" })).await;
    assert_eq!(recv(&mut client).await["code"], "protocol");
}

#[tokio::test]
async fn creates_lists_and_joins_rooms() {
    let url = start(Config::public("test")).await;
    let (mut host, welcome) = create(&url, "host-token-0001", json!({ "name": "Jam", "public": true })).await;
    let code = welcome["room"]["code"].clone();
    assert_eq!(welcome["room"]["name"], "Jam");
    assert_eq!(welcome["host"], welcome["you"]);
    assert_eq!(welcome["owner"], true);
    send(&mut host, json!({ "t": "set", "key": "song", "value": { "name": "Ode", "hash": "00" } })).await;

    let (_hidden, _) = create(&url, "other-token-0001", json!({ "name": "Secret", "public": false })).await;

    let mut lobby = connect(&url, "lobby-token-0001").await;
    send(&mut lobby, json!({ "t": "list" })).await;
    let rooms = recv(&mut lobby).await["rooms"].clone();
    assert_eq!(rooms.as_array().unwrap().len(), 1, "unlisted rooms stay hidden: {rooms}");
    assert_eq!(rooms[0]["name"], "Jam");
    assert_eq!(rooms[0]["players"], 1);
    assert_eq!(rooms[0]["song"], "Ode");

    send(&mut lobby, json!({ "t": "join", "code": "NOPE1" })).await;
    assert_eq!(recv(&mut lobby).await["code"], "not_found", "typos never create rooms");

    let (_guest, welcome) = join_room(&url, "guest-token-0001", &code, json!({})).await;
    assert_eq!(welcome["t"], "welcome");
    assert_eq!(welcome["peers"][0]["profile"]["name"], "host-token-0001");
    assert_eq!(welcome["state"]["song"]["name"], "Ode");
    let joined = recv(&mut host).await;
    assert_eq!((joined["t"].as_str(), joined["profile"]["name"].as_str()), (Some("join"), Some("guest-token-0001")));
}

#[tokio::test]
async fn relays_binary_events_from_seated_peers_only() {
    let url = start(Config::public("test")).await;
    let (mut host, welcome) = create(&url, "host-token-0002", json!({})).await;
    let code = welcome["room"]["code"].clone();
    let host_id = welcome["you"].as_u64().unwrap() as u16;
    let (mut guest, _) = join_room(&url, "guest-token-0002", &code, json!({ "profile": { "name": "g", "seat": null } })).await;
    recv(&mut host).await;

    host.send(Message::binary(vec![event::NOTE_ON, 60, 100, 0x10, 0x00])).await.unwrap();
    let mut expected = vec![event::NOTE_ON];
    expected.extend(host_id.to_le_bytes());
    expected.extend([60, 100, 0x10, 0x00]);
    assert_eq!(next(&mut guest).await, Message::binary(expected));

    guest.send(Message::binary(vec![event::NOTE_ON, 61, 100, 0, 0])).await.unwrap();
    send(&mut host, json!({ "t": "ping", "c": 1 })).await;
    assert_eq!(recv(&mut host).await["t"], "pong", "spectator note must not be relayed");
}

#[tokio::test]
async fn finds_rooms_by_code_and_throttles_guessing() {
    let url = start(Config { misses_per_minute: 3, ..Config::public("test") }).await;
    let (_host, welcome) = create(&url, "host-token-0009", json!({ "name": "Hidden", "public": false, "pin": "1234" })).await;
    let code = welcome["room"]["code"].clone();

    let mut seeker = connect(&url, "seek-token-0009").await;
    send(&mut seeker, json!({ "t": "find", "code": code })).await;
    let found = recv(&mut seeker).await;
    assert_eq!(found["t"], "found");
    assert_eq!(found["room"]["name"], "Hidden", "hidden rooms are found by their exact code");
    assert_eq!(found["room"]["locked"], true);
    assert!(found["room"].get("pin").is_none(), "the PIN never leaves the server");

    for _ in 0..3 {
        send(&mut seeker, json!({ "t": "find", "code": "ZZZZZ" })).await;
        assert_eq!(recv(&mut seeker).await["room"], Value::Null);
    }
    send(&mut seeker, json!({ "t": "find", "code": code })).await;
    assert_eq!(recv(&mut seeker).await["code"], "too_many", "after the misses even real codes wait");
    send(&mut seeker, json!({ "t": "join", "code": code, "pin": "1234", "profile": { "name": "s", "seat": null } })).await;
    assert_eq!(recv(&mut seeker).await["code"], "too_many", "joining is throttled too");
}

#[tokio::test]
async fn enforces_pin_seats_and_host_rights() {
    let url = start(Config::public("test")).await;
    let (_host, welcome) = create(&url, "host-token-0003", json!({ "pin": "4321", "maxPlayers": 1 })).await;
    let code = welcome["room"]["code"].clone();

    let (_, reply) = join_room(&url, "guest-token-0003", &code, json!({ "pin": "0000" })).await;
    assert_eq!(reply["code"], "pin");

    let (mut guest, welcome) = join_room(&url, "guest-token-0003", &code, json!({ "pin": "4321" })).await;
    assert_eq!(welcome["profile"]["seat"], Value::Null, "full room seats the joiner as spectator");

    send(&mut guest, json!({ "t": "set", "key": "profile", "value": { "name": "g", "seat": 1 } })).await;
    assert_eq!(recv(&mut guest).await["code"], "full");
    send(&mut guest, json!({ "t": "set", "key": "song", "value": {} })).await;
    assert_eq!(recv(&mut guest).await["code"], "forbidden");
}

#[tokio::test]
async fn kicked_peers_are_banned() {
    let url = start(Config::public("test")).await;
    let (mut host, welcome) = create(&url, "host-token-0004", json!({})).await;
    let code = welcome["room"]["code"].clone();
    let (mut guest, welcome) = join_room(&url, "guest-token-0004", &code, json!({})).await;
    recv(&mut host).await;

    send(&mut host, json!({ "t": "kick", "id": welcome["you"] })).await;
    assert_eq!(recv(&mut guest).await["code"], "banned");
    let (_, reply) = join_room(&url, "guest-token-0004", &code, json!({})).await;
    assert_eq!(reply["code"], "banned");
}

#[tokio::test]
async fn owner_reclaims_host_and_empty_rooms_expire_after_grace() {
    let url = start(Config::public("test")).await;
    let (mut owner, welcome) = create(&url, "owner-token-0005", json!({})).await;
    let code = welcome["room"]["code"].clone();
    let (mut guest, guest_welcome) = join_room(&url, "guest-token-0005", &code, json!({})).await;

    owner.close(None).await.unwrap();
    assert_eq!(recv(&mut guest).await["t"], "leave");
    assert_eq!(recv(&mut guest).await, json!({ "t": "host", "id": guest_welcome["you"] }));

    let (_owner, welcome) = join_room(&url, "owner-token-0005", &code, json!({})).await;
    assert_eq!(welcome["host"], welcome["you"], "owner gets host back");
    recv(&mut guest).await;
    assert_eq!(recv(&mut guest).await["t"], "host");

    drop(_owner);
    guest.close(None).await.unwrap();
    tokio::time::sleep(GRACE / 3).await;
    let (_, reply) = join_room(&url, "late-token-0005", &code, json!({})).await;
    assert_eq!(reply["t"], "welcome", "room survives inside grace period");
}

#[tokio::test]
async fn expired_rooms_disappear() {
    let url = start(Config::public("test")).await;
    let (mut host, welcome) = create(&url, "host-token-0006", json!({})).await;
    let code = welcome["room"]["code"].clone();
    host.close(None).await.unwrap();
    tokio::time::sleep(GRACE * 3).await;
    let (_, reply) = join_room(&url, "late-token-0006", &code, json!({})).await;
    assert_eq!(reply["code"], "not_found");
}

#[tokio::test]
async fn personal_host_allows_one_room() {
    let url = start(Config::personal("laptop")).await;
    let (_room, _) = create(&url, "host-token-0007", json!({})).await;
    let mut other = connect(&url, "other-token-0007").await;
    send(&mut other, json!({ "t": "create", "room": {} })).await;
    assert_eq!(recv(&mut other).await["code"], "limit");
}

#[tokio::test]
async fn stores_and_serves_blobs_by_hash() {
    let url = start(Config::public("test")).await;
    let (mut host, welcome) = create(&url, "host-token-0008", json!({})).await;
    let code = welcome["room"]["code"].clone();
    let midi = b"MThd fake midi".to_vec();
    let mut frame = vec![blob::PUT];
    frame.extend(&midi);
    host.send(Message::binary(frame)).await.unwrap();
    let stored = recv(&mut host).await;
    assert_eq!(stored["t"], "stored");
    let hash = stored["hash"].as_str().unwrap().to_owned();

    let (mut guest, _) = join_room(&url, "guest-token-0008", &code, json!({})).await;
    send(&mut guest, json!({ "t": "get", "hash": hash })).await;
    let Message::Binary(data) = next(&mut guest).await else { panic!("expected blob") };
    assert_eq!(data[0], blob::DATA);
    assert_eq!(&data[1 + blob::HASH_LEN..], midi.as_slice());

    send(&mut guest, json!({ "t": "get", "hash": "00".repeat(32) })).await;
    assert_eq!(recv(&mut guest).await["code"], "not_found");
}

#[tokio::test]
async fn completes_close_handshake() {
    let url = start(Config::public("test")).await;
    let (mut client, _) = create(&url, "host-token-0009", json!({})).await;
    client.send(Message::Close(None)).await.unwrap();
    let reply = tokio::time::timeout(Duration::from_secs(2), client.next()).await.expect("reply in time");
    assert!(matches!(reply, Some(Ok(Message::Close(_)))), "server must answer a close frame, got {reply:?}");
}

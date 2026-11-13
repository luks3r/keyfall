//! Wire format shared by every Keyfall server and client. See `PROTOCOL.md`.

pub const VERSION: u32 = 1;

/// Binary event kinds `0x01..=0x3F` are relayed to the room with the sender id prepended.
/// The server validates their length only, so new event kinds need no server upgrade.
pub mod event {
    pub const NOTE_ON: u8 = 0x01;
    pub const NOTE_OFF: u8 = 0x02;
    pub const SUSTAIN: u8 = 0x03;
    pub const HIT: u8 = 0x04;
    pub const LAST: u8 = 0x3F;
    pub const MAX_PAYLOAD: usize = 32;
}

/// Binary frames `0x40..` are handled by the server itself.
pub mod blob {
    pub const PUT: u8 = 0x40;
    pub const DATA: u8 = 0x41;
    pub const HASH_LEN: usize = 32;
}

pub const SENDER_LEN: usize = 2;

/// Error codes carried by `{"t":"error","code":…}`.
pub mod error {
    pub const VERSION: &str = "version";
    pub const PROTOCOL: &str = "protocol";
    pub const NOT_FOUND: &str = "not_found";
    pub const PIN: &str = "pin";
    pub const FULL: &str = "full";
    pub const LIMIT: &str = "limit";
    pub const BANNED: &str = "banned";
    pub const FORBIDDEN: &str = "forbidden";
    pub const TOO_LARGE: &str = "too_large";
    /// Too many codes that led nowhere from one address; guessing hidden rooms is throttled.
    pub const TOO_MANY: &str = "too_many";
}

/// Size of a known event's payload; unknown kinds in the event range are bounded by `MAX_PAYLOAD`.
fn payload_len(kind: u8) -> Option<usize> {
    match kind {
        event::NOTE_ON => Some(4),
        event::NOTE_OFF | event::SUSTAIN => Some(3),
        event::HIT => Some(4),
        _ => None,
    }
}

/// Validates a client event frame and returns the relayed frame `[kind][sender u16 LE][payload]`.
pub fn relay_event(frame: &[u8], sender: u16) -> Option<Vec<u8>> {
    let (&kind, payload) = frame.split_first()?;
    if !(event::NOTE_ON..=event::LAST).contains(&kind) {
        return None;
    }
    let valid = match payload_len(kind) {
        Some(len) => payload.len() == len,
        None => payload.len() <= event::MAX_PAYLOAD,
    };
    if !valid {
        return None;
    }
    let mut relayed = Vec::with_capacity(frame.len() + SENDER_LEN);
    relayed.push(kind);
    relayed.extend_from_slice(&sender.to_le_bytes());
    relayed.extend_from_slice(payload);
    Some(relayed)
}

/// A relayed note event, as clients play it.
#[derive(Debug, PartialEq)]
pub enum Note {
    On { midi: u8, velocity: f32 },
    Off { midi: u8 },
    Sustain(bool),
}

const VELOCITY_MAX: f32 = 127.;

/// Decodes a relayed note frame `[kind][sender u16 LE][payload]` into its sender and note.
pub fn relayed_note(frame: &[u8]) -> Option<(u16, Note)> {
    let (&kind, rest) = frame.split_first()?;
    let (sender, payload) = rest.split_first_chunk::<SENDER_LEN>()?;
    if payload.len() != payload_len(kind)? {
        return None;
    }
    let note = match kind {
        event::NOTE_ON => Note::On { midi: payload[0].min(127), velocity: payload[1] as f32 / VELOCITY_MAX },
        event::NOTE_OFF => Note::Off { midi: payload[0].min(127) },
        event::SUSTAIN => Note::Sustain(payload[0] != 0),
        _ => return None,
    };
    Some((u16::from_le_bytes(*sender), note))
}

pub fn blob_frame(hash: &[u8; blob::HASH_LEN], data: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(1 + blob::HASH_LEN + data.len());
    frame.push(blob::DATA);
    frame.extend_from_slice(hash);
    frame.extend_from_slice(data);
    frame
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn parse_hex<const N: usize>(text: &str) -> Option<[u8; N]> {
    if text.len() != N * 2 {
        return None;
    }
    let mut out = [0; N];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(text.get(i * 2..i * 2 + 2)?, 16).ok()?;
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_relayed_notes() {
        let on = relay_event(&[event::NOTE_ON, 60, 127, 0, 0], 7).unwrap();
        assert_eq!(relayed_note(&on), Some((7, Note::On { midi: 60, velocity: 1. })));
        let pedal = relay_event(&[event::SUSTAIN, 1, 0, 0], 2).unwrap();
        assert_eq!(relayed_note(&pedal), Some((2, Note::Sustain(true))));
        let hit = relay_event(&[event::HIT, 1, 0, 0, 0], 2).unwrap();
        assert_eq!(relayed_note(&hit), None);
        assert_eq!(relayed_note(&on[..on.len() - 1]), None);
    }

    #[test]
    fn relays_known_events_with_sender() {
        assert_eq!(relay_event(&[event::NOTE_ON, 60, 100, 0x34, 0x12], 0x0201), Some(vec![event::NOTE_ON, 0x01, 0x02, 60, 100, 0x34, 0x12]));
        assert_eq!(relay_event(&[event::NOTE_OFF, 60, 0, 0], 7).map(|f| f.len()), Some(6));
        assert_eq!(relay_event(&[event::HIT, 1, 0, 0, 0], 7).map(|f| f.len()), Some(7));
    }

    #[test]
    fn rejects_malformed_events() {
        assert_eq!(relay_event(&[], 1), None);
        assert_eq!(relay_event(&[event::NOTE_ON, 60], 1), None, "short note on");
        assert_eq!(relay_event(&[0x00, 1], 1), None, "kind 0 reserved");
        assert_eq!(relay_event(&[blob::PUT, 1], 1), None, "server range is not an event");
        assert_eq!(relay_event(&[0x3F; 40], 1), None, "unknown kind over size cap");
        assert!(relay_event(&[0x20, 1, 2, 3], 1).is_some(), "unknown kind inside cap is forwarded");
    }

    #[test]
    fn hex_round_trips() {
        let bytes = [0u8, 15, 255, 128];
        assert_eq!(parse_hex::<4>(&hex(&bytes)), Some(bytes));
        assert_eq!(parse_hex::<4>("zz"), None);
    }
}

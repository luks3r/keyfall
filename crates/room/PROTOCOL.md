# Keyfall room protocol v1

One WebSocket per client at `/ws`. A server hosts many rooms; a personal host is a server limited to one room.
Every server also serves the web client at `/`, so pages and sockets share an origin (no mixed content on LAN).

Text frames carry JSON control messages (`{"t": …}`). Binary frames carry hot-path events and blobs.

## Session

```
client                                  server
hello {v:1, token}            →
                              ←         info {v, name, caps, urls, now}
list                          →
                              ←         rooms {rooms:[…]}
create {room, profile}        →         (or join {code, pin?, profile})
                              ←         welcome {…}  |  error {code, message}
… events, set, say, get, ping …
```

- `token`: 16–128 random characters, generated per client **per server**. The server keeps only `sha256(token)`;
  its first 3 bytes in hex form the public `tag`. Same token = same identity (owner rights, bans).
- `list`, `info`, `ping` are allowed any time after `hello`. `create`/`join` exactly once per connection.
- Rooms are created only by `create`. `join` with an unknown code fails with `not_found`.

## Control messages

Client → server

| t | fields | notes |
|---|---|---|
| `hello` | `v`, `token` | first message; wrong `v` → `error version`, socket closes |
| `list` | | public rooms only |
| `create` | `room: {name?, public?=true, pin?, maxPlayers?}`, `profile` | server picks the code |
| `join` | `code`, `pin?`, `profile` | |
| `ping` | `c` (client ms) | → `pong {c, s}` (server ms) |
| `set` | `key`, `value` | `profile` (own), `song`/`transport` (host only) |
| `say` | `value` | JSON broadcast for low-rate extensions |
| `get` | `hash` (64 hex) | → binary blob frame or `error not_found` |
| `kick` | `id` | host only; bans the peer's identity from the room |

Server → client

| t | fields |
|---|---|
| `info` | `v`, `name`, `caps: {maxRooms, rooms, maxBlob, events}`, `urls` (LAN addresses), `now` |
| `rooms` | `rooms: [{code, name, host, players, spectators, maxPlayers, locked, mode, song}]` |
| `welcome` | `you`, `tag`, `host`, `owner`, `room: {code, name, public, locked, maxPlayers}`, `peers: [{id, tag, profile}]`, `state`, `profile`, `now`, `urls` |
| `join` / `leave` | `id`, (`tag`, `profile` on join) |
| `host` | `id` |
| `set` / `say` | `from`, `key`/`value` |
| `stored` | `hash` |
| `error` | `code`, `message` |

Error codes: `version`, `protocol`, `not_found`, `pin`, `full`, `limit`, `banned`, `forbidden`, `too_large`.

Profile: `{name, seat, sound}`. `seat: null` = spectator. Only seated peers may send events. When `maxPlayers`
is reached a joiner is seated as spectator and taking a seat fails with `full`.

## Binary frames

Peer ids are room-local `u16`. Integers are little-endian. `t` is the sender's server-clock time in ms, mod 65536,
for jitter measurement and timed playout.

Events, client → server (`0x01..=0x3F`). The server prepends the sender and relays to the room:
`[kind][from u16][payload]`. Unknown kinds in this range are relayed if the payload is ≤ 32 bytes.

| kind | name | payload | bytes sent / relayed |
|---|---|---|---|
| `0x01` | note on | `midi u8, velocity u8 (0-127), t u16` | 5 / 7 |
| `0x02` | note off | `midi u8, t u16` | 4 / 6 |
| `0x03` | sustain | `on u8, t u16` | 4 / 6 |
| `0x04` | hit | `note index u32` | 5 / 7 |

Blobs (`0x40..`), content-addressed by SHA-256:

| kind | direction | layout |
|---|---|---|
| `0x40` | client → server | `[0x40][bytes]` → `stored {hash}` |
| `0x41` | server → client | `[0x41][hash 32][bytes]` (reply to `get`) |

Room `song` state is `{name, hash}`; peers fetch the bytes once with `get` and cache them.

## Lifecycle and limits

- The first peer and the room owner (creator identity) become host; the owner reclaims host on rejoin.
  When the host leaves, the oldest peer becomes host.
- An empty room survives a grace period (default 60 s) so reconnects land in the same room.
- Servers enforce `maxRooms`, rooms per IP, a message rate per connection, and blob size/budget.

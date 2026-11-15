# Keyfall

A piano you can play with your computer keyboard, learn songs on, share with friends, and turn into a finished track.

- **Piano** — open it and play. Six keyboard layouts (two-handed split, Virtual Piano sheets, tracker, isomorphic…), or plug in a MIDI keyboard.
- **Learn** — load any MIDI file and play along with falling notes. Wait mode pauses until you hit the right key.
- **Rooms** — play together in real time. Send an invite link or QR code; everyone takes a part of the song, or just listens. The desktop app can host a room on your local network.
- **Studio** — sketch patterns on a step sequencer or piano roll, launch them live, arrange them into a song, export MIDI. Transpose, lock to a scale or play whole chords from one key.

The whole thing works like a single instrument: one screen, four coloured knobs, a row of mode keys. Press `⌘/` (Ctrl+/) anywhere to see every shortcut.

Runs in the browser, as a desktop app (macOS, Windows, Linux) and on Android. Sound is a small Rust synth compiled to WebAssembly in the browser and running natively in the apps.

## Run it

You need [Bun](https://bun.sh) and [Rust](https://rustup.rs) with the WebAssembly target:

```sh
rustup target add wasm32-unknown-unknown
bun install
bun run dev          # web app on http://localhost:5173
bun run room:dev     # in a second terminal, for multiplayer rooms
```

Desktop and Android apps use [Tauri](https://tauri.app/start/prerequisites/):

```sh
bun run tauri dev
bun run android:dev
```

### Android release

Android only installs signed APKs. Debug builds (`android:dev`, or `bun run tauri android build --apk --debug`) are signed with the SDK's debug key automatically. Release builds need your own key, created once:

```sh
keytool -genkeypair -v -keystore ~/.android/keyfall-upload.jks -storetype PKCS12 \
  -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

Then point `src-tauri/gen/android/keystore.properties` at it (git ignores this file):

```properties
storeFile=/Users/you/.android/keyfall-upload.jks
storePassword=…
keyAlias=upload
keyPassword=…
```

```sh
bun run android:build                       # signed universal APK
bun run tauri android build --apk --target aarch64   # smaller, 64-bit ARM phones only
bun run tauri android build --aab           # bundle for Google Play
```

Without `keystore.properties` the release build is `app-universal-release-unsigned.apk`, which phones refuse to install. Back up the key and its passwords: updates must be signed with the same key, and a lost key means users have to uninstall to get a new version.

## Host it

Simplest: one small Docker image serves the web app and rooms together.

```sh
docker build -t keyfall .
docker run -p 7777:7777 keyfall
```

Or run the app once and room servers on as many machines as you like:

```sh
# the app (nginx); KEYFALL_SERVERS lists the room servers it offers, first one is the default
docker build --target app -t keyfall-app .
docker run -p 8080:8080 -e KEYFALL_SERVERS="wss://rooms1.example.com, wss://rooms2.example.com" keyfall-app

# on each room machine; --app sends people who open an invite link to the app
docker build --target room -t keyfall-room .
docker run -p 7777:7777 keyfall-room --app https://keyfall.example.com --name "Rooms 1"
```

Players see every server's rooms in one list, can add their own servers (an address or any invite link), and invite links carry the server along. When the app is served over HTTPS, the room servers need HTTPS too (a TLS proxy in front, listed as `wss://…`). [`compose.yaml`](compose.yaml) runs both on one machine to try it out.

Without Docker: `bun run room` builds the app and serves everything on port 7777.

## Develop

```sh
bun run check        # type-check
bun run test         # Rust and TypeScript tests
bun run check:device # click through the whole app in headless Chrome
bun run check:rooms  # three players, two servers: lobby, invites, codes
```

| Where | What |
| --- | --- |
| `src/` | The app (Svelte 5) |
| `crates/dsp` | Synth, sampler and sequencer, shared by web and native |
| `crates/room` | Multiplayer server and static file host |
| `src-tauri/` | Desktop and Android shell: low-latency audio, MIDI, keyboard |

## License

[MIT](LICENSE)

Sampled sounds stream from elsewhere and keep their own licenses: Grand Piano is the [Salamander Grand Piano](https://archive.org/details/SalamanderGrandPianoV3) by Alexander Holm (CC BY 3.0), via [Tone.js](https://tonejs.github.io/audio/salamander/); the guitars, violin and cello are from [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments) by Nicholaus Brosowsky (CC BY 3.0). The synths and drum kits are generated in the app.

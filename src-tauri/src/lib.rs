mod audio;
mod capture;
mod discovery;
mod keys;
mod midi;
mod net;

use audio::{Audio, Command, SequencerConfig};
use capture::Capture;
use keyfall_dsp::{Instrument, Sample};
use discovery::{Discovery, Found};
use keys::{Keys, Layout};
use midi::Midi;
use net::{Host, HostInfo, SocketMessage, Sockets};
use tauri::ipc::{Channel, InvokeBody, Request, Response};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

#[tauri::command(async)]
fn note_on(audio: State<Audio>, id: u32, channel: usize, midi: u8, velocity: f32) {
    audio.send(Command::NoteOn { id, channel, midi, velocity });
}

#[tauri::command(async)]
fn note_off(audio: State<Audio>, id: u32) {
    audio.send(Command::NoteOff(id));
}

#[tauri::command(async)]
fn key_on(audio: State<Audio>, channel: usize, midi: u8, velocity: f32) {
    audio.send(Command::KeyOn { channel, midi, velocity });
}

#[tauri::command(async)]
fn key_off(audio: State<Audio>, channel: usize, midi: u8) {
    audio.send(Command::KeyOff { channel, midi });
}

#[tauri::command(async)]
fn pedal(audio: State<Audio>, channel: usize, down: bool) {
    audio.send(Command::Pedal { channel, down });
}

#[tauri::command(async)]
fn release_channel(audio: State<Audio>, channel: usize) {
    audio.send(Command::ReleaseChannel(channel));
}

#[tauri::command(async)]
fn channel_gain(audio: State<Audio>, channel: usize, gain: f32) {
    audio.send(Command::ChannelGain(channel, gain));
}

#[tauri::command(async)]
fn seq_pattern(audio: State<Audio>, id: u32, data: Vec<f32>) -> Result<(), String> {
    audio.set_pattern(id, &data)
}

#[tauri::command(async)]
fn seq_timeline(audio: State<Audio>, lane: usize, data: Vec<f32>) -> Result<(), String> {
    audio.set_timeline(lane, &data)
}

#[tauri::command(async)]
fn seq_launch(audio: State<Audio>, lane: usize, id: u32, quantized: bool) {
    audio.launch(lane, id, quantized);
}

#[tauri::command(async)]
fn seq_play(audio: State<Audio>, from: f64) {
    audio.send(Command::SeqPlay(from));
}

#[tauri::command(async)]
fn seq_stop(audio: State<Audio>) {
    audio.send(Command::SeqStop);
}

#[tauri::command(async)]
fn seq_config(audio: State<Audio>, config: SequencerConfig) {
    audio.send(Command::SeqConfig(config));
}

#[tauri::command]
fn seq_status(audio: State<Audio>) -> Vec<f64> {
    audio.sequencer_status()
}

/// Raw body of f32 LE samples with `x-channel`, `x-midi`, `x-rate` headers; an empty body clears the pad.
#[tauri::command(async)]
fn kit_pad(audio: State<Audio>, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("expected raw sample body".into()) };
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).ok_or(format!("missing {name}"));
    let channel = header("x-channel")?.parse::<usize>().map_err(|e| e.to_string())?;
    let midi = header("x-midi")?.parse::<u8>().map_err(|e| e.to_string())?.min(127);
    let rate = header("x-rate")?.parse::<f32>().map_err(|e| e.to_string())?;
    let sample = (!bytes.is_empty()).then(|| Sample { root: midi, rate, data: bytes.as_chunks::<4>().0.iter().map(|b| f32::from_le_bytes(*b)).collect() });
    audio.set_pad(channel, midi, sample)
}

#[tauri::command(async)]
fn kit_clear(audio: State<Audio>, channel: usize) -> Result<(), String> {
    audio.clear_kit(channel)
}

/// 128 lists of notes, one per input note; an empty list restores notes as played.
#[tauri::command(async)]
fn set_note_map(audio: State<Audio>, map: Vec<Vec<u8>>) {
    audio.commands().set_note_map(map);
}

#[tauri::command(async)]
fn set_live_channel(audio: State<Audio>, channel: usize) {
    audio.commands().set_live_channel(channel);
}

#[tauri::command(async)]
fn set_muted(audio: State<Audio>, muted: bool) {
    audio.commands().set_muted(muted);
}

/// Returns whether the native keyboard fast path is active, so the webview skips the sound of mapped keys.
#[tauri::command(async)]
fn keyboard_layout(keys: State<Keys>, layout: Layout) -> bool {
    keys.set_layout(layout);
    Keys::SUPPORTED
}

#[tauri::command(async)]
fn all_off(audio: State<Audio>) {
    audio.send(Command::AllOff);
}

#[tauri::command(async)]
fn set_volume(audio: State<Audio>, volume: f32) {
    audio.send(Command::Volume(volume));
}

#[tauri::command(async)]
fn set_instrument(audio: State<Audio>, channel: usize, data: Vec<f32>) -> Result<(), String> {
    let instrument = Instrument::decode(&data).ok_or("invalid instrument data")?;
    audio.send(Command::Instrument(channel, instrument));
    Ok(())
}

#[tauri::command(async)]
fn clear_samples(audio: State<Audio>) {
    audio.send(Command::ClearSamples);
}

#[tauri::command(async)]
fn add_sample(audio: State<Audio>, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("expected raw sample body".into()) };
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).ok_or(format!("missing {name}"));
    let root = header("x-root")?.parse::<u8>().map_err(|e| e.to_string())?;
    let rate = header("x-rate")?.parse::<f32>().map_err(|e| e.to_string())?;
    let data = bytes.as_chunks::<4>().0.iter().map(|b| f32::from_le_bytes(*b)).collect();
    audio.send(Command::Sample(Sample { root, rate, data }));
    Ok(())
}

#[tauri::command(async)]
fn set_audio_buffer(audio: State<Audio>, frames: u32) -> Result<(), String> {
    audio.set_buffer(frames)
}

#[tauri::command]
fn audio_latency(audio: State<Audio>) -> audio::Latency {
    audio.latency()
}

#[tauri::command]
fn audio_outputs() -> Vec<String> {
    audio::output_names()
}

#[tauri::command]
async fn set_audio_output(audio: State<'_, Audio>, name: Option<String>) -> Result<(), String> {
    audio.set_output(name)
}

#[tauri::command]
fn audio_inputs() -> Vec<String> {
    capture::input_names()
}

#[tauri::command]
fn capture_start(capture: State<Capture>, name: Option<String>, level: Channel<f32>) -> Result<(), String> {
    capture.start(name, level)
}

/// Raw body: see `capture::Captured::to_bytes`.
#[tauri::command(async)]
fn capture_stop(capture: State<Capture>) -> Result<Response, String> {
    Ok(Response::new(capture.stop()?.to_bytes()))
}

#[tauri::command]
fn midi_inputs() -> Result<Vec<String>, String> {
    midi::input_names()
}

#[tauri::command]
fn midi_outputs() -> Result<Vec<String>, String> {
    midi::output_names()
}

#[tauri::command]
fn midi_open_input(midi: State<Midi>, name: Option<String>, channel: Channel<Response>) -> Result<(), String> {
    midi.open_input(name, channel)
}

#[tauri::command]
fn midi_open_output(midi: State<Midi>, name: Option<String>) -> Result<(), String> {
    midi.open_output(name)
}

#[tauri::command(async)]
fn midi_reserve(midi: State<Midi>, controls: Vec<(u8, u8)>) {
    midi.reserve(controls);
}

#[tauri::command(async)]
fn midi_send(midi: State<Midi>, message: Vec<u8>) {
    midi.send(&message);
}

#[tauri::command]
async fn save_file(app: AppHandle, name: String, data: Vec<u8>) -> Result<bool, String> {
    let extension = name.rsplit('.').next().unwrap_or_default().to_owned();
    let Some(path) = app.dialog().file().set_file_name(&name).add_filter(&extension, &[&extension]).blocking_save_file() else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
async fn room_host(app: AppHandle, host: State<'_, Host>, discovery: State<'_, Discovery>, port: u16, name: String) -> Result<HostInfo, String> {
    let info = host.start(app, port, &name).await?;
    if let Err(e) = discovery.advertise(&name, info.port) {
        eprintln!("discovery: {e}");
    }
    Ok(info)
}

#[tauri::command]
fn room_stop(host: State<Host>, discovery: State<Discovery>) {
    discovery.withdraw();
    host.stop();
}

#[tauri::command]
fn room_hosting(host: State<Host>) -> Option<HostInfo> {
    host.info()
}

#[tauri::command]
fn discover_start(discovery: State<Discovery>, found: Channel<Vec<Found>>) -> Result<(), String> {
    discovery.browse(found)
}

#[tauri::command]
fn discover_stop(discovery: State<Discovery>) {
    discovery.stop();
}

#[tauri::command]
async fn socket_open(sockets: State<'_, Sockets>, url: String, events: Channel<Response>) -> Result<u32, String> {
    sockets.open(&url, events).await
}

#[tauri::command(async)]
fn socket_send(sockets: State<Sockets>, id: u32, text: String) {
    sockets.send(id, SocketMessage::text(text));
}

#[tauri::command(async)]
fn socket_send_binary(sockets: State<Sockets>, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("expected raw frame".into()) };
    let id = request.headers().get("x-socket").and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok()).ok_or("missing x-socket")?;
    sockets.send(id, SocketMessage::binary(bytes.clone()));
    Ok(())
}

#[tauri::command(async)]
fn socket_route(sockets: State<Sockets>, id: u32, peer: u16, channel: Option<usize>) {
    sockets.route(id, peer, channel);
}

#[tauri::command]
fn socket_close(sockets: State<Sockets>, id: u32) {
    sockets.close(id);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let audio = Audio::start();
    let commands = audio.commands();
    let keys = Keys::new(commands.clone());
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup({
            let keys = keys.clone();
            move |_| {
                keys.install();
                Ok(())
            }
        })
        .manage(keys)
        .manage(Midi::new(commands.clone()))
        .manage(Sockets::new(commands))
        .manage(audio)
        .manage(Capture::default())
        .manage(Host::default())
        .manage(Discovery::default())
        .invoke_handler(tauri::generate_handler![
            note_on,
            note_off,
            key_on,
            key_off,
            pedal,
            release_channel,
            set_muted,
            set_live_channel,
            set_note_map,
            seq_pattern,
            seq_timeline,
            seq_launch,
            seq_play,
            seq_stop,
            seq_config,
            seq_status,
            kit_pad,
            kit_clear,
            channel_gain,
            keyboard_layout,
            all_off,
            set_volume,
            set_instrument,
            clear_samples,
            add_sample,
            audio_outputs,
            set_audio_buffer,
            audio_latency,
            set_audio_output,
            audio_inputs,
            capture_start,
            capture_stop,
            midi_inputs,
            midi_outputs,
            midi_open_input,
            midi_open_output,
            midi_send,
            midi_reserve,
            save_file,
            room_host,
            room_stop,
            room_hosting,
            discover_start,
            discover_stop,
            socket_open,
            socket_send,
            socket_send_binary,
            socket_route,
            socket_close,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run keyfall");
}

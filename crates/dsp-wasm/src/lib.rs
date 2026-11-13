use keyfall_dsp::{channels, Engine, Instrument, Library, Pattern, Sample, PADS};

/// The engine plus the clip and kit library; the worklet is single-threaded, so both live together.
pub struct Host {
    engine: Engine,
    library: Library,
    status: Vec<f64>,
}

#[unsafe(no_mangle)]
pub extern "C" fn engine_new(sample_rate: f32) -> *mut Host {
    let mut engine = Engine::new(sample_rate);
    engine.configure_sequencer(channels::TRACKS, channels::FIRST_TRACK, channels::CLICK);
    let status = vec![0.; engine.sequencer().status_len()];
    Box::into_raw(Box::new(Host { engine, library: Library::default(), status }))
}

fn host<'a>(ptr: *mut Host) -> &'a mut Host {
    unsafe { &mut *ptr }
}

fn engine<'a>(ptr: *mut Host) -> &'a mut Engine {
    &mut host(ptr).engine
}

#[unsafe(no_mangle)]
pub extern "C" fn note_on(ptr: *mut Host, id: u32, channel: u32, midi: u32, velocity: f32) {
    engine(ptr).note_on(id, channel as usize, midi.min(127) as u8, velocity);
}

#[unsafe(no_mangle)]
pub extern "C" fn note_off(ptr: *mut Host, id: u32) {
    engine(ptr).note_off(id);
}

#[unsafe(no_mangle)]
pub extern "C" fn key_on(ptr: *mut Host, channel: u32, midi: u32, velocity: f32) {
    engine(ptr).key_on(channel as usize, midi.min(127) as u8, velocity);
}

#[unsafe(no_mangle)]
pub extern "C" fn key_off(ptr: *mut Host, channel: u32, midi: u32) {
    engine(ptr).key_off(channel as usize, midi.min(127) as u8);
}

#[unsafe(no_mangle)]
pub extern "C" fn pedal(ptr: *mut Host, channel: u32, down: bool) {
    engine(ptr).pedal(channel as usize, down);
}

#[unsafe(no_mangle)]
pub extern "C" fn release_channel(ptr: *mut Host, channel: u32) {
    engine(ptr).release_channel(channel as usize);
}

#[unsafe(no_mangle)]
pub extern "C" fn set_channel_gain(ptr: *mut Host, channel: u32, gain: f32) {
    engine(ptr).set_channel_gain(channel as usize, gain);
}

#[unsafe(no_mangle)]
pub extern "C" fn all_off(ptr: *mut Host) {
    engine(ptr).all_off();
}

#[unsafe(no_mangle)]
pub extern "C" fn set_volume(ptr: *mut Host, volume: f32) {
    engine(ptr).set_volume(volume);
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len);
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    ptr
}

/// # Safety
/// `data` must come from `alloc(len * 4)`; ownership moves to this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn set_instrument(ptr: *mut Host, channel: u32, data: *mut u8, len: usize) -> bool {
    let floats = unsafe { floats(data, len) };
    Instrument::decode(&floats).map(|instrument| engine(ptr).set_instrument(channel as usize, instrument)).is_some()
}

unsafe fn floats(data: *mut u8, len: usize) -> Vec<f32> {
    let bytes = unsafe { Vec::from_raw_parts(data, len * 4, len * 4) };
    bytes.as_chunks::<4>().0.iter().map(|b| f32::from_le_bytes(*b)).collect()
}

/// # Safety
/// `data` must come from `alloc(len * 4)`; ownership moves to this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn add_sample(ptr: *mut Host, root: u32, rate: f32, data: *mut u8, len: usize) {
    let data = unsafe { floats(data, len) }.into();
    let _ = engine(ptr).add_sample(Sample { root: root.min(127) as u8, rate, data });
}

#[unsafe(no_mangle)]
pub extern "C" fn clear_samples(ptr: *mut Host) {
    let _ = engine(ptr).clear_samples();
}

#[unsafe(no_mangle)]
pub extern "C" fn render(ptr: *mut Host, frames: usize) -> *const f32 {
    engine(ptr).render_block(frames).as_ptr()
}

/// # Safety
/// `data` must come from `alloc(len * 4)`; ownership moves to this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn seq_pattern(ptr: *mut Host, id: u32, data: *mut u8, len: usize) -> bool {
    let floats = unsafe { floats(data, len) };
    let Some(pattern) = Pattern::decode(&floats) else { return false };
    let host = host(ptr);
    let pattern = host.library.set_pattern(id, pattern);
    host.engine.sequencer().update(id, &pattern, &mut drop);
    true
}

/// # Safety
/// `data` must come from `alloc(len * 4)`; ownership moves to this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn seq_timeline(ptr: *mut Host, lane: u32, data: *mut u8, len: usize) {
    let floats = unsafe { floats(data, len) };
    let host = host(ptr);
    let timeline = host.library.timeline(&floats);
    host.engine.sequencer().set_timeline(lane as usize, timeline);
}

#[unsafe(no_mangle)]
pub extern "C" fn seq_launch(ptr: *mut Host, lane: u32, id: u32, quantized: bool) {
    let host = host(ptr);
    let clip = host.library.pattern(id).map(|pattern| (id, pattern));
    host.engine.sequencer().launch(lane as usize, clip, quantized);
}

#[unsafe(no_mangle)]
pub extern "C" fn seq_play(ptr: *mut Host, from: f64) {
    engine(ptr).sequencer().play(from);
}

#[unsafe(no_mangle)]
pub extern "C" fn seq_stop(ptr: *mut Host) {
    engine(ptr).transport_stop();
}

#[unsafe(no_mangle)]
pub extern "C" fn seq_config(ptr: *mut Host, tempo: f64, quantum: f64, beats_per_bar: f64, metronome: bool, loop_start: f64, loop_end: f64) {
    let sequencer = engine(ptr).sequencer();
    sequencer.tempo = tempo.clamp(20., 400.);
    sequencer.set_quantum(quantum);
    sequencer.set_meter(beats_per_bar);
    sequencer.set_metronome(metronome);
    sequencer.set_loop((loop_end > loop_start).then_some((loop_start, loop_end)));
}

/// Pointer to the status array (`keyfall_dsp::STATUS_HEADER` layout), refreshed by this call.
#[unsafe(no_mangle)]
pub extern "C" fn seq_status(ptr: *mut Host) -> *const f64 {
    let host = host(ptr);
    host.engine.sequencer().write_status(&mut host.status);
    host.status.as_ptr()
}

#[unsafe(no_mangle)]
pub extern "C" fn seq_status_len(ptr: *mut Host) -> usize {
    host(ptr).status.len()
}

/// # Safety
/// `data` must come from `alloc(len * 4)`; ownership moves to this call. `len == 0` clears the pad.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn kit_pad(ptr: *mut Host, channel: u32, midi: u32, rate: f32, data: *mut u8, len: usize) {
    let sample = (len > 0).then(|| Sample { root: midi.min(PADS as u32 - 1) as u8, rate, data: unsafe { floats(data, len) }.into() });
    let host = host(ptr);
    let instrument = host.library.set_pad(channel as usize, midi.min(PADS as u32 - 1) as u8, sample);
    host.engine.set_instrument(channel as usize, instrument);
}

#[unsafe(no_mangle)]
pub extern "C" fn kit_clear(ptr: *mut Host, channel: u32) {
    let host = host(ptr);
    let instrument: Instrument = host.library.clear_kit(channel as usize);
    host.engine.set_instrument(channel as usize, instrument);
}

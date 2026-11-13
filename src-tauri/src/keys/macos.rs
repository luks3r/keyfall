use super::Keys;
use block2::RcBlock;
use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags, NSEventType};
use std::ptr::NonNull;

/// macOS virtual key codes (kVK_ANSI_*) to DOM `KeyboardEvent.code`.
fn code(key: u16) -> Option<&'static str> {
    Some(match key {
        0x00 => "KeyA",
        0x01 => "KeyS",
        0x02 => "KeyD",
        0x03 => "KeyF",
        0x04 => "KeyH",
        0x05 => "KeyG",
        0x06 => "KeyZ",
        0x07 => "KeyX",
        0x08 => "KeyC",
        0x09 => "KeyV",
        0x0A => "IntlBackslash",
        0x0B => "KeyB",
        0x0C => "KeyQ",
        0x0D => "KeyW",
        0x0E => "KeyE",
        0x0F => "KeyR",
        0x10 => "KeyY",
        0x11 => "KeyT",
        0x12 => "Digit1",
        0x13 => "Digit2",
        0x14 => "Digit3",
        0x15 => "Digit4",
        0x16 => "Digit6",
        0x17 => "Digit5",
        0x18 => "Equal",
        0x19 => "Digit9",
        0x1A => "Digit7",
        0x1B => "Minus",
        0x1C => "Digit8",
        0x1D => "Digit0",
        0x1E => "BracketRight",
        0x1F => "KeyO",
        0x20 => "KeyU",
        0x21 => "BracketLeft",
        0x22 => "KeyI",
        0x23 => "KeyP",
        0x25 => "KeyL",
        0x26 => "KeyJ",
        0x27 => "Quote",
        0x28 => "KeyK",
        0x29 => "Semicolon",
        0x2A => "Backslash",
        0x2B => "Comma",
        0x2C => "Slash",
        0x2D => "KeyN",
        0x2E => "KeyM",
        0x2F => "Period",
        0x32 => "Backquote",
        _ => return None,
    })
}

/// A local monitor sees the app's own key events without Accessibility permission, before the webview does.
pub fn install(keys: Keys) {
    let handler = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        let ns = unsafe { event.as_ref() };
        let key = ns.keyCode();
        let flags = ns.modifierFlags();
        match ns.r#type() {
            NSEventType::KeyDown if !ns.isARepeat() && !flags.intersects(NSEventModifierFlags::Command | NSEventModifierFlags::Control | NSEventModifierFlags::Option) => {
                if let Some(code) = code(key) {
                    keys.key_down(key, code, flags.contains(NSEventModifierFlags::Shift));
                }
            }
            NSEventType::KeyUp => keys.key_up(key),
            _ => {}
        }
        event.as_ptr()
    });
    let monitor = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::KeyDown | NSEventMask::KeyUp, &handler) };
    // The monitor lives as long as the app.
    std::mem::forget(monitor);
}

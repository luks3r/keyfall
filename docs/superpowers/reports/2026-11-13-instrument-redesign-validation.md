# Instrument redesign validation

Date: 2026-11-13. Branch: `redesign/op1-studio`.
Code candidate: `4e8d2d8f0ccd5820c0db29a2917b106ff1c8011b`. Baseline before implementation: `72046cb`.

## Delivered behavior

- OP-1-inspired light and OP-XY/OP-Z-inspired dark palettes, plus System preference. Theme startup respects Tauri CSP; DOM, playable canvas, clip previews, and grids share semantic colors.
- Shared control geometry, readable musical labels, numeric parameter entry, explicit focus ownership, accessible menus and modal sheets.
- Visible Studio clip editing, remembered Steps/Notes preference, direct octave/transpose/scale/harmony/velocity/sustain controls, and Play/Clip Launch state.
- Explicit timeline insertion and clip creation, musical snap choices, independent duplication, precise boundaries, cancellable drag previews, overlap feedback, contextual actions, and focused keyboard editing.
- Clip moves preserve fractional duration; resizing retains source notes and existing repeat intent. Optional `Clip.looped` metadata preserves repeat intent across trim/re-extension and reload without changing project version 2 or the scheduling format. Existing files need no migration.
- Compact Project/Edit/Play surfaces, sound sheet, preserved layout preferences and scroll state, and 44px touch sequencer rows/steps. Wide screens retain dockable panels.
- Learn, sound editing, Settings, rooms, and calibration reuse the theme/control system. Sound editing includes a parameter-derived envelope display.

## Automated evidence

| Command | Result |
| --- | --- |
| `bun run test` | Rust groups 4 + 19 + 5 + 10 = 38 passed; Bun 21 passed, zero failures |
| `bun run check` | Svelte zero errors and zero warnings; TypeScript node check succeeded |
| `bun run build` | Production frontend and WASM build succeeded |
| `bun run check:studio /tmp/keyfall-redesign-after` | Existing Studio regression runner passed all assertions |
| `bun bench/check-redesign.ts --suite=all --shots=/tmp/keyfall-redesign-after` | 56 assertions passed, zero failures/page errors |
| `bun bench/check-redesign.ts --suite=adaptive --shots=/tmp/keyfall-redesign-after` | Passed again after the final touch-target sizing change |
| `cargo clippy -q --workspace --all-targets` | Succeeded |
| `cargo clippy -q --target aarch64-linux-android` in `src-tauri/` | Succeeded |
| `bun tauri build --debug --bundles app` | Final macOS debug application built |
| `bun tauri android build --debug --target aarch64 --apk` | Final Android arm64 debug APK built |
| `git diff --check` | Clean |

The Studio runner preserves its original musical assertions: quantized launch/stop, recording, whole diatonic triads on successive steps, drum pads, and kick starts at beats 0/1/2/3. Its gestures now focus the explicit keyboard surface before musical shortcuts.

The redesign runner covers preference persistence/platform appearance, canvas repaint, unchanged project on theme switch, timeline selection versus creation, context navigation, drag cancellation/undo, independent copies, exact bounds, fractional duration, touch scrolling without edits, visible editors, custom key binding and Escape, occupied Session slots after reload, modal focus, native control focus, overflow-field access, Learn parity, and five viewport sizes.

Validation sizes: 390×844, 844×390, 768×1024, 1280×800, and 1920×1080. Coarse pointer emulation is enabled for compact layout checks.

## Independent review and repairs

A fresh read-only reviewer examined `72046cb..17291a8`. Four important and two minor findings were independently verified and repaired in `0263ca9`:

1. Start/move edits preserve fractional length and repeat.
2. Repeat intent survives shortening to/below its period and serialization.
3. Clicking the piano restores performance focus after controls or Settings.
4. Overflow inputs/selects are reachable by Tab and retain native arrow behavior.
5. Clip previews redraw when returning from a hidden focused surface.
6. Escape exits custom-keymap editing before the ordinary performance-exit path.

Review was followed by one fix pass and local regression verification, not a second independent sign-off. An additional regression found occupied Session slots could be overwritten by the new entry action after reload; creation is now idempotent and existing clips offer Edit. Native inspection also exposed editor-width and touch-target issues; controls now fit the compact editor.

## Native interaction evidence

- macOS debug app launched through the native UI tool and rendered Learn/Studio. Native Z/X/C step input produced three notes. Typing the track name left the note count unchanged. The temporary desktop test clip was removed.
- Android 17 emulator `Medium_Phone_API_37.0` on host `local` was installed and driven through the required device command. Learn/Studio, clip creation, launch/stop, and opening Steps were exercised. Visual inspection confirmed Steps/Notes/Duplicate/Delete fit in the compact editor after the sizing fix. Transport was stopped.
- Android tooling once needed its documented debug relaunch retry and a fresh reference snapshot. These resolved without an app crash in AndroidRuntime logs. Final bundles were rebuilt after subsequent small source fixes; the native smoke checks are narrower than the browser regression suite.

## Artifacts

- Before screenshots: `/tmp/keyfall-redesign-before/`.
- After screenshots: `/tmp/keyfall-redesign-after/`, including `studio-dark.png`, `studio-light-390x844.png`, `arrangement-light.png`, `arrangement-touch.png`, `learn-light.png`, and `learn-dark.png`. Some earlier filenames reflect the scenario label rather than a fixed theme; inspect the displayed palette.
- Browser log: `/tmp/keyfall-redesign-final.log`; Studio log: `/tmp/keyfall-studio-final.log`; final tests: `/tmp/keyfall-tests-final.log`.
- macOS app: `target/debug/bundle/macos/Keyfall.app`.
- Android APK: `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`.

## Limits

Physical MIDI hardware, measured audio latency, sustained native notes across every focus/theme transition, two-device room interaction, and a full screen-reader/contrast audit were not exercised. The Android check was an emulator smoke check, not a physical-device endurance test. Android builds emitted existing Gradle deprecated-variant API warnings; builds and Rust clippy succeeded.

No runtime dependency, DSP algorithm, native input protocol, project version bump, merge, push, or deployment was introduced. The branch is retained for further iteration.

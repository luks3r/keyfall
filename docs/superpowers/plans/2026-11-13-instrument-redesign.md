# Keyfall Instrument Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execution method has not been selected. This document authorizes no implementation by itself.

**Goal:** Deliver one coherent, playable Keyfall interface with OP-1-inspired light styling, OP-XY/OP-Z-inspired dark styling, discoverable arrangement editing, and adaptive layouts.

**Architecture:** Evolve the existing shared Svelte controls and state owners. Introduce semantic theme tokens, a shared input-focus policy, and small pure arrangement helpers; leave DSP, project schema, and audio scheduling intact. Implement sequentially because theme, focus, menus, and workspace tasks share components and contracts.

**Tech Stack:** Svelte 5, TypeScript, Tailwind 4, Bun, existing Vite/CDP browser checks, Rust/Tauri audio and native input.

**Spec:** [Instrument redesign design](../specs/2026-11-13-instrument-redesign-design.md), including its arrangement interaction section.

## Global Constraints

- Work on `redesign/op1-studio`; planning starts at `b539e32`. Preserve the current work and shared baseline `1513b45` on `main`.
- Light theme takes inspiration from OP-1; dark theme takes inspiration from OP-XY and OP-Z. Both themes share information architecture, control positions, terminology, and behavior.
- Reuse Svelte 5, Tailwind 4, Rust DSP, existing component/state ownership, and the current project format. No new runtime dependencies are planned.
- Computer-keyboard performance, octave changes, transposition, harmonization, and sequencing are core product priorities.
- Preserve existing tracks, clips, sessions, arrangements, recording, MIDI, custom keymaps, export, collaboration, and native audio paths.
- Use a compact 4px spacing scale. Proposed desktop controls are 32–36px high; touch targets are at least 44px. Primary functional text is 14–16px.
- Initial design checkpoints are 390×844, 844×390, 768×1024, 1280×800, and 1920×1080; these are validation sizes, not rigid breakpoints.
- Offer Light, Dark, and System in Settings. Default is System. Preserve explicit preference and existing settings/layout storage keys.
- No new DSP, synth engines, arpeggiators, probability, ratchets, swing, macro routing, fixed track limits, or hardware emulation.
- Cross-track moves, multiselection, marquee selection, split, clipboard transfer, and linked duplicates are outside the initial redesign slice.
- Musical graphics and color serve musical information. No decorative gradients, glass, hardware screws, or motion that delays input. CSS grid-line gradients are allowed.
- Keep normal musical notation and readable functional text. Start with system sans-serif and monospace stacks; no remote fonts or proprietary assets.
- Each task ends in a reviewable commit. Tests accompany changed behavior; cosmetic styling uses rendered inspection rather than CSS snapshot assertions.

## Review Focus

1. Theme or system appearance changes while notes are held: repaint only; preserve audio, selection, and project. Task 1 browser regression.
2. Focus enters a menu, select, slider, dialog, or custom keymap control: native and DOM input must agree, and note releases still complete. Tasks 2–3 regressions.
3. Existing persisted preferences or clips contain unexpected values/overlaps: safe defaults preserve valid data and additive playback. Tasks 1, 5, and 8 regressions.
4. A drag is cancelled, loses capture, or overlaps another clip: no partial edit, deletion, or extra undo entry. Task 6 regressions.
5. A short touch viewport changes orientation during editing: retain context, scroll, and usable transport; scrolling cannot move clips. Tasks 6 and 8 regressions.

## File and responsibility map

Paths are relative to `keyfall/`. New files below are intentional boundaries, not a parallel framework.

| Files | Responsibility |
| --- | --- |
| `index.html`, `src/app.css`, `src/lib/settings.svelte.ts` | Early theme application, shared visual tokens, persisted preference |
| New `src/lib/theme.ts`, `src/lib/theme.svelte.ts` | Pure preference resolution, reactive DOM theme and cached canvas palette |
| New `src/lib/input/focus.ts`, `src/lib/input/focus.svelte.ts` | Shared focus classification and overlay/performance ownership |
| `src/lib/input/keyboard.svelte.ts`, `src/lib/ui/{Menu,Panel}.svelte` | Apply input policy to DOM/native routing and overlays |
| `src/lib/ui/{Button,Toggle,Select,Field,Param,Segmented,Toolbar,Toolbars,Dock,Split,Kbd,Icon,Section}.svelte` | Existing shared component appearance and accessibility |
| `src/lib/studio/{TransportBar,KeysPanel,StudioView,SessionView,StepSequencer,PianoRoll,PadsPanel,TrackPanel}.svelte` | Studio hierarchy, musical controls, entry points, and state feedback |
| New `src/lib/studio/ClipActions.svelte` | Shared selected-clip actions and position/duration fields |
| New `src/lib/studio/arrangement.ts` | Pure snap, placement, resize, and overlap calculations |
| `src/lib/studio/{Arrangement.svelte,studio.svelte.ts,panels.ts}` | Timeline gestures, commands, insertion state, clip editor selection |
| `src/lib/ui/layout.svelte.ts`, new `src/lib/ui/adaptive.ts` | Persistent user choices plus transient viewport adaptation |
| `src/{App.svelte,lib/Roll.svelte}`, `src/lib/{Toolbar,Progress,WorkspaceSwitch,SettingsSheet,SynthEditor,RoomPanel,Calibrate}.svelte` | App shell, canvas rendering, Learn, settings, sound, and room parity |
| `tests/{theme,input-focus,arrangement,adaptive}.test.ts` | New pure behavioral regression tests |
| `bench/check-studio.ts`, new `bench/check-redesign.ts`, existing `bench/chrome.ts` | Existing musical regressions plus focused browser interaction/theme/layout checks |

Do not split large existing files unless implementing the listed responsibility requires it. Reuse `project.ts` types and `snap()` instead of introducing duplicate musical types.

## Execution and verification conventions

Run commands from `keyfall/`. Before implementation, read the spec, inspect current status, and use the worktree skill to decide whether further isolation is necessary; keep work on the requested redesign branch. Do not create a second independent baseline or reset existing commits.

Reuse `bench/chrome.ts` and its isolated browser profile for repository test runners. Its fixed CDP port 9333 means browser runners run sequentially. No browser UI work is needed while writing this plan. For interactive browser/device work during execution, follow the active tool instructions; native device interaction must use the device tools.

`bench/check-redesign.ts` should support `--suite=theme|focus|menus|studio|arrangement|adaptive|parity|all` and `--shots=<directory>`; default suite is `all`, default output is the OS temporary directory. Create the output directory. Use the existing `withPage()` interface and semantic selectors. Browser assertions use public DOM, persisted project state, and audible/held-note evidence already available to the harness; do not expose a production global just for tests. Exit nonzero on failed assertions or page errors. Add suites alongside their owning tasks, not as a standalone framework task.

For each behavior task: add its failing regression first, run it and confirm the intended failure, implement the change, rerun that focused test, then run `bun run check`. Do not count missing browser dependencies or failed startup as regression proof. Preserve existing musical assertions when updating changed UI entry points.

### Task 1: Establish light/dark themes across DOM and canvas

**Files:** Create `src/lib/theme.ts`, `src/lib/theme.svelte.ts`, `tests/theme.test.ts`, `bench/check-redesign.ts`; modify `index.html`, `src/App.svelte`, `src/app.css`, `src/lib/settings.svelte.ts`, `src/lib/SettingsSheet.svelte`, `src/lib/Roll.svelte`, and fixed palette usages in `src/lib/studio/{Arrangement,SessionView,StepSequencer,PianoRoll,PadsPanel}.svelte`.

**Interfaces:** `theme.ts` exports `ThemePreference = 'system' | 'light' | 'dark'`, `ResolvedTheme = 'light' | 'dark'`, `normalizeTheme(value: unknown): ThemePreference`, and `resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme`. Add `settings.theme: ThemePreference`, loaded/saved under existing `keyfall.settings.v2`. `theme.svelte.ts` exports `theme.current: ResolvedTheme`, `theme.revision: number`, `theme.start(): () => void`, and `readCanvasPalette(element: HTMLElement): CanvasPalette`, whose named fields match existing `Roll.svelte` colors and hand colors. Revision changes after applying resolved colors; canvas reads computed colors on revision, never every animation frame.

- [ ] Before changing product code, capture baseline Studio/Learn images and existing Studio runner results into a temporary artifact directory; record starting HEAD. Build WASM with `bun run wasm` first if absent. Do not commit generated WASM or screenshots.
- [ ] Add tests `invalid preference falls back to system`, `explicit choice overrides system`, and `system tracks appearance`: assert `normalizeTheme('sepia') === 'system'`, explicit light resolves light for either system value, and system resolves each value correctly.
- [ ] Add browser `theme` suite: seed existing keymap/layout/project settings, reload with each preference, change system appearance, and switch theme during playback with a held note. Assert resolved `data-theme`, unchanged musical/project state, changed canvas palette/redraw, and valid release. Include malformed JSON/storage unavailable fallbacks and no settings loss.
- [ ] Run `bun test tests/theme.test.ts` and `bun bench/check-redesign.ts --suite=theme`; confirm behavior failures before implementing.
- [ ] Implement pure functions and persisted preference. Add a short synchronous head script in `index.html` that safely reads the same stored preference and applies `data-theme` and `color-scheme` before paint. Test its decisions against `normalizeTheme` through browser reloads. Start/clean up the reactive system listener from App without recreating Player.
- [ ] Define semantic CSS roles for page, control/display surfaces, text, grid subdivisions, focus, selection, transport, track palette, hands, sounding notes, and errors. Derive all canvas and clip colors from these roles. Replace white-only grid literals and alpha-hex concatenation where the palette becomes CSS variables; use supported `color-mix()` or explicit tinted tokens.
- [ ] Add Light/Dark/System Settings control. Verify primary text contrast at least 4.5:1 and control/focus distinctions at least 3:1 using rendered computed colors; choose darker light-theme accents as needed. Inspect representative Studio/Learn states in both themes.
- [ ] Run focused suites and `bun run check`; commit as `feat: add unified light and dark instrument themes`.

### Task 2: Make input ownership explicit without breaking performance

**Files:** Create `src/lib/input/focus.ts`, `src/lib/input/focus.svelte.ts`, `tests/input-focus.test.ts`; modify `src/lib/input/keyboard.svelte.ts`, `src/lib/Roll.svelte`, `src/lib/studio/{KeysPanel,Arrangement,StudioView,TransportBar}.svelte`, `src/App.svelte`, and `bench/check-redesign.ts`.

**Interfaces:** `InputScope = 'performance' | 'arrangement' | 'ui'`; `scopeForTarget(target: EventTarget | null): InputScope` returns the nearest declared `data-input-scope`, with native interactive/text controls taking `ui` precedence. Explicit clip buttons carry `data-arrangement-clip` and count as arrangement targets; nested fields/actions still take UI precedence. Unclaimed app background retains performance. Reactive singleton `inputFocus` exports `scope`, `blocked`, `start(): () => void`, and `block(): () => void`; `block()` returns an idempotent release function and supports nested overlays. Keyboard/native enablement consumes the same scope and blocking state. Release tracking does not depend on current keydown eligibility.

- [ ] Add pure target tests for contenteditable descendants, number input, select, range, ordinary button, explicit arrangement clip button, explicit performance canvas, and unclaimed background. Assert a slider inside a performance group and a numeric field inside a clip remain UI.
- [ ] Add browser `focus` suite: ordinary Tab navigates; Tab toggles Launch only with explicit performance surface focus; Escape exits that focused surface and permits Tab navigation. Space operates focused buttons, arrows operate fields, Enter opens a focused clip, and Backspace in text never deletes music/restarts transport. A custom mapped key in a text field produces no note. Releasing a key after focus changes clears its original sounding notes exactly once.
- [ ] Run `bun test tests/input-focus.test.ts` and browser focus suite to establish failures.
- [ ] Implement focus ownership in shared input routing and `syncNative()`. Do not blur arbitrary controls to run transport. Mark arrangement and performance roots, focus the playable surface on deliberate activation, and give it an accessible name plus an Escape exit hint. Update the visible Play/Clip Launch toggle and hint text.
- [ ] Keep MIDI performance independent of ordinary DOM focus unless existing explicit mute/record rules require otherwise. Preserve DOM/native chord maps, velocity, sustain, key-up ownership, and blur cleanup. Do not add a second note dispatcher or change native protocols.
- [ ] Run focused checks and existing keyboard triad regression; commit as `fix: scope musical shortcuts to the active interaction surface`.

### Task 3: Unify controls and accessible menus/sheets

**Files:** Modify `src/lib/ui/{Button,Toggle,Select,Field,Param,Segmented,Toolbar,Toolbars,Dock,Menu,Panel,Split,Kbd,Icon,Section}.svelte`, `src/app.css`, and `bench/check-redesign.ts`.

**Interfaces:** Preserve existing component props and variants. Extend Menu props to `{ anchor?: HTMLElement; point?: { x: number; y: number }; returnFocus?: HTMLElement; onclose: () => void; children: Snippet }`; require exactly one anchor or point at call sites. Menu and modal Panel acquire/release `inputFocus.block()` for their mounted lifetime. Anchored menus default return focus to anchor. Non-modal Panel uses ordinary focus policy rather than blocking performance globally.

- [ ] Add `menus` browser tests: arrow navigation skips disabled entries, Enter activates once, Escape/outside click closes, edge positioning stays visible, and focus returns to a surviving trigger. Nested overlays keep input blocked until the last closes. Closing a menu while holding/releasing a note cannot strand it.
- [ ] Run the suite for expected failures; update Menu keyboard handling, initial focus, placement, outside dismissal, cleanup, and return-focus behavior. Preserve existing toolbar and dock menu callers.
- [ ] Apply token-based geometry and states across existing controls. Keep 32–36px desktop heights and at least 44px coarse-pointer hit areas. Add precise numeric entry alongside Param sliders using existing min/max/step/log conversions; reject nonfinite values, clamp finite values, retain accessible labels and units. Avoid adding knobs solely for appearance.
- [ ] Make modal sheets expose dialog semantics, contain focus, restore focus, and respect reduced motion. Remove heavy shadows and decorative gradients; keep native safe-area/titlebar spacing. Ensure separators handle pointer cancellation without stale listeners. Test Param direct entry at min/max, out-of-range finite input, empty/nonfinite input, and logarithmic parameters: values remain finite/in range, invalid input leaves the prior value intact, and slider/direct entry agree.
- [ ] Run menu suite, native-control focus cases, `bun run check`, and inspect controls in both themes; commit as `feat: unify instrument controls and accessible overlays`.

### Task 4: Establish Studio hierarchy and discoverable clip editing

**Files:** Create `src/lib/studio/ClipActions.svelte`; modify `src/lib/studio/{TransportBar,KeysPanel,StudioView,SessionView,StepSequencer,PianoRoll,PadsPanel,TrackPanel,panels}.svelte`, `src/lib/ui/Dock.svelte`, `bench/check-studio.ts`, and `bench/check-redesign.ts`.

**Interfaces:** Export `ClipEditor = 'steps' | 'notes'` from `panels.ts`. Add `studio.clipEditor: ClipEditor` (session state, initially `steps`) and `studio.openClipEditor(trackId: string, clipId: string, editor?: ClipEditor): void`; explicit editor choices update the remembered editor and reveal its dock. ClipActions props are `{ track: Track; clip: Clip; onedit: (editor?: ClipEditor) => void }`; initially render Edit and existing Duplicate/Delete actions, adding timeline-only fields in Task 7. Do not import layout UI into project data helpers.

- [ ] Add `studio` browser cases: create a drum clip through visible actions, edit four kicks in Steps, switch to Notes and back, select another clip, and verify editor preference survives. Session selection/edit actions do not launch clips accidentally; its dedicated Launch action still obeys quantization.
- [ ] Implement stable transport, performance, and selected-clip action groups. Keep Play/Stop, Record, tempo, and position discoverable; put secondary project commands in a labeled menu. Keep octave/transpose/scale/harmony states visible and offer labeled access to velocity/sustain when width requires a sheet.
- [ ] Remove the Studio effect that forces Notes on selected arrangement clips. Wire dock tab choices to the remembered editor. Add visible Session Edit and New Clip paths alongside existing launch controls; keep right-click/hold as editing accelerators without introducing arrangement-style context menus into Session yet.
- [ ] Give Steps/Notes selected track/clip headings. Distinguish played step from step-input cursor, preserve kick-first rows, resolution choices, chords, duration/velocity tools, Rest/Back, shift, doubling, and undoable Clear. Style empty/recording/queued states with text or shape as well as color.
- [ ] Update existing `bench/check-studio.ts` selectors and entry gestures to match intentional UX changes, especially scoped Tab and visible Edit. Preserve triad arrays, recorded-note counts, launch quantization checks, and four-on-floor assertions; do not weaken them to make a new UI pass.
- [ ] Run `bun bench/check-redesign.ts --suite=studio`, `bun run check:studio`, and `bun run check`; commit as `feat: clarify Studio transport performance and clip editing`.

### Task 5: Define safe arrangement commands and timing helpers

**Files:** Create `src/lib/studio/arrangement.ts`, `tests/arrangement.test.ts`; modify `src/lib/studio/studio.svelte.ts`, `src/lib/studio/ClipActions.svelte`, and `bench/check-redesign.ts`.

**Interfaces:** Export `ArrangementSnap = 'bar' | 'beat' | 'eighth' | 'sixteenth'`, `gridFor(snap: ArrangementSnap, beatsPerBar: number): number` mapping to `[beatsPerBar, 1, 0.5, 0.25]`, `findAvailableStart(clips: readonly Clip[], requested: number, length: number, grid: number): number`, `overlaps(clips: readonly Clip[], start: number, length: number, excludeId?: string): boolean`, and `resizeBounds(clip: Clip, requestedLength: number, grid: number): Pick<Clip, 'length' | 'repeat'>`. Inputs reaching helpers are finite with positive grid/length. Reuse `snap()`; touching clip edges do not overlap. Placement rounds at or after the requested time, then advances to the end of each intersecting interval on-grid until free.

Add session-only `studio.arrangementSnap` (default `beat`) and `studio.insertion: { trackId: string; beat: number } | null`. Add `studio.addArrangementClip(trackId: string, requested: number): Clip | null`, `studio.setClipBounds(trackId: string, clipId: string, start: number, length: number): void`, and `studio.loopClip(trackId: string, clipId: string): void`. Invalid/nonfinite numeric edits are ignored without history changes. Keep existing `addClip()` for other callers. Timeline `duplicateClip()` uses free placement; Session duplication keeps existing next-empty-slot semantics.

- [ ] Write pure tests with exact assertions: Beat grid is `1`, 1/16 is `.25`, Bar in 3/4 is `3`; clips `[0,4)` and `[4,8)` place a four-beat copy requested at `4` at `8`; unsorted existing overlaps produce the same result; touching `[8,12)` is not overlapping `[4,8)`.
- [ ] Test resize: ordinary length/repeat `8/8` to `4` becomes `4/4`; looping `8/2` to `4` becomes `4/2`. Source `notes` remain unchanged; shortening and restoring an ordinary clip restores scheduled notes. Test negative requested positions clamp to zero and duration snaps with minimum one grid unit.
- [ ] Run `bun test tests/arrangement.test.ts` for expected failures, implement helpers and Studio commands using one `studio.edit()` per committed action, and rerun. Add browser assertions for independent duplicate edits, invalid numeric edits, selection of newly created copy, and undo restoring the source state.
- [ ] Add start/duration fields for timeline clips only, using musical units and labeled values. Show existing repeat period read-only. Loop-to-clip updates loop bounds/enabled in one undoable edit and never starts transport. New Clip defaults to one bar, reports actual placement when moved to avoid overlap, and respects selected track/insertion position.
- [ ] Run pure tests, arrangement command browser cases, `bun test tests`, and `bun run check`; commit as `feat: add safe arrangement placement and clip commands`.

### Task 6: Implement predictable timeline gestures and cancellation

**Files:** Modify `src/lib/studio/Arrangement.svelte`, `src/lib/studio/arrangement.ts`, `bench/check-redesign.ts`, and `tests/arrangement.test.ts` as needed for new pure gesture calculations.

**Interfaces:** Arrangement owns ephemeral `DragPreview = { pointerId: number; kind: 'move' | 'resize' | 'loop-move' | 'loop-start' | 'loop-end'; original: { start: number; length: number; repeat: number }; proposed: { start: number; length: number; repeat: number }; clipId?: string; trackId?: string }`. Preview never mutates the project. Release resolves IDs against the current project and commits once; missing targets cancel safely. Escape, lost capture, pointercancel, blur, component destruction, or an external project replacement discard preview without history changes.

- [ ] Add browser arrangement tests: repeated lane clicks only select/update insertion; New Clip and double-click create exactly one clip; double-clicking an existing clip edits without moving/creating; non-primary presses never start gestures.
- [ ] Add move/resize tests for Beat and 1/16 snap, start zero, minimum duration, source-note retention, repeat retention, overlap warning, and one-step undo. Test Escape/pointercancel/lost capture before and after threshold: unchanged persisted bounds and unchanged undo count. Include project replacement during drag.
- [ ] Run new cases for expected failures. Replace live project mutation with preview geometry and commit-on-release. Suppress click/double-click side effects after a completed gesture. Show original outline, proposed bounds, and overlap warning. Guard primary pointer and make pointer cleanup idempotent.
- [ ] Add distinct insertion marker, playback head, loop ruler strip, Snap selector, and exact loop start/end controls. Keep seek separate from selection and snapping. Preserve timeline zoom and sticky track/ruler headers; zoom around the current visible time rather than jumping to the beginning.
- [ ] For coarse pointers, provide selected-clip move/resize grips with 44px hit areas when space permits; otherwise expose exact fields. Clip body retains normal selection/scroll behavior. Optional hold actions cancel on movement; no mandatory long press. Add touch tests for horizontal/vertical scrolling, diagonal gesture cancellation, tiny clips, and orientation changes mid-gesture.
- [ ] Run arrangement suite and `bun run check`; commit as `feat: add cancellable arrangement gestures and explicit insertion`.

### Task 7: Add arrangement context actions and focused shortcuts

**Files:** Modify `src/lib/studio/{Arrangement,ClipActions,TrackPanel}.svelte`, `src/lib/ui/Menu.svelte` only if a missed placement requirement appears, and `bench/check-redesign.ts`.

**Interfaces:** Arrangement menu target is a discriminated union `{ kind: 'clip'; trackId: string; clipId: string } | { kind: 'lane'; trackId: string; beat: number } | { kind: 'track'; trackId: string }`. Store IDs and opening coordinates, not mutable clip objects. Resolve the target when activating a command; absent/deleted targets close harmlessly. ClipActions remains the visible equivalent of clip commands.

- [ ] Add browser cases: right-click clip B while A is selected operates only on B; Shift+F10 opens focused clip actions; menu near viewport edges remains visible; Escape returns focus without deleting/restarting; removed targets cannot redirect commands to a different clip.
- [ ] Wire clip menu actions Edit in Steps, Edit in Notes, Duplicate, Set Playback Loop to Clip, and separated Delete Clip. Lane menu offers New Clip Here. Track menu offers Track Settings, Mute/Unmute, Solo/Unsolo. No custom ruler menu or speculative disabled actions.
- [ ] Wire visible action buttons and touch action sheet to the same command functions. Right-click itself never changes music. Resolve the distinction between selecting the menu target for context display and changing playback: only selection may change.
- [ ] Handle Delete/Backspace, Primary+D, and Enter only from focused arrangement editing surfaces. Ignore fields, controls, overlays, performance focus, repeats where destructive duplication would repeat, and composing text. Respect `defaultPrevented` so a menu event cannot trigger a second command. Keep native/global shortcuts under Task 2 policy.
- [ ] Run menu/focus/arrangement suites and `bun run check`; commit as `feat: add contextual arrangement actions and keyboard editing`.

### Task 8: Make workspace adaptation preserve user context

**Files:** Create `src/lib/ui/adaptive.ts`, `tests/adaptive.test.ts`; modify `src/lib/ui/layout.svelte.ts`, `src/lib/ui/{Split,Dock}.svelte`, `src/lib/studio/{StudioView,TransportBar,KeysPanel}.svelte`, `src/lib/studio/panels.ts`, `src/App.svelte`, and `bench/check-redesign.ts`.

**Interfaces:** `workspaceMode(width: number, height: number): 'wide' | 'focused'` is pure. Initial wide eligibility is width at least 1100px and height at least 760px, allowing project/editor/keyboard minima with chrome; all other sizes use focused surfaces. Reassess those thresholds against actual component measurements, keeping the test fixtures as acceptance sizes. `layout.surface: 'project' | 'editor' | 'performance'` and `layout.inspectorOpen` are transient. Existing persisted dock preferences are not rewritten by viewport transitions. Existing `layout.narrow` remains available to unaffected callers while adaptation migrates.

- [ ] Add pure eligibility tests for all five design checkpoints and boundary values. Add browser `adaptive` cases for each size, both themes, and coarse/fine pointer capability. Assert visible accessible transport, no app-chrome horizontal overflow, reachable octave/transpose/scale/harmony settings, and usable focused surface.
- [ ] Test valid saved dock sizes/locations, unknown panel IDs, nonfinite/oversized sizes, and malformed stored layout. Sanitize only invalid fields, clamp rendered sizes to available space, and preserve valid user choices. A viewport change must not overwrite desktop layout preferences.
- [ ] Implement wide default composition and focused Project/Editor/Performance navigation. Keep Session/Arrange distinct from Steps/Notes. Collapse inspector into a labeled sheet on focused layouts. Do not squeeze four unusable panes onto short landscape screens.
- [ ] Preserve scroll positions and selection per surface without recreating Player or reattaching Studio audio on each tab. If conditional rendering is necessary, retain scroll state keyed by surface/clip; prevent mounting effects from overriding selected editor. Orientation changes cancel pending gestures safely.
- [ ] Run focused tests and browser suite; inspect min-size panes, 44px coarse targets, safe areas, and native window-control inset; commit as `feat: adapt Studio layouts without losing editing context`.

### Task 9: Complete Learn, sound, settings, and room parity

**Files:** Modify `src/{App.svelte,app.css}`, `src/lib/{Toolbar,Progress,WorkspaceSwitch,SettingsSheet,SynthEditor,RoomPanel,Calibrate}.svelte`, `src/lib/ui/Param.svelte` if numeric conversions need correction, and `bench/check-redesign.ts`.

**Interfaces:** Reuse theme, shared control, input-blocking, and overlay contracts. Preserve current sound editor ownership: label the edited preset accurately; do not silently retarget the global sound editor to a track patch or add a new synth routing model. Track inspector identifies selected track/preset independently.

- [ ] Add `parity` browser cases: Studio-to-Learn practice transition retains notes/parts; import/export remains available; Learn canvas hand/hit feedback works in both themes; custom keymap editing suppresses performance; Settings and synth naming fields accept typing without notes.
- [ ] Style room role/connection/host-controlled action states in the shared system. Exercise disconnected, connecting, host, guest, and error states through the existing room backend/test setup where available. Pair ownership colors with readable names; do not claim network behavior validated from static fixtures alone.
- [ ] Group existing sound parameters by musical purpose, retain precise Param entry, values/units, Save/Save As/Revert/Delete and sampled-preset states. Add a small envelope curve only if it can accurately derive from existing parameters; no waveform decoration with fabricated data.
- [ ] Unify empty/loading/error/status feedback, avoid unnecessary toast motion, preserve calibration/audio/MIDI selection, and test offline reload without font/network dependency. Respect reduced-motion across pulses and fly transitions while keeping playback position accurate.
- [ ] Run parity/focus suites, `bun run check`, and representative Learn/Studio/overlay visual inspection; commit as `feat: unify Learn sound settings and room interfaces`.

### Task 10: Verify complete behavior and record delivery evidence

**Files:** Modify `bench/check-redesign.ts`, `bench/check-studio.ts` only for justified missing acceptance, and create `docs/superpowers/reports/2026-11-13-instrument-redesign-validation.md` during execution. Store screenshots outside source control under a documented temporary artifact directory.

**Interfaces:** Validation report records exact HEAD, commands, exit status, theme/viewport/input combinations inspected, artifact paths, available native platforms, and explicit unverified checks. It must distinguish automated behavior, visual inspection, compilation, and actual device interaction.

- [ ] Run `bun test tests`, `bun run check`, `bun run build`, `bun run check:studio`, then `bun bench/check-redesign.ts --suite=all --shots=<artifact-directory>` sequentially. Require zero test failures/page errors and successful type/build output. Fix only failures attributable to this scope; document unrelated failures without weakening assertions.
- [ ] Inspect representative Studio and Learn images in both themes at the five sizes, plus Steps, Notes, arrangement menu, sound/settings sheet, and recording states. Check contrast, clipping, focus, state distinction, grid legibility, and coarse target sizes. Compare with pre-change baseline images captured before Task 1 implementation.
- [ ] Run `cargo test -q -p keyfall-dsp -p keyfall-room -p keyfall` if input/audio integration changed, plus `cargo clippy -q --workspace --all-targets`. If Android target/toolchain is available, run `cargo clippy -q --target aarch64-linux-android` from `src-tauri/`. Record unavailable platform checks explicitly; do not install a new toolchain without task need.
- [ ] Exercise desktop native key-on/key-off, focus into a field/menu, harmony, transpose, sustain, blur, theme switching, and recording if launch is available. For Android interaction use `device_list`, `device_open`, and its returned `agent-device` command; inspect using `device_screenshot`. Builds and installs may use platform build tools. If device tooling/platform is unavailable, report the interactive path unverified.
- [ ] Confirm a clean final diff for project schema, DSP, protocol, and music features outside scope. Record the intentional UX changes: explicit clip creation, focused Tab/Enter/Delete behavior, visible edit actions, and transient adaptive layout.
- [ ] Write validation report, run `git diff --check`, commit as `docs: record instrument redesign validation`, and hand back branch/commit plus evidence and limitations. Implementation completion means all ten tasks, not theme styling alone. A PR, push, merge, or deployment is not part of this plan unless separately requested.

## Dependency order and delivery checkpoints

Execute Tasks 1–10 sequentially. Task 5 pure helper work could be independent, but the initial plan uses one implementer to avoid collisions in Studio, theme, and menus. Do not spawn parallel writers over these shared files.

- After Task 3: both themes and shared controls are usable; keyboard focus and overlays are safe.
- After Task 4: existing Studio musical workflows have visible entry points.
- After Task 7: arrangement mouse/touch/keyboard actions follow the same command model.
- After Task 9: adaptive Studio and remaining app surfaces form one system.
- After Task 10: delivery claims have recorded evidence and platform limits.

## Plan self-review

- Spec coverage: theme/material/color ownership → Task 1; performance/focus/accessibility → Tasks 2–3; Studio/steps/session hierarchy → Task 4; arrangement timing/commands/gestures/menus → Tasks 5–7; layout/preferences → Task 8; Learn/sound/settings/rooms → Task 9; full acceptance/native evidence → Task 10.
- Interfaces: all new functions/types are defined above; later tasks consume those names. Project Clip/Track types, scheduling, and `studio.edit()` remain authoritative. No separate history or audio scheduler is introduced.
- Failure coverage: all five Review Focus items have owning regression steps. No test asserts incidental class names, a particular arbitrary font, or a fabricated pixel-perfect device clone.
- Execution boundary: this is a planning deliverable. Code implementation and runtime validation have not run as part of writing it.

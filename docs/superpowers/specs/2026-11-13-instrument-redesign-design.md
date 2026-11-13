# Keyfall instrument redesign

Status: proposed design for user review; implementation is not started.
Branch: `redesign/op1-studio`. Baseline: `1513b45`.

## Intent and confirmed direction

Keyfall should feel like a coherent musical instrument across Studio, Learn, sound editing, settings, and connected rooms. The user requests minimalism, intuitive interaction, responsive and adaptive layouts, and playful industrial character inspired by Teenage Engineering.

Confirmed visual direction:

- Light theme takes inspiration from OP-1: warm pale surfaces, clear dark markings, restrained functional color.
- Dark theme takes inspiration from OP-XY and OP-Z: graphite and black surfaces, precise light markings, compact illuminated feedback.
- Both themes share information architecture, control positions, terminology, and behavior.
- Nothing is a secondary reference for useful typography and status ideas, rather than a separate visual identity.
- Computer-keyboard performance, octave changes, transposition, harmonization, and sequencing are core product priorities.

The decisions below are design proposals, not additional user requirements.

## Approaches and choice

1. **Visual reskin:** update colors, fonts, and control shapes. Smallest change, but preserves toolbar crowding and hidden entry points.
2. **Unified instrument design system:** redesign shared controls and workspace hierarchy, adapt the existing panels, and theme both DOM and canvas rendering. Recommended; best fit for the user's request for unified, intuitive UX.
3. **Literal hardware simulation:** reproduce a fixed device enclosure, four encoders, and hardware-style pages. Strong resemblance but restricts editing space, responsiveness, and discoverability.

The user's latest direction establishes a unified light/dark instrument identity. This proposal develops approach 2. It does not assume approval of every layout or interaction detail below.

## Goals and boundaries

Goals:

- Make the next useful action visible for playing, creating a pattern, editing notes, and shaping sound.
- Keep a stable mental model across themes, screen sizes, pointer types, and workspaces.
- Preserve existing tracks, clips, sessions, arrangements, recording, MIDI, custom keymaps, export, collaboration, and native audio paths.
- Give functional color and playful graphics a clear musical purpose.

Outside this redesign:

- New DSP, synth engines, arpeggiators, probability, ratchets, swing, or other sequencer features.
- A fixed four-track limit, hardware emulation, new project formats, or a framework replacement.
- New branding based on another manufacturer's logo, device name, or proprietary assets.
- Adding a four-macro modulation system merely to resemble hardware encoders.

Failure conditions include lost functionality, smaller musical editing areas for decorative chrome, hidden essential controls, tiny low-contrast text, color-only meaning, or input delays from visual animation.

## Existing implementation and affected surfaces

The app uses Svelte 5 and Tailwind 4, with a Rust DSP engine, web audio, and native desktop/Android paths. Reuse this stack and its state owners.

- `src/app.css` supplies a single dark palette. Add semantic light/dark tokens here.
- `src/lib/ui/` owns shared buttons, fields, parameter controls, toolbars, menus, and docks. Evolve these components rather than creating a parallel library.
- `src/lib/ui/layout.svelte.ts` persists panel placement and sizes; currently collapses docks below 768px. Preserve saved layouts and derive sensible defaults for missing values.
- `src/lib/studio/TransportBar.svelte` and `KeysPanel.svelte` expose transport and performance controls through priority-based toolbar overflow. Reorganize into stable groups.
- `StudioView.svelte`, `panels.ts`, and clip selection determine editor visibility. Coordinate defaults so effects do not reopen Notes when a user chooses Steps.
- `Roll.svelte` draws keys and notes on canvas with hard-coded colors. Resolve colors from the same theme source as DOM components and redraw when the resolved theme changes.
- Arrangement track colors, session indicators, and grid lines in Steps and Notes contain additional fixed colors. Move those into semantic tokens too.
- `settings.svelte.ts` owns persisted app preferences. Add theme preference without losing existing settings.
- Review Settings, SynthEditor, RoomPanel, Learn toolbar, menus, dialogs, and native titlebar spacing as part of the same system.

## Visual system

### One geometry, two materials

Light uses a warm off-white page, pale grey control surfaces, near-black text, and a dark musical display where helpful. Dark uses near-black page, graphite control surfaces, and off-white text. Theme changes recolor the same layout; they never change the selected track, active editor, playback, or notes.

Both themes use:

- Flat opaque panels, hairline separators, modest consistent corner radii, and generous spacing between functional groups.
- Familiar transport symbols, small geometric icons, and explicit labels for unfamiliar actions.
- A readable sans-serif for controls and a monospace for musical values and shortcuts. Bundle any new font locally with its license.
- Ordinary readable weights for functional text. Thin display type and dot-matrix numerals are optional accents at large sizes only.
- No ornamental glass, faux screws, heavy shadows, gradients used for decoration, blinking backgrounds, or spring animations. CSS gradients used to render regular grid lines are acceptable.

Use a compact 4px spacing scale. Proposed desktop controls are 32–36px high; touch targets are at least 44px. Primary functional text is 14–16px, with smaller secondary labels only where readable. Text follows normal music notation: preserve C, MIDI, BPM, and similar established forms. Do not force lowercase musical notation.

### Color has a job

Adopt a restrained blue, green, amber/orange, and neutral palette with contrast-adjusted light/dark variants. Exact values remain a builder decision, verified in rendered screens.

- Track identity stays consistent through session cells, arrangement clips, editor notes, and audition feedback. Existing projects retain their track order and identity; do not restrict track count to the accent count.
- Parameter group markers may use color locally, paired with labels and values. They do not create new musical routing semantics.
- Recording uses a record symbol plus explicit state text; errors include text; neither depends on red alone.
- Selected, sounding, queued, recording, muted, and disabled states have distinct labels, outlines, shapes, or patterns as well as color.
- Active step and playhead must remain distinct when they intersect. White is a neutral indicator, never an invisible track color on light surfaces.
- Learn hand colors retain a distinct semantic role from Studio track colors and remain consistent between themes.

Nothing-inspired dot typography can accent a large transport position or tempo readout if readable. Small note labels, editable values, grid indices, and shortcuts remain crisp conventional type. Sparse dot texture is optional on unused chrome only; never behind notes or controls.

## Information architecture and default Studio layout

Maintain Studio and Learn as the top-level workspaces. Within Studio, distinguish three concepts explicitly:

1. **Project view:** Session or Arrange.
2. **Selected clip editor:** Steps or Notes.
3. **Performance and sound:** Keyboard or Pads, plus selected-track controls.

These are different axes; do not turn them into one ambiguous tab bar.

On a roomy desktop, the default composition is:

- Compact header: project/workspace, transport, tempo/position, project actions, theme/settings.
- Main area: Session or Arrange, with a collapsible selected-track sound inspector.
- Clip editor: Steps or Notes with selected track and clip named in its header.
- Bottom performance area: clearly labeled octave, transpose, scale, harmony, velocity, sustain, and playable keys or pads.

Keep existing resizing, panel movement, and hide/show capabilities. Defaults should work without arranging panels first. Allocate space by available width and height; all panes keep minimum usable sizes. Collapse the inspector before shrinking musical controls below usable targets. Short landscape windows must offer a clear workspace/editor focus switch rather than compressing four panes into unusable strips.

Transport Play/Stop, Record, tempo, and position stay discoverable. Secondary project management can live in a labeled project menu. Avoid two unrelated overflow menus as the only way to find an ordinary musical action.

## Core interaction flows

### Start playing

Entering Studio presents the selected instrument and keyboard mapping. Octave, transpose, scale, and harmony show current values. Scale lock clearly shows whether it is enabled and explains its downward snap behavior. Sustain has a visible latched/held state.

Settings controls must not steal or retrigger held notes. Keyboard routing must distinguish musical performance from text entry, native field operation, dialogs, and keyboard navigation. Preserve existing shortcut assignments where compatible with native accessibility; resolve collisions explicitly rather than intercepting all keys globally. Show Play versus Clip Launch mode in text, not just a colored icon.

In particular, audit the current global Tab-to-launch behavior: ordinary Tab navigation must remain available. Proposed resolution is to retain Tab only in an explicitly activated musical keyboard surface, with a documented way to leave that surface; elsewhere use a visible Clip Launch toggle. Final collision handling is an implementation decision tested against the existing custom mappings and native input path.

### Create and edit a pattern

An empty Studio offers an explicit way to add an instrument or drums and create a first clip. Selecting an existing clip makes a labeled Edit action available; right-click and long-press remain accelerators, not the sole entry point.

Steps is the proposed default editor for a newly created clip. Notes remains one switch away. Remember the last explicitly chosen editor during a session; clip selection must not override it unexpectedly.

Group the sequencer grid by beat and bar. Show clip length, resolution, selected row, playhead, step-input cursor, and velocity without competing visual emphasis. Drum rows retain kick-first ordering. Preserve whole-chord keyboard step input, Rest, Back, duration dragging, velocity cycling, shift, doubling, Clear, live editing, and session/timeline behavior.

Clear is visually separated from routine pattern operations and remains undoable. Controls whose behavior depends on a selection state their target in the editor heading or label.

### Arrange MIDI on the timeline

The user has not specified arrangement gestures or context menus. Treat the following as designer-proposed behavior, based on the existing clip model, rather than confirmed user preferences. Arrangement interaction is part of the redesign, not merely a color treatment.

Current behavior creates a clip when an already selected lane is clicked, selects and moves a clip by dragging its body, resizes through its right edge, and seeks through the ruler. Session right-click opens Steps directly; Arrangement has no context menu. Replace ambiguous selection-dependent creation with explicit actions.

#### Selection and editing

- Click/tap a clip to select it. Selection alone does not start playback or create notes. The inspector identifies its track, start, and duration, and exposes Edit, Duplicate, and Delete.
- Double-click a clip or press Enter on a focused clip to open its editor. Use the last chosen Steps/Notes editor, defaulting to Steps when no choice exists. A visible Edit action provides the touch equivalent.
- Click/tap empty lane space to select that track and an insertion position. Do not create a clip on an ordinary selection click. The timeline insertion marker is distinct from the playback head and step-input cursor.
- A visible New Clip action creates a clip at that insertion position; when no insertion position exists, use the playback position snapped to the active arrangement grid. Double-click empty lane space is a desktop accelerator. Default duration remains one bar initially, with duration editable in the selected-clip controls.
- Show a helpful empty-state action for adding the first track and clip. Clip selection and editor context remain visible when the timeline scrolls.

#### Movement, resizing, and musical timing

- Drag a clip body horizontally to move it within its track. Show its original outline, proposed position, and start value. Commit one undo operation on release. Escape or pointer cancellation restores the original state, releases pointer capture, and leaves no partial edit.
- Show a distinct right-edge resize affordance for the selected clip. Resize changes the clip boundary; it never time-stretches notes. Show proposed duration before committing. Exact start and duration fields offer a precise non-drag alternative.
- Preserve stored note events when shortening a clip. Notes outside its audible boundary remain stored; extending it restores their visibility/audibility where the existing pattern repeat semantics permit. Explain this in the clip controls rather than silently deleting notes.
- For an existing repeating clip, resizing retains its repeat period. For an ordinary clip, extending adds available duration rather than silently enabling repetition. Surface an existing repeat period as a labeled value where supported; do not invent an ambiguous loop handle.
- Provide a labeled arrangement Snap control, separate from note quantization and session launch quantization. Proposed choices: Bar, Beat, 1/8, 1/16; default Beat, preserving existing move granularity. Insertion, movement, and resizing use this same grid. Minimum duration is one grid unit and start cannot be negative. Ruler seeking remains independent of snap.
- Show the playback loop on its own ruler strip, visually distinct from clip repetition. Its start/end controls and enabled state are visible; dragging remains an accelerator. Selection alone never changes the playback loop.
- Preserve any existing overlapping clips and their additive playback. New Clip and Duplicate choose an available position on the selected track at or after the requested position and announce the actual position. A move/resize that overlaps another clip shows a clear overlap warning in the preview; it does not overwrite or erase either clip. Do not add automatic ripple editing or merging.
- Cross-track moves, multiselection, marquee selection, split, clipboard transfer, and linked duplicates are outside the initial redesign slice. Do not display nonfunctional menu items for them. They can be designed separately if requested.

#### Context menus and visible alternatives

Right-click is a shortcut to the same actions available in labeled controls. It must never move, resize, seek, create, or launch anything. Filter non-primary pointer presses before starting any drag. Right-click first identifies its target, then opens the menu; commands act on that target rather than a stale selection.

| Target | Initial menu actions | Visible equivalent |
| --- | --- | --- |
| Clip | Edit in Steps; Edit in Notes; Duplicate; Set Playback Loop to Clip; Delete Clip | Selected-clip action strip and action menu |
| Empty track lane | New Clip Here | New Clip at the visible insertion position |
| Track header | Track Settings; Mute/Unmute; Solo/Unsolo | Track controls and selected-track inspector |
| Ruler | No custom menu required initially | Seek and labeled playback-loop controls |

Duplicate creates an independent copy, selecting it and placing it after the source at the first available position; editing the copy does not change the source. Set Playback Loop to Clip copies its start/end to the playback loop and enables that loop, without changing clip repetition or starting transport. Delete Clip removes only the targeted clip, remains undoable, and is separated from routine editing actions. Existing track deletion remains in Track Settings, with explicit destructive labeling.

On touch, selection reveals the same actions without a hold gesture. Long-press may open the action sheet as an optional accelerator, cancelled by movement or scrolling. One gesture must not both open actions and edit a clip. On coarse pointers, selection reveals a dedicated move grip and resize grip, leaving the rest of the clip available for selection and timeline scrolling. Grips have at least 44px hit areas; when clips are too narrow, precise fields provide the usable equivalent. Existing musical content scrolls horizontally and track lanes vertically; do not globally disable touch scrolling.

Context menus support arrow-key navigation, Enter activation, Escape dismissal, focus restoration, and viewport-edge placement. Shift+F10 or the context-menu key opens actions for the focused clip. Menu focus suspends musical shortcuts; dismissing it does not trigger a note, delete a clip, or change transport.

When the arrangement itself has editing focus, Delete/Backspace removes the selected clip and Primary+D duplicates it. Enter opens the editor. These commands do not run from a text field, parameter control, menu, dialog, or active performance surface. Preserve global undo/redo, clearly indicate which surface owns focus, and show shortcut hints in the action menu. Do not take existing musical arrow keys for clip navigation without an explicit focus boundary; track and clip buttons must remain reachable through ordinary focus navigation.

#### Arrangement-specific acceptance

Verify ordinary lane selection never creates a clip; New Clip uses the indicated position; Edit works with mouse, touch, and keyboard; right-click cannot initiate a drag; duplicate edits are independent; delete and drag each undo in one operation; cancelled drags restore original values; shortening retains source notes; repeating clips retain their period; overlap previews never erase content; menu dismissal restores focus without notes; and touch scrolling does not accidentally move clips. These checks extend the existing Studio regression runner only for implemented behavior.

### Shape sound

Use the existing patch parameters, grouped by their musical purpose. Pair an envelope with its curve where practical; show numeric values and units alongside controls. A knob is optional: every parameter still needs an accessible keyboard interaction and precise value entry. No decorative encoder with unspecified behavior.

Keep the selected track context visible when opening sound editing. Do not rebuild the synth editor or invent macro assignments in the first implementation slice.

### Learn and rooms

Learn reuses the same transport grammar, theme tokens, keyboard labels, focus behavior, settings, and feedback styles. Preserve hand distinction, hit/miss feedback, calibration, MIDI import, and links between Studio and Learn.

Room status remains explicit: connection, role, and host-controlled actions have readable labels. Existing connected-user colors and shared ownership cues must remain legible in both themes.

## Adaptive behavior

Use available component space plus pointer capability, not only device names. Initial design checkpoints are 390×844, 844×390, 768×1024, 1280×800, and 1920×1080; these are validation sizes, not rigid breakpoints.

- Wide: project, clip editor, inspector, and performance area can coexist.
- Medium or short: collapse inspector into a sheet and offer deliberate project/editor focus. Preserve visible context and transport.
- Narrow: one main task surface at a time with explicit project view, clip editor, and performance navigation. Sound controls open in a dismissible sheet. Preserve each surface's scroll and editing state.
- On touch, retain 44px targets and scrollable grids. Show sufficient step width instead of squeezing every step onto the screen.
- Keyboard access does not disappear just because a narrow layout is active; a visible Play/Launch state and route to performance settings remain available.
- Respect safe areas, orientation changes, and native desktop window controls. Avoid horizontal scrolling of app chrome; musical grids may scroll intentionally.

Offer Light, Dark, and System in Settings. Proposed default is System. Persist explicit choice; System follows platform changes. Apply the resolved theme before first paint and update canvas palettes without recreating audio or player state.

## Accessibility and feedback

- Target WCAG AA text contrast, visible focus, and sufficient contrast for controls, grid boundaries, selections, and playhead.
- Use proper buttons, labels, numeric fields, and accessible names. Provide textual state for icon controls and `aria-pressed` where appropriate.
- Menus and dialogs support Escape, deliberate focus entry, and focus restoration. Text editing does not play notes.
- Reduced motion disables ornamental movement and pulses; playback position remains accurate. Do not announce every sequencer tick to screen readers.
- Audio and MIDI state update synchronously with existing timing paths. Decorative feedback never gates note delivery.
- Preserve release semantics when settings, track context, theme, layout, or window focus changes; verify the supported behavior rather than adding a second note-routing layer.

## Delivery slices

1. **Foundations:** semantic theme tokens, persisted theme choice, shared controls, typography, canvas/grid palettes. Establish matching light/dark states.
2. **Studio:** transport hierarchy, clip editor entry points, Steps/Notes context, performance controls, and adaptive panel defaults. Include focus/shortcut collision fixes required by these interactions.
3. **Remaining surfaces:** Learn, sound editing, Settings, rooms, menus, dialogs, and empty/error states.
4. **Validation:** rendered checks across sizes and themes plus meaningful keyboard/sequencer regression checks and available native checks.

Stage 1 alone does not constitute completion of the unified redesign. Do not expand the work into new music features.

## Acceptance and evidence

Before calling the redesign complete:

- Switching light/dark/system updates all surfaces, canvas keys, note colors, grids, overlays, and status indicators without interrupting playback or losing edits.
- A user can add drums, create a clip, program a four-on-floor pattern, switch to Notes, and return without a context menu or hidden editor requirement.
- Computer-keyboard octave/transpose/scale/harmony/sustain and chord step input behave correctly with DOM and native routing. Verify no stuck notes after relevant focus/layout/theme changes.
- Tab navigation, text inputs, sliders, selects, menus, and dialogs work without unintended performance or transport shortcuts.
- Session and arrangement editing, custom keymaps, MIDI, recording, undo, import/export, and Learn remain available.
- Existing saved settings and panel layouts load safely. New defaults are used only where no valid preference exists.
- At the design checkpoints, transport remains accessible, controls do not overlap, and task surfaces retain usable dimensions. Check coarse pointer and reduced-motion states.
- Run relevant Svelte/TypeScript checks, build, existing TypeScript tests, and the Studio regression runner. Run Rust checks if native input or audio integration changes. Report desktop/Android interactive checks separately from compilation; unavailable checks remain explicitly unverified.
- Record before/after screen evidence for representative Studio and Learn states in both themes.

## Reference assessment

- [Teenage Engineering community skill](https://github.com/dot-Justin/teenage-engineering-ui-ux-skill/blob/main/SKILL.md): useful restraint, palette, geometry, and industrial vocabulary. Its primary subject is TE's marketing and documentation website; do not transplant giant whitespace, tiny thin text, shopping layouts, or viewport-scaled control sizes into the instrument.
- [Nothing UI](https://github.com/wangbh030722/vibe-nothing-ui-design): useful status hierarchy, open typography, and monochrome foundations. Its strict monochrome and developer-console patterns are selective references. Musical identities may use functional color. No wholesale stylesheet or JavaScript import is required.

## Decisions left to implementation

Exact accessible color values, choice of local open font, modest radius scale, icon drawings, precise adaptive thresholds, and parameter visualization details can be settled during implementation. Keep them consistent through shared tokens and components.

Major unresolved product decisions: none required to evaluate this proposal. User review should confirm or change the proposed defaults and hierarchy before implementation planning.

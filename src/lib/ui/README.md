# Keyfall UI

The parts every screen is built from. Phones in a browser come first: every part works by touch alone, fits a 360px-wide screen, and keeps clear of the notch, the home bar and the on-screen keyboard. Desktop adds density and shortcuts on top.

You can see every part in every state at `/#ui`. `bun run check:ui` photographs that page on a phone and a desktop in both themes and checks its behaviour.

## Tokens

Tokens are defined in `src/app.css`. Use them instead of one-off values in brackets.

| Token | Use |
| --- | --- |
| `bg`, `surface`, `raised`, `hover`, `line`, `fg`, `muted`, `mint`, `danger`, `display`, `knob-*`, `track-*` | Colours. Each has a dark and a light value. |
| `text-label` / `.label` | The instrument's small capitals for control names and key captions (11px mono uppercase). Nothing is smaller. |
| `text-xs` 12 · `text-sm` 14 · `text-base` 16 · `text-lg` 18 | Every other text size. |
| `h-control`, `size-control` | A control's height: 36px with a mouse, 44px on touch. |
| `h-control-sm` | A compact control: 28px with a mouse, 40px on touch. |
| `rounded-control` 4px · `rounded-surface` 12px | Corners of controls and of displays and sheets. |

Sizes follow `pointer: coarse`, not screen width. A touch laptop gets fingertip controls, and a phone with a mouse attached gets compact ones.

## Parts

| Part | What it is for |
| --- | --- |
| `Button` | Every button. Variants: `solid`, `ghost`, `accent`, `danger`, `lit` (the active key). Shapes: `pill`, `square` and `round`; give the last two an `aria-label`. `caps` sets the label in small capitals. |
| `Segmented` | One choice of a few, all in view, as a radio group. Use it for up to about five short names. |
| `Select` | One choice of many. It is the native select on purpose, because phones open their own picker. |
| `Toggle` | On or off. |
| `Field` / `Section` | A label over a control, and a titled group of fields. |
| `Toolbar` | A row of actions that never scrolls or wraps. What does not fit moves into a More menu. |
| `Menu` + `MenuItem` | A list of actions beside its button, or at the pointer for a context menu. On a phone it is a bottom sheet. |
| `Popover` | Any content tied to what opened it, such as a small form. It is placed like a menu. |
| `Panel` | A side panel. On a phone, a modal panel rises from the bottom and a non-modal one drops from the top. |
| `use:hold` | A context action: right-click, or a finger held still for half a second. iOS sends no `contextmenu` event, so never use `oncontextmenu` alone. |
| `device/Control` | A value you drag, scroll, tap open or type into. It is built on `KnobSpec`. |

## Rules

- **Every action has a visible control.** A shortcut, double-click, hover or right-click can be a faster way in, but never the only one. Use `use:hold` for context menus, and put Reset inside the opened value.
- **Positioning is not hand-made.** Anything floating goes through `Popover` (or `Menu`), which uses `place()` and `viewport`. They keep it on screen, flip it at edges, shrink it to the room left, follow the on-screen keyboard and become a sheet on narrow screens.
- **Space is earned.** On a phone, first fold extra actions into More (`Toolbar`), then put secondary ones in a sheet, and only then scroll. Content may scroll vertically, but the page never scrolls sideways.
- **Thumb reach.** On a phone, choices and actions open from the bottom edge.
- **Overlays close on click, not press.** That way the lifting finger never lands on what lies underneath. Menus close at once, without an exit animation, so a closing menu cannot catch presses.
- **Library parts carry `data-ui`.** The legacy rules at the end of `app.css` leave them alone. Delete those rules once no screen needs them.
- **Test pure logic without a browser.** Placement and fitting live in `place.ts` and are covered by `tests/ui.test.ts`.

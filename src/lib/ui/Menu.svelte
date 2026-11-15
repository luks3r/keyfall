<script lang="ts">
  import type { Snippet } from 'svelte'
  import Popover from './Popover.svelte'

  /**
   * A list of actions: beside `anchor`, at `point` for a context menu, or as a bottom sheet on a phone. Rows are
   * MenuItem (or any `<button role="menuitem">`); pressing one closes the menu.
   */
  let {
    anchor,
    point,
    returnFocus,
    label,
    onclose,
    children,
  }: { anchor?: HTMLElement; point?: { x: number; y: number }; returnFocus?: HTMLElement; label?: string; onclose: () => void; children: Snippet } = $props()

  function onclick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio]')) onclose()
  }
</script>

<Popover role="menu" {anchor} {point} {returnFocus} {label} {onclose}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions (rows are buttons; this only closes after one is used) -->
  <div class="contents" {onclick}>{@render children()}</div>
</Popover>

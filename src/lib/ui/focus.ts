/**
 * Focuses a text field as soon as it appears, even when another control has focus (Svelte's `autofocus` only
 * acts when nothing does). `select` picks the whole text so typing replaces it.
 */
export function focusOnMount(node: HTMLInputElement, select = true) {
  queueMicrotask(() => {
    node.focus({ preventScroll: true })
    if (select) node.select()
    else node.setSelectionRange(node.value.length, node.value.length)
  })
}

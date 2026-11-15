<script lang="ts" module>
  export type { ToolbarItem as SoftKey } from '../ui/Toolbar.svelte'
</script>

<script lang="ts">
  import Toolbar, { type ToolbarItem } from '../ui/Toolbar.svelte'

  /** The display's one row of context actions; everything else lives on knobs and mode keys. */
  let { keys }: { keys: ToolbarItem[] } = $props()
</script>

<Toolbar items={keys} />

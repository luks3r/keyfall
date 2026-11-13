<script lang="ts">
  import { settings, WORKSPACES } from './settings.svelte'
  import Segmented from './ui/Segmented.svelte'
</script>

<Segmented label="Workspace" value={settings.workspace} options={WORKSPACES} onselect={(workspace) => (settings.workspace = workspace)} />

<script lang="ts">
  import { renderSVG } from 'uqr'

  let { value, label }: { value: string; label: string } = $props()

  const svg = $derived(renderSVG(value, { whiteColor: '#ffffff', blackColor: '#0c0d11', border: 2 }))
</script>

<div role="img" aria-label={label} class="mx-auto w-full max-w-48 overflow-hidden rounded-xl bg-white [&>svg]:block [&>svg]:h-auto [&>svg]:w-full">
  {@html svg}
</div>

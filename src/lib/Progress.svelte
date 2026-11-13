<script lang="ts">
  let {
    value,
    max,
    disabled = false,
    onseek,
  }: { value: number; max: number; disabled?: boolean; onseek: (value: number) => void } = $props()
</script>

<input
  type="range"
  min="0"
  {max}
  step="0.01"
  {value}
  {disabled}
  aria-label="Position"
  style:--progress="{(100 * value) / max}%"
  class="block h-[3px] w-full cursor-pointer appearance-none bg-raised transition-[height] hover:enabled:h-1.5 disabled:cursor-default"
  oninput={(e) => onseek(e.currentTarget.valueAsNumber)}
/>

<style>
  input:enabled {
    background: linear-gradient(var(--color-accent), var(--color-accent)) 0 / var(--progress) 100% no-repeat, var(--color-raised);
  }

  input::-webkit-slider-thumb {
    appearance: none;
    width: 0;
  }

  input::-moz-range-thumb {
    width: 0;
    border: 0;
    background: transparent;
  }

  input::-moz-range-track {
    background: transparent;
  }
</style>

<script lang="ts">
  let {
    label,
    value = $bindable(),
    min,
    max,
    step = 0.01,
    log = false,
    unit = '',
    disabled = false,
  }: {
    label: string
    value: number
    min: number
    max: number
    step?: number
    log?: boolean
    unit?: string
    disabled?: boolean
  } = $props()

  const LOG_STEPS = 1000
  const ratio = $derived(Math.log(max / min))
  const position = $derived(log ? Math.round((LOG_STEPS * Math.log(Math.max(value, min) / min)) / ratio) : value)
  const display = $derived.by(() => {
    const magnitude = Math.abs(value)
    if (Number.isInteger(value) || magnitude >= 100) return Math.round(value)
    return value.toFixed(magnitude >= 10 ? 1 : magnitude < 0.1 ? 3 : 2)
  })

  function input(raw: number) {
    if (!log) return (value = raw)
    const exact = min * Math.exp((raw / LOG_STEPS) * ratio)
    value = Number(exact.toPrecision(3))
  }
</script>

<label class={['grid gap-1', disabled && 'opacity-40']}>
  <span class="flex justify-between text-xs text-muted">
    {label}
    <span class="text-fg tabular-nums">{display}{unit}</span>
  </span>
  <input
    type="range"
    min={log ? 0 : min}
    max={log ? LOG_STEPS : max}
    step={log ? 1 : step}
    value={position}
    {disabled}
    oninput={(e) => input(e.currentTarget.valueAsNumber)}
  />
</label>

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

<div class={['grid gap-2', disabled && 'opacity-40']}>
  <div class="flex items-center justify-between gap-2 text-xs text-muted">
    <span>{label}</span>
    <span class="flex items-center gap-1 font-mono text-fg">
      <input class="w-20 rounded border border-line bg-raised px-1 py-0.5 text-right tabular-nums" type="number" aria-label={label + ' value'} {min} {max} {step} {disabled} value={Number(display)} onchange={(e) => {
        const next = e.currentTarget.valueAsNumber
        if (Number.isFinite(next)) value = Math.max(min, Math.min(max, next))
        e.currentTarget.value = String(value)
      }} />{unit}
    </span>
  </div>
  <input type="range" aria-label={label} min={log ? 0 : min} max={log ? LOG_STEPS : max} step={log ? 1 : step} value={position} {disabled} oninput={(e) => input(e.currentTarget.valueAsNumber)} />
</div>

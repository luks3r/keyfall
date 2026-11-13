<script lang="ts">
  import { onDestroy } from 'svelte'
  import { CLICKS, estimateDelay, INTERVAL_MS, type Estimate } from './audio/calibration'
  import { click } from './audio/click'
  import { engine } from './audio/engine.svelte'
  import { settings } from './settings.svelte'
  import Button from './ui/Button.svelte'

  const BEATS_PER_BAR = 4

  let running = $state(false)
  let beat = $state(-1)
  let result = $state<Estimate | null | undefined>()
  let stop = () => {}

  const hint = $derived(
    settings.audioDelay === null
      ? `Auto · ${engine.latency === null ? 'unknown' : `${Math.round(engine.latency)} ms reported`}`
      : `Calibrated · ${settings.audioDelay} ms`,
  )

  function run() {
    const clicks: number[] = []
    const taps: number[] = []
    const start = performance.now() + INTERVAL_MS
    let timer = 0

    const tap = (e: KeyboardEvent | PointerEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.repeat) return
        if (e.code === 'Escape') return finish(false)
        e.preventDefault()
        e.stopPropagation()
      }
      taps.push(e.timeStamp)
    }
    const schedule = () => {
      const i = clicks.length
      if (i === CLICKS) return void (timer = window.setTimeout(() => finish(true), INTERVAL_MS))
      timer = window.setTimeout(() => {
        clicks.push(performance.now())
        beat = i
        click(i % BEATS_PER_BAR === 0)
        schedule()
      }, start + i * INTERVAL_MS - performance.now())
    }
    const finish = (complete: boolean) => {
      clearTimeout(timer)
      removeEventListener('keydown', tap, true)
      removeEventListener('pointerdown', tap, true)
      running = false
      beat = -1
      stop = () => {}
      if (complete) result = estimateDelay(clicks, taps)
    }

    addEventListener('keydown', tap, true)
    addEventListener('pointerdown', tap, true)
    stop = () => finish(false)
    result = undefined
    running = true
    schedule()
  }

  onDestroy(() => stop())
</script>

<div class="grid gap-2">
  <span class="flex justify-between gap-3 text-xs text-muted">
    Audio delay
    <span class={['truncate', settings.audioDelay === null ? 'text-muted' : 'text-accent']}>{hint}</span>
  </span>
  {#if running}
    <div class="flex items-center gap-3 rounded-lg bg-raised px-3 py-2 text-xs text-muted" aria-live="polite">
      <span class="flex gap-1.5">
        {#each { length: BEATS_PER_BAR } as _, i}
          <span class={['size-2 rounded-full', beat >= 0 && beat % BEATS_PER_BAR === i ? 'bg-accent' : 'bg-hover']}></span>
        {/each}
      </span>
      Tap any key on each click · {Math.max(0, CLICKS - beat - 1)} left
    </div>
  {:else if result !== undefined}
    <p class="text-xs text-muted">
      {#if result}
        Measured <span class="text-accent tabular-nums">{Math.round(result.delay)} ms</span> · ±{Math.round(result.spread)} ms over {result.taps} taps
      {:else}
        Not enough taps on the beat. Try again.
      {/if}
    </p>
  {/if}
  <div class="flex gap-2">
    {#if running}
      <Button class="flex-1" onclick={() => stop()}>Cancel</Button>
    {:else}
      <Button class="flex-1" onclick={run} disabled={engine.muted}>Calibrate</Button>
      {#if result}
        <Button class="flex-1" variant="accent" onclick={() => ((settings.audioDelay = Math.round(result!.delay)), (result = undefined))}>Use {Math.round(result.delay)} ms</Button>
      {:else if settings.audioDelay !== null}
        <Button class="flex-1" onclick={() => (settings.audioDelay = null)}>Use reported</Button>
      {/if}
    {/if}
  </div>
</div>

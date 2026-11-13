<script lang="ts" module>
  const PATHS = {
    play: 'M8 5.5v13l10.5-6.5z',
    pause: 'M8 5v14M16 5v14',
    restart: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4',
    open: 'M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z',
    save: 'M12 4v11m-4-4 4 4 4-4M5 20h14',
    settings: 'M4 7h9M17 7h3M15 5v4M4 17h3M11 17h9M9 15v4',
    refresh: 'M20 12a8 8 0 1 1-2.4-5.7M20 4v4h-4',
    minus: 'M6 12h12',
    plus: 'M12 6v12M6 12h12',
    close: 'M6 6l12 12M18 6 6 18',
    wave: 'M3 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0',
    users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5c1.8.9 3 2.9 3 5.5',
    fit: 'M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4M9 12h6',
    stop: 'M7 7h10v10H7z',
    record: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
    loop: 'M4 12V9a3 3 0 0 1 3-3h11m-3-3 3 3-3 3M20 12v3a3 3 0 0 1-3 3H6m3 3-3-3 3-3',
    metronome: 'M9 3h6l3 18H6zM12 16l5-9M7.5 14h9',
    undo: 'M9 6 4 11l5 5M4 11h11a5 5 0 0 1 0 10h-3',
    redo: 'M15 6l5 5-5 5M20 11H9a5 5 0 0 0 0 10h3',
    trash: 'M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13',
    copy: 'M9 9h10v10H9zM5 15V5h10',
    mixer: 'M6 4v16M12 4v16M18 4v16M4 14h4M10 8h4M16 16h4',
    'dock-side': 'M4 5h16v14H4zM14 5v14',
    'dock-bottom': 'M4 5h16v14H4zM4 14h16',
    'panel-side': 'M4 5h16v14H4zM14 5v14M16.5 9h1M16.5 12h1',
    'panel-bottom': 'M4 5h16v14H4zM4 14h16M8 16.5h8',
    keyboard: 'M3 6h18v12H3zM7 6v7M11 6v7M15 6v7M19 6v7M5 13h14',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    pads: 'M5 5h6v6H5zM13 5h6v6h-6zM5 13h6v6H5zM13 13h6v6h-6z',
    grid: 'M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16',
    midi: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16M8 11h.01M10 8h.01M14 8h.01M16 11h.01M10 16h4',
    learn: 'M12 5 3 9l9 4 9-4zM7 11v5c3 2 7 2 10 0v-5',
  } as const

  export type IconName = keyof typeof PATHS
</script>

<script lang="ts">
  import type { ClassValue } from 'svelte/elements'

  let { name, filled = false, class: className = '' }: { name: IconName; filled?: boolean; class?: ClassValue } = $props()
</script>

<svg
  viewBox="0 0 24 24"
  aria-hidden="true"
  class={['size-[18px] stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2.2]', filled ? 'fill-current' : 'fill-none', className]}
>
  <path d={PATHS[name]} />
</svg>

<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  type Props = HTMLButtonAttributes & {
    variant?: keyof typeof VARIANTS
    shape?: keyof typeof SHAPES
    children: Snippet
  }

  const VARIANTS = {
    solid: 'bg-raised hover:enabled:bg-hover',
    ghost: 'bg-transparent hover:enabled:bg-raised',
    accent: 'bg-accent text-bg hover:enabled:bg-accent-strong',
    danger: 'bg-danger/20 text-fg hover:enabled:bg-danger/30',
  }

  const SHAPES = {
    pill: 'h-8 px-3 rounded-lg',
    square: 'size-8 rounded-lg',
    round: 'size-10 rounded-full',
  }

  let { variant = 'solid', shape = 'pill', class: className, children, ...rest }: Props = $props()
</script>

<button
  type="button"
  class={[
    'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 font-medium whitespace-nowrap transition-colors disabled:cursor-default disabled:opacity-40',
    VARIANTS[variant],
    SHAPES[shape],
    className,
  ]}
  {...rest}
>
  {@render children()}
</button>

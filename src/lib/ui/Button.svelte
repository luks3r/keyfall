<script lang="ts" module>
  export const VARIANTS = {
    solid: 'bg-raised text-fg hover:enabled:bg-hover',
    ghost: 'bg-transparent text-fg hover:enabled:bg-raised',
    accent: 'bg-accent text-bg hover:enabled:bg-accent-strong',
    danger: 'bg-danger/20 text-fg hover:enabled:bg-danger/30',
    /** Lit: the instrument's active key. */
    lit: 'bg-fg text-bg',
  }
  export type ButtonVariant = keyof typeof VARIANTS
  export type ButtonSize = 'md' | 'sm'
  export type ButtonShape = 'pill' | 'square' | 'round'

  const SHAPES = {
    md: { pill: 'h-control px-3', square: 'size-control', round: 'size-control rounded-full' },
    sm: { pill: 'h-control-sm px-2.5 text-xs', square: 'size-control-sm', round: 'size-control-sm rounded-full' },
  }

  /** The button's look as classes, for things that must match it exactly (a measuring copy, a link). */
  export const buttonClass = (variant: ButtonVariant = 'solid', size: ButtonSize = 'md', shape: ButtonShape = 'pill', caps = false) => [
    'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-control font-medium whitespace-nowrap transition-colors disabled:cursor-default disabled:opacity-40',
    VARIANTS[variant],
    SHAPES[size][shape],
    caps && 'label',
  ]
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  /**
   * The one button. Heights come from the control tokens, so a button is compact under a mouse and a full fingertip
   * on a touch screen. `square` and `round` hold one icon: give them an `aria-label`. `caps` sets the label in the
   * instrument's small capitals, as on keys.
   */
  type Props = HTMLButtonAttributes & {
    variant?: ButtonVariant
    size?: ButtonSize
    shape?: ButtonShape
    caps?: boolean
    children: Snippet
  }

  let { variant = 'solid', size = 'md', shape = 'pill', caps = false, class: className, children, ...rest }: Props = $props()
</script>

<button
  type="button"
  data-ui
  class={[buttonClass(variant, size, shape, caps), className]}
  {...rest}
>
  {@render children()}
</button>

import type { LucideIcon } from 'lucide-react'

/** Large ribbon command: icon above a short label (WCAG 2.5.8: well over 24 × 24 px). */
export const RIBBON_BUTTON_CLASS =
  'flex min-h-15 min-w-14 flex-col items-center justify-start gap-1 rounded-[9px] px-2 pt-1.5 pb-1 text-xs leading-4 font-small text-ink transition-colors duration-[120ms] [&_svg]:text-ink-muted hover:bg-row-hover hover:[&_svg]:text-ink aria-expanded:bg-row-hover aria-pressed:bg-accent-subtle aria-pressed:font-semibold aria-pressed:text-accent aria-pressed:shadow-[inset_0_0_0_1px_var(--accent)] aria-pressed:[&_svg]:text-accent aria-disabled:cursor-default aria-disabled:text-ink-subtle aria-disabled:[&_svg]:text-ink-subtle aria-disabled:hover:bg-transparent aria-disabled:hover:[&_svg]:text-ink-subtle'

/** Small ribbon toggle (the unit buttons). */
export const RIBBON_SMALL_CLASS =
  'min-h-6 min-w-11 rounded-pill px-2.5 text-xs leading-4 font-small text-ink-muted transition-colors duration-[120ms] hover:text-ink aria-pressed:bg-raised aria-pressed:font-semibold aria-pressed:text-ink aria-pressed:shadow-[inset_0_0_0_1px_var(--accent),var(--elevation-raised)] aria-disabled:text-ink-subtle'

export interface RibbonButtonProps {
  label: string
  icon: LucideIcon
  onClick(): void
  /** Toggle buttons pass their state; action buttons leave it undefined. */
  pressed?: boolean
  disabled?: boolean
  /** Tooltip; also the accessible description of what the command does. */
  title?: string
}

/**
 * A ribbon command. Disabled commands use `aria-disabled` so they stay reachable with the
 * arrow keys (modern-web-guidance "toolbar") and ignore clicks.
 */
export function RibbonButton({
  label,
  icon: Icon,
  onClick,
  pressed,
  disabled,
  title,
}: RibbonButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={pressed}
      aria-disabled={disabled ? 'true' : undefined}
      onClick={() => {
        if (!disabled) onClick()
      }}
      className={RIBBON_BUTTON_CLASS}
    >
      <Icon aria-hidden="true" className="size-5.5" strokeWidth={1.75} />
      <span>{label}</span>
    </button>
  )
}

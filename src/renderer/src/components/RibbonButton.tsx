import type { FluentIcon } from '../lib/icons'

/** Large ribbon command: icon above a short label (WCAG 2.5.8: well over 24 × 24 px). */
export const RIBBON_BUTTON_CLASS =
  'flex min-h-15 min-w-14 flex-col items-center justify-start gap-1 rounded-[9px] px-2 pt-1.5 pb-1 text-xs leading-4 font-small text-ink transition-colors duration-[120ms] [&_svg]:text-ink-muted hover:bg-row-hover hover:[&_svg]:text-ink aria-expanded:bg-row-hover aria-pressed:bg-accent-subtle aria-pressed:font-semibold aria-pressed:text-accent aria-pressed:shadow-[inset_0_0_0_1px_var(--accent)] aria-pressed:[&_svg]:text-accent aria-disabled:cursor-default aria-disabled:text-ink-subtle aria-disabled:[&_svg]:text-ink-subtle aria-disabled:[&_svg]:opacity-40 aria-disabled:hover:bg-transparent aria-disabled:hover:[&_svg]:text-ink-subtle'

/** Small ribbon toggle (the unit buttons). */
export const RIBBON_SMALL_CLASS =
  'min-h-6 min-w-11 rounded-pill px-2.5 text-xs leading-4 font-small text-ink-muted transition-colors duration-[120ms] hover:text-ink aria-pressed:bg-raised aria-pressed:font-semibold aria-pressed:text-ink aria-pressed:shadow-[inset_0_0_0_1px_var(--accent),var(--elevation-raised)] aria-disabled:text-ink-subtle'

export interface RibbonButtonProps {
  label: string
  icon: FluentIcon
  onClick(): void
  /** Toggle buttons pass their state; action buttons leave it undefined. */
  pressed?: boolean
  disabled?: boolean
  /** Tooltip; also the accessible description of what the command does. */
  title?: string
  /** An update-available dot at the icon's top right; adds ", update available" to the name. */
  badge?: boolean
}

/** The 8 px notification dot (decorative: the badge also extends the accessible name). */
export function NotificationDot({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-testid="notification-dot"
      className={`pointer-events-none absolute size-2 rounded-full bg-accent forced-colors:bg-[Highlight] ${className}`}
    />
  )
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
  badge,
}: RibbonButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={badge ? `${label}, update available` : undefined}
      aria-pressed={pressed}
      aria-disabled={disabled ? 'true' : undefined}
      onClick={() => {
        if (!disabled) onClick()
      }}
      className={RIBBON_BUTTON_CLASS}
    >
      <span className="relative inline-flex">
        <Icon aria-hidden="true" focusable={false} />
        {badge && <NotificationDot className="-top-0.5 -right-1" />}
      </span>
      <span>{label}</span>
    </button>
  )
}

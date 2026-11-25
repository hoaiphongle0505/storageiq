import type { ButtonHTMLAttributes, Ref } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'quiet'

/**
 * Each variant's `aria-disabled:hover:` class re-applies the resting background, so a busy
 * button shows no hover colour change (roadmap carry-over 8).
 */
export const BUTTON_VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover aria-disabled:hover:bg-accent',
  secondary:
    'border border-line bg-raised text-ink shadow-raised hover:bg-sunken aria-disabled:hover:bg-raised',
  quiet:
    'bg-transparent text-ink-muted hover:bg-row-hover hover:text-ink aria-disabled:hover:bg-transparent aria-disabled:hover:text-ink-muted',
}

export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'disabled' | 'type'
> {
  variant?: ButtonVariant
  /** Busy: stays focusable and announced as unavailable, ignores clicks, no hover change. */
  busy?: boolean
  ref?: Ref<HTMLButtonElement>
}

export function Button({
  variant = 'primary',
  busy = false,
  className = '',
  onClick,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type="button"
      aria-disabled={busy ? 'true' : undefined}
      onClick={(event) => {
        if (busy) return
        onClick?.(event)
      }}
      className={`h-8 rounded-control px-3.5 text-[13px] leading-[18px] font-medium transition-colors duration-[120ms] aria-disabled:cursor-default aria-disabled:opacity-60 ${BUTTON_VARIANT_CLASSES[variant]} ${className}`}
    />
  )
}

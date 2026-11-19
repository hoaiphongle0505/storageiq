import type { ButtonHTMLAttributes, Ref } from 'react'

export type ButtonVariant = 'primary' | 'secondary'

/**
 * Each variant's `aria-disabled:hover:` class re-applies the resting background, so a busy
 * button shows no hover colour change (roadmap carry-over 8).
 */
export const BUTTON_VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover aria-disabled:hover:bg-accent',
  secondary: 'border border-line bg-panel text-ink hover:bg-sunken aria-disabled:hover:bg-panel',
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
      className={`rounded-control px-4 py-2 font-medium aria-disabled:cursor-default aria-disabled:opacity-60 ${BUTTON_VARIANT_CLASSES[variant]} ${className}`}
    />
  )
}

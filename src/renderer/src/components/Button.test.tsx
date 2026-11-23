// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button, BUTTON_VARIANT_CLASSES } from './Button'

describe('<Button />', () => {
  it('runs its action when not busy', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Scan again</Button>)
    await user.click(screen.getByRole('button', { name: 'Scan again' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('when busy, stays focusable, is announced as unavailable and ignores clicks', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button busy onClick={onClick}>
        Choose folder…
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Choose folder…' })
    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    expect(button).toHaveFocus()
  })

  it('keeps the resting colour on hover while busy (roadmap carry-over 8)', () => {
    expect(BUTTON_VARIANT_CLASSES.primary).toContain('aria-disabled:hover:bg-accent')
    expect(BUTTON_VARIANT_CLASSES.secondary).toContain('aria-disabled:hover:bg-raised')
    render(<Button busy>Busy</Button>)
    expect(screen.getByRole('button', { name: 'Busy' }).className).toContain(
      'aria-disabled:hover:bg-accent',
    )
  })

  it('quiet keeps a transparent background when busy', () => {
    expect(BUTTON_VARIANT_CLASSES.quiet).toContain('aria-disabled:hover:bg-transparent')
    render(
      <Button variant="quiet" busy>
        Busy
      </Button>,
    )
    expect(screen.getByRole('button', { name: 'Busy' }).className).toContain(
      'aria-disabled:hover:bg-transparent',
    )
  })
})

// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Splitter, SPLITTER_STEP } from './Splitter'

describe('<Splitter />', () => {
  it('is a focusable separator with its value', () => {
    render(<Splitter value={260} min={120} max={900} onChange={vi.fn()} />)
    const separator = screen.getByRole('separator', { name: 'Resize treemap' })
    expect(separator).toHaveAttribute('aria-valuenow', '260')
    expect(separator).toHaveAttribute('aria-orientation', 'horizontal')
    expect(separator).toHaveAttribute('tabindex', '0')
  })

  it('resizes with the arrow keys, Home and End, within the limits', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Splitter value={260} min={120} max={900} onChange={onChange} />)
    screen.getByRole('separator').focus()
    await user.keyboard('{ArrowUp}')
    expect(onChange).toHaveBeenLastCalledWith(260 + SPLITTER_STEP)
    await user.keyboard('{ArrowDown}')
    expect(onChange).toHaveBeenLastCalledWith(260 - SPLITTER_STEP)
    await user.keyboard('{Home}')
    expect(onChange).toHaveBeenLastCalledWith(120)
    await user.keyboard('{End}')
    expect(onChange).toHaveBeenLastCalledWith(900)
  })

  it('resizes by dragging: up makes the treemap taller', () => {
    const onChange = vi.fn()
    render(<Splitter value={260} min={120} max={900} onChange={onChange} />)
    const separator = screen.getByRole('separator')
    fireEvent.pointerDown(separator, { clientY: 500, pointerId: 1 })
    fireEvent.pointerMove(separator, { clientY: 440, pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith(320)
    fireEvent.pointerUp(separator, { pointerId: 1 })
    fireEvent.pointerMove(separator, { clientY: 100, pointerId: 1 })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('ends the drag when the pointer is cancelled or capture is lost, and ignores other buttons', () => {
    const onChange = vi.fn()
    render(<Splitter value={260} min={120} max={900} onChange={onChange} />)
    const separator = screen.getByRole('separator')
    fireEvent.pointerDown(separator, { clientY: 500, pointerId: 1, button: 2 })
    fireEvent.pointerMove(separator, { clientY: 440, pointerId: 1 })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.pointerDown(separator, { clientY: 500, pointerId: 1, button: 0 })
    fireEvent.pointerCancel(separator, { pointerId: 1 })
    fireEvent.pointerMove(separator, { clientY: 440, pointerId: 1 })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.pointerDown(separator, { clientY: 500, pointerId: 1, button: 0 })
    fireEvent.lostPointerCapture(separator, { pointerId: 1 })
    fireEvent.pointerMove(separator, { clientY: 440, pointerId: 1 })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps a visible focus cue in forced colours', () => {
    render(<Splitter value={260} min={120} max={900} onChange={vi.fn()} />)
    const { className } = screen.getByRole('separator')
    expect(className).toContain('outline-hidden')
    expect(className).not.toContain('outline-none')
    expect(className).toContain('forced-colors:focus-visible:outline-[Highlight]')
  })
})

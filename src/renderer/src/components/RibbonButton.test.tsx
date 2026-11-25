// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { IconAbout } from '../lib/icons'
import { RibbonButton } from './RibbonButton'

describe('<RibbonButton />', () => {
  it('badge adds a hidden dot and update available to the accessible name', () => {
    render(
      <RibbonButton label="Check for updates" icon={IconAbout} title="T" onClick={vi.fn()} badge />,
    )
    const button = screen.getByRole('button', { name: 'Check for updates, update available' })
    expect(button).toHaveTextContent('Check for updates')
    expect(button).toHaveAttribute('title', 'T')
    expect(button.querySelector('[aria-hidden="true"]:not(svg)')).not.toBeNull()
  })

  it('has no dot and keeps its plain name without a badge', () => {
    render(<RibbonButton label="About" icon={IconAbout} onClick={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'About' })
    expect(button).not.toHaveAttribute('aria-label')
    expect(button.querySelector('[data-testid="notification-dot"]')).toBeNull()
  })
})

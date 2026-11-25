// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppLogo } from './AppLogo'

const ATTRIBUTES = ['d', 'fill', 'stroke', 'stroke-width', 'rx']

/** The sorted multiset of the drawing attributes of every rect and path. */
function drawing(root: Element): string[] {
  const values: string[] = []
  for (const element of root.querySelectorAll('rect, path')) {
    for (const name of ATTRIBUTES) {
      const value = element.getAttribute(name)
      if (value !== null) values.push(`${name}=${value}`)
    }
  }
  return values.sort()
}

describe('<AppLogo />', () => {
  it('matches build/icon.svg', () => {
    const file = new DOMParser().parseFromString(
      readFileSync(resolve('build/icon.svg'), 'utf8'),
      'image/svg+xml',
    )
    const { container } = render(<AppLogo size={64} />)
    const svg = container.querySelector('svg')
    expect(drawing(svg as Element)).toEqual(drawing(file.documentElement))
    expect(svg).toHaveAttribute('viewBox', '0 0 64 64')
    expect(svg).toHaveAttribute('width', '64')
    expect(svg).toHaveAttribute('height', '64')
  })

  it('is hidden from assistive technology', () => {
    const { container } = render(<AppLogo size={32} />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})

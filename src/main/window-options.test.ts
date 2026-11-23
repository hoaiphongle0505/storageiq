import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createMainWindowOptions, WINDOW_BACKGROUND } from './window-options'

describe('createMainWindowOptions', () => {
  it('locks down the renderer', () => {
    const options = createMainWindowOptions({ preloadPath: 'C:\\app\\preload.js', dark: false })
    expect(options.webPreferences).toMatchObject({
      preload: 'C:\\app\\preload.js',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      nodeIntegrationInSubFrames: false,
    })
  })

  it('stays hidden until the first paint to avoid a white flash', () => {
    expect(createMainWindowOptions({ preloadPath: 'p', dark: false }).show).toBe(false)
  })

  it('matches the window background to the system theme', () => {
    expect(createMainWindowOptions({ preloadPath: 'p', dark: true }).backgroundColor).toBe(
      WINDOW_BACKGROUND.dark,
    )
    expect(createMainWindowOptions({ preloadPath: 'p', dark: false }).backgroundColor).toBe(
      WINDOW_BACKGROUND.light,
    )
  })

  it('uses the surface-app colours of the design tokens', () => {
    const tokens = JSON.parse(readFileSync('design/tokens.json', 'utf8')) as {
      color: Record<'light' | 'dark', Record<string, string>>
    }
    expect(WINDOW_BACKGROUND).toEqual({
      light: tokens.color.light['surface-app'],
      dark: tokens.color.dark['surface-app'],
    })
  })
})

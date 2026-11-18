import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isTrustedRendererUrl } from './trusted-url'

const rendererRoot = path.resolve('out', 'renderer')
const indexUrl = pathToFileURL(path.join(rendererRoot, 'index.html')).href

describe('isTrustedRendererUrl', () => {
  it('trusts the bundled renderer index file', () => {
    expect(isTrustedRendererUrl(indexUrl, { rendererRoot })).toBe(true)
  })

  it('rejects files outside the renderer folder', () => {
    const mainBundle = pathToFileURL(path.resolve('out', 'main', 'index.js')).href
    expect(isTrustedRendererUrl(mainBundle, { rendererRoot })).toBe(false)
  })

  it('rejects path traversal that escapes the renderer folder', () => {
    const sneaky = `${pathToFileURL(rendererRoot).href}/../main/index.js`
    expect(isTrustedRendererUrl(sneaky, { rendererRoot })).toBe(false)
  })

  it('trusts the dev server origin when one is configured', () => {
    const options = { rendererRoot, devServerUrl: 'http://localhost:5173' }
    expect(isTrustedRendererUrl('http://localhost:5173/index.html', options)).toBe(true)
  })

  it('rejects other origins even in development', () => {
    const options = { rendererRoot, devServerUrl: 'http://localhost:5173' }
    expect(isTrustedRendererUrl('http://localhost:5174/', options)).toBe(false)
    expect(isTrustedRendererUrl('https://example.com/', options)).toBe(false)
  })

  it('rejects remote URLs in production', () => {
    expect(isTrustedRendererUrl('https://example.com/', { rendererRoot })).toBe(false)
  })

  it('rejects empty and malformed URLs', () => {
    expect(isTrustedRendererUrl('', { rendererRoot })).toBe(false)
    expect(isTrustedRendererUrl('not a url', { rendererRoot })).toBe(false)
  })
})

import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface TrustedUrlOptions {
  /** Vite dev server URL; set only in unpackaged development builds. */
  devServerUrl?: string
  /** Absolute folder that contains the bundled renderer (`out/renderer`). */
  rendererRoot: string
}

/**
 * Returns true only for URLs that belong to StorageIQ's own renderer:
 * the dev server origin during development, or a file inside the bundled
 * renderer folder in production. Everything else is untrusted.
 */
export function isTrustedRendererUrl(url: string, options: TrustedUrlOptions): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (options.devServerUrl && parsed.origin === new URL(options.devServerUrl).origin) {
    return true
  }

  if (parsed.protocol !== 'file:') {
    return false
  }

  const root = path.resolve(options.rendererRoot)
  const relative = path.relative(root, path.resolve(fileURLToPath(parsed)))
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

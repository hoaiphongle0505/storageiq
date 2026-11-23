import type { IconImage } from '@shared/ipc-contract'

/** A key whose lookup returned nothing is not asked for again for this long. */
export const NEGATIVE_TTL_MS = 60_000

export interface IconCache {
  /** The image for `key`; refreshes its recency. */
  get(key: string): IconImage | undefined
  set(key: string, image: IconImage): void
  /** Remembers that the lookup for `key` found nothing, at time `now`. */
  setMissing(key: string, now: number): void
  /** Whether `key` was remembered as missing less than `NEGATIVE_TTL_MS` before `now`. */
  isMissing(key: string, now: number): boolean
  /** Drops every image and every negative entry whose key starts with `prefix`. */
  clearPrefix(prefix: string): void
  readonly size: number
}

/**
 * An LRU of icon images (`maxEntries`) plus a bounded map of negative entries (`maxMissing`).
 * Windows' own icon theme is not tracked: a high-contrast or icon-theme change shows after a
 * restart.
 */
export function createIconCache(maxEntries: number, maxMissing = 4096): IconCache {
  // A Map iterates in insertion order: the first key is the least recently used.
  const images = new Map<string, IconImage>()
  const missing = new Map<string, number>()
  return {
    get(key) {
      const image = images.get(key)
      if (image === undefined) return undefined
      images.delete(key)
      images.set(key, image)
      return image
    },
    set(key, image) {
      images.delete(key)
      missing.delete(key)
      images.set(key, image)
      while (images.size > maxEntries) {
        const oldest = images.keys().next()
        if (oldest.done) break
        images.delete(oldest.value)
      }
    },
    setMissing(key, now) {
      missing.delete(key)
      missing.set(key, now)
      while (missing.size > maxMissing) {
        const oldest = missing.keys().next()
        if (oldest.done) break
        missing.delete(oldest.value)
      }
    },
    isMissing(key, now) {
      const at = missing.get(key)
      if (at === undefined) return false
      if (now - at >= NEGATIVE_TTL_MS) {
        missing.delete(key)
        return false
      }
      return true
    },
    clearPrefix(prefix) {
      for (const key of [...images.keys()]) if (key.startsWith(prefix)) images.delete(key)
      for (const key of [...missing.keys()]) if (key.startsWith(prefix)) missing.delete(key)
    },
    get size() {
      return images.size
    },
  }
}

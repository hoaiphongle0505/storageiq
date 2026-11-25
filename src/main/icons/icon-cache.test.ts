import { describe, expect, it } from 'vitest'
import type { IconImage } from '@shared/ipc-contract'
import { createIconCache, NEGATIVE_TTL_MS } from './icon-cache'

const image = (tag: string): IconImage => ({ small: `s-${tag}`, large: `l-${tag}` })

describe('createIconCache', () => {
  it('get returns what set stored', () => {
    const cache = createIconCache(4)
    expect(cache.get('ext:txt')).toBeUndefined()
    cache.set('ext:txt', image('a'))
    expect(cache.get('ext:txt')).toEqual(image('a'))
    expect(cache.size).toBe(1)
  })

  it('the least recently used entry is evicted past the cap', () => {
    const cache = createIconCache(2)
    cache.set('a', image('a'))
    cache.set('b', image('b'))
    cache.set('c', image('c'))
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toEqual(image('b'))
    expect(cache.get('c')).toEqual(image('c'))
  })

  it('get refreshes recency', () => {
    const cache = createIconCache(2)
    cache.set('a', image('a'))
    cache.set('b', image('b'))
    cache.get('a')
    cache.set('c', image('c'))
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toEqual(image('a'))
  })

  it('clearPrefix removes only per-file keys', () => {
    const cache = createIconCache(8)
    cache.set('ext:txt', image('t'))
    cache.set('dir', image('d'))
    cache.set('f:0123456789ab', image('f'))
    cache.setMissing('f:aaaaaaaaaaaa', 0)
    cache.clearPrefix('f:')
    expect(cache.get('f:0123456789ab')).toBeUndefined()
    expect(cache.isMissing('f:aaaaaaaaaaaa', 0)).toBe(false)
    expect(cache.get('ext:txt')).toEqual(image('t'))
    expect(cache.get('dir')).toEqual(image('d'))
  })

  it('a negative entry expires after the TTL and not before', () => {
    const cache = createIconCache(4)
    cache.setMissing('f:0123456789ab', 1_000)
    expect(NEGATIVE_TTL_MS).toBe(60_000)
    expect(cache.isMissing('f:0123456789ab', 1_000 + NEGATIVE_TTL_MS - 1)).toBe(true)
    expect(cache.isMissing('f:0123456789ab', 1_000 + NEGATIVE_TTL_MS)).toBe(false)
    expect(cache.isMissing('other', 1_000)).toBe(false)
  })
})

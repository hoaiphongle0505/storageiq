import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createUpdater,
  hasPrereleaseTag,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CHECK_TIMEOUT_MS,
  UPDATE_FIRST_CHECK_DELAY_MS,
  type UpdaterDeps,
  type UpdaterLike,
} from './updater'

interface Fake {
  autoUpdater: UpdaterLike
  emit(event: string, payload?: unknown): void
  check: ReturnType<typeof vi.fn>
  download: ReturnType<typeof vi.fn>
  quitAndInstall: ReturnType<typeof vi.fn>
  listenerCount(): number
}

function fakeAutoUpdater(): Fake {
  const listeners = new Map<string, ((payload?: unknown) => void)[]>()
  const check = vi.fn(() => Promise.resolve(null))
  const download = vi.fn(() => Promise.resolve([]))
  const quitAndInstall = vi.fn()
  const autoUpdater = {
    autoDownload: true,
    allowPrerelease: false,
    autoInstallOnAppQuit: false,
    logger: null,
    on(event: string, listener: (payload?: unknown) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
      return autoUpdater
    },
    checkForUpdates: check,
    downloadUpdate: download,
    quitAndInstall,
  } as unknown as UpdaterLike
  return {
    autoUpdater,
    emit: (event, payload) => (listeners.get(event) ?? []).forEach((l) => l(payload)),
    check,
    download,
    quitAndInstall,
    listenerCount: () => [...listeners.values()].reduce((n, list) => n + list.length, 0),
  }
}

function setup(overrides: Partial<UpdaterDeps> = {}) {
  const fake = fakeAutoUpdater()
  const send = vi.fn()
  const log = vi.fn()
  const schedule = vi.fn((callback: () => void, ms: number) => {
    const timer = setTimeout(callback, ms)
    return () => clearTimeout(timer)
  })
  const scheduleEvery = vi.fn((callback: () => void, ms: number) => {
    const timer = setInterval(callback, ms)
    return () => clearInterval(timer)
  })
  const updater = createUpdater({
    autoUpdater: fake.autoUpdater,
    isPackaged: true,
    selfTest: false,
    version: '0.2.0',
    send,
    schedule,
    scheduleEvery,
    log,
    ...overrides,
  })
  return { updater, fake, send, log, schedule, scheduleEvery }
}

const HOUR = 3_600_000
const CHECK_ERROR = 'Could not check for updates. Check your connection and try again.'
const DOWNLOAD_ERROR = 'Could not download the update. Try again.'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

/** A started updater that found 0.3.0. */
function available() {
  const ctx = setup()
  ctx.updater.start()
  ctx.updater.checkNow()
  ctx.fake.emit('update-available', { version: '0.3.0', releaseNotes: '<p>Notes</p>' })
  return ctx
}

describe('createUpdater', () => {
  it('start sets autoDownload false, autoInstallOnAppQuit true and the channel', () => {
    const beta = setup({ version: '0.2.0-beta.1' })
    beta.updater.start()
    expect(beta.fake.autoUpdater).toMatchObject({
      allowPrerelease: true,
      autoDownload: false,
      autoInstallOnAppQuit: true,
    })
    const stable = setup({ version: '0.2.0' })
    stable.updater.start()
    expect(stable.fake.autoUpdater).toMatchObject({
      allowPrerelease: false,
      autoDownload: false,
      autoInstallOnAppQuit: true,
    })
  })

  it('an unpackaged or self-test checkNow reports unavailable and never calls the updater', async () => {
    for (const overrides of [{ isPackaged: false }, { selfTest: true }]) {
      const { updater, fake, schedule, scheduleEvery, log, send } = setup(overrides)
      updater.start()
      const state = updater.checkNow()
      await vi.advanceTimersByTimeAsync(24 * HOUR)
      expect(state).toEqual({
        kind: 'unavailable',
        message: 'Updates are available in the installed app.',
      })
      expect(updater.state).toEqual(state)
      expect(send).toHaveBeenCalledWith('update:state', state)
      expect(fake.listenerCount()).toBe(0)
      expect(fake.check).not.toHaveBeenCalled()
      expect(schedule).not.toHaveBeenCalled()
      expect(scheduleEvery).not.toHaveBeenCalled()
      expect(log).not.toHaveBeenCalled()
    }
  })

  it('checkNow moves idle to checking to up-to-date', () => {
    const { updater, fake } = setup()
    updater.start()
    expect(updater.state).toEqual({ kind: 'idle' })
    expect(updater.checkNow()).toEqual({ kind: 'checking' })
    expect(fake.check).toHaveBeenCalledTimes(1)
    fake.emit('update-not-available')
    expect(updater.state).toEqual({ kind: 'up-to-date' })
    expect(updater.checkNow()).toEqual({ kind: 'checking' })
    expect(fake.check).toHaveBeenCalledTimes(2)
  })

  it('update-available moves to available and keeps plain-text release notes', () => {
    const { updater } = available()
    expect(updater.state).toEqual({ kind: 'available', version: '0.3.0' })
    expect(updater.releaseNotes).toEqual({ version: '0.3.0', text: 'Notes' })
  })

  it('checkNow is a no-op while checking, available, downloading or ready', () => {
    const { updater, fake } = setup()
    updater.start()
    updater.checkNow()
    updater.checkNow()
    expect(fake.check).toHaveBeenCalledTimes(1)
    fake.emit('update-available', { version: '0.3.0' })
    expect(updater.checkNow()).toEqual({ kind: 'available', version: '0.3.0' })
    updater.download()
    expect(updater.checkNow().kind).toBe('downloading')
    fake.emit('update-downloaded', { version: '0.3.0' })
    expect(updater.checkNow()).toEqual({ kind: 'ready', version: '0.3.0' })
    expect(fake.check).toHaveBeenCalledTimes(1)
  })

  it('download only runs from available and moves to downloading', () => {
    const { updater, fake } = setup()
    updater.start()
    updater.download()
    expect(fake.download).not.toHaveBeenCalled()
    fake.emit('update-available', { version: '0.3.0' })
    updater.download()
    expect(fake.download).toHaveBeenCalledTimes(1)
    expect(updater.state).toEqual({ kind: 'downloading', version: '0.3.0', percent: 0 })
    updater.download()
    expect(fake.download).toHaveBeenCalledTimes(1)
  })

  it('download-progress rounds and clamps the percent', () => {
    const { updater, fake } = available()
    updater.download()
    fake.emit('download-progress', { percent: 41.6 })
    expect(updater.state).toMatchObject({ percent: 42 })
    fake.emit('download-progress', { percent: 180 })
    expect(updater.state).toMatchObject({ percent: 100 })
    fake.emit('download-progress', { percent: -5 })
    expect(updater.state).toMatchObject({ percent: 0 })
  })

  it('update-downloaded moves to ready and cancels the timers', async () => {
    const { updater, fake } = setup()
    updater.start()
    await vi.advanceTimersByTimeAsync(UPDATE_FIRST_CHECK_DELAY_MS)
    fake.emit('update-available', { version: '0.3.0' })
    updater.download()
    fake.emit('update-downloaded', { version: '0.3.0' })
    expect(updater.state).toEqual({ kind: 'ready', version: '0.3.0' })
    await vi.advanceTimersByTimeAsync(12 * HOUR)
    expect(fake.check).toHaveBeenCalledTimes(1)
  })

  it('install quits and installs only from ready', () => {
    const { updater, fake } = available()
    updater.install()
    expect(fake.quitAndInstall).not.toHaveBeenCalled()
    updater.download()
    fake.emit('update-downloaded', { version: '0.3.0' })
    updater.install()
    expect(fake.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('a manual check error shows the fixed message and logs the raw error', async () => {
    const { updater, fake, log } = setup()
    updater.start()
    const failure = new Error('ECONNRESET secret detail')
    fake.check.mockRejectedValueOnce(failure)
    updater.checkNow()
    await vi.advanceTimersByTimeAsync(0)
    expect(updater.state).toEqual({ kind: 'error', message: CHECK_ERROR })
    expect(log).toHaveBeenCalledWith('Update failed', failure)
    expect(JSON.stringify(updater.state)).not.toContain('secret')
    // an error allows a new check
    expect(updater.checkNow()).toEqual({ kind: 'checking' })
    // a synchronous throw is handled the same way
    fake.emit('error', new Error('x'))
    expect(updater.state.kind).toBe('error')
    fake.check.mockImplementationOnce(() => {
      throw new Error('sync')
    })
    updater.checkNow()
    expect(updater.state).toEqual({ kind: 'error', message: CHECK_ERROR })
  })

  it('a background check error returns to idle and shows nothing', async () => {
    const { updater, fake, send } = setup()
    updater.start()
    fake.check.mockRejectedValueOnce(new Error('offline'))
    await vi.advanceTimersByTimeAsync(UPDATE_FIRST_CHECK_DELAY_MS)
    expect(updater.state).toEqual({ kind: 'idle' })
    expect(send).not.toHaveBeenCalledWith(
      'update:state',
      expect.objectContaining({ kind: 'error' }),
    )
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS)
    expect(fake.check).toHaveBeenCalledTimes(2)
  })

  it('a download error shows the fixed download message', async () => {
    const { updater, fake, log } = available()
    const failure = new Error('disk full')
    fake.download.mockRejectedValueOnce(failure)
    updater.download()
    await vi.advanceTimersByTimeAsync(0)
    expect(updater.state).toEqual({ kind: 'error', message: DOWNLOAD_ERROR })
    expect(log).toHaveBeenCalledWith('Update failed', failure)
  })

  it('a stuck check times out after UPDATE_CHECK_TIMEOUT_MS', async () => {
    const manual = setup()
    manual.updater.start()
    manual.fake.check.mockReturnValueOnce(new Promise(() => undefined))
    manual.updater.checkNow()
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_TIMEOUT_MS - 1)
    expect(manual.updater.state).toEqual({ kind: 'checking' })
    await vi.advanceTimersByTimeAsync(1)
    expect(manual.updater.state).toEqual({ kind: 'error', message: CHECK_ERROR })

    const background = setup()
    background.updater.start()
    background.fake.check.mockReturnValueOnce(new Promise(() => undefined))
    await vi.advanceTimersByTimeAsync(UPDATE_FIRST_CHECK_DELAY_MS + UPDATE_CHECK_TIMEOUT_MS)
    expect(background.updater.state).toEqual({ kind: 'idle' })
  })

  it('the first background check runs after 10 s and the interval skips available, downloading and ready', async () => {
    const { updater, fake } = setup()
    updater.start()
    await vi.advanceTimersByTimeAsync(UPDATE_FIRST_CHECK_DELAY_MS - 1)
    expect(fake.check).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(fake.check).toHaveBeenCalledTimes(1)
    fake.emit('update-not-available')
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS)
    expect(fake.check).toHaveBeenCalledTimes(2)
    fake.emit('update-available', { version: '0.3.0' })
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS)
    expect(fake.check).toHaveBeenCalledTimes(2)
    updater.download()
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS)
    expect(fake.check).toHaveBeenCalledTimes(2)
  })

  it('a state is only sent when it changed', () => {
    const { updater, fake, send } = setup()
    updater.start()
    updater.checkNow()
    fake.emit('update-not-available')
    fake.emit('update-not-available')
    expect(send.mock.calls.map((call) => (call[1] as { kind: string }).kind)).toEqual([
      'checking',
      'up-to-date',
    ])
    fake.emit('update-available', { version: '0.3.0' })
    fake.emit('update-available', { version: '0.3.0' })
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('dispose cancels the timers', async () => {
    const { updater, fake } = setup()
    updater.start()
    updater.dispose()
    await vi.advanceTimersByTimeAsync(24 * HOUR)
    expect(fake.check).not.toHaveBeenCalled()
  })
})

describe('hasPrereleaseTag', () => {
  it.each([
    ['0.1.0', false],
    ['0.1.0-beta.1', true],
    ['1.0.0-rc.1+build5', true],
    ['1.0.0+build5', false],
  ])('%s -> %s', (version, expected) => {
    expect(hasPrereleaseTag(version)).toBe(expected)
  })
})

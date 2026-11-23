import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createUpdater,
  hasPrereleaseTag,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_FIRST_CHECK_DELAY_MS,
  type UpdaterDeps,
  type UpdaterLike,
} from './updater'

interface Fake {
  autoUpdater: UpdaterLike
  downloaded(version: string): void
  error(error: Error): void
  check: ReturnType<typeof vi.fn>
  quitAndInstall: ReturnType<typeof vi.fn>
  listenerCount(): number
}

function fakeAutoUpdater(): Fake {
  const downloadedListeners: ((info: { version: string }) => void)[] = []
  const errorListeners: ((error: Error) => void)[] = []
  const check = vi.fn(() => Promise.resolve(null))
  const quitAndInstall = vi.fn()
  const autoUpdater: UpdaterLike = {
    autoDownload: false,
    allowPrerelease: false,
    autoInstallOnAppQuit: false,
    logger: null,
    on(event: string, listener: never) {
      if (event === 'update-downloaded') downloadedListeners.push(listener)
      else errorListeners.push(listener)
      return autoUpdater
    },
    checkForUpdates: check,
    quitAndInstall,
  } as UpdaterLike
  return {
    autoUpdater,
    downloaded: (version) => downloadedListeners.forEach((l) => l({ version })),
    error: (error) => errorListeners.forEach((l) => l(error)),
    check,
    quitAndInstall,
    listenerCount: () => downloadedListeners.length + errorListeners.length,
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

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('createUpdater', () => {
  it('does nothing when the app is not packaged', async () => {
    const { updater, fake, schedule, scheduleEvery, log } = setup({ isPackaged: false })
    updater.start()
    await vi.advanceTimersByTimeAsync(24 * HOUR)
    expect(fake.listenerCount()).toBe(0)
    expect(schedule).not.toHaveBeenCalled()
    expect(scheduleEvery).not.toHaveBeenCalled()
    expect(fake.check).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  it('does nothing under --self-test', async () => {
    const { updater, fake, schedule, scheduleEvery, log } = setup({ selfTest: true })
    updater.start()
    await vi.advanceTimersByTimeAsync(24 * HOUR)
    expect(fake.listenerCount()).toBe(0)
    expect(schedule).not.toHaveBeenCalled()
    expect(scheduleEvery).not.toHaveBeenCalled()
    expect(fake.check).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  it('configures auto download and the channel from the version', () => {
    const beta = setup({ version: '0.2.0-beta.1' })
    beta.updater.start()
    expect(beta.fake.autoUpdater).toMatchObject({
      allowPrerelease: true,
      autoDownload: true,
      autoInstallOnAppQuit: true,
    })

    const stable = setup({ version: '0.2.0' })
    stable.updater.start()
    expect(stable.fake.autoUpdater).toMatchObject({
      allowPrerelease: false,
      autoDownload: true,
      autoInstallOnAppQuit: true,
    })
  })

  it('checks 10 seconds after start and then every 6 hours', async () => {
    const { updater, fake } = setup()
    updater.start()
    await vi.advanceTimersByTimeAsync(UPDATE_FIRST_CHECK_DELAY_MS - 1)
    expect(fake.check).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(fake.check).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS - 1)
    expect(fake.check).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fake.check).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS)
    expect(fake.check).toHaveBeenCalledTimes(3)
  })

  it('a failed check is logged and not thrown', async () => {
    const { updater, fake, log } = setup()
    const failure = new Error('offline')
    fake.check.mockRejectedValueOnce(failure)
    updater.start()
    await vi.advanceTimersByTimeAsync(UPDATE_FIRST_CHECK_DELAY_MS)
    expect(log).toHaveBeenCalledWith('Update check failed', failure)
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS)
    expect(fake.check).toHaveBeenCalledTimes(2)
  })

  it('an updater error event is logged', () => {
    const { updater, fake, log, send } = setup()
    updater.start()
    const failure = new Error('bad signature')
    fake.error(failure)
    expect(log).toHaveBeenCalledWith('Update check failed', failure)
    expect(send).not.toHaveBeenCalled()
  })

  it('update-downloaded sends update:ready with the version', async () => {
    const { updater, fake, send } = setup()
    updater.start()
    await vi.advanceTimersByTimeAsync(UPDATE_FIRST_CHECK_DELAY_MS)
    fake.downloaded('0.2.0')
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('update:ready', { version: '0.2.0' })
    expect(updater.ready).toEqual({ version: '0.2.0' })
    await vi.advanceTimersByTimeAsync(12 * HOUR)
    expect(fake.check).toHaveBeenCalledTimes(1)
  })

  it('install quits and installs after an update is ready', () => {
    const { updater, fake } = setup()
    updater.start()
    fake.downloaded('0.2.0')
    updater.install()
    expect(fake.quitAndInstall).toHaveBeenCalledTimes(1)
    expect(fake.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('install does nothing before an update is ready', () => {
    const { updater, fake } = setup()
    updater.start()
    updater.install()
    expect(fake.quitAndInstall).not.toHaveBeenCalled()
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

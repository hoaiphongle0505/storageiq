import { describe, expect, it, vi } from 'vitest'
import type { LaunchRequest } from '@shared/ipc-contract'
import { createLaunchCoordinator } from './launch-coordinator'

function setup(
  stat: () => Promise<{ isDirectory(): boolean }> = () =>
    Promise.resolve({ isDirectory: () => true }),
) {
  const send = vi.fn<(request: LaunchRequest) => void>()
  const focus = vi.fn()
  const coordinator = createLaunchCoordinator({ stat, send, focus })
  return { coordinator, send, focus }
}

const argv = (path: string) => ['app.exe', '--scan', path]

describe('createLaunchCoordinator', () => {
  it('holds a first-launch request until the renderer takes it', async () => {
    const { coordinator, send, focus } = setup()
    await coordinator.handleArgv(argv('D:\\Data'))
    expect(send).not.toHaveBeenCalled()
    expect(focus).not.toHaveBeenCalled()
    expect(coordinator.take()).toEqual({ kind: 'scan', path: 'D:\\Data' })
  })

  it('take clears the pending request', async () => {
    const { coordinator } = setup()
    await coordinator.handleArgv(argv('D:\\Data'))
    coordinator.take()
    expect(coordinator.take()).toBeNull()
  })

  it('sends a second-instance request immediately once ready and focuses', async () => {
    const { coordinator, send, focus } = setup()
    coordinator.take()
    await coordinator.handleArgv(argv('D:\\Data'))
    expect(send).toHaveBeenCalledWith({ kind: 'scan', path: 'D:\\Data' })
    expect(focus).toHaveBeenCalledTimes(1)
    expect(coordinator.take()).toBeNull()
  })

  it('holds it again after rendererGone', async () => {
    const { coordinator, send } = setup()
    coordinator.take()
    coordinator.rendererGone()
    await coordinator.handleArgv(argv('D:\\Data'))
    expect(send).not.toHaveBeenCalled()
    expect(coordinator.take()).toEqual({ kind: 'scan', path: 'D:\\Data' })
  })

  it('the latest pending request wins', async () => {
    const { coordinator } = setup()
    await coordinator.handleArgv(argv('D:\\One'))
    await coordinator.handleArgv(argv('D:\\Two'))
    expect(coordinator.take()).toEqual({ kind: 'scan', path: 'D:\\Two' })
  })

  it('an argv without --scan does nothing', async () => {
    const { coordinator, send, focus } = setup()
    coordinator.take()
    await coordinator.handleArgv(['app.exe', '--no-sandbox'])
    expect(send).not.toHaveBeenCalled()
    expect(focus).not.toHaveBeenCalled()
    expect(coordinator.take()).toBeNull()
  })

  it('an invalid request is delivered as invalid', async () => {
    const { coordinator, send } = setup()
    coordinator.take()
    await coordinator.handleArgv(argv('Relative'))
    expect(send).toHaveBeenCalledWith({
      kind: 'invalid',
      message: 'Choose a full path such as C:\\Folder.',
    })
  })

  it('a stat failure becomes a not-found message', async () => {
    const { coordinator } = setup(() => Promise.reject(new Error('EPERM')))
    await coordinator.handleArgv(argv('D:\\Gone'))
    expect(coordinator.take()).toEqual({
      kind: 'invalid',
      message: 'That folder could not be found.',
    })
  })
})

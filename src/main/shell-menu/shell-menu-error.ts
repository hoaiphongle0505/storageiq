/** A shell call that returned a failing HRESULT; `hresult` is the unsigned 32-bit value. */
export class ShellMenuError extends Error {
  readonly hresult: number
  readonly step: string

  constructor(step: string, hresult: number) {
    const unsigned = hresult >>> 0
    super(`${step} failed (0x${unsigned.toString(16)})`)
    this.name = 'ShellMenuError'
    this.step = step
    this.hresult = unsigned
  }
}

/** ERROR_FILE_NOT_FOUND and ERROR_PATH_NOT_FOUND as HRESULTs: the item no longer exists. */
export const SHELL_PATH_GONE_HRESULTS: readonly number[] = [0x80070002, 0x80070003]

/** E_FAIL: used when something other than a failing HRESULT went wrong. */
export const E_FAIL = 0x80004005

/** ERROR_CANCELLED as an HRESULT: the user pressed Cancel in Windows' dialog. */
export const HRESULT_CANCELLED = 0x800704c7

export function isShellPathGone(error: unknown): boolean {
  return error instanceof ShellMenuError && SHELL_PATH_GONE_HRESULTS.includes(error.hresult)
}

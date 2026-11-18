/** ERR_ABORTED: the navigation was cancelled (for example by our own navigation lock). */
const ERR_ABORTED = -3

export function shouldTreatAsFatalLoadFailure(errorCode: number, isMainFrame: boolean): boolean {
  return isMainFrame && errorCode !== ERR_ABORTED
}

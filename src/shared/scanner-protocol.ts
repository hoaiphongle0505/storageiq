import type { ScanDone, ScanProgress } from './scan-types'

/** Name of the scanner utilityProcess; it is the `name` in `app.getAppMetrics()`. */
export const SCANNER_SERVICE_NAME = 'StorageIQ scanner'

/** main → scanner process. */
export type ScannerRequest =
  { type: 'start'; scanId: string; root: string } | { type: 'cancel'; scanId: string }

/** scanner process → main. */
export type ScannerMessage =
  { type: 'progress'; payload: ScanProgress } | { type: 'done'; payload: ScanDone }

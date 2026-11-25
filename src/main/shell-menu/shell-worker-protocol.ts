import type { ShellMenuChoice } from './context-menu'

/** Main → worker. Plain JSON-serialisable; paths come from the scanner only. */
export type WorkerRequest =
  | {
      type: 'show'
      id: number
      paths: string[]
      /** Screen pixels. */
      x: number
      y: number
      extended: boolean
      hideDestructive: boolean
    }
  | { type: 'probe'; id: number; paths: string[]; hideDestructive: boolean }
  /** Native tests and nothing else: build the menu without showing it and run one verb. */
  | { type: 'invoke-verb'; id: number; paths: string[]; verb: string }
  /**
   * Keyboard Delete (`permanent`: Shift+Delete): runs the shell's `"delete"` verb on `paths`
   * with no menu. Allowed in production; Windows shows its own dialogs.
   */
  | { type: 'invoke-delete'; id: number; paths: string[]; permanent: boolean }
  /** Empties the Recycle Bin of the drive `root` (`C:` + backslash) with Windows' own dialogs. */
  | { type: 'empty-bin'; id: number; root: string }
  /** Close the worker once it has finished loading (used instead of terminate() before `ready`). */
  | { type: 'exit' }

/** Worker → main. */
export type WorkerReply =
  /** koffi is loaded and COM is initialised: the thread may be terminated from now on. */
  | { type: 'ready' }
  /** The menu closed; sent before the command runs. */
  | { type: 'chosen'; id: number; choice: ShellMenuChoice }
  /** `InvokeCommand` or `PerformOperations` returned. For dismissed and StorageIQ items it follows `chosen` at once. */
  | { type: 'finished'; id: number; ok: boolean; hresult?: number; step?: string }
  /** The menu could not be built. */
  | { type: 'failed'; id: number; hresult: number; step: string }
  | { type: 'probed'; id: number; labels: string[] }
  /** The popup is about to open; `hwnd` is the owner window (main may post WM_CANCELMODE to it at quit). */
  | { type: 'tracking'; id: number; hwnd: string }

/** The verb name `invoke-verb` uses for the IFileOperation fallback. */
export const FALLBACK_RECYCLE_VERB = '@fallback-recycle'

/** The pool starts the worker with this `workerData`, so importing the file (tests) never starts it. */
export const SHELL_WORKER_DATA = { storageiqShellWorker: true } as const

/** Native tests only: `workerData` that also enables the menu-less `invoke-verb` request. */
export const SHELL_WORKER_TEST_DATA = { ...SHELL_WORKER_DATA, testVerbs: true } as const

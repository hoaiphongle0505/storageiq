# Phase 2a — Core Scanner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user picks a fixed or removable drive, or a folder, and StorageIQ scans it in a separate scanner process. While it runs, the screen shows live counts, the current path and the largest folders found so far, with an always-available Cancel. When it ends, the screen shows the totals, the 10 largest top-level folders plus "Everything else", and every folder that could not be read, with a plain-language reason. A scanner crash shows a recoverable error screen.

**Architecture:** The renderer calls main through the typed contract in `src/shared/ipc-contract.ts`. Main validates every argument with a per-channel `parseArgs`, then forwards scan requests to a scanner Electron `utilityProcess` (built from `src/worker/scanner/entry.ts` as a second electron-vite main input). The scanner walks the tree with `fs.promises.opendir` + `lstat`, at most 16 directories in flight. It never follows symlinks or junctions, never opens file contents, keeps a folders-only tree in memory (approach A of the spec), and posts a snapshot about every 250 ms. Main relays the snapshots to the main window as `scan:progress`, `scan:done` and `scan:failed` events through `sendEvent`. The preload exposes them as `onScanProgress/onScanDone/onScanFailed(cb) => unsubscribe`. Drives come from kernel32 through koffi (behind an interface) plus `fs.statfs`. A Zustand scan store drives three screens (pick location, scanning, result) and a crash screen.

**Tech Stack:** Electron 45.3.4 (`utilityProcess`, Node 24.22.3), electron-vite 6.0.0 on Vite 8.3.8 (rolldown), React 19.3.1, TypeScript 6.0.3 (strict), Tailwind 4.3.5, Zustand 5.1.0, Vitest 5.1.1 + Testing Library + jsdom, Playwright 1.65.1 (`_electron`), electron-builder 26.18.0, **koffi 3.3.8** (new, the only new dependency).

**Spec:** [Phase 2a — Core Scanner: Design](../specs/2026-11-19-phase-2a-core-scanner-design.md). The spec governs; this plan maps every section and acceptance criterion to a task (see "Self-review" at the end).

**Model routing (for the controller):** every task starts with an `**Implementer tier:**` line. `cheap` means the plan contains all code and tests, so a fast model can transcribe and run it. `standard` means the task needs judgment or integration with Electron, packaging or the UI (a standard model; review on the strong model as in Phase 1).

## Global Constraints

Carried forward from Phase 1 (binding):

- Installed versions stay as recorded in the Phase 1 outcome (Electron 45.3.4, electron-vite 6.0.0, Vite 8.3.8, TypeScript 6.0.3, React 19.3.1, Tailwind 4.3.5, Zustand 5.1.0, Vitest 5.1.1, Playwright 1.65.1, electron-builder 26.18.0). `@types/node` stays on `^24` (the Node inside Electron 45). Do not upgrade anything in this phase.
- The only new dependency is `koffi`, pinned exactly to `3.3.8` (`npm install --save-exact koffi@3.3.8`). It is a runtime `dependency`, not a dev dependency, because it ships a native module that must be in the packaged app (deviation from Phase 1's "everything is a dev dependency", recorded in the roadmap). Never use `--force` or `--legacy-peer-deps`.
- Target Windows 10 1809+ / Windows 11, x64 only. License MIT. appId `io.github.storageiq.app`. productName `StorageIQ`. Version `0.1.0`.
- Renderer security baseline is unchanged: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict CSP, no `window.open`, no foreign navigation, no `<webview>`, every IPC call checks its sender (main window, top frame, trusted URL), all permission requests denied.
- New in this phase and binding: every IPC channel has a typed `parseArgs`; invalid arguments reject with an `Error` and the handler never runs. The renderer receives main → renderer events only through the preload `onX(cb) => unsubscribe` functions, and the callback never receives the `IpcRendererEvent`. Scanner output is relayed through main; no `MessagePort` ever reaches the renderer. The scanner never follows reparse points (symlinks, junctions), never opens file contents, never asks for elevation, and refuses UNC paths.
- TypeScript `strict` plus `noUncheckedIndexedAccess`. No `any`, no `@ts-ignore`.
- Path aliases: `@shared/*` → `src/shared/*`; `@renderer/*` → `src/renderer/src/*`.
- Prettier style: no semicolons, single quotes, print width 100, trailing commas (`.prettierrc.json`). Run `npm run format` before `npm run format:check`.
- Copy is plain language for non-experts and uses typographic punctuation: apostrophe `’`, ellipsis `…`, em dash `—`. Exact UI strings are listed in Task 6 and must not be reworded.
- Unit tests run with Vitest **from PowerShell or cmd, not Git Bash**. Unit tests assume Windows path semantics (CI runs on `windows-latest`).
- Before launching Electron (dev, E2E, packaged checks), remove `ELECTRON_RUN_AS_NODE` from the environment: `Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue`. E2E needs an interactive desktop session.
- Commits: one commit per task, conventional-commit message, ending with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage **explicit paths only** (`git add <path> …`); never `git add -A`, `git add .` or `git commit -a`. Ask the user before the first commit if they have not already approved commits.
- No future-phase work: no cloud-only/hardlink accounting, no "Windows reports X" reconciliation, no `FindFirstFileExW` (Phase 2b); no tree view (Phase 3); no largest-files list, explanations or CSV (Phase 4); no SQLite (Phase 7). Roadmap carry-over item 9 (CSV through main's `clipboard`) stays in Phase 4 and is not touched here.
- UI work (Task 6): before editing, run `impeccable context` once and read the Impeccable `reference/craft-floor.md`. Run `modern-web-guidance` searches for `"live region progress announcements"`, `"disclosure details summary"` and `"progress bar meter accessibility"` and apply matching guidance. After the UI is finished, run `impeccable detect --json` on the changed renderer files.

---

## File Map

| File                                                                                                           | Responsibility                                                                      | Task             |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------- |
| `e2e/support/capture-console.cjs`, `e2e/support/csp-listener.cjs`, `e2e/support/launch.ts`                     | Console + CSP listeners attached before the first page load; shared launcher        | 1                |
| `eslint.config.mjs`                                                                                            | Lint scopes for `.cjs` hooks, `src/worker`, `scripts`                               | 1, 3, 5          |
| `src/shared/scan-types.ts`                                                                                     | `DriveInfo`, `FolderSummary`, `ScanError`, `ScanProgress`, `ScanDone`, `ScanFailed` | 2                |
| `src/shared/ipc-contract.ts`                                                                                   | Channels, `IpcEventContract`, `StorageIQApi`                                        | 2, 4, 5          |
| `src/main/ipc/parse-args.ts` (+ test)                                                                          | `InvalidIpcArgumentsError`, `noArgs`, `oneString`                                   | 2                |
| `src/main/ipc/register.ts` (+ test)                                                                            | Registration with sender check, then `parseArgs`, then handler                      | 2                |
| `src/main/ipc/app-handlers.ts` (+ test)                                                                        | `Pick<IpcHandlerMap, 'app:get-info' \| 'dialog:select-folder'>`                     | 2                |
| `src/main/ipc/send-event.ts` (+ test)                                                                          | `sendEvent` to the main window only                                                 | 2                |
| `src/preload/subscribe.ts` (+ test), `src/preload/index.ts`                                                    | `onX(cb) => unsubscribe`, bridge                                                    | 2, 4, 5          |
| `src/worker/scanner/walk.ts`, `tree.ts`, `top-folders.ts` (+ tests), `src/worker/scanner/test/fake-walk-fs.ts` | Pure scanner core                                                                   | 3                |
| `src/shared/scanner-protocol.ts`                                                                               | main ↔ scanner messages, scanner service name                                       | 4                |
| `src/worker/scanner/scanner-host.ts` (+ test), `src/worker/scanner/entry.ts`                                   | Scanner process: start/cancel, 250 ms snapshots                                     | 4                |
| `src/main/scan/scan-service.ts` (+ test)                                                                       | Fork, supersede, relay, crash → `scan:failed`, kill on quit                         | 4                |
| `src/main/ipc/scan-handlers.ts` (+ test)                                                                       | `scan:start`, `scan:cancel` with `parseArgs`                                        | 4                |
| `src/main/render-process-gone.ts` (+ test), `src/main/window.ts`                                               | Renderer-crash policy                                                               | 4                |
| `src/main/index.ts`                                                                                            | Wiring                                                                              | 2, 4, 5          |
| `electron.vite.config.ts`, `tsconfig.node.json`                                                                | Worker as second main input                                                         | 3, 4             |
| `e2e/support/fixture.ts`                                                                                       | Generated scan fixtures                                                             | 4, 7             |
| `src/main/drives/drive-api.ts`, `list-drives.ts` (+ test), `koffi-drive-api.ts`                                | Drive enumeration                                                                   | 5                |
| `src/main/ipc/drive-handlers.ts` (+ test)                                                                      | `drives:list`                                                                       | 5                |
| `src/main/self-test.ts` (+ test), `scripts/check-packaged-app.mjs`                                             | Packaged-app check: koffi from `app.asar.unpacked`, scanner process runs            | 5                |
| `electron-builder.yml`, `package.json`, `package-lock.json`                                                    | koffi dependency, `asarUnpack`, `npmRebuild: false`, scripts                        | 5, 7             |
| `src/renderer/src/lib/format.ts`, `lib/use-throttled-announcement.ts` (+ tests)                                | Formatting, throttled live-region text                                              | 6                |
| `src/renderer/src/stores/scan-store.ts` (+ test), `scan-store-context.tsx`, `app-store.ts` (+ test)            | Scan state machine; app store slimmed to app info                                   | 6                |
| `src/renderer/src/components/*` (+ tests), `App.tsx` (+ test), `main.tsx`                                      | Screens and shared components                                                       | 6                |
| `src/renderer/src/test/fake-api.ts`, `test/render.tsx`, `test/scan-fixtures.ts`                                | Renderer test helpers                                                               | 2, 4, 5, 6       |
| `DESIGN.md`                                                                                                    | New components and the busy-button rule                                             | 6                |
| `e2e/app.spec.ts`, `e2e/scan.spec.ts`, `e2e/metrics.spec.ts`                                                   | E2E                                                                                 | 1, 2, 4, 5, 6, 7 |
| `scripts/report-metrics.mjs`, `.github/workflows/ci.yml`, `.gitignore`, `.prettierignore`                      | Explicit build step, packaged check, report-only metrics                            | 7                |
| `README.md`, `docs/ROADMAP.md`                                                                                 | Phase 2a completion, carry-over status                                              | 7                |

## Roadmap carry-over schedule

| #   | Carry-over item (docs/ROADMAP.md)                                                                     | Task                                    |
| --- | ----------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 1   | E2E console + `securitypolicyviolation` listeners before the first page load                          | 1                                       |
| 2   | Handler factories return `Pick<IpcHandlerMap, …>`; full map uses `satisfies IpcHandlerMap`            | 2 (and 4, 5 for new factories)          |
| 3   | Typed per-channel `parseArgs`                                                                         | 2 (infrastructure), 4, 5 (channels)     |
| 4   | `IpcEventContract`, `sendEvent`, preload `onX`, relay through main, kill on quit, worker as 2nd input | 2 (events), 4 (relay, kill, build)      |
| 5   | `render-process-gone` policy, decided with the scanner-crash policy                                   | 4                                       |
| 6   | Store test: `loadAppInfo` retries after an error                                                      | 6                                       |
| 7   | CI: renderer bundle size, installer size, idle RAM; explicit build step                               | 7                                       |
| 8   | Busy (`aria-disabled`) button shows no hover colour                                                   | 6 (fix + unit test), 7 (E2E check)      |
| 9   | Phase 4: copy CSV through main's `clipboard`                                                          | **Stays in Phase 4** (not in this plan) |

---

### Task 1: E2E listeners attached before the first page load (carry-over 1)

**Implementer tier:** cheap

Why a hook: `electron.launch()` resolves only after Playwright has emitted Electron's `ready` event (verified in `node_modules/playwright-core/lib/coreBundle.js`: `ElectronApplication.initialize()` evaluates `__playwright_run()` inside `launch`), so the app may already be creating and loading its window before the test can call `page.on('console')`. Electron accepts several `-r` (require) flags and runs them before the app's main script (verified locally: `electron -r a.cjs --remote-debugging-port=0 -r b.cjs .` loads both hooks before the app's `whenReady` callbacks). The hook listens to every webContents' `console-message` in the main process and registers a test-only frame preload through `session.registerPreloadScript` (Electron 45 API, verified in `electron.d.ts`), which adds the `securitypolicyviolation` listener before any page script runs (verified locally: the preload ran at `document.readyState === 'loading'` and reported a CSP violation). Nothing here ships in the app.

**Files:**

- Create: `e2e/support/capture-console.cjs`, `e2e/support/csp-listener.cjs`, `e2e/support/launch.ts`
- Modify: `e2e/app.spec.ts`, `eslint.config.mjs`

**Interfaces:**

- Consumes: the Phase 1 app as built by `electron-vite build`.
- Produces:
  - `launchEnv: Record<string, string>` (process env without `ELECTRON_RUN_AS_NODE`)
  - `LaunchedApp { app: ElectronApplication; page: Page }`, `launchApp(): Promise<LaunchedApp>`
  - `consoleErrors(app: ElectronApplication): Promise<string[]>`, `cspListenerReady(app: ElectronApplication): Promise<boolean>`
  - Main-process globals (test only): `__e2eConsoleErrors: string[]`, `__e2eCspListenerReady: boolean`

- [ ] **Step 1: Write the main-process capture hook**

`e2e/support/capture-console.cjs`:

```js
// Test-only. Loaded with `electron -r` before the app's main script, so these listeners exist
// before the first window is created. It is never part of the build or the installer.
const path = require('node:path')
const { app, session } = require('electron')

const CSP_LISTENER_READY = '[e2e] securitypolicyviolation listener attached'

globalThis.__e2eConsoleErrors = []
globalThis.__e2eCspListenerReady = false

app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (details) => {
    if (details.message === CSP_LISTENER_READY) {
      globalThis.__e2eCspListenerReady = true
    } else if (details.level === 'error') {
      globalThis.__e2eConsoleErrors.push(details.message)
    }
  })
})

// This callback is registered before the app's own whenReady callbacks, so the preload below is
// in place before the main window is created and loads its first page.
void app.whenReady().then(() => {
  session.defaultSession.registerPreloadScript({
    type: 'frame',
    filePath: path.join(__dirname, 'csp-listener.cjs'),
  })
})
```

- [ ] **Step 2: Write the test-only frame preload**

`e2e/support/csp-listener.cjs`:

```js
// Test-only frame preload, registered by capture-console.cjs. It runs before any page script,
// so CSP violations during the very first load are reported as console errors.
document.addEventListener('securitypolicyviolation', (event) => {
  console.error(`[csp] ${event.violatedDirective} ${event.blockedURI}`)
})
console.info('[e2e] securitypolicyviolation listener attached')
```

- [ ] **Step 3: Write the shared launcher**

`e2e/support/launch.ts`:

```ts
import path from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

// ELECTRON_RUN_AS_NODE makes Electron behave as plain Node, so it must not leak into the launch.
export const launchEnv: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && entry[0] !== 'ELECTRON_RUN_AS_NODE',
  ),
)

const captureHook = path.join(__dirname, 'capture-console.cjs')

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
}

/** Launches the built app with the console/CSP capture hook loaded before the main script. */
export async function launchApp(): Promise<LaunchedApp> {
  const app = await electron.launch({ args: ['-r', captureHook, '.'], env: launchEnv })
  const page = await app.firstWindow()
  return { app, page }
}

interface CaptureScope {
  __e2eConsoleErrors: string[]
  __e2eCspListenerReady: boolean
}

/** Every renderer console error since launch, including `[csp] …` violation reports. */
export function consoleErrors(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => [...(globalThis as unknown as CaptureScope).__e2eConsoleErrors])
}

export function cspListenerReady(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(() => (globalThis as unknown as CaptureScope).__e2eCspListenerReady)
}
```

- [ ] **Step 4: Rewrite the E2E spec to use the launcher**

`e2e/app.spec.ts` (full file):

```ts
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import { consoleErrors, cspListenerReady, launchApp } from './support/launch'

let app: ElectronApplication | undefined
let page: Page

test.beforeEach(async () => {
  const launched = await launchApp()
  app = launched.app
  page = launched.page
})

test.afterEach(async () => {
  await app?.close()
  app = undefined
})

test('launches a locked-down renderer with the StorageIQ bridge', async () => {
  await expect(page).toHaveTitle('StorageIQ')
  await expect(
    page.getByRole('heading', { level: 1, name: 'See what’s filling your disk' }),
  ).toBeVisible()

  const exposure = await page.evaluate(() => {
    const scope = globalThis as unknown as Record<string, unknown>
    return {
      require: typeof scope['require'],
      process: typeof scope['process'],
      storageiq: typeof scope['storageiq'],
    }
  })
  expect(exposure).toEqual({ require: 'undefined', process: 'undefined', storageiq: 'object' })

  const keys = await page.evaluate(() =>
    Object.keys((globalThis as unknown as { storageiq: object }).storageiq).sort(),
  )
  expect(keys).toEqual(['getAppInfo', 'selectFolder'])
})

test('shows the version reported by the main process', async () => {
  const version = await app!.evaluate(({ app: electronApp }) => electronApp.getVersion())
  await expect(
    page.getByRole('contentinfo').getByText(`StorageIQ ${version}`, { exact: true }),
  ).toBeVisible()
})

test('shows the folder chosen in the native picker', async () => {
  await app!.evaluate(({ dialog }) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: ['C:\\StorageIQ-e2e'],
    })) as typeof dialog.showOpenDialog
  })

  await page.getByRole('button', { name: 'Choose folder' }).click()

  await expect(page.getByText('Selected folder')).toBeVisible()
  await expect(page.getByRole('contentinfo')).toContainText('C:\\StorageIQ-e2e')
  await expect(page.getByRole('button', { name: 'Choose a different folder' })).toBeVisible()
})

test('logs no console errors or CSP violations from the first page load on', async () => {
  await expect.poll(() => cspListenerReady(app!)).toBe(true)
  await expect(page.getByRole('contentinfo').getByText(/^StorageIQ \d/)).toBeVisible()
  expect(await consoleErrors(app!)).toEqual([])
})

test('the listeners really catch a CSP violation', async () => {
  // A remote script is blocked by `script-src 'self'`; the hook must report it.
  await page.addScriptTag({ url: 'https://example.invalid/blocked.js' }).catch(() => undefined)
  await expect
    .poll(() => consoleErrors(app!))
    .toContainEqual(expect.stringContaining('[csp] script-src'))
})
```

- [ ] **Step 5: Give the `.cjs` hooks their lint scope**

In `eslint.config.mjs`, add these two blocks at the end of the `defineConfig(...)` argument list (after the existing node-globals block):

```js
  {
    files: ['e2e/support/capture-console.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['e2e/support/csp-listener.cjs'],
    languageOptions: { sourceType: 'script', globals: globals.browser },
  },
```

- [ ] **Step 6: Run the E2E suite**

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm run test:e2e
```

Expected: 5 tests pass. If `the listeners really catch a CSP violation` fails, the hook is not loaded: check that `launchApp` passes `-r <path>` before `.`. If `logs no console errors…` now fails with a real message, the earlier, late-attached listener had been missing a startup error: fix its cause; do not relax the test.

- [ ] **Step 7: Run quality gates**

```powershell
npm run format
npm run format:check
npm run lint
npm run typecheck
npm test
```

Expected: every command exits 0; the unit tests are unchanged (49 pass).

- [ ] **Step 8: Commit**

```powershell
git add e2e/support/capture-console.cjs e2e/support/csp-listener.cjs e2e/support/launch.ts e2e/app.spec.ts eslint.config.mjs
git commit -m "test(e2e): attach console and CSP listeners before the first page load" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: IPC infrastructure — `Pick` factories, `parseArgs`, events, `sendEvent`, preload `onX`

**Implementer tier:** cheap

The loadAppInfo retry test (carry-over 6) does not fit here naturally (this task does not touch the store logic), so it goes in Task 6 with the app-store rewrite.

**Files:**

- Create: `src/shared/scan-types.ts`, `src/main/ipc/parse-args.ts`, `src/main/ipc/send-event.ts`, `src/preload/subscribe.ts`
- Modify: `src/shared/ipc-contract.ts`, `src/main/ipc/register.ts`, `src/main/ipc/app-handlers.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/test/fake-api.ts`, `e2e/app.spec.ts`
- Test: `src/main/ipc/parse-args.test.ts`, `src/main/ipc/register.test.ts` (rewrite), `src/main/ipc/app-handlers.test.ts` (rewrite), `src/main/ipc/send-event.test.ts`, `src/preload/subscribe.test.ts`

**Interfaces:**

- Consumes: `IpcContract`, `IpcChannel`, `IpcArgs`, `IpcResult`, `AppInfo`, `SelectFolderResult` (Phase 1).
- Produces:
  - `src/shared/scan-types.ts`: `DriveKind = 'fixed' | 'removable'`; `DriveInfo { root; label; kind; totalBytes; freeBytes }`; `FolderSummary { kind: 'folder' | 'everything-else'; name; path; bytes; files; folders }`; `ScanErrorReason = 'access-denied' | 'path-too-long' | 'not-found' | 'other'`; `ScanError { path; reason; code }`; `ScanProgress { scanId; files; folders; bytes; currentPath; elapsedMs; topFolders }`; `ScanStatus = 'complete' | 'canceled'`; `ScanDone { scanId; status; files; folders; bytes; elapsedMs; topFolders; errors; errorCount }`; `ScanFailed { scanId; message }`; `ScanStartResult { scanId }`
  - `src/shared/ipc-contract.ts`: `IpcEventContract { 'scan:progress': ScanProgress; 'scan:done': ScanDone; 'scan:failed': ScanFailed }`, `IpcEventChannel`, `IpcEventPayload<E>`, `Unsubscribe = () => void`, `StorageIQApi` gains `onScanProgress`, `onScanDone`, `onScanFailed` (each `(listener) => Unsubscribe`)
  - `src/main/ipc/parse-args.ts`: `InvalidIpcArgumentsError`, `noArgs(args): []`, `oneString(args): [string]`
  - `src/main/ipc/register.ts`: `IpcChannelHandler<C> { parseArgs(args: readonly unknown[]): IpcArgs<C> | Promise<IpcArgs<C>>; handle(event, ...args: IpcArgs<C>): IpcResult<C> | Promise<IpcResult<C>> }`, `IpcHandlerMap = { [C in IpcChannel]: IpcChannelHandler<C> }`, `IpcRegistrar`, `UntrustedSenderError`, `registerIpcHandlers(ipc, handlers, isTrustedSender)`
  - `src/main/ipc/app-handlers.ts`: `AppHandlerDeps`, `AppHandlers = Pick<IpcHandlerMap, 'app:get-info' | 'dialog:select-folder'>`, `createAppHandlers(deps): AppHandlers`
  - `src/main/ipc/send-event.ts`: `EventWindow`, `SendEvent = <E extends IpcEventChannel>(channel: E, payload: IpcEventPayload<E>) => void`, `createEventSender(getMainWindow: () => EventWindow | null): SendEvent`
  - `src/preload/subscribe.ts`: `IpcEventSource`, `subscribe(source, channel, listener): Unsubscribe`
  - `src/renderer/src/test/fake-api.ts`: `TEST_APP_INFO`, `FakeApi extends StorageIQApi { emitScanProgress; emitScanDone; emitScanFailed; listenerCount(): number }`, `createFakeApi(overrides?): FakeApi`

- [ ] **Step 1: Write the shared scan types**

`src/shared/scan-types.ts`:

```ts
/** Drives StorageIQ lists: fixed disks and removable (USB) drives. Network and optical are left out. */
export type DriveKind = 'fixed' | 'removable'

export interface DriveInfo {
  /** Drive root with a trailing backslash, for example `C:\`. */
  root: string
  /** Volume label, or `Local Disk` / `USB Drive` when the volume has none. */
  label: string
  kind: DriveKind
  totalBytes: number
  freeBytes: number
}

/** One row of the largest-folders list: a direct child of the scanned root, or the remainder. */
export interface FolderSummary {
  kind: 'folder' | 'everything-else'
  name: string
  /** Full path of the folder; for `everything-else`, the scanned root. */
  path: string
  /** Logical size (`stat.size`) of every file below the folder. */
  bytes: number
  files: number
  /** Folders below this one, not counting itself. */
  folders: number
}

export type ScanErrorReason = 'access-denied' | 'path-too-long' | 'not-found' | 'other'

export interface ScanError {
  path: string
  reason: ScanErrorReason
  /** The Node.js error code, for example `EPERM`. */
  code: string
}

export interface ScanProgress {
  scanId: string
  files: number
  /** Folders found below the scanned root (the root itself is not counted). */
  folders: number
  bytes: number
  currentPath: string
  elapsedMs: number
  topFolders: FolderSummary[]
}

export type ScanStatus = 'complete' | 'canceled'

export interface ScanDone {
  scanId: string
  status: ScanStatus
  files: number
  folders: number
  bytes: number
  elapsedMs: number
  topFolders: FolderSummary[]
  /** At most 1000 entries, in the order they happened; `errorCount` is the exact total. */
  errors: ScanError[]
  errorCount: number
}

export interface ScanFailed {
  scanId: string
  message: string
}

export interface ScanStartResult {
  scanId: string
}
```

- [ ] **Step 2: Add the event contract to the IPC contract**

`src/shared/ipc-contract.ts` (full file):

```ts
import type { ScanDone, ScanFailed, ScanProgress } from './scan-types'

/** Metadata about the running application, shown in the status bar. */
export interface AppInfo {
  name: string
  version: string
  platform: string
  arch: string
  electronVersion: string
}

/** Outcome of the native "choose a folder" dialog. */
export type SelectFolderResult = { canceled: true } | { canceled: false; path: string }

/**
 * Single source of truth for every renderer → main request.
 * Each channel maps to its argument tuple and its resolved result.
 */
export interface IpcContract {
  'app:get-info': { args: []; result: AppInfo }
  'dialog:select-folder': { args: []; result: SelectFolderResult }
}

export type IpcChannel = keyof IpcContract
export type IpcArgs<C extends IpcChannel> = IpcContract[C]['args']
export type IpcResult<C extends IpcChannel> = IpcContract[C]['result']

/** Single source of truth for every main → renderer event and its payload. */
export interface IpcEventContract {
  'scan:progress': ScanProgress
  'scan:done': ScanDone
  'scan:failed': ScanFailed
}

export type IpcEventChannel = keyof IpcEventContract
export type IpcEventPayload<E extends IpcEventChannel> = IpcEventContract[E]

/** Stops a subscription made with one of the `on…` functions. */
export type Unsubscribe = () => void

/** The API the preload script exposes to the renderer as `window.storageiq`. */
export interface StorageIQApi {
  getAppInfo(): Promise<AppInfo>
  selectFolder(): Promise<SelectFolderResult>
  onScanProgress(listener: (progress: ScanProgress) => void): Unsubscribe
  onScanDone(listener: (done: ScanDone) => void): Unsubscribe
  onScanFailed(listener: (failed: ScanFailed) => void): Unsubscribe
}
```

- [ ] **Step 3: Write the failing `parseArgs` helper tests**

`src/main/ipc/parse-args.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { InvalidIpcArgumentsError, noArgs, oneString } from './parse-args'

describe('noArgs', () => {
  it('accepts an empty argument list', () => {
    expect(noArgs([])).toEqual([])
  })

  it('rejects any argument', () => {
    expect(() => noArgs(['surprise'])).toThrow(InvalidIpcArgumentsError)
  })
})

describe('oneString', () => {
  it('accepts exactly one string', () => {
    expect(oneString(['C:\\Data'])).toEqual(['C:\\Data'])
  })

  it.each([[[]], [['a', 'b']]])('rejects %j (wrong number of arguments)', (args) => {
    expect(() => oneString(args)).toThrow(InvalidIpcArgumentsError)
  })

  it.each([[[42]], [[null]]])('rejects %j (not a string)', (args) => {
    expect(() => oneString(args)).toThrow('Invalid IPC arguments: expected a string')
  })
})
```

- [ ] **Step 4: Rewrite the registration tests**

`src/main/ipc/register.test.ts` (full file):

```ts
import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { AppInfo } from '@shared/ipc-contract'
import { InvalidIpcArgumentsError, noArgs } from './parse-args'
import {
  type IpcHandlerMap,
  type IpcRegistrar,
  registerIpcHandlers,
  UntrustedSenderError,
} from './register'

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

const appInfo: AppInfo = {
  name: 'StorageIQ',
  version: '0.1.0',
  platform: 'win32',
  arch: 'x64',
  electronVersion: '38.0.0',
}

function createHandlers(overrides: Partial<IpcHandlerMap> = {}): IpcHandlerMap {
  return {
    'app:get-info': { parseArgs: noArgs, handle: () => appInfo },
    'dialog:select-folder': { parseArgs: noArgs, handle: () => ({ canceled: true }) },
    ...overrides,
  }
}

function createFakeIpc(): IpcRegistrar & { listeners: Map<string, Listener> } {
  const listeners = new Map<string, Listener>()
  return {
    listeners,
    handle(channel, listener) {
      listeners.set(channel, listener)
    },
  }
}

function eventFrom(url: string): IpcMainInvokeEvent {
  return { senderFrame: { url } } as unknown as IpcMainInvokeEvent
}

const TRUSTED = 'app://trusted/index.html'
const isTrusted = (event: IpcMainInvokeEvent) => event.senderFrame?.url === TRUSTED

function call(
  ipc: ReturnType<typeof createFakeIpc>,
  channel: string,
  url: string,
  args: unknown[],
) {
  const listener = ipc.listeners.get(channel)
  if (!listener) throw new Error(`no listener for ${channel}`)
  return Promise.resolve(listener(eventFrom(url), ...args))
}

describe('registerIpcHandlers', () => {
  it('registers exactly one listener per contract channel', () => {
    const ipc = createFakeIpc()
    registerIpcHandlers(ipc, createHandlers(), isTrusted)
    expect([...ipc.listeners.keys()].sort()).toEqual(['app:get-info', 'dialog:select-folder'])
  })

  it('forwards calls from trusted senders to the handler', async () => {
    const ipc = createFakeIpc()
    registerIpcHandlers(ipc, createHandlers(), isTrusted)
    await expect(call(ipc, 'app:get-info', TRUSTED, [])).resolves.toEqual(appInfo)
  })

  it('rejects calls from untrusted senders without parsing or running the handler', async () => {
    const ipc = createFakeIpc()
    const parseArgs = vi.fn(noArgs)
    const handle = vi.fn(() => appInfo)
    registerIpcHandlers(ipc, createHandlers({ 'app:get-info': { parseArgs, handle } }), isTrusted)

    await expect(call(ipc, 'app:get-info', 'https://evil.example/', [])).rejects.toThrow(
      UntrustedSenderError,
    )
    expect(parseArgs).not.toHaveBeenCalled()
    expect(handle).not.toHaveBeenCalled()
  })

  it('rejects malformed arguments without running the handler', async () => {
    const ipc = createFakeIpc()
    const handle = vi.fn(() => appInfo)
    registerIpcHandlers(
      ipc,
      createHandlers({ 'app:get-info': { parseArgs: noArgs, handle } }),
      isTrusted,
    )

    await expect(call(ipc, 'app:get-info', TRUSTED, ['unexpected'])).rejects.toThrow(
      InvalidIpcArgumentsError,
    )
    expect(handle).not.toHaveBeenCalled()
  })

  it('waits for an asynchronous parseArgs and stops when it rejects', async () => {
    const ipc = createFakeIpc()
    const handle = vi.fn(() => appInfo)
    const parseArgs = vi.fn(async (): Promise<[]> =>
      Promise.reject(new InvalidIpcArgumentsError('not today')),
    )
    registerIpcHandlers(ipc, createHandlers({ 'app:get-info': { parseArgs, handle } }), isTrusted)

    await expect(call(ipc, 'app:get-info', TRUSTED, [])).rejects.toThrow(
      'Invalid IPC arguments: not today',
    )
    expect(parseArgs).toHaveBeenCalledWith([])
    expect(handle).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 5: Rewrite the app-handler tests**

`src/main/ipc/app-handlers.test.ts` (full file):

```ts
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { type AppHandlerDeps, createAppHandlers } from './app-handlers'
import { InvalidIpcArgumentsError } from './parse-args'

const event = {} as IpcMainInvokeEvent
const fakeWindow = {} as BrowserWindow

function setup(overrides: Partial<AppHandlerDeps> = {}) {
  const showOpenDialog = vi.fn<AppHandlerDeps['dialog']['showOpenDialog']>()
  const deps: AppHandlerDeps = {
    app: { getName: () => 'StorageIQ', getVersion: () => '0.1.0' },
    dialog: { showOpenDialog },
    getMainWindow: () => fakeWindow,
    runtime: { platform: 'win32', arch: 'x64', electronVersion: '38.0.0' },
    ...overrides,
  }
  return { handlers: createAppHandlers(deps), showOpenDialog }
}

describe('app:get-info', () => {
  it('reports name, version and runtime details', async () => {
    const { handlers } = setup()
    await expect(Promise.resolve(handlers['app:get-info'].handle(event))).resolves.toEqual({
      name: 'StorageIQ',
      version: '0.1.0',
      platform: 'win32',
      arch: 'x64',
      electronVersion: '38.0.0',
    })
  })
})

describe('dialog:select-folder', () => {
  it('returns the folder the user picked', async () => {
    const { handlers, showOpenDialog } = setup()
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\Users\\Ana\\Downloads'] })

    await expect(Promise.resolve(handlers['dialog:select-folder'].handle(event))).resolves.toEqual({
      canceled: false,
      path: 'C:\\Users\\Ana\\Downloads',
    })
    expect(showOpenDialog).toHaveBeenCalledWith(
      fakeWindow,
      expect.objectContaining({ properties: expect.arrayContaining(['openDirectory']) }),
    )
  })

  it('reports a cancel when the user dismisses the dialog', async () => {
    const { handlers, showOpenDialog } = setup()
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await expect(Promise.resolve(handlers['dialog:select-folder'].handle(event))).resolves.toEqual({
      canceled: true,
    })
  })

  it('reports a cancel without opening a dialog when no window exists', async () => {
    const { handlers, showOpenDialog } = setup({ getMainWindow: () => null })
    await expect(Promise.resolve(handlers['dialog:select-folder'].handle(event))).resolves.toEqual({
      canceled: true,
    })
    expect(showOpenDialog).not.toHaveBeenCalled()
  })
})

describe('argument validation', () => {
  it('both channels reject any argument', () => {
    const { handlers } = setup()
    expect(() => handlers['app:get-info'].parseArgs(['x'])).toThrow(InvalidIpcArgumentsError)
    expect(() => handlers['dialog:select-folder'].parseArgs([{}])).toThrow(InvalidIpcArgumentsError)
  })
})
```

- [ ] **Step 6: Write the failing `sendEvent` tests**

`src/main/ipc/send-event.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { ScanFailed } from '@shared/scan-types'
import { createEventSender, type EventWindow } from './send-event'

const failed: ScanFailed = { scanId: 'scan-1', message: 'The scanner process stopped.' }

function fakeWindow(state: { windowGone?: boolean; contentsGone?: boolean } = {}) {
  const send = vi.fn()
  const window: EventWindow = {
    isDestroyed: () => state.windowGone === true,
    webContents: { isDestroyed: () => state.contentsGone === true, send },
  }
  return { window, send }
}

describe('createEventSender', () => {
  it('sends the event to the main window’s webContents', () => {
    const { window, send } = fakeWindow()
    createEventSender(() => window)('scan:failed', failed)
    expect(send).toHaveBeenCalledWith('scan:failed', failed)
  })

  it('does nothing when there is no main window', () => {
    expect(() => createEventSender(() => null)('scan:failed', failed)).not.toThrow()
  })

  it('skips a destroyed window', () => {
    const { window, send } = fakeWindow({ windowGone: true })
    createEventSender(() => window)('scan:failed', failed)
    expect(send).not.toHaveBeenCalled()
  })

  it('skips a destroyed webContents', () => {
    const { window, send } = fakeWindow({ contentsGone: true })
    createEventSender(() => window)('scan:failed', failed)
    expect(send).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 7: Write the failing preload `subscribe` tests**

`src/preload/subscribe.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { ScanFailed } from '@shared/scan-types'
import { type IpcEventSource, subscribe } from './subscribe'

type RawListener = (event: unknown, ...args: unknown[]) => void

function createFakeSource() {
  const listeners = new Map<string, Set<RawListener>>()
  const source: IpcEventSource = {
    on(channel, listener) {
      const set = listeners.get(channel) ?? new Set<RawListener>()
      set.add(listener)
      listeners.set(channel, set)
    },
    removeListener(channel, listener) {
      listeners.get(channel)?.delete(listener)
    },
  }
  const emit = (channel: string, ...args: unknown[]) => {
    for (const listener of listeners.get(channel) ?? []) listener({ sender: 'secret' }, ...args)
  }
  const count = (channel: string) => listeners.get(channel)?.size ?? 0
  return { source, emit, count }
}

const failed: ScanFailed = { scanId: 'scan-1', message: 'boom' }

describe('subscribe', () => {
  it('passes only the payload to the callback, never the IpcRendererEvent', () => {
    const { source, emit } = createFakeSource()
    const callback = vi.fn()
    subscribe(source, 'scan:failed', callback)

    emit('scan:failed', failed)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0]).toEqual([failed])
  })

  it('returns an unsubscribe function that removes exactly that listener', () => {
    const { source, emit, count } = createFakeSource()
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribeFirst = subscribe(source, 'scan:failed', first)
    subscribe(source, 'scan:failed', second)

    unsubscribeFirst()
    emit('scan:failed', failed)

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith(failed)
    expect(count('scan:failed')).toBe(1)
  })
})
```

- [ ] **Step 8: Run the tests and confirm they fail**

Run (PowerShell): `npx vitest run src/main/ipc src/preload`
Expected: FAIL. `./parse-args`, `./send-event` and `./subscribe` cannot be resolved, and `register.test.ts` / `app-handlers.test.ts` fail on `.handle` / `parseArgs`.

- [ ] **Step 9: Implement `parse-args.ts`**

`src/main/ipc/parse-args.ts`:

```ts
/** Thrown by `parseArgs` when the renderer sent malformed arguments; the handler never runs. */
export class InvalidIpcArgumentsError extends Error {
  constructor(reason: string) {
    super(`Invalid IPC arguments: ${reason}`)
    this.name = 'InvalidIpcArgumentsError'
  }
}

/** `parseArgs` for channels that take no arguments. */
export function noArgs(args: readonly unknown[]): [] {
  if (args.length !== 0) {
    throw new InvalidIpcArgumentsError(`expected no arguments, got ${args.length}`)
  }
  return []
}

/** `parseArgs` for channels that take exactly one string. */
export function oneString(args: readonly unknown[]): [string] {
  if (args.length !== 1) {
    throw new InvalidIpcArgumentsError(`expected 1 argument, got ${args.length}`)
  }
  const [value] = args
  if (typeof value !== 'string') {
    throw new InvalidIpcArgumentsError(`expected a string, got ${typeof value}`)
  }
  return [value]
}
```

- [ ] **Step 10: Implement `register.ts`**

`src/main/ipc/register.ts` (full file):

```ts
import type { IpcMainInvokeEvent } from 'electron'
import type { IpcArgs, IpcChannel, IpcResult } from '@shared/ipc-contract'

/** One channel: validate the untrusted renderer arguments, then handle the call. */
export interface IpcChannelHandler<C extends IpcChannel> {
  /**
   * Turns raw renderer arguments into the channel's typed arguments. Throws (or rejects with)
   * `InvalidIpcArgumentsError` when they are malformed; `handle` then never runs.
   */
  parseArgs(args: readonly unknown[]): IpcArgs<C> | Promise<IpcArgs<C>>
  handle(event: IpcMainInvokeEvent, ...args: IpcArgs<C>): IpcResult<C> | Promise<IpcResult<C>>
}

/** Exactly one handler for every channel in the contract. */
export type IpcHandlerMap = { [C in IpcChannel]: IpcChannelHandler<C> }

/** The part of `ipcMain` this module needs; lets tests pass a fake. */
export interface IpcRegistrar {
  handle(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  ): void
}

export class UntrustedSenderError extends Error {
  constructor(channel: string, url: string) {
    super(`Blocked IPC call to "${channel}" from untrusted sender ${url || '(unknown)'}`)
    this.name = 'UntrustedSenderError'
  }
}

interface UntypedChannelHandler {
  parseArgs(args: readonly unknown[]): unknown[] | Promise<unknown[]>
  handle(event: IpcMainInvokeEvent, ...args: unknown[]): unknown
}

export function registerIpcHandlers(
  ipc: IpcRegistrar,
  handlers: IpcHandlerMap,
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
): void {
  for (const channel of Object.keys(handlers) as IpcChannel[]) {
    const handler = handlers[channel] as unknown as UntypedChannelHandler
    ipc.handle(channel, async (event, ...args) => {
      if (!isTrustedSender(event)) {
        throw new UntrustedSenderError(channel, event.senderFrame?.url ?? '')
      }
      const parsed = await handler.parseArgs(args)
      return handler.handle(event, ...parsed)
    })
  }
}
```

- [ ] **Step 11: Implement `app-handlers.ts`**

`src/main/ipc/app-handlers.ts` (full file):

```ts
import type { BrowserWindow, OpenDialogOptions, OpenDialogReturnValue } from 'electron'
import { noArgs } from './parse-args'
import type { IpcHandlerMap } from './register'

export interface AppHandlerDeps {
  app: { getName(): string; getVersion(): string }
  dialog: {
    showOpenDialog(
      window: BrowserWindow,
      options: OpenDialogOptions,
    ): Promise<OpenDialogReturnValue>
  }
  getMainWindow(): BrowserWindow | null
  runtime: { platform: string; arch: string; electronVersion: string }
}

export type AppHandlers = Pick<IpcHandlerMap, 'app:get-info' | 'dialog:select-folder'>

export function createAppHandlers(deps: AppHandlerDeps): AppHandlers {
  return {
    'app:get-info': {
      parseArgs: noArgs,
      handle: () => ({
        name: deps.app.getName(),
        version: deps.app.getVersion(),
        ...deps.runtime,
      }),
    },

    'dialog:select-folder': {
      parseArgs: noArgs,
      handle: async () => {
        const window = deps.getMainWindow()
        if (!window) {
          return { canceled: true }
        }
        const result = await deps.dialog.showOpenDialog(window, {
          title: 'Choose a folder',
          properties: ['openDirectory', 'dontAddToRecent'],
        })
        const [folder] = result.filePaths
        if (result.canceled || folder === undefined) {
          return { canceled: true }
        }
        return { canceled: false, path: folder }
      },
    },
  }
}
```

- [ ] **Step 12: Implement `send-event.ts`**

`src/main/ipc/send-event.ts`:

```ts
import type { IpcEventChannel, IpcEventPayload } from '@shared/ipc-contract'

/** The part of a `BrowserWindow` that `sendEvent` needs; tests pass a fake. */
export interface EventWindow {
  isDestroyed(): boolean
  webContents: { isDestroyed(): boolean; send(channel: string, payload: unknown): void }
}

export type SendEvent = <E extends IpcEventChannel>(channel: E, payload: IpcEventPayload<E>) => void

/**
 * Main → renderer events go to the main window only. When the window (or its webContents) is
 * gone, the event is dropped instead of throwing.
 */
export function createEventSender(getMainWindow: () => EventWindow | null): SendEvent {
  return (channel, payload) => {
    const window = getMainWindow()
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
    window.webContents.send(channel, payload)
  }
}
```

- [ ] **Step 13: Implement the preload `subscribe` helper and wire the bridge**

`src/preload/subscribe.ts`:

```ts
import type { IpcEventChannel, IpcEventPayload, Unsubscribe } from '@shared/ipc-contract'

/** The part of `ipcRenderer` that `subscribe` needs; tests pass a fake. */
export interface IpcEventSource {
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown
}

/**
 * Subscribes to one main → renderer event. The renderer's callback receives only the payload,
 * never the `IpcRendererEvent` (which would leak `sender` and `ports`).
 */
export function subscribe<E extends IpcEventChannel>(
  source: IpcEventSource,
  channel: E,
  listener: (payload: IpcEventPayload<E>) => void,
): Unsubscribe {
  const forward = (_event: unknown, payload: unknown) => {
    listener(payload as IpcEventPayload<E>)
  }
  source.on(channel, forward)
  return () => {
    source.removeListener(channel, forward)
  }
}
```

`src/preload/index.ts` (full file):

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcArgs, IpcChannel, IpcResult, StorageIQApi } from '@shared/ipc-contract'
import { subscribe } from './subscribe'

function invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<C>>
}

const api: StorageIQApi = {
  getAppInfo: () => invoke('app:get-info'),
  selectFolder: () => invoke('dialog:select-folder'),
  onScanProgress: (listener) => subscribe(ipcRenderer, 'scan:progress', listener),
  onScanDone: (listener) => subscribe(ipcRenderer, 'scan:done', listener),
  onScanFailed: (listener) => subscribe(ipcRenderer, 'scan:failed', listener),
}

contextBridge.exposeInMainWorld('storageiq', api)
```

- [ ] **Step 14: Build the handler map with `satisfies` in `index.ts`**

In `src/main/index.ts`, change the import of `registerIpcHandlers` to:

```ts
import { type IpcHandlerMap, registerIpcHandlers } from './ipc/register'
```

and replace the `registerIpcHandlers(ipcMain, createAppHandlers({ … }), (event) => …)` call with:

```ts
const handlers = {
  ...createAppHandlers({
    app,
    dialog,
    getMainWindow: () => mainWindow,
    runtime: {
      platform: process.platform,
      arch: process.arch,
      electronVersion: process.versions.electron,
    },
  }),
} satisfies IpcHandlerMap

registerIpcHandlers(ipcMain, handlers, (event) =>
  isTrustedIpcSender(event, {
    mainWebContents: mainWindow?.webContents,
    isTrustedUrl,
  }),
)
```

(Task 4 replaces the whole file; this step only keeps the build green.)

- [ ] **Step 15: Extend the renderer's fake API with event channels**

`src/renderer/src/test/fake-api.ts` (full file):

```ts
import { vi } from 'vitest'
import type { AppInfo, SelectFolderResult, StorageIQApi } from '@shared/ipc-contract'
import type { ScanDone, ScanFailed, ScanProgress } from '@shared/scan-types'

export const TEST_APP_INFO: AppInfo = {
  name: 'StorageIQ',
  version: '0.1.0',
  platform: 'win32',
  arch: 'x64',
  electronVersion: '38.0.0',
}

/** A fake bridge plus `emit…` helpers that play the main process sending events. */
export interface FakeApi extends StorageIQApi {
  emitScanProgress(progress: ScanProgress): void
  emitScanDone(done: ScanDone): void
  emitScanFailed(failed: ScanFailed): void
  /** Subscribed event listeners across all channels. */
  listenerCount(): number
}

function createChannel<T>() {
  const listeners = new Set<(payload: T) => void>()
  return {
    subscribe: (listener: (payload: T) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emit: (payload: T) => {
      for (const listener of [...listeners]) listener(payload)
    },
    size: () => listeners.size,
  }
}

export function createFakeApi(overrides: Partial<StorageIQApi> = {}): FakeApi {
  const progress = createChannel<ScanProgress>()
  const done = createChannel<ScanDone>()
  const failed = createChannel<ScanFailed>()
  return {
    getAppInfo: vi.fn(async () => TEST_APP_INFO),
    selectFolder: vi.fn(async (): Promise<SelectFolderResult> => ({ canceled: true })),
    onScanProgress: vi.fn(progress.subscribe),
    onScanDone: vi.fn(done.subscribe),
    onScanFailed: vi.fn(failed.subscribe),
    ...overrides,
    emitScanProgress: progress.emit,
    emitScanDone: done.emit,
    emitScanFailed: failed.emit,
    listenerCount: () => progress.size() + done.size() + failed.size(),
  }
}
```

- [ ] **Step 16: Update the E2E bridge-key expectation**

In `e2e/app.spec.ts`, change the expected keys in `launches a locked-down renderer with the StorageIQ bridge` to:

```ts
expect(keys).toEqual(['getAppInfo', 'onScanDone', 'onScanFailed', 'onScanProgress', 'selectFolder'])
```

- [ ] **Step 17: Run the tests and quality gates**

```powershell
npx vitest run src/main/ipc src/preload
npm run format
npm run format:check
npm run lint
npm run typecheck
npm test
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm run test:e2e
```

Expected: `parse-args.test.ts` 7, `register.test.ts` 5, `app-handlers.test.ts` 5, `send-event.test.ts` 4, `subscribe.test.ts` 2 tests pass; all other unit tests still pass; 5 E2E tests pass; every command exits 0.

- [ ] **Step 18: Commit**

```powershell
git add src/shared/scan-types.ts src/shared/ipc-contract.ts src/main/ipc/parse-args.ts src/main/ipc/parse-args.test.ts src/main/ipc/register.ts src/main/ipc/register.test.ts src/main/ipc/app-handlers.ts src/main/ipc/app-handlers.test.ts src/main/ipc/send-event.ts src/main/ipc/send-event.test.ts src/preload/subscribe.ts src/preload/subscribe.test.ts src/preload/index.ts src/main/index.ts src/renderer/src/test/fake-api.ts e2e/app.spec.ts
git commit -m "feat(ipc): per-channel parseArgs, Pick handler factories, typed events and sendEvent" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Scanner core — walk, tree, top folders (pure Node, injected fs)

**Implementer tier:** cheap

Verified behaviour this task relies on (checked locally on Windows with Node 22 and in `@types/node@24`): `fs.symlinkSync(target, link, 'junction')` works without admin rights; `fs.lstat` on a junction reports `isSymbolicLink() === true` and `isDirectory() === false`; `fs.promises.opendir` returns a `Dir` that is `AsyncIterable<Dirent>` and closes itself when a `for await` loop ends or breaks.

Decisions recorded here (spec ambiguities):

- A symlink or junction "is counted, not entered": it counts as **one file of 0 bytes** in its parent. Its `lstat().size` is ignored, because on Windows libuv reports the link target's path length there, which is not disk usage.
- `folders` counts folders **below** the scanned root; the root itself is not counted.
- The walk takes directories from the end of its queue (depth-first order), which keeps the queue short on deep trees.

**Files:**

- Create: `src/worker/scanner/walk.ts`, `src/worker/scanner/tree.ts`, `src/worker/scanner/top-folders.ts`, `src/worker/scanner/test/fake-walk-fs.ts`
- Modify: `tsconfig.node.json`, `eslint.config.mjs`
- Test: `src/worker/scanner/walk.test.ts`, `src/worker/scanner/tree.test.ts`, `src/worker/scanner/top-folders.test.ts`

**Interfaces:**

- Consumes: `FolderSummary`, `ScanError`, `ScanErrorReason` (Task 2).
- Produces:
  - `walk.ts`: `WalkDirent { name }`, `WalkStats { size; isDirectory(); isSymbolicLink() }`, `WalkFs { opendir(dirPath): Promise<AsyncIterable<WalkDirent>>; lstat(entryPath): Promise<WalkStats> }`, `nodeWalkFs: WalkFs`, `WalkSink<D> { folder(parent: D, name): D; file(parent: D, bytes): void; error(path, code): void; visiting(path): void }`, `WalkOptions { fs; signal: AbortSignal; concurrency? }`, `MAX_DIRECTORIES_IN_FLIGHT = 16`, `errorCode(error: unknown): string`, `walk<D>(rootPath, rootHandle: D, sink: WalkSink<D>, options): Promise<void>`
  - `tree.ts`: `MAX_SCAN_ERRORS = 1000`, `FolderNode { name; parent; children; bytes; files; folders }`, `ScanTotals { files; folders; bytes }`, `ScanTree extends WalkSink<FolderNode> { rootPath; root; currentPath; errorCount; errors; totals(); pathOf(node) }`, `scanErrorReason(code): ScanErrorReason`, `createScanTree(rootPath): ScanTree`
  - `top-folders.ts`: `TOP_FOLDER_LIMIT = 10`, `EVERYTHING_ELSE_LABEL = 'Everything else'`, `topFolders(tree: ScanTree, limit?): FolderSummary[]`
  - `test/fake-walk-fs.ts`: `FakeNode`, `dir()`, `file()`, `link()`, `FakeWalkFsOptions`, `FakeWalkFs { opendirCalls; maxListingAtOnce }`, `codeError(code)`, `createFakeWalkFs(rootPath, root, options?)`

- [ ] **Step 1: Include `src/worker` in typechecking and linting**

In `tsconfig.node.json`, add `"src/worker/**/*"` to `include`, directly after `"src/shared/**/*"`.

In `eslint.config.mjs`, change the node-globals block's `files` to:

```js
    files: [
      'src/main/**/*.ts',
      'src/preload/**/*.ts',
      'src/worker/**/*.ts',
      'e2e/**/*.ts',
      '*.config.{ts,mts,mjs}',
    ],
```

- [ ] **Step 2: Write the fake file system for tests**

`src/worker/scanner/test/fake-walk-fs.ts`:

```ts
import path from 'node:path'
import type { WalkDirent, WalkFs, WalkStats } from '../walk'

export type FakeNode =
  | { type: 'dir'; children: Record<string, FakeNode> }
  | { type: 'file'; size: number }
  | { type: 'link' }

export const dir = (children: Record<string, FakeNode> = {}): FakeNode => ({
  type: 'dir',
  children,
})
export const file = (size: number): FakeNode => ({ type: 'file', size })
/** A symlink or junction. Its `lstat` size is deliberately non-zero: the walk must count 0 bytes. */
export const link = (): FakeNode => ({ type: 'link' })

export interface FakeWalkFsOptions {
  /** `opendir` rejects with this error code for these paths. */
  opendirErrors?: Record<string, string>
  /** Listing these paths yields one entry, then fails with this error code. */
  iterationErrors?: Record<string, string>
  /** `lstat` rejects with this error code for these paths. */
  lstatErrors?: Record<string, string>
  /** Awaited at the start of every `opendir` call (lets a test slow down or abort the walk). */
  beforeOpendir?(dirPath: string): Promise<void>
}

export interface FakeWalkFs extends WalkFs {
  /** Every path passed to `opendir`, in call order. */
  readonly opendirCalls: string[]
  /** The most directories that were being listed at the same moment. */
  readonly maxListingAtOnce: number
}

export function codeError(code: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(code)
  error.code = code
  return error
}

export function createFakeWalkFs(
  rootPath: string,
  root: FakeNode,
  options: FakeWalkFsOptions = {},
): FakeWalkFs {
  const nodes = new Map<string, FakeNode>()
  const index = (nodePath: string, node: FakeNode): void => {
    nodes.set(nodePath, node)
    if (node.type !== 'dir') return
    for (const [name, child] of Object.entries(node.children)) {
      index(path.join(nodePath, name), child)
    }
  }
  index(rootPath, root)

  const opendirCalls: string[] = []
  let listing = 0
  let maxListing = 0

  return {
    opendirCalls,
    get maxListingAtOnce() {
      return maxListing
    },

    async opendir(dirPath) {
      opendirCalls.push(dirPath)
      listing += 1
      maxListing = Math.max(maxListing, listing)
      try {
        await options.beforeOpendir?.(dirPath)
        const code = options.opendirErrors?.[dirPath]
        if (code !== undefined) throw codeError(code)
        const node = nodes.get(dirPath)
        if (node === undefined) throw codeError('ENOENT')
        if (node.type !== 'dir') throw codeError('ENOTDIR')
        const names = Object.keys(node.children)
        const failAfterFirst = options.iterationErrors?.[dirPath]
        return (async function* (): AsyncGenerator<WalkDirent> {
          try {
            for (const name of names) {
              await Promise.resolve()
              yield { name }
              if (failAfterFirst !== undefined) throw codeError(failAfterFirst)
            }
          } finally {
            listing -= 1
          }
        })()
      } catch (error) {
        listing -= 1
        throw error
      }
    },

    async lstat(entryPath): Promise<WalkStats> {
      const code = options.lstatErrors?.[entryPath]
      if (code !== undefined) throw codeError(code)
      const node = nodes.get(entryPath)
      if (node === undefined) throw codeError('ENOENT')
      return {
        size: node.type === 'file' ? node.size : node.type === 'link' ? 42 : 0,
        isDirectory: () => node.type === 'dir',
        isSymbolicLink: () => node.type === 'link',
      }
    },
  }
}
```

- [ ] **Step 3: Write the failing walk tests**

`src/worker/scanner/walk.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFakeWalkFs, dir, file, link } from './test/fake-walk-fs'
import { errorCode, MAX_DIRECTORIES_IN_FLIGHT, nodeWalkFs, walk, type WalkSink } from './walk'

const ROOT = 'C:\\Data'

/** A sink whose folder handle is simply the folder's path. */
function recordingSink() {
  const folders: string[] = []
  const files: Array<{ parent: string; bytes: number }> = []
  const errors: Array<{ path: string; code: string }> = []
  const visited: string[] = []
  const sink: WalkSink<string> = {
    folder: (parent, name) => {
      const folderPath = path.join(parent, name)
      folders.push(folderPath)
      return folderPath
    },
    file: (parent, bytes) => {
      files.push({ parent, bytes })
    },
    error: (errorPath, code) => {
      errors.push({ path: errorPath, code })
    },
    visiting: (dirPath) => {
      visited.push(dirPath)
    },
  }
  return { sink, folders, files, errors, visited }
}

const never = () => new AbortController().signal
const totalBytes = (files: Array<{ bytes: number }>) => files.reduce((sum, f) => sum + f.bytes, 0)

function siblings(count: number) {
  return Object.fromEntries(
    Array.from({ length: count }, (_, i) => [`d${i}`, dir({ 'f.bin': file(1) })]),
  )
}

describe('walk with an injected file system', () => {
  it('reports every folder and file with its size', async () => {
    const fs = createFakeWalkFs(
      ROOT,
      dir({
        Photos: dir({ '2024': dir({ 'a.jpg': file(300) }), 'b.jpg': file(200) }),
        'notes.txt': file(5),
      }),
    )
    const { sink, folders, files, errors } = recordingSink()

    await walk(ROOT, ROOT, sink, { fs, signal: never() })

    expect([...folders].sort()).toEqual([
      path.join(ROOT, 'Photos'),
      path.join(ROOT, 'Photos', '2024'),
    ])
    expect(files).toHaveLength(3)
    expect(totalBytes(files)).toBe(505)
    expect(errors).toEqual([])
  })

  it('counts links as 0-byte entries and never lists them', async () => {
    const fs = createFakeWalkFs(ROOT, dir({ Shortcut: link(), Real: dir({ 'x.bin': file(10) }) }))
    const { sink, folders, files } = recordingSink()

    await walk(ROOT, ROOT, sink, { fs, signal: never() })

    expect(folders).toEqual([path.join(ROOT, 'Real')])
    expect(files).toContainEqual({ parent: ROOT, bytes: 0 })
    expect(totalBytes(files)).toBe(10)
    expect(fs.opendirCalls).not.toContain(path.join(ROOT, 'Shortcut'))
  })

  it('records unreadable folders with their error code and keeps going', async () => {
    const locked = path.join(ROOT, 'Locked')
    const deep = path.join(ROOT, 'Deep')
    const fs = createFakeWalkFs(
      ROOT,
      dir({ Locked: dir({ 's.bin': file(1) }), Deep: dir(), Open: dir({ 'o.bin': file(7) }) }),
      { opendirErrors: { [locked]: 'EACCES', [deep]: 'ENAMETOOLONG' } },
    )
    const { sink, files, errors } = recordingSink()

    await walk(ROOT, ROOT, sink, { fs, signal: never() })

    expect(errors).toHaveLength(2)
    expect(errors).toContainEqual({ path: locked, code: 'EACCES' })
    expect(errors).toContainEqual({ path: deep, code: 'ENAMETOOLONG' })
    expect(files).toEqual([{ parent: path.join(ROOT, 'Open'), bytes: 7 }])
  })

  it('records entries that cannot be inspected', async () => {
    const gone = path.join(ROOT, 'gone.txt')
    const fs = createFakeWalkFs(ROOT, dir({ 'gone.txt': file(9), 'kept.txt': file(4) }), {
      lstatErrors: { [gone]: 'ENOENT' },
    })
    const { sink, files, errors } = recordingSink()

    await walk(ROOT, ROOT, sink, { fs, signal: never() })

    expect(errors).toEqual([{ path: gone, code: 'ENOENT' }])
    expect(files).toEqual([{ parent: ROOT, bytes: 4 }])
  })

  it('keeps what was read when a listing fails part-way', async () => {
    const flaky = path.join(ROOT, 'Flaky')
    const fs = createFakeWalkFs(
      ROOT,
      dir({ Flaky: dir({ 'a.bin': file(10), 'b.bin': file(20) }) }),
      {
        iterationErrors: { [flaky]: 'EIO' },
      },
    )
    const { sink, files, errors } = recordingSink()

    await walk(ROOT, ROOT, sink, { fs, signal: never() })

    expect(errors).toEqual([{ path: flaky, code: 'EIO' }])
    expect(files).toEqual([{ parent: flaky, bytes: 10 }])
  })

  it('reports an unreadable root as a single error', async () => {
    const fs = createFakeWalkFs(ROOT, dir({ 'a.bin': file(1) }), {
      opendirErrors: { [ROOT]: 'EPERM' },
    })
    const { sink, folders, files, errors } = recordingSink()

    await walk(ROOT, ROOT, sink, { fs, signal: never() })

    expect(errors).toEqual([{ path: ROOT, code: 'EPERM' }])
    expect(folders).toEqual([])
    expect(files).toEqual([])
  })

  it('lists at most 16 directories at the same time', async () => {
    const fs = createFakeWalkFs(ROOT, dir(siblings(40)), {
      beforeOpendir: () => new Promise((resolve) => setTimeout(resolve, 2)),
    })
    const { sink, files } = recordingSink()

    await walk(ROOT, ROOT, sink, { fs, signal: never() })

    expect(MAX_DIRECTORIES_IN_FLIGHT).toBe(16)
    expect(fs.maxListingAtOnce).toBe(16)
    expect(files).toHaveLength(40)
  })

  it('honours a lower concurrency', async () => {
    const fs = createFakeWalkFs(ROOT, dir(siblings(12)), {
      beforeOpendir: () => new Promise((resolve) => setTimeout(resolve, 2)),
    })
    const { sink } = recordingSink()

    await walk(ROOT, ROOT, sink, { fs, signal: never(), concurrency: 4 })

    expect(fs.maxListingAtOnce).toBe(4)
  })

  it('stops starting new directories as soon as the signal aborts', async () => {
    const controller = new AbortController()
    let childListings = 0
    let startedAfterAbort = 0
    const fs = createFakeWalkFs(ROOT, dir(siblings(30)), {
      beforeOpendir: async (dirPath) => {
        if (controller.signal.aborted) startedAfterAbort += 1
        if (dirPath === ROOT) return
        childListings += 1
        if (childListings === 5) controller.abort()
      },
    })
    const { sink, files, visited } = recordingSink()

    await walk(ROOT, ROOT, sink, { fs, signal: controller.signal })

    expect(startedAfterAbort).toBe(0)
    expect(visited).toHaveLength(6) // the root plus the five folders started before the abort
    expect(files).toEqual([]) // every listing checks the signal before handling an entry
  })

  it('does nothing when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const fs = createFakeWalkFs(ROOT, dir({ 'a.bin': file(1) }))
    const { sink, visited } = recordingSink()

    await walk(ROOT, ROOT, sink, { fs, signal: controller.signal })

    expect(visited).toEqual([])
    expect(fs.opendirCalls).toEqual([])
  })

  it('reads the Node.js error code', () => {
    expect(errorCode(Object.assign(new Error('denied'), { code: 'EPERM' }))).toBe('EPERM')
    expect(errorCode(new Error('no code'))).toBe('UNKNOWN')
    expect(errorCode('not an error')).toBe('UNKNOWN')
  })
})

describe('walk on disk', () => {
  let base: string

  beforeEach(() => {
    base = mkdtempSync(path.join(os.tmpdir(), 'storageiq-walk-'))
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  it('measures a real folder tree and does not follow a junction', async () => {
    const root = path.join(base, 'root')
    const outside = path.join(base, 'outside')
    const docs = path.join(root, 'docs')
    const deep = path.join(docs, 'deep')
    const empty = path.join(root, 'empty')
    mkdirSync(deep, { recursive: true })
    mkdirSync(empty)
    mkdirSync(outside)
    writeFileSync(path.join(root, 'a.bin'), Buffer.alloc(100))
    writeFileSync(path.join(docs, 'b.bin'), Buffer.alloc(250))
    writeFileSync(path.join(docs, 'c.bin'), Buffer.alloc(0))
    writeFileSync(path.join(deep, 'd.bin'), Buffer.alloc(1000))
    writeFileSync(path.join(outside, 'big.bin'), Buffer.alloc(5000))
    symlinkSync(outside, path.join(root, 'junction'), 'junction') // no admin rights needed

    const { sink, folders, files, errors, visited } = recordingSink()
    await walk(root, root, sink, { fs: nodeWalkFs, signal: never() })

    expect(errors).toEqual([])
    expect([...folders].sort()).toEqual([docs, deep, empty].sort())
    expect(files).toHaveLength(5) // a, b, c, d and the junction
    expect(totalBytes(files)).toBe(1350)
    expect(files).toContainEqual({ parent: root, bytes: 0 }) // the junction
    expect([...visited].sort()).toEqual([root, docs, deep, empty].sort())
  })

  it('reports a missing root as not found', async () => {
    const missing = path.join(base, 'missing')
    const { sink, errors } = recordingSink()

    await walk(missing, missing, sink, { fs: nodeWalkFs, signal: never() })

    expect(errors).toEqual([{ path: missing, code: 'ENOENT' }])
  })
})
```

- [ ] **Step 4: Write the failing tree and top-folders tests**

`src/worker/scanner/tree.test.ts`:

```ts
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createScanTree, MAX_SCAN_ERRORS, scanErrorReason } from './tree'

const ROOT = 'C:\\Data'

describe('createScanTree', () => {
  it('starts empty at the root', () => {
    const tree = createScanTree(ROOT)
    expect(tree.totals()).toEqual({ files: 0, folders: 0, bytes: 0 })
    expect(tree.currentPath).toBe(ROOT)
    expect(tree.errors).toEqual([])
    expect(tree.errorCount).toBe(0)
  })

  it('bubbles file sizes and counts up to every ancestor', () => {
    const tree = createScanTree(ROOT)
    const photos = tree.folder(tree.root, 'Photos')
    const year = tree.folder(photos, '2024')
    tree.file(year, 300)
    tree.file(year, 200)
    tree.file(photos, 50)
    tree.file(tree.root, 5)

    expect(year).toMatchObject({ bytes: 500, files: 2, folders: 0 })
    expect(photos).toMatchObject({ bytes: 550, files: 3, folders: 1 })
    expect(tree.totals()).toEqual({ files: 4, folders: 2, bytes: 555 })
    expect(tree.root.children).toHaveLength(1)
    expect(tree.root.children[0]).toBe(photos)
  })

  it('builds full paths from folder names', () => {
    const tree = createScanTree(ROOT)
    const year = tree.folder(tree.folder(tree.root, 'Photos'), '2024')
    expect(tree.pathOf(year)).toBe(path.join(ROOT, 'Photos', '2024'))
    expect(tree.pathOf(tree.root)).toBe(ROOT)
  })

  it('tracks the folder being listed', () => {
    const tree = createScanTree(ROOT)
    tree.visiting(path.join(ROOT, 'Photos'))
    expect(tree.currentPath).toBe(path.join(ROOT, 'Photos'))
  })

  it('keeps the first 1000 errors and counts every one', () => {
    const tree = createScanTree(ROOT)
    for (let i = 0; i < MAX_SCAN_ERRORS + 5; i += 1) {
      tree.error(path.join(ROOT, `locked-${i}`), 'EPERM')
    }
    expect(MAX_SCAN_ERRORS).toBe(1000)
    expect(tree.errors).toHaveLength(1000)
    expect(tree.errorCount).toBe(1005)
    expect(tree.errors[0]).toEqual({
      path: path.join(ROOT, 'locked-0'),
      reason: 'access-denied',
      code: 'EPERM',
    })
  })
})

describe('scanErrorReason', () => {
  it.each([
    ['EACCES', 'access-denied'],
    ['EPERM', 'access-denied'],
    ['ENAMETOOLONG', 'path-too-long'],
    ['ENOENT', 'not-found'],
    ['EBUSY', 'other'],
    ['UNKNOWN', 'other'],
  ])('maps %s to %s', (code, reason) => {
    expect(scanErrorReason(code)).toBe(reason)
  })
})
```

`src/worker/scanner/top-folders.test.ts`:

```ts
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EVERYTHING_ELSE_LABEL, TOP_FOLDER_LIMIT, topFolders } from './top-folders'
import { createScanTree } from './tree'

const ROOT = 'C:\\Data'

/** One child folder per entry, each holding one file of the given size. */
function treeWith(children: Array<[string, number]>, rootFileBytes?: number) {
  const tree = createScanTree(ROOT)
  for (const [name, bytes] of children) tree.file(tree.folder(tree.root, name), bytes)
  if (rootFileBytes !== undefined) tree.file(tree.root, rootFileBytes)
  return tree
}

describe('topFolders', () => {
  it('lists the direct children of the root, largest first, with full paths', () => {
    const rows = topFolders(
      treeWith([
        ['Music', 100],
        ['Videos', 900],
        ['Photos', 500],
      ]),
    )
    expect(rows).toEqual([
      {
        kind: 'folder',
        name: 'Videos',
        path: path.join(ROOT, 'Videos'),
        bytes: 900,
        files: 1,
        folders: 0,
      },
      {
        kind: 'folder',
        name: 'Photos',
        path: path.join(ROOT, 'Photos'),
        bytes: 500,
        files: 1,
        folders: 0,
      },
      {
        kind: 'folder',
        name: 'Music',
        path: path.join(ROOT, 'Music'),
        bytes: 100,
        files: 1,
        folders: 0,
      },
    ])
  })

  it('keeps the top 10 and sums everything else into one row', () => {
    const children = Array.from({ length: 12 }, (_, i): [string, number] => [
      `c${String(i + 1).padStart(2, '0')}`,
      (i + 1) * 100,
    ])
    const tree = treeWith(children, 7)
    const first = tree.root.children.find((node) => node.name === 'c01')
    if (!first) throw new Error('c01 missing')
    tree.folder(first, 'nested')

    const rows = topFolders(tree)

    expect(TOP_FOLDER_LIMIT).toBe(10)
    expect(rows).toHaveLength(11)
    expect(rows.slice(0, 10).map((row) => row.name)).toEqual([
      'c12',
      'c11',
      'c10',
      'c09',
      'c08',
      'c07',
      'c06',
      'c05',
      'c04',
      'c03',
    ])
    expect(rows[10]).toEqual({
      kind: 'everything-else',
      name: EVERYTHING_ELSE_LABEL,
      path: ROOT,
      bytes: 307, // c01 (100) + c02 (200) + the root file (7)
      files: 3,
      folders: 3, // c01, c01\nested and c02
    })
  })

  it('adds an "Everything else" row for files directly in the root', () => {
    const rows = topFolders(treeWith([['Photos', 500]], 20))
    expect(rows.map((row) => [row.kind, row.bytes])).toEqual([
      ['folder', 500],
      ['everything-else', 20],
    ])
  })

  it('leaves the row out when nothing is left over', () => {
    const rows = topFolders(
      treeWith([
        ['Photos', 500],
        ['Music', 100],
      ]),
    )
    expect(rows.every((row) => row.kind === 'folder')).toBe(true)
  })

  it('breaks size ties by name', () => {
    const rows = topFolders(
      treeWith([
        ['b', 100],
        ['c', 100],
        ['a', 100],
      ]),
    )
    expect(rows.map((row) => row.name)).toEqual(['a', 'b', 'c'])
  })
})
```

- [ ] **Step 5: Run the tests and confirm they fail**

Run (PowerShell): `npx vitest run src/worker`
Expected: FAIL. `./walk`, `./tree` and `./top-folders` cannot be resolved.

- [ ] **Step 6: Implement `walk.ts`**

`src/worker/scanner/walk.ts`:

```ts
import { promises as fsp } from 'node:fs'
import path from 'node:path'

/** One directory entry; only the name is used (the type comes from `lstat`). */
export interface WalkDirent {
  name: string
}

export interface WalkStats {
  size: number
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

/**
 * The only file-system calls the scanner makes. There is deliberately no way to open or read a
 * file, so the scan can never download a cloud placeholder or touch file contents.
 */
export interface WalkFs {
  opendir(dirPath: string): Promise<AsyncIterable<WalkDirent>>
  lstat(entryPath: string): Promise<WalkStats>
}

export const nodeWalkFs: WalkFs = {
  opendir: (dirPath) => fsp.opendir(dirPath, { bufferSize: 128 }),
  lstat: (entryPath) => fsp.lstat(entryPath),
}

/** Receives everything the walk finds. `D` is the sink's own handle for a folder. */
export interface WalkSink<D> {
  /** A real folder (not a link) was found inside `parent`; returns its handle. */
  folder(parent: D, name: string): D
  /** A file, link or other non-folder entry inside `parent`. Links count with 0 bytes. */
  file(parent: D, bytes: number): void
  /** `path` could not be listed or inspected; the walk continues. */
  error(path: string, code: string): void
  /** The walk started listing `path`. */
  visiting(path: string): void
}

export interface WalkOptions {
  fs: WalkFs
  signal: AbortSignal
  /** Directories listed at the same time; capped at `MAX_DIRECTORIES_IN_FLIGHT`. */
  concurrency?: number
}

export const MAX_DIRECTORIES_IN_FLIGHT = 16
/** Entries of one directory inspected with `lstat` at the same time. */
const LSTAT_BATCH_SIZE = 64

export function errorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code
  }
  return 'UNKNOWN'
}

/**
 * Walks `rootPath` with at most `concurrency` directories in flight. It never follows symlinks
 * or junctions, never opens file contents, and stops starting work as soon as `signal` aborts
 * (a listing in progress stops at its next entry). Resolves when all started work has settled;
 * rejects only if the sink throws.
 */
export function walk<D>(
  rootPath: string,
  rootHandle: D,
  sink: WalkSink<D>,
  options: WalkOptions,
): Promise<void> {
  const { fs, signal } = options
  const limit = Math.max(
    1,
    Math.min(options.concurrency ?? MAX_DIRECTORIES_IN_FLIGHT, MAX_DIRECTORIES_IN_FLIGHT),
  )
  const queue: Array<{ path: string; handle: D }> = [{ path: rootPath, handle: rootHandle }]
  let inFlight = 0

  return new Promise<void>((resolve, reject) => {
    let failed = false

    const inspect = async (dirPath: string, handle: D, names: string[]): Promise<void> => {
      const results = await Promise.all(
        names.map(async (name) => {
          const entryPath = path.join(dirPath, name)
          try {
            return { name, entryPath, stats: await fs.lstat(entryPath) }
          } catch (error) {
            sink.error(entryPath, errorCode(error))
            return null
          }
        }),
      )
      for (const result of results) {
        if (result === null) continue
        const { stats } = result
        if (stats.isSymbolicLink()) {
          sink.file(handle, 0) // symlinks and junctions are counted, never entered
        } else if (stats.isDirectory()) {
          queue.push({ path: result.entryPath, handle: sink.folder(handle, result.name) })
        } else {
          sink.file(handle, stats.size)
        }
      }
      pump()
    }

    const listDirectory = async (dirPath: string, handle: D): Promise<void> => {
      sink.visiting(dirPath)
      let entries: AsyncIterable<WalkDirent>
      try {
        entries = await fs.opendir(dirPath)
      } catch (error) {
        sink.error(dirPath, errorCode(error))
        return
      }
      let batch: string[] = []
      try {
        for await (const entry of entries) {
          if (signal.aborted) break
          batch.push(entry.name)
          if (batch.length >= LSTAT_BATCH_SIZE) {
            const names = batch
            batch = []
            await inspect(dirPath, handle, names)
          }
        }
      } catch (error) {
        sink.error(dirPath, errorCode(error))
      }
      if (!signal.aborted && batch.length > 0) await inspect(dirPath, handle, batch)
    }

    const pump = (): void => {
      if (failed) return
      while (!signal.aborted && inFlight < limit) {
        const next = queue.pop()
        if (next === undefined) break
        inFlight += 1
        listDirectory(next.path, next.handle).then(
          () => {
            inFlight -= 1
            pump()
          },
          (error: unknown) => {
            failed = true
            reject(error)
          },
        )
      }
      if (inFlight === 0 && (signal.aborted || queue.length === 0)) resolve()
    }

    pump()
  })
}
```

- [ ] **Step 7: Implement `tree.ts`**

`src/worker/scanner/tree.ts`:

```ts
import path from 'node:path'
import type { ScanError, ScanErrorReason } from '@shared/scan-types'
import type { WalkSink } from './walk'

export const MAX_SCAN_ERRORS = 1000

/** A folder in the scan tree. Folders only: files are summed into their parent. */
export interface FolderNode {
  readonly name: string
  readonly parent: FolderNode | null
  readonly children: FolderNode[]
  /** Totals for everything below this folder. */
  bytes: number
  files: number
  /** Folders below this one, not counting itself. */
  folders: number
}

export interface ScanTotals {
  files: number
  folders: number
  bytes: number
}

export interface ScanTree extends WalkSink<FolderNode> {
  readonly rootPath: string
  readonly root: FolderNode
  /** The folder the walk is listing now. */
  readonly currentPath: string
  /** Exact number of errors, including those beyond `MAX_SCAN_ERRORS`. */
  readonly errorCount: number
  /** The first `MAX_SCAN_ERRORS` errors, in the order they happened. */
  readonly errors: readonly ScanError[]
  totals(): ScanTotals
  pathOf(node: FolderNode): string
}

export function scanErrorReason(code: string): ScanErrorReason {
  switch (code) {
    case 'EACCES':
    case 'EPERM':
      return 'access-denied'
    case 'ENAMETOOLONG':
      return 'path-too-long'
    case 'ENOENT':
      return 'not-found'
    default:
      return 'other'
  }
}

export function createScanTree(rootPath: string): ScanTree {
  const root: FolderNode = {
    name: rootPath,
    parent: null,
    children: [],
    bytes: 0,
    files: 0,
    folders: 0,
  }
  const errors: ScanError[] = []
  let errorCount = 0
  let currentPath = rootPath

  return {
    rootPath,
    root,
    errors,
    get currentPath() {
      return currentPath
    },
    get errorCount() {
      return errorCount
    },

    folder(parent, name) {
      const node: FolderNode = { name, parent, children: [], bytes: 0, files: 0, folders: 0 }
      parent.children.push(node)
      let ancestor: FolderNode | null = parent
      while (ancestor !== null) {
        ancestor.folders += 1
        ancestor = ancestor.parent
      }
      return node
    },

    file(parent, bytes) {
      let ancestor: FolderNode | null = parent
      while (ancestor !== null) {
        ancestor.files += 1
        ancestor.bytes += bytes
        ancestor = ancestor.parent
      }
    },

    error(errorPath, code) {
      errorCount += 1
      if (errors.length < MAX_SCAN_ERRORS) {
        errors.push({ path: errorPath, reason: scanErrorReason(code), code })
      }
    },

    visiting(dirPath) {
      currentPath = dirPath
    },

    totals: () => ({ files: root.files, folders: root.folders, bytes: root.bytes }),

    pathOf(node) {
      const names: string[] = []
      let current = node
      while (current.parent !== null) {
        names.push(current.name)
        current = current.parent
      }
      return path.join(rootPath, ...names.reverse())
    },
  }
}
```

- [ ] **Step 8: Implement `top-folders.ts`**

`src/worker/scanner/top-folders.ts`:

```ts
import type { FolderSummary } from '@shared/scan-types'
import type { FolderNode, ScanTree } from './tree'

export const TOP_FOLDER_LIMIT = 10
export const EVERYTHING_ELSE_LABEL = 'Everything else'

function largestFirst(a: FolderNode, b: FolderNode): number {
  if (b.bytes !== a.bytes) return b.bytes - a.bytes
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

/**
 * The direct children of the scanned root, largest first: the top `limit` folders plus one
 * "Everything else" row for the remaining folders and the files directly in the root.
 * (Ranking all folders would always put ancestors first; this list is the tree's first level.)
 */
export function topFolders(tree: ScanTree, limit = TOP_FOLDER_LIMIT): FolderSummary[] {
  const { root } = tree
  const top = [...root.children].sort(largestFirst).slice(0, limit)
  const rows: FolderSummary[] = top.map((node) => ({
    kind: 'folder',
    name: node.name,
    path: tree.pathOf(node),
    bytes: node.bytes,
    files: node.files,
    folders: node.folders,
  }))

  let bytes = root.bytes
  let files = root.files
  let folders = root.folders
  for (const node of top) {
    bytes -= node.bytes
    files -= node.files
    folders -= node.folders + 1
  }
  if (files > 0 || folders > 0) {
    rows.push({
      kind: 'everything-else',
      name: EVERYTHING_ELSE_LABEL,
      path: tree.rootPath,
      bytes,
      files,
      folders,
    })
  }
  return rows
}
```

- [ ] **Step 9: Run the tests and quality gates**

```powershell
npx vitest run src/worker
npm run format
npm run format:check
npm run lint
npm run typecheck
npm test
```

Expected: `walk.test.ts` 13, `tree.test.ts` 11, `top-folders.test.ts` 5 tests pass; every command exits 0. If the junction test fails with `EPERM` on `symlinkSync`, the temp folder is on a file system without junction support (for example a network drive); run from a local NTFS drive.

- [ ] **Step 10: Commit**

```powershell
git add src/worker/scanner/walk.ts src/worker/scanner/walk.test.ts src/worker/scanner/tree.ts src/worker/scanner/tree.test.ts src/worker/scanner/top-folders.ts src/worker/scanner/top-folders.test.ts src/worker/scanner/test/fake-walk-fs.ts tsconfig.node.json eslint.config.mjs
git commit -m "feat(scanner): concurrent opendir+lstat walk, folder tree and top folders" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Scanner process, scan service, scan channels and the crash policies

**Implementer tier:** standard

Verified APIs (Electron 45.3.4 `node_modules/electron/electron.d.ts`): `utilityProcess.fork(modulePath: string, args?: string[], options?: ForkOptions): UtilityProcess`, callable only after `app` is ready; `ForkOptions.serviceName` becomes the `name` of the process in `app.getAppMetrics()`; `UtilityProcess` has `postMessage(message: any)`, `on('message', (message: any) => void)`, `on('exit', (code: number) => void)`, `kill(): boolean`, `pid`; inside the child, `process.parentPort.on('message', (e: MessageEvent) => …)` with `e.data`, and `process.parentPort.postMessage(message)`; `process.noAsar: boolean`. `RenderProcessGoneDetails.reason` is `'clean-exit' | 'abnormal-exit' | 'killed' | 'crashed' | 'oom' | 'launch-failed' | 'integrity-failure' | 'memory-eviction'`. electron-vite 6 (verified by a local build): when `main.build.rolldownOptions.input` is an object, each key becomes `out/main/<key>.js` in CommonJS, so `{ index, scanner }` produces `out/main/index.js` and `out/main/scanner.js`.

Decisions recorded here:

- **Scanner crash policy:** an unexpected exit of the scanner while a scan is active sends `scan:failed` (`SCAN_CRASH_MESSAGE`); the renderer shows the crash screen. The next start forks a fresh scanner. An exit while idle is silent. On app quit the service is disposed: it kills the child and sends nothing afterwards.
- **`render-process-gone` policy (carry-over 5, spec §4):** ignore `clean-exit` and anything while quitting. Before the first successful load, keep Phase 1's fail-fast (error dialog, quit). After it, show "StorageIQ stopped unexpectedly", cancel any running scan, and reload the window once. If the renderer dies again after that reload, show the same title and quit (the spec says "reload once"; quitting on the second crash keeps Phase 1's rule that the app never lingers in a broken state).
- The scanner sets `process.noAsar = true`, so `.asar` archives on the scanned disk (for example `resources\app.asar` of any Electron app) are counted as files, never walked as folders.
- After a scan, the scanner process stays alive and keeps the tree (spec approach A; Phase 3 queries it).

**Files:**

- Create: `src/shared/scanner-protocol.ts`, `src/worker/scanner/scanner-host.ts`, `src/worker/scanner/entry.ts`, `src/main/scan/scan-service.ts`, `src/main/ipc/scan-handlers.ts`, `src/main/render-process-gone.ts`, `e2e/support/fixture.ts`
- Modify: `src/shared/ipc-contract.ts`, `src/preload/index.ts`, `src/main/window.ts`, `src/main/index.ts`, `electron.vite.config.ts`, `src/renderer/src/test/fake-api.ts`, `src/main/ipc/register.test.ts`, `e2e/app.spec.ts`
- Test: `src/worker/scanner/scanner-host.test.ts`, `src/main/scan/scan-service.test.ts`, `src/main/ipc/scan-handlers.test.ts`, `src/main/render-process-gone.test.ts`

**Interfaces:**

- Consumes: `walk`, `nodeWalkFs`, `WalkFs`, `createScanTree`, `ScanTree`, `topFolders` (Task 3); `SendEvent`, `createEventSender`, `IpcHandlerMap`, `noArgs`, `oneString`, `InvalidIpcArgumentsError` (Task 2); `ScanProgress`, `ScanDone`, `ScanFailed`, `ScanStartResult` (Task 2).
- Produces:
  - `src/shared/scanner-protocol.ts`: `ScannerRequest = { type: 'start'; scanId; root } | { type: 'cancel'; scanId }`, `ScannerMessage = { type: 'progress'; payload: ScanProgress } | { type: 'done'; payload: ScanDone }`, `SCANNER_SERVICE_NAME = 'StorageIQ scanner'`
  - `scanner-host.ts`: `SNAPSHOT_INTERVAL_MS = 250`, `ScannerHostDeps { fs; post; now; startTicker }`, `ScannerHost { handle(request); idle(); lastTree() }`, `parseScannerRequest(data: unknown): ScannerRequest | null`, `createScannerHost(deps): ScannerHost`
  - `scan-service.ts`: `ScannerChild { postMessage; onMessage; onExit; kill }`, `ScanServiceDeps { forkScanner; sendEvent; createScanId }`, `ScanService { start(root): ScanStartResult; cancel(scanId); cancelActive(); dispose() }`, `SCAN_CRASH_MESSAGE`, `createScanService(deps): ScanService`
  - `scan-handlers.ts`: `ScanHandlerDeps { scanService: Pick<ScanService, 'start' | 'cancel'>; stat(path): Promise<{ isDirectory(): boolean }> }`, `ScanHandlers = Pick<IpcHandlerMap, 'scan:start' | 'scan:cancel'>`, `parseScanRoot(args, stat): Promise<[string]>`, `createScanHandlers(deps): ScanHandlers`
  - `render-process-gone.ts`: `RenderProcessGoneAction = 'ignore' | 'fail-startup' | 'reload' | 'quit'`, `RenderProcessGoneInput { reason; quitting; loaded; reloadedAfterCrash }`, `decideRenderProcessGone(input)`, `RENDERER_GONE_TITLE = 'StorageIQ stopped unexpectedly'`, `RENDERER_GONE_RELOAD_MESSAGE`, `RENDERER_GONE_QUIT_MESSAGE`
  - `MainWindowConfig` gains `isQuitting(): boolean` and `onRendererReload?(): void`
  - Contract: `'scan:start': { args: [path: string]; result: ScanStartResult }`, `'scan:cancel': { args: [scanId: string]; result: void }`; `StorageIQApi.startScan(path): Promise<ScanStartResult>`, `StorageIQApi.cancelScan(scanId): Promise<void>`
  - `e2e/support/fixture.ts`: `ScanFixture { root; expected: { files; folders; bytes; topFolderNames }; remove() }`, `createScanFixture(): ScanFixture`

- [ ] **Step 1: Write the scanner protocol and the scan channels**

`src/shared/scanner-protocol.ts`:

```ts
import type { ScanDone, ScanProgress } from './scan-types'

/** Name of the scanner utilityProcess; it is the `name` in `app.getAppMetrics()`. */
export const SCANNER_SERVICE_NAME = 'StorageIQ scanner'

/** main → scanner process. */
export type ScannerRequest =
  { type: 'start'; scanId: string; root: string } | { type: 'cancel'; scanId: string }

/** scanner process → main. */
export type ScannerMessage =
  { type: 'progress'; payload: ScanProgress } | { type: 'done'; payload: ScanDone }
```

`src/shared/ipc-contract.ts` (full file):

```ts
import type { ScanDone, ScanFailed, ScanProgress, ScanStartResult } from './scan-types'

/** Metadata about the running application, shown in the status bar. */
export interface AppInfo {
  name: string
  version: string
  platform: string
  arch: string
  electronVersion: string
}

/** Outcome of the native "choose a folder" dialog. */
export type SelectFolderResult = { canceled: true } | { canceled: false; path: string }

/**
 * Single source of truth for every renderer → main request.
 * Each channel maps to its argument tuple and its resolved result.
 */
export interface IpcContract {
  'app:get-info': { args: []; result: AppInfo }
  'dialog:select-folder': { args: []; result: SelectFolderResult }
  'scan:start': { args: [path: string]; result: ScanStartResult }
  'scan:cancel': { args: [scanId: string]; result: void }
}

export type IpcChannel = keyof IpcContract
export type IpcArgs<C extends IpcChannel> = IpcContract[C]['args']
export type IpcResult<C extends IpcChannel> = IpcContract[C]['result']

/** Single source of truth for every main → renderer event and its payload. */
export interface IpcEventContract {
  'scan:progress': ScanProgress
  'scan:done': ScanDone
  'scan:failed': ScanFailed
}

export type IpcEventChannel = keyof IpcEventContract
export type IpcEventPayload<E extends IpcEventChannel> = IpcEventContract[E]

/** Stops a subscription made with one of the `on…` functions. */
export type Unsubscribe = () => void

/** The API the preload script exposes to the renderer as `window.storageiq`. */
export interface StorageIQApi {
  getAppInfo(): Promise<AppInfo>
  selectFolder(): Promise<SelectFolderResult>
  /** Starts scanning `path` (an absolute local folder); a running scan is superseded. */
  startScan(path: string): Promise<ScanStartResult>
  /** Stops the scan; unknown or finished IDs are ignored. */
  cancelScan(scanId: string): Promise<void>
  onScanProgress(listener: (progress: ScanProgress) => void): Unsubscribe
  onScanDone(listener: (done: ScanDone) => void): Unsubscribe
  onScanFailed(listener: (failed: ScanFailed) => void): Unsubscribe
}
```

- [ ] **Step 2: Write the failing scanner-host tests**

`src/worker/scanner/scanner-host.test.ts`:

```ts
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ScanDone, ScanProgress } from '@shared/scan-types'
import type { ScannerMessage } from '@shared/scanner-protocol'
import { createScannerHost, parseScannerRequest, SNAPSHOT_INTERVAL_MS } from './scanner-host'
import { createFakeWalkFs, dir, type FakeWalkFsOptions, file } from './test/fake-walk-fs'

const ROOT = 'C:\\Data'
const PHOTOS = path.join(ROOT, 'Photos')
const MUSIC = path.join(ROOT, 'Music')

function setup(options: FakeWalkFsOptions = {}) {
  const fs = createFakeWalkFs(
    ROOT,
    dir({
      Photos: dir({ 'a.jpg': file(300), 'b.jpg': file(200) }),
      Music: dir({ 'c.mp3': file(100) }),
      'notes.txt': file(5),
    }),
    options,
  )
  const posted: ScannerMessage[] = []
  let tick: (() => void) | null = null
  let intervalMs = 0
  let clock = 1_000
  const host = createScannerHost({
    fs,
    post: (message) => {
      posted.push(message)
    },
    now: () => clock,
    startTicker: (callback, ms) => {
      tick = callback
      intervalMs = ms
      return () => {
        if (tick === callback) tick = null
      }
    },
  })
  return {
    host,
    tick: () => tick?.(),
    isTicking: () => tick !== null,
    intervalMs: () => intervalMs,
    advance: (ms: number) => {
      clock += ms
    },
    progress: (): ScanProgress[] =>
      posted.flatMap((message) => (message.type === 'progress' ? [message.payload] : [])),
    done: (): ScanDone[] =>
      posted.flatMap((message) => (message.type === 'done' ? [message.payload] : [])),
  }
}

describe('createScannerHost', () => {
  it('reports totals, the largest folders and the elapsed time when a scan completes', async () => {
    const t = setup()
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT })
    t.advance(40)
    await t.host.idle()

    expect(t.done()).toEqual([
      {
        scanId: 's1',
        status: 'complete',
        files: 4,
        folders: 2,
        bytes: 605,
        elapsedMs: 40,
        topFolders: [
          { kind: 'folder', name: 'Photos', path: PHOTOS, bytes: 500, files: 2, folders: 0 },
          { kind: 'folder', name: 'Music', path: MUSIC, bytes: 100, files: 1, folders: 0 },
          {
            kind: 'everything-else',
            name: 'Everything else',
            path: ROOT,
            bytes: 5,
            files: 1,
            folders: 0,
          },
        ],
        errors: [],
        errorCount: 0,
      },
    ])
  })

  it('posts a snapshot on every tick and stops ticking when the scan ends', async () => {
    const t = setup()
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT })

    expect(SNAPSHOT_INTERVAL_MS).toBe(250)
    expect(t.intervalMs()).toBe(SNAPSHOT_INTERVAL_MS)
    t.tick()
    expect(t.progress()).toEqual([
      {
        scanId: 's1',
        files: 0,
        folders: 0,
        bytes: 0,
        currentPath: ROOT,
        elapsedMs: 0,
        topFolders: [],
      },
    ])

    await t.host.idle()
    expect(t.isTicking()).toBe(false)
  })

  it('cancels the running scan and reports partial results as canceled', async () => {
    const t = setup()
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT })
    t.host.handle({ type: 'cancel', scanId: 's1' })
    await t.host.idle()

    expect(t.done()).toHaveLength(1)
    expect(t.done()[0]).toMatchObject({ scanId: 's1', status: 'canceled', files: 0, bytes: 0 })
  })

  it('ignores a cancel for a different scan', async () => {
    const t = setup()
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT })
    t.host.handle({ type: 'cancel', scanId: 'someone-else' })
    await t.host.idle()

    expect(t.done()[0]).toMatchObject({ scanId: 's1', status: 'complete' })
  })

  it('lets a new start supersede the running scan', async () => {
    const t = setup()
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT })
    t.host.handle({ type: 'start', scanId: 's2', root: ROOT })
    await t.host.idle()

    await vi.waitFor(() => expect(t.done()).toHaveLength(2))
    const statusById = Object.fromEntries(t.done().map((done) => [done.scanId, done.status]))
    expect(statusById).toEqual({ s1: 'canceled', s2: 'complete' })
  })

  it('ends a scan of an unreadable root as complete with zero totals and one error', async () => {
    const t = setup({ opendirErrors: { [ROOT]: 'EACCES' } })
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT })
    await t.host.idle()

    expect(t.done()[0]).toMatchObject({
      status: 'complete',
      files: 0,
      folders: 0,
      bytes: 0,
      topFolders: [],
      errors: [{ path: ROOT, reason: 'access-denied', code: 'EACCES' }],
      errorCount: 1,
    })
  })

  it('keeps the finished tree for later queries', async () => {
    const t = setup()
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT })
    await t.host.idle()

    expect(t.host.lastTree()?.totals()).toEqual({ files: 4, folders: 2, bytes: 605 })
  })
})

describe('parseScannerRequest', () => {
  it('accepts start and cancel requests', () => {
    expect(parseScannerRequest({ type: 'start', scanId: 's1', root: ROOT })).toEqual({
      type: 'start',
      scanId: 's1',
      root: ROOT,
    })
    expect(parseScannerRequest({ type: 'cancel', scanId: 's1' })).toEqual({
      type: 'cancel',
      scanId: 's1',
    })
  })

  it.each([
    null,
    'start',
    { type: 'start', scanId: 's1' },
    { type: 'cancel' },
    { type: 'delete', scanId: 's1' },
  ])('rejects %j', (data) => {
    expect(parseScannerRequest(data)).toBeNull()
  })
})
```

- [ ] **Step 3: Write the failing scan-service tests**

`src/main/scan/scan-service.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ScanDone, ScanProgress } from '@shared/scan-types'
import type { ScannerRequest } from '@shared/scanner-protocol'
import type { SendEvent } from '../ipc/send-event'
import { createScanService, SCAN_CRASH_MESSAGE, type ScannerChild } from './scan-service'

interface FakeChild extends ScannerChild {
  posted: ScannerRequest[]
  killed: boolean
  emit(message: unknown): void
  exit(code: number): void
}

function createFakeChild(): FakeChild {
  const messageListeners: Array<(message: unknown) => void> = []
  const exitListeners: Array<(code: number) => void> = []
  const child: FakeChild = {
    posted: [],
    killed: false,
    postMessage: (message) => {
      child.posted.push(message)
    },
    onMessage: (listener) => {
      messageListeners.push(listener)
    },
    onExit: (listener) => {
      exitListeners.push(listener)
    },
    kill: () => {
      child.killed = true
    },
    emit: (message) => {
      for (const listener of messageListeners) listener(message)
    },
    exit: (code) => {
      for (const listener of exitListeners) listener(code)
    },
  }
  return child
}

function progress(scanId: string): ScanProgress {
  return {
    scanId,
    files: 1,
    folders: 0,
    bytes: 10,
    currentPath: 'C:\\Data',
    elapsedMs: 250,
    topFolders: [],
  }
}

function done(scanId: string, status: ScanDone['status'] = 'complete'): ScanDone {
  return {
    scanId,
    status,
    files: 1,
    folders: 0,
    bytes: 10,
    elapsedMs: 300,
    topFolders: [],
    errors: [],
    errorCount: 0,
  }
}

function setup() {
  const children: FakeChild[] = []
  const events: Array<[string, unknown]> = []
  const sendEvent: SendEvent = (channel, payload) => {
    events.push([channel, payload])
  }
  let counter = 0
  const service = createScanService({
    forkScanner: () => {
      const child = createFakeChild()
      children.push(child)
      return child
    },
    sendEvent,
    createScanId: () => {
      counter += 1
      return `scan-${counter}`
    },
  })
  const child = (index = 0): FakeChild => {
    const found = children[index]
    if (!found) throw new Error(`no scanner child #${index}`)
    return found
  }
  return { service, children, events, child }
}

describe('createScanService', () => {
  it('forks the scanner on the first start only and posts each start request', () => {
    const t = setup()
    expect(t.children).toHaveLength(0)

    expect(t.service.start('C:\\Data')).toEqual({ scanId: 'scan-1' })
    t.child().emit({ type: 'done', payload: done('scan-1') })
    expect(t.service.start('D:\\')).toEqual({ scanId: 'scan-2' })

    expect(t.children).toHaveLength(1)
    expect(t.child().posted).toEqual([
      { type: 'start', scanId: 'scan-1', root: 'C:\\Data' },
      { type: 'start', scanId: 'scan-2', root: 'D:\\' },
    ])
  })

  it('relays progress and done of the active scan to the window', () => {
    const t = setup()
    t.service.start('C:\\Data')
    t.child().emit({ type: 'progress', payload: progress('scan-1') })
    t.child().emit({ type: 'done', payload: done('scan-1') })

    expect(t.events).toEqual([
      ['scan:progress', progress('scan-1')],
      ['scan:done', done('scan-1')],
    ])
  })

  it('drops messages of other scans and malformed messages', () => {
    const t = setup()
    t.service.start('C:\\Data')
    t.child().emit({ type: 'progress', payload: progress('scan-0') })
    t.child().emit({ type: 'progress' })
    t.child().emit('garbage')
    t.child().emit({ type: 'other', payload: { scanId: 'scan-1' } })

    expect(t.events).toEqual([])
  })

  it('cancels the running scan when a new one starts, and relays only the new one', () => {
    const t = setup()
    t.service.start('C:\\Data')
    t.service.start('D:\\')
    t.child().emit({ type: 'done', payload: done('scan-1', 'canceled') })
    t.child().emit({ type: 'done', payload: done('scan-2') })

    expect(t.child().posted).toEqual([
      { type: 'start', scanId: 'scan-1', root: 'C:\\Data' },
      { type: 'cancel', scanId: 'scan-1' },
      { type: 'start', scanId: 'scan-2', root: 'D:\\' },
    ])
    expect(t.events).toEqual([['scan:done', done('scan-2')]])
  })

  it('cancels the active scan and ignores unknown or finished scans', () => {
    const t = setup()
    t.service.start('C:\\Data')
    t.service.cancel('nope')
    t.service.cancel('scan-1')
    t.child().emit({ type: 'done', payload: done('scan-1', 'canceled') })
    t.service.cancel('scan-1')

    expect(t.child().posted).toEqual([
      { type: 'start', scanId: 'scan-1', root: 'C:\\Data' },
      { type: 'cancel', scanId: 'scan-1' },
    ])
    expect(t.events).toEqual([['scan:done', done('scan-1', 'canceled')]])
  })

  it('turns an unexpected exit during a scan into scan:failed and forks anew next time', () => {
    const t = setup()
    t.service.start('C:\\Data')
    t.child().exit(1)

    expect(t.events).toEqual([['scan:failed', { scanId: 'scan-1', message: SCAN_CRASH_MESSAGE }]])

    t.service.start('C:\\Data')
    expect(t.children).toHaveLength(2)
    expect(t.child(1).posted).toEqual([{ type: 'start', scanId: 'scan-2', root: 'C:\\Data' }])
  })

  it('stays silent when an idle scanner exits', () => {
    const t = setup()
    t.service.start('C:\\Data')
    t.child().emit({ type: 'done', payload: done('scan-1') })
    t.child().exit(0)

    expect(t.events).toEqual([['scan:done', done('scan-1')]])
  })

  it('kills the scanner on quit and sends nothing afterwards', () => {
    const t = setup()
    t.service.start('C:\\Data')
    t.service.dispose()

    expect(t.child().killed).toBe(true)
    t.child().emit({ type: 'progress', payload: progress('scan-1') })
    t.child().exit(1)
    expect(t.events).toEqual([])
    expect(() => t.service.start('C:\\Data')).toThrow('shut down')
  })

  it('cancelActive cancels only a running scan', () => {
    const t = setup()
    t.service.cancelActive()
    expect(t.children).toHaveLength(0)

    t.service.start('C:\\Data')
    t.service.cancelActive()
    expect(t.child().posted.at(-1)).toEqual({ type: 'cancel', scanId: 'scan-1' })
  })
})
```

- [ ] **Step 4: Write the failing scan-handler and crash-policy tests**

`src/main/ipc/scan-handlers.test.ts`:

```ts
import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { InvalidIpcArgumentsError } from './parse-args'
import { createScanHandlers } from './scan-handlers'

const event = {} as IpcMainInvokeEvent

function setup() {
  const folders = new Set(['D:\\Photos', 'D:/Photos', 'C:\\'])
  const files = new Set(['D:\\notes.txt'])
  const start = vi.fn(() => ({ scanId: 'scan-1' }))
  const cancel = vi.fn()
  const stat = vi.fn(async (target: string) => {
    if (folders.has(target)) return { isDirectory: () => true }
    if (files.has(target)) return { isDirectory: () => false }
    throw Object.assign(new Error(`ENOENT: ${target}`), { code: 'ENOENT' })
  })
  return { handlers: createScanHandlers({ scanService: { start, cancel }, stat }), start, cancel }
}

describe('scan:start', () => {
  it('accepts an existing absolute local folder', async () => {
    const { handlers } = setup()
    await expect(handlers['scan:start'].parseArgs(['D:\\Photos'])).resolves.toEqual(['D:\\Photos'])
    await expect(handlers['scan:start'].parseArgs(['C:\\'])).resolves.toEqual(['C:\\'])
  })

  it('normalizes forward slashes', async () => {
    const { handlers } = setup()
    await expect(handlers['scan:start'].parseArgs(['D:/Photos'])).resolves.toEqual(['D:\\Photos'])
  })

  it.each([
    ['no argument', []],
    ['two arguments', ['D:\\Photos', 'D:\\Music']],
    ['a number', [42]],
    ['a relative path', ['Photos']],
    ['a root-relative path', ['\\Photos']],
    ['a UNC path', ['\\\\server\\share']],
    ['a forward-slash UNC path', ['//server/share']],
    ['a missing folder', ['D:\\Missing']],
    ['a file', ['D:\\notes.txt']],
  ])('rejects %s', async (_label, args) => {
    const { handlers } = setup()
    await expect(
      Promise.resolve().then(() => handlers['scan:start'].parseArgs(args)),
    ).rejects.toThrow(InvalidIpcArgumentsError)
  })

  it('starts the scan through the scan service', async () => {
    const { handlers, start } = setup()
    await expect(
      Promise.resolve(handlers['scan:start'].handle(event, 'D:\\Photos')),
    ).resolves.toEqual({ scanId: 'scan-1' })
    expect(start).toHaveBeenCalledWith('D:\\Photos')
  })
})

describe('scan:cancel', () => {
  it('accepts one string', () => {
    const { handlers } = setup()
    expect(handlers['scan:cancel'].parseArgs(['scan-1'])).toEqual(['scan-1'])
  })

  it.each([[[]], [[7]]])('rejects %j', (args) => {
    const { handlers } = setup()
    expect(() => handlers['scan:cancel'].parseArgs(args)).toThrow(InvalidIpcArgumentsError)
  })

  it('forwards the cancel to the scan service', () => {
    const { handlers, cancel } = setup()
    handlers['scan:cancel'].handle(event, 'scan-1')
    expect(cancel).toHaveBeenCalledWith('scan-1')
  })
})
```

`src/main/render-process-gone.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  decideRenderProcessGone,
  type RenderProcessGoneAction,
  type RenderProcessGoneInput,
} from './render-process-gone'

const base: RenderProcessGoneInput = {
  reason: 'crashed',
  quitting: false,
  loaded: true,
  reloadedAfterCrash: false,
}

describe('decideRenderProcessGone', () => {
  it.each<[string, Partial<RenderProcessGoneInput>, RenderProcessGoneAction]>([
    ['a clean exit', { reason: 'clean-exit' }, 'ignore'],
    ['a crash while quitting', { quitting: true }, 'ignore'],
    [
      'a kill while quitting, even before the first load',
      { reason: 'killed', quitting: true, loaded: false },
      'ignore',
    ],
    ['a crash before the first load', { loaded: false }, 'fail-startup'],
    ['a launch failure', { reason: 'launch-failed', loaded: false }, 'fail-startup'],
    ['the first crash after the first load', {}, 'reload'],
    ['an out-of-memory kill after the first load', { reason: 'oom' }, 'reload'],
    ['a second crash after the reload', { reloadedAfterCrash: true }, 'quit'],
  ])('%s', (_label, overrides, expected) => {
    expect(decideRenderProcessGone({ ...base, ...overrides })).toBe(expected)
  })
})
```

- [ ] **Step 5: Add the parsed-arguments test and the new channels to the registration test**

In `src/main/ipc/register.test.ts`:

1. Change the parse-args import to `import { InvalidIpcArgumentsError, noArgs, oneString } from './parse-args'`.
2. In `createHandlers`, add these two entries after `'dialog:select-folder'`:

```ts
    'scan:start': { parseArgs: oneString, handle: () => ({ scanId: 'scan-1' }) },
    'scan:cancel': { parseArgs: oneString, handle: () => undefined },
```

3. Change the expected channel list in `registers exactly one listener per contract channel` to:

```ts
expect([...ipc.listeners.keys()].sort()).toEqual([
  'app:get-info',
  'dialog:select-folder',
  'scan:cancel',
  'scan:start',
])
```

4. Add this test at the end of the `describe` block:

```ts
it('passes the parsed arguments, not the raw ones, to the handler', async () => {
  const ipc = createFakeIpc()
  const handle = vi.fn(() => ({ scanId: 'scan-1' }))
  registerIpcHandlers(
    ipc,
    createHandlers({
      'scan:start': { parseArgs: (args) => [String(args[0]).toUpperCase()], handle },
    }),
    isTrusted,
  )

  await call(ipc, 'scan:start', TRUSTED, ['c:\\data'])

  expect(handle).toHaveBeenCalledWith(expect.anything(), 'C:\\DATA')
})
```

- [ ] **Step 6: Run the tests and confirm they fail**

Run (PowerShell): `npx vitest run src/worker src/main`
Expected: FAIL. `./scanner-host`, `./scan-service`, `./scan-handlers` and `./render-process-gone` cannot be resolved.

- [ ] **Step 7: Implement the scanner host and the process entry**

`src/worker/scanner/scanner-host.ts`:

```ts
import type { ScanDone, ScanProgress } from '@shared/scan-types'
import type { ScannerMessage, ScannerRequest } from '@shared/scanner-protocol'
import { topFolders } from './top-folders'
import { createScanTree, type ScanTree } from './tree'
import { walk, type WalkFs } from './walk'

export const SNAPSHOT_INTERVAL_MS = 250

export interface ScannerHostDeps {
  fs: WalkFs
  post(message: ScannerMessage): void
  now(): number
  /** Calls `tick` every `intervalMs` until the returned function is called. */
  startTicker(tick: () => void, intervalMs: number): () => void
}

export interface ScannerHost {
  handle(request: ScannerRequest): void
  /** Resolves when the most recently started scan has finished. */
  idle(): Promise<void>
  /** The tree of the last finished scan (kept for Phase 3's "children of X" queries). */
  lastTree(): ScanTree | null
}

interface RunningScan {
  scanId: string
  controller: AbortController
  finished: Promise<void>
}

export function parseScannerRequest(data: unknown): ScannerRequest | null {
  if (typeof data !== 'object' || data === null) return null
  const record = data as Record<string, unknown>
  const scanId = record['scanId']
  if (typeof scanId !== 'string') return null
  if (record['type'] === 'start') {
    const root = record['root']
    return typeof root === 'string' ? { type: 'start', scanId, root } : null
  }
  if (record['type'] === 'cancel') return { type: 'cancel', scanId }
  return null
}

export function createScannerHost(deps: ScannerHostDeps): ScannerHost {
  let current: RunningScan | null = null
  let finishedTree: ScanTree | null = null

  const run = async (scanId: string, rootPath: string, signal: AbortSignal): Promise<void> => {
    const tree = createScanTree(rootPath)
    const startedAt = deps.now()
    const snapshot = () => ({
      scanId,
      ...tree.totals(),
      elapsedMs: deps.now() - startedAt,
      topFolders: topFolders(tree),
    })
    const stopTicker = deps.startTicker(() => {
      const progress: ScanProgress = { ...snapshot(), currentPath: tree.currentPath }
      deps.post({ type: 'progress', payload: progress })
    }, SNAPSHOT_INTERVAL_MS)
    try {
      await walk(rootPath, tree.root, tree, { fs: deps.fs, signal })
    } finally {
      stopTicker()
    }
    const done: ScanDone = {
      ...snapshot(),
      status: signal.aborted ? 'canceled' : 'complete',
      errors: [...tree.errors],
      errorCount: tree.errorCount,
    }
    finishedTree = tree
    deps.post({ type: 'done', payload: done })
  }

  return {
    handle(request) {
      if (request.type === 'cancel') {
        if (current?.scanId === request.scanId) current.controller.abort()
        return
      }
      current?.controller.abort() // a new start supersedes the running scan
      const controller = new AbortController()
      const scan: RunningScan = { scanId: request.scanId, controller, finished: Promise.resolve() }
      current = scan
      scan.finished = run(request.scanId, request.root, controller.signal).finally(() => {
        if (current === scan) current = null
      })
    },
    idle: () => current?.finished ?? Promise.resolve(),
    lastTree: () => finishedTree,
  }
}
```

`src/worker/scanner/entry.ts`:

```ts
import { createScannerHost, parseScannerRequest } from './scanner-host'
import { nodeWalkFs } from './walk'

// Count `.asar` archives on the scanned disk as files; never walk into them as folders.
process.noAsar = true

const host = createScannerHost({
  fs: nodeWalkFs,
  post: (message) => process.parentPort.postMessage(message),
  now: () => performance.now(),
  startTicker: (tick, intervalMs) => {
    const timer = setInterval(tick, intervalMs)
    return () => clearInterval(timer)
  },
})

process.parentPort.on('message', (event) => {
  const request = parseScannerRequest(event.data)
  if (request) host.handle(request)
})
```

- [ ] **Step 8: Implement the scan service**

`src/main/scan/scan-service.ts`:

```ts
import type { ScanFailed, ScanStartResult } from '@shared/scan-types'
import type { ScannerMessage, ScannerRequest } from '@shared/scanner-protocol'
import type { SendEvent } from '../ipc/send-event'

/** The part of an Electron `UtilityProcess` the service needs; tests pass a fake. */
export interface ScannerChild {
  postMessage(message: ScannerRequest): void
  onMessage(listener: (message: unknown) => void): void
  onExit(listener: (code: number) => void): void
  kill(): void
}

export interface ScanServiceDeps {
  /** Forks the scanner utilityProcess. Called lazily, after `app` is ready. */
  forkScanner(): ScannerChild
  sendEvent: SendEvent
  createScanId(): string
}

export interface ScanService {
  /** Starts a scan; a running scan is canceled first (one scan at a time). */
  start(root: string): ScanStartResult
  /** Cancels the active scan; unknown or finished IDs are a no-op. */
  cancel(scanId: string): void
  /** Cancels whatever scan is running (used when the window reloads after a crash). */
  cancelActive(): void
  /** App quit: kill the scanner and send no more events. */
  dispose(): void
}

export const SCAN_CRASH_MESSAGE = 'The scanner process stopped unexpectedly.'

function isScannerMessage(value: unknown): value is ScannerMessage {
  if (typeof value !== 'object' || value === null) return false
  const record = value as { type?: unknown; payload?: unknown }
  if (record.type !== 'progress' && record.type !== 'done') return false
  const payload = record.payload as { scanId?: unknown } | null | undefined
  return typeof payload === 'object' && payload !== null && typeof payload.scanId === 'string'
}

export function createScanService(deps: ScanServiceDeps): ScanService {
  let child: ScannerChild | null = null
  let activeScanId: string | null = null
  let disposed = false

  const ensureChild = (): ScannerChild => {
    if (child) return child
    const forked = deps.forkScanner()
    forked.onMessage((message) => {
      if (disposed || child !== forked || !isScannerMessage(message)) return
      if (message.payload.scanId !== activeScanId) return // superseded or already finished
      if (message.type === 'progress') {
        deps.sendEvent('scan:progress', message.payload)
      } else {
        activeScanId = null
        deps.sendEvent('scan:done', message.payload)
      }
    })
    forked.onExit(() => {
      if (child !== forked) return
      child = null
      if (disposed || activeScanId === null) return
      const failed: ScanFailed = { scanId: activeScanId, message: SCAN_CRASH_MESSAGE }
      activeScanId = null
      deps.sendEvent('scan:failed', failed)
    })
    child = forked
    return forked
  }

  return {
    start(root) {
      if (disposed) throw new Error('The scan service has been shut down.')
      const scanner = ensureChild()
      if (activeScanId !== null) scanner.postMessage({ type: 'cancel', scanId: activeScanId })
      const scanId = deps.createScanId()
      activeScanId = scanId
      scanner.postMessage({ type: 'start', scanId, root })
      return { scanId }
    },

    cancel(scanId) {
      if (scanId === activeScanId) child?.postMessage({ type: 'cancel', scanId })
    },

    cancelActive() {
      if (activeScanId !== null) child?.postMessage({ type: 'cancel', scanId: activeScanId })
    },

    dispose() {
      disposed = true
      activeScanId = null
      const scanner = child
      child = null
      scanner?.kill()
    },
  }
}
```

- [ ] **Step 9: Implement the scan handlers**

`src/main/ipc/scan-handlers.ts`:

```ts
import path from 'node:path'
import type { ScanService } from '../scan/scan-service'
import { InvalidIpcArgumentsError, oneString } from './parse-args'
import type { IpcHandlerMap } from './register'

export interface ScanHandlerDeps {
  scanService: Pick<ScanService, 'start' | 'cancel'>
  stat(path: string): Promise<{ isDirectory(): boolean }>
}

export type ScanHandlers = Pick<IpcHandlerMap, 'scan:start' | 'scan:cancel'>

/** `C:\…` or `C:/…`: a drive letter, a colon and a separator. */
const DRIVE_ABSOLUTE = /^[A-Za-z]:[\\/]/

/** `scan:start` rule: one string; absolute; not UNC; an existing directory. */
export async function parseScanRoot(
  args: readonly unknown[],
  stat: ScanHandlerDeps['stat'],
): Promise<[string]> {
  const [root] = oneString(args)
  if (root.startsWith('\\\\') || root.startsWith('//')) {
    throw new InvalidIpcArgumentsError('network (UNC) paths cannot be scanned')
  }
  if (!DRIVE_ABSOLUTE.test(root)) {
    throw new InvalidIpcArgumentsError('the path must be absolute, like C:\\Folder')
  }
  let isDirectory: boolean
  try {
    isDirectory = (await stat(root)).isDirectory()
  } catch {
    isDirectory = false
  }
  if (!isDirectory) {
    throw new InvalidIpcArgumentsError('the path is not an existing folder')
  }
  return [path.win32.normalize(root)]
}

export function createScanHandlers(deps: ScanHandlerDeps): ScanHandlers {
  return {
    'scan:start': {
      parseArgs: (args) => parseScanRoot(args, deps.stat),
      handle: (_event, root) => deps.scanService.start(root),
    },
    'scan:cancel': {
      parseArgs: oneString,
      handle: (_event, scanId) => {
        deps.scanService.cancel(scanId)
      },
    },
  }
}
```

- [ ] **Step 10: Implement the renderer-crash policy and use it in the window**

`src/main/render-process-gone.ts`:

```ts
import type { RenderProcessGoneDetails } from 'electron'

export type RenderProcessGoneAction = 'ignore' | 'fail-startup' | 'reload' | 'quit'

export interface RenderProcessGoneInput {
  reason: RenderProcessGoneDetails['reason']
  /** The app has started quitting. */
  quitting: boolean
  /** The window finished its first successful load. */
  loaded: boolean
  /** The window was already reloaded once after a renderer crash. */
  reloadedAfterCrash: boolean
}

export const RENDERER_GONE_TITLE = 'StorageIQ stopped unexpectedly'
export const RENDERER_GONE_RELOAD_MESSAGE =
  'StorageIQ ran into a problem and will reload its window. Any scan in progress was stopped.'
export const RENDERER_GONE_QUIT_MESSAGE =
  'StorageIQ ran into the same problem again and will close. Please open it again.'

/** Spec §4 / roadmap carry-over 5. */
export function decideRenderProcessGone(input: RenderProcessGoneInput): RenderProcessGoneAction {
  if (input.reason === 'clean-exit' || input.quitting) return 'ignore'
  if (!input.loaded) return 'fail-startup'
  return input.reloadedAfterCrash ? 'quit' : 'reload'
}
```

`src/main/window.ts` (full file):

```ts
import path from 'node:path'
import { app, BrowserWindow, dialog, nativeTheme } from 'electron'
import { shouldTreatAsFatalLoadFailure } from './load-failure'
import {
  decideRenderProcessGone,
  RENDERER_GONE_QUIT_MESSAGE,
  RENDERER_GONE_RELOAD_MESSAGE,
  RENDERER_GONE_TITLE,
} from './render-process-gone'
import { createMainWindowOptions, WINDOW_BACKGROUND } from './window-options'

export interface MainWindowConfig {
  preloadPath: string
  rendererRoot: string
  devServerUrl?: string
  /** True once the app has started quitting; renderer exits during quit are ignored. */
  isQuitting(): boolean
  /** Called just before the window reloads after a renderer crash. */
  onRendererReload?(): void
}

let failing = false

function failStartup(detail: string): void {
  if (failing) return // did-fail-load and the load promise both report the same failure
  failing = true
  dialog.showErrorBox(
    'StorageIQ could not start',
    `StorageIQ could not load its window and will close.\n\n${detail}`,
  )
  app.quit()
}

export function createMainWindow(config: MainWindowConfig): BrowserWindow {
  const window = new BrowserWindow(
    createMainWindowOptions({
      preloadPath: config.preloadPath,
      dark: nativeTheme.shouldUseDarkColors,
    }),
  )
  let loaded = false
  let reloadedAfterCrash = false

  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, _url, isMainFrame) => {
      if (shouldTreatAsFatalLoadFailure(errorCode, isMainFrame)) {
        failStartup(errorDescription)
      }
    },
  )
  window.webContents.on('did-finish-load', () => {
    loaded = true
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    const action = decideRenderProcessGone({
      reason: details.reason,
      quitting: config.isQuitting(),
      loaded,
      reloadedAfterCrash,
    })
    switch (action) {
      case 'ignore':
        return
      case 'fail-startup':
        failStartup(`The window process stopped unexpectedly (${details.reason}).`)
        return
      case 'reload':
        reloadedAfterCrash = true
        dialog.showErrorBox(RENDERER_GONE_TITLE, RENDERER_GONE_RELOAD_MESSAGE)
        config.onRendererReload?.()
        window.webContents.reload()
        return
      case 'quit':
        dialog.showErrorBox(RENDERER_GONE_TITLE, RENDERER_GONE_QUIT_MESSAGE)
        app.quit()
        return
    }
  })
  const syncBackground = () =>
    window.setBackgroundColor(
      nativeTheme.shouldUseDarkColors ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light,
    )
  nativeTheme.on('updated', syncBackground)
  window.once('closed', () => nativeTheme.off('updated', syncBackground))
  window.once('ready-to-show', () => window.show())

  const load = config.devServerUrl
    ? window.loadURL(config.devServerUrl)
    : window.loadFile(path.join(config.rendererRoot, 'index.html'))
  load.catch((error: unknown) => {
    failStartup(error instanceof Error ? error.message : String(error))
  })

  return window
}
```

- [ ] **Step 11: Build the worker as a second main input**

`electron.vite.config.ts` (full file):

```ts
import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const sharedAlias = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: sharedAlias },
    build: {
      rolldownOptions: {
        // One main build, two entries: the app (out/main/index.js) and the scanner
        // utilityProcess (out/main/scanner.js, forked by src/main/scan/scan-service.ts).
        input: {
          index: resolve('src/main/index.ts'),
          scanner: resolve('src/worker/scanner/entry.ts'),
        },
      },
    },
  },
  preload: {
    resolve: { alias: sharedAlias },
  },
  renderer: {
    resolve: {
      alias: { ...sharedAlias, '@renderer': resolve('src/renderer/src') },
    },
    plugins: [react(), tailwindcss()],
  },
})
```

- [ ] **Step 12: Wire the scan service into main**

`src/main/index.ts` (full file):

```ts
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { app, type BrowserWindow, dialog, ipcMain, Menu, session, utilityProcess } from 'electron'
import { SCANNER_SERVICE_NAME } from '@shared/scanner-protocol'
import { createAppHandlers } from './ipc/app-handlers'
import { type IpcHandlerMap, registerIpcHandlers } from './ipc/register'
import { createScanHandlers } from './ipc/scan-handlers'
import { createEventSender } from './ipc/send-event'
import { createScanService, type ScannerChild } from './scan/scan-service'
import { hardenWebContents } from './security/harden-web-contents'
import { isTrustedIpcSender } from './security/trusted-sender'
import { isTrustedRendererUrl } from './security/trusted-url'
import { createMainWindow } from './window'

const APP_USER_MODEL_ID = 'io.github.storageiq.app'
const rendererRoot = path.join(__dirname, '../renderer')
const preloadPath = path.join(__dirname, '../preload/index.js')
const scannerPath = path.join(__dirname, 'scanner.js')
const devServerUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']
const isTrustedUrl = (url: string) => isTrustedRendererUrl(url, { rendererRoot, devServerUrl })

let mainWindow: BrowserWindow | null = null
let quitting = false

function forkScanner(): ScannerChild {
  const child = utilityProcess.fork(scannerPath, [], { serviceName: SCANNER_SERVICE_NAME })
  return {
    postMessage: (message) => child.postMessage(message),
    onMessage: (listener) => {
      child.on('message', listener)
    },
    onExit: (listener) => {
      child.on('exit', listener)
    },
    kill: () => {
      child.kill()
    },
  }
}

const scanService = createScanService({
  forkScanner,
  sendEvent: createEventSender(() => mainWindow),
  createScanId: () => randomUUID(),
})

function focusMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
}

function reportStartupError(error: unknown): void {
  dialog.showErrorBox('StorageIQ could not start', String(error))
  app.quit()
}

// Dev and E2E runs get their own userData folder (and so their own single-instance lock).
if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'StorageIQ-dev'))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', focusMainWindow)
  hardenWebContents(app, isTrustedUrl)
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => {
    quitting = true
    scanService.dispose() // kills the scanner; no event is sent during quit
  })

  app
    .whenReady()
    .then(() => {
      app.setAppUserModelId(APP_USER_MODEL_ID)
      if (app.isPackaged) {
        Menu.setApplicationMenu(null)
      }

      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      )
      session.defaultSession.setPermissionCheckHandler(() => false)

      const handlers = {
        ...createAppHandlers({
          app,
          dialog,
          getMainWindow: () => mainWindow,
          runtime: {
            platform: process.platform,
            arch: process.arch,
            electronVersion: process.versions.electron,
          },
        }),
        ...createScanHandlers({ scanService, stat }),
      } satisfies IpcHandlerMap

      registerIpcHandlers(ipcMain, handlers, (event) =>
        isTrustedIpcSender(event, {
          mainWebContents: mainWindow?.webContents,
          isTrustedUrl,
        }),
      )

      mainWindow = createMainWindow({
        preloadPath,
        rendererRoot,
        devServerUrl,
        isQuitting: () => quitting,
        onRendererReload: () => scanService.cancelActive(),
      })
      mainWindow.on('closed', () => {
        mainWindow = null
      })
    })
    .catch(reportStartupError)
}
```

- [ ] **Step 13: Expose the scan calls in the preload and the fake API**

In `src/preload/index.ts`, add these two members to `api`, after `selectFolder`:

```ts
  startScan: (root) => invoke('scan:start', root),
  cancelScan: (scanId) => invoke('scan:cancel', scanId),
```

In `src/renderer/src/test/fake-api.ts`, change the shared-type imports to:

```ts
import type { AppInfo, SelectFolderResult, StorageIQApi } from '@shared/ipc-contract'
import type { ScanDone, ScanFailed, ScanProgress, ScanStartResult } from '@shared/scan-types'
```

and add these two members to the returned object, after `selectFolder`:

```ts
    startScan: vi.fn(async (): Promise<ScanStartResult> => ({ scanId: 'scan-1' })),
    cancelScan: vi.fn(async () => undefined),
```

- [ ] **Step 14: Run the unit tests and quality gates**

```powershell
npx vitest run src/worker src/main
npm run format
npm run format:check
npm run lint
npm run typecheck
npm test
npx electron-vite build
Test-Path out/main/scanner.js
```

Expected: `scanner-host.test.ts` 13, `scan-service.test.ts` 9, `scan-handlers.test.ts` 16, `render-process-gone.test.ts` 8, `register.test.ts` 6 tests pass; all other tests pass; `Test-Path` prints `True`.

- [ ] **Step 15: Write the E2E fixture and the bridge-level scan tests**

`e2e/support/fixture.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface ScanFixture {
  /** The folder to scan. */
  root: string
  expected: { files: number; folders: number; bytes: number; topFolderNames: string[] }
  remove(): void
}

/**
 * 12 top-level folders of different sizes (so the list shows 10 plus "Everything else"), each
 * with a nested folder; one file directly in the root; and a junction to a folder outside the
 * root, which must be counted as one 0-byte entry and never entered.
 */
export function createScanFixture(): ScanFixture {
  const base = mkdtempSync(path.join(os.tmpdir(), 'storageiq-e2e-'))
  const root = path.join(base, 'scan-me')
  const outside = path.join(base, 'outside')
  mkdirSync(root)
  mkdirSync(outside)
  writeFileSync(path.join(outside, 'not-counted.bin'), Buffer.alloc(50_000))

  let files = 0
  let folders = 0
  let bytes = 0
  const tops: Array<{ name: string; bytes: number }> = []
  for (let i = 1; i <= 12; i += 1) {
    const name = `folder-${String(i).padStart(2, '0')}`
    const folder = path.join(root, name)
    const nested = path.join(folder, 'nested')
    mkdirSync(nested, { recursive: true })
    folders += 2
    const size = i * 1000
    for (let f = 0; f < 3; f += 1)
      writeFileSync(path.join(folder, `file-${f}.bin`), Buffer.alloc(size))
    for (let f = 0; f < 2; f += 1)
      writeFileSync(path.join(nested, `file-${f}.bin`), Buffer.alloc(size))
    files += 5
    bytes += size * 5
    tops.push({ name, bytes: size * 5 })
  }
  writeFileSync(path.join(root, 'root-file.txt'), Buffer.alloc(777))
  files += 1
  bytes += 777
  symlinkSync(outside, path.join(root, 'link-to-outside'), 'junction')
  files += 1 // the junction: one 0-byte entry

  const topFolderNames = [...tops]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10)
    .map((top) => top.name)
  return {
    root,
    expected: { files, folders, bytes, topFolderNames }, // 62 files, 24 folders, 390,777 bytes
    remove: () => rmSync(base, { recursive: true, force: true }),
  }
}
```

In `e2e/app.spec.ts`:

1. Add these imports below the existing ones:

```ts
import type { StorageIQApi } from '../src/shared/ipc-contract'
import type { ScanDone } from '../src/shared/scan-types'
import { createScanFixture } from './support/fixture'
```

2. Change the expected bridge keys to:

```ts
expect(keys).toEqual([
  'cancelScan',
  'getAppInfo',
  'onScanDone',
  'onScanFailed',
  'onScanProgress',
  'selectFolder',
  'startScan',
])
```

3. Add these tests at the end of the file:

```ts
test('scans a folder through the bridge in the scanner process', async () => {
  const fixture = createScanFixture()
  try {
    const done = await page.evaluate((root) => {
      const api = (globalThis as unknown as { storageiq: StorageIQApi }).storageiq
      return new Promise<ScanDone>((resolve, reject) => {
        const off = api.onScanDone((result) => {
          off()
          resolve(result)
        })
        api.startScan(root).catch(reject)
      })
    }, fixture.root)

    expect(done).toMatchObject({
      status: 'complete',
      files: fixture.expected.files,
      folders: fixture.expected.folders,
      bytes: fixture.expected.bytes,
      errorCount: 0,
    })
    expect(done.topFolders.map((row) => row.name)).toEqual([
      ...fixture.expected.topFolderNames,
      'Everything else',
    ])
  } finally {
    fixture.remove()
  }
})

test('rejects a relative scan path before the scanner sees it', async () => {
  const outcome = await page.evaluate(async () => {
    const api = (globalThis as unknown as { storageiq: StorageIQApi }).storageiq
    try {
      await api.startScan('relative\\folder')
      return 'resolved'
    } catch (error) {
      return String(error)
    }
  })
  expect(outcome).toContain('Invalid IPC arguments')
})
```

- [ ] **Step 16: Run the E2E suite and check quitting by hand**

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm run test:e2e
```

Expected: 7 tests pass. Then run `npm run dev`, open DevTools (Ctrl+Shift+I) and run `await storageiq.startScan('C:\\')`; in Task Manager, the "StorageIQ scanner" process appears under the app. Close the window while the scan runs: no StorageIQ process remains in Task Manager. (Task 7 automates this check.)

- [ ] **Step 17: Commit**

```powershell
git add src/shared/scanner-protocol.ts src/shared/ipc-contract.ts src/worker/scanner/scanner-host.ts src/worker/scanner/scanner-host.test.ts src/worker/scanner/entry.ts src/main/scan/scan-service.ts src/main/scan/scan-service.test.ts src/main/ipc/scan-handlers.ts src/main/ipc/scan-handlers.test.ts src/main/ipc/register.test.ts src/main/render-process-gone.ts src/main/render-process-gone.test.ts src/main/window.ts src/main/index.ts src/preload/index.ts electron.vite.config.ts src/renderer/src/test/fake-api.ts e2e/support/fixture.ts e2e/app.spec.ts
git commit -m "feat(scan): scanner utilityProcess, scan service relay, scan channels and crash policies" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Drives through koffi, `drives:list`, and the packaged-app check

**Implementer tier:** standard

Verified (koffi 3.3.8, the current release per `npm view koffi version`, installed in a scratch folder and run on Windows 11 x64 with Node 22):

- API: `import koffi from 'koffi'` (CJS `require('koffi')`; the typings export `load` both named and on the default export). `koffi.load('kernel32.dll')` returns a `LibraryHandle`; `lib.func('<C prototype>')` declares a function. The `__stdcall` keyword is accepted and ignored on x64 (koffi docs, "Calling conventions": "You can safely use these on non-x86 platforms, they are simply ignored"); it documents the WINAPI convention. `const char16_t *` takes a JS string (UTF-16); `_Out_ uint16_t *` takes a `Buffer` that koffi fills. Function results are typed `any` in koffi's typings.
- These exact prototypes worked: `GetLogicalDrives()` returned `36` (C: and F:), `GetDriveTypeW('C:\\')` returned `3` (fixed) and `GetDriveTypeW('F:\\')` returned `4` (network, which StorageIQ drops), `GetVolumeInformationW` returned `1` and an empty label for an unlabelled C:. `fs.statfsSync('C:\\')` returned `bsize`, `blocks`, `bavail` as numbers.
- Packaging: koffi 3 loads its native module from the optional dependency `@koromix/koffi-win32-x64` (`node_modules/koffi/src/koffi/index.cjs` requires `${__dirname}/../../../@koromix/koffi-${platform}-${arch}`, whose `index.js` requires `./win32_x64/koffi.node`). Both packages therefore go in `asarUnpack`. koffi's `install` script only checks for that prebuilt binary (`cnoke --prebuild`); there is no `binding.gyp`. Node-API is ABI-stable, so the binary needs no rebuild for Electron: set `npmRebuild: false`.
- Fuses: `onlyLoadAppFromAsar` only restricts where Electron loads the **app entry** from (`app.asar` instead of an `app` folder); it does not stop `require()` of native modules. Electron's asar support redirects a `require` of a path inside `app.asar` that the archive header marks as unpacked to `app.asar.unpacked`. `enableEmbeddedAsarIntegrityValidation` hashes `app.asar` only, so unpacked files are not integrity-checked (a known Electron limitation; code signing, on the release checklist, covers them). **Verified while writing this plan:** a clean scratch project with exactly these `asarUnpack`/`npmRebuild` settings and the Phase 1 fuses, packaged with `electron-builder --dir`, passed `--self-test` (exit 0: koffi loaded from `app.asar.unpacked\node_modules\@koromix\koffi-win32-x64\win32_x64\koffi.node`, the scanner was forked from inside `app.asar`, and `app.asar` was counted as a file). Step 12 repeats the check on the real build, and CI runs it on every push (Task 7).

Decisions recorded here:

- Drive kinds: keep `DRIVE_FIXED (3)` → `'fixed'` and `DRIVE_REMOVABLE (2)` → `'removable'`; drop everything else (network 4, CD-ROM 5, RAM disk 6, unknown 0/1).
- A drive whose free space cannot be read (for example a card reader without a card) is left out.
- Empty or unreadable labels fall back to Windows' own names: `Local Disk` (fixed) and `USB Drive` (removable).
- koffi is loaded lazily with a dynamic `import()` on the first `drives:list`, so a broken native module fails that call (the UI says the drives couldn't be listed and still offers "Choose folder…") instead of app startup. A failed load is retried on the next call.
- `--self-test` (a new command-line switch): the app lists drives through koffi, checks that `koffi.node` is in `app.asar.unpacked` when packaged, runs one scan of its own `resources` folder in the scanner process, checks that `app.asar` was counted as a file (not walked), prints `[self-test] …` lines and exits with a code from `SELF_TEST_EXIT`. It opens no window, takes no single-instance lock and writes nothing.

**Files:**

- Create: `src/main/drives/drive-api.ts`, `src/main/drives/list-drives.ts`, `src/main/drives/koffi-drive-api.ts`, `src/main/ipc/drive-handlers.ts`, `src/main/self-test.ts`, `scripts/check-packaged-app.mjs`
- Modify: `package.json`, `package-lock.json`, `electron-builder.yml`, `eslint.config.mjs`, `src/shared/ipc-contract.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/main/ipc/register.test.ts`, `src/renderer/src/test/fake-api.ts`, `e2e/app.spec.ts`
- Test: `src/main/drives/list-drives.test.ts`, `src/main/ipc/drive-handlers.test.ts`, `src/main/self-test.test.ts`

**Interfaces:**

- Consumes: `DriveInfo`, `DriveKind`, `ScanDone`, `ScanFailed` (Task 2); `IpcHandlerMap`, `noArgs` (Task 2); `createScanService`, `ScannerChild` (Task 4); `SCANNER_SERVICE_NAME` (Task 4).
- Produces:
  - `drive-api.ts`: `DRIVE_REMOVABLE = 2`, `DRIVE_FIXED = 3`, `DriveSpace { bsize; blocks; bavail }`, `DriveApi { getLogicalDrives(): number; getDriveType(root): number; getVolumeLabel(root): string | null; statfs(root): Promise<DriveSpace> }`
  - `list-drives.ts`: `driveRoots(mask: number): string[]`, `listDrives(api: DriveApi): Promise<DriveInfo[]>`
  - `koffi-drive-api.ts`: `createKoffiDriveApi(): Promise<DriveApi>`
  - `drive-handlers.ts`: `DriveHandlers = Pick<IpcHandlerMap, 'drives:list'>`, `createDriveHandlers(deps: { listDrives(): Promise<DriveInfo[]> }): DriveHandlers`
  - `self-test.ts`: `SELF_TEST_FLAG = '--self-test'`, `SELF_TEST_EXIT = { ok: 0, drivesFailed: 10, noDrives: 11, nativeNotUnpacked: 12, scanFailed: 20, asarEntered: 21 }`, `SelfTestDeps`, `runSelfTest(deps): Promise<number>`
  - Contract: `'drives:list': { args: []; result: DriveInfo[] }`; `StorageIQApi.listDrives(): Promise<DriveInfo[]>`
  - `fake-api.ts`: `TEST_DRIVES: DriveInfo[]` (C: fixed "Local Disk" 512 GB / 128 GB free; E: removable "Photos" 64 GB / 16 GB free)
  - npm script `test:packaged` → `node scripts/check-packaged-app.mjs`

- [ ] **Step 1: Install koffi**

```powershell
npm view koffi version
npm install --save-exact koffi@3.3.8
```

Expected: `npm view` prints `3.3.8` (if it prints a newer version, still install `3.3.8`, the version this plan verified). `package.json` gains `"dependencies": { "koffi": "3.3.8" }`, and `node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node` exists.

- [ ] **Step 2: Write the drive interface**

`src/main/drives/drive-api.ts`:

```ts
/** `GetDriveTypeW` results that StorageIQ keeps (winbase.h). Everything else is left out. */
export const DRIVE_REMOVABLE = 2
export const DRIVE_FIXED = 3

export interface DriveSpace {
  bsize: number
  blocks: number
  bavail: number
}

/** The Windows calls drive listing needs. The app passes koffi + `fs.statfs`; tests pass a fake. */
export interface DriveApi {
  /** Bit mask of existing drive letters (bit 0 = A:). */
  getLogicalDrives(): number
  getDriveType(root: string): number
  /** The volume label, `''` when the volume has none, or `null` when it cannot be read. */
  getVolumeLabel(root: string): string | null
  statfs(root: string): Promise<DriveSpace>
}
```

- [ ] **Step 3: Write the failing drive tests**

`src/main/drives/list-drives.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { DRIVE_FIXED, DRIVE_REMOVABLE, type DriveApi, type DriveSpace } from './drive-api'
import { driveRoots, listDrives } from './list-drives'

const DRIVE_REMOTE = 4
const DRIVE_CDROM = 5
const DRIVE_RAMDISK = 6
const GB = 1024 ** 3
const DEFAULT_SPACE: DriveSpace = {
  bsize: 4096,
  blocks: (100 * GB) / 4096,
  bavail: (40 * GB) / 4096,
}

interface FakeDrive {
  type: number
  label?: string | null
  space?: DriveSpace | 'unreadable'
}

function fakeApi(drives: Record<string, FakeDrive>) {
  const mask = Object.keys(drives).reduce(
    (bits, root) => bits | (1 << (root.charCodeAt(0) - 65)),
    0,
  )
  const statfs = vi.fn(async (root: string): Promise<DriveSpace> => {
    const space = drives[root]?.space ?? DEFAULT_SPACE
    if (space === 'unreadable') throw Object.assign(new Error('not ready'), { code: 'EBUSY' })
    return space
  })
  const api: DriveApi = {
    getLogicalDrives: () => mask,
    getDriveType: (root) => drives[root]?.type ?? 0,
    getVolumeLabel: (root) => {
      const label = drives[root]?.label
      return label === undefined ? '' : label
    },
    statfs,
  }
  return { api, statfs }
}

describe('driveRoots', () => {
  it('turns the GetLogicalDrives bit mask into drive roots', () => {
    expect(driveRoots(0b101)).toEqual(['A:\\', 'C:\\'])
    expect(driveRoots((1 << 2) | (1 << 25))).toEqual(['C:\\', 'Z:\\'])
    expect(driveRoots(0)).toEqual([])
  })
})

describe('listDrives', () => {
  it('keeps only fixed and removable drives', async () => {
    const { api } = fakeApi({
      'C:\\': { type: DRIVE_FIXED },
      'D:\\': { type: DRIVE_CDROM },
      'E:\\': { type: DRIVE_REMOVABLE },
      'F:\\': { type: DRIVE_REMOTE },
      'R:\\': { type: DRIVE_RAMDISK },
    })
    const drives = await listDrives(api)
    expect(drives.map((drive) => [drive.root, drive.kind])).toEqual([
      ['C:\\', 'fixed'],
      ['E:\\', 'removable'],
    ])
  })

  it('computes total and free bytes from statfs', async () => {
    const { api } = fakeApi({
      'C:\\': {
        type: DRIVE_FIXED,
        label: 'System',
        space: { bsize: 4096, blocks: 1000, bavail: 250 },
      },
    })
    expect(await listDrives(api)).toEqual([
      { root: 'C:\\', label: 'System', kind: 'fixed', totalBytes: 4_096_000, freeBytes: 1_024_000 },
    ])
  })

  it('falls back to Windows’ default names when a volume has no label', async () => {
    const { api } = fakeApi({
      'C:\\': { type: DRIVE_FIXED, label: '' },
      'D:\\': { type: DRIVE_FIXED, label: '  Data  ' },
      'E:\\': { type: DRIVE_REMOVABLE, label: null },
    })
    const drives = await listDrives(api)
    expect(drives.map((drive) => drive.label)).toEqual(['Local Disk', 'Data', 'USB Drive'])
  })

  it('leaves out a drive whose free space cannot be read', async () => {
    const { api } = fakeApi({
      'C:\\': { type: DRIVE_FIXED },
      'E:\\': { type: DRIVE_REMOVABLE, space: 'unreadable' },
    })
    expect((await listDrives(api)).map((drive) => drive.root)).toEqual(['C:\\'])
  })

  it('never asks for the size of a drive type it drops', async () => {
    const { api, statfs } = fakeApi({
      'C:\\': { type: DRIVE_FIXED },
      'F:\\': { type: DRIVE_REMOTE },
    })
    await listDrives(api)
    expect(statfs).toHaveBeenCalledTimes(1)
    expect(statfs).toHaveBeenCalledWith('C:\\')
  })
})
```

`src/main/ipc/drive-handlers.test.ts`:

```ts
import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { DriveInfo } from '@shared/scan-types'
import { createDriveHandlers } from './drive-handlers'
import { InvalidIpcArgumentsError } from './parse-args'

const event = {} as IpcMainInvokeEvent
const drives: DriveInfo[] = [
  { root: 'C:\\', label: 'Local Disk', kind: 'fixed', totalBytes: 100, freeBytes: 40 },
]

describe('drives:list', () => {
  it('returns the listed drives', async () => {
    const handlers = createDriveHandlers({ listDrives: vi.fn(async () => drives) })
    await expect(Promise.resolve(handlers['drives:list'].handle(event))).resolves.toEqual(drives)
  })

  it('takes no arguments', () => {
    const handlers = createDriveHandlers({ listDrives: vi.fn(async () => drives) })
    expect(() => handlers['drives:list'].parseArgs(['C:\\'])).toThrow(InvalidIpcArgumentsError)
  })
})
```

`src/main/self-test.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { DriveInfo, ScanDone, ScanFailed } from '@shared/scan-types'
import { runSelfTest, SELF_TEST_EXIT, type SelfTestDeps } from './self-test'

const DRIVES: DriveInfo[] = [
  { root: 'C:\\', label: 'Local Disk', kind: 'fixed', totalBytes: 100, freeBytes: 40 },
]
const NATIVE = 'C:\\App\\resources\\app.asar.unpacked\\koffi.node'

function scanDone(overrides: Partial<ScanDone> = {}): ScanDone {
  return {
    scanId: 'self-test',
    status: 'complete',
    files: 3,
    folders: 1,
    bytes: 900,
    elapsedMs: 20,
    topFolders: [
      {
        kind: 'folder',
        name: 'app.asar.unpacked',
        path: 'C:\\App\\resources\\app.asar.unpacked',
        bytes: 600,
        files: 2,
        folders: 0,
      },
      {
        kind: 'everything-else',
        name: 'Everything else',
        path: 'C:\\App\\resources',
        bytes: 300,
        files: 1,
        folders: 0,
      },
    ],
    errors: [],
    errorCount: 0,
    ...overrides,
  }
}

function setup(overrides: Partial<SelfTestDeps> = {}) {
  const lines: string[] = []
  const deps: SelfTestDeps = {
    listDrives: vi.fn(async () => DRIVES),
    unpackedNativeModule: NATIVE,
    fileExists: vi.fn(() => true),
    scanRoot: 'C:\\App\\resources',
    scanOnce: vi.fn(async (): Promise<ScanDone | ScanFailed> => scanDone()),
    log: (line) => {
      lines.push(line)
    },
    ...overrides,
  }
  return { deps, lines }
}

describe('runSelfTest', () => {
  it('passes when koffi lists drives from the unpacked module and the scanner completes', async () => {
    const { deps, lines } = setup()
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.ok)
    expect(deps.fileExists).toHaveBeenCalledWith(NATIVE)
    expect(deps.scanOnce).toHaveBeenCalledWith('C:\\App\\resources')
    expect(lines).toContain('drives: C:\\')
  })

  it('fails when koffi cannot list drives', async () => {
    const { deps } = setup({ listDrives: vi.fn().mockRejectedValue(new Error('no koffi.node')) })
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.drivesFailed)
  })

  it('fails when no drive is listed', async () => {
    const { deps } = setup({ listDrives: vi.fn(async () => []) })
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.noDrives)
  })

  it('fails when the packaged native module is not unpacked', async () => {
    const { deps } = setup({ fileExists: vi.fn(() => false) })
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.nativeNotUnpacked)
  })

  it('skips the unpacked check when running unpackaged', async () => {
    const { deps } = setup({ unpackedNativeModule: null })
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.ok)
    expect(deps.fileExists).not.toHaveBeenCalled()
  })

  it('fails when the scanner process fails', async () => {
    const failed: ScanFailed = { scanId: 'self-test', message: 'crashed' }
    const { deps } = setup({ scanOnce: vi.fn(async () => failed) })
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.scanFailed)
  })

  it('fails when the scan does not complete', async () => {
    const { deps } = setup({ scanOnce: vi.fn(async () => scanDone({ status: 'canceled' })) })
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.scanFailed)
  })

  it('fails when the scanner walked into app.asar instead of counting it as a file', async () => {
    const done = scanDone({
      topFolders: [
        {
          kind: 'folder',
          name: 'app.asar',
          path: 'C:\\App\\resources\\app.asar',
          bytes: 1,
          files: 1,
          folders: 0,
        },
      ],
    })
    const { deps } = setup({ scanOnce: vi.fn(async () => done) })
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.asarEntered)
  })
})
```

- [ ] **Step 4: Run the tests and confirm they fail**

Run (PowerShell): `npx vitest run src/main/drives src/main/ipc/drive-handlers.test.ts src/main/self-test.test.ts`
Expected: FAIL. `./list-drives`, `./drive-handlers` and `./self-test` cannot be resolved.

- [ ] **Step 5: Implement drive listing and the koffi binding**

`src/main/drives/list-drives.ts`:

```ts
import type { DriveInfo, DriveKind } from '@shared/scan-types'
import { DRIVE_FIXED, DRIVE_REMOVABLE, type DriveApi, type DriveSpace } from './drive-api'

const DEFAULT_LABEL: Record<DriveKind, string> = { fixed: 'Local Disk', removable: 'USB Drive' }

function driveKind(type: number): DriveKind | null {
  if (type === DRIVE_FIXED) return 'fixed'
  if (type === DRIVE_REMOVABLE) return 'removable'
  return null
}

/** `GetLogicalDrives` mask → `['A:\', 'C:\', …]`. */
export function driveRoots(mask: number): string[] {
  const roots: string[] = []
  for (let bit = 0; bit < 26; bit += 1) {
    if ((mask >>> bit) & 1) roots.push(`${String.fromCharCode(65 + bit)}:\\`)
  }
  return roots
}

/** Fixed and removable drives with label and space. Network, optical and RAM disks are left out. */
export async function listDrives(api: DriveApi): Promise<DriveInfo[]> {
  const drives: DriveInfo[] = []
  for (const root of driveRoots(api.getLogicalDrives())) {
    const kind = driveKind(api.getDriveType(root))
    if (kind === null) continue
    let space: DriveSpace
    try {
      space = await api.statfs(root)
    } catch {
      continue // for example a card reader without a card
    }
    const label = api.getVolumeLabel(root)?.trim() ?? ''
    drives.push({
      root,
      label: label === '' ? DEFAULT_LABEL[kind] : label,
      kind,
      totalBytes: space.blocks * space.bsize,
      freeBytes: space.bavail * space.bsize,
    })
  }
  return drives
}
```

`src/main/drives/koffi-drive-api.ts`:

```ts
import { statfs } from 'node:fs/promises'
import type { DriveApi } from './drive-api'

/** MAX_PATH + 1 UTF-16 code units: the documented size for a volume-name buffer. */
const LABEL_BUFFER_CHARS = 261

/**
 * Binds GetLogicalDrives, GetDriveTypeW and GetVolumeInformationW from kernel32 with koffi.
 * koffi is imported lazily, so a broken native module fails `drives:list`, not app startup.
 * `__stdcall` is the WINAPI convention; koffi ignores it on x64.
 */
export async function createKoffiDriveApi(): Promise<DriveApi> {
  const { default: koffi } = await import('koffi')
  const kernel32 = koffi.load('kernel32.dll')
  const getLogicalDrives = kernel32.func('uint32_t __stdcall GetLogicalDrives()')
  const getDriveTypeW = kernel32.func(
    'uint32_t __stdcall GetDriveTypeW(const char16_t *lpRootPathName)',
  )
  const getVolumeInformationW = kernel32.func(
    'int __stdcall GetVolumeInformationW(const char16_t *lpRootPathName, ' +
      '_Out_ uint16_t *lpVolumeNameBuffer, uint32_t nVolumeNameSize, ' +
      'void *lpVolumeSerialNumber, void *lpMaximumComponentLength, void *lpFileSystemFlags, ' +
      'void *lpFileSystemNameBuffer, uint32_t nFileSystemNameSize)',
  )

  return {
    getLogicalDrives: () => Number(getLogicalDrives()),
    getDriveType: (root) => Number(getDriveTypeW(root)),
    getVolumeLabel: (root) => {
      const buffer = Buffer.alloc(LABEL_BUFFER_CHARS * 2)
      const ok = Number(
        getVolumeInformationW(root, buffer, LABEL_BUFFER_CHARS, null, null, null, null, 0),
      )
      if (ok === 0) return null
      const text = buffer.toString('utf16le')
      const end = text.indexOf('\0')
      return end === -1 ? text : text.slice(0, end)
    },
    statfs: (root) => statfs(root),
  }
}
```

`src/main/ipc/drive-handlers.ts`:

```ts
import type { DriveInfo } from '@shared/scan-types'
import { noArgs } from './parse-args'
import type { IpcHandlerMap } from './register'

export type DriveHandlers = Pick<IpcHandlerMap, 'drives:list'>

export function createDriveHandlers(deps: { listDrives(): Promise<DriveInfo[]> }): DriveHandlers {
  return {
    'drives:list': { parseArgs: noArgs, handle: () => deps.listDrives() },
  }
}
```

- [ ] **Step 6: Implement the self-test**

`src/main/self-test.ts`:

```ts
import type { DriveInfo, ScanDone, ScanFailed } from '@shared/scan-types'

/** Run the packaged exe with this switch to check koffi and the scanner process, then exit. */
export const SELF_TEST_FLAG = '--self-test'

export const SELF_TEST_EXIT = {
  ok: 0,
  drivesFailed: 10,
  noDrives: 11,
  nativeNotUnpacked: 12,
  scanFailed: 20,
  asarEntered: 21,
} as const

export interface SelfTestDeps {
  listDrives(): Promise<DriveInfo[]>
  /** Where `koffi.node` must be in a packaged app; `null` when running unpackaged. */
  unpackedNativeModule: string | null
  fileExists(path: string): boolean
  /** The app's `resources` folder, which contains `app.asar`. */
  scanRoot: string
  scanOnce(root: string): Promise<ScanDone | ScanFailed>
  log(line: string): void
}

export async function runSelfTest(deps: SelfTestDeps): Promise<number> {
  let drives: DriveInfo[]
  try {
    drives = await deps.listDrives()
  } catch (error) {
    deps.log(`drives: koffi failed: ${String(error)}`)
    return SELF_TEST_EXIT.drivesFailed
  }
  if (drives.length === 0) {
    deps.log('drives: none found')
    return SELF_TEST_EXIT.noDrives
  }
  deps.log(`drives: ${drives.map((drive) => drive.root).join(' ')}`)

  if (deps.unpackedNativeModule !== null && !deps.fileExists(deps.unpackedNativeModule)) {
    deps.log(`koffi: ${deps.unpackedNativeModule} is missing`)
    return SELF_TEST_EXIT.nativeNotUnpacked
  }

  const result = await deps.scanOnce(deps.scanRoot)
  if (!('status' in result) || result.status !== 'complete') {
    deps.log(`scan: did not complete (${'status' in result ? result.status : result.message})`)
    return SELF_TEST_EXIT.scanFailed
  }
  if (result.topFolders.some((row) => row.kind === 'folder' && row.name === 'app.asar')) {
    deps.log('scan: walked into app.asar instead of counting it as a file')
    return SELF_TEST_EXIT.asarEntered
  }
  deps.log(`scan: ${result.files} files, ${result.folders} folders`)
  return SELF_TEST_EXIT.ok
}
```

- [ ] **Step 7: Add the drives channel to the contract, preload, fake API and registration test**

In `src/shared/ipc-contract.ts`:

1. Change the scan-types import to `import type { DriveInfo, ScanDone, ScanFailed, ScanProgress, ScanStartResult } from './scan-types'`.
2. Add `'drives:list': { args: []; result: DriveInfo[] }` as the first entry of `IpcContract`.
3. Add this member to `StorageIQApi`, after `selectFolder()`:

```ts
  /** Fixed and removable drives with label and space (network and optical drives are left out). */
  listDrives(): Promise<DriveInfo[]>
```

In `src/preload/index.ts`, add `listDrives: () => invoke('drives:list'),` to `api`, after `selectFolder`.

`src/renderer/src/test/fake-api.ts` (full file):

```ts
import { vi } from 'vitest'
import type { AppInfo, SelectFolderResult, StorageIQApi } from '@shared/ipc-contract'
import type {
  DriveInfo,
  ScanDone,
  ScanFailed,
  ScanProgress,
  ScanStartResult,
} from '@shared/scan-types'

export const TEST_APP_INFO: AppInfo = {
  name: 'StorageIQ',
  version: '0.1.0',
  platform: 'win32',
  arch: 'x64',
  electronVersion: '38.0.0',
}

const GB = 1024 ** 3

export const TEST_DRIVES: DriveInfo[] = [
  { root: 'C:\\', label: 'Local Disk', kind: 'fixed', totalBytes: 512 * GB, freeBytes: 128 * GB },
  { root: 'E:\\', label: 'Photos', kind: 'removable', totalBytes: 64 * GB, freeBytes: 16 * GB },
]

/** A fake bridge plus `emit…` helpers that play the main process sending events. */
export interface FakeApi extends StorageIQApi {
  emitScanProgress(progress: ScanProgress): void
  emitScanDone(done: ScanDone): void
  emitScanFailed(failed: ScanFailed): void
  /** Subscribed event listeners across all channels. */
  listenerCount(): number
}

function createChannel<T>() {
  const listeners = new Set<(payload: T) => void>()
  return {
    subscribe: (listener: (payload: T) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emit: (payload: T) => {
      for (const listener of [...listeners]) listener(payload)
    },
    size: () => listeners.size,
  }
}

export function createFakeApi(overrides: Partial<StorageIQApi> = {}): FakeApi {
  const progress = createChannel<ScanProgress>()
  const done = createChannel<ScanDone>()
  const failed = createChannel<ScanFailed>()
  return {
    getAppInfo: vi.fn(async () => TEST_APP_INFO),
    selectFolder: vi.fn(async (): Promise<SelectFolderResult> => ({ canceled: true })),
    listDrives: vi.fn(async () => TEST_DRIVES),
    startScan: vi.fn(async (): Promise<ScanStartResult> => ({ scanId: 'scan-1' })),
    cancelScan: vi.fn(async () => undefined),
    onScanProgress: vi.fn(progress.subscribe),
    onScanDone: vi.fn(done.subscribe),
    onScanFailed: vi.fn(failed.subscribe),
    ...overrides,
    emitScanProgress: progress.emit,
    emitScanDone: done.emit,
    emitScanFailed: failed.emit,
    listenerCount: () => progress.size() + done.size() + failed.size(),
  }
}
```

In `src/main/ipc/register.test.ts`, add `'drives:list': { parseArgs: noArgs, handle: () => [] },` to `createHandlers` (after `'dialog:select-folder'`), and change the expected channel list to:

```ts
expect([...ipc.listeners.keys()].sort()).toEqual([
  'app:get-info',
  'dialog:select-folder',
  'drives:list',
  'scan:cancel',
  'scan:start',
])
```

- [ ] **Step 8: Wire drives and the self-test into main**

`src/main/index.ts` (full file):

```ts
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { app, type BrowserWindow, dialog, ipcMain, Menu, session, utilityProcess } from 'electron'
import type { ScanDone, ScanFailed } from '@shared/scan-types'
import { SCANNER_SERVICE_NAME } from '@shared/scanner-protocol'
import type { DriveApi } from './drives/drive-api'
import { createKoffiDriveApi } from './drives/koffi-drive-api'
import { listDrives } from './drives/list-drives'
import { createAppHandlers } from './ipc/app-handlers'
import { createDriveHandlers } from './ipc/drive-handlers'
import { type IpcHandlerMap, registerIpcHandlers } from './ipc/register'
import { createScanHandlers } from './ipc/scan-handlers'
import { createEventSender } from './ipc/send-event'
import { createScanService, type ScannerChild } from './scan/scan-service'
import { hardenWebContents } from './security/harden-web-contents'
import { isTrustedIpcSender } from './security/trusted-sender'
import { isTrustedRendererUrl } from './security/trusted-url'
import { runSelfTest, SELF_TEST_FLAG } from './self-test'
import { createMainWindow } from './window'

const APP_USER_MODEL_ID = 'io.github.storageiq.app'
const rendererRoot = path.join(__dirname, '../renderer')
const preloadPath = path.join(__dirname, '../preload/index.js')
const scannerPath = path.join(__dirname, 'scanner.js')
const devServerUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']
const isTrustedUrl = (url: string) => isTrustedRendererUrl(url, { rendererRoot, devServerUrl })

let mainWindow: BrowserWindow | null = null
let quitting = false
let driveApi: Promise<DriveApi> | null = null

/** Loads koffi on first use; a failed load is retried on the next call. */
function getDriveApi(): Promise<DriveApi> {
  driveApi ??= createKoffiDriveApi().catch((error: unknown) => {
    driveApi = null
    throw error
  })
  return driveApi
}

async function listSystemDrives() {
  return listDrives(await getDriveApi())
}

function forkScanner(): ScannerChild {
  const child = utilityProcess.fork(scannerPath, [], { serviceName: SCANNER_SERVICE_NAME })
  return {
    postMessage: (message) => child.postMessage(message),
    onMessage: (listener) => {
      child.on('message', listener)
    },
    onExit: (listener) => {
      child.on('exit', listener)
    },
    kill: () => {
      child.kill()
    },
  }
}

const scanService = createScanService({
  forkScanner,
  sendEvent: createEventSender(() => mainWindow),
  createScanId: () => randomUUID(),
})

/** Self-test only: one scan in a fresh scanner process, resolved with its final event. */
function scanOnce(root: string): Promise<ScanDone | ScanFailed> {
  return new Promise((resolve) => {
    const service = createScanService({
      forkScanner,
      createScanId: () => randomUUID(),
      sendEvent: (channel, payload) => {
        if (channel === 'scan:progress') return
        service.dispose()
        resolve(payload as ScanDone | ScanFailed)
      },
    })
    service.start(root)
  })
}

function focusMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
}

function reportStartupError(error: unknown): void {
  dialog.showErrorBox('StorageIQ could not start', String(error))
  app.quit()
}

// Dev and E2E runs get their own userData folder (and so their own single-instance lock).
if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'StorageIQ-dev'))
}

if (process.argv.includes(SELF_TEST_FLAG)) {
  // No window, no single-instance lock: list drives, run one scan, exit with a status code.
  app
    .whenReady()
    .then(() =>
      runSelfTest({
        listDrives: listSystemDrives,
        unpackedNativeModule: app.isPackaged
          ? path.join(
              process.resourcesPath,
              'app.asar.unpacked',
              'node_modules',
              '@koromix',
              'koffi-win32-x64',
              'win32_x64',
              'koffi.node',
            )
          : null,
        fileExists: existsSync,
        scanRoot: process.resourcesPath,
        scanOnce,
        log: (line) => {
          process.stdout.write(`[self-test] ${line}\n`)
        },
      }),
    )
    .then(
      (code) => app.exit(code),
      (error: unknown) => {
        process.stderr.write(`[self-test] ${String(error)}\n`)
        app.exit(1)
      },
    )
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', focusMainWindow)
  hardenWebContents(app, isTrustedUrl)
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => {
    quitting = true
    scanService.dispose() // kills the scanner; no event is sent during quit
  })

  app
    .whenReady()
    .then(() => {
      app.setAppUserModelId(APP_USER_MODEL_ID)
      if (app.isPackaged) {
        Menu.setApplicationMenu(null)
      }

      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      )
      session.defaultSession.setPermissionCheckHandler(() => false)

      const handlers = {
        ...createAppHandlers({
          app,
          dialog,
          getMainWindow: () => mainWindow,
          runtime: {
            platform: process.platform,
            arch: process.arch,
            electronVersion: process.versions.electron,
          },
        }),
        ...createScanHandlers({ scanService, stat }),
        ...createDriveHandlers({ listDrives: listSystemDrives }),
      } satisfies IpcHandlerMap

      registerIpcHandlers(ipcMain, handlers, (event) =>
        isTrustedIpcSender(event, {
          mainWebContents: mainWindow?.webContents,
          isTrustedUrl,
        }),
      )

      mainWindow = createMainWindow({
        preloadPath,
        rendererRoot,
        devServerUrl,
        isQuitting: () => quitting,
        onRendererReload: () => scanService.cancelActive(),
      })
      mainWindow.on('closed', () => {
        mainWindow = null
      })
    })
    .catch(reportStartupError)
}
```

- [ ] **Step 9: Package koffi outside the asar and add the packaged check**

Append to `electron-builder.yml` (after the `electronFuses` block):

```yaml
# koffi (drive listing) is a native Node-API module; koffi 3 loads it from the optional package
# @koromix/koffi-win32-x64. Both stay outside app.asar so Windows can load koffi.node. Electron
# redirects require() of these paths inside app.asar to app.asar.unpacked. The onlyLoadAppFromAsar
# fuse only restricts where the app entry is loaded from, so this still works; the asar integrity
# fuse does not cover unpacked files. `npm run test:packaged` verifies the packaged app.
asarUnpack:
  - node_modules/koffi/**
  - node_modules/@koromix/koffi-win32-x64/**

# koffi ships prebuilt, ABI-stable Node-API binaries: nothing needs rebuilding for Electron.
npmRebuild: false
```

`scripts/check-packaged-app.mjs`:

```js
// Runs the packaged app with --self-test: koffi must load from app.asar.unpacked, at least one
// drive must be listed, and the scanner utilityProcess must complete a scan of the resources
// folder without walking into app.asar. Exit code 0 means pass (codes: src/main/self-test.ts).
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const { version, productName } = JSON.parse(readFileSync('package.json', 'utf8'))
const exe = path.resolve('release', version, 'win-unpacked', `${productName}.exe`)
if (!existsSync(exe)) {
  console.error(`Packaged app not found at ${exe}. Run "npm run dist" first.`)
  process.exit(1)
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const result = spawnSync(exe, ['--self-test'], { env, encoding: 'utf8', timeout: 120_000 })
if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
if (result.status !== 0) {
  console.error(`Packaged self-test failed with exit code ${result.status}.`)
  process.exit(1)
}
console.log('Packaged self-test passed: koffi loaded from app.asar.unpacked; the scanner ran.')
```

In `package.json`, add this script after `"dist"`:

```json
    "test:packaged": "node scripts/check-packaged-app.mjs"
```

In `eslint.config.mjs`, add `'scripts/**/*.mjs'` to the node-globals block's `files` list.

- [ ] **Step 10: Check the drive list in E2E**

In `e2e/app.spec.ts`, change the expected bridge keys to:

```ts
expect(keys).toEqual([
  'cancelScan',
  'getAppInfo',
  'listDrives',
  'onScanDone',
  'onScanFailed',
  'onScanProgress',
  'selectFolder',
  'startScan',
])
```

and add this test at the end of the file:

```ts
test('lists the system drive through koffi', async () => {
  const systemRoot = `${process.env['SystemDrive'] ?? 'C:'}\\`
  const drives = await page.evaluate(() =>
    (globalThis as unknown as { storageiq: StorageIQApi }).storageiq.listDrives(),
  )
  expect(drives).toContainEqual(expect.objectContaining({ root: systemRoot, kind: 'fixed' }))
  for (const drive of drives) expect(['fixed', 'removable']).toContain(drive.kind)
})
```

- [ ] **Step 11: Run the tests and quality gates**

```powershell
npx vitest run src/main
npm run format
npm run format:check
npm run lint
npm run typecheck
npm test
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm run test:e2e
```

Expected: `list-drives.test.ts` 6, `drive-handlers.test.ts` 2, `self-test.test.ts` 8, `register.test.ts` 6 tests pass; all unit tests pass; 8 E2E tests pass.

- [ ] **Step 12: Package and verify koffi loads from `app.asar.unpacked` (fuses on)**

```powershell
npm run dist
npx @electron/asar list release/0.1.0/win-unpacked/resources/app.asar | Select-String 'koffi' | Select-Object -First 5
Get-ChildItem release/0.1.0/win-unpacked/resources/app.asar.unpacked/node_modules/@koromix/koffi-win32-x64/win32_x64
npm run test:packaged
```

Expected: the asar listing shows `\node_modules\koffi\…` entries (the archive header still lists them, marked unpacked); `koffi.node` is listed in the `app.asar.unpacked` folder; `npm run test:packaged` prints `[self-test] drives: C:\ …`, `[self-test] scan: … files, … folders` and `Packaged self-test passed…`, and exits 0. If it exits 10, koffi did not load: confirm both `asarUnpack` globs and that `koffi` is under `dependencies` (not `devDependencies`) in `package.json`. If no `[self-test]` lines are printed but the exit code is 0, that is fine (stdout of a GUI-subsystem exe may not reach the pipe); the exit code is the contract.

- [ ] **Step 13: Commit**

```powershell
git add package.json package-lock.json electron-builder.yml eslint.config.mjs src/main/drives/drive-api.ts src/main/drives/list-drives.ts src/main/drives/list-drives.test.ts src/main/drives/koffi-drive-api.ts src/main/ipc/drive-handlers.ts src/main/ipc/drive-handlers.test.ts src/main/self-test.ts src/main/self-test.test.ts src/main/index.ts src/main/ipc/register.test.ts src/shared/ipc-contract.ts src/preload/index.ts src/renderer/src/test/fake-api.ts scripts/check-packaged-app.mjs e2e/app.spec.ts
git commit -m "feat(drives): list fixed and removable drives through koffi; packaged self-test" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Renderer — scan store and the pick, scanning, result and crash screens

**Implementer tier:** standard

**Exact UI copy (do not reword; typographic `’`, `…`, `—`):**

| Where              | Strings                                                                                                                                                                                                                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pick location      | h1 `See what’s filling your disk`; intro `Pick a drive or a folder. StorageIQ will show which folders take up the most space.`; list label `Drives`; card `<label> (<letter>)`, badge `USB`, `<free> free of <total>`; button `Choose folder…`; `Dismiss`                                                                                      |
| Pick-screen errors | `StorageIQ couldn’t open the folder picker. Please try again.`; `StorageIQ couldn’t start a scan of that location. Please choose another one.`; `StorageIQ can’t scan network locations. Please choose a drive or a folder on this PC.`; `StorageIQ couldn’t list your drives. You can still choose a folder.`                                 |
| Scanning           | h1 `Scanning`; stats `Files found`, `Folders found`, `Size found`, `Elapsed`; button `Cancel`; section `Largest folders so far`; empty `No folders found yet.`; live region `Scan started.` then `<files> files and <folders> folders found, <size> so far.`                                                                                   |
| Result             | h1 `Scan complete` or `Scan canceled — partial results`; stats `Total size`, `Files`, `Folders`, `Scan time`; section `Largest folders`; empty `This location has no folders.`; row `Everything else`; `1 folder couldn’t be read` / `<n> folders couldn’t be read`; `Showing the first <n>.`; buttons `Scan again`, `Choose another location` |
| Unreadable reasons | access-denied `Windows didn’t give StorageIQ permission to open it.`; path-too-long `Its path is too long for Windows to open.`; not-found `It was moved or deleted during the scan.`; other `Windows reported an error (<code>).`                                                                                                             |
| Crash              | h1 `The scan stopped unexpectedly. You can try again.`; buttons `Retry`, `Choose another location`                                                                                                                                                                                                                                             |
| Status bar         | `No folder selected` (or the scanned location); `StorageIQ <version>`                                                                                                                                                                                                                                                                          |

The spec fixes the cards, "Choose folder…", "Cancel", "Scan canceled — partial results", "Scan again", "Choose another location", "N folders couldn’t be read", "Everything else", the crash sentence and "Retry". The other strings (headings, stat labels, reasons, errors) are this plan's resolution of the spec's "plain-language" requirement.

Design rules applied (DESIGN.md): the accent stays reserved for the primary action and focus, so data bars are neutral (`bg-ink-muted` on a `bg-line` track); numbers use `tabular-nums`; paths use `font-mono text-[13px]`. The busy (`aria-disabled`) button keeps its resting colour on hover (carry-over 8) through the shared `Button` component.

**Files:**

- Create: `src/renderer/src/lib/format.ts`, `src/renderer/src/lib/use-throttled-announcement.ts`, `src/renderer/src/stores/scan-store.ts`, `src/renderer/src/stores/scan-store-context.tsx`, `src/renderer/src/components/Button.tsx`, `DriveCard.tsx`, `Stat.tsx`, `FolderBars.tsx`, `UnreadableList.tsx`, `PickLocationScreen.tsx`, `ScanningScreen.tsx`, `ResultScreen.tsx`, `CrashScreen.tsx` (all under `src/renderer/src/components/`), `src/renderer/src/test/render.tsx`, `src/renderer/src/test/scan-fixtures.ts`
- Modify: `src/renderer/src/stores/app-store.ts`, `src/renderer/src/components/StatusBar.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/main.tsx`, `DESIGN.md`, `e2e/app.spec.ts`
- Delete: `src/renderer/src/components/WelcomePanel.tsx`
- Test: `src/renderer/src/lib/format.test.ts`, `src/renderer/src/lib/use-throttled-announcement.test.tsx`, `src/renderer/src/stores/scan-store.test.ts`, `src/renderer/src/stores/scan-store-context.test.tsx`, `src/renderer/src/stores/app-store.test.ts` (rewrite), `src/renderer/src/stores/app-store-context.test.tsx` (one-line change), `src/renderer/src/components/Button.test.tsx`, `PickLocationScreen.test.tsx`, `ScanningScreen.test.tsx`, `ResultScreen.test.tsx`, `CrashScreen.test.tsx`, `src/renderer/src/App.test.tsx` (rewrite)

**Interfaces:**

- Consumes: `StorageIQApi` with `listDrives`, `startScan`, `cancelScan`, `onScanProgress`, `onScanDone`, `onScanFailed` (Tasks 2, 4, 5); `DriveInfo`, `FolderSummary`, `ScanError`, `ScanErrorReason`, `ScanProgress`, `ScanDone`, `ScanFailed`, `ScanStartResult` (Task 2); `createFakeApi`, `FakeApi`, `TEST_DRIVES`, `TEST_APP_INFO` (Tasks 2, 5).
- Produces:
  - `lib/format.ts`: `formatBytes(bytes)`, `formatCount(value)`, `formatDuration(ms)`, `percentOf(part, total)`, `formatPercent(fraction)`, `middleTruncate(text, maxLength)`
  - `lib/use-throttled-announcement.ts`: `ANNOUNCE_INTERVAL_MS = 5000`, `useThrottledAnnouncement(text, intervalMs): string`
  - `stores/app-store.ts`: `LoadStatus`, `AppState { appInfo; appInfoStatus; loadAppInfo() }`, `AppStore`, `createAppStore(api)` (folder-picking moves to the scan store)
  - `stores/scan-store.ts`: `ScanPhase = 'idle' | 'scanning' | 'done' | 'canceled' | 'failed'`, `ScanState { phase; drives; drivesStatus; target; scanId; progress; result; folderPickerOpen; errorMessage; loadDrives(); chooseFolder(); startScan(target); cancelScan(); rescan(); chooseAnotherLocation(); dismissError() }`, `ScanStore = StoreApi<ScanState> & { dispose(): void }`, `createScanStore(api): ScanStore`, `isNetworkPath(target)`, `FOLDER_PICKER_ERROR`, `START_SCAN_ERROR`, `NETWORK_PATH_ERROR`, `DRIVES_ERROR`
  - `stores/scan-store-context.tsx`: `ScanStoreProvider`, `useScanStore(selector)`
  - Components: `Button`, `BUTTON_VARIANT_CLASSES`, `DriveCard`, `Stat`, `FolderBars`, `EVERYTHING_ELSE`, `UnreadableList`, `REASON_TEXT`, `PickLocationScreen`, `ScanningScreen`, `ResultScreen`, `CrashScreen`, `StatusBar`
  - Test helpers: `renderWithStores(ui, api?)`, `makeProgress()`, `makeDone()`, `makeFailed()`

- [ ] **Step 1: Load design guidance** (see Global Constraints: `impeccable context`, `reference/craft-floor.md`, and the three `modern-web-guidance` searches). Record any guidance you apply in DESIGN.md in Step 15.

- [ ] **Step 2: Write the test helpers**

`src/renderer/src/test/scan-fixtures.ts`:

```ts
import type { ScanDone, ScanFailed, ScanProgress } from '@shared/scan-types'

const MB = 1024 ** 2
const GB = 1024 ** 3

export function makeProgress(overrides: Partial<ScanProgress> = {}): ScanProgress {
  return {
    scanId: 'scan-1',
    files: 420,
    folders: 17,
    bytes: 5 * MB,
    currentPath: 'D:\\Photos\\2024\\Summer',
    elapsedMs: 1500,
    topFolders: [
      {
        kind: 'folder',
        name: 'Photos',
        path: 'D:\\Photos',
        bytes: 5 * MB,
        files: 420,
        folders: 17,
      },
    ],
    ...overrides,
  }
}

export function makeDone(overrides: Partial<ScanDone> = {}): ScanDone {
  return {
    scanId: 'scan-1',
    status: 'complete',
    files: 1234,
    folders: 56,
    bytes: 3 * GB,
    elapsedMs: 12_400,
    topFolders: [
      { kind: 'folder', name: 'Videos', path: 'D:\\Videos', bytes: 2 * GB, files: 10, folders: 1 },
      {
        kind: 'folder',
        name: 'Photos',
        path: 'D:\\Photos',
        bytes: 768 * MB,
        files: 1000,
        folders: 50,
      },
      {
        kind: 'everything-else',
        name: 'Everything else',
        path: 'D:\\',
        bytes: 256 * MB,
        files: 224,
        folders: 3,
      },
    ],
    errors: [
      { path: 'D:\\System Volume Information', reason: 'access-denied', code: 'EPERM' },
      { path: 'D:\\Old\\Very\\Long\\Path', reason: 'path-too-long', code: 'ENAMETOOLONG' },
    ],
    errorCount: 2,
    ...overrides,
  }
}

export function makeFailed(overrides: Partial<ScanFailed> = {}): ScanFailed {
  return { scanId: 'scan-1', message: 'The scanner process stopped unexpectedly.', ...overrides }
}
```

`src/renderer/src/test/render.tsx`:

```tsx
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { createAppStore } from '../stores/app-store'
import { AppStoreProvider } from '../stores/app-store-context'
import { createScanStore } from '../stores/scan-store'
import { ScanStoreProvider } from '../stores/scan-store-context'
import { createFakeApi, type FakeApi } from './fake-api'

/** Renders `ui` inside both store providers, backed by a fake bridge. */
export function renderWithStores(ui: ReactElement, api: FakeApi = createFakeApi()) {
  const appStore = createAppStore(api)
  const scanStore = createScanStore(api)
  const result = render(
    <AppStoreProvider store={appStore}>
      <ScanStoreProvider store={scanStore}>{ui}</ScanStoreProvider>
    </AppStoreProvider>,
  )
  return { ...result, api, appStore, scanStore }
}
```

- [ ] **Step 3: Write the failing formatting and announcement tests**

`src/renderer/src/lib/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatCount,
  formatDuration,
  formatPercent,
  middleTruncate,
  percentOf,
} from './format'

describe('formatBytes', () => {
  it.each([
    [0, '0 bytes'],
    [1, '1 byte'],
    [1023, '1,023 bytes'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [150 * 1024, '150 KB'],
    [5 * 1024 ** 3, '5.0 GB'],
    [512 * 1024 ** 3, '512 GB'],
    [1.5 * 1024 ** 4, '1.5 TB'],
  ])('%d → %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text)
  })
})

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(1_234_567)).toBe('1,234,567')
  })
})

describe('formatDuration', () => {
  it.each([
    [0, '0.0 s'],
    [870, '0.9 s'],
    [9_940, '9.9 s'],
    [12_400, '12 s'],
    [59_400, '59 s'],
    [125_000, '2 min 05 s'],
    [3_725_000, '1 h 02 min'],
  ])('%d ms → %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text)
  })
})

describe('percentages', () => {
  it.each([
    [0, '0%'],
    [0.004, '<1%'],
    [256 / 3072, '8%'],
    [2 / 3, '67%'],
    [1, '100%'],
  ])('%f → %s', (fraction, text) => {
    expect(formatPercent(fraction)).toBe(text)
  })

  it('computes a share and treats an empty total as 0', () => {
    expect(percentOf(1, 4)).toBe(0.25)
    expect(percentOf(5, 0)).toBe(0)
  })
})

describe('middleTruncate', () => {
  it('keeps short text as is', () => {
    expect(middleTruncate('C:\\Data', 20)).toBe('C:\\Data')
  })

  it('keeps the start and the end around an ellipsis', () => {
    expect(middleTruncate('abcdefghijklmnopqrstuvwxyz', 10)).toBe('abcde…wxyz')
  })
})
```

`src/renderer/src/lib/use-throttled-announcement.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ANNOUNCE_INTERVAL_MS, useThrottledAnnouncement } from './use-throttled-announcement'

afterEach(() => {
  vi.useRealTimers()
})

describe('useThrottledAnnouncement', () => {
  it('shows the first text at once, then the latest text at most every 5 seconds', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ text }) => useThrottledAnnouncement(text, ANNOUNCE_INTERVAL_MS),
      { initialProps: { text: 'first' } },
    )
    expect(ANNOUNCE_INTERVAL_MS).toBe(5_000)
    expect(result.current).toBe('first')

    rerender({ text: 'second' })
    rerender({ text: 'third' })
    act(() => {
      vi.advanceTimersByTime(4_999)
    })
    expect(result.current).toBe('first')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe('third')
  })

  it('stops its timer when unmounted', () => {
    vi.useFakeTimers()
    const { unmount } = renderHook(() => useThrottledAnnouncement('text', ANNOUNCE_INTERVAL_MS))
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
```

- [ ] **Step 4: Write the failing store tests**

`src/renderer/src/stores/scan-store.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { SelectFolderResult } from '@shared/ipc-contract'
import type { ScanStartResult } from '@shared/scan-types'
import { createFakeApi, TEST_DRIVES } from '../test/fake-api'
import { makeDone, makeFailed, makeProgress } from '../test/scan-fixtures'
import {
  createScanStore,
  FOLDER_PICKER_ERROR,
  NETWORK_PATH_ERROR,
  START_SCAN_ERROR,
} from './scan-store'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

async function scanning(api = createFakeApi()) {
  const store = createScanStore(api)
  await store.getState().startScan('D:\\')
  return { api, store }
}

describe('createScanStore', () => {
  it('starts idle and subscribes to the three scan events', () => {
    const api = createFakeApi()
    const store = createScanStore(api)
    expect(store.getState()).toMatchObject({
      phase: 'idle',
      drives: [],
      drivesStatus: 'idle',
      target: null,
      scanId: null,
      progress: null,
      result: null,
      folderPickerOpen: false,
      errorMessage: null,
    })
    expect(api.listenerCount()).toBe(3)
  })

  describe('loadDrives', () => {
    it('loads the drives', async () => {
      const store = createScanStore(createFakeApi())
      await store.getState().loadDrives()
      expect(store.getState()).toMatchObject({ drives: TEST_DRIVES, drivesStatus: 'ready' })
    })

    it('marks the list as failed when the drives cannot be listed', async () => {
      const api = createFakeApi({ listDrives: vi.fn().mockRejectedValue(new Error('koffi')) })
      const store = createScanStore(api)
      await store.getState().loadDrives()
      expect(store.getState().drivesStatus).toBe('error')
    })
  })

  describe('a scan', () => {
    it('starts and keeps its id', async () => {
      const { api, store } = await scanning()
      expect(api.startScan).toHaveBeenCalledWith('D:\\')
      expect(store.getState()).toMatchObject({
        phase: 'scanning',
        target: 'D:\\',
        scanId: 'scan-1',
      })
    })

    it('applies progress of its own scan and ignores other scans', async () => {
      const { api, store } = await scanning()
      api.emitScanProgress(makeProgress({ scanId: 'other' }))
      expect(store.getState().progress).toBeNull()
      api.emitScanProgress(makeProgress())
      expect(store.getState().progress).toEqual(makeProgress())
    })

    it('shows the result when the scan completes', async () => {
      const { api, store } = await scanning()
      api.emitScanProgress(makeProgress())
      api.emitScanDone(makeDone())
      expect(store.getState()).toMatchObject({ phase: 'done', result: makeDone(), progress: null })
    })

    it('treats a canceled scan as partial results', async () => {
      const { api, store } = await scanning()
      api.emitScanDone(makeDone({ status: 'canceled' }))
      expect(store.getState().phase).toBe('canceled')
    })

    it('moves to the failed state when the scanner crashes', async () => {
      const { api, store } = await scanning()
      api.emitScanFailed(makeFailed())
      expect(store.getState().phase).toBe('failed')
    })

    it('replays events that arrive before scan:start returns', async () => {
      const pending = deferred<ScanStartResult>()
      const api = createFakeApi({ startScan: vi.fn(() => pending.promise) })
      const store = createScanStore(api)

      const starting = store.getState().startScan('D:\\')
      api.emitScanProgress(makeProgress())
      api.emitScanDone(makeDone())
      expect(store.getState().phase).toBe('scanning')
      pending.resolve({ scanId: 'scan-1' })
      await starting

      expect(store.getState()).toMatchObject({ phase: 'done', result: makeDone() })
    })

    it('asks main to cancel the running scan', async () => {
      const { api, store } = await scanning()
      await store.getState().cancelScan()
      expect(api.cancelScan).toHaveBeenCalledWith('scan-1')
    })

    it('cancels as soon as the id is known when Cancel comes first', async () => {
      const pending = deferred<ScanStartResult>()
      const api = createFakeApi({ startScan: vi.fn(() => pending.promise) })
      const store = createScanStore(api)

      const starting = store.getState().startScan('D:\\')
      await store.getState().cancelScan()
      expect(api.cancelScan).not.toHaveBeenCalled()
      pending.resolve({ scanId: 'scan-7' })
      await starting

      expect(api.cancelScan).toHaveBeenCalledWith('scan-7')
    })

    it('returns to the start with an error when the scan cannot start', async () => {
      const api = createFakeApi({ startScan: vi.fn().mockRejectedValue(new Error('Invalid')) })
      const store = createScanStore(api)
      await store.getState().startScan('D:\\Gone')
      expect(store.getState()).toMatchObject({ phase: 'idle', errorMessage: START_SCAN_ERROR })
    })

    it('refuses network paths without asking main', async () => {
      const api = createFakeApi()
      const store = createScanStore(api)
      await store.getState().startScan('\\\\server\\share')
      expect(api.startScan).not.toHaveBeenCalled()
      expect(store.getState()).toMatchObject({ phase: 'idle', errorMessage: NETWORK_PATH_ERROR })
    })

    it('ignores scan events when no scan is running', () => {
      const api = createFakeApi()
      const store = createScanStore(api)
      api.emitScanDone(makeDone())
      expect(store.getState()).toMatchObject({ phase: 'idle', result: null })
    })
  })

  describe('chooseFolder', () => {
    it('scans the folder the user picked', async () => {
      const api = createFakeApi({
        selectFolder: vi.fn().mockResolvedValue({ canceled: false, path: 'D:\\Projects' }),
      })
      const store = createScanStore(api)
      await store.getState().chooseFolder()
      expect(api.startScan).toHaveBeenCalledWith('D:\\Projects')
      expect(store.getState()).toMatchObject({ phase: 'scanning', folderPickerOpen: false })
    })

    it('stays on the start screen when the user cancels the picker', async () => {
      const api = createFakeApi()
      const store = createScanStore(api)
      await store.getState().chooseFolder()
      expect(api.startScan).not.toHaveBeenCalled()
      expect(store.getState()).toMatchObject({ phase: 'idle', folderPickerOpen: false })
    })

    it('shows a friendly error when the picker fails, and can dismiss it', async () => {
      const api = createFakeApi({ selectFolder: vi.fn().mockRejectedValue(new Error('IPC down')) })
      const store = createScanStore(api)
      await store.getState().chooseFolder()
      expect(store.getState()).toMatchObject({
        folderPickerOpen: false,
        errorMessage: FOLDER_PICKER_ERROR,
      })
      store.getState().dismissError()
      expect(store.getState().errorMessage).toBeNull()
    })

    it('ignores a second request while the picker is open', async () => {
      const pending = deferred<SelectFolderResult>()
      const api = createFakeApi({ selectFolder: vi.fn(() => pending.promise) })
      const store = createScanStore(api)

      const first = store.getState().chooseFolder()
      expect(store.getState().folderPickerOpen).toBe(true)
      await store.getState().chooseFolder()
      pending.resolve({ canceled: true })
      await first

      expect(api.selectFolder).toHaveBeenCalledTimes(1)
    })
  })

  describe('after a scan', () => {
    it('rescan scans the same location again', async () => {
      const { api, store } = await scanning()
      api.emitScanDone(makeDone())
      await store.getState().rescan()
      expect(api.startScan).toHaveBeenCalledTimes(2)
      expect(api.startScan).toHaveBeenLastCalledWith('D:\\')
      expect(store.getState().phase).toBe('scanning')
    })

    it('chooseAnotherLocation returns to the start screen', async () => {
      const { api, store } = await scanning()
      api.emitScanDone(makeDone())
      store.getState().chooseAnotherLocation()
      expect(store.getState()).toMatchObject({ phase: 'idle', result: null, target: 'D:\\' })
    })
  })

  it('dispose unsubscribes from every event', () => {
    const api = createFakeApi()
    const store = createScanStore(api)
    store.dispose()
    expect(api.listenerCount()).toBe(0)
  })
})
```

`src/renderer/src/stores/scan-store-context.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useScanStore } from './scan-store-context'

function Probe() {
  useScanStore((s) => s.phase)
  return null
}

describe('useScanStore', () => {
  it('throws outside <ScanStoreProvider>', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => render(<Probe />)).toThrow('useScanStore must be used inside <ScanStoreProvider>')
    consoleError.mockRestore()
  })
})
```

`src/renderer/src/stores/app-store.test.ts` (full file; includes carry-over 6):

```ts
import { describe, expect, it, vi } from 'vitest'
import type { AppInfo } from '@shared/ipc-contract'
import { createFakeApi, TEST_APP_INFO } from '../test/fake-api'
import { createAppStore } from './app-store'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('createAppStore', () => {
  it('starts idle', () => {
    expect(createAppStore(createFakeApi()).getState()).toMatchObject({
      appInfo: null,
      appInfoStatus: 'idle',
    })
  })

  describe('loadAppInfo', () => {
    it('stores the app info and becomes ready', async () => {
      const store = createAppStore(createFakeApi())
      await store.getState().loadAppInfo()
      expect(store.getState()).toMatchObject({ appInfo: TEST_APP_INFO, appInfoStatus: 'ready' })
    })

    it('marks an error when the main process fails', async () => {
      const api = createFakeApi({ getAppInfo: vi.fn().mockRejectedValue(new Error('boom')) })
      const store = createAppStore(api)
      await store.getState().loadAppInfo()
      expect(store.getState()).toMatchObject({ appInfo: null, appInfoStatus: 'error' })
    })

    it('requests the info only once while a request is in flight or done', async () => {
      const pending = deferred<AppInfo>()
      const api = createFakeApi({ getAppInfo: vi.fn(() => pending.promise) })
      const store = createAppStore(api)

      const first = store.getState().loadAppInfo()
      void store.getState().loadAppInfo()
      pending.resolve(TEST_APP_INFO)
      await first
      await store.getState().loadAppInfo()

      expect(api.getAppInfo).toHaveBeenCalledTimes(1)
    })

    it('retries after an error (roadmap carry-over 6)', async () => {
      const getAppInfo = vi
        .fn<() => Promise<AppInfo>>()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(TEST_APP_INFO)
      const store = createAppStore(createFakeApi({ getAppInfo }))

      await store.getState().loadAppInfo()
      expect(store.getState().appInfoStatus).toBe('error')
      await store.getState().loadAppInfo()

      expect(getAppInfo).toHaveBeenCalledTimes(2)
      expect(store.getState()).toMatchObject({ appInfo: TEST_APP_INFO, appInfoStatus: 'ready' })
    })
  })
})
```

In `src/renderer/src/stores/app-store-context.test.tsx`, change the probe's selector from `(s) => s.scanTarget` to `(s) => s.appInfo`.

- [ ] **Step 5: Run the tests and confirm they fail**

Run (PowerShell): `npx vitest run src/renderer/src/lib src/renderer/src/stores`
Expected: FAIL. `./format`, `./use-throttled-announcement`, `./scan-store` and `./scan-store-context` cannot be resolved.

- [ ] **Step 6: Implement the formatting helpers and the announcement hook**

`src/renderer/src/lib/format.ts`:

```ts
const UNITS = ['KB', 'MB', 'GB', 'TB', 'PB'] as const
const countFormat = new Intl.NumberFormat('en-US')

export function formatCount(value: number): string {
  return countFormat.format(value)
}

/** Windows-style sizes: 1024-based, `bytes` below 1 KB, one decimal below 100. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes === 1 ? '1 byte' : `${formatCount(bytes)} bytes`
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value < 100 ? 1 : 0)} ${UNITS[unit] ?? 'PB'}`
}

export function formatDuration(ms: number): string {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds} s`
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 60) return `${minutes} min ${String(totalSeconds % 60).padStart(2, '0')} s`
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`
}

export function percentOf(part: number, total: number): number {
  return total > 0 ? part / total : 0
}

export function formatPercent(fraction: number): string {
  if (fraction > 0 && fraction < 0.005) return '<1%'
  return `${Math.round(fraction * 100)}%`
}

/** Shortens long paths in the middle so both the drive and the file name stay visible. */
export function middleTruncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  const keep = maxLength - 1
  const head = Math.ceil(keep / 2)
  const tail = Math.floor(keep / 2)
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`
}
```

`src/renderer/src/lib/use-throttled-announcement.ts`:

```ts
import { useEffect, useRef, useState } from 'react'

/** Screen-reader progress is announced at most this often (spec §1). */
export const ANNOUNCE_INTERVAL_MS = 5_000

/**
 * Returns `text` for an `aria-live` region, updated at most once per `intervalMs`, so frequent
 * progress updates never flood a screen reader.
 */
export function useThrottledAnnouncement(text: string, intervalMs: number): string {
  const [announced, setAnnounced] = useState(text)
  const latest = useRef(text)

  useEffect(() => {
    latest.current = text
  }, [text])

  useEffect(() => {
    const timer = setInterval(() => setAnnounced(latest.current), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return announced
}
```

- [ ] **Step 7: Implement the stores**

`src/renderer/src/stores/app-store.ts` (full file):

```ts
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { AppInfo, StorageIQApi } from '@shared/ipc-contract'

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface AppState {
  appInfo: AppInfo | null
  appInfoStatus: LoadStatus
  loadAppInfo(): Promise<void>
}

export type AppStore = StoreApi<AppState>

export function createAppStore(api: StorageIQApi): AppStore {
  return createStore<AppState>()((set, get) => ({
    appInfo: null,
    appInfoStatus: 'idle',

    async loadAppInfo() {
      const status = get().appInfoStatus
      if (status === 'loading' || status === 'ready') return
      set({ appInfoStatus: 'loading' })
      try {
        const appInfo = await api.getAppInfo()
        set({ appInfo, appInfoStatus: 'ready' })
      } catch {
        set({ appInfoStatus: 'error' })
      }
    },
  }))
}
```

`src/renderer/src/stores/scan-store.ts`:

```ts
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { StorageIQApi } from '@shared/ipc-contract'
import type {
  DriveInfo,
  ScanDone,
  ScanFailed,
  ScanProgress,
  ScanStartResult,
} from '@shared/scan-types'
import type { LoadStatus } from './app-store'

/** `idle → scanning → done | canceled | failed`; any end state can scan again. */
export type ScanPhase = 'idle' | 'scanning' | 'done' | 'canceled' | 'failed'

export interface ScanState {
  phase: ScanPhase
  drives: DriveInfo[]
  drivesStatus: LoadStatus
  /** The drive root or folder being scanned, or scanned last. */
  target: string | null
  /** Known once `scan:start` returns. */
  scanId: string | null
  progress: ScanProgress | null
  result: ScanDone | null
  folderPickerOpen: boolean
  /** Plain-language problem shown on the pick-location screen. */
  errorMessage: string | null
  loadDrives(): Promise<void>
  chooseFolder(): Promise<void>
  startScan(target: string): Promise<void>
  cancelScan(): Promise<void>
  /** "Scan again" and "Retry": scan the same location again. */
  rescan(): Promise<void>
  /** "Choose another location": back to the pick-location screen. */
  chooseAnotherLocation(): void
  dismissError(): void
}

export type ScanStore = StoreApi<ScanState> & { dispose(): void }

export const FOLDER_PICKER_ERROR = 'StorageIQ couldn’t open the folder picker. Please try again.'
export const START_SCAN_ERROR =
  'StorageIQ couldn’t start a scan of that location. Please choose another one.'
export const NETWORK_PATH_ERROR =
  'StorageIQ can’t scan network locations. Please choose a drive or a folder on this PC.'
export const DRIVES_ERROR = 'StorageIQ couldn’t list your drives. You can still choose a folder.'

type ScanEvent =
  | { kind: 'progress'; payload: ScanProgress }
  | { kind: 'done'; payload: ScanDone }
  | { kind: 'failed'; payload: ScanFailed }

export function isNetworkPath(target: string): boolean {
  return target.startsWith('\\\\') || target.startsWith('//')
}

export function createScanStore(api: StorageIQApi): ScanStore {
  /** Events that arrived while `scan:start` was still in flight (scan ID not known yet). */
  let early: ScanEvent[] = []
  let cancelWhenStarted = false

  const store = createStore<ScanState>()((set, get) => ({
    phase: 'idle',
    drives: [],
    drivesStatus: 'idle',
    target: null,
    scanId: null,
    progress: null,
    result: null,
    folderPickerOpen: false,
    errorMessage: null,

    async loadDrives() {
      if (get().drivesStatus === 'loading') return
      set({ drivesStatus: 'loading' })
      try {
        const drives = await api.listDrives()
        set({ drives, drivesStatus: 'ready' })
      } catch {
        set({ drivesStatus: 'error' })
      }
    },

    async chooseFolder() {
      if (get().folderPickerOpen) return
      set({ folderPickerOpen: true, errorMessage: null })
      let picked: string | null
      try {
        const result = await api.selectFolder()
        picked = result.canceled ? null : result.path
      } catch {
        set({ folderPickerOpen: false, errorMessage: FOLDER_PICKER_ERROR })
        return
      }
      set({ folderPickerOpen: false })
      if (picked !== null) await get().startScan(picked)
    },

    async startScan(target) {
      if (get().phase === 'scanning') return
      if (isNetworkPath(target)) {
        set({ errorMessage: NETWORK_PATH_ERROR })
        return
      }
      early = []
      cancelWhenStarted = false
      set({
        phase: 'scanning',
        target,
        scanId: null,
        progress: null,
        result: null,
        errorMessage: null,
      })
      let started: ScanStartResult
      try {
        started = await api.startScan(target)
      } catch {
        set({ phase: 'idle', errorMessage: START_SCAN_ERROR })
        return
      }
      set({ scanId: started.scanId })
      const pending = early
      early = []
      for (const event of pending) applyEvent(event)
      if (cancelWhenStarted && get().phase === 'scanning') {
        await api.cancelScan(started.scanId).catch(() => undefined)
      }
    },

    async cancelScan() {
      const { phase, scanId } = get()
      if (phase !== 'scanning') return
      if (scanId === null) {
        cancelWhenStarted = true
        return
      }
      try {
        await api.cancelScan(scanId)
      } catch {
        // The scan goes on; its done or failed event still arrives.
      }
    },

    async rescan() {
      const { target } = get()
      if (target !== null) await get().startScan(target)
    },

    chooseAnotherLocation() {
      if (get().phase === 'scanning') return
      set({ phase: 'idle', scanId: null, progress: null, result: null, errorMessage: null })
    },

    dismissError() {
      set({ errorMessage: null })
    },
  }))

  function applyEvent(event: ScanEvent): void {
    const { phase, scanId } = store.getState()
    if (phase !== 'scanning') return
    if (scanId === null) {
      early.push(event)
      return
    }
    if (event.payload.scanId !== scanId) return
    if (event.kind === 'progress') {
      store.setState({ progress: event.payload })
    } else if (event.kind === 'done') {
      store.setState({
        phase: event.payload.status === 'complete' ? 'done' : 'canceled',
        result: event.payload,
        progress: null,
      })
    } else {
      store.setState({ phase: 'failed', progress: null })
    }
  }

  const unsubscribers = [
    api.onScanProgress((payload) => applyEvent({ kind: 'progress', payload })),
    api.onScanDone((payload) => applyEvent({ kind: 'done', payload })),
    api.onScanFailed((payload) => applyEvent({ kind: 'failed', payload })),
  ]

  return Object.assign(store, {
    dispose() {
      for (const unsubscribe of unsubscribers) unsubscribe()
    },
  })
}
```

`src/renderer/src/stores/scan-store-context.tsx`:

```tsx
import { createContext, type ReactNode, useContext } from 'react'
import { useStore } from 'zustand'
import type { ScanState, ScanStore } from './scan-store'

const ScanStoreContext = createContext<ScanStore | null>(null)

export function ScanStoreProvider({ store, children }: { store: ScanStore; children: ReactNode }) {
  return <ScanStoreContext.Provider value={store}>{children}</ScanStoreContext.Provider>
}

/**
 * Subscribe to a slice of the scan store. The selector must return a primitive or a stable
 * reference; returning a fresh object or array every call makes React re-render in a loop.
 */
export function useScanStore<T>(selector: (state: ScanState) => T): T {
  const store = useContext(ScanStoreContext)
  if (!store) {
    throw new Error('useScanStore must be used inside <ScanStoreProvider>')
  }
  return useStore(store, selector)
}
```

- [ ] **Step 8: Run the store and helper tests**

Run (PowerShell): `npx vitest run src/renderer/src/lib src/renderer/src/stores`
Expected: PASS — `format.test.ts` 25, `use-throttled-announcement.test.tsx` 2, `scan-store.test.ts` 21, `scan-store-context.test.tsx` 1, `app-store.test.ts` 5, `app-store-context.test.tsx` 1.

- [ ] **Step 9: Write the failing component tests**

`src/renderer/src/components/Button.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button, BUTTON_VARIANT_CLASSES } from './Button'

describe('<Button />', () => {
  it('runs its action when not busy', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Scan again</Button>)
    await user.click(screen.getByRole('button', { name: 'Scan again' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('when busy, stays focusable, is announced as unavailable and ignores clicks', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button busy onClick={onClick}>
        Choose folder…
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Choose folder…' })
    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    expect(button).toHaveFocus()
  })

  it('keeps the resting colour on hover while busy (roadmap carry-over 8)', () => {
    expect(BUTTON_VARIANT_CLASSES.primary).toContain('aria-disabled:hover:bg-accent')
    expect(BUTTON_VARIANT_CLASSES.secondary).toContain('aria-disabled:hover:bg-panel')
    render(<Button busy>Busy</Button>)
    expect(screen.getByRole('button', { name: 'Busy' }).className).toContain(
      'aria-disabled:hover:bg-accent',
    )
  })
})
```

`src/renderer/src/components/PickLocationScreen.test.tsx`:

```tsx
// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SelectFolderResult } from '@shared/ipc-contract'
import { DRIVES_ERROR, FOLDER_PICKER_ERROR } from '../stores/scan-store'
import { createFakeApi } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { PickLocationScreen } from './PickLocationScreen'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('<PickLocationScreen />', () => {
  it('shows one card per drive with its label, letter and free space', async () => {
    renderWithStores(<PickLocationScreen />)
    const fixed = await screen.findByRole('button', { name: /^Local Disk \(C:\)/ })
    const usb = screen.getByRole('button', { name: /^Photos \(E:\)/ })

    expect(
      screen.getByRole('heading', { level: 1, name: 'See what’s filling your disk' }),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('list', { name: 'Drives' })).getAllByRole('button'),
    ).toHaveLength(2)
    expect(fixed).toHaveTextContent('128 GB free of 512 GB')
    expect(fixed).not.toHaveTextContent('USB')
    expect(usb).toHaveTextContent('USB')
    expect(usb).toHaveTextContent('16.0 GB free of 64.0 GB')
  })

  it('starts a scan of the drive the user clicks', async () => {
    const user = userEvent.setup()
    const { api } = renderWithStores(<PickLocationScreen />)
    await user.click(await screen.findByRole('button', { name: /^Photos \(E:\)/ }))
    expect(api.startScan).toHaveBeenCalledWith('E:\\')
  })

  it('scans the folder chosen with "Choose folder…"', async () => {
    const user = userEvent.setup()
    const api = createFakeApi({
      selectFolder: vi.fn().mockResolvedValue({ canceled: false, path: 'D:\\Projects' }),
    })
    renderWithStores(<PickLocationScreen />, api)
    await user.click(screen.getByRole('button', { name: 'Choose folder…' }))
    await waitFor(() => expect(api.startScan).toHaveBeenCalledWith('D:\\Projects'))
  })

  it('explains when the drives cannot be listed and still offers a folder', async () => {
    renderWithStores(
      <PickLocationScreen />,
      createFakeApi({ listDrives: vi.fn().mockRejectedValue(new Error('koffi')) }),
    )
    expect(await screen.findByText(DRIVES_ERROR)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose folder…' })).toBeInTheDocument()
  })

  it('keeps "Choose folder…" focusable but inert while the picker is open', async () => {
    const user = userEvent.setup()
    const pending = deferred<SelectFolderResult>()
    const api = createFakeApi({ selectFolder: vi.fn(() => pending.promise) })
    renderWithStores(<PickLocationScreen />, api)

    const button = screen.getByRole('button', { name: 'Choose folder…' })
    await user.click(button)
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    expect(button).toHaveFocus()
    await user.click(button)
    expect(api.selectFolder).toHaveBeenCalledTimes(1)

    pending.resolve({ canceled: true })
    await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'))
  })

  it('shows a dismissible error when the folder picker fails, then refocuses the button', async () => {
    const user = userEvent.setup()
    renderWithStores(
      <PickLocationScreen />,
      createFakeApi({ selectFolder: vi.fn().mockRejectedValue(new Error('IPC down')) }),
    )
    await user.click(screen.getByRole('button', { name: 'Choose folder…' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(FOLDER_PICKER_ERROR)

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose folder…' })).toHaveFocus()
  })
})
```

`src/renderer/src/components/ScanningScreen.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeApi } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { makeProgress } from '../test/scan-fixtures'
import { ScanningScreen } from './ScanningScreen'

async function renderScanning() {
  const utils = renderWithStores(<ScanningScreen />, createFakeApi())
  await act(() => utils.scanStore.getState().startScan('D:\\'))
  return utils
}

function stat(label: string) {
  return screen.getByText(label, { selector: 'dt' }).nextElementSibling
}

afterEach(() => {
  vi.useRealTimers()
})

describe('<ScanningScreen />', () => {
  it('focuses Cancel and shows what has been found so far', async () => {
    const { api } = await renderScanning()
    act(() => api.emitScanProgress(makeProgress()))

    expect(screen.getByRole('heading', { level: 1, name: 'Scanning' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(stat('Files found')).toHaveTextContent('420')
    expect(stat('Folders found')).toHaveTextContent('17')
    expect(stat('Size found')).toHaveTextContent('5.0 MB')
    expect(stat('Elapsed')).toHaveTextContent('1.5 s')
    expect(screen.getByText('D:\\Photos\\2024\\Summer')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Largest folders so far' })).toHaveTextContent(
      'Photos',
    )
  })

  it('middle-truncates a long current path and keeps the full path as a tooltip', async () => {
    const { api } = await renderScanning()
    const longPath = `D:\\${'Very Long Folder Name\\'.repeat(6)}photo.jpg`
    act(() => api.emitScanProgress(makeProgress({ currentPath: longPath })))

    const shown = screen.getByTitle(longPath)
    expect(shown.textContent).toHaveLength(80)
    expect(shown.textContent).toContain('…')
    expect(shown.textContent?.endsWith('photo.jpg')).toBe(true)
  })

  it('asks main to cancel when Cancel is pressed', async () => {
    const user = userEvent.setup()
    const { api } = await renderScanning()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.cancelScan).toHaveBeenCalledWith('scan-1')
  })

  it('announces progress to screen readers at most every 5 seconds', async () => {
    vi.useFakeTimers()
    const { api, container } = await renderScanning()
    const live = container.querySelector('[aria-live="polite"]')
    expect(live).toHaveTextContent('Scan started.')

    act(() => api.emitScanProgress(makeProgress()))
    expect(live).toHaveTextContent('Scan started.')
    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    expect(live).toHaveTextContent('420 files and 17 folders found, 5.0 MB so far.')

    act(() => api.emitScanProgress(makeProgress({ files: 999 })))
    act(() => {
      vi.advanceTimersByTime(4_999)
    })
    expect(live).toHaveTextContent('420 files')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(live).toHaveTextContent('999 files')
  })
})
```

`src/renderer/src/components/ResultScreen.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { ScanDone } from '@shared/scan-types'
import { createFakeApi } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { makeDone } from '../test/scan-fixtures'
import { ResultScreen } from './ResultScreen'

async function renderResult(overrides: Partial<ScanDone> = {}) {
  const api = createFakeApi()
  const utils = renderWithStores(<ResultScreen />, api)
  await act(() => utils.scanStore.getState().startScan('D:\\'))
  act(() => api.emitScanDone(makeDone(overrides)))
  return utils
}

function stat(label: string) {
  return screen.getByText(label, { selector: 'dt' }).nextElementSibling
}

describe('<ResultScreen />', () => {
  it('summarises a complete scan and moves focus to its heading', async () => {
    await renderResult()
    const heading = screen.getByRole('heading', { level: 1, name: 'Scan complete' })
    expect(heading).toHaveFocus()
    expect(screen.getByText('D:\\')).toBeInTheDocument()
    expect(stat('Total size')).toHaveTextContent('3.0 GB')
    expect(stat('Total size')).toHaveAttribute('title', '3,221,225,472 bytes')
    expect(stat('Files')).toHaveTextContent('1,234')
    expect(stat('Folders')).toHaveTextContent('56')
    expect(stat('Scan time')).toHaveTextContent('12 s')
  })

  it('lists the largest folders with their share of the total', async () => {
    await renderResult()
    const items = screen.getByRole('region', { name: 'Largest folders' }).querySelectorAll('li')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('Videos')
    expect(items[0]).toHaveTextContent('2.0 GB')
    expect(items[0]).toHaveTextContent('67%')
    expect(items[2]).toHaveTextContent('Everything else')
    expect(items[2]).toHaveTextContent('256 MB')
    expect(items[2]).toHaveTextContent('8%')
  })

  it('lists folders that could not be read, with plain-language reasons', async () => {
    await renderResult()
    expect(screen.getByText('2 folders couldn’t be read')).toBeInTheDocument()
    expect(screen.getByText('D:\\System Volume Information')).toBeInTheDocument()
    expect(
      screen.getByText('Windows didn’t give StorageIQ permission to open it.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Its path is too long for Windows to open.')).toBeInTheDocument()
  })

  it('uses singular wording for one unreadable folder', async () => {
    await renderResult({
      errors: [{ path: 'D:\\Locked', reason: 'other', code: 'EBUSY' }],
      errorCount: 1,
    })
    expect(screen.getByText('1 folder couldn’t be read')).toBeInTheDocument()
    expect(screen.getByText('Windows reported an error (EBUSY).')).toBeInTheDocument()
  })

  it('shows no list when every folder was read', async () => {
    await renderResult({ errors: [], errorCount: 0 })
    expect(screen.queryByText(/couldn’t be read/)).not.toBeInTheDocument()
  })

  it('says when only the first unreadable folders are listed', async () => {
    await renderResult({ errorCount: 1500 })
    expect(screen.getByText('1,500 folders couldn’t be read')).toBeInTheDocument()
    expect(screen.getByText('Showing the first 2.')).toBeInTheDocument()
  })

  it('labels a canceled scan as partial results', async () => {
    await renderResult({ status: 'canceled' })
    expect(
      screen.getByRole('heading', { level: 1, name: 'Scan canceled — partial results' }),
    ).toBeInTheDocument()
  })

  it('"Scan again" scans the same location', async () => {
    const user = userEvent.setup()
    const { api } = await renderResult()
    await user.click(screen.getByRole('button', { name: 'Scan again' }))
    expect(api.startScan).toHaveBeenCalledTimes(2)
    expect(api.startScan).toHaveBeenLastCalledWith('D:\\')
  })

  it('"Choose another location" goes back to the start', async () => {
    const user = userEvent.setup()
    const { scanStore } = await renderResult()
    await user.click(screen.getByRole('button', { name: 'Choose another location' }))
    expect(scanStore.getState().phase).toBe('idle')
  })
})
```

`src/renderer/src/components/CrashScreen.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeApi } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { makeFailed } from '../test/scan-fixtures'
import { CrashScreen } from './CrashScreen'

async function renderCrash() {
  const api = createFakeApi()
  const utils = renderWithStores(<CrashScreen />, api)
  await act(() => utils.scanStore.getState().startScan('D:\\'))
  act(() => api.emitScanFailed(makeFailed()))
  return utils
}

describe('<CrashScreen />', () => {
  it('explains the crash and focuses Retry', async () => {
    await renderCrash()
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'The scan stopped unexpectedly. You can try again.',
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveFocus()
  })

  it('Retry scans the same location again', async () => {
    const user = userEvent.setup()
    const { api } = await renderCrash()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(api.startScan).toHaveBeenCalledTimes(2)
    expect(api.startScan).toHaveBeenLastCalledWith('D:\\')
  })
})
```

`src/renderer/src/App.test.tsx` (full file):

```tsx
// @vitest-environment jsdom
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { TEST_APP_INFO } from './test/fake-api'
import { renderWithStores } from './test/render'
import { makeDone, makeFailed, makeProgress } from './test/scan-fixtures'

describe('<App />', () => {
  it('opens on the pick-location screen and shows the version from main', async () => {
    renderWithStores(<App />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'See what’s filling your disk' }),
    ).toBeInTheDocument()
    expect(screen.getByText('No folder selected')).toBeInTheDocument()
    expect(await screen.findByText(`StorageIQ ${TEST_APP_INFO.version}`)).toBeInTheDocument()
  })

  it('goes from a drive to the scanning screen to the result', async () => {
    const user = userEvent.setup()
    const { api } = renderWithStores(<App />)

    await user.click(await screen.findByRole('button', { name: /^Local Disk \(C:\)/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Scanning' })).toBeInTheDocument()

    act(() => api.emitScanProgress(makeProgress()))
    act(() => api.emitScanDone(makeDone()))

    expect(screen.getByRole('heading', { level: 1, name: 'Scan complete' })).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toHaveTextContent('C:\\')
  })

  it('shows the crash screen when the scanner fails, and Retry scans again', async () => {
    const user = userEvent.setup()
    const { api } = renderWithStores(<App />)

    await user.click(await screen.findByRole('button', { name: /^Local Disk \(C:\)/ }))
    await screen.findByRole('heading', { level: 1, name: 'Scanning' })
    act(() => api.emitScanFailed(makeFailed()))

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'The scan stopped unexpectedly. You can try again.',
      }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(api.startScan).toHaveBeenCalledTimes(2)
    expect(await screen.findByRole('heading', { level: 1, name: 'Scanning' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 10: Run the tests and confirm they fail**

Run (PowerShell): `npx vitest run src/renderer`
Expected: FAIL. The new components (`./Button`, `./PickLocationScreen`, `./ScanningScreen`, `./ResultScreen`, `./CrashScreen`) cannot be resolved.

- [ ] **Step 11: Implement the shared components**

`src/renderer/src/components/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes, Ref } from 'react'

export type ButtonVariant = 'primary' | 'secondary'

/**
 * Each variant's `aria-disabled:hover:` class re-applies the resting background, so a busy
 * button shows no hover colour change (roadmap carry-over 8).
 */
export const BUTTON_VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover aria-disabled:hover:bg-accent',
  secondary: 'border border-line bg-panel text-ink hover:bg-sunken aria-disabled:hover:bg-panel',
}

export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'disabled' | 'type'
> {
  variant?: ButtonVariant
  /** Busy: stays focusable and announced as unavailable, ignores clicks, no hover change. */
  busy?: boolean
  ref?: Ref<HTMLButtonElement>
}

export function Button({
  variant = 'primary',
  busy = false,
  className = '',
  onClick,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type="button"
      aria-disabled={busy ? 'true' : undefined}
      onClick={(event) => {
        if (busy) return
        onClick?.(event)
      }}
      className={`rounded-control px-4 py-2 font-medium aria-disabled:cursor-default aria-disabled:opacity-60 ${BUTTON_VARIANT_CLASSES[variant]} ${className}`}
    />
  )
}
```

`src/renderer/src/components/Stat.tsx`:

```tsx
/** One label/value pair inside a `<dl>`. `title` carries the exact value (e.g. bytes). */
export function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums" title={title}>
        {value}
      </dd>
    </div>
  )
}
```

`src/renderer/src/components/DriveCard.tsx`:

```tsx
import type { DriveInfo } from '@shared/scan-types'
import { formatBytes, percentOf } from '../lib/format'

export function DriveCard({ drive, onScan }: { drive: DriveInfo; onScan(): void }) {
  const letter = drive.root.slice(0, 2)
  const usedPercent = percentOf(drive.totalBytes - drive.freeBytes, drive.totalBytes) * 100
  return (
    <button
      type="button"
      onClick={onScan}
      className="flex w-full flex-col gap-2 rounded-panel border border-line bg-panel p-4 text-left hover:bg-sunken"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium">
          {drive.label} ({letter})
        </span>
        {drive.kind === 'removable' && (
          <span className="shrink-0 rounded-control border border-line px-1.5 text-xs font-semibold text-ink-muted">
            USB
          </span>
        )}
      </span>
      <span aria-hidden="true" className="block h-2 overflow-hidden rounded-full bg-line">
        <span className="block h-full bg-ink-muted" style={{ width: `${usedPercent}%` }} />
      </span>
      <span className="text-xs text-ink-muted tabular-nums">
        {formatBytes(drive.freeBytes)} free of {formatBytes(drive.totalBytes)}
      </span>
    </button>
  )
}
```

`src/renderer/src/components/FolderBars.tsx`:

```tsx
import { useId } from 'react'
import type { FolderSummary } from '@shared/scan-types'
import { formatBytes, formatCount, formatPercent, percentOf } from '../lib/format'

export const EVERYTHING_ELSE = 'Everything else'

export function FolderBars({
  label,
  rows,
  totalBytes,
  emptyText,
}: {
  label: string
  rows: FolderSummary[]
  totalBytes: number
  emptyText: string
}) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="font-semibold">
        {label}
      </h2>
      {rows.length === 0 ? (
        <p className="text-ink-muted">{emptyText}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {rows.map((row) => {
            const fraction = percentOf(row.bytes, totalBytes)
            const isFolder = row.kind === 'folder'
            return (
              <li
                key={isFolder ? row.path : 'everything-else'}
                className="grid grid-cols-[minmax(0,1fr)_6rem_3.5rem] items-center gap-x-3 gap-y-1"
              >
                <span className="truncate" title={isFolder ? row.path : undefined}>
                  {isFolder ? row.name : EVERYTHING_ELSE}
                </span>
                <span className="text-right tabular-nums" title={`${formatCount(row.bytes)} bytes`}>
                  {formatBytes(row.bytes)}
                </span>
                <span className="text-right text-ink-muted tabular-nums">
                  {formatPercent(fraction)}
                </span>
                <span
                  aria-hidden="true"
                  className="col-span-3 block h-1.5 overflow-hidden rounded-full bg-line"
                >
                  <span
                    className="block h-full bg-ink-muted"
                    style={{ width: `${fraction * 100}%` }}
                  />
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
```

`src/renderer/src/components/UnreadableList.tsx`:

```tsx
import type { ScanError, ScanErrorReason } from '@shared/scan-types'
import { formatCount } from '../lib/format'

export const REASON_TEXT: Record<Exclude<ScanErrorReason, 'other'>, string> = {
  'access-denied': 'Windows didn’t give StorageIQ permission to open it.',
  'path-too-long': 'Its path is too long for Windows to open.',
  'not-found': 'It was moved or deleted during the scan.',
}

function reasonText(error: ScanError): string {
  return error.reason === 'other'
    ? `Windows reported an error (${error.code}).`
    : REASON_TEXT[error.reason]
}

export function UnreadableList({
  errors,
  errorCount,
}: {
  errors: ScanError[]
  errorCount: number
}) {
  return (
    <details className="rounded-panel border border-line bg-panel px-4 py-3">
      <summary className="cursor-pointer font-medium">
        {errorCount === 1
          ? '1 folder couldn’t be read'
          : `${formatCount(errorCount)} folders couldn’t be read`}
      </summary>
      <ul className="mt-3 flex flex-col gap-2">
        {errors.map((error, index) => (
          <li key={`${index}:${error.path}`}>
            <p className="font-mono text-[13px] break-all">{error.path}</p>
            <p className="text-ink-muted">{reasonText(error)}</p>
          </li>
        ))}
      </ul>
      {errorCount > errors.length && (
        <p className="mt-3 text-ink-muted">Showing the first {formatCount(errors.length)}.</p>
      )}
    </details>
  )
}
```

- [ ] **Step 12: Implement the four screens**

`src/renderer/src/components/PickLocationScreen.tsx`:

```tsx
import { useEffect, useId, useRef } from 'react'
import { DRIVES_ERROR } from '../stores/scan-store'
import { useScanStore } from '../stores/scan-store-context'
import { Button } from './Button'
import { DriveCard } from './DriveCard'

export function PickLocationScreen() {
  const drives = useScanStore((s) => s.drives)
  const drivesStatus = useScanStore((s) => s.drivesStatus)
  const folderPickerOpen = useScanStore((s) => s.folderPickerOpen)
  const errorMessage = useScanStore((s) => s.errorMessage)
  const loadDrives = useScanStore((s) => s.loadDrives)
  const startScan = useScanStore((s) => s.startScan)
  const chooseFolder = useScanStore((s) => s.chooseFolder)
  const dismissError = useScanStore((s) => s.dismissError)
  const headingId = useId()
  const chooseButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    void loadDrives()
  }, [loadDrives])

  return (
    <section
      aria-labelledby={headingId}
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-12"
    >
      <div className="flex flex-col gap-2">
        <h1 id={headingId} className="font-display text-2xl font-semibold tracking-tight">
          See what’s filling your disk
        </h1>
        <p className="text-ink-muted">
          Pick a drive or a folder. StorageIQ will show which folders take up the most space.
        </p>
      </div>

      {drivesStatus === 'error' ? (
        <p className="text-ink-muted">{DRIVES_ERROR}</p>
      ) : (
        <ul
          aria-label="Drives"
          className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3"
        >
          {drives.map((drive) => (
            <li key={drive.root}>
              <DriveCard drive={drive} onScan={() => void startScan(drive.root)} />
            </li>
          ))}
        </ul>
      )}

      <div>
        <Button
          ref={chooseButtonRef}
          variant="secondary"
          busy={folderPickerOpen}
          onClick={() => void chooseFolder()}
        >
          Choose folder…
        </Button>
      </div>

      {errorMessage !== null && (
        <div
          role="alert"
          className="flex w-full items-start justify-between gap-4 rounded-panel border border-danger/40 px-4 py-3 text-danger"
        >
          <p>{errorMessage}</p>
          <button
            type="button"
            onClick={() => {
              dismissError()
              chooseButtonRef.current?.focus()
            }}
            className="shrink-0 rounded-control px-2 py-0.5 font-medium underline-offset-2 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}
    </section>
  )
}
```

`src/renderer/src/components/ScanningScreen.tsx`:

```tsx
import { useEffect, useId, useRef } from 'react'
import { formatBytes, formatCount, formatDuration, middleTruncate } from '../lib/format'
import { ANNOUNCE_INTERVAL_MS, useThrottledAnnouncement } from '../lib/use-throttled-announcement'
import { useScanStore } from '../stores/scan-store-context'
import { Button } from './Button'
import { FolderBars } from './FolderBars'
import { Stat } from './Stat'

const CURRENT_PATH_MAX = 80

export function ScanningScreen() {
  const target = useScanStore((s) => s.target)
  const progress = useScanStore((s) => s.progress)
  const cancelScan = useScanStore((s) => s.cancelScan)
  const headingId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)

  const files = progress?.files ?? 0
  const folders = progress?.folders ?? 0
  const bytes = progress?.bytes ?? 0
  const currentPath = progress?.currentPath ?? target ?? ''
  const announcement = useThrottledAnnouncement(
    progress === null
      ? 'Scan started.'
      : `${formatCount(files)} files and ${formatCount(folders)} folders found, ${formatBytes(bytes)} so far.`,
    ANNOUNCE_INTERVAL_MS,
  )

  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  return (
    <section
      aria-labelledby={headingId}
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-12"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 id={headingId} className="font-display text-2xl font-semibold tracking-tight">
            Scanning
          </h1>
          <p className="font-mono text-[13px] break-all text-ink-muted">{target}</p>
        </div>
        <Button ref={cancelRef} variant="secondary" onClick={() => void cancelScan()}>
          Cancel
        </Button>
      </div>

      <dl className="grid grid-cols-4 gap-4">
        <Stat label="Files found" value={formatCount(files)} />
        <Stat label="Folders found" value={formatCount(folders)} />
        <Stat label="Size found" value={formatBytes(bytes)} />
        <Stat label="Elapsed" value={formatDuration(progress?.elapsedMs ?? 0)} />
      </dl>

      <p className="font-mono text-[13px] text-ink-muted" title={currentPath}>
        {middleTruncate(currentPath, CURRENT_PATH_MAX)}
      </p>

      <FolderBars
        label="Largest folders so far"
        rows={progress?.topFolders ?? []}
        totalBytes={bytes}
        emptyText="No folders found yet."
      />

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </section>
  )
}
```

`src/renderer/src/components/ResultScreen.tsx`:

```tsx
import { useEffect, useId, useRef } from 'react'
import { formatBytes, formatCount, formatDuration } from '../lib/format'
import { useScanStore } from '../stores/scan-store-context'
import { Button } from './Button'
import { FolderBars } from './FolderBars'
import { Stat } from './Stat'
import { UnreadableList } from './UnreadableList'

export function ResultScreen() {
  const result = useScanStore((s) => s.result)
  const target = useScanStore((s) => s.target)
  const rescan = useScanStore((s) => s.rescan)
  const chooseAnotherLocation = useScanStore((s) => s.chooseAnotherLocation)
  const headingId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const scanId = result?.scanId

  // The Cancel button that had focus is gone; move focus to the result heading.
  useEffect(() => {
    headingRef.current?.focus()
  }, [scanId])

  if (result === null) return null
  const canceled = result.status === 'canceled'

  return (
    <section
      aria-labelledby={headingId}
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-12"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1
            ref={headingRef}
            id={headingId}
            tabIndex={-1}
            className="font-display text-2xl font-semibold tracking-tight focus:outline-none"
          >
            {canceled ? 'Scan canceled — partial results' : 'Scan complete'}
          </h1>
          <p className="font-mono text-[13px] break-all text-ink-muted">{target}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => void rescan()}>Scan again</Button>
          <Button variant="secondary" onClick={chooseAnotherLocation}>
            Choose another location
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-4 gap-4">
        <Stat
          label="Total size"
          value={formatBytes(result.bytes)}
          title={`${formatCount(result.bytes)} bytes`}
        />
        <Stat label="Files" value={formatCount(result.files)} />
        <Stat label="Folders" value={formatCount(result.folders)} />
        <Stat label="Scan time" value={formatDuration(result.elapsedMs)} />
      </dl>

      <FolderBars
        label="Largest folders"
        rows={result.topFolders}
        totalBytes={result.bytes}
        emptyText="This location has no folders."
      />

      {result.errorCount > 0 && (
        <UnreadableList errors={result.errors} errorCount={result.errorCount} />
      )}
    </section>
  )
}
```

`src/renderer/src/components/CrashScreen.tsx`:

```tsx
import { useEffect, useId, useRef } from 'react'
import { useScanStore } from '../stores/scan-store-context'
import { Button } from './Button'

export function CrashScreen() {
  const rescan = useScanStore((s) => s.rescan)
  const chooseAnotherLocation = useScanStore((s) => s.chooseAnotherLocation)
  const headingId = useId()
  const retryRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    retryRef.current?.focus()
  }, [])

  return (
    <section
      aria-labelledby={headingId}
      className="mx-auto flex w-full max-w-xl flex-col items-start gap-4 px-8 py-16"
    >
      <h1 id={headingId} className="font-display text-2xl font-semibold tracking-tight">
        The scan stopped unexpectedly. You can try again.
      </h1>
      <div className="flex gap-2">
        <Button ref={retryRef} onClick={() => void rescan()}>
          Retry
        </Button>
        <Button variant="secondary" onClick={chooseAnotherLocation}>
          Choose another location
        </Button>
      </div>
    </section>
  )
}
```

- [ ] **Step 13: Wire the screens into the app**

`src/renderer/src/components/StatusBar.tsx` (full file):

```tsx
import { useAppStore } from '../stores/app-store-context'
import { useScanStore } from '../stores/scan-store-context'

export function StatusBar() {
  const target = useScanStore((s) => s.target)
  const appInfo = useAppStore((s) => s.appInfo)

  return (
    <footer className="flex h-7 items-center justify-between gap-4 border-t border-line bg-panel px-3 text-xs text-ink-muted">
      <span className="min-w-0 truncate" title={target ?? undefined}>
        {target ?? 'No folder selected'}
      </span>
      {appInfo !== null && (
        <span className="shrink-0 tabular-nums">StorageIQ {appInfo.version}</span>
      )}
    </footer>
  )
}
```

`src/renderer/src/App.tsx` (full file):

```tsx
import { useEffect } from 'react'
import { CrashScreen } from './components/CrashScreen'
import { PickLocationScreen } from './components/PickLocationScreen'
import { ResultScreen } from './components/ResultScreen'
import { ScanningScreen } from './components/ScanningScreen'
import { StatusBar } from './components/StatusBar'
import { useAppStore } from './stores/app-store-context'
import { useScanStore } from './stores/scan-store-context'

export function App() {
  const loadAppInfo = useAppStore((s) => s.loadAppInfo)
  const phase = useScanStore((s) => s.phase)

  useEffect(() => {
    void loadAppInfo()
  }, [loadAppInfo])

  return (
    <div className="grid h-full grid-rows-[1fr_auto] bg-app text-ink">
      <main className="min-h-0 overflow-auto">
        {phase === 'idle' && <PickLocationScreen />}
        {phase === 'scanning' && <ScanningScreen />}
        {(phase === 'done' || phase === 'canceled') && <ResultScreen />}
        {phase === 'failed' && <CrashScreen />}
      </main>
      <StatusBar />
    </div>
  )
}
```

`src/renderer/src/main.tsx` (full file):

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createAppStore } from './stores/app-store'
import { AppStoreProvider } from './stores/app-store-context'
import { createScanStore } from './stores/scan-store'
import { ScanStoreProvider } from './stores/scan-store-context'
import './styles/global.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('StorageIQ: #root element is missing from index.html')
}

if (window.storageiq === undefined) {
  throw new Error('StorageIQ: the preload bridge is missing')
}

const appStore = createAppStore(window.storageiq)
const scanStore = createScanStore(window.storageiq)

createRoot(container).render(
  <StrictMode>
    <AppStoreProvider store={appStore}>
      <ScanStoreProvider store={scanStore}>
        <App />
      </ScanStoreProvider>
    </AppStoreProvider>
  </StrictMode>,
)
```

Delete the Phase 1 panel: `git rm src/renderer/src/components/WelcomePanel.tsx`.

In `e2e/app.spec.ts`, delete the test `shows the folder chosen in the native picker` (its flow is replaced by the scan E2E in Task 7).

- [ ] **Step 14: Run the tests and quality gates**

```powershell
npx vitest run src/renderer
npm run format
npm run format:check
npm run lint
npm run typecheck
npm test
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm run test:e2e
```

Expected: `Button.test.tsx` 3, `PickLocationScreen.test.tsx` 6, `ScanningScreen.test.tsx` 4, `ResultScreen.test.tsx` 9, `CrashScreen.test.tsx` 2, `App.test.tsx` 3 tests pass, plus the Step 8 files; all unit tests pass; 7 E2E tests pass.

- [ ] **Step 15: Record the design decisions and check by eye**

Append to `DESIGN.md`:

```markdown
## Components (Phase 2a)

- **Button** (`src/renderer/src/components/Button.tsx`): `primary` (accent) for the one main action on a screen, `secondary` (panel with a border) for everything else. A busy button uses `aria-disabled="true"`, stays focusable, ignores clicks and keeps its resting colour on hover (`aria-disabled:hover:bg-accent` / `aria-disabled:hover:bg-panel`; roadmap carry-over 8).
- **Drive card**: the whole card is one button named by its text (`Local Disk (C:) 128 GB free of 512 GB`); removable drives carry a `USB` badge; the used-space bar is decorative (`aria-hidden`) because the text states the numbers.
- **Data bars** (drive cards, largest folders): neutral `bg-ink-muted` on a `bg-line` track. The accent stays reserved for the primary action and focus (principle 3).
- **Stats**: a `<dl>` of `Stat` items; values use tabular figures; the exact byte count sits in the `title`.
- **Progress announcements**: one visually hidden `aria-live="polite"` region, updated at most every 5 s (`useThrottledAnnouncement`).
- **Focus**: Cancel gets focus when a scan starts; the result heading (`tabIndex=-1`) gets focus when it ends; Retry gets focus on the crash screen.
- **Unreadable folders**: a native `<details>`/`<summary>` disclosure, closed by default.
```

Then add the guidance you applied in Step 1 under "Guidance changes applied to the baseline". Run `npm run dev` and check by eye, in light and dark mode: drive cards, Choose folder…, a scan of a small folder, Cancel during a scan of C:, the result screen, and keyboard-only operation (Tab, Enter, Space). Run `impeccable detect --json` on the changed renderer files and fix any finding at or above "warning".

- [ ] **Step 16: Commit**

```powershell
git add src/renderer/src/lib/format.ts src/renderer/src/lib/format.test.ts src/renderer/src/lib/use-throttled-announcement.ts src/renderer/src/lib/use-throttled-announcement.test.tsx src/renderer/src/stores/scan-store.ts src/renderer/src/stores/scan-store.test.ts src/renderer/src/stores/scan-store-context.tsx src/renderer/src/stores/scan-store-context.test.tsx src/renderer/src/stores/app-store.ts src/renderer/src/stores/app-store.test.ts src/renderer/src/stores/app-store-context.test.tsx src/renderer/src/components/Button.tsx src/renderer/src/components/Button.test.tsx src/renderer/src/components/Stat.tsx src/renderer/src/components/DriveCard.tsx src/renderer/src/components/FolderBars.tsx src/renderer/src/components/UnreadableList.tsx src/renderer/src/components/PickLocationScreen.tsx src/renderer/src/components/PickLocationScreen.test.tsx src/renderer/src/components/ScanningScreen.tsx src/renderer/src/components/ScanningScreen.test.tsx src/renderer/src/components/ResultScreen.tsx src/renderer/src/components/ResultScreen.test.tsx src/renderer/src/components/CrashScreen.tsx src/renderer/src/components/CrashScreen.test.tsx src/renderer/src/components/StatusBar.tsx src/renderer/src/App.tsx src/renderer/src/App.test.tsx src/renderer/src/main.tsx src/renderer/src/test/render.tsx src/renderer/src/test/scan-fixtures.ts DESIGN.md e2e/app.spec.ts
git commit -m "feat(renderer): scan store and pick, scanning, result and crash screens" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(`git rm` in Step 13 already staged the deletion of `WelcomePanel.tsx`.)

---

### Task 7: End-to-end scan flows, CI build step and report-only metrics, roadmap

**Implementer tier:** standard

Verified: `app.getAppMetrics()` returns `ProcessMetric[]` with `pid`, `type` (`'Utility'` for the scanner), `name` (the `serviceName` given to `utilityProcess.fork`) and `memory.workingSetSize`. `memory` values are in kilobytes (the typings state no unit; a trial run of this metrics spec while writing the plan reported 362,708 → 354 MB idle, which is plausible, plus 3.3 s for 20,000 files and 258 ms cancel latency). The report still prints the raw number next to the converted one.

Decisions recorded here:

- The E2E cancel test allows 2 s from click to the "Scan canceled — partial results" heading, because CI disks vary; the spec's 500 ms target is measured and reported by the metrics step (`cancelMs`), not gated.
- Metrics are report-only (`continue-on-error: true`), printed to the job log and the GitHub step summary.

**Files:**

- Create: `e2e/scan.spec.ts`, `e2e/metrics.spec.ts`, `scripts/report-metrics.mjs`
- Modify: `e2e/support/fixture.ts`, `.github/workflows/ci.yml`, `package.json`, `.gitignore`, `.prettierignore`, `eslint.config.mjs`, `README.md`, `docs/ROADMAP.md`

**Interfaces:**

- Consumes: `launchApp`, `consoleErrors` (Task 1); `createScanFixture` (Task 4); `SCANNER_SERVICE_NAME` (Task 4); every screen and copy string (Task 6); `npm run test:packaged` (Task 5).
- Produces:
  - `e2e/support/fixture.ts`: `LargeFixture { root; files; remove() }`, `createLargeFixture(fileCount: number): LargeFixture`
  - `metrics/e2e-metrics.json`: `{ idleWorkingSetKb, idleWorkingSetMb, scanFiles, scanWallMs, cancelMs }` (git-ignored)
  - npm script `metrics` → `node scripts/report-metrics.mjs`

- [ ] **Step 1: Add the large fixture**

Append to `e2e/support/fixture.ts`:

```ts
export interface LargeFixture {
  root: string
  files: number
  remove(): void
}

/** `fileCount` files of 1 KB, 100 per folder, for the report-only scan-time metric. */
export function createLargeFixture(fileCount: number): LargeFixture {
  const root = mkdtempSync(path.join(os.tmpdir(), 'storageiq-metrics-'))
  const filesPerFolder = 100
  const payload = Buffer.alloc(1024)
  for (let i = 0; i < fileCount; i += 1) {
    const folder = path.join(
      root,
      `group-${String(Math.floor(i / filesPerFolder)).padStart(3, '0')}`,
    )
    if (i % filesPerFolder === 0) mkdirSync(folder)
    writeFileSync(path.join(folder, `file-${i}.bin`), payload)
  }
  return { root, files: fileCount, remove: () => rmSync(root, { recursive: true, force: true }) }
}
```

- [ ] **Step 2: Write the scan E2E tests**

`e2e/scan.spec.ts`:

```ts
import { type ElectronApplication, expect, type Locator, type Page, test } from '@playwright/test'
import { SCANNER_SERVICE_NAME } from '../src/shared/scanner-protocol'
import { createScanFixture } from './support/fixture'
import { consoleErrors, launchApp } from './support/launch'

let app: ElectronApplication | undefined
let page: Page

const count = new Intl.NumberFormat('en-US')
const systemDrive = process.env['SystemDrive'] ?? 'C:'
const systemDriveCard = () =>
  page.getByRole('list', { name: 'Drives' }).getByRole('button', {
    name: new RegExp(`\\(${systemDrive}\\)`),
  })

test.beforeEach(async () => {
  const launched = await launchApp()
  app = launched.app
  page = launched.page
})

test.afterEach(async () => {
  await app?.close()
  app = undefined
})

/** The `<dd>` value next to a result/scanning `<dt>` label. */
function stat(label: string): Locator {
  return page
    .getByText(label, { exact: true })
    .and(page.locator('dt'))
    .locator('xpath=following-sibling::dd[1]')
}

async function stubFolderDialog(folder: string): Promise<void> {
  await app!.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [chosen],
    })) as typeof dialog.showOpenDialog
  }, folder)
}

function scannerPid(): Promise<number | undefined> {
  return app!.evaluate(
    ({ app: electronApp }, name) =>
      electronApp.getAppMetrics().find((metric) => metric.name === name)?.pid,
    SCANNER_SERVICE_NAME,
  )
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function startSystemDriveScan(): Promise<void> {
  await systemDriveCard().click()
  await expect(page.getByRole('heading', { level: 1, name: 'Scanning' })).toBeVisible()
}

test('scans a chosen folder and shows exact totals and the largest folders', async () => {
  const fixture = createScanFixture()
  try {
    await stubFolderDialog(fixture.root)
    await page.getByRole('button', { name: 'Choose folder…' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Scan complete' })).toBeVisible({
      timeout: 20_000,
    })
    await expect(stat('Files')).toHaveText(count.format(fixture.expected.files))
    await expect(stat('Folders')).toHaveText(count.format(fixture.expected.folders))
    await expect(stat('Total size')).toHaveAttribute(
      'title',
      `${count.format(fixture.expected.bytes)} bytes`,
    )

    const rows = page.getByRole('region', { name: 'Largest folders' }).getByRole('listitem')
    await expect(rows).toHaveCount(11)
    for (const [index, name] of fixture.expected.topFolderNames.entries()) {
      await expect(rows.nth(index)).toContainText(name)
    }
    await expect(rows.nth(10)).toContainText('Everything else')
    await expect(page.getByText(/couldn’t be read/)).toHaveCount(0)
    expect(await consoleErrors(app!)).toEqual([])
  } finally {
    fixture.remove()
  }
})

test('shows a card for the system drive', async () => {
  await expect(systemDriveCard()).toBeVisible()
})

test('cancels a running scan and shows partial results', async () => {
  await startSystemDriveScan()
  const cancel = page.getByRole('button', { name: 'Cancel' })
  await expect(cancel).toBeFocused()
  await page.waitForTimeout(1_000)

  const clickedAt = Date.now()
  await cancel.click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Scan canceled — partial results' }),
  ).toBeVisible()
  expect(Date.now() - clickedAt).toBeLessThan(2_000)
})

test('shows the crash screen when the scanner process dies', async () => {
  await startSystemDriveScan()
  const pid = await scannerPid()
  expect(pid).toBeDefined()

  process.kill(pid!)

  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'The scan stopped unexpectedly. You can try again.',
    }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry' })).toBeFocused()
})

test('quitting during a scan leaves no scanner process behind', async () => {
  await startSystemDriveScan()
  const pid = await scannerPid()
  expect(pid).toBeDefined()

  await app!.close()
  app = undefined

  await expect.poll(() => isAlive(pid!), { timeout: 5_000 }).toBe(false)
})

test('a busy button keeps its colour on hover (roadmap carry-over 8)', async () => {
  await app!.evaluate(({ dialog }) => {
    dialog.showOpenDialog = (() => new Promise(() => undefined)) as typeof dialog.showOpenDialog
  })
  const button = page.getByRole('button', { name: 'Choose folder…' })
  await button.click()
  await expect(button).toHaveAttribute('aria-disabled', 'true')

  const background = () =>
    button.evaluate(
      (element) =>
        (
          globalThis as unknown as {
            getComputedStyle(target: unknown): { backgroundColor: string }
          }
        ).getComputedStyle(element).backgroundColor,
    )
  await page.mouse.move(0, 0)
  const resting = await background()
  await button.hover()
  expect(await background()).toBe(resting)
})
```

- [ ] **Step 3: Write the report-only metrics spec and script**

`e2e/metrics.spec.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { createLargeFixture } from './support/fixture'
import { launchApp } from './support/launch'

// Report-only CI metrics (roadmap carry-over 7). Never gating; skipped unless asked for.
test.skip(process.env['STORAGEIQ_METRICS'] !== '1', 'Set STORAGEIQ_METRICS=1 to collect metrics')

test('collects idle RAM, scan time for about 20,000 files and cancel latency', async () => {
  test.setTimeout(300_000)
  const fixture = createLargeFixture(20_000)
  const { app, page } = await launchApp()
  try {
    await expect(page.getByRole('contentinfo').getByText(/^StorageIQ \d/)).toBeVisible()
    await page.waitForTimeout(5_000)
    const idleWorkingSetKb = await app.evaluate(({ app: electronApp }) =>
      electronApp.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize, 0),
    )

    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [folder],
      })) as typeof dialog.showOpenDialog
    }, fixture.root)
    let startedAt = Date.now()
    await page.getByRole('button', { name: 'Choose folder…' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Scan complete' })).toBeVisible({
      timeout: 240_000,
    })
    const scanWallMs = Date.now() - startedAt

    await page.getByRole('button', { name: 'Choose another location' }).click()
    const systemDrive = process.env['SystemDrive'] ?? 'C:'
    await page
      .getByRole('list', { name: 'Drives' })
      .getByRole('button', { name: new RegExp(`\\(${systemDrive}\\)`) })
      .click()
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await page.waitForTimeout(1_000)
    startedAt = Date.now()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(
      page.getByRole('heading', { level: 1, name: 'Scan canceled — partial results' }),
    ).toBeVisible()
    const cancelMs = Date.now() - startedAt

    mkdirSync('metrics', { recursive: true })
    writeFileSync(
      'metrics/e2e-metrics.json',
      JSON.stringify(
        {
          idleWorkingSetKb,
          idleWorkingSetMb: Math.round(idleWorkingSetKb / 1024),
          scanFiles: fixture.files,
          scanWallMs,
          cancelMs,
        },
        null,
        2,
      ),
    )
  } finally {
    await app.close()
    fixture.remove()
  }
})
```

`scripts/report-metrics.mjs`:

```js
// Report-only metrics for CI (roadmap carry-over 7): renderer bundle size, installer size,
// idle RAM, scan time of a generated ~20,000-file tree, and cancel latency. Never fails the build.
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const kilobytes = (bytes) => `${(bytes / 1024).toFixed(1)} kB`
const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

function rendererBundleBytes() {
  const dir = path.join('out', 'renderer', 'assets')
  if (!existsSync(dir)) return null
  return readdirSync(dir)
    .filter((name) => name.endsWith('.js') || name.endsWith('.css'))
    .reduce((sum, name) => sum + statSync(path.join(dir, name)).size, 0)
}

function installerBytes() {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
  const dir = path.join('release', version)
  if (!existsSync(dir)) return null
  const installer = readdirSync(dir).find((name) => name.endsWith('.exe'))
  return installer ? statSync(path.join(dir, installer)).size : null
}

function e2eMetrics() {
  const file = path.join('metrics', 'e2e-metrics.json')
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}

const bundle = rendererBundleBytes()
const installer = installerBytes()
const e2e = e2eMetrics()
const rows = [
  ['Renderer bundle (JS + CSS)', bundle === null ? 'n/a' : kilobytes(bundle)],
  ['Installer', installer === null ? 'n/a' : megabytes(installer)],
  [
    'Idle RAM (working set, all processes)',
    e2e ? `${e2e.idleWorkingSetMb} MB (raw ${e2e.idleWorkingSetKb})` : 'n/a',
  ],
  [
    `Scan time, ${e2e ? e2e.scanFiles : 20000} generated files (wall clock)`,
    e2e ? `${(e2e.scanWallMs / 1000).toFixed(1)} s` : 'n/a',
  ],
  ['Cancel latency, system drive (target < 500 ms)', e2e ? `${e2e.cancelMs} ms` : 'n/a'],
]
const table = [
  '| Metric | Value |',
  '| --- | --- |',
  ...rows.map(([name, value]) => `| ${name} | ${value} |`),
].join('\n')

console.log(table)
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## StorageIQ metrics (report only)\n\n${table}\n`,
  )
}
```

In `package.json`, add after `"test:packaged"`:

```json
    "metrics": "node scripts/report-metrics.mjs"
```

Add `metrics/` to `.gitignore`, `metrics` to `.prettierignore`, and `'metrics/**'` to the `ignores` list in `eslint.config.mjs`.

- [ ] **Step 4: Make the CI build explicit and add the packaged check and metrics**

`.github/workflows/ci.yml` (full file):

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm

      - run: npm ci
      - run: npm run format:check
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test

      - name: Build
        run: npx electron-vite build

      - name: End-to-end tests
        run: npx playwright test

      - name: Package installer
        run: npx electron-builder --win --x64 --publish never

      - name: Packaged app self-test (koffi from app.asar.unpacked, scanner process)
        run: npm run test:packaged

      - name: Collect metrics (report only)
        continue-on-error: true
        env:
          STORAGEIQ_METRICS: '1'
        run: npx playwright test e2e/metrics.spec.ts

      - name: Report metrics (report only)
        continue-on-error: true
        run: npm run metrics

      - uses: actions/upload-artifact@v4
        with:
          name: storageiq-installer
          path: release/*/*.exe
          if-no-files-found: error

      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report
          if-no-files-found: ignore
```

- [ ] **Step 5: Run everything locally, including the metrics**

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm run format
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run dist
npm run test:packaged
$env:STORAGEIQ_METRICS = '1'; npx playwright test e2e/metrics.spec.ts; Remove-Item Env:STORAGEIQ_METRICS
npm run metrics
```

Expected: all unit tests pass; E2E: 13 passed and 1 skipped (`app.spec.ts` 7, `scan.spec.ts` 6, `metrics.spec.ts` skipped without the variable); the installer builds; `test:packaged` exits 0; the metrics run passes and `npm run metrics` prints the five-row table (idle RAM should be a few hundred MB). Record the numbers for the roadmap.

- [ ] **Step 6: Update the README**

In `README.md`:

1. Replace the status line with: `> **Status:** early development. Phase 2a (Core Scanner) is complete: scan a drive or folder, see live progress, the largest folders and any folders that couldn’t be read. Phase 2b (Honest Totals) is next. See the [roadmap](docs/ROADMAP.md).`
2. In the Development command block, add after `npm run dist`:

```bash
npm run test:packaged # run the packaged app's self-test (after npm run dist)
npm run metrics      # print report-only metrics (bundle, installer, RAM, scan time)
```

3. In Architecture, add after the `src/main` line: `- \`src/worker\`: the scanner utilityProcess (directory walk, folder tree, largest folders)`.

- [ ] **Step 7: Update the roadmap**

In `docs/ROADMAP.md`:

- Set **Current phase** to `Phase 2b — Honest Totals (next)` and **Last updated** to the completion date.
- Phase 2a row: status `**Done** — [plan](superpowers/plans/2026-11-19-phase-2a-core-scanner.md)`; Phase 2b row: `**Next**`.
- In Folder Structure, replace the line `│  │  └─ scanner/                  # (Phase 2) utilityProcess entry + traversal` with `│  │  ├─ scan/ · drives/            # scan service (forks the scanner) · drive listing (koffi)` and add, after the `src/preload/` line, `│  ├─ worker/scanner/               # scanner utilityProcess: walk, tree, top folders (out/main/scanner.js)`.
- Add after the Phase 1 sections:

```markdown
### Phase 2a — Core Scanner (task checklist)

- [x] T1 E2E console and CSP listeners attached before the first page load
- [x] T2 IPC infrastructure: `Pick` handler factories, per-channel `parseArgs`, typed events, `sendEvent`, preload `onX`
- [x] T3 Scanner core: concurrent walk (≤ 16 directories, no reparse points, AbortSignal), folder tree, top folders
- [x] T4 Scanner utilityProcess, scan service (relay, supersede, crash → `scan:failed`, kill on quit), `render-process-gone` policy
- [x] T5 Drives through koffi (fixed + removable), `drives:list`, packaged self-test
- [x] T6 Scan store and the pick, scanning, result and crash screens
- [x] T7 Scan E2E, explicit CI build step, packaged check, report-only metrics

### Phase 2a — Outcome

koffi 3.3.8 (runtime dependency, unpacked from the asar, `npmRebuild: false`).

Metrics (report only, from the Task 7 run): renderer bundle <n> kB, installer <n> MB, idle RAM <n> MB, scan of 20,000 generated files <n> s, cancel latency <n> ms.

Deviations from Phase 1 conventions (recorded here, approved with the plan):

- koffi is a runtime `dependency`, not a dev dependency, because its native module ships in the app.
- `--self-test` command-line switch: lists drives, checks koffi is in `app.asar.unpacked`, runs one scan in the scanner process, exits with a status code (`npm run test:packaged`).
- E2E launches Electron with `-r e2e/support/capture-console.cjs` (test-only) to attach listeners before the first page load.
- The scanner sets `process.noAsar = true` so `.asar` archives on disk count as files.
```

Fill in the `<n>` values with the numbers from Step 5.

- Mark the carry-over list items: append ` — **done in Phase 2a Task 1**` to item 1, ` — **done (Tasks 2, 4, 5)**` to items 2 and 3, ` — **done (Tasks 2, 4)**` to item 4, ` — **done (Task 4)**` to item 5, ` — **done (Task 6)**` to item 6, ` — **done (Task 7)**` to item 7, ` — **done (Tasks 6, 7)**` to item 8, and ` — **still scheduled for Phase 4**` to item 9.

- [ ] **Step 8: Commit**

```powershell
git add e2e/scan.spec.ts e2e/metrics.spec.ts e2e/support/fixture.ts scripts/report-metrics.mjs .github/workflows/ci.yml package.json .gitignore .prettierignore eslint.config.mjs README.md docs/ROADMAP.md
git commit -m "ci: explicit build, packaged self-test, report-only metrics; scan E2E; Phase 2a done" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase 2a Acceptance Criteria

1. The user can scan any fixed or removable drive, or a chosen folder, without elevation. Network and optical drives are not listed.
2. Progress updates about every 250 ms. The UI stays responsive, and Cancel stops the scan in under 500 ms on SSD.
3. Totals for the E2E fixture match the generated tree exactly. Junctions are not followed.
4. Every unreadable folder appears with a reason, and none are skipped silently.
5. A worker crash shows the crash screen. Quitting during a scan leaves no orphan process.
6. Every IPC channel with arguments validates them; malformed calls are rejected in unit tests.
7. Roadmap carry-over items 1–8 are done. Item 9 stays scheduled for Phase 4.
8. All gates are green: format, lint, typecheck, unit, E2E, package (plus the packaged self-test).

---

## Self-review

### Spec coverage

| Spec item                                                                                                                                                              | Where                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| §1.1 Pick a location: drive cards (label, letter, used/free bar, USB badge), "Choose folder…"                                                                          | Task 5 (`listDrives`), Task 6 (`DriveCard`, `PickLocationScreen`), Task 7 E2E system-drive card            |
| §1.2 Scanning: counts, bytes, elapsed, middle-truncated path, live largest folders, Cancel focused, 5 s announcements                                                  | Task 4 (`scanner-host` snapshots), Task 6 (`ScanningScreen`, `useThrottledAnnouncement`), Task 7 E2E focus |
| §1.3 Result: totals, counts, scan time, top 10 + % bars, collapsible unreadable list, canceled label, two actions                                                      | Task 3 (`topFolders`), Task 6 (`ResultScreen`, `FolderBars`, `UnreadableList`), Task 7 E2E                 |
| §1.4 Crash screen with Retry                                                                                                                                           | Task 4 (`scan:failed`), Task 6 (`CrashScreen`), Task 7 E2E (kill the scanner)                              |
| §1 "Largest folders" = direct children, top 10 + "Everything else"                                                                                                     | Task 3 `top-folders.ts`                                                                                    |
| §1 logical sizes (`stat.size`), no "matches Windows" claim                                                                                                             | Task 3 (`lstat().size`); no such copy in Task 6                                                            |
| §2 approach A (tree in scanner; child stays alive)                                                                                                                     | Task 3 `tree.ts` (folders only), Task 4 (`lastTree`, child not killed after a scan)                        |
| §2 units table (scan-types, walk, tree, top-folders, entry, drives, scan-service, scan-store + screens)                                                                | Tasks 2, 3, 4, 5, 6                                                                                        |
| §2 worker as second electron-vite main input; koffi in `asarUnpack`                                                                                                    | Task 4 Step 11; Task 5 Step 9                                                                              |
| §3 channels `drives:list`, `scan:start`, `scan:cancel` with the `parseArgs` rules                                                                                      | Task 5 (drives), Task 4 (`parseScanRoot`, `oneString`)                                                     |
| §3 events `scan:progress`, `scan:done`, `scan:failed` with the exact payloads                                                                                          | Task 2 (`scan-types.ts`, `IpcEventContract`), Task 4 (relay)                                               |
| §3 `Pick` factories + `satisfies`; `parseArgs`; `sendEvent`; preload `onX`; relay through main                                                                         | Task 2, Task 4, Task 5                                                                                     |
| §4 error reasons, cap 1000, exact `errorCount`                                                                                                                         | Task 3 (`scanErrorReason`, `MAX_SCAN_ERRORS`)                                                              |
| §4 unreadable root → complete, zero totals, one error                                                                                                                  | Task 3 walk test, Task 4 scanner-host test                                                                 |
| §4 worker crash → `scan:failed`; quit kills the worker, no event                                                                                                       | Task 4 (`scan-service` tests), Task 7 E2E                                                                  |
| §4 `render-process-gone` policy                                                                                                                                        | Task 4 (`decideRenderProcessGone`, `window.ts`)                                                            |
| §4 cancel within one directory batch                                                                                                                                   | Task 3 (abort test: no new directory after abort; listings stop at their next entry), Task 7 E2E + metric  |
| §5 unit tests listed (walk + junction, EACCES/ENAMETOOLONG, tree, top folders, cancel, parseArgs, scan-service, drives, sendEvent, store + screens, loadAppInfo retry) | Tasks 2–6                                                                                                  |
| §5 E2E (listeners first, stubbed dialog + fixture totals + top folders, cancel, system drive card, packaged koffi check)                                               | Task 1, Task 7, Task 5 (`test:packaged`)                                                                   |
| §5 CI explicit build, bundle/installer/idle RAM/20k-file scan time, report only                                                                                        | Task 7                                                                                                     |
| §5 cosmetic `aria-disabled` hover                                                                                                                                      | Task 6 (`Button`), Task 7 E2E                                                                              |

| Acceptance criterion | Task(s) and proof                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1                    | Task 5 `list-drives.test.ts` (type filter), E2E `lists the system drive through koffi`; Task 7 E2E folder scan; no elevation anywhere                               |
| 2                    | Task 4 `SNAPSHOT_INTERVAL_MS = 250` test; scanning runs in a separate process (UI responsive); Task 7 cancel E2E (< 2 s) and `cancelMs` metric vs the 500 ms target |
| 3                    | Task 4 bridge E2E and Task 7 UI E2E on `createScanFixture` (exact files, folders, bytes; junction not followed); Task 3 on-disk junction test                       |
| 4                    | Task 3 walk/tree tests (every error recorded, exact count), Task 6 `ResultScreen` tests (list with reasons)                                                         |
| 5                    | Task 4 `scan-service` tests; Task 7 E2E crash screen and "no scanner process behind" after quit                                                                     |
| 6                    | Task 2 `parse-args`/`register` tests, Task 4 `scan-handlers` tests, Task 5 `drive-handlers` test                                                                    |
| 7                    | Carry-over schedule table above; Task 7 Step 7 marks each item                                                                                                      |
| 8                    | Task 7 Step 5 and the CI workflow                                                                                                                                   |

### Dry run of the plan's code

While writing this plan, every code block was extracted into a scratch copy of the repository and the edit steps were applied, to reach the end state of Task 7. Results: `tsc` (node and web configs) clean; ESLint clean (after one fix now in Task 4: `no-useless-assignment` in `parseScanRoot`); 224 unit tests in 32 files pass, with the per-file counts stated in each task; `electron-vite build` emits `out/main/index.js` and `out/main/scanner.js`; Playwright: 13 E2E tests pass (the metrics spec skipped) and the metrics spec passes when enabled; a clean project packaged with the Task 5 builder settings passes `--self-test`. Prettier reformats some of the code blocks; every task runs `npm run format` before `format:check`, so that is expected.

### Placeholder scan

Searched for `TBD`, `TODO`, `add validation`, `similar to Task`, `…` used as elided code, and "fill in": none in code or tests. The only fill-ins are the measured metric values in Task 7 Step 7, which are numbers produced by Step 5, not missing work.

### Type-name consistency

Checked across tasks: `DriveInfo`, `DriveKind`, `FolderSummary`, `ScanError`, `ScanErrorReason`, `ScanProgress`, `ScanStatus`, `ScanDone`, `ScanFailed`, `ScanStartResult` (Task 2) are used with the same names and fields in Tasks 3–7. `IpcHandlerMap`, `IpcChannelHandler`, `noArgs`, `oneString`, `InvalidIpcArgumentsError`, `SendEvent`, `createEventSender` (Task 2) match their uses in Tasks 4–5. `WalkFs`, `WalkSink`, `nodeWalkFs`, `walk`, `createScanTree`, `ScanTree`, `topFolders`, `MAX_SCAN_ERRORS` (Task 3) match Task 4. `ScannerRequest`, `ScannerMessage`, `SCANNER_SERVICE_NAME`, `ScannerChild`, `ScanService`, `createScanService` (Task 4) match Tasks 5 and 7. `StorageIQApi` members `getAppInfo`, `selectFolder`, `listDrives`, `startScan`, `cancelScan`, `onScanProgress`, `onScanDone`, `onScanFailed` match the preload, the fake API and the E2E bridge-key lists in Tasks 2, 4 and 5. `createFakeApi`, `FakeApi`, `TEST_DRIVES`, `renderWithStores`, `makeProgress`, `makeDone`, `makeFailed` match their uses in Task 6. Copy strings in Task 6 match the E2E selectors in Task 7 (`Choose folder…`, `Scanning`, `Cancel`, `Scan complete`, `Scan canceled — partial results`, `Largest folders`, `Everything else`, `Retry`, the crash sentence).

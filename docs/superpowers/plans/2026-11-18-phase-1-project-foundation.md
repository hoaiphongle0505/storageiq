# Phase 1 — Project Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A secure, tested, installable Electron + React + TypeScript shell for StorageIQ. The user can launch it, see the app version reported by the main process, and pick a folder through a typed IPC call. That folder becomes the scan target Phase 2 will use.

**Architecture:** electron-vite builds three targets: main (Node/Electron), preload (sandboxed CommonJS bridge) and renderer (React and Tailwind, no Node access). A single typed contract in `src/shared/ipc-contract.ts` defines every IPC channel. Main registers handlers against it and checks the sender of every call. The preload exposes `window.storageiq` typed from the same contract. The renderer state lives in a Zustand vanilla store that receives the API as a parameter, so it can be unit-tested without Electron. electron-builder packages an NSIS per-user x64 installer, and GitHub Actions runs every check on `windows-latest`.

**Tech Stack:** Electron, electron-vite, Vite, React, TypeScript (strict), TailwindCSS v4 (`@tailwindcss/vite`), Zustand, Vitest + Testing Library + jsdom, Playwright (`_electron`), ESLint (flat config) + typescript-eslint, Prettier, electron-builder.

## Global Constraints

- Node.js 22 LTS or newer (`engines.node >= 22`); npm is the package manager and `package-lock.json` is committed.
- Install each dependency's current stable release. If npm reports a peer-dependency conflict, install the highest version that satisfies the peer range (`npm view <pkg> peerDependencies`). Never use `--force` or `--legacy-peer-deps`.
- Target Windows 10 1809+ / Windows 11, x64 only. License: MIT. appId `io.github.storageiq.app`. productName `StorageIQ`. Version `0.1.0`.
- Renderer security: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict CSP, no `window.open`, no foreign navigation, no `<webview>`. Every IPC handler checks the sender URL.
- TypeScript `strict` plus `noUncheckedIndexedAccess`. No `any`, no `@ts-ignore`.
- Path aliases: `@shared/*` → `src/shared/*`; `@renderer/*` → `src/renderer/src/*`.
- Copy is plain language for non-experts and uses typographic apostrophes (’). Exact UI strings: heading `See what’s filling your disk`; buttons `Choose folder` / `Choose a different folder`; label `Selected folder`; status bar `No folder selected` and `StorageIQ <version>`.
- No SQLite, no scanning code and no future-phase UI in this phase.
- UI work (Task 4): before editing, run `impeccable context` once and read the Impeccable `reference/craft-floor.md`. Run `modern-web-guidance` searches for `"app shell layout"` and `"inline error alert"` and apply any matching guidance. After the UI is finished, run `impeccable detect --json` on the changed renderer files.
- Commits: make one commit per task with a conventional-commit message ending with the `Co-Authored-By` trailer from the session. Ask the user before the first commit if they have not already approved commits.

---

## File Map

| File                                                                                      | Responsibility                                                               | Task |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---- |
| `package.json`, `package-lock.json`                                                       | Scripts, metadata, dependencies                                              | 1    |
| `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`                                | Strict TS for node-side and web-side code                                    | 1    |
| `electron.vite.config.ts`                                                                 | Build config for main/preload/renderer + aliases                             | 1    |
| `vitest.config.ts`                                                                        | Unit test runner config                                                      | 1    |
| `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, `.editorconfig`, `.gitignore` | Quality gates                                                                | 1    |
| `LICENSE`                                                                                 | MIT                                                                          | 1    |
| `src/shared/ipc-contract.ts`                                                              | Channel → args/result types, `AppInfo`, `SelectFolderResult`, `StorageIQApi` | 1    |
| `src/main/security/trusted-url.ts` (+ test)                                               | Is a URL our own renderer?                                                   | 1    |
| `src/renderer/src/test/setup.ts`                                                          | jest-dom matchers + RTL cleanup                                              | 1    |
| `src/main/ipc/register.ts` (+ test)                                                       | Register typed handlers with sender validation                               | 2    |
| `src/main/ipc/app-handlers.ts` (+ test)                                                   | `app:get-info`, `dialog:select-folder`                                       | 2    |
| `src/main/window-options.ts` (+ test)                                                     | Pure, security-critical BrowserWindow options                                | 2    |
| `src/main/window.ts`                                                                      | Create window, lock navigation, load renderer                                | 2    |
| `src/main/index.ts`                                                                       | App lifecycle, single-instance lock, wiring                                  | 2    |
| `src/preload/index.ts`                                                                    | `contextBridge` → `window.storageiq`                                         | 2    |
| `src/renderer/src/test/fake-api.ts`                                                       | Fake `StorageIQApi` for renderer tests                                       | 3    |
| `src/renderer/src/stores/app-store.ts` (+ test)                                           | Zustand vanilla store factory                                                | 3    |
| `src/renderer/src/stores/app-store-context.tsx`                                           | Provider + `useAppStore(selector)` hook                                      | 3    |
| `DESIGN.md`                                                                               | Recorded design tokens and rules                                             | 4    |
| `src/renderer/index.html`                                                                 | HTML entry with CSP                                                          | 4    |
| `src/renderer/src/env.d.ts`                                                               | Vite client types + `window.storageiq` typing                                | 4    |
| `src/renderer/src/styles/global.css`                                                      | Tailwind entry + light/dark tokens                                           | 4    |
| `src/renderer/src/main.tsx`                                                               | React root                                                                   | 4    |
| `src/renderer/src/App.tsx` (+ test)                                                       | Shell layout                                                                 | 4    |
| `src/renderer/src/components/WelcomePanel.tsx`                                            | Folder selection panel                                                       | 4    |
| `src/renderer/src/components/StatusBar.tsx`                                               | Target + version                                                             | 4    |
| `playwright.config.ts`, `e2e/app.spec.ts`                                                 | Electron E2E smoke tests                                                     | 5    |
| `electron-builder.yml`                                                                    | NSIS x64 per-user installer                                                  | 6    |
| `.github/workflows/ci.yml`, `README.md`                                                   | CI and contributor docs                                                      | 7    |
| `docs/ROADMAP.md`                                                                         | Mark Phase 1 complete                                                        | 7    |

---

### Task 1: Repository, toolchain & shared IPC contract

**Files:**

- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `electron.vite.config.ts`, `vitest.config.ts`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, `.editorconfig`, `.gitignore`, `LICENSE`
- Create: `src/shared/ipc-contract.ts`, `src/main/security/trusted-url.ts`, `src/renderer/src/test/setup.ts`
- Test: `src/main/security/trusted-url.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `AppInfo { name; version; platform; arch; electronVersion }` (all `string`)
  - `SelectFolderResult = { canceled: true } | { canceled: false; path: string }`
  - `IpcContract`, `IpcChannel`, `IpcArgs<C>`, `IpcResult<C>`
  - `StorageIQApi { getAppInfo(): Promise<AppInfo>; selectFolder(): Promise<SelectFolderResult> }`
  - `isTrustedRendererUrl(url: string, options: { devServerUrl?: string; rendererRoot: string }): boolean`
  - npm scripts: `dev`, `build`, `typecheck`, `lint`, `format`, `format:check`, `test`, `test:e2e`, `dist`

- [ ] **Step 1: Initialise git**

```bash
git init -b main
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "storageiq",
  "productName": "StorageIQ",
  "version": "0.1.0",
  "description": "Free, open-source disk space analyzer for Windows.",
  "author": "StorageIQ contributors",
  "license": "MIT",
  "private": true,
  "main": "./out/main/index.js",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "dev": "electron-vite dev",
    "build": "npm run typecheck && electron-vite build",
    "preview": "electron-vite preview",
    "typecheck:node": "tsc --noEmit -p tsconfig.node.json --composite false",
    "typecheck:web": "tsc --noEmit -p tsconfig.web.json --composite false",
    "typecheck": "npm run typecheck:node && npm run typecheck:web",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "electron-vite build && playwright test",
    "dist": "npm run build && electron-builder --win --x64 --publish never"
  }
}
```

- [ ] **Step 3: Install dependencies**

Everything is bundled by Vite, so all packages are dev dependencies and the packaged app contains no `node_modules`.

```bash
npm install --save-dev electron electron-vite vite @vitejs/plugin-react typescript @types/node react react-dom @types/react @types/react-dom zustand tailwindcss @tailwindcss/vite vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @playwright/test eslint @eslint/js typescript-eslint eslint-plugin-react-hooks globals prettier electron-builder
```

Expected: install completes with no `ERESOLVE` errors. If one appears, follow the peer-range rule in Global Constraints. Record the installed Electron version: `npx electron --version`.

- [ ] **Step 4: Write TypeScript configs**

`tsconfig.json`:

```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }]
}
```

`tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "paths": {
      "@shared/*": ["./src/shared/*"]
    }
  },
  "include": [
    "src/main/**/*",
    "src/preload/**/*",
    "src/shared/**/*",
    "e2e/**/*",
    "electron.vite.config.ts",
    "vitest.config.ts",
    "playwright.config.ts"
  ]
}
```

`tsconfig.web.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": [],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "paths": {
      "@shared/*": ["./src/shared/*"],
      "@renderer/*": ["./src/renderer/src/*"]
    }
  },
  "include": ["src/renderer/src/**/*", "src/shared/**/*"]
}
```

- [ ] **Step 5: Write build and test configs**

`electron.vite.config.ts`:

```ts
import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const sharedAlias = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: sharedAlias },
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

`vitest.config.ts`:

```ts
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src'),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    setupFiles: ['src/renderer/src/test/setup.ts'],
    restoreMocks: true,
  },
})
```

`src/renderer/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
```

- [ ] **Step 6: Write lint/format/editor configs and LICENSE**

`eslint.config.mjs`:

```js
import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  {
    ignores: ['out/**', 'release/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'e2e/**/*.ts', '*.config.{ts,mjs}'],
    languageOptions: { globals: globals.node },
  },
)
```

`.prettierrc.json`:

```json
{
  "semi": false,
  "singleQuote": true,
  "printWidth": 100,
  "trailingComma": "all"
}
```

`.prettierignore`:

```
out
release
node_modules
package-lock.json
playwright-report
test-results
```

`.editorconfig`:

```
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true
```

`.gitignore`:

```
node_modules/
out/
release/
playwright-report/
test-results/
*.log
.impeccable/config.local.json
.superpowers/
```

`LICENSE`: the standard MIT License text with the line `Copyright (c) 2026 StorageIQ contributors`.

- [ ] **Step 7: Write the shared IPC contract**

`src/shared/ipc-contract.ts`:

```ts
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

/** The API the preload script exposes to the renderer as `window.storageiq`. */
export interface StorageIQApi {
  getAppInfo(): Promise<AppInfo>
  selectFolder(): Promise<SelectFolderResult>
}
```

- [ ] **Step 8: Write the failing test for `isTrustedRendererUrl`**

`src/main/security/trusted-url.test.ts`:

```ts
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isTrustedRendererUrl } from './trusted-url'

const rendererRoot = path.resolve('out', 'renderer')
const indexUrl = pathToFileURL(path.join(rendererRoot, 'index.html')).href

describe('isTrustedRendererUrl', () => {
  it('trusts the bundled renderer index file', () => {
    expect(isTrustedRendererUrl(indexUrl, { rendererRoot })).toBe(true)
  })

  it('rejects files outside the renderer folder', () => {
    const mainBundle = pathToFileURL(path.resolve('out', 'main', 'index.js')).href
    expect(isTrustedRendererUrl(mainBundle, { rendererRoot })).toBe(false)
  })

  it('rejects path traversal that escapes the renderer folder', () => {
    const sneaky = `${pathToFileURL(rendererRoot).href}/../main/index.js`
    expect(isTrustedRendererUrl(sneaky, { rendererRoot })).toBe(false)
  })

  it('trusts the dev server origin when one is configured', () => {
    const options = { rendererRoot, devServerUrl: 'http://localhost:5173' }
    expect(isTrustedRendererUrl('http://localhost:5173/index.html', options)).toBe(true)
  })

  it('rejects other origins even in development', () => {
    const options = { rendererRoot, devServerUrl: 'http://localhost:5173' }
    expect(isTrustedRendererUrl('http://localhost:5174/', options)).toBe(false)
    expect(isTrustedRendererUrl('https://example.com/', options)).toBe(false)
  })

  it('rejects remote URLs in production', () => {
    expect(isTrustedRendererUrl('https://example.com/', { rendererRoot })).toBe(false)
  })

  it('rejects empty and malformed URLs', () => {
    expect(isTrustedRendererUrl('', { rendererRoot })).toBe(false)
    expect(isTrustedRendererUrl('not a url', { rendererRoot })).toBe(false)
  })
})
```

- [ ] **Step 9: Run the test and confirm it fails**

Run: `npx vitest run src/main/security/trusted-url.test.ts`
Expected: FAIL. It cannot resolve `./trusted-url`.

- [ ] **Step 10: Implement `isTrustedRendererUrl`**

`src/main/security/trusted-url.ts`:

```ts
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface TrustedUrlOptions {
  /** Vite dev server URL; set only in unpackaged development builds. */
  devServerUrl?: string
  /** Absolute folder that contains the bundled renderer (`out/renderer`). */
  rendererRoot: string
}

/**
 * Returns true only for URLs that belong to StorageIQ's own renderer:
 * the dev server origin during development, or a file inside the bundled
 * renderer folder in production. Everything else is untrusted.
 */
export function isTrustedRendererUrl(url: string, options: TrustedUrlOptions): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (options.devServerUrl && parsed.origin === new URL(options.devServerUrl).origin) {
    return true
  }

  if (parsed.protocol !== 'file:') {
    return false
  }

  const root = path.resolve(options.rendererRoot)
  const relative = path.relative(root, path.resolve(fileURLToPath(parsed)))
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}
```

- [ ] **Step 11: Run all quality gates**

```bash
npm run format
npx vitest run
npm run typecheck
npm run lint
npm run format:check
```

Expected: 7 tests pass. Typecheck, lint and format check all exit 0.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "chore: scaffold toolchain and shared IPC contract"
```

---

### Task 2: Main process & preload bridge

**Files:**

- Create: `src/main/ipc/register.ts`, `src/main/ipc/app-handlers.ts`, `src/main/window-options.ts`, `src/main/window.ts`, `src/main/index.ts`, `src/preload/index.ts`
- Test: `src/main/ipc/register.test.ts`, `src/main/ipc/app-handlers.test.ts`, `src/main/window-options.test.ts`

**Interfaces:**

- Consumes: `IpcChannel`, `IpcArgs`, `IpcResult`, `AppInfo`, `StorageIQApi` and `isTrustedRendererUrl` from Task 1.
- Produces:
  - `IpcHandlerMap` (one handler per contract channel), `IpcRegistrar`, `UntrustedSenderError`
  - `registerIpcHandlers(ipc: IpcRegistrar, handlers: IpcHandlerMap, isTrustedSender: (url: string) => boolean): void`
  - `AppHandlerDeps`, `createAppHandlers(deps: AppHandlerDeps): IpcHandlerMap`
  - `WINDOW_BACKGROUND = { light: '#f6f7f7', dark: '#161a1b' }`. Task 4's `--surface-app` token must use the same values.
  - `createMainWindowOptions({ preloadPath, dark }): BrowserWindowConstructorOptions`
  - `window.storageiq: StorageIQApi` at runtime

- [ ] **Step 1: Write failing tests for IPC registration**

`src/main/ipc/register.test.ts`:

```ts
import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import type { AppInfo } from '@shared/ipc-contract'
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

const handlers: IpcHandlerMap = {
  'app:get-info': () => appInfo,
  'dialog:select-folder': () => ({ canceled: true }),
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

const isTrusted = (url: string) => url === 'app://trusted/index.html'

describe('registerIpcHandlers', () => {
  it('registers exactly one listener per contract channel', () => {
    const ipc = createFakeIpc()
    registerIpcHandlers(ipc, handlers, isTrusted)
    expect([...ipc.listeners.keys()].sort()).toEqual(['app:get-info', 'dialog:select-folder'])
  })

  it('forwards calls from trusted senders to the handler', async () => {
    const ipc = createFakeIpc()
    registerIpcHandlers(ipc, handlers, isTrusted)
    const listener = ipc.listeners.get('app:get-info')
    await expect(
      Promise.resolve(listener?.(eventFrom('app://trusted/index.html'))),
    ).resolves.toEqual(appInfo)
  })

  it('rejects calls from untrusted senders without running the handler', () => {
    const ipc = createFakeIpc()
    registerIpcHandlers(ipc, handlers, isTrusted)
    const listener = ipc.listeners.get('app:get-info')
    expect(() => listener?.(eventFrom('https://evil.example/'))).toThrow(UntrustedSenderError)
  })
})
```

- [ ] **Step 2: Write failing tests for app handlers**

`src/main/ipc/app-handlers.test.ts`:

```ts
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { type AppHandlerDeps, createAppHandlers } from './app-handlers'

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
    await expect(Promise.resolve(handlers['app:get-info'](event))).resolves.toEqual({
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

    await expect(Promise.resolve(handlers['dialog:select-folder'](event))).resolves.toEqual({
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
    await expect(Promise.resolve(handlers['dialog:select-folder'](event))).resolves.toEqual({
      canceled: true,
    })
  })

  it('reports a cancel without opening a dialog when no window exists', async () => {
    const { handlers, showOpenDialog } = setup({ getMainWindow: () => null })
    await expect(Promise.resolve(handlers['dialog:select-folder'](event))).resolves.toEqual({
      canceled: true,
    })
    expect(showOpenDialog).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Write a failing test for the window security options**

`src/main/window-options.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createMainWindowOptions, WINDOW_BACKGROUND } from './window-options'

describe('createMainWindowOptions', () => {
  it('locks down the renderer', () => {
    const options = createMainWindowOptions({ preloadPath: 'C:\\app\\preload.js', dark: false })
    expect(options.webPreferences).toMatchObject({
      preload: 'C:\\app\\preload.js',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    })
  })

  it('stays hidden until the first paint to avoid a white flash', () => {
    expect(createMainWindowOptions({ preloadPath: 'p', dark: false }).show).toBe(false)
  })

  it('matches the window background to the system theme', () => {
    expect(createMainWindowOptions({ preloadPath: 'p', dark: true }).backgroundColor).toBe(
      WINDOW_BACKGROUND.dark,
    )
    expect(createMainWindowOptions({ preloadPath: 'p', dark: false }).backgroundColor).toBe(
      WINDOW_BACKGROUND.light,
    )
  })
})
```

- [ ] **Step 4: Run the tests and confirm they fail**

Run: `npx vitest run src/main`
Expected: FAIL. It cannot resolve `./register`, `./app-handlers` and `./window-options`. The 7 `trusted-url` tests still pass.

- [ ] **Step 5: Implement `register.ts`**

`src/main/ipc/register.ts`:

```ts
import type { IpcMainInvokeEvent } from 'electron'
import type { IpcArgs, IpcChannel, IpcResult } from '@shared/ipc-contract'

export type IpcHandler<C extends IpcChannel> = (
  event: IpcMainInvokeEvent,
  ...args: IpcArgs<C>
) => IpcResult<C> | Promise<IpcResult<C>>

/** Exactly one handler for every channel in the contract. */
export type IpcHandlerMap = { [C in IpcChannel]: IpcHandler<C> }

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

export function registerIpcHandlers(
  ipc: IpcRegistrar,
  handlers: IpcHandlerMap,
  isTrustedSender: (url: string) => boolean,
): void {
  for (const channel of Object.keys(handlers) as IpcChannel[]) {
    const handler = handlers[channel] as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
    ipc.handle(channel, (event, ...args) => {
      const url = event.senderFrame?.url ?? ''
      if (!isTrustedSender(url)) {
        throw new UntrustedSenderError(channel, url)
      }
      return handler(event, ...args)
    })
  }
}
```

- [ ] **Step 6: Implement `app-handlers.ts`**

`src/main/ipc/app-handlers.ts`:

```ts
import type { BrowserWindow, OpenDialogOptions, OpenDialogReturnValue } from 'electron'
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

export function createAppHandlers(deps: AppHandlerDeps): IpcHandlerMap {
  return {
    'app:get-info': () => ({
      name: deps.app.getName(),
      version: deps.app.getVersion(),
      ...deps.runtime,
    }),

    'dialog:select-folder': async () => {
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
  }
}
```

- [ ] **Step 7: Implement `window-options.ts`**

`src/main/window-options.ts`:

```ts
import type { BrowserWindowConstructorOptions } from 'electron'

/** Must stay equal to the `--surface-app` tokens in `src/renderer/src/styles/global.css`. */
export const WINDOW_BACKGROUND = { light: '#f6f7f7', dark: '#161a1b' } as const

export function createMainWindowOptions(input: {
  preloadPath: string
  dark: boolean
}): BrowserWindowConstructorOptions {
  return {
    width: 1200,
    height: 780,
    minWidth: 880,
    minHeight: 560,
    show: false,
    title: 'StorageIQ',
    backgroundColor: input.dark ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light,
    autoHideMenuBar: true,
    webPreferences: {
      preload: input.preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  }
}
```

- [ ] **Step 8: Run the unit tests and confirm they pass**

Run: `npx vitest run src/main`
Expected: 17 tests pass (7 trusted-url, 3 register, 4 app-handlers, 3 window-options).

- [ ] **Step 9: Implement `window.ts`**

`src/main/window.ts`:

```ts
import path from 'node:path'
import { BrowserWindow, nativeTheme } from 'electron'
import { isTrustedRendererUrl } from './security/trusted-url'
import { createMainWindowOptions } from './window-options'

export interface MainWindowConfig {
  preloadPath: string
  rendererRoot: string
  devServerUrl?: string
}

export function createMainWindow(config: MainWindowConfig): BrowserWindow {
  const window = new BrowserWindow(
    createMainWindowOptions({
      preloadPath: config.preloadPath,
      dark: nativeTheme.shouldUseDarkColors,
    }),
  )

  const isTrusted = (url: string) =>
    isTrustedRendererUrl(url, {
      rendererRoot: config.rendererRoot,
      devServerUrl: config.devServerUrl,
    })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => {
    if (!isTrusted(event.url)) {
      event.preventDefault()
    }
  })
  window.once('ready-to-show', () => window.show())

  const load = config.devServerUrl
    ? window.loadURL(config.devServerUrl)
    : window.loadFile(path.join(config.rendererRoot, 'index.html'))
  load.catch((error: unknown) => {
    console.error('StorageIQ: failed to load the renderer', error)
  })

  return window
}
```

- [ ] **Step 10: Implement `index.ts`**

`src/main/index.ts`:

```ts
import path from 'node:path'
import { app, type BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { createAppHandlers } from './ipc/app-handlers'
import { registerIpcHandlers } from './ipc/register'
import { isTrustedRendererUrl } from './security/trusted-url'
import { createMainWindow } from './window'

const APP_USER_MODEL_ID = 'io.github.storageiq.app'
const rendererRoot = path.join(__dirname, '../renderer')
const preloadPath = path.join(__dirname, '../preload/index.js')
const devServerUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']

let mainWindow: BrowserWindow | null = null

function focusMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', focusMainWindow)

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })

  app.on('window-all-closed', () => app.quit())

  void app.whenReady().then(() => {
    app.setAppUserModelId(APP_USER_MODEL_ID)
    if (app.isPackaged) {
      Menu.setApplicationMenu(null)
    }

    registerIpcHandlers(
      ipcMain,
      createAppHandlers({
        app,
        dialog,
        getMainWindow: () => mainWindow,
        runtime: {
          platform: process.platform,
          arch: process.arch,
          electronVersion: process.versions.electron,
        },
      }),
      (url) => isTrustedRendererUrl(url, { rendererRoot, devServerUrl }),
    )

    mainWindow = createMainWindow({ preloadPath, rendererRoot, devServerUrl })
    mainWindow.on('closed', () => {
      mainWindow = null
    })
  })
}
```

- [ ] **Step 11: Implement the preload bridge**

`src/preload/index.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcArgs, IpcChannel, IpcResult, StorageIQApi } from '@shared/ipc-contract'

function invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<C>>
}

const api: StorageIQApi = {
  getAppInfo: () => invoke('app:get-info'),
  selectFolder: () => invoke('dialog:select-folder'),
}

contextBridge.exposeInMainWorld('storageiq', api)
```

- [ ] **Step 12: Run quality gates**

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
```

Expected: 17 tests pass and every command exits 0. The app is first launched in Task 4, once the renderer exists.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat(main): secure window, typed IPC registration and preload bridge"
```

---

### Task 3: Renderer state (Zustand)

**Files:**

- Create: `src/renderer/src/test/fake-api.ts`, `src/renderer/src/stores/app-store.ts`, `src/renderer/src/stores/app-store-context.tsx`
- Test: `src/renderer/src/stores/app-store.test.ts`

**Interfaces:**

- Consumes: `AppInfo`, `SelectFolderResult`, `StorageIQApi` (Task 1).
- Produces:
  - `TEST_APP_INFO: AppInfo`, `createFakeApi(overrides?: Partial<StorageIQApi>): StorageIQApi`
  - `LoadStatus = 'idle' | 'loading' | 'ready' | 'error'`
  - `AppState { appInfo; appInfoStatus; scanTarget; folderPickerOpen; errorMessage; loadAppInfo(); chooseFolder(); dismissError() }`
  - `AppStore = StoreApi<AppState>`, `createAppStore(api: StorageIQApi): AppStore`
  - `<AppStoreProvider store>`, `useAppStore<T>(selector: (s: AppState) => T): T`
  - Error copy: `StorageIQ couldn’t open the folder picker. Please try again.`

- [ ] **Step 1: Write the fake API helper**

`src/renderer/src/test/fake-api.ts`:

```ts
import { vi } from 'vitest'
import type { AppInfo, SelectFolderResult, StorageIQApi } from '@shared/ipc-contract'

export const TEST_APP_INFO: AppInfo = {
  name: 'StorageIQ',
  version: '0.1.0',
  platform: 'win32',
  arch: 'x64',
  electronVersion: '38.0.0',
}

export function createFakeApi(overrides: Partial<StorageIQApi> = {}): StorageIQApi {
  return {
    getAppInfo: vi.fn(async () => TEST_APP_INFO),
    selectFolder: vi.fn(async (): Promise<SelectFolderResult> => ({ canceled: true })),
    ...overrides,
  }
}
```

- [ ] **Step 2: Write the failing store tests**

`src/renderer/src/stores/app-store.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { AppInfo, SelectFolderResult } from '@shared/ipc-contract'
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
  it('starts idle with no folder selected', () => {
    const state = createAppStore(createFakeApi()).getState()
    expect(state).toMatchObject({
      appInfo: null,
      appInfoStatus: 'idle',
      scanTarget: null,
      folderPickerOpen: false,
      errorMessage: null,
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
  })

  describe('chooseFolder', () => {
    it('stores the folder the user picked', async () => {
      const api = createFakeApi({
        selectFolder: vi.fn().mockResolvedValue({ canceled: false, path: 'D:\\Photos' }),
      })
      const store = createAppStore(api)
      await store.getState().chooseFolder()
      expect(store.getState()).toMatchObject({ scanTarget: 'D:\\Photos', folderPickerOpen: false })
    })

    it('keeps the previous folder when the user cancels', async () => {
      const selectFolder = vi
        .fn<() => Promise<SelectFolderResult>>()
        .mockResolvedValueOnce({ canceled: false, path: 'D:\\Photos' })
        .mockResolvedValueOnce({ canceled: true })
      const store = createAppStore(createFakeApi({ selectFolder }))

      await store.getState().chooseFolder()
      await store.getState().chooseFolder()

      expect(store.getState().scanTarget).toBe('D:\\Photos')
    })

    it('ignores a second request while the picker is already open', async () => {
      const pending = deferred<SelectFolderResult>()
      const api = createFakeApi({ selectFolder: vi.fn(() => pending.promise) })
      const store = createAppStore(api)

      const first = store.getState().chooseFolder()
      expect(store.getState().folderPickerOpen).toBe(true)
      await store.getState().chooseFolder()
      pending.resolve({ canceled: true })
      await first

      expect(api.selectFolder).toHaveBeenCalledTimes(1)
      expect(store.getState().folderPickerOpen).toBe(false)
    })

    it('shows a friendly error when the picker fails, and can dismiss it', async () => {
      const api = createFakeApi({ selectFolder: vi.fn().mockRejectedValue(new Error('IPC down')) })
      const store = createAppStore(api)

      await store.getState().chooseFolder()
      expect(store.getState()).toMatchObject({
        folderPickerOpen: false,
        errorMessage: 'StorageIQ couldn’t open the folder picker. Please try again.',
      })

      store.getState().dismissError()
      expect(store.getState().errorMessage).toBeNull()
    })
  })
})
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npx vitest run src/renderer/src/stores`
Expected: FAIL. It cannot resolve `./app-store`.

- [ ] **Step 4: Implement the store**

`src/renderer/src/stores/app-store.ts`:

```ts
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { AppInfo, StorageIQApi } from '@shared/ipc-contract'

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface AppState {
  appInfo: AppInfo | null
  appInfoStatus: LoadStatus
  /** Folder the user chose; Phase 2 scans it. */
  scanTarget: string | null
  folderPickerOpen: boolean
  errorMessage: string | null
  loadAppInfo(): Promise<void>
  chooseFolder(): Promise<void>
  dismissError(): void
}

export type AppStore = StoreApi<AppState>

const FOLDER_PICKER_ERROR = 'StorageIQ couldn’t open the folder picker. Please try again.'

export function createAppStore(api: StorageIQApi): AppStore {
  return createStore<AppState>()((set, get) => ({
    appInfo: null,
    appInfoStatus: 'idle',
    scanTarget: null,
    folderPickerOpen: false,
    errorMessage: null,

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

    async chooseFolder() {
      if (get().folderPickerOpen) return
      set({ folderPickerOpen: true, errorMessage: null })
      try {
        const result = await api.selectFolder()
        set(
          result.canceled
            ? { folderPickerOpen: false }
            : { folderPickerOpen: false, scanTarget: result.path },
        )
      } catch {
        set({ folderPickerOpen: false, errorMessage: FOLDER_PICKER_ERROR })
      }
    },

    dismissError() {
      set({ errorMessage: null })
    },
  }))
}
```

- [ ] **Step 5: Implement the React binding**

`src/renderer/src/stores/app-store-context.tsx`:

```tsx
import { createContext, type ReactNode, useContext } from 'react'
import { useStore } from 'zustand'
import type { AppState, AppStore } from './app-store'

const AppStoreContext = createContext<AppStore | null>(null)

export function AppStoreProvider({ store, children }: { store: AppStore; children: ReactNode }) {
  return <AppStoreContext.Provider value={store}>{children}</AppStoreContext.Provider>
}

export function useAppStore<T>(selector: (state: AppState) => T): T {
  const store = useContext(AppStoreContext)
  if (!store) {
    throw new Error('useAppStore must be used inside <AppStoreProvider>')
  }
  return useStore(store, selector)
}
```

- [ ] **Step 6: Run the tests and quality gates**

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
```

Expected: 25 tests pass (17 + 8) and every command exits 0.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(renderer): app store with app info and folder selection"
```

---

### Task 4: Design tokens & app shell UI

**Files:**

- Create: `DESIGN.md`, `src/renderer/index.html`, `src/renderer/src/env.d.ts`, `src/renderer/src/styles/global.css`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/components/WelcomePanel.tsx`, `src/renderer/src/components/StatusBar.tsx`
- Test: `src/renderer/src/App.test.tsx`

**Interfaces:**

- Consumes: `createAppStore`, `AppStoreProvider`, `useAppStore` (Task 3); `createFakeApi`, `TEST_APP_INFO` (Task 3); `WINDOW_BACKGROUND` values (Task 2).
- Produces: Tailwind token utilities used by every later phase: `bg-app`, `bg-panel`, `bg-sunken`, `border-line`, `text-ink`, `text-ink-muted`, `bg-accent`, `hover:bg-accent-hover`, `text-on-accent`, `text-danger`, `border-danger`, `font-display`, `font-mono`, `rounded-control`, `rounded-panel`.

- [ ] **Step 1: Load design guidance** (see Global Constraints)

Run `impeccable context`, read `reference/craft-floor.md`, and run the two `modern-web-guidance` searches. If a guide conflicts with the code below, follow the guide and record the change in `DESIGN.md`.

- [ ] **Step 2: Write `DESIGN.md`**

```markdown
# StorageIQ Design System

Mode: **Operate.** StorageIQ is a tool. Clarity, scannability and Windows-native expectations come before visual expression. Character shows in precise details: a calm teal accent, tabular numbers and monospaced paths.

## Principles

1. Feel at home on Windows 11: Segoe UI Variable, 4 px control radius, 8 px panel radius, native title bar.
2. Data first: numbers use tabular figures; paths use Cascadia Mono; nothing decorative competes with sizes.
3. One accent, used only for the primary action and focus.
4. Follow the system light/dark theme; no custom theme switcher in the MVP.
5. Respect `prefers-reduced-motion`; motion is never needed to understand state.

## Tokens (source: `src/renderer/src/styles/global.css`)

| Token               | Light     | Dark      | Utility                                                                   |
| ------------------- | --------- | --------- | ------------------------------------------------------------------------- |
| `--surface-app`     | `#f6f7f7` | `#161a1b` | `bg-app` (must equal `WINDOW_BACKGROUND` in `src/main/window-options.ts`) |
| `--surface-panel`   | `#ffffff` | `#1e2324` | `bg-panel`                                                                |
| `--surface-sunken`  | `#eef0f0` | `#121516` | `bg-sunken`                                                               |
| `--border`          | `#dde1e1` | `#2e3536` | `border-line`                                                             |
| `--text`            | `#1b2122` | `#e6eaea` | `text-ink`                                                                |
| `--text-muted`      | `#5b6667` | `#9aa5a6` | `text-ink-muted`                                                          |
| `--accent`          | `#0f7a73` | `#4fc1b6` | `bg-accent`                                                               |
| `--accent-hover`    | `#0c655f` | `#6fd0c6` | `hover:bg-accent-hover`                                                   |
| `--accent-contrast` | `#ffffff` | `#062421` | `text-on-accent`                                                          |
| `--danger`          | `#b3261e` | `#f2b8b5` | `text-danger`, `border-danger`                                            |

Typography: body 14 px / 1.43 `Segoe UI Variable Text`; headings `Segoe UI Variable Display`; status text 12 px; paths `Cascadia Mono` 13 px.

Text contrast meets WCAG 2.2 AA in both themes. Focus is a 2 px accent outline with a 2 px offset.
```

- [ ] **Step 3: Write the HTML entry, env typings and global CSS**

`src/renderer/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>StorageIQ</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/renderer/src/env.d.ts`:

```ts
/// <reference types="vite/client" />
import type { StorageIQApi } from '@shared/ipc-contract'

declare global {
  interface Window {
    storageiq: StorageIQApi
  }
}

export {}
```

`src/renderer/src/styles/global.css`:

```css
@import 'tailwindcss';

:root {
  color-scheme: light dark;
  --surface-app: #f6f7f7;
  --surface-panel: #ffffff;
  --surface-sunken: #eef0f0;
  --border: #dde1e1;
  --text: #1b2122;
  --text-muted: #5b6667;
  --accent: #0f7a73;
  --accent-hover: #0c655f;
  --accent-contrast: #ffffff;
  --danger: #b3261e;
}

@media (prefers-color-scheme: dark) {
  :root {
    --surface-app: #161a1b;
    --surface-panel: #1e2324;
    --surface-sunken: #121516;
    --border: #2e3536;
    --text: #e6eaea;
    --text-muted: #9aa5a6;
    --accent: #4fc1b6;
    --accent-hover: #6fd0c6;
    --accent-contrast: #062421;
    --danger: #f2b8b5;
  }
}

@theme inline {
  --color-app: var(--surface-app);
  --color-panel: var(--surface-panel);
  --color-sunken: var(--surface-sunken);
  --color-line: var(--border);
  --color-ink: var(--text);
  --color-ink-muted: var(--text-muted);
  --color-accent: var(--accent);
  --color-accent-hover: var(--accent-hover);
  --color-on-accent: var(--accent-contrast);
  --color-danger: var(--danger);
  --font-sans: 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
  --font-display: 'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'Cascadia Mono', Consolas, ui-monospace, monospace;
  --radius-control: 4px;
  --radius-panel: 8px;
}

@layer base {
  html,
  body,
  #root {
    height: 100%;
  }

  body {
    margin: 0;
    background-color: var(--surface-app);
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 1.43;
  }

  :focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    ::before,
    ::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
}
```

- [ ] **Step 4: Write the failing App tests**

`src/renderer/src/App.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { StorageIQApi } from '@shared/ipc-contract'
import { App } from './App'
import { createAppStore } from './stores/app-store'
import { AppStoreProvider } from './stores/app-store-context'
import { createFakeApi, TEST_APP_INFO } from './test/fake-api'

function renderApp(api: StorageIQApi = createFakeApi()) {
  const store = createAppStore(api)
  render(
    <AppStoreProvider store={store}>
      <App />
    </AppStoreProvider>,
  )
  return store
}

describe('<App />', () => {
  it('greets the user and shows the version from the main process', async () => {
    renderApp()
    expect(
      screen.getByRole('heading', { level: 1, name: 'See what’s filling your disk' }),
    ).toBeInTheDocument()
    expect(screen.getByText('No folder selected')).toBeInTheDocument()
    expect(await screen.findByText(`StorageIQ ${TEST_APP_INFO.version}`)).toBeInTheDocument()
  })

  it('shows the chosen folder after the user picks one', async () => {
    const user = userEvent.setup()
    renderApp(
      createFakeApi({
        selectFolder: vi.fn().mockResolvedValue({ canceled: false, path: 'D:\\Photos' }),
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Choose folder' }))

    expect(await screen.findByText('Selected folder')).toBeInTheDocument()
    expect(screen.getAllByText('D:\\Photos')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Choose a different folder' })).toBeInTheDocument()
  })

  it('shows a dismissible error when the folder picker fails', async () => {
    const user = userEvent.setup()
    renderApp(createFakeApi({ selectFolder: vi.fn().mockRejectedValue(new Error('IPC down')) }))

    await user.click(screen.getByRole('button', { name: 'Choose folder' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('StorageIQ couldn’t open the folder picker. Please try again.')

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 5: Run the test and confirm it fails**

Run: `npx vitest run src/renderer/src/App.test.tsx`
Expected: FAIL. It cannot resolve `./App`.

- [ ] **Step 6: Implement the components**

`src/renderer/src/components/WelcomePanel.tsx`:

```tsx
import { useId } from 'react'
import { useAppStore } from '../stores/app-store-context'

export function WelcomePanel() {
  const scanTarget = useAppStore((s) => s.scanTarget)
  const folderPickerOpen = useAppStore((s) => s.folderPickerOpen)
  const errorMessage = useAppStore((s) => s.errorMessage)
  const chooseFolder = useAppStore((s) => s.chooseFolder)
  const dismissError = useAppStore((s) => s.dismissError)
  const headingId = useId()

  return (
    <section
      aria-labelledby={headingId}
      className="mx-auto flex w-full max-w-xl flex-col items-start gap-4 px-8 py-16"
    >
      <h1 id={headingId} className="font-display text-2xl font-semibold tracking-tight">
        See what’s filling your disk
      </h1>
      <p className="text-ink-muted">
        Choose a folder and StorageIQ will show which folders and files take up the most space.
      </p>

      {scanTarget !== null && (
        <div className="w-full rounded-panel border border-line bg-panel px-4 py-3">
          <p className="text-xs font-medium text-ink-muted">Selected folder</p>
          <p className="mt-1 font-mono text-[13px] break-all">{scanTarget}</p>
        </div>
      )}

      <button
        type="button"
        onClick={() => void chooseFolder()}
        disabled={folderPickerOpen}
        className="rounded-control bg-accent px-4 py-2 font-medium text-on-accent hover:bg-accent-hover disabled:cursor-default disabled:opacity-60"
      >
        {scanTarget === null ? 'Choose folder' : 'Choose a different folder'}
      </button>

      {errorMessage !== null && (
        <div
          role="alert"
          className="flex w-full items-start justify-between gap-4 rounded-panel border border-danger/40 px-4 py-3 text-danger"
        >
          <p>{errorMessage}</p>
          <button
            type="button"
            onClick={dismissError}
            className="shrink-0 rounded-control px-2 font-medium underline-offset-2 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}
    </section>
  )
}
```

`src/renderer/src/components/StatusBar.tsx`:

```tsx
import { useAppStore } from '../stores/app-store-context'

export function StatusBar() {
  const scanTarget = useAppStore((s) => s.scanTarget)
  const appInfo = useAppStore((s) => s.appInfo)

  return (
    <footer className="flex h-7 items-center justify-between gap-4 border-t border-line bg-panel px-3 text-xs text-ink-muted">
      <span className="min-w-0 truncate" title={scanTarget ?? undefined}>
        {scanTarget ?? 'No folder selected'}
      </span>
      {appInfo !== null && (
        <span className="shrink-0 tabular-nums">StorageIQ {appInfo.version}</span>
      )}
    </footer>
  )
}
```

`src/renderer/src/App.tsx`:

```tsx
import { useEffect } from 'react'
import { StatusBar } from './components/StatusBar'
import { WelcomePanel } from './components/WelcomePanel'
import { useAppStore } from './stores/app-store-context'

export function App() {
  const loadAppInfo = useAppStore((s) => s.loadAppInfo)

  useEffect(() => {
    void loadAppInfo()
  }, [loadAppInfo])

  return (
    <div className="grid h-full grid-rows-[1fr_auto] bg-app text-ink">
      <main className="min-h-0 overflow-auto">
        <WelcomePanel />
      </main>
      <StatusBar />
    </div>
  )
}
```

`src/renderer/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createAppStore } from './stores/app-store'
import { AppStoreProvider } from './stores/app-store-context'
import './styles/global.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('StorageIQ: #root element is missing from index.html')
}

const store = createAppStore(window.storageiq)

createRoot(container).render(
  <StrictMode>
    <AppStoreProvider store={store}>
      <App />
    </AppStoreProvider>
  </StrictMode>,
)
```

- [ ] **Step 7: Run the tests and quality gates**

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
```

Expected: 28 tests pass (25 + 3) and every command exits 0.

- [ ] **Step 8: Launch and verify by eye**

Run: `npm run dev`
Check each of the following:

1. The window opens without a white flash and is titled "StorageIQ".
2. The heading, body copy and teal "Choose folder" button render in Segoe UI Variable.
3. The status bar shows "No folder selected" and "StorageIQ 0.1.0".
4. Clicking "Choose folder" opens the native folder dialog. Picking a folder shows the "Selected folder" card, the button changes to "Choose a different folder", and the status bar shows the path.
5. Canceling the dialog leaves the previous state unchanged.
6. Tab moves focus to the button with a visible 2 px teal ring, and Enter or Space activates it.
7. Switching Windows to dark mode (Settings → Personalization → Colors) changes the theme live.
8. The DevTools console shows no CSP violations.

Then run `impeccable detect --json` on the renderer files changed in this task. Fix any findings, then rerun the gates from Step 7.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(renderer): design tokens and app shell with folder selection"
```

---

### Task 5: End-to-end smoke test

**Files:**

- Create: `playwright.config.ts`, `e2e/app.spec.ts`

**Interfaces:**

- Consumes: the built app (`out/`), the UI strings from Global Constraints, and the `dialog.showOpenDialog` lookup made at call time in `createAppHandlers` (Task 2). That lookup is what lets the test replace the dialog.
- Produces: `npm run test:e2e` as a CI gate.

- [ ] **Step 1: Write the Playwright config**

`playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure' },
})
```

- [ ] **Step 2: Write the E2E tests**

`e2e/app.spec.ts`:

```ts
import {
  _electron as electron,
  type ElectronApplication,
  expect,
  type Page,
  test,
} from '@playwright/test'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  app = await electron.launch({ args: ['.'] })
  page = await app.firstWindow()
})

test.afterEach(async () => {
  await app.close()
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
})

test('shows the version reported by the main process', async () => {
  const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion())
  await expect(page.getByText(`StorageIQ ${version}`)).toBeVisible()
})

test('shows the folder chosen in the native picker', async () => {
  await app.evaluate(({ dialog }) => {
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
```

- [ ] **Step 3: Run the E2E suite**

Run: `npm run test:e2e`
Expected: the build succeeds and 3 tests pass. If the window never appears, check that `out/preload/index.js` exists. A sandboxed preload must be CommonJS: if electron-vite emitted `index.mjs`, make sure `package.json` has no `"type": "module"`.

- [ ] **Step 4: Run quality gates and commit**

```bash
npm run typecheck
npm run lint
npm run format:check
git add -A
git commit -m "test(e2e): Playwright smoke tests for launch, security and folder picking"
```

---

### Task 6: Packaging (NSIS, x64, per-user)

**Files:**

- Create: `electron-builder.yml`

**Interfaces:**

- Consumes: `npm run build` output in `out/`; `package.json` `version`, `productName`, `author`, `description`.
- Produces: `release/0.1.0/StorageIQ-Setup-0.1.0-x64.exe` via `npm run dist`.

- [ ] **Step 1: Write the builder config**

`electron-builder.yml`:

```yaml
appId: io.github.storageiq.app
productName: StorageIQ
copyright: Copyright © 2026 StorageIQ contributors

directories:
  output: release/${version}
  buildResources: build

files:
  - out/**/*
  - package.json
  - '!**/*.map'

asar: true

win:
  target:
    - target: nsis
      arch:
        - x64
  artifactName: ${productName}-Setup-${version}-${arch}.${ext}

nsis:
  oneClick: false
  perMachine: false
  allowElevation: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: StorageIQ
  uninstallDisplayName: StorageIQ
```

The app uses Electron's default icon in Phase 1. A custom icon will go in `build/icon.ico` before the first public release (tracked in the roadmap release checklist).

- [ ] **Step 2: Build the installer**

Run: `npm run dist`
Expected: `release/0.1.0/StorageIQ-Setup-0.1.0-x64.exe` exists. electron-builder may warn that the app is unsigned and uses the default icon; that is expected in Phase 1.

- [ ] **Step 3: Verify the package contents**

Run: `npx @electron/asar list release/0.1.0/win-unpacked/resources/app.asar`
Expected: only `\package.json` and paths under `\out\` are listed. There is no `src`, `node_modules`, `e2e` or `.map`.

- [ ] **Step 4: Verify the installer manually**

1. Run the installer. It installs without a UAC prompt into `%LOCALAPPDATA%\Programs\StorageIQ` by default.
2. Launch StorageIQ from the Start menu. The status bar shows "StorageIQ 0.1.0", and the window has no menu bar.
3. Start a second copy. The first window is focused and no second window opens.
4. Uninstall it from Settings → Apps. The install folder is removed.

- [ ] **Step 5: Commit**

```bash
git add electron-builder.yml
git commit -m "build: NSIS per-user x64 installer via electron-builder"
```

---

### Task 7: CI workflow, README & roadmap update

**Files:**

- Create: `.github/workflows/ci.yml`, `README.md`
- Modify: `docs/ROADMAP.md` (status table + Phase 1 checklist)

**Interfaces:**

- Consumes: npm scripts from Task 1, `test:e2e` from Task 5, `electron-builder.yml` from Task 6.
- Produces: a required CI check on `main` and pull requests, plus an uploaded installer artifact.

- [ ] **Step 1: Write the CI workflow**

`.github/workflows/ci.yml`:

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
          node-version: 22
          cache: npm

      - run: npm ci
      - run: npm run format:check
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run test:e2e

      - name: Package installer
        run: npx electron-builder --win --x64 --publish never

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

- [ ] **Step 2: Write `README.md`**

````markdown
# StorageIQ

A free, open-source disk space analyzer for Windows. StorageIQ scans a drive or folder and shows which folders and files use the most space, so you can decide what to clean up.

> **Status:** early development (Phase 1, Project Foundation). Scanning arrives in Phase 2. See the [roadmap](docs/ROADMAP.md).

## Requirements

- Windows 10 (1809 or later) or Windows 11, x64
- Node.js 22 or later (for development)

## Development

```bash
npm install
npm run dev          # start the app with hot reload
npm test             # unit tests (Vitest)
npm run test:e2e     # build, then run Electron end-to-end tests (Playwright)
npm run typecheck
npm run lint
npm run dist         # build the Windows installer into release/<version>/
```

Installers are currently unsigned, so Windows SmartScreen will warn on first run.

## Architecture

- `src/main`: Electron main process (window, security policy, IPC handlers)
- `src/preload`: the only bridge to the renderer (`window.storageiq`)
- `src/renderer`: React UI (Tailwind, Zustand)
- `src/shared`: types shared by every process, including the IPC contract

Security baseline: context isolation, sandboxed renderer, no Node integration, strict CSP, blocked navigation and pop-ups, and a sender check on every IPC call. Read [docs/ROADMAP.md](docs/ROADMAP.md) for the architecture decisions.

## License

[MIT](LICENSE)
````

- [ ] **Step 3: Update the roadmap**

In `docs/ROADMAP.md`:

- Set **Current phase** to `Phase 2 — Filesystem Scanner (next)` and **Last updated** to the completion date.
- Change the Phase 1 status cell to `**Done**` and Phase 2 to `**Next**`.
- Tick every Phase 1 task checkbox.
- Add a `### Phase 1 — Outcome` section that records the installed Electron version (Task 1, Step 3) and any deviation from this plan.

- [ ] **Step 4: Final verification of the whole phase**

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run dist
```

Expected: everything exits 0, with 28 unit tests and 3 E2E tests passing. The installer exists in `release/0.1.0/`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "ci: Windows CI pipeline, README and Phase 1 completion"
```

---

## Phase 1 Acceptance Criteria

1. `npm install && npm run dev` on a clean Windows 10/11 x64 machine with Node 22 opens the StorageIQ window, with no white flash and no console errors or CSP violations.
2. The renderer runs with context isolation and a sandbox and has no Node access: the E2E test proves `require` and `process` are undefined and `storageiq` is the only bridge.
3. Every IPC channel is defined once in `src/shared/ipc-contract.ts`. A mismatched channel name or payload fails `npm run typecheck`, and a call from an untrusted sender is rejected (unit-tested).
4. The user can choose a folder through the native dialog. The path appears in the panel and the status bar. Cancel keeps the previous choice, and a failed picker shows a dismissible, plain-language error.
5. The status bar shows `StorageIQ <version>`, using the version the main process reports.
6. The UI follows the Windows light/dark setting live, is fully keyboard-operable with a visible focus ring, and meets WCAG 2.2 AA text contrast.
7. `format:check`, `lint`, `typecheck`, 28 unit tests and 3 E2E tests pass locally and in GitHub Actions on `windows-latest`.
8. `npm run dist` produces `StorageIQ-Setup-0.1.0-x64.exe`. It installs per-user without a UAC prompt, enforces a single instance, packages only `out/` and `package.json`, and uninstalls cleanly.
9. `docs/ROADMAP.md` marks Phase 1 done and names Phase 2 as next.

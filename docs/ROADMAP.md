# StorageIQ — Product & Technical Roadmap

Living document owned by the technical lead. Update it whenever a phase completes: tick tasks, record decisions, and name the next phase.

**Current phase:** Phase 3 — Analyzer Workspace
**Last updated:** 2026-11-19

---

## Product Vision

**"Shows where your disk space went, and explains it in plain words."**

StorageIQ is a free, open-source Windows disk-space analyzer for everyday users. Point it at a drive or folder and it shows which folders and files are using the space and explains the well-known ones in plain language. Its totals are honest: they match what Windows reports, or the app explains the difference. It covers what paid disk analyzers sell (tree view, largest files, treemap, duplicates, history, export) at no cost and under the MIT license. It has no nags and needs no account. We make no speed claims beyond what was measured, and never name competitors in marketing.

Scope and ordering follow the research-driven [Roadmap v2 spec](superpowers/specs/2026-11-18-roadmap-v2-research-driven-design.md), approved 2026-11-18.

Target user: general consumers on Windows 10 1809+ / Windows 11 (x64) who have run out of disk space. Full product record: [PRODUCT.md](../PRODUCT.md).

## MVP Scope (Phases 1–4)

In scope:

| Capability                                                                                  | Phase |
| ------------------------------------------------------------------------------------------- | ----- |
| Secure Electron shell, typed IPC, design tokens, tests, installer, CI                       | 1     |
| Pick a drive or a folder to scan                                                            | 2a    |
| Recursive traversal without following junctions/symlinks                                    | 2a    |
| Folder size (logical bytes), file count and folder count per folder                         | 2a    |
| Live progress (files, folders, bytes, current path, elapsed time)                           | 2a    |
| Largest folders shown while the scan is still running                                       | 2a, 3 |
| Cancel a running scan                                                                       | 2a    |
| Report folders that could not be read (access denied, etc.)                                 | 2a    |
| Online-only (OneDrive) files kept out of on-disk totals, never downloaded                   | 2b    |
| Hardlinks counted once                                                                      | 2b    |
| "Windows reports X used; StorageIQ found Y" reconciliation                                  | 2b    |
| Tree view sorted by size, with lazy expansion, % of parent, counts, "Open in Explorer"      | 3     |
| Largest files view (top N, path, size, modified date)                                       | 4     |
| Plain-language "what is this / is it safe to clean up" labels for about 30 known space hogs | 4     |
| "Copy as CSV" for the visible list                                                          | 4     |

Out of scope for the MVP: treemap, full export, history/SQLite, duplicate finder, AI, deleting files, network shares/UNC paths, elevation, MFT/NTFS-journal fast scanning, ARM64, macOS/Linux.

## Architecture

```
┌──────────────────────────── Electron main process ───────────────────────────┐
│ app lifecycle · single-instance lock · window · security policy · menus       │
│ IPC router (typed contract, sender validation)                                │
│        │ spawns / messages (Phase 2)                                          │
│        ▼                                                                       │
│ ┌──────────── Scanner utilityProcess (Phase 2) ───────────┐                    │
│ │ fs.opendir traversal · aggregation · progress batching   │                    │
│ │ cancellation via AbortSignal · result tree in memory     │                    │
│ └──────────────────────────────────────────────────────────┘                   │
│ SQLite (better-sqlite3) — scan history only (Phase 7)                          │
└──────────────▲────────────────────────────────────────────────────────────────┘
               │ ipcRenderer.invoke / events — only through contextBridge
┌──────────────┴────────── preload (sandboxed, CommonJS) ───────────────────────┐
│ window.storageiq: StorageIQApi — the only surface the renderer can reach      │
└──────────────▲────────────────────────────────────────────────────────────────┘
┌──────────────┴────────── renderer (React, sandboxed, no Node) ────────────────┐
│ Zustand stores (vanilla store + hook) · views · Tailwind design tokens        │
└───────────────────────────────────────────────────────────────────────────────┘
```

Key decisions (ADR-style; change only with a recorded reason):

1. **electron-vite** builds the three targets (main, preload, renderer) with one config and HMR. It is simpler than Forge + Webpack.
2. **Security baseline:** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict CSP, navigation and `window.open` blocked, and every IPC call checks its sender origin. The renderer never gets raw `ipcRenderer`.
3. **One typed IPC contract** (`src/shared/ipc-contract.ts`) defines every channel's argument and result types. The main process registers handlers against it, and the preload exposes an API typed from it, so a channel mismatch fails at compile time.
4. **Main-process code depends on interfaces, not on Electron directly** (factories receive `dialog`, `app`, `ipcMain`), so it can be unit-tested in Node without Electron.
5. **Scanner runs in an Electron `utilityProcess`** (Phase 2), not in main and not in the renderer. A heavy scan can never freeze the window, and a scanner crash cannot take down the app. It traverses with `fs.promises.opendir` + `lstat` (streamed directory reads, metadata only, so it never downloads OneDrive placeholders) and does not follow reparse points. About every 250 ms it sends progress plus a snapshot of the largest folders found so far, so the tree can draw during the scan. From Phase 2b, koffi (a prebuilt FFI library) reads Windows file attributes to detect online-only cloud files.
6. **Zustand vanilla stores built by a factory with an injected API**, so store logic can be tested without Electron. Components use `useAppStore(selector)`, a typed hook built on Zustand's `useStore`.
7. **SQLite is delayed until Phase 7.** The MVP keeps scan results in memory. The planned engine is better-sqlite3 (synchronous, fast, and rebuilt for Electron by electron-builder's `install-app-deps`).
8. **Packaging:** electron-builder with an NSIS per-user installer for x64. It needs no admin rights, which matches the consumer audience.

## Folder Structure

```
StorageIQ/
├─ .github/workflows/ci.yml        # lint · typecheck · unit · build · e2e (windows-latest)
├─ build/                          # electron-builder resources (icons) — Phase 1 ships without a custom icon
├─ docs/
│  ├─ ROADMAP.md                   # this file
│  └─ superpowers/plans/           # one implementation plan per phase
├─ e2e/                            # Playwright Electron tests
├─ src/
│  ├─ shared/                      # types shared by all processes (no runtime deps)
│  ├─ main/                        # Electron main process
│  │  ├─ ipc/                      # contract registration + handler factories
│  │  └─ scan/ · drives/            # scan service (forks the scanner) · drive listing (koffi)
│  ├─ preload/                     # contextBridge API
│  ├─ worker/scanner/              # scanner utilityProcess: walk, tree, top folders (out/main/scanner.js)
│  └─ renderer/
│     ├─ index.html
│     └─ src/
│        ├─ components/            # shell & shared UI
│        ├─ features/              # (Phase 2+) scan, tree, largest-files, ...
│        ├─ stores/                # Zustand store factories
│        ├─ lib/                   # formatting, api access
│        └─ styles/                # Tailwind entry + tokens
├─ electron.vite.config.ts
├─ electron-builder.yml
├─ vitest.config.mts · playwright.config.ts · eslint.config.mjs
├─ PRODUCT.md · DESIGN.md · README.md · LICENSE
```

## Roadmap

Roadmap v3, approved 2026-11-19 ([spec](superpowers/specs/2026-11-19-phase-3-workspace-design.md) §2). It supersedes the phase order of roadmap v2; the Phase 2a scanner, IPC and drive code stay.

| #   | Phase              | Status                                                                      | Exit criterion                                                                                                                                                  |
| --- | ------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Foundation         | **Done**                                                                    | Secure app shell, typed IPC, tests, installer, CI                                                                                                               |
| 2a  | Core scanner       | **Done** (merged in PR #1)                                                  | Scans a drive in a utilityProcess with live progress, cancel and unreadable folders listed                                                                      |
| 3   | Analyzer workspace | **In progress** — [plan](superpowers/plans/2026-11-19-phase-3-workspace.md) | Ribbon, Select menu, virtualized column tree, file-type treemap with legend (Level 0–5, hideable), Explorer context menu, status bar; 1M-file perf limits in CI |
| 4   | Side views         | Not started                                                                 | Top files, file types, file age                                                                                                                                 |
| 5   | Charts and export  | Not started                                                                 | Pie and bar charts; CSV and Excel export                                                                                                                        |
| 6   | Actions            | Not started                                                                 | Delete to Recycle Bin with confirmation, search — **MVP complete; first GitHub release**                                                                        |
| 7+  | Post-MVP           | Not started                                                                 | Honest totals (cloud-only files, hardlinks, real size of locked system files, reconciliation), duplicates, scan history, plain-language explanations, AI        |

### Phase 1 — Project Foundation (task checklist)

- [x] T1 Repository, toolchain & shared IPC contract (trusted-URL policy)
- [x] T2 Main process & preload bridge (secure window, typed IPC, sender validation; hardened after review)
- [x] T3 Renderer state (Zustand store + React binding)
- [x] T4 Design tokens, DESIGN.md & app shell UI
- [x] T5 End-to-end smoke test (Playwright + Electron)
- [x] T6 Packaging (electron-builder NSIS x64, per-user)
- [x] T7 CI workflow, README & roadmap update

### Phase 1 — Outcome

Installed versions: Electron 45.3.4 (Node 24.22.3), electron-vite 6.0.0, Vite 8.3.8, TypeScript 6.0.3, React 19.3.1, Tailwind 4.3.5, Zustand 5.1.0, Vitest 5.1.1, Playwright 1.65.1, electron-builder 26.18.0.

Tests: 49 unit tests and 4 E2E tests (after the final-review fix wave).

Process: each of the 7 tasks was implemented with Sonnet and reviewed for spec compliance and quality. The whole branch then got a final review on Opus (no Critical findings), followed by one fix wave and a scoped re-review (all 20 items addressed).

Still open before Phase 1 is fully closed:

- [ ] CI run green on GitHub (no remote yet).
- [ ] The owner's manual checks: the UI via `npm run dev` (criteria 1 and 6), and install → launch → second launch → uninstall (criterion 8).

### Phase 2a — Core Scanner (task checklist)

- [x] T1 E2E console and CSP listeners attached before the first page load
- [x] T2 IPC infrastructure: `Pick` handler factories, per-channel `parseArgs`, typed events, `sendEvent`, preload `onX`
- [x] T3 Scanner core: concurrent walk (≤ 16 directories, no reparse points, AbortSignal), folder tree, top folders
- [x] T4 Scanner utilityProcess, scan service (relay, supersede, crash → `scan:failed`, kill on quit), `render-process-gone` policy
- [x] T5 Drives through koffi (fixed + removable), `drives:list`, packaged self-test
- [x] T6 Scan store and the pick, scanning, result and crash screens
- [x] T7 Scan E2E, explicit CI build step, packaged check, report-only metrics

### Phase 2a — Outcome

All automated gates are green locally (format, lint, typecheck, unit, E2E, packaged self-test); CI on GitHub has not run yet (no remote). Still pending: the owner's manual checks.

- [ ] CI run green on GitHub (needs a remote)
- [ ] Phase 2b: read the real size of locked system files (pagefile.sys, hiberfil.sys, swapfile.sys, DumpStack.log.tmp), which fail lstat with EPERM and are counted today as 0-byte files. Use the size from the directory listing (FindFirstFileExW through koffi) so totals include them.

koffi 3.3.8 (runtime dependency, unpacked from the asar, `npmRebuild: false`).

Metrics (report only, from the Task 7 run): renderer bundle 594.0 kB, installer 116.2 MB, idle RAM 341 MB, scan of 20,000 generated files 0.4 s, cancel latency 57 ms.

Deviations from Phase 1 conventions (recorded here, approved with the plan):

- koffi is a runtime `dependency`, not a dev dependency, because its native module ships in the app.
- `--self-test` command-line switch: lists drives, checks koffi is in `app.asar.unpacked`, runs one scan in the scanner process, exits with a status code (`npm run test:packaged`).
- E2E launches Electron with `-r e2e/support/capture-console.cjs` (test-only) to attach listeners before the first page load.
- The scanner sets `process.noAsar = true` so `.asar` archives on disk count as files.

### Carry-over into the Phase 2a plan

These came from the Phase 1 reviews. The Phase 2a plan must schedule each one; none may be dropped silently.

1. **First task:** attach the E2E console and `securitypolicyviolation` listeners before the first page load (`app.on('window')` or an init script). Today they attach after `firstWindow()`, so errors during startup could go unseen. — **done in Phase 2a Task 1**
2. Handler factories return `Pick<IpcHandlerMap, …>`, and the full map is built with `satisfies IpcHandlerMap`. — **done (Tasks 2, 4, 5)**
3. Validate IPC arguments with a typed per-channel `parseArgs`, required for every channel that takes arguments. — **done (Tasks 2, 4, 5)**
4. Add an `IpcEventContract` for main → renderer events, plus a `sendEvent` that targets only the main window's webContents and skips it when it is destroyed. The preload exposes `onX(cb) => unsubscribe`, and the listener never receives the `IpcRendererEvent`. utilityProcess output is relayed through main, never through a raw MessagePort. Kill the scanner child process on quit. Build the worker as a second electron-vite main input. — **done (Tasks 2, 4)**
5. `render-process-gone` policy: ignore `clean-exit` and crashes during quit, and show "stopped unexpectedly" wording after the first load. Decide it together with the scanner-crash policy. — **done (Task 4)**
6. Store test: `loadAppInfo` retries after an error. — **done (Task 6)**
7. Report renderer bundle size (572 kB today), installer size and idle RAM in CI. Make the CI build step explicit rather than relying on the E2E build. — **done (Task 7)**
8. Cosmetic: the busy (`aria-disabled`) button still shows its hover colour. — **done (Tasks 6, 7)**
9. Phase 4: copy CSV through main's `clipboard` over IPC, because the renderer's clipboard permission is denied. — **still scheduled for Phase 4**

Phase 1 installer: 115.7 MB, unsigned, default icon.

CI: `.github/workflows/ci.yml` is written and parses, but is not yet verified on GitHub (no remote configured).

Deviations from the plan (made after reviews, approved by the owner):

- `vitest.config.mts` instead of `.ts` (Vite 8 ESM warning).
- `isTrustedRendererUrl` hardened to never throw.
- `@types/node` pinned to ^24 to match Electron's Node.
- Main-process hardening: fail fast on load errors, navigation lock on every webContents, IPC accepted only from the main window's top frame, permissions denied, explicit `webviewTag` and `nodeIntegrationInSubFrames` false.
- E2E removes `ELECTRON_RUN_AS_NODE` from the launch environment.
- The Dismiss button grew to a 24×24 px target (WCAG 2.5.8).
- CI runs Node 24 (the Node inside Electron 45) so tests match the runtime; `engines.node` stays `>= 22`.
- Electron fuses are set in `electron-builder.yml` (no `runAsNode`, no Node CLI/inspect flags, ASAR integrity, load only from ASAR, cookie encryption).

### Phase 3 — Analyzer Workspace (task checklist)

- [x] T1 Design system: `design/tokens.json` → `tokens.css` → Tailwind, `components.md`, contrast report (0 AA failures), Lucide icons
- [x] T2 Columnar tree store in the scanner (folders and files, allocated size from the cluster size), 1M-file perf test
- [x] T3 Scanner queries: children pages and sort, node details, expand levels, squarified treemap, folder refresh
- [x] T4 Main and preload: `drive:info`, `places:list`, tree and treemap channels, open in Explorer, clipboard, new folder, `app:quit`
- [x] T5 Workspace store, Ribbon and Select menu
- [x] T6 Virtualized column tree (treegrid)
- [x] T7 Native Explorer context menu (koffi COM) with StorageIQ's items
- [x] T8 Treemap pane (Level 0–5, hide/show), splitter, status bar, workspace shell
- [x] T8a Stale rows after changes outside the app: folder watcher and calm "no longer exists" message
- [x] T8b/8d Parallel directory walk (walker pool) and a faster scanner
- [x] T8c Strata look: pill ribbon, file-type treemap with legend and cushion shading, calm banner
- [x] T9 2a screens removed, workspace E2E, CI perf report, docs
- [x] T10 All-users installer option and auto-update from GitHub Releases ([RELEASING.md](RELEASING.md))
- [ ] Owner checks pending: manual Explorer-menu and keyboard checks, High Contrast, installer and auto-update N→N+1, full C: scan timing; SignPath code signing (not set up yet)

### Phase 3 — Outcome

Automated gates, 2026-11-23, on the development machine (Windows 11):

- Unit tests: 56 files, 597 passed, 1 skipped. Perf test (`npm run test:perf`): 2 passed. End-to-end: 23 passed, 3 skipped (metrics and the two screenshot runs, which are opt-in). Packaged self-test: koffi from app.asar.unpacked, Explorer menu built (24 items), scanner ran on 7 walkers.
- `npm run typecheck` (node and web), `npm run lint`, `npm run format:check` and `node scripts/build-tokens.mjs --check` are green.
- Report-only metrics: renderer bundle 708.5 kB, installer 116.4 MB, idle RAM 384 MB (all processes), 20,000 generated files scanned in 2.9 s, cancel on the system drive 248 ms. 1M-file tree store: 73.4 MB (77 B/file), first page 6.4 ms, treemap layout 35.0 ms (limits 300 MB, 100 ms, 100 ms).
- Scan speed: about 100–130 s for 1.9 million files on the development machine (measured during the walker-pool work); no other speed figure is claimed.

Deviations from the plan: the Phase 3 addendum added stale-row handling (T8a), the parallel walker pool (T8b/8d), the Strata look with a file-type treemap and legend (T8c), and the all-users installer with auto-update (T10). Code signing with SignPath is not set up yet. Checks that need a person at the desktop (native Explorer menu, keyboard, High Contrast, installer and update runs, full C: scan timing) are still open.

Decisions recorded with the plan:

- `lucide-react` 1.69.0 is the renderer's icon set (dev dependency, bundled by Vite).
- The right-click menu is the real Windows Explorer menu, built from main with koffi (`SHParseDisplayName`, `SHBindToParent`, `IShellFolder::GetUIObjectOf`, `IContextMenu`/`2`/`3`, `TrackPopupMenuEx`, `InvokeCommand`). Explorer's own commands, including Delete, therefore work from StorageIQ; StorageIQ's own code still never deletes (Phase 6).
- Tree and treemap requests name rows by scanner ids (`d…`, `g…`, `f…`); main resolves every path that reaches the shell or the clipboard from the scanner's tree, never from the renderer.

### Release checklist (before first public release, not tied to a phase)

Decided before the first public build; the MVP (Phase 6) is the first public release:

- [ ] Custom app icon (`build/icon.ico`)
- [ ] Code signing: SignPath Foundation application pending (the owner is applying; free signing for open-source projects); if declined, use Azure Trusted Signing. Until builds are signed, SmartScreen warns on first run
- [ ] Official winget package under the StorageIQ name
- [ ] Decide whether uninstall removes `%APPDATA%\StorageIQ` (kept by default today)
- [ ] Decide whether the installer keeps `allowToChangeInstallationDirectory` (enabled today)

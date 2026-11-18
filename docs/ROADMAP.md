# StorageIQ — Product & Technical Roadmap

Living document owned by the technical lead. Update it whenever a phase completes: tick tasks, record decisions, and name the next phase.

**Current phase:** Phase 1 — Project Foundation (planned, not started)
**Last updated:** 2026-11-18

---

## Product Vision

StorageIQ is a free, open-source Windows disk-space analyzer for everyday users. Point it at a drive or folder and it shows, in plain language, which folders and files are using the space, with a fast, modern interface that stays responsive during a scan. It aims to cover what paid disk analyzers sell (tree view, largest files, treemap, export, history, duplicates) at no cost and under the MIT license.

Target user: general consumers on Windows 10 1809+ / Windows 11 (x64) who have run out of disk space. Full product record: [PRODUCT.md](../PRODUCT.md).

## MVP Scope (Phases 1–4)

In scope:

| Capability | Phase |
|---|---|
| Secure Electron shell, typed IPC, design tokens, tests, installer, CI | 1 |
| Pick a drive or a folder to scan | 2 |
| Recursive traversal without following junctions/symlinks | 2 |
| Folder size (logical bytes), file count and folder count per folder | 2 |
| Live progress (files, folders, bytes, current path, elapsed time) | 2 |
| Cancel a running scan | 2 |
| Report folders that could not be read (access denied, etc.) | 2 |
| Tree view sorted by size, with lazy expansion, % of parent, counts | 3 |
| Largest files view (top N, path, size, modified date) | 4 |

Out of scope for the MVP: treemap, export, history/SQLite, duplicate finder, AI, deleting files, network shares/UNC paths, elevation, MFT/NTFS-journal fast scanning, ARM64, macOS/Linux.

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
5. **Scanner runs in an Electron `utilityProcess`** (Phase 2), not in main and not in the renderer. A heavy scan can never freeze the window, and a scanner crash cannot take down the app. It traverses with `fs.promises.opendir` (streamed directory reads, low memory), does not follow reparse points, and batches progress messages about every 100 ms.
6. **Zustand vanilla stores built by a factory with an injected API**, so store logic can be tested without Electron. Components use `useStore(store, selector)`.
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
│  │  └─ scanner/                  # (Phase 2) utilityProcess entry + traversal
│  ├─ preload/                     # contextBridge API
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
├─ vitest.config.ts · playwright.config.ts · eslint.config.mjs
├─ PRODUCT.md · DESIGN.md · README.md · LICENSE
```

## Roadmap

| # | Phase | Status | Exit criterion |
|---|---|---|---|
| 1 | Project Foundation | **Planned** — [plan](superpowers/plans/2026-11-18-phase-1-project-foundation.md) | Secure app shell launches, picks a folder through typed IPC, all checks green in CI, NSIS installer builds |
| 2 | Filesystem Scanner | Not started | Scans a real drive in a utilityProcess with live progress and cancel; totals match `dir /s` within tolerance |
| 3 | Tree View | Not started | Virtualized, keyboard-navigable size-sorted tree over a 1M-entry scan at 60 fps |
| 4 | Largest Files | Not started | Top-N largest files list with sort and "show in Explorer" — **MVP complete** |
| 5 | Treemap | Not started | Squarified treemap with drill-down synced to the tree |
| 6 | Export | Not started | CSV and XLSX export of tree and largest files |
| 7 | History | Not started | SQLite-persisted scans; compare two scans |
| 8 | Duplicate Finder | Not started | Size → partial hash → full hash pipeline, cancelable |
| 9 | AI Features | Not started | Cleanup suggestions; local vs cloud decision recorded first |

### Phase 1 — Project Foundation (task checklist)

- [ ] T1 Repository, toolchain & shared IPC contract (trusted-URL policy)
- [ ] T2 Main process & preload bridge (secure window, typed IPC, sender validation)
- [ ] T3 Renderer state (Zustand store + React binding)
- [ ] T4 Design tokens, DESIGN.md & app shell UI
- [ ] T5 End-to-end smoke test (Playwright + Electron)
- [ ] T6 Packaging (electron-builder NSIS x64, per-user)
- [ ] T7 CI workflow, README & roadmap update

### Release checklist (before first public release, not tied to a phase)

- [ ] Custom app icon (`build/icon.ico`)
- [ ] Code-signing decision (unsigned installers trigger SmartScreen)

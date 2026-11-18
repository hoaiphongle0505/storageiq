# StorageIQ — Product & Technical Roadmap

Living document owned by the technical lead. Update it whenever a phase completes: tick tasks, record decisions, and name the next phase.

**Current phase:** Phase 2a — Core Scanner (next)
**Last updated:** 2026-11-18

---

## Product Vision

**"Shows where your disk space went, and explains it in plain words."**

StorageIQ is a free, open-source Windows disk-space analyzer for everyday users. Point it at a drive or folder and it shows which folders and files are using the space and explains the well-known ones in plain language. Its totals are honest: they match what Windows reports, or the app explains the difference. It covers what paid disk analyzers sell (tree view, largest files, treemap, duplicates, history, export) at no cost and under the MIT license. It has no nags and needs no account. We make no speed claims and never name competitors in marketing.

Scope and ordering follow the research-driven [Roadmap v2 spec](superpowers/specs/2026-11-18-roadmap-v2-research-driven-design.md), approved 2026-11-18.

Target user: general consumers on Windows 10 1809+ / Windows 11 (x64) who have run out of disk space. Full product record: [PRODUCT.md](../PRODUCT.md).

## MVP Scope (Phases 1–4)

In scope:

| Capability                                                                                  | Phase |
| ------------------------------------------------------------------------------------------- | ----- |
| Secure Electron shell, typed IPC, design tokens, tests, installer, CI                       | 1     |
| Pick a drive or a folder to scan                                                            | 2     |
| Recursive traversal without following junctions/symlinks                                    | 2     |
| Folder size (logical bytes), file count and folder count per folder                         | 2     |
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
├─ vitest.config.mts · playwright.config.ts · eslint.config.mjs
├─ PRODUCT.md · DESIGN.md · README.md · LICENSE
```

## Roadmap

| #   | Phase                        | Status                                                                                                                                               | Exit criterion                                                                                                                                                                                          |
| --- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #   | Phase                        | Status                                                                                                                                               | Exit criterion                                                                                                                                                                                          |
| --- | ---                          | ---                                                                                                                                                  | ---                                                                                                                                                                                                     |
| 1   | Project Foundation           | **Done** (automated gates green; owner's manual UI and installer check pending) — [plan](superpowers/plans/2026-11-18-phase-1-project-foundation.md) | Secure app shell launches, picks a folder through typed IPC, all checks green in CI, NSIS installer builds                                                                                              |
| 2a  | Core Scanner                 | **Next**                                                                                                                                             | Scans a real drive in a utilityProcess; progress plus a largest-folders snapshot about every 250 ms; cancel; unreadable folders listed; removable drives listed; CI reports installer size and idle RAM |
| 2b  | Honest Totals                | Not started                                                                                                                                          | Online-only (cloud) files excluded from on-disk size and never downloaded; hardlinks counted once; reconciliation line vs. Windows' used space; FindFirstFileExW speed measured                         |
| 3   | Tree View                    | Not started                                                                                                                                          | Virtualized, keyboard-navigable, size-sorted tree that grows during the scan; "Open in Explorer"; 1M entries at 60 fps                                                                                  |
| 4   | Largest Files & Explanations | Not started                                                                                                                                          | Largest-files list; plain-language labels for about 30 well-known space hogs in the tree and the list; "Copy as CSV" — **MVP complete**                                                                 |
| 5   | Treemap                      | Not started                                                                                                                                          | Squarified treemap as a secondary view, with drill-down synced to the tree                                                                                                                              |
| 6   | Duplicate Finder             | Not started                                                                                                                                          | Size → partial hash → full hash; cancelable; never deduplicates hardlinks                                                                                                                               |
| 7   | History (light)              | Not started                                                                                                                                          | SQLite remembers the last scan of each drive; shows "+X GB since last time"                                                                                                                             |
| 8   | Export                       | Not started                                                                                                                                          | CSV and XLSX export of the tree and the largest files                                                                                                                                                   |
| 9   | AI Features                  | Not started                                                                                                                                          | Explanations beyond the fixed dictionary; local-vs-cloud decision recorded first                                                                                                                        |

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

Tests: 40 unit tests and 3 E2E tests.

Installer: 115.7 MB, unsigned, default icon.

CI: `.github/workflows/ci.yml` is written and parses, but is not yet verified on GitHub (no remote configured).

Deviations from the plan (made after reviews, approved by the owner):

- `vitest.config.mts` instead of `.ts` (Vite 8 ESM warning).
- `isTrustedRendererUrl` hardened to never throw.
- `@types/node` pinned to ^24 to match Electron's Node.
- Main-process hardening: fail fast on load errors, navigation lock on every webContents, IPC accepted only from the main window's top frame, permissions denied, explicit `webviewTag` and `nodeIntegrationInSubFrames` false.
- E2E removes `ELECTRON_RUN_AS_NODE` from the launch environment.
- The Dismiss button grew to a 24×24 px target (WCAG 2.5.8).

### Release checklist (before first public release, not tied to a phase)

Decided before the first public build, at the end of Phase 4:

- [ ] Custom app icon (`build/icon.ico`)
- [ ] Code signing: apply to the SignPath Foundation (free signing for open-source projects); if declined, use Azure Trusted Signing
- [ ] Official winget package under the StorageIQ name

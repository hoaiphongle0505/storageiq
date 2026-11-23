# Phase 3 — Analyzer Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One window that works like a full disk-analyzer workspace. Top to bottom: a ribbon (File, Home, Scan, View) with a Select menu (drives, Documents and OneDrive, recently scanned, any folder), Stop, Refresh, the Mode toggles (Size, Allocated, File count, Percent), the Unit toggles (Auto, GB, MB, KB), Expand ▾ and folder commands; a virtualized column tree (Name with the Mode value over a share bar, Size, Allocated, Files, Folders, % of Parent, Last Modified) that draws during the scan; the **real Windows Explorer context menu** on every row, with StorageIQ's own items on top; a resizable, hideable treemap pane with a level bar (Level 0–5) kept in sync with the tree both ways; and a status bar with free space, files found, excluded items and bytes per cluster with the file system.

**Architecture:** The scanner keeps every folder and file in a columnar store (typed arrays plus one name string per entry, about 75 bytes per file) and answers queries over the existing main ↔ scanner message channel: pages of sorted children, node details, the folders to expand, a squarified treemap layout, and a rescan of one folder. Main validates every renderer argument with a per-channel `parseArgs`, reads the cluster size and file system with koffi (`GetDiskFreeSpaceW`, `GetVolumeInformationW`), lists Documents/OneDrive/recent places, and resolves every path that reaches the shell or the clipboard from the scanner's tree (never from the renderer). The Explorer menu is built in main with koffi and COM (`SHParseDisplayName`, `SHBindToParent`, `IShellFolder::GetUIObjectOf`, `IContextMenu`/`2`/`3`, `TrackPopupMenuEx`, `InvokeCommand`). The renderer holds only chunks of 200 rows per expanded folder in a Zustand workspace store; a hand-rolled virtualizer draws the visible lines; the treemap canvas only draws the rectangles the scanner computed.

**Tech Stack:** Electron 45.3.4 (Chromium 156, Node 24.22.3), electron-vite 6.0.0 / Vite 8.3.8, React 19.3.1, TypeScript 6.0.3 (strict), Tailwind 4.3.5, Zustand 5.1.0, Vitest 5.1.1 + Testing Library + jsdom 31, Playwright 1.65.1, electron-builder 26.18.0, koffi 3.3.8, **lucide-react 1.69.0** (new, the only new dependency).

**Spec:** [Roadmap v3 and Phase 3 — Analyzer Workspace: Design](../specs/2026-11-19-phase-3-workspace-design.md), plus the owner's binding addition of 2026-11-19 (native Explorer context menu, treemap Level 0–5, hide/show the treemap pane). The spec governs; "Self-review" at the end maps every section and acceptance criterion to a task.

**Model routing (for the controller):** every task starts with an `**Implementer tier:**` line. `cheap` means the plan contains all code and tests, so a fast model can transcribe and run it. `standard` means the task needs judgment or integration with Electron, Win32/COM, packaging or the UI (a standard model; review on the strong model).

**Dry run:** every task below was applied in a scratch copy of the repository on 2026-11-23 and all gates passed with every task applied: format, lint, typecheck, 424 unit tests in 43 files, the perf test (1M files: 71 MB / 75 B per file, first page 4–15 ms, treemap 1–66 ms), 22 E2E tests (3 opt-in tests skipped), the packaged self-test (24 Explorer menu items) and `impeccable detect` (`[]`). The code blocks are the dry-run files after `npm run format`.

## Global Constraints

Carried forward from Phases 1 and 2a (binding):

- Installed versions stay as recorded (Electron 45.3.4, electron-vite 6.0.0, Vite 8.3.8, TypeScript 6.0.3, React 19.3.1, Tailwind 4.3.5, Zustand 5.1.0, Vitest 5.1.1, Playwright 1.65.1, electron-builder 26.18.0, koffi 3.3.8). `@types/node` stays on `^24`. Do not upgrade anything in this phase.
- The only new dependency is `lucide-react`, pinned exactly: `npm install --save-exact --save-dev lucide-react@1.69.0` (released 2026-11-05; a dev dependency because Vite bundles it into the renderer). Never use `--force` or `--legacy-peer-deps`.
- Target Windows 10 1809+ / Windows 11, x64 only. License MIT. appId `io.github.storageiq.app`. productName `StorageIQ`. Version `0.1.0`.
- Renderer security baseline unchanged: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict CSP, no `window.open`, no foreign navigation, no `<webview>`, every IPC call checks its sender, all permission requests denied.
- Every IPC channel has a typed `parseArgs`; invalid arguments reject with `InvalidIpcArgumentsError` and the handler never runs. Main → renderer events reach the renderer only through the preload `onX(cb) => unsubscribe`. Scanner output is relayed through main; no `MessagePort` reaches the renderer. The scanner never follows reparse points, never opens file contents, never asks for elevation, and refuses UNC paths.
- New and binding: any path that reaches the shell (`shell.openPath`, `showItemInFolder`, the Explorer menu, `mkdir`) or the clipboard from a row comes from the scanner's tree for the **current** scan (`resolveScanNode`); the renderer sends only `(scanId, nodeId)`. The Explorer menu opens only on an explicit right-click, Shift+F10 or the Menu key on the focused row.
- Trade-dress boundary (spec §1): layout and functions follow the owner's reference screenshots; StorageIQ's own name, Lucide icons, palette, fonts and freshly written copy. No reference screenshot, icon or text goes into the repository, and no competitor is named in code, docs or commit messages.
- TypeScript `strict` plus `noUncheckedIndexedAccess`. No `any`, no `@ts-ignore`. Path aliases `@shared/*`, `@renderer/*`.
- Prettier style: no semicolons, single quotes, print width 100, trailing commas. Run `npm run format` before `npm run format:check`.
- Copy is plain language and uses typographic punctuation (`’`, `…`, `—`). The exact UI strings are the ones in this plan's code.
- Run Vitest **from PowerShell or cmd, not Git Bash** (Windows path semantics). Commands below are PowerShell.
- Before launching Electron (dev, E2E, packaged checks): `Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue`. E2E needs an interactive desktop session.
- Commits: one per task, conventional-commit message, ending with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage **explicit paths only** (`git add <path> …`, `git rm <path> …`); never `git add -A`, `git add .` or `git commit -a`.
- UI tasks (5, 6, 8): the modern-web-guidance "menu", "toolbar" and "tabs" guides and the canvas-accessibility search were applied while writing this plan; the code below already follows them (see each component's doc comment). After Task 8, `impeccable detect --json src/renderer` must print `[]`.
- **Integration window (read before Task 4):** Task 4 switches the shared contract (scan types, scanner protocol, IPC) for every process at once. Some files written in Task 4 import modules that Tasks 5–8 create (`src/main/index.ts` imports the Explorer-menu module of Task 7; the old renderer still imports the 2a scan types). From Task 4 until the end of Task 8, `npm run typecheck` and the unscoped `npx vitest run` are **expected to fail**; each of those tasks runs its own scoped tests, which must pass. `npm run typecheck:node` is green again after Task 7, and every gate is green after Task 8. Vitest compiles each test file on its own (no type check), so scoped tests run before the whole project typechecks.

## File Map

| File                                                                                                                                                                                                     | Responsibility                                                                                              | Task |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---- |
| `design/tokens.json`, `design/tokens.css`, `design/components.md`, `design/contrast-report.txt`, `scripts/build-tokens.mjs`                                                                              | Design tokens (measured structure, own palette), generated CSS, component specs, contrast report            | 1    |
| `src/renderer/src/styles/global.css`, `src/main/window-options.ts` (+ test), `DESIGN.md`                                                                                                                 | Tailwind mapping of the tokens; window background from the tokens                                           | 1    |
| `src/shared/tree-types.ts`                                                                                                                                                                               | `NodeId`, `TreeRow`, `TreePage`, `TreeNodeDetails`, `TreemapRect`, `TreemapLayout`, `SizeMode`, `SortKey` … | 2    |
| `src/worker/scanner/walk.ts`, `test/fake-walk-fs.ts`                                                                                                                                                     | Sink gets names and modification times                                                                      | 2    |
| `src/worker/scanner/tree-store.ts` (+ test)                                                                                                                                                              | Columnar store, allocated size, folder reset                                                                | 2    |
| `src/worker/scanner/tree-store.perf.test.ts`, `vitest.config.mts`, `vitest.perf.config.mts`                                                                                                              | 1M-file limits, run alone (`npm run test:perf`)                                                             | 3    |
| `src/worker/scanner/tree-queries.ts`, `treemap.ts` (+ tests)                                                                                                                                             | Children pages and sort, node details, expand ids; squarified layout with nesting and free space            | 3    |
| `src/shared/scan-types.ts`, `scanner-protocol.ts`, `ipc-contract.ts`                                                                                                                                     | New contract (queries, volume, drive details, places, tree channels, menu outcome)                          | 4    |
| `src/worker/scanner/scanner-host.ts` (+ test)                                                                                                                                                            | Scans plus queries and folder refresh in the scanner process                                                | 4    |
| `src/main/ipc/*` (parse-args, app, drive, scan, tree, shell handlers + tests), `src/main/scan/scan-service.ts` (+ test)                                                                                  | Validated channels; query relay with timeouts                                                               | 4    |
| `src/main/drives/*`, `src/main/places/places.ts` (+ tests)                                                                                                                                               | Cluster size and file system (koffi); Documents, OneDrive, recent scans                                     | 4    |
| `src/main/shell-menu/menu-commands.ts` (+ test), `src/main/self-test.ts` (+ test), `src/main/index.ts`, `src/preload/index.ts`                                                                           | Menu ids, new-folder naming; self-test; wiring; bridge                                                      | 4    |
| `src/renderer/src/lib/*`, `stores/workspace-store*.ts(x)`, `test/*`, `env.d.ts`                                                                                                                          | Formatting, visible-row model, focusgroup fallback, workspace store                                         | 5    |
| `src/renderer/src/components/MenuButton.tsx`, `RibbonButton.tsx`, `SelectMenu.tsx`, `Ribbon.tsx` (+ tests)                                                                                               | Ribbon and Select menu                                                                                      | 5    |
| `src/renderer/src/components/TreeGrid.tsx` (+ test)                                                                                                                                                      | Virtualized treegrid                                                                                        | 6    |
| `src/main/shell-menu/context-menu.ts` (+ test), `win-shell-menu.ts`                                                                                                                                      | Explorer context menu (koffi COM)                                                                           | 7    |
| `src/renderer/src/lib/treemap-draw.ts`, `components/TreemapPane.tsx`, `LevelBar.tsx`, `Splitter.tsx`, `StatusBar.tsx`, `Banner.tsx`, `Dialog.tsx`, `UnreadableList.tsx`, `App.tsx`, `main.tsx` (+ tests) | Treemap, level bar, splitter, status bar, banner, dialogs, workspace shell                                  | 8    |
| `e2e/**`, `scripts/report-metrics.mjs`, `scripts/check-packaged-app.mjs`, `.github/workflows/ci.yml`, `eslint.config.mjs`, `.gitignore`, `.prettierignore`, `README.md`, `docs/ROADMAP.md`, `PRODUCT.md` | Workspace E2E, CI perf step and report, docs                                                                | 9    |

Removed: `src/worker/scanner/tree.ts`, `top-folders.ts` (+ tests) in Task 4; the 2a renderer (`scan-store*`, `PickLocationScreen`, `ScanningScreen`, `ResultScreen`, `CrashScreen`, `DriveCard`, `FolderBars`, `Stat` + tests) in Task 5; `e2e/scan.spec.ts` in Task 9.

## Shared type names (identical in every task)

`NodeId` (`d<n>` folder, `g<n>` "[N files]" row of folder n, `f<n>` file; `ROOT_NODE_ID = 'd0'`) · `NodeKind` · `SizeMode` (`size` `allocated` `files` `percent`) · `SortKey` (`name` `size` `allocated` `files` `folders` `modified`) · `SortDir` · `TreeRow` · `TreePage` · `TreeLocation` · `TreeNodeDetails` · `TreemapBlockKind` · `TreemapRect` · `TreemapLayout` · `TreeTotals` · `TreeChanged` · `DriveDetails` · `Place` · `Places` · `ScanProgress` · `ScanDone` · `ScanVolume` · `ScannerQuery` · `ScannerQueryResults` · `ContextMenuOutcome` · `CreateFolderResult` · `TreeStore` · `NodeRef` · `ChildSorter` · `ScanService` · `CurrentScan` · `TreeScanService` · `RefreshFolder` · `ShellMenuNative` · `BuiltShellMenu` · `ShellMenuChoice` · `StorageIQMenuItem` · `SelfTestScan` · `WorkspaceState` · `WorkspaceStore` · `ColumnId` · `ScanPhase` · `ScanTotals` · `ChildList` · `ChildLists` · `VisibleRow` · `VisibleModel` · `ChunkRef` · `SizeUnit` · `MenuSection` · `MenuEntry`.

## Spec ambiguities and how this plan resolves them

1. **Percent mode** ranks and sizes by logical size and shows each row's share of its parent in the Name cell; "% of Parent" always uses the current Mode (Allocated mode shows the allocated share).
2. **"% of Parent" header** sorts by the Mode value; with no explicit column the default sort is the Mode value, descending (`sortColumn: null`).
3. **IPC by node id, not path:** `shell:open-in-explorer(scanId, nodeId)` instead of `(path)`; main resolves the path from the current scan, which is stricter than checking a renderer-supplied path. `tree:node` also takes `sortKey, sortDir` so it can return each ancestor's index (needed to reveal a treemap click in a 1M-row tree). Extra channels: `tree:expand-ids` (Expand levels without one IPC per folder), `tree:refresh` (Refresh this folder), `folder:create` (New folder), `app:quit` (File → Exit) and event `tree:changed`.
4. **Context menu** (owner's addition, overrides spec §3.3): the native Explorer menu; StorageIQ ▸ (Refresh this folder, Copy path, Open in Explorer), New folder Ctrl+N, separator, then the shell's items. Explorer's own Delete etc. work as in Explorer; PRODUCT.md records this. Ctrl+C copies the path from the keyboard, through `clipboard:write-text`.
5. **Expand ▾** expands from the scanned root: "N levels" shows N levels of folders, "All levels" is 64, capped at 5,000 folders by the scanner.
6. **"[N files]" rows** expand to the individual files (paged like folders), so a file row can carry the Explorer menu.
7. **Treemap root** follows the tree selection (a file shows its folder's "[N files]" block); a treemap click selects and reveals the row without moving the treemap; a double-click drills in. The free-space block sits beside the root block when the scan target is a drive root in Size or Allocated mode.
8. **Level semantics:** Level 0 = the folder's children only; Level n nests n levels under an 18 px label strip.
9. **Folder last modified** = newest modification time of the folder or anything below it. File times are kept to the second (memory).
10. **2a screens** are removed in Task 5 (not Task 9) because the workspace store replaces the scan store they depend on; Task 9 keeps the docs and E2E cleanup.
11. **Perf test** runs as its own command (`npm run test:perf`) so other test files cannot skew its timings; CI runs it as a hard gate and the metrics step reports its figures.
12. **Phase 2a ledger items folded in** (only those touching rewritten code): cancel failure is no longer silent (`stopScan` shows a banner, ledger #28); the pick screen's empty drive list is gone (Select shows "(none)", #25); the previous tree is dropped when a scan starts (final-review Finding 2, kept); exact byte counts stay in the Size/Allocated cell `title` and `data-bytes` (#27 stays mouse-only and is deferred to Phase 4 row details); #8, #14, #15, #21 are untouched code and stay deferred. The busy-button hover E2E of carry-over 8 is dropped with the screen that used it; `Button.test.tsx` still covers it.

---

### Task 1: Design system, tokens and Lucide

**Implementer tier:** cheap

Structure is measured from the owner's reference screenshots at 100 % scaling (tab strip 28 px, ribbon body 113 px with a 20 px caption row, column header 54 px, tree rows 34 px, columns 563/125/125/100/100/107/125 px, treemap pane about 250 px, level bar 50 px with equal-width buttons, status bar 22 px) and recorded in `design/tokens.json` `layout._measured`; StorageIQ keeps the order and proportions at a denser 14 px text size. Colours are StorageIQ's own (the 2a palette plus new roles for selection, bars, pressed toggles and treemap fills). The contrast checker is the design-system skill's `contrast.py` (standard-library Python); the controller runs it and commits its output.

**Files:**

- Create: `design/tokens.json`, `design/tokens.css` (generated), `design/components.md`, `design/contrast-report.txt` (generated), `scripts/build-tokens.mjs`
- Modify: `src/renderer/src/styles/global.css`, `src/main/window-options.ts`, `src/main/window-options.test.ts`, `DESIGN.md`, `.prettierignore`, `package.json`, `package-lock.json`

**Interfaces:**

- Produces: CSS custom properties `--surface-app` … `--treemap-outline`, `--family-sans|display|mono`, `--r-control|panel`, `--elevation-menu`, `--size-*` (layout); Tailwind utilities `bg-app bg-panel bg-sunken border-line bg-line-strong text-ink text-ink-muted bg-accent text-on-accent text-danger bg-selection bg-row-hover bg-bar bg-bar-fill bg-pressed shadow-menu rounded-control rounded-panel h-(--size-…)`; `WINDOW_BACKGROUND` (now 1280 × 860 window, min 960 × 600); npm script `tokens`.

- [ ] **Step 1: Install Lucide (pinned) and add the tokens script**

```powershell
npm install --save-exact --save-dev lucide-react@1.69.0
```

Then add `"tokens": "node scripts/build-tokens.mjs"` as the last entry of `"scripts"` in `package.json` (after `"metrics"`).

- [ ] **Step 2: Write the failing test: the window background must come from the tokens**

`src/main/window-options.test.ts`:

```ts
import { readFileSync } from 'node:fs'
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
      webviewTag: false,
      nodeIntegrationInSubFrames: false,
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

  it('uses the surface-app colours of the design tokens', () => {
    const tokens = JSON.parse(readFileSync('design/tokens.json', 'utf8')) as {
      color: Record<'light' | 'dark', Record<string, string>>
    }
    expect(WINDOW_BACKGROUND).toEqual({
      light: tokens.color.light['surface-app'],
      dark: tokens.color.dark['surface-app'],
    })
  })
})
```

- [ ] **Step 3: Run it**

```powershell
npx vitest run src/main/window-options.test.ts
```

Expected: FAIL — `ENOENT … design/tokens.json`.

- [ ] **Step 4: Write the tokens (the single source)**

`design/tokens.json`:

```json
{
  "_about": "StorageIQ design tokens. Structure (density, row height, column widths, pane sizes) is measured from the owner's reference screenshots of the analyzer workspace at 100 % scaling; colours, fonts and copy are StorageIQ's own. scripts/build-tokens.mjs writes tokens.css from this file. Check contrast after every change: python contrast.py design/tokens.json (zero AA failures).",
  "color": {
    "light": {
      "surface-app": "#f6f7f7",
      "surface-panel": "#ffffff",
      "surface-sunken": "#eef0f0",
      "border": "#dde1e1",
      "border-strong": "#7d8889",
      "text": "#1b2122",
      "text-muted": "#5b6667",
      "accent": "#0f7a73",
      "accent-hover": "#0c655f",
      "on-accent": "#ffffff",
      "danger": "#b3261e",
      "selection": "#cde6e3",
      "row-hover": "#eef3f2",
      "bar": "#dcebe9",
      "bar-fill": "#2f8f87",
      "pressed": "#d6ebe8",
      "treemap-0": "#c6e3df",
      "treemap-1": "#a9d4cf",
      "treemap-2": "#8fc6c0",
      "treemap-files": "#e1e6e6",
      "treemap-free": "#f3e6c9",
      "treemap-edge": "#f6f7f7",
      "treemap-outline": "#1b2122"
    },
    "dark": {
      "surface-app": "#161a1b",
      "surface-panel": "#1e2324",
      "surface-sunken": "#121516",
      "border": "#2e3536",
      "border-strong": "#7c8889",
      "text": "#e6eaea",
      "text-muted": "#9aa5a6",
      "accent": "#4fc1b6",
      "accent-hover": "#6fd0c6",
      "on-accent": "#062421",
      "danger": "#f2b8b5",
      "selection": "#1e3734",
      "row-hover": "#1b2a29",
      "bar": "#1f3331",
      "bar-fill": "#4fc1b6",
      "pressed": "#1f3b38",
      "treemap-0": "#1d3b38",
      "treemap-1": "#245049",
      "treemap-2": "#2b5f58",
      "treemap-files": "#2a3133",
      "treemap-free": "#4a3d22",
      "treemap-edge": "#161a1b",
      "treemap-outline": "#e6eaea"
    }
  },
  "pairs": [
    ["light-text", "light-surface-app"],
    ["light-text", "light-surface-panel"],
    ["light-text", "light-surface-sunken"],
    ["light-text-muted", "light-surface-app"],
    ["light-text-muted", "light-surface-panel"],
    ["light-text-muted", "light-surface-sunken"],
    ["light-text", "light-selection"],
    ["light-text", "light-row-hover"],
    ["light-text", "light-bar"],
    ["light-text", "light-pressed"],
    ["light-text-muted", "light-selection"],
    ["light-on-accent", "light-accent"],
    ["light-on-accent", "light-accent-hover"],
    ["light-accent", "light-surface-panel"],
    ["light-danger", "light-surface-panel"],
    ["light-danger", "light-surface-app"],
    ["light-text", "light-treemap-0"],
    ["light-text", "light-treemap-1"],
    ["light-text", "light-treemap-2"],
    ["light-text", "light-treemap-files"],
    ["light-text", "light-treemap-free"],
    ["light-accent", "light-surface-app", "ui"],
    ["light-border-strong", "light-surface-panel", "ui"],
    ["light-bar-fill", "light-surface-panel", "ui"],
    ["dark-text", "dark-surface-app"],
    ["dark-text", "dark-surface-panel"],
    ["dark-text", "dark-surface-sunken"],
    ["dark-text-muted", "dark-surface-app"],
    ["dark-text-muted", "dark-surface-panel"],
    ["dark-text-muted", "dark-surface-sunken"],
    ["dark-text", "dark-selection"],
    ["dark-text", "dark-row-hover"],
    ["dark-text", "dark-bar"],
    ["dark-text", "dark-pressed"],
    ["dark-text-muted", "dark-selection"],
    ["dark-on-accent", "dark-accent"],
    ["dark-on-accent", "dark-accent-hover"],
    ["dark-accent", "dark-surface-panel"],
    ["dark-danger", "dark-surface-panel"],
    ["dark-danger", "dark-surface-app"],
    ["dark-text", "dark-treemap-0"],
    ["dark-text", "dark-treemap-1"],
    ["dark-text", "dark-treemap-2"],
    ["dark-text", "dark-treemap-files"],
    ["dark-text", "dark-treemap-free"],
    ["dark-accent", "dark-surface-app", "ui"],
    ["dark-border-strong", "dark-surface-panel", "ui"],
    ["dark-bar-fill", "dark-surface-panel", "ui"],
    ["light-treemap-outline", "light-treemap-0", "ui"],
    ["light-treemap-outline", "light-treemap-1", "ui"],
    ["light-treemap-outline", "light-treemap-2", "ui"],
    ["light-treemap-outline", "light-treemap-files", "ui"],
    ["light-treemap-outline", "light-treemap-free", "ui"],
    ["dark-treemap-outline", "dark-treemap-0", "ui"],
    ["dark-treemap-outline", "dark-treemap-1", "ui"],
    ["dark-treemap-outline", "dark-treemap-2", "ui"],
    ["dark-treemap-outline", "dark-treemap-files", "ui"],
    ["dark-treemap-outline", "dark-treemap-free", "ui"]
  ],
  "font": {
    "sans": "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
    "display": "'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif",
    "mono": "'Cascadia Mono', Consolas, ui-monospace, monospace"
  },
  "type": {
    "xs": {
      "size": 12,
      "line": 16,
      "weight": 400
    },
    "sm": {
      "size": 13,
      "line": 18,
      "weight": 400
    },
    "base": {
      "size": 14,
      "line": 20,
      "weight": 400
    },
    "lg": {
      "size": 18,
      "line": 24,
      "weight": 600
    }
  },
  "space": [0, 2, 4, 6, 8, 12, 16, 24, 32],
  "radius": {
    "control": 4,
    "panel": 8
  },
  "shadow": {
    "menu": "0 8px 24px rgba(16, 24, 24, 0.18)"
  },
  "motion": {
    "fast": "100ms",
    "ease": "cubic-bezier(.2,.8,.2,1)"
  },
  "layout": {
    "_measured": "Reference at 100 % scaling: tab strip 28 px, ribbon body 113 px (group caption row 20 px), column header 54 px, tree row 34 px, columns Name 563 / Size 125 / Allocated 125 / Files 100 / Folders 100 / % of Parent 107 / Last Modified 125, treemap pane about 250 px, level bar 50 px with equal-width level buttons, status bar 22 px. StorageIQ keeps the order and proportions at a denser 14 px text size.",
    "tab-strip": 28,
    "ribbon-body": 88,
    "ribbon-caption": 18,
    "header-row": 32,
    "tree-row": 30,
    "tree-indent": 16,
    "col-name-min": 280,
    "col-size": 112,
    "col-allocated": 112,
    "col-files": 96,
    "col-folders": 96,
    "col-percent": 112,
    "col-modified": 120,
    "treemap-default": 260,
    "treemap-min": 120,
    "treemap-header": 18,
    "level-bar": 36,
    "status-bar": 26,
    "splitter": 6
  }
}
```

- [ ] **Step 5: Write the generator and generate `design/tokens.css`**

`scripts/build-tokens.mjs`:

```js
// Writes design/tokens.css from design/tokens.json (the single source of the
// design tokens). `--check` exits 1 when tokens.css is out of date, so CI catches a hand edit.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const dir = 'design'
const tokens = JSON.parse(readFileSync(path.join(dir, 'tokens.json'), 'utf8'))
const target = path.join(dir, 'tokens.css')

const colorBlock = (colors, indent) =>
  Object.entries(colors)
    .map(([name, value]) => `${indent}--${name}: ${value};`)
    .join('\n')

const layout = Object.entries(tokens.layout)
  .filter(([name]) => !name.startsWith('_'))
  .map(([name, value]) => `  --size-${name}: ${value}px;`)
  .join('\n')

const css = `/* Generated by scripts/build-tokens.mjs from tokens.json. Do not edit by hand. */
:root {
  color-scheme: light dark;
${colorBlock(tokens.color.light, '  ')}
  --family-sans: ${tokens.font.sans};
  --family-display: ${tokens.font.display};
  --family-mono: ${tokens.font.mono};
  --r-control: ${tokens.radius.control}px;
  --r-panel: ${tokens.radius.panel}px;
  --elevation-menu: ${tokens.shadow.menu};
${layout}
}

@media (prefers-color-scheme: dark) {
  :root {
${colorBlock(tokens.color.dark, '    ')}
  }
}
`

if (process.argv.includes('--check')) {
  let current
  try {
    current = readFileSync(target, 'utf8')
  } catch {
    current = ''
  }
  if (current.replace(/\r\n/g, '\n') !== css) {
    console.error(`${target} is out of date. Run "npm run tokens".`)
    process.exit(1)
  }
  console.log(`${target} is up to date.`)
} else {
  writeFileSync(target, css)
  console.log(`Wrote ${target}.`)
}
```

```powershell
npm run tokens
node scripts/build-tokens.mjs --check
```

Expected: `Wrote design\tokens.css.` then `design\tokens.css is up to date.` Append the line `design/tokens.css` to `.prettierignore` (it is generated; Prettier must not reformat it).

- [ ] **Step 6: Window size and background comment**

`src/main/window-options.ts`:

```ts
import type { BrowserWindowConstructorOptions } from 'electron'

/** Must stay equal to the `surface-app` colours in `design/tokens.json`. */
export const WINDOW_BACKGROUND = { light: '#f6f7f7', dark: '#161a1b' } as const

export function createMainWindowOptions(input: {
  preloadPath: string
  dark: boolean
}): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 600,
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
      webviewTag: false,
      nodeIntegrationInSubFrames: false,
      spellcheck: false,
    },
  }
}
```

- [ ] **Step 7: Run the test again**

```powershell
npx vitest run src/main/window-options.test.ts
```

Expected: PASS — 4 tests.

- [ ] **Step 8: Map the tokens into Tailwind**

`src/renderer/src/styles/global.css`:

```css
@import 'tailwindcss';
/* Colour, font, radius and layout tokens (generated from design/tokens.json). */
@import '../../../../design/tokens.css';

/* Tailwind mapping: components use these utilities, never raw hex. */
@theme inline {
  --color-app: var(--surface-app);
  --color-panel: var(--surface-panel);
  --color-sunken: var(--surface-sunken);
  --color-line: var(--border);
  --color-line-strong: var(--border-strong);
  --color-ink: var(--text);
  --color-ink-muted: var(--text-muted);
  --color-accent: var(--accent);
  --color-accent-hover: var(--accent-hover);
  --color-on-accent: var(--on-accent);
  --color-danger: var(--danger);
  --color-selection: var(--selection);
  --color-row-hover: var(--row-hover);
  --color-bar: var(--bar);
  --color-bar-fill: var(--bar-fill);
  --color-pressed: var(--pressed);
  --font-sans: var(--family-sans);
  --font-display: var(--family-display);
  --font-mono: var(--family-mono);
  --radius-control: var(--r-control);
  --radius-panel: var(--r-panel);
  --shadow-menu: var(--elevation-menu);
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
    font-family: var(--family-sans);
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

  @media (forced-colors: active) {
    [aria-pressed='true'] {
      outline: 2px solid Highlight;
      outline-offset: -2px;
    }
  }
}

/* Popup menus: a popover in the top layer, placed under its trigger from script. */
@layer components {
  .popup-menu {
    position: fixed;
    inset: auto;
    margin: 0;
  }
}
```

- [ ] **Step 9: Write the component specs**

`design/components.md`:

````markdown
# StorageIQ components (Phase 3 workspace)

Structure follows the owner's reference layout (ribbon, column tree, treemap pane, level bar,
status bar); names, icons (Lucide), colours and copy are StorageIQ's own. Tokens:
`design/tokens.json` → `design/tokens.css` (`npm run tokens`) → Tailwind utilities in
`src/renderer/src/styles/global.css`. Contrast: `design/contrast-report.txt` (0 AA failures).

```
Ribbon
  parts     tab strip (File, Home, Scan, View; 28 px) over one toolbar panel (88 px) of groups
  groups    Home: Scan (Select ▾, Stop, Refresh) · Mode (Size, Allocated, File count, Percent)
            · Unit (Auto, GB, MB, KB) · Folder (Expand ▾, Open in Explorer, New folder)
            Scan: Scan · Tree (Expand ▾) · View: Mode · Unit · Treemap (toggle) · File: About, Exit
  states    tab: default, hover (row-hover), selected (sunken bg, semibold)
            command: default, hover, pressed (aria-pressed: pressed bg + 1 px inset accent),
            disabled (aria-disabled: ink-muted, no hover), focus-visible (2 px accent ring)
  tokens    bg panel / sunken, text ink, caption xs ink-muted, radius control
  a11y      role=tablist (focusgroup="tablist nomemory", selection follows focus) + tabpanel;
            role=toolbar (focusgroup="toolbar wrap") with role=group per group, named by its
            caption; one tab stop, arrows move, Home/End; disabled stays focusable
  files     components/Ribbon.tsx, RibbonButton.tsx

MenuButton / SelectMenu
  sections  Drives · Documents and cloud · Recently scanned ("(none)" when empty) · Directory
            ("Choose a folder…"); each a role=group named by its heading
  states    closed, open (aria-expanded), item hover/focus (row-hover), item disabled
  tokens    bg panel, border line, radius panel, shadow menu, min item height 32 px
  a11y      Enter/Space/click toggle; ArrowDown opens and enters; keyboard open focuses the first
            item, pointer open keeps focus on the trigger; Escape closes and returns focus; Tab
            and outside click close; popover="manual" in the top layer, placed from script
  files     components/MenuButton.tsx, SelectMenu.tsx

TreeGrid (column tree)
  columns   Name (min 280 px, flexible) · Size 112 · Allocated 112 · Files 96 · Folders 96 ·
            % of Parent 112 · Last Modified 120 (the reference's order and proportions)
  rows      30 px; indent 16 px per level; chevron, Lucide icon, Mode value + name over a bar
            (bg bar) sized to the share of the parent; bold at ≥ 10 %; "[N files]" row per folder
  states    default, hover (row-hover), selected (selection), loading line ("Loading…"),
            empty ("Choose a drive or folder from Select to see what’s using the space.")
  a11y      role=treegrid with aria-rowcount, aria-activedescendant; rows aria-level,
            aria-setsize, aria-posinset, aria-expanded, aria-selected; sortable column headers
            are buttons with aria-sort; ↑ ↓ Home End PageUp PageDown → ← Enter, Shift+F10 /
            Menu key (Explorer menu), Ctrl+C (copy path), Ctrl+N (new folder)
  perf      hand-rolled virtualizer: only lines in view ± 10 are in the DOM; the renderer
            holds chunks of 200 rows per expanded folder, never the whole tree
  files     components/TreeGrid.tsx, lib/tree-view-model.ts

Explorer context menu (native)
  content   StorageIQ ▸ (Refresh this folder, Copy path, Open in Explorer) · New folder Ctrl+N ·
            separator · the Windows shell's own items for the path (Open, Send to, Cut, Copy,
            Delete, Properties, third-party extensions …)
  a11y      native Win32 menu: Windows provides keyboard, screen-reader and high-contrast support
  files     src/main/shell-menu/*

TreemapPane + LevelBar
  parts     header strip (title "Treemap of …", × Hide treemap) · canvas · level bar
  blocks    squarified (scanner), fills treemap-0/1/2 by depth, treemap-files for files,
            treemap-free for "Free space"; 1 px edge; nested blocks under an 18 px label strip;
            labels "name (value)" when they fit; selected block outlined 2 px treemap-outline
  a11y      canvas role=img with a label; the tree is the accessible equivalent; level bar is a
            toolbar of six aria-pressed toggles (Level 0–5)
  files     components/TreemapPane.tsx, LevelBar.tsx, lib/treemap-draw.ts

Splitter
  states    default (line), hover (line-strong), focus (accent)
  a11y      role=separator, aria-orientation=horizontal, aria-valuenow/min/max, ↑ ↓ 16 px, Home, End

StatusBar
  content   Free space: X of Y · N files found (live) · N excluded (button → dialog) ·
            N bytes per cluster (FS) · StorageIQ version
  a11y      progress announced politely at most every 5 s; action results in role=status

Banner, Dialog, Button
  Banner    role=alert; crash tone has Retry; every banner has Dismiss
  Dialog    native <dialog> via showModal(); Escape and Close; focus returns to the opener
  Button    primary (accent) / secondary (panel + border); busy = aria-disabled, no hover change
```
````

- [ ] **Step 10: Contrast report (zero AA failures)**

Run the design-system skill's checker on the tokens and save its output with a one-line header:

```powershell
$checker = '<design-system skill folder>\contrast.py'   # standard-library Python 3
"Contrast report for design/tokens.json (WCAG 2.2; ui = 3:1 for UI parts and focus rings).`n" | Set-Content design/contrast-report.txt
python $checker design/tokens.json | Add-Content design/contrast-report.txt
Get-Content design/contrast-report.txt -Tail 1
```

Expected last line: `  58 pairs, 0 failing AA` (exit code 0). Any FAIL is fixed in `tokens.json`, never per component.

- [ ] **Step 11: Rewrite DESIGN.md**

`DESIGN.md`:

```markdown
# StorageIQ Design System

Mode: **Operate.** StorageIQ is a tool. Clarity, scannability and Windows-native expectations come before visual expression. Character shows in precise details: a calm teal accent, tabular numbers and monospaced paths.

Since Phase 3 the window is an analyzer workspace: ribbon, column tree, treemap pane, level bar and status bar. Its structure (density, row height, column order and widths, pane sizes) is measured from the owner's reference screenshots; its name, icons, palette, fonts and copy are StorageIQ's own.

## Principles

1. Feel at home on Windows 11: Segoe UI Variable, 4 px control radius, 8 px panel radius, native title bar, native Explorer context menu.
2. Data first: numbers use tabular figures; paths use Cascadia Mono; nothing decorative competes with sizes.
3. One accent, used for focus rings and pressed toggles; data bars use the bar tokens and treemap blocks the treemap tokens.
4. Follow the system light/dark theme; no custom theme switcher in the MVP.
5. Respect `prefers-reduced-motion`; motion is never needed to understand state.
6. Icons are Lucide (MIT, `lucide-react`), decorative (`aria-hidden`), always next to a visible label or an `aria-label`.

## Tokens

Source of truth: `design/tokens.json`. `npm run tokens` writes `design/tokens.css` (CSS custom properties for light and dark); `src/renderer/src/styles/global.css` imports it and maps it into Tailwind (`bg-panel`, `text-ink-muted`, `bg-selection`, …). Components never use raw hex. CI fails when `tokens.css` is stale (`node scripts/build-tokens.mjs --check`).

Contrast: `design/contrast-report.txt` lists every text/background and UI pair in both themes with its WCAG ratio; it has zero AA failures. Re-run the design-system contrast checker on `design/tokens.json` after any palette change.

| Role                               | Light                  | Dark                     | Utility                          |
| ---------------------------------- | ---------------------- | ------------------------ | -------------------------------- |
| `surface-app`                      | `#f6f7f7`              | `#161a1b`                | `bg-app` (= window background)   |
| `surface-panel`                    | `#ffffff`              | `#1e2324`                | `bg-panel`                       |
| `surface-sunken`                   | `#eef0f0`              | `#121516`                | `bg-sunken`                      |
| `border` / `border-strong`         | `#dde1e1` / `#7d8889`  | `#2e3536` / `#7c8889`    | `border-line` / `bg-line-strong` |
| `text` / `text-muted`              | `#1b2122` / `#5b6667`  | `#e6eaea` / `#9aa5a6`    | `text-ink` / `text-ink-muted`    |
| `accent` / `on-accent`             | `#0f7a73` / `#ffffff`  | `#4fc1b6` / `#062421`    | `bg-accent` / `text-on-accent`   |
| `selection` / `row-hover`          | `#cde6e3` / `#eef3f2`  | `#1e3734` / `#1b2a29`    | `bg-selection` / `bg-row-hover`  |
| `bar` / `bar-fill`                 | `#dcebe9` / `#2f8f87`  | `#1f3331` / `#4fc1b6`    | `bg-bar` / `bg-bar-fill`         |
| `pressed`                          | `#d6ebe8`              | `#1f3b38`                | `aria-pressed:bg-pressed`        |
| `treemap-0/1/2`, `-files`, `-free` | teal tints, grey, sand | deep teals, slate, umber | canvas only                      |
| `danger`                           | `#b3261e`              | `#f2b8b5`                | `text-danger`                    |

Layout tokens (`--size-*`): tab strip 28, ribbon body 88, header row 32, tree row 30, indent 16, columns 280+/112/112/96/96/112/120, treemap 260 (min 120), level bar 36, status bar 26, splitter 6 (px).

Typography: body 14 px / 1.43 `Segoe UI Variable Text`; ribbon captions and status text 12 px; paths `Cascadia Mono` 13 px.

## Components

Specs with every state and keyboard behaviour: `design/components.md`. Summary:

- **Ribbon**: a tab list (File, Home, Scan, View) over one toolbar of labelled groups; toggles use `aria-pressed`, unavailable commands `aria-disabled` (still focusable). Arrow keys move inside the tab list and the toolbar (native `focusgroup`, with a script fallback).
- **Select menu**: a menu button with grouped items (Drives, Documents and cloud, Recently scanned, Directory).
- **Column tree**: a virtualized ARIA treegrid; Name cell shows the Mode value over a bar sized to the share of the parent; rows at 10 % or more are bold; one "[N files]" row per folder.
- **Explorer context menu**: the real Windows shell menu, with StorageIQ's items first.
- **Treemap pane**: a canvas image with a header (title, × to hide), a level bar (Level 0–5) and a splitter above it.
- **Status bar**: free space, files found, excluded items (opens their list), bytes per cluster and file system.
- **Banner** (`role="alert"`), **Dialog** (native `<dialog>`), **Button** (primary/secondary; busy = `aria-disabled` with no hover change).

## Guidance applied

- modern-web-guidance "menu": menu button opens with Enter/Space/click, ArrowDown enters, Escape returns focus, Tab and outside click close; script positioning because Electron 45's Chromium has no CSS anchor positioning.
- "toolbar" and "tabs": one tab stop, arrow keys, `aria-pressed` toggles, `aria-disabled` instead of `disabled`, selection follows focus in the tab list.
- Canvas: the treemap is `role="img"` with a label; the tree is the accessible equivalent (the experimental canvas-to-HTML route is not used).
- Target sizes: ribbon commands are at least 56 × 64 px; small toggles, menu items and the splitter at least 24 px tall (WCAG 2.2 SC 2.5.8).
```

- [ ] **Step 12: Gates**

```powershell
npm run format
npm run format:check
npm run lint
npm run typecheck
npx vitest run
```

Expected: all green (the 2a screens still render with the remapped utilities).

- [ ] **Step 13: Commit**

```powershell
git add design/tokens.json design/tokens.css design/components.md design/contrast-report.txt scripts/build-tokens.mjs src/renderer/src/styles/global.css src/main/window-options.ts src/main/window-options.test.ts DESIGN.md .prettierignore package.json package-lock.json
git commit -m @'
feat(design): workspace design tokens, Tailwind mapping, components and contrast report

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 2: Columnar tree store in the scanner

**Implementer tier:** cheap

The scanner keeps every folder and file. Per file: parent and next-sibling `Int32`, size `Float64`, modification time in seconds `Uint32` (20 bytes) plus its name string; allocated size is derived as `ceil(size / clusterBytes) * clusterBytes` (0-byte files and links take 0). Per folder: links, subtree totals (size, allocated, files, folders, newest modification) and the totals of the files directly in it (the "[N files]" row). The walk sink now receives names and `mtimeMs`; extra parameters are ignored by the old `tree.ts` sink, so 2a keeps compiling until Task 4 removes it.

**Files:**

- Create: `src/shared/tree-types.ts`, `src/worker/scanner/tree-store.ts`, `tree-store.test.ts`
- Modify: `src/worker/scanner/walk.ts`, `src/worker/scanner/test/fake-walk-fs.ts`

**Interfaces:**

- Produces: everything in `src/shared/tree-types.ts` (see the shared type names); `WalkStats.mtimeMs`; `WalkSink.folder(parent, name, modifiedMs)`, `file(parent, bytes, name, modifiedMs)`; `allocatedSize(size, clusterBytes)`, `scanErrorReason(code)`, `MAX_SCAN_ERRORS`, `NONE`, `DETACHED`, class `TreeStore(rootPath, clusterBytes, freeBytes = null)` with `folder/file/error/visiting`, `totals()`, `folder*`/`file*`/`direct*` readers, `childFolders`, `filesIn`, `isLiveFolder`, `isLiveFile`, `folderChain`, `folderPath`, `filePath`, `resetFolder`, `version`, `folderLength`, `fileLength`, `errors`, `errorCount`, `currentPath`, `freeBytes`.

- [ ] **Step 1: Shared tree types**

`src/shared/tree-types.ts`:

```ts
/**
 * Row identity in the scan tree. The scanner owns the tree; the renderer only ever holds pages.
 * `d<n>` is folder n (`d0` is the scanned root), `g<n>` is the "[N files]" row that groups the
 * files directly in folder n, and `f<n>` is file n.
 */
export type NodeId = string

export const ROOT_NODE_ID: NodeId = 'd0'
export const NODE_ID_PATTERN = /^[dgf]\d{1,9}$/

export type NodeKind = 'folder' | 'files' | 'file'

/** The Mode toggle: the value the tree bars and the treemap use. */
export type SizeMode = 'size' | 'allocated' | 'files' | 'percent'
export const SIZE_MODES: readonly SizeMode[] = ['size', 'allocated', 'files', 'percent']

/** Keys the scanner can sort children by. The "% of Parent" column sorts by the Mode value. */
export type SortKey = 'name' | 'size' | 'allocated' | 'files' | 'folders' | 'modified'
export const SORT_KEYS: readonly SortKey[] = [
  'name',
  'size',
  'allocated',
  'files',
  'folders',
  'modified',
]

export type SortDir = 'asc' | 'desc'

/** Most rows one `tree:children` call returns. */
export const MAX_PAGE_ROWS = 1000

/** Deepest treemap nesting the level bar offers (Level 0 to Level 5). */
export const MAX_TREEMAP_DEPTH = 5

/** One row of the column tree. */
export interface TreeRow {
  id: NodeId
  parentId: NodeId | null
  kind: NodeKind
  /** Folder or file name; the scanned path for the root; `''` for a "[N files]" row. */
  name: string
  /** Logical size in bytes (`stat.size`). */
  size: number
  /** Size rounded up to whole clusters. */
  allocated: number
  /** Files below this row (1 for a file). */
  files: number
  /** Folders below this row, not counting itself. */
  folders: number
  /** Newest modification time below this row, in ms since the epoch (0 when unknown). */
  modifiedMs: number
  /** Number of child rows (`tree:children` total). */
  childCount: number
}

/** A page of a row's children, in the requested order. */
export interface TreePage {
  parent: TreeRow
  /** All children of `parent`, not just this page. */
  total: number
  offset: number
  rows: TreeRow[]
}

/** Where one node sits: each ancestor and the node's own index in its parent's sorted children. */
export interface TreeLocation {
  parentId: NodeId
  index: number
}

export interface TreeNodeDetails {
  row: TreeRow
  /** Full path on disk. */
  path: string
  /** From the root down to the node's parent. */
  ancestorIds: NodeId[]
  /** For each step from the root down to the node: the child's index in the requested sort. */
  locations: TreeLocation[]
}

export type TreemapBlockKind = NodeKind | 'free'

/** One rectangle of the treemap, in CSS pixels of the requested canvas size. */
export interface TreemapRect {
  /** `null` for the "Free space" block. */
  id: NodeId | null
  kind: TreemapBlockKind
  name: string
  /** The Mode value the area stands for. */
  value: number
  /** Files below the block (for the "[N files]" label). */
  files: number
  /** 0 for the selected folder's children, 1 for their children, and so on. */
  depth: number
  x: number
  y: number
  w: number
  h: number
  /** True when the rectangle holds nested rectangles under a label strip. */
  nested: boolean
}

export interface TreemapLayout {
  nodeId: NodeId
  width: number
  height: number
  rects: TreemapRect[]
}

/** Totals of the scanned root; sent with `tree:changed` after a folder is refreshed. */
export interface TreeTotals {
  files: number
  folders: number
  bytes: number
  allocatedBytes: number
}

export interface TreeChanged {
  scanId: string
  /** The folder that was rescanned. */
  nodeId: NodeId
  totals: TreeTotals
}

/** The value a row stands for in the given Mode (Percent ranks by size). */
export function modeValue(
  row: Pick<TreeRow, 'size' | 'allocated' | 'files'>,
  mode: SizeMode,
): number {
  switch (mode) {
    case 'allocated':
      return row.allocated
    case 'files':
      return row.files
    case 'size':
    case 'percent':
      return row.size
  }
}

/** The sort key that ranks rows by the Mode value. */
export function modeSortKey(mode: SizeMode): SortKey {
  if (mode === 'allocated') return 'allocated'
  if (mode === 'files') return 'files'
  return 'size'
}

export function folderIndexOf(id: NodeId): number | null {
  return id.startsWith('d') || id.startsWith('g') ? Number(id.slice(1)) : null
}
```

- [ ] **Step 2: Write the failing store tests**

`src/worker/scanner/tree-store.test.ts`:

```ts
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { allocatedSize, MAX_SCAN_ERRORS, scanErrorReason, TreeStore } from './tree-store'

const ROOT = 'C:\\Data'

/** Data\Photos\2024\{a 300, b 200}, Data\Photos\c 50, Data\notes 5. */
function sample() {
  const store = new TreeStore(ROOT, 4096)
  const photos = store.folder(0, 'Photos', 1_000)
  const year = store.folder(photos, '2024', 2_000)
  store.file(year, 300, 'a.jpg', 5_000)
  store.file(year, 200, 'b.jpg', 4_000)
  store.file(photos, 50, 'c.jpg', 3_000)
  store.file(0, 5, 'notes.txt', 9_000)
  return { store, photos, year }
}

describe('allocatedSize', () => {
  it.each([
    [0, 4096, 0],
    [1, 4096, 4096],
    [4096, 4096, 4096],
    [4097, 4096, 8192],
    [10_000, 512, 10_240],
    [123, 0, 123],
  ])('size %d with %d-byte clusters takes %d bytes', (size, cluster, expected) => {
    expect(allocatedSize(size, cluster)).toBe(expected)
  })
})

describe('TreeStore', () => {
  it('starts with only the root', () => {
    const store = new TreeStore(ROOT, 4096)
    expect(store.totals()).toEqual({ files: 0, folders: 0, bytes: 0, allocatedBytes: 0 })
    expect(store.folderName(0)).toBe(ROOT)
    expect(store.folderParent(0)).toBe(-1)
    expect(store.currentPath).toBe(ROOT)
    expect(store.folderLength).toBe(1)
  })

  it('bubbles size, allocated size and counts up to every ancestor', () => {
    const { store, photos, year } = sample()
    expect(store.folderSize(year)).toBe(500)
    expect(store.folderAllocated(year)).toBe(8192)
    expect(store.folderFiles(year)).toBe(2)
    expect(store.folderFolders(photos)).toBe(1)
    expect(store.folderSize(photos)).toBe(550)
    expect(store.folderAllocated(photos)).toBe(12_288)
    expect(store.totals()).toEqual({ files: 4, folders: 2, bytes: 555, allocatedBytes: 16_384 })
  })

  it('keeps the files directly in each folder as their own totals', () => {
    const { store, photos } = sample()
    expect(store.directFiles(photos)).toBe(1)
    expect(store.directSize(photos)).toBe(50)
    expect(store.directAllocated(photos)).toBe(4096)
    expect(store.directModified(photos)).toBe(3_000)
    expect(store.directFiles(0)).toBe(1)
  })

  it('takes the newest modification time below each folder', () => {
    const { store, photos, year } = sample()
    expect(store.folderModified(year)).toBe(5_000)
    expect(store.folderModified(photos)).toBe(5_000)
    expect(store.folderModified(0)).toBe(9_000)
  })

  it('lists children and files and builds full paths', () => {
    const { store, photos, year } = sample()
    expect(store.childFolders(0)).toEqual([photos])
    expect(store.childFolders(photos)).toEqual([year])
    expect(
      store
        .filesIn(year)
        .map((f) => store.fileName(f))
        .sort(),
    ).toEqual(['a.jpg', 'b.jpg'])
    expect(store.folderPath(year)).toBe(path.join(ROOT, 'Photos', '2024'))
    expect(store.folderPath(0)).toBe(ROOT)
    const [first] = store.filesIn(year)
    expect(store.filePath(first ?? -1)).toMatch(/^C:\\Data\\Photos\\2024\\[ab]\.jpg$/)
  })

  it('grows past its initial capacity', () => {
    const store = new TreeStore(ROOT, 4096)
    let parent = 0
    for (let i = 0; i < 3000; i += 1) parent = store.folder(parent, `d${i}`, i)
    for (let i = 0; i < 20_000; i += 1) store.file(parent, 1, `f${i}`, i)
    expect(store.totals()).toEqual({
      files: 20_000,
      folders: 3000,
      bytes: 20_000,
      allocatedBytes: 20_000 * 4096,
    })
    expect(store.folderFiles(store.folderChain(parent)[1] ?? -1)).toBe(20_000)
  })

  it('resetFolder removes a subtree from every total and detaches its entries', () => {
    const { store, photos, year } = sample()
    const [file] = store.filesIn(year)
    store.resetFolder(photos)

    expect(store.totals()).toEqual({ files: 1, folders: 1, bytes: 5, allocatedBytes: 4096 })
    expect(store.folderSize(photos)).toBe(0)
    expect(store.childFolders(photos)).toEqual([])
    expect(store.isLiveFolder(photos)).toBe(true)
    expect(store.isLiveFolder(year)).toBe(false)
    expect(store.isLiveFile(file ?? -1)).toBe(false)
    expect(store.folderModified(0)).toBe(9_000)
    expect(store.folderModified(photos)).toBe(1_000)
  })

  it('refills a reset folder through the walk sink', () => {
    const { store, photos } = sample()
    store.resetFolder(photos)
    store.file(photos, 7, 'new.txt', 10_000)
    expect(store.totals()).toEqual({ files: 2, folders: 1, bytes: 12, allocatedBytes: 8192 })
    expect(store.folderModified(0)).toBe(10_000)
  })

  it('bumps its version on every change', () => {
    const store = new TreeStore(ROOT, 4096)
    const before = store.version
    store.file(0, 1, 'a', 0)
    expect(store.version).toBeGreaterThan(before)
  })

  it('rejects ids outside the tree', () => {
    const { store } = sample()
    expect(store.isLiveFolder(99)).toBe(false)
    expect(store.isLiveFolder(-1)).toBe(false)
    expect(store.isLiveFile(4)).toBe(false)
    expect(store.isLiveFile(0)).toBe(true)
  })

  it('tracks the folder being listed', () => {
    const store = new TreeStore(ROOT, 4096)
    store.visiting(path.join(ROOT, 'Photos'))
    expect(store.currentPath).toBe(path.join(ROOT, 'Photos'))
  })

  it('keeps the first 1000 errors and counts every one', () => {
    const store = new TreeStore(ROOT, 4096)
    for (let i = 0; i < MAX_SCAN_ERRORS + 5; i += 1) {
      store.error(path.join(ROOT, `locked-${i}`), 'EPERM', 'folder')
    }
    expect(store.errors).toHaveLength(1000)
    expect(store.errorCount).toBe(1005)
    expect(store.errors[0]).toEqual({
      path: path.join(ROOT, 'locked-0'),
      kind: 'folder',
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
  ])('maps %s to %s', (code, reason) => {
    expect(scanErrorReason(code)).toBe(reason)
  })
})
```

- [ ] **Step 3: Run them**

```powershell
npx vitest run src/worker/scanner/tree-store.test.ts
```

Expected: FAIL — `Cannot find module './tree-store'`.

- [ ] **Step 4: Walk sink with names and modification times**

`src/worker/scanner/walk.ts`:

```ts
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import type { ScanErrorKind } from '@shared/scan-types'

/**
 * One directory entry. `isDirectory()` comes from the directory listing itself (no handle is
 * opened), so it is known even when `lstat` later fails. For entries `lstat` can read, the
 * walk trusts `lstat` for the type.
 */
export interface WalkDirent {
  name: string
  isDirectory(): boolean
}

export interface WalkStats {
  size: number
  /** Last modification time in ms since the epoch. */
  mtimeMs: number
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
  folder(parent: D, name: string, modifiedMs: number): D
  /**
   * A file, link or other non-folder entry inside `parent`. Links count with 0 bytes.
   * `modifiedMs` is 0 when `lstat` failed.
   */
  file(parent: D, bytes: number, name: string, modifiedMs: number): void
  /** `path` could not be listed or inspected; the walk continues. */
  error(path: string, code: string, kind: ScanErrorKind): void
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

    const inspect = async (dirPath: string, handle: D, entries: WalkDirent[]): Promise<void> => {
      const results = await Promise.all(
        entries.map(async (entry) => {
          const { name } = entry
          const entryPath = path.join(dirPath, name)
          try {
            return { name, entryPath, stats: await fs.lstat(entryPath) }
          } catch (error) {
            const isFolder = entry.isDirectory() // a method call: a real Dirent needs its own `this`
            sink.error(entryPath, errorCode(error), isFolder ? 'folder' : 'file')
            // Windows refuses lstat on locked system files (pagefile.sys, hiberfil.sys,
            // swapfile.sys, DumpStack.log.tmp). They are still files, so count them, at 0
            // bytes. Phase 2b will read their real size through koffi (FindFirstFileExW).
            if (!isFolder) sink.file(handle, 0, name, 0)
            return null
          }
        }),
      )
      for (const result of results) {
        if (result === null) continue
        const { stats } = result
        if (stats.isSymbolicLink()) {
          // symlinks and junctions are counted, never entered
          sink.file(handle, 0, result.name, stats.mtimeMs)
        } else if (stats.isDirectory()) {
          queue.push({
            path: result.entryPath,
            handle: sink.folder(handle, result.name, stats.mtimeMs),
          })
        } else {
          sink.file(handle, stats.size, result.name, stats.mtimeMs)
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
        sink.error(dirPath, errorCode(error), 'folder')
        return
      }
      let batch: WalkDirent[] = []
      try {
        for await (const entry of entries) {
          if (signal.aborted) break
          batch.push(entry)
          if (batch.length >= LSTAT_BATCH_SIZE) {
            const entriesToInspect = batch
            batch = []
            await inspect(dirPath, handle, entriesToInspect)
          }
        }
      } catch (error) {
        sink.error(dirPath, errorCode(error), 'folder')
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

The fake file system now looks entries up from the live tree, so a test can change it between scans, and gives files a modification time. `src/worker/scanner/test/fake-walk-fs.ts`:

```ts
import path from 'node:path'
import type { WalkDirent, WalkFs, WalkStats } from '../walk'

export type FakeNode =
  | { type: 'dir'; children: Record<string, FakeNode> }
  | { type: 'file'; size: number; mtimeMs: number }
  | { type: 'link' }

export const dir = (children: Record<string, FakeNode> = {}): FakeNode => ({
  type: 'dir',
  children,
})
export const file = (size: number, mtimeMs = 0): FakeNode => ({ type: 'file', size, mtimeMs })
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
  // Entries are looked up from `root` on every call, so a test can change the tree between scans.
  const nodes = {
    get(nodePath: string): FakeNode | undefined {
      const relative = path.relative(rootPath, nodePath)
      if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined
      let node: FakeNode | undefined = root
      for (const name of relative === '' ? [] : relative.split(path.sep)) {
        node = node?.type === 'dir' ? node.children[name] : undefined
      }
      return node
    },
  }

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
              // Like a real Dirent, `isDirectory` only works as a method call (it reads `this`).
              yield {
                name,
                isDirectory(this: { name: string }) {
                  return nodes.get(path.join(dirPath, this.name))?.type === 'dir'
                },
              }
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
        mtimeMs: node.type === 'file' ? node.mtimeMs : 0,
        isDirectory: () => node.type === 'dir',
        isSymbolicLink: () => node.type === 'link',
      }
    },
  }
}
```

- [ ] **Step 5: The store**

`src/worker/scanner/tree-store.ts`:

```ts
import path from 'node:path'
import type { ScanError, ScanErrorKind, ScanErrorReason } from '@shared/scan-types'
import type { TreeTotals } from '@shared/tree-types'
import type { WalkSink } from './walk'

export const MAX_SCAN_ERRORS = 1000
/** No folder or file. */
export const NONE = -1
/** `parent` of an entry removed by `resetFolder`: it is no longer part of the tree. */
export const DETACHED = -2

const INITIAL_FOLDERS = 1024
const INITIAL_FILES = 8192

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

/**
 * Space a file takes on disk: whole clusters, `ceil(size / clusterBytes) * clusterBytes`.
 * 0-byte files take 0. This ignores NTFS compression, sparse files and files small enough to
 * live inside the MFT record (Phase 7 reads the real on-disk size).
 */
export function allocatedSize(size: number, clusterBytes: number): number {
  if (size <= 0) return 0
  if (clusterBytes <= 0) return size
  return Math.ceil(size / clusterBytes) * clusterBytes
}

function grownF64(array: Float64Array, length: number): Float64Array<ArrayBuffer> {
  const next = new Float64Array(length)
  next.set(array)
  return next
}

function grownI32(array: Int32Array, length: number): Int32Array<ArrayBuffer> {
  const next = new Int32Array(length)
  next.set(array)
  return next
}

/**
 * The scan tree in columnar form: one typed-array slot per folder and per file, plus one string
 * per entry name. Folder 0 is the scanned root. Children are singly linked lists (newest first);
 * the query layer sorts them. Every total is kept for the whole subtree, so a row never needs a
 * walk to be read. Memory is 20 bytes per file plus its name (about 125 bytes per file in all).
 */
export class TreeStore implements WalkSink<number> {
  readonly rootPath: string
  readonly clusterBytes: number
  /** Free bytes on the drive when the root is a drive root (for the treemap), else null. */
  readonly freeBytes: number | null
  /** Increments on every change; caches compare against it. */
  version = 0
  currentPath: string
  errorCount = 0
  readonly errors: ScanError[] = []

  folderLength = 0
  fileLength = 0

  // Per folder.
  private fParent = new Int32Array(INITIAL_FOLDERS)
  private fFirstChild = new Int32Array(INITIAL_FOLDERS)
  private fNextSibling = new Int32Array(INITIAL_FOLDERS)
  private fFirstFile = new Int32Array(INITIAL_FOLDERS)
  private fChildCount = new Int32Array(INITIAL_FOLDERS)
  private fDirectFiles = new Int32Array(INITIAL_FOLDERS)
  private fSize = new Float64Array(INITIAL_FOLDERS)
  private fAllocated = new Float64Array(INITIAL_FOLDERS)
  private fFiles = new Float64Array(INITIAL_FOLDERS)
  private fFolders = new Float64Array(INITIAL_FOLDERS)
  private fModified = new Float64Array(INITIAL_FOLDERS)
  private fOwnModified = new Float64Array(INITIAL_FOLDERS)
  private fDirectSize = new Float64Array(INITIAL_FOLDERS)
  private fDirectAllocated = new Float64Array(INITIAL_FOLDERS)
  private fDirectModified = new Float64Array(INITIAL_FOLDERS)
  private readonly folderNames: string[] = []

  // Per file: 20 bytes. Allocated size is derived from size; modification time is kept in
  // whole seconds (enough for a date column, and it halves that column).
  private pParent = new Int32Array(INITIAL_FILES)
  private pNext = new Int32Array(INITIAL_FILES)
  private pSize = new Float64Array(INITIAL_FILES)
  private pModifiedSeconds = new Uint32Array(INITIAL_FILES)
  private readonly fileNames: string[] = []

  constructor(rootPath: string, clusterBytes: number, freeBytes: number | null = null) {
    this.rootPath = rootPath
    this.clusterBytes = clusterBytes
    this.freeBytes = freeBytes
    this.currentPath = rootPath
    this.addFolderSlot(NONE, rootPath, 0)
  }

  // ---- WalkSink ---------------------------------------------------------------------------

  folder(parent: number, name: string, modifiedMs: number): number {
    const index = this.addFolderSlot(parent, name, modifiedMs)
    this.fNextSibling[index] = this.fFirstChild[parent] ?? NONE
    this.fFirstChild[parent] = index
    this.fChildCount[parent] = (this.fChildCount[parent] ?? 0) + 1
    for (let a = parent; a >= 0; a = this.fParent[a] ?? NONE) {
      this.fFolders[a] = (this.fFolders[a] ?? 0) + 1
      if ((this.fModified[a] ?? 0) < modifiedMs) this.fModified[a] = modifiedMs
    }
    return index
  }

  file(parent: number, bytes: number, name: string, modifiedMs: number): void {
    if (this.fileLength === this.pParent.length) this.growFiles()
    const index = this.fileLength
    this.fileLength += 1
    const allocated = allocatedSize(bytes, this.clusterBytes)
    this.pParent[index] = parent
    this.pNext[index] = this.fFirstFile[parent] ?? NONE
    this.fFirstFile[parent] = index
    this.pSize[index] = bytes
    this.pModifiedSeconds[index] = Math.min(0xffffffff, Math.max(0, Math.floor(modifiedMs / 1000)))
    this.fileNames.push(name)

    this.fDirectFiles[parent] = (this.fDirectFiles[parent] ?? 0) + 1
    this.fDirectSize[parent] = (this.fDirectSize[parent] ?? 0) + bytes
    this.fDirectAllocated[parent] = (this.fDirectAllocated[parent] ?? 0) + allocated
    if ((this.fDirectModified[parent] ?? 0) < modifiedMs) this.fDirectModified[parent] = modifiedMs
    for (let a = parent; a >= 0; a = this.fParent[a] ?? NONE) {
      this.fFiles[a] = (this.fFiles[a] ?? 0) + 1
      this.fSize[a] = (this.fSize[a] ?? 0) + bytes
      this.fAllocated[a] = (this.fAllocated[a] ?? 0) + allocated
      if ((this.fModified[a] ?? 0) < modifiedMs) this.fModified[a] = modifiedMs
    }
    this.version += 1
  }

  error(errorPath: string, code: string, kind: ScanErrorKind): void {
    this.errorCount += 1
    if (this.errors.length < MAX_SCAN_ERRORS) {
      this.errors.push({ path: errorPath, kind, reason: scanErrorReason(code), code })
    }
  }

  visiting(dirPath: string): void {
    this.currentPath = dirPath
  }

  // ---- Reads --------------------------------------------------------------------------------

  totals(): TreeTotals {
    return {
      files: this.fFiles[0] ?? 0,
      folders: this.fFolders[0] ?? 0,
      bytes: this.fSize[0] ?? 0,
      allocatedBytes: this.fAllocated[0] ?? 0,
    }
  }

  folderParent(index: number): number {
    return this.fParent[index] ?? NONE
  }
  folderName(index: number): string {
    return this.folderNames[index] ?? ''
  }
  folderSize(index: number): number {
    return this.fSize[index] ?? 0
  }
  folderAllocated(index: number): number {
    return this.fAllocated[index] ?? 0
  }
  folderFiles(index: number): number {
    return this.fFiles[index] ?? 0
  }
  folderFolders(index: number): number {
    return this.fFolders[index] ?? 0
  }
  folderModified(index: number): number {
    return this.fModified[index] ?? 0
  }
  folderChildCount(index: number): number {
    return this.fChildCount[index] ?? 0
  }
  directFiles(index: number): number {
    return this.fDirectFiles[index] ?? 0
  }
  directSize(index: number): number {
    return this.fDirectSize[index] ?? 0
  }
  directAllocated(index: number): number {
    return this.fDirectAllocated[index] ?? 0
  }
  directModified(index: number): number {
    return this.fDirectModified[index] ?? 0
  }

  fileParent(index: number): number {
    return this.pParent[index] ?? NONE
  }
  fileName(index: number): string {
    return this.fileNames[index] ?? ''
  }
  fileSize(index: number): number {
    return this.pSize[index] ?? 0
  }
  fileAllocated(index: number): number {
    return allocatedSize(this.pSize[index] ?? 0, this.clusterBytes)
  }
  /** Modification time in ms, to the second. */
  fileModified(index: number): number {
    return (this.pModifiedSeconds[index] ?? 0) * 1000
  }

  /** Child folders of `index`, in no particular order. */
  childFolders(index: number): number[] {
    const children: number[] = []
    for (let c = this.fFirstChild[index] ?? NONE; c !== NONE; c = this.fNextSibling[c] ?? NONE) {
      children.push(c)
    }
    return children
  }

  /** Files directly in folder `index`, in no particular order. */
  filesIn(index: number): number[] {
    const files: number[] = []
    for (let f = this.fFirstFile[index] ?? NONE; f !== NONE; f = this.pNext[f] ?? NONE) {
      files.push(f)
    }
    return files
  }

  /** True when the folder exists and is still attached to the root. */
  isLiveFolder(index: number): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= this.folderLength) return false
    for (let a = index; a !== 0; a = this.fParent[a] ?? DETACHED) {
      if (a < 0) return false
    }
    return true
  }

  isLiveFile(index: number): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= this.fileLength) return false
    return this.isLiveFolder(this.pParent[index] ?? DETACHED)
  }

  /** Folders from the root down to `index`, both included. */
  folderChain(index: number): number[] {
    const chain: number[] = []
    for (let a = index; a >= 0; a = this.fParent[a] ?? NONE) chain.push(a)
    return chain.reverse()
  }

  folderPath(index: number): string {
    const names = this.folderChain(index)
      .slice(1)
      .map((folder) => this.folderName(folder))
    return names.length === 0 ? this.rootPath : path.join(this.rootPath, ...names)
  }

  filePath(index: number): string {
    return path.join(this.folderPath(this.fileParent(index)), this.fileName(index))
  }

  // ---- Refresh ------------------------------------------------------------------------------

  /**
   * Empties folder `index` so a new walk can fill it again: its totals leave every ancestor, its
   * children and files are detached (their slots are not reused), and the ancestors' newest
   * modification time is recomputed from what is left.
   */
  resetFolder(index: number): void {
    const files = this.fFiles[index] ?? 0
    const folders = this.fFolders[index] ?? 0
    const size = this.fSize[index] ?? 0
    const allocated = this.fAllocated[index] ?? 0
    for (let a = this.fParent[index] ?? NONE; a >= 0; a = this.fParent[a] ?? NONE) {
      this.fFiles[a] = (this.fFiles[a] ?? 0) - files
      this.fFolders[a] = (this.fFolders[a] ?? 0) - folders
      this.fSize[a] = (this.fSize[a] ?? 0) - size
      this.fAllocated[a] = (this.fAllocated[a] ?? 0) - allocated
    }
    for (const child of this.childFolders(index)) this.fParent[child] = DETACHED
    for (const file of this.filesIn(index)) this.pParent[file] = DETACHED
    this.fFirstChild[index] = NONE
    this.fFirstFile[index] = NONE
    this.fChildCount[index] = 0
    this.fDirectFiles[index] = 0
    this.fDirectSize[index] = 0
    this.fDirectAllocated[index] = 0
    this.fDirectModified[index] = 0
    this.fFiles[index] = 0
    this.fFolders[index] = 0
    this.fSize[index] = 0
    this.fAllocated[index] = 0
    this.fModified[index] = this.fOwnModified[index] ?? 0
    for (let a = this.fParent[index] ?? NONE; a >= 0; a = this.fParent[a] ?? NONE) {
      let newest = Math.max(this.fOwnModified[a] ?? 0, this.fDirectModified[a] ?? 0)
      for (const child of this.childFolders(a))
        newest = Math.max(newest, this.fModified[child] ?? 0)
      this.fModified[a] = newest
    }
    this.version += 1
  }

  // ---- Storage ------------------------------------------------------------------------------

  private addFolderSlot(parent: number, name: string, modifiedMs: number): number {
    if (this.folderLength === this.fParent.length) this.growFolders()
    const index = this.folderLength
    this.folderLength += 1
    this.fParent[index] = parent
    this.fFirstChild[index] = NONE
    this.fNextSibling[index] = NONE
    this.fFirstFile[index] = NONE
    this.fModified[index] = modifiedMs
    this.fOwnModified[index] = modifiedMs
    this.folderNames.push(name)
    this.version += 1
    return index
  }

  private growFolders(): void {
    const length = Math.ceil(this.fParent.length * 1.5)
    this.fParent = grownI32(this.fParent, length)
    this.fFirstChild = grownI32(this.fFirstChild, length)
    this.fNextSibling = grownI32(this.fNextSibling, length)
    this.fFirstFile = grownI32(this.fFirstFile, length)
    this.fChildCount = grownI32(this.fChildCount, length)
    this.fDirectFiles = grownI32(this.fDirectFiles, length)
    this.fSize = grownF64(this.fSize, length)
    this.fAllocated = grownF64(this.fAllocated, length)
    this.fFiles = grownF64(this.fFiles, length)
    this.fFolders = grownF64(this.fFolders, length)
    this.fModified = grownF64(this.fModified, length)
    this.fOwnModified = grownF64(this.fOwnModified, length)
    this.fDirectSize = grownF64(this.fDirectSize, length)
    this.fDirectAllocated = grownF64(this.fDirectAllocated, length)
    this.fDirectModified = grownF64(this.fDirectModified, length)
  }

  private growFiles(): void {
    const length = Math.ceil(this.pParent.length * 1.5)
    this.pParent = grownI32(this.pParent, length)
    this.pNext = grownI32(this.pNext, length)
    this.pSize = grownF64(this.pSize, length)
    const seconds = new Uint32Array(length)
    seconds.set(this.pModifiedSeconds)
    this.pModifiedSeconds = seconds
  }
}
```

- [ ] **Step 6: Run the store and walk tests**

```powershell
npx vitest run src/worker/scanner/tree-store.test.ts src/worker/scanner/walk.test.ts
```

Expected: PASS — 38 tests.

- [ ] **Step 7: Gates**

```powershell
npm run format
npm run lint
npm run typecheck
npx vitest run
```

Expected: all green.

- [ ] **Step 8: Commit**

```powershell
git add src/shared/tree-types.ts src/worker/scanner/tree-store.ts src/worker/scanner/tree-store.test.ts src/worker/scanner/walk.ts src/worker/scanner/test/fake-walk-fs.ts
git commit -m @'
feat(scanner): columnar tree store with files and allocated size

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 3: Tree queries and the squarified treemap

**Implementer tier:** cheap

Pure functions over the store, plus the 1M-file perf limits, which run alone through `npm run test:perf` with `--expose-gc` (memory is measured after `gc()`; names are built as flat strings like the ones `fs.opendir` returns; the treemap time is the median of three layouts after a warm-up, so JIT compilation is not counted). Children are sorted per request and cached per (node, key, direction) until the store changes (the cache keeps 64 orders). Ties fall back to name, then id, so sorts are stable. The treemap is Bruls–Huizing–van Wijk squarify; nested blocks sit under an 18 px label strip with a 2 px inset; blocks smaller than 4 px² are dropped and at most 20,000 rectangles are returned.

**Files:**

- Create: `src/worker/scanner/tree-queries.ts`, `tree-queries.test.ts`, `treemap.ts`, `treemap.test.ts`, `tree-store.perf.test.ts`, `vitest.perf.config.mts`
- Modify: `vitest.config.mts` (perf tests excluded from the default run), `tsconfig.node.json`, `package.json` (`test:perf`)

**Interfaces:**

- Consumes: `TreeStore`, `tree-types`.
- Produces: `NodeRef`, `MAX_EXPAND_IDS = 5000`, `nodeIdOf`, `resolveNode`, `parentOf`, `folderOf`, `rowOf`, `childRefs`, `compareRows`, class `ChildSorter(store).sorted(ref, key, dir)`, `childrenPage(store, sorter, nodeId, key, dir, offset, limit): TreePage | null`, `nodeDetails(store, sorter, nodeId, key, dir): TreeNodeDetails | null`, `expandIds(store, nodeId, levels): NodeId[]`; `Box`, `TREEMAP_HEADER`, `TREEMAP_INSET`, `MIN_NESTED_SIDE`, `MAX_TREEMAP_RECTS`, `MIN_RECT_AREA`, `squarify(values, box): Box[]`, `treemapLayout(store, nodeId, mode, depth, width, height): TreemapLayout | null`; `PERF_LIMITS`; npm script `test:perf`.

- [ ] **Step 1: Write the failing query tests**

`src/worker/scanner/tree-queries.test.ts`:

```ts
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ChildSorter,
  childrenPage,
  compareRows,
  expandIds,
  MAX_EXPAND_IDS,
  nodeDetails,
  resolveNode,
} from './tree-queries'
import { TreeStore } from './tree-store'

const ROOT = 'C:\\Data'

/**
 * Data
 *   Music (1 file, 100 bytes)
 *   Photos
 *     2024 (2 files, 500 bytes)
 *     c.jpg 50
 *   Video (1 file, 9000 bytes)
 *   notes.txt 5, readme.md 7
 */
function sample() {
  const store = new TreeStore(ROOT, 1024)
  const music = store.folder(0, 'Music', 10)
  const photos = store.folder(0, 'Photos', 20)
  const video = store.folder(0, 'Video', 30)
  const year = store.folder(photos, '2024', 40)
  store.file(music, 100, 'song.mp3', 100)
  store.file(year, 300, 'a.jpg', 300)
  store.file(year, 200, 'b.jpg', 200)
  store.file(photos, 50, 'c.jpg', 50)
  store.file(video, 9000, 'clip.mp4', 900)
  store.file(0, 5, 'notes.txt', 5)
  store.file(0, 7, 'readme.md', 7)
  return { store, sorter: new ChildSorter(store), music, photos, video, year }
}

describe('resolveNode', () => {
  it('accepts folders, file groups and files that exist', () => {
    const { store, photos } = sample()
    expect(resolveNode(store, 'd0')).toEqual({ kind: 'folder', index: 0 })
    expect(resolveNode(store, `g${photos}`)).toEqual({ kind: 'files', index: photos })
    expect(resolveNode(store, 'f0')).toEqual({ kind: 'file', index: 0 })
  })

  it.each(['', 'x1', 'd', 'd-1', 'd99', 'f99', 'g99', 'd1.5', ' d0'])('rejects %j', (id) => {
    const { store } = sample()
    expect(resolveNode(store, id)).toBeNull()
  })

  it('rejects the "[N files]" row of a folder with no files of its own', () => {
    const { store } = sample()
    const empty = store.folder(0, 'Empty', 0)
    expect(resolveNode(store, `g${empty}`)).toBeNull()
  })
})

describe('childrenPage', () => {
  it('lists child folders plus one "[N files]" row, largest first', () => {
    const { store, sorter } = sample()
    const page = childrenPage(store, sorter, 'd0', 'size', 'desc', 0, 100)
    expect(page?.total).toBe(4)
    expect(page?.rows.map((row) => [row.kind, row.name, row.size])).toEqual([
      ['folder', 'Video', 9000],
      ['folder', 'Photos', 550],
      ['folder', 'Music', 100],
      ['files', '', 12],
    ])
    expect(page?.parent).toMatchObject({
      id: 'd0',
      parentId: null,
      name: ROOT,
      size: 9662,
      files: 7,
      folders: 4,
      childCount: 4,
    })
  })

  it('fills every column of a folder row', () => {
    const { store, sorter, photos } = sample()
    const row = childrenPage(store, sorter, 'd0', 'name', 'asc', 0, 100)?.rows.find(
      (r) => r.name === 'Photos',
    )
    expect(row).toEqual({
      id: `d${photos}`,
      parentId: 'd0',
      kind: 'folder',
      name: 'Photos',
      size: 550,
      allocated: 3072,
      files: 3,
      folders: 1,
      modifiedMs: 300,
      childCount: 2,
    })
  })

  it('pages through the sorted rows', () => {
    const { store, sorter } = sample()
    const page = childrenPage(store, sorter, 'd0', 'name', 'asc', 1, 2)
    expect(page?.offset).toBe(1)
    expect(page?.total).toBe(4)
    expect(page?.rows.map((row) => row.name)).toEqual(['Music', 'Photos'])
  })

  it('sorts by every key in both directions', () => {
    const { store, sorter } = sample()
    const names = (key: Parameters<typeof childrenPage>[3], dir: 'asc' | 'desc') =>
      childrenPage(store, sorter, 'd0', key, dir, 0, 10)?.rows.map((row) => row.name || '[files]')
    expect(names('name', 'asc')).toEqual(['[files]', 'Music', 'Photos', 'Video'])
    expect(names('name', 'desc')).toEqual(['Video', 'Photos', 'Music', '[files]'])
    expect(names('files', 'desc')).toEqual(['Photos', '[files]', 'Music', 'Video'])
    expect(names('folders', 'desc')).toEqual(['Photos', '[files]', 'Music', 'Video'])
    expect(names('modified', 'desc')).toEqual(['Video', 'Photos', 'Music', '[files]'])
    expect(names('allocated', 'asc')).toEqual(['Music', '[files]', 'Photos', 'Video'])
  })

  it('lists the files of a "[N files]" row', () => {
    const { store, sorter } = sample()
    const page = childrenPage(store, sorter, 'g0', 'size', 'desc', 0, 10)
    expect(page?.parent).toMatchObject({ kind: 'files', files: 2, size: 12, childCount: 2 })
    expect(page?.rows.map((row) => [row.kind, row.name, row.files, row.allocated])).toEqual([
      ['file', 'readme.md', 1, 1024],
      ['file', 'notes.txt', 1, 1024],
    ])
    expect(page?.rows[0]?.parentId).toBe('g0')
  })

  it('caps the page size and clamps the offset', () => {
    const { store, sorter } = sample()
    expect(childrenPage(store, sorter, 'd0', 'size', 'desc', 50, 5)?.rows).toEqual([])
    expect(childrenPage(store, sorter, 'd0', 'size', 'desc', 0, 5000)?.rows).toHaveLength(4)
  })

  it('returns null for an unknown node', () => {
    const { store, sorter } = sample()
    expect(childrenPage(store, sorter, 'd77', 'size', 'desc', 0, 10)).toBeNull()
  })

  it('re-sorts after the tree changes', () => {
    const { store, sorter, music } = sample()
    expect(childrenPage(store, sorter, 'd0', 'size', 'desc', 0, 1)?.rows[0]?.name).toBe('Video')
    store.file(music, 100_000, 'album.flac', 1)
    expect(childrenPage(store, sorter, 'd0', 'size', 'desc', 0, 1)?.rows[0]?.name).toBe('Music')
  })
})

describe('compareRows', () => {
  it('breaks ties by name, then id, whatever the direction', () => {
    const base = { parentId: null, kind: 'folder' as const, allocated: 0, files: 0 }
    const common = { ...base, folders: 0, modifiedMs: 0, childCount: 0, size: 5 }
    const a = { ...common, id: 'd1', name: 'alpha' }
    const b = { ...common, id: 'd2', name: 'beta' }
    expect(compareRows(a, b, 'size', 'desc')).toBeLessThan(0)
    expect(compareRows(a, b, 'size', 'asc')).toBeLessThan(0)
  })
})

describe('nodeDetails', () => {
  it('gives the path, the ancestors and each step’s index in the sorted children', () => {
    const { store, sorter, photos, year } = sample()
    const details = nodeDetails(store, sorter, `d${year}`, 'size', 'desc')
    expect(details?.path).toBe(path.join(ROOT, 'Photos', '2024'))
    expect(details?.ancestorIds).toEqual(['d0', `d${photos}`])
    expect(details?.locations).toEqual([
      { parentId: 'd0', index: 1 },
      { parentId: `d${photos}`, index: 0 },
    ])
  })

  it('gives a file’s path through its "[N files]" row', () => {
    const { store, sorter, photos } = sample()
    const [file] = store.filesIn(photos)
    const details = nodeDetails(store, sorter, `f${file}`, 'size', 'desc')
    expect(details?.path).toBe(path.join(ROOT, 'Photos', 'c.jpg'))
    expect(details?.ancestorIds).toEqual(['d0', `d${photos}`, `g${photos}`])
    expect(details?.row).toMatchObject({ kind: 'file', name: 'c.jpg', size: 50 })
  })

  it('gives the root with no ancestors', () => {
    const { store, sorter } = sample()
    expect(nodeDetails(store, sorter, 'd0', 'size', 'desc')).toMatchObject({
      path: ROOT,
      ancestorIds: [],
      locations: [],
    })
  })
})

describe('expandIds', () => {
  it('returns the folders to expand for each level', () => {
    const { store, photos } = sample()
    expect(expandIds(store, 'd0', 1)).toEqual(['d0'])
    expect(expandIds(store, 'd0', 2).sort()).toEqual(['d0', 'd1', 'd2', 'd3'].sort())
    expect(expandIds(store, 'd0', 9)).toContain(`d${photos}`)
    expect(expandIds(store, 'd0', 9)).toContain('d4')
  })

  it('returns nothing for a file or an unknown node', () => {
    const { store } = sample()
    expect(expandIds(store, 'f0', 3)).toEqual([])
    expect(expandIds(store, 'd99', 3)).toEqual([])
  })

  it('stops at MAX_EXPAND_IDS', () => {
    const store = new TreeStore(ROOT, 4096)
    for (let i = 0; i < MAX_EXPAND_IDS + 10; i += 1) {
      const folder = store.folder(0, `d${i}`, 0)
      store.file(folder, 1, 'x', 0)
    }
    expect(expandIds(store, 'd0', 2)).toHaveLength(MAX_EXPAND_IDS)
  })
})
```

- [ ] **Step 2: Write the failing treemap tests**

`src/worker/scanner/treemap.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { TreeStore } from './tree-store'
import { type Box, squarify, TREEMAP_HEADER, treemapLayout } from './treemap'

const area = (box: Box) => box.w * box.h

function overlaps(a: Box, b: Box): boolean {
  const eps = 1e-6
  return (
    a.x + eps < b.x + b.w && b.x + eps < a.x + a.w && a.y + eps < b.y + b.h && b.y + eps < a.y + a.h
  )
}

describe('squarify', () => {
  const values = [600, 300, 200, 100, 100, 50, 25, 25]
  const box: Box = { x: 0, y: 0, w: 640, h: 400 }

  it('gives every value an area proportional to it', () => {
    const boxes = squarify(values, box)
    const total = values.reduce((sum, v) => sum + v, 0)
    expect(boxes).toHaveLength(values.length)
    boxes.forEach((cell, i) => {
      expect(area(cell)).toBeCloseTo(((values[i] ?? 0) / total) * area(box), 4)
    })
  })

  it('tiles the box with no overlap and no gap', () => {
    const boxes = squarify(values, box)
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        expect(overlaps(boxes[i]!, boxes[j]!)).toBe(false)
      }
      const cell = boxes[i]!
      expect(cell.x).toBeGreaterThanOrEqual(-1e-6)
      expect(cell.y).toBeGreaterThanOrEqual(-1e-6)
      expect(cell.x + cell.w).toBeLessThanOrEqual(640 + 1e-6)
      expect(cell.y + cell.h).toBeLessThanOrEqual(400 + 1e-6)
    }
    expect(boxes.reduce((sum, cell) => sum + area(cell), 0)).toBeCloseTo(area(box), 4)
  })

  it('keeps rectangles close to square', () => {
    for (const cell of squarify(values, box)) {
      expect(Math.max(cell.w / cell.h, cell.h / cell.w)).toBeLessThan(4)
    }
  })

  it('is stable: the same input gives the same output', () => {
    expect(squarify(values, box)).toEqual(squarify([...values], { ...box }))
  })

  it('handles empty, zero and single inputs', () => {
    expect(squarify([], box)).toEqual([])
    expect(squarify([0, 0], box)).toEqual([])
    expect(squarify([5], box)).toEqual([box])
    expect(squarify([5], { x: 0, y: 0, w: 0, h: 10 })).toEqual([])
  })
})

function sample(freeBytes: number | null = null) {
  const store = new TreeStore('C:\\', 4096, freeBytes)
  const big = store.folder(0, 'Big', 0)
  const small = store.folder(0, 'Small', 0)
  const inner = store.folder(big, 'Inner', 0)
  store.file(inner, 600_000, 'a.bin', 0)
  store.file(big, 200_000, 'b.bin', 0)
  store.file(small, 100_000, 'c.bin', 0)
  store.file(0, 100_000, 'root.bin', 0)
  return { store, big, small, inner }
}

describe('treemapLayout', () => {
  it('lays out the children at level 0, sized by the Mode value', () => {
    const { store, big } = sample()
    const layout = treemapLayout(store, 'd0', 'size', 0, 400, 200)
    expect(layout?.rects.map((r) => [r.id, r.kind, r.depth, r.nested])).toEqual([
      [`d${big}`, 'folder', 0, false],
      ['d2', 'folder', 0, false],
      ['g0', 'files', 0, false],
    ])
    const [first] = layout?.rects ?? []
    expect(area(first!)).toBeCloseTo((800_000 / 1_000_000) * 400 * 200, 4)
  })

  it('nests children under a label strip at deeper levels', () => {
    const { store, big } = sample()
    const layout = treemapLayout(store, 'd0', 'size', 2, 400, 200)
    const bigRect = layout?.rects.find((r) => r.id === `d${big}`)
    expect(bigRect?.nested).toBe(true)
    const inside = (r: Box) =>
      r.x >= (bigRect?.x ?? 0) - 1e-6 &&
      r.y >= (bigRect?.y ?? 0) - 1e-6 &&
      r.x + r.w <= (bigRect?.x ?? 0) + (bigRect?.w ?? 0) + 1e-6 &&
      r.y + r.h <= (bigRect?.y ?? 0) + (bigRect?.h ?? 0) + 1e-6
    const nested = layout?.rects.filter((r) => r.depth === 1 && inside(r)) ?? []
    expect(nested.map((r) => [r.kind, r.name]).sort()).toEqual([
      ['files', ''],
      ['folder', 'Inner'],
    ])
    for (const r of nested) {
      expect(r.y).toBeGreaterThanOrEqual((bigRect?.y ?? 0) + TREEMAP_HEADER - 1e-6)
      expect(r.x + r.w).toBeLessThanOrEqual((bigRect?.x ?? 0) + (bigRect?.w ?? 0) + 1e-6)
    }
    expect(layout?.rects.some((r) => r.depth === 2)).toBe(true)
  })

  it('adds a "Free space" block at the drive root in Size and Allocated modes only', () => {
    const { store } = sample(1_000_000)
    const sized = treemapLayout(store, 'd0', 'allocated', 0, 400, 200)
    const free = sized?.rects.find((r) => r.kind === 'free')
    expect(free).toMatchObject({ id: null, name: 'Free space', value: 1_000_000, depth: 0 })
    expect(sized?.rects.find((r) => r.id === 'd0')).toMatchObject({ depth: 0, nested: true })
    expect(sized?.rects.filter((r) => r.depth === 1).length).toBeGreaterThan(0)

    const counted = treemapLayout(store, 'd0', 'files', 0, 400, 200)
    expect(counted?.rects.some((r) => r.kind === 'free')).toBe(false)
    const inFolder = treemapLayout(store, 'd1', 'size', 0, 400, 200)
    expect(inFolder?.rects.some((r) => r.kind === 'free')).toBe(false)
  })

  it('sizes by file count in File count mode', () => {
    const { store, big } = sample()
    const layout = treemapLayout(store, 'd0', 'files', 0, 300, 300)
    const bigRect = layout?.rects.find((r) => r.id === `d${big}`)
    expect(bigRect?.value).toBe(2)
  })

  it('returns null for an unknown node and nothing for an empty folder', () => {
    const store = new TreeStore('C:\\', 4096)
    expect(treemapLayout(store, 'd9', 'size', 0, 100, 100)).toBeNull()
    expect(treemapLayout(store, 'd0', 'size', 0, 100, 100)?.rects).toEqual([])
  })
})
```

- [ ] **Step 3: Run them**

```powershell
npx vitest run src/worker/scanner/tree-queries.test.ts src/worker/scanner/treemap.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 4: Queries**

`src/worker/scanner/tree-queries.ts`:

```ts
import {
  MAX_PAGE_ROWS,
  NODE_ID_PATTERN,
  type NodeId,
  type SortDir,
  type SortKey,
  type TreeLocation,
  type TreeNodeDetails,
  type TreePage,
  type TreeRow,
} from '@shared/tree-types'
import type { TreeStore } from './tree-store'

/** A resolved row: folder `index`, the files directly in folder `index`, or file `index`. */
export type NodeRef =
  | { kind: 'folder'; index: number }
  | { kind: 'files'; index: number }
  | { kind: 'file'; index: number }

/** Most folders `expandIds` returns, so "Expand all" on a huge drive stays bounded. */
export const MAX_EXPAND_IDS = 5000
/** Sorted child orders kept between calls (one per recently viewed folder and sort). */
const SORT_CACHE_SIZE = 64

export function nodeIdOf(ref: NodeRef): NodeId {
  const prefix = ref.kind === 'folder' ? 'd' : ref.kind === 'files' ? 'g' : 'f'
  return `${prefix}${ref.index}`
}

/** Parses a `NodeId` and checks it names a live entry of `store`. */
export function resolveNode(store: TreeStore, id: NodeId): NodeRef | null {
  if (!NODE_ID_PATTERN.test(id)) return null
  const index = Number(id.slice(1))
  if (id.startsWith('f')) return store.isLiveFile(index) ? { kind: 'file', index } : null
  if (!store.isLiveFolder(index)) return null
  if (id.startsWith('g')) return store.directFiles(index) > 0 ? { kind: 'files', index } : null
  return { kind: 'folder', index }
}

export function parentOf(store: TreeStore, ref: NodeRef): NodeRef | null {
  if (ref.kind === 'file') return { kind: 'files', index: store.fileParent(ref.index) }
  if (ref.kind === 'files') return { kind: 'folder', index: ref.index }
  const parent = store.folderParent(ref.index)
  return parent < 0 ? null : { kind: 'folder', index: parent }
}

/** The folder a row belongs to: itself for a folder, its folder for "[N files]" and files. */
export function folderOf(store: TreeStore, ref: NodeRef): number {
  return ref.kind === 'file' ? store.fileParent(ref.index) : ref.index
}

export function rowOf(store: TreeStore, ref: NodeRef): TreeRow {
  const parent = parentOf(store, ref)
  const parentId = parent === null ? null : nodeIdOf(parent)
  if (ref.kind === 'folder') {
    const i = ref.index
    const direct = store.directFiles(i)
    return {
      id: nodeIdOf(ref),
      parentId,
      kind: 'folder',
      name: store.folderName(i),
      size: store.folderSize(i),
      allocated: store.folderAllocated(i),
      files: store.folderFiles(i),
      folders: store.folderFolders(i),
      modifiedMs: store.folderModified(i),
      childCount: store.folderChildCount(i) + (direct > 0 ? 1 : 0),
    }
  }
  if (ref.kind === 'files') {
    const i = ref.index
    return {
      id: nodeIdOf(ref),
      parentId,
      kind: 'files',
      name: '',
      size: store.directSize(i),
      allocated: store.directAllocated(i),
      files: store.directFiles(i),
      folders: 0,
      modifiedMs: store.directModified(i),
      childCount: store.directFiles(i),
    }
  }
  const j = ref.index
  return {
    id: nodeIdOf(ref),
    parentId,
    kind: 'file',
    name: store.fileName(j),
    size: store.fileSize(j),
    allocated: store.fileAllocated(j),
    files: 1,
    folders: 0,
    modifiedMs: store.fileModified(j),
    childCount: 0,
  }
}

/** Unsorted child rows of `ref`. */
export function childRefs(store: TreeStore, ref: NodeRef): NodeRef[] {
  if (ref.kind === 'file') return []
  if (ref.kind === 'files') {
    return store.filesIn(ref.index).map((index) => ({ kind: 'file', index }))
  }
  const refs: NodeRef[] = store.childFolders(ref.index).map((index) => ({ kind: 'folder', index }))
  if (store.directFiles(ref.index) > 0) refs.push({ kind: 'files', index: ref.index })
  return refs
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

function sortValue(row: TreeRow, key: Exclude<SortKey, 'name'>): number {
  switch (key) {
    case 'size':
      return row.size
    case 'allocated':
      return row.allocated
    case 'files':
      return row.files
    case 'folders':
      return row.folders
    case 'modified':
      return row.modifiedMs
  }
}

/** Orders rows by `key`; ties (and the "[N files]" row's empty name) fall back to name, then id. */
export function compareRows(a: TreeRow, b: TreeRow, key: SortKey, dir: SortDir): number {
  const sign = dir === 'asc' ? 1 : -1
  if (key !== 'name') {
    const delta = sortValue(a, key) - sortValue(b, key)
    if (delta !== 0) return sign * delta
    return collator.compare(a.name, b.name) || a.id.localeCompare(b.id)
  }
  const byName = collator.compare(a.name, b.name)
  if (byName !== 0) return sign * byName
  return a.id.localeCompare(b.id)
}

interface CachedOrder {
  version: number
  rows: TreeRow[]
}

/** Sorted children with a small cache keyed on the store version. */
export class ChildSorter {
  private readonly cache = new Map<string, CachedOrder>()

  constructor(private readonly store: TreeStore) {}

  sorted(ref: NodeRef, key: SortKey, dir: SortDir): TreeRow[] {
    const cacheKey = `${nodeIdOf(ref)}|${key}|${dir}`
    const hit = this.cache.get(cacheKey)
    if (hit && hit.version === this.store.version) return hit.rows
    const rows = childRefs(this.store, ref).map((child) => rowOf(this.store, child))
    rows.sort((a, b) => compareRows(a, b, key, dir))
    this.cache.delete(cacheKey)
    this.cache.set(cacheKey, { version: this.store.version, rows })
    if (this.cache.size > SORT_CACHE_SIZE) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    return rows
  }
}

export function childrenPage(
  store: TreeStore,
  sorter: ChildSorter,
  nodeId: NodeId,
  key: SortKey,
  dir: SortDir,
  offset: number,
  limit: number,
): TreePage | null {
  const ref = resolveNode(store, nodeId)
  if (ref === null) return null
  const rows = sorter.sorted(ref, key, dir)
  const start = Math.max(0, Math.min(offset, rows.length))
  const count = Math.max(0, Math.min(limit, MAX_PAGE_ROWS))
  return {
    parent: rowOf(store, ref),
    total: rows.length,
    offset: start,
    rows: rows.slice(start, start + count),
  }
}

export function nodeDetails(
  store: TreeStore,
  sorter: ChildSorter,
  nodeId: NodeId,
  key: SortKey,
  dir: SortDir,
): TreeNodeDetails | null {
  const ref = resolveNode(store, nodeId)
  if (ref === null) return null
  const chain: NodeRef[] = []
  for (let step: NodeRef | null = ref; step !== null; step = parentOf(store, step)) {
    chain.push(step)
  }
  chain.reverse()
  const locations: TreeLocation[] = []
  for (let i = 1; i < chain.length; i += 1) {
    const parent = chain[i - 1]
    const child = chain[i]
    if (parent === undefined || child === undefined) continue
    const childId = nodeIdOf(child)
    const index = sorter.sorted(parent, key, dir).findIndex((row) => row.id === childId)
    locations.push({ parentId: nodeIdOf(parent), index })
  }
  return {
    row: rowOf(store, ref),
    path: ref.kind === 'file' ? store.filePath(ref.index) : store.folderPath(ref.index),
    ancestorIds: chain.slice(0, -1).map(nodeIdOf),
    locations,
  }
}

/**
 * Folders to expand so `levels` levels of folders below `nodeId` are visible: `nodeId` itself
 * for 1 level, plus its child folders for 2 levels, and so on. Breadth first, at most
 * `MAX_EXPAND_IDS`. Only folders with children are returned.
 */
export function expandIds(store: TreeStore, nodeId: NodeId, levels: number): NodeId[] {
  const ref = resolveNode(store, nodeId)
  if (ref === null || ref.kind !== 'folder') return []
  const ids: NodeId[] = []
  let level = [ref.index]
  for (let depth = 0; depth < levels && level.length > 0; depth += 1) {
    const next: number[] = []
    for (const folder of level) {
      const hasRows = store.folderChildCount(folder) > 0 || store.directFiles(folder) > 0
      if (!hasRows) continue
      if (ids.length >= MAX_EXPAND_IDS) return ids
      ids.push(`d${folder}`)
      next.push(...store.childFolders(folder))
    }
    level = next
  }
  return ids
}
```

- [ ] **Step 5: Treemap**

`src/worker/scanner/treemap.ts`:

```ts
import {
  MAX_TREEMAP_DEPTH,
  modeValue,
  ROOT_NODE_ID,
  type NodeId,
  type SizeMode,
  type TreemapBlockKind,
  type TreemapLayout,
  type TreemapRect,
} from '@shared/tree-types'
import { childRefs, nodeIdOf, resolveNode, rowOf, type NodeRef } from './tree-queries'
import type { TreeStore } from './tree-store'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Height of the label strip at the top of a block that holds nested blocks. */
export const TREEMAP_HEADER = 18
/** Gap between a nested block's border and its children. */
export const TREEMAP_INSET = 2
/** A block smaller than this (in either direction) gets no nested blocks. */
export const MIN_NESTED_SIDE = 28
/** Most rectangles one layout returns. */
export const MAX_TREEMAP_RECTS = 20_000
/** Children smaller than this many square pixels are left out of the layout. */
export const MIN_RECT_AREA = 4

function worstRatio(rowSum: number, min: number, max: number, side: number): number {
  const sideSquared = side * side
  const sumSquared = rowSum * rowSum
  return Math.max((sideSquared * max) / sumSquared, sumSquared / (sideSquared * min))
}

/**
 * Squarified treemap (Bruls, Huizing and van Wijk, 2000). `values` must be positive and sorted
 * largest first; the boxes come back in the same order and exactly tile `box`.
 */
export function squarify(values: readonly number[], box: Box): Box[] {
  const total = values.reduce((sum, value) => sum + value, 0)
  if (values.length === 0 || total <= 0 || box.w <= 0 || box.h <= 0) return []
  const scale = (box.w * box.h) / total
  const areas = values.map((value) => value * scale)
  const out: Box[] = []
  let { x, y, w, h } = box
  let i = 0
  while (i < areas.length) {
    const side = Math.min(w, h)
    const first = areas[i] ?? 0
    let rowSum = first
    let worst = worstRatio(rowSum, first, first, side)
    let j = i + 1
    while (j < areas.length) {
      const next = areas[j] ?? 0
      const candidate = worstRatio(rowSum + next, next, first, side)
      if (candidate > worst) break
      rowSum += next
      worst = candidate
      j += 1
    }
    const isLast = j >= areas.length
    if (w >= h) {
      // The row is a column on the left edge.
      const columnWidth = isLast ? w : rowSum / h
      let cy = y
      for (let k = i; k < j; k += 1) {
        const cellHeight = k === j - 1 ? y + h - cy : (areas[k] ?? 0) / columnWidth
        out.push({ x, y: cy, w: columnWidth, h: cellHeight })
        cy += cellHeight
      }
      x += columnWidth
      w -= columnWidth
    } else {
      // The row runs along the top edge.
      const rowHeight = isLast ? h : rowSum / w
      let cx = x
      for (let k = i; k < j; k += 1) {
        const cellWidth = k === j - 1 ? x + w - cx : (areas[k] ?? 0) / rowHeight
        out.push({ x: cx, y, w: cellWidth, h: rowHeight })
        cx += cellWidth
      }
      y += rowHeight
      h -= rowHeight
    }
    i = j
  }
  return out
}

interface Item {
  ref: NodeRef | null
  /** Tie-break key for equal values. */
  key: string
  kind: TreemapBlockKind
  name: string
  value: number
  files: number
}

function itemsOf(store: TreeStore, ref: NodeRef, mode: SizeMode): Item[] {
  const items: Item[] = []
  for (const child of childRefs(store, ref)) {
    const row = rowOf(store, child)
    const value = modeValue(row, mode)
    if (value > 0) {
      items.push({
        ref: child,
        key: row.id,
        kind: row.kind,
        name: row.name,
        value,
        files: row.files,
      })
    }
  }
  // Largest first; equal values keep a stable order by id.
  items.sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))
  return items
}

/**
 * Treemap of `nodeId`'s children sized by the Mode value, nested `depth` levels deep
 * (0 = children only). At the scanned drive root in Size or Allocated mode, a "Free space"
 * block sits beside the root's own block.
 */
export function treemapLayout(
  store: TreeStore,
  nodeId: NodeId,
  mode: SizeMode,
  depth: number,
  width: number,
  height: number,
): TreemapLayout | null {
  const ref = resolveNode(store, nodeId)
  if (ref === null) return null
  const maxDepth = Math.max(0, Math.min(depth, MAX_TREEMAP_DEPTH))
  const rects: TreemapRect[] = []

  const place = (items: Item[], box: Box, level: number): void => {
    const boxes = squarify(
      items.map((item) => item.value),
      box,
    )
    boxes.forEach((cell, index) => {
      const item = items[index]
      if (item === undefined || rects.length >= MAX_TREEMAP_RECTS) return
      if (cell.w * cell.h < MIN_RECT_AREA) return
      const rect: TreemapRect = {
        id: item.ref === null ? null : nodeIdOf(item.ref),
        kind: item.kind,
        name: item.name,
        value: item.value,
        files: item.files,
        depth: level,
        x: cell.x,
        y: cell.y,
        w: cell.w,
        h: cell.h,
        nested: false,
      }
      rects.push(rect)
      const canNest =
        item.ref !== null &&
        level < maxDepth &&
        item.kind !== 'file' &&
        cell.w >= MIN_NESTED_SIDE &&
        cell.h >= MIN_NESTED_SIDE + TREEMAP_HEADER
      if (!canNest || item.ref === null) return
      const children = itemsOf(store, item.ref, mode)
      if (children.length === 0) return
      rect.nested = true
      place(
        children,
        {
          x: cell.x + TREEMAP_INSET,
          y: cell.y + TREEMAP_HEADER,
          w: cell.w - TREEMAP_INSET * 2,
          h: cell.h - TREEMAP_HEADER - TREEMAP_INSET,
        },
        level + 1,
      )
    })
  }

  const full: Box = { x: 0, y: 0, w: width, h: height }
  const showFree =
    nodeId === ROOT_NODE_ID &&
    store.freeBytes !== null &&
    store.freeBytes > 0 &&
    (mode === 'size' || mode === 'allocated')
  if (showFree && store.freeBytes !== null) {
    const root = rowOf(store, ref)
    const used = modeValue(root, mode)
    const candidates: Item[] = [
      { ref, key: nodeId, kind: 'folder', name: root.name, value: used, files: root.files },
      {
        ref: null,
        key: 'free',
        kind: 'free',
        name: 'Free space',
        value: store.freeBytes,
        files: 0,
      },
    ]
    const top = candidates.filter((item) => item.value > 0)
    top.sort((a, b) => b.value - a.value)
    // The root's own block nests its children one level further than the requested depth.
    const boxes = squarify(
      top.map((item) => item.value),
      full,
    )
    boxes.forEach((cell, index) => {
      const item = top[index]
      if (item === undefined) return
      if (item.ref === null) {
        rects.push({
          id: null,
          kind: 'free',
          name: item.name,
          value: item.value,
          files: 0,
          depth: 0,
          x: cell.x,
          y: cell.y,
          w: cell.w,
          h: cell.h,
          nested: false,
        })
        return
      }
      const rootRect: TreemapRect = {
        id: nodeId,
        kind: 'folder',
        name: item.name,
        value: item.value,
        files: item.files,
        depth: 0,
        x: cell.x,
        y: cell.y,
        w: cell.w,
        h: cell.h,
        nested: true,
      }
      rects.push(rootRect)
      if (cell.w < MIN_NESTED_SIDE || cell.h < MIN_NESTED_SIDE + TREEMAP_HEADER) {
        rootRect.nested = false
        return
      }
      place(
        itemsOf(store, ref, mode),
        {
          x: cell.x + TREEMAP_INSET,
          y: cell.y + TREEMAP_HEADER,
          w: cell.w - TREEMAP_INSET * 2,
          h: cell.h - TREEMAP_HEADER - TREEMAP_INSET,
        },
        1,
      )
    })
  } else {
    place(itemsOf(store, ref, mode), full, 0)
  }
  return { nodeId, width, height, rects }
}
```

- [ ] **Step 6: Run the tests**

```powershell
npx vitest run src/worker/scanner/tree-queries.test.ts src/worker/scanner/treemap.test.ts
```

Expected: PASS — 36 tests.

- [ ] **Step 7: Perf limits (1M generated files) and their own config**

`src/worker/scanner/tree-store.perf.test.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ChildSorter, childrenPage } from './tree-queries'
import { TreeStore } from './tree-store'
import { treemapLayout } from './treemap'

/** Spec §5 limits (1M generated files). */
export const PERF_LIMITS = {
  files: 1_000_000,
  /** Worker memory for the tree: typed arrays plus names. */
  maxMemoryMb: 300,
  /** Spec §4: about 250 MB for 2M entries, so at most 125 bytes per file. */
  maxBytesPerFile: 125,
  maxFirstPageMs: 100,
  maxTreemapMs: 100,
} as const

function usedBytes(): number {
  const { heapUsed, arrayBuffers } = process.memoryUsage()
  return heapUsed + arrayBuffers
}

/** Needs `--expose-gc` (set in vitest.perf.config.mts), so garbage is not counted as tree memory. */
function collect(): void {
  const gc = (globalThis as { gc?: () => void }).gc
  if (gc === undefined) throw new Error('Run with npm run test:perf (it exposes gc).')
  gc()
}

/**
 * A flat string, like the names `fs.opendir` returns. (A template literal would make a "cons"
 * string of two parts, which costs more memory than a real file name.)
 */
function flat(text: string): string {
  return Buffer.from(text, 'latin1').toString('latin1')
}

/**
 * 1,000,000 files in a 3-level tree: 100 top folders × 100 subfolders × 100 files, with
 * realistic names (about 20 characters). Built straight into the store, as the walk would.
 */
function generate(): TreeStore {
  const store = new TreeStore('C:\\', 4096, 50 * 1024 ** 3)
  let file = 0
  for (let a = 0; a < 100; a += 1) {
    const top = store.folder(0, `Top folder ${a}`, 1_700_000_000_000)
    for (let b = 0; b < 100; b += 1) {
      const sub = store.folder(top, `Subfolder ${a}-${b}`, 1_700_000_000_000)
      for (let c = 0; c < 100; c += 1) {
        const name = flat(`document-${file}.dat`)
        store.file(sub, (file * 7919) % 5_000_000, name, 1_700_000_000_000 + c)
        file += 1
      }
    }
  }
  return store
}

describe('tree store performance (1M files)', () => {
  it('stays inside the memory and latency limits', () => {
    collect()
    const before = usedBytes()
    const store = generate()
    collect()
    const memoryMb = (usedBytes() - before) / 1024 / 1024
    expect(store.totals().files).toBe(PERF_LIMITS.files)

    const sorter = new ChildSorter(store)
    let started = performance.now()
    const page = childrenPage(store, sorter, 'd0', 'size', 'desc', 0, 200)
    const firstPageMs = performance.now() - started
    expect(page?.rows).toHaveLength(100)

    // The treemap is timed after one warm-up run (the first call also pays for JIT compiling),
    // as the median of three layouts at the default level.
    treemapLayout(store, 'd0', 'allocated', 1, 1600, 400)
    const times: number[] = []
    let rects = 0
    for (let run = 0; run < 3; run += 1) {
      started = performance.now()
      rects = treemapLayout(store, 'd0', 'allocated', 1, 1600, 400)?.rects.length ?? 0
      times.push(performance.now() - started)
    }
    const treemapMs = times.sort((a, b) => a - b)[1] ?? Infinity
    expect(rects).toBeGreaterThan(100)

    const bytesPerFile = (memoryMb * 1024 * 1024) / PERF_LIMITS.files
    const report = { files: PERF_LIMITS.files, memoryMb, bytesPerFile, firstPageMs, treemapMs }
    mkdirSync('metrics', { recursive: true })
    writeFileSync('metrics/perf.json', JSON.stringify(report, null, 2))
    console.log(`[perf] ${JSON.stringify(report)}`)

    expect(memoryMb).toBeLessThanOrEqual(PERF_LIMITS.maxMemoryMb)
    expect((memoryMb * 1024 * 1024) / PERF_LIMITS.files).toBeLessThanOrEqual(
      PERF_LIMITS.maxBytesPerFile,
    )
    expect(firstPageMs).toBeLessThanOrEqual(PERF_LIMITS.maxFirstPageMs)
    expect(treemapMs).toBeLessThanOrEqual(PERF_LIMITS.maxTreemapMs)
  }, 60_000)
})
```

`vitest.perf.config.mts`:

```ts
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// `npm run test:perf`: the 1M-file tree-store limits (spec §5), alone, with gc() exposed so
// garbage is not counted as tree memory. Writes metrics/perf.json for the CI metrics report.
export default defineConfig({
  resolve: {
    alias: { '@shared': resolve('src/shared') },
  },
  test: {
    include: ['src/**/*.perf.test.ts'],
    environment: 'node',
    execArgv: ['--expose-gc'],
    fileParallelism: false,
  },
})
```

The default run leaves perf tests out. `vitest.config.mts`:

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
    // Perf tests run alone (`npm run test:perf`), so other test files cannot skew their timings.
    exclude: ['**/node_modules/**', 'src/**/*.perf.test.ts'],
    environment: 'node',
    setupFiles: ['src/renderer/src/test/setup.ts'],
    restoreMocks: true,
  },
})
```

Add `"vitest.perf.config.mts",` after `"vitest.config.mts",` in the `include` list of `tsconfig.node.json`, and add `"test:perf": "vitest run --config vitest.perf.config.mts",` after `"test:watch"` in `package.json`.

- [ ] **Step 8: Run the perf limits**

```powershell
npm run test:perf
Get-Content metrics/perf.json
```

Expected: PASS — 1 test; `metrics/perf.json` shows about 70 MB / 75 bytes per file (limits 300 MB and 125 B/file), first page under 20 ms and treemap (median of three after a warm-up) under 5 ms, against 100 ms limits.

- [ ] **Step 9: Gates**

```powershell
npm run format
npm run lint
npm run typecheck
npx vitest run
```

Expected: all green.

- [ ] **Step 10: Commit**

```powershell
git add src/worker/scanner/tree-queries.ts src/worker/scanner/tree-queries.test.ts src/worker/scanner/treemap.ts src/worker/scanner/treemap.test.ts src/worker/scanner/tree-store.perf.test.ts vitest.config.mts vitest.perf.config.mts tsconfig.node.json package.json
git commit -m @'
feat(scanner): children pages, node details, expand ids, squarified treemap; 1M-file perf limits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 4: New contract, scanner host, main channels and preload

**Implementer tier:** standard

This task switches the contract for every process (see "Integration window"). The scanner host now keeps the latest scan's store while it runs and after it ends, answers `query` requests (`children`, `node`, `expand`, `treemap`, `refresh`, `totals`) with `reply` messages, and serializes refreshes; a refresh during the same scan is refused. Main gets the cluster size and free space at `scan:start` (`volumeFor`), relays queries with a 120 s timeout and rejects them when the scanner exits, records recent scans in `userData/recent-scans.json`, and resolves every shell/clipboard path from the scanner (`resolveScanNode`).

**Verified APIs** (dry run, Electron 45.3.4 / koffi 3.3.8 / Windows 11): `GetDiskFreeSpaceW` with `_Out_ uint32_t *` arrays returned 8 sectors × 512 bytes = 4096 on NTFS; `GetVolumeInformationW` with a 261-char `_Out_ uint16_t *` file-system buffer returned `NTFS`; `app.getPath('documents')`, `shell.openPath(path): Promise<string>` (`''` on success), `shell.showItemInFolder(path)`, `clipboard.writeText(text)`, `screen.dipToScreenPoint(point)` and `BrowserWindow.getNativeWindowHandle(): Buffer` are in `node_modules/electron/electron.d.ts`. OneDrive folders come from the `OneDriveConsumer`, `OneDriveCommercial` and `OneDrive` environment variables.

**Files:**

- Modify: `src/shared/scan-types.ts`, `src/shared/scanner-protocol.ts`, `src/shared/ipc-contract.ts`, `src/worker/scanner/scanner-host.ts`, `scanner-host.test.ts`, `src/main/ipc/parse-args.ts`, `parse-args.test.ts`, `register.test.ts`, `app-handlers.ts`, `app-handlers.test.ts`, `drive-handlers.ts`, `drive-handlers.test.ts`, `scan-handlers.ts`, `scan-handlers.test.ts`, `src/main/scan/scan-service.ts`, `scan-service.test.ts`, `src/main/drives/drive-api.ts`, `koffi-drive-api.ts`, `list-drives.test.ts`, `src/main/self-test.ts`, `self-test.test.ts`, `src/main/index.ts`, `src/preload/index.ts`
- Create: `src/main/ipc/tree-handlers.ts`, `tree-handlers.test.ts`, `shell-handlers.ts`, `shell-handlers.test.ts`, `src/main/ipc/test/fake-tree-service.ts`, `src/main/drives/drive-details.ts`, `drive-details.test.ts`, `src/main/places/places.ts`, `places.test.ts`, `src/main/shell-menu/menu-commands.ts`, `menu-commands.test.ts`
- Delete: `src/worker/scanner/tree.ts`, `tree.test.ts`, `top-folders.ts`, `top-folders.test.ts`

**Interfaces:**

- Consumes: Tasks 2–3; `ShellMenuChoice`, `ShellMenuNative`, `showShellMenu`, `probeShellMenu` (Task 7, `src/main/shell-menu/context-menu.ts`) and `createWinShellMenu` (Task 7) — imported by `index.ts` and (type only) `shell-handlers.ts`.
- Produces: `DriveDetails`, `Place`, `Places`, `MAX_RECENT_SCANS`; `ScanProgress { …, allocatedBytes, errorCount }`, `ScanDone { …, allocatedBytes }` (no `topFolders`); `DEFAULT_CLUSTER_BYTES`, `ScannerQuery`, `ScannerQueryResults`, `ScannerQueryKind`, `ScannerQueryOf`, `ScanVolume`, `ScannerRequest` (start with `volume`, `query`), `ScannerMessage` (`reply`); channels `drive:info`, `places:list`, `app:quit`, `tree:children`, `tree:node`, `tree:expand-ids`, `tree:refresh`, `treemap:layout`, `shell:open-in-explorer`, `shell:context-menu`, `folder:create`, `clipboard:write-text`, event `tree:changed`; `StorageIQApi` methods `quit getDriveInfo listPlaces getChildren getNode getExpandIds refreshFolder getTreemap openInExplorer showContextMenu createFolder writeClipboardText onTreeChanged`; `ContextMenuOutcome`, `CreateFolderResult`; `SNAPSHOT_INTERVAL_MS`, `REFRESH_BUSY_MESSAGE`, `createScannerHost(deps).currentStore()`; parse-args `expectCount scanIdArg nodeIdArg sortKeyArg sortDirArg sizeModeArg intArg booleanArg scanNodeArgs childrenArgs nodeArgs expandArgs treemapArgs contextMenuArgs clipboardArgs driveRootArgs SCAN_ID_PATTERN MAX_TREEMAP_SIDE MAX_WINDOW_COORDINATE MAX_CLIPBOARD_TEXT`; `ScanService.start(root, volume)`, `currentScan(): CurrentScan | null`, `isScanning()`, `query(q)`, `SCANNER_GONE_MESSAGE`, `QUERY_TIMEOUT_MESSAGE`, `QUERY_TIMEOUT_MS`; `VolumeDetails`, `DriveApi.getVolumeDetails`; `driveRootOf`, `isDriveRoot`, `readDriveDetails`; `oneDriveFolders`, `listPlaces`, `createRecentScans`, `parseRecent`, `RECENT_SCANS_FILE`; `TreeScanService`, `resolveScanNode`, `folderIdOf`, `RefreshFolder`, `createFolderRefresher`, `NOT_IN_SCAN_MESSAGE`, `SCAN_RUNNING_MESSAGE`; `ShellHandlerDeps`, `SECOND_REFRESH_DELAY_MS`; `StorageIQMenuItem`, `STORAGEIQ_COMMAND_IDS`, `SHELL_FIRST_ID = 0x100`, `SHELL_LAST_ID = 0x7fff`, `STORAGEIQ_MENU_LABELS`, `MenuCommand`, `classifyCommand`, `plainMenuLabel`, `READ_ONLY_VERBS`, `verbChangesFileSystem`, `nextNewFolderName`; `SELF_TEST_EXIT.shellMenuFailed = 13`, `MIN_SHELL_MENU_ITEMS`, `SelfTestScan`.

- [ ] **Step 1: Shared contract**

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

/** `drive:info`: space and cluster size of the drive that holds a scanned path. */
export interface DriveDetails {
  root: string
  totalBytes: number
  freeBytes: number
  /** Bytes per cluster (sectors per cluster × bytes per sector), from `GetDiskFreeSpaceW`. */
  clusterBytes: number
  /** File system name from `GetVolumeInformationW`, for example `NTFS`; `''` when unknown. */
  fileSystem: string
}

export type PlaceKind = 'documents' | 'onedrive'

/** One entry of the Select menu's "Documents and cloud" section. */
export interface Place {
  kind: PlaceKind
  label: string
  path: string
}

/** `places:list`: everything the Select menu shows besides the drives. */
export interface Places {
  places: Place[]
  /** Most recent first, at most `MAX_RECENT_SCANS`. */
  recent: string[]
}

export const MAX_RECENT_SCANS = 5

export type ScanErrorReason = 'access-denied' | 'path-too-long' | 'not-found' | 'other'

/** Whether the entry that failed is a folder or a file (known from the directory listing). */
export type ScanErrorKind = 'file' | 'folder'

export interface ScanError {
  path: string
  kind: ScanErrorKind
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
  allocatedBytes: number
  currentPath: string
  elapsedMs: number
  /** Entries that could not be read so far. */
  errorCount: number
}

export type ScanStatus = 'complete' | 'canceled'

export interface ScanDone {
  scanId: string
  status: ScanStatus
  files: number
  folders: number
  bytes: number
  allocatedBytes: number
  elapsedMs: number
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

`src/shared/scanner-protocol.ts`:

```ts
import type { ScanDone, ScanProgress } from './scan-types'
import type {
  NodeId,
  SizeMode,
  SortDir,
  SortKey,
  TreemapLayout,
  TreeNodeDetails,
  TreePage,
  TreeTotals,
} from './tree-types'

/** Name of the scanner utilityProcess; it is the `name` in `app.getAppMetrics()`. */
export const SCANNER_SERVICE_NAME = 'StorageIQ scanner'

/** Used when main could not read the drive's cluster size (the NTFS default). */
export const DEFAULT_CLUSTER_BYTES = 4096

/** Questions main asks the scanner about its tree, plus the folder refresh. */
export type ScannerQuery =
  | {
      kind: 'children'
      scanId: string
      nodeId: NodeId
      sortKey: SortKey
      sortDir: SortDir
      offset: number
      limit: number
    }
  | { kind: 'node'; scanId: string; nodeId: NodeId; sortKey: SortKey; sortDir: SortDir }
  | { kind: 'expand'; scanId: string; nodeId: NodeId; levels: number }
  | {
      kind: 'treemap'
      scanId: string
      nodeId: NodeId
      mode: SizeMode
      depth: number
      width: number
      height: number
    }
  | { kind: 'refresh'; scanId: string; nodeId: NodeId }
  | { kind: 'totals'; scanId: string }

/** The result type of each query kind. */
export interface ScannerQueryResults {
  children: TreePage | null
  node: TreeNodeDetails | null
  expand: NodeId[]
  treemap: TreemapLayout | null
  refresh: TreeNodeDetails | null
  totals: TreeTotals | null
}

export type ScannerQueryKind = ScannerQuery['kind']
export type ScannerQueryOf<K extends ScannerQueryKind> = Extract<ScannerQuery, { kind: K }>

/** Drive facts main reads with koffi and hands to the scanner at scan start. */
export interface ScanVolume {
  /** Bytes per cluster; allocated size is `ceil(size / clusterBytes) * clusterBytes`. */
  clusterBytes: number
  /** Free bytes on the drive for the treemap's "Free space" block; null unless a drive root. */
  freeBytes: number | null
}

/** main → scanner process. */
export type ScannerRequest =
  | { type: 'start'; scanId: string; root: string; volume: ScanVolume }
  | { type: 'cancel'; scanId: string }
  | { type: 'query'; requestId: number; query: ScannerQuery }

/** scanner process → main. */
export type ScannerMessage =
  | { type: 'progress'; payload: ScanProgress }
  | { type: 'done'; payload: ScanDone }
  | { type: 'reply'; requestId: number; ok: true; result: unknown }
  | { type: 'reply'; requestId: number; ok: false; message: string }
```

`src/shared/ipc-contract.ts`:

```ts
import type {
  DriveDetails,
  DriveInfo,
  Places,
  ScanDone,
  ScanFailed,
  ScanProgress,
  ScanStartResult,
} from './scan-types'
import type {
  NodeId,
  SizeMode,
  SortDir,
  SortKey,
  TreeChanged,
  TreemapLayout,
  TreeNodeDetails,
  TreePage,
} from './tree-types'

/** Metadata about the running application, shown in the status bar and the About box. */
export interface AppInfo {
  name: string
  version: string
  platform: string
  arch: string
  electronVersion: string
}

/** Outcome of the native "choose a folder" dialog. */
export type SelectFolderResult = { canceled: true } | { canceled: false; path: string }

/** What the native context menu did, so the renderer can follow up. */
export type ContextMenuOutcome =
  | { kind: 'dismissed' }
  | { kind: 'refreshed'; nodeId: NodeId }
  | { kind: 'copied' }
  | { kind: 'opened' }
  | { kind: 'created'; nodeId: NodeId; name: string }
  | { kind: 'shell'; verb: string | null; changed: boolean }

/** `folder:create` result: the folder that now holds the new one, and the new folder's name. */
export interface CreateFolderResult {
  parentId: NodeId
  name: string
}

/**
 * Single source of truth for every renderer → main request.
 * Each channel maps to its argument tuple and its resolved result.
 */
export interface IpcContract {
  'drives:list': { args: []; result: DriveInfo[] }
  'drive:info': { args: [root: string]; result: DriveDetails | null }
  'places:list': { args: []; result: Places }
  'app:get-info': { args: []; result: AppInfo }
  'app:quit': { args: []; result: void }
  'dialog:select-folder': { args: []; result: SelectFolderResult }
  'scan:start': { args: [path: string]; result: ScanStartResult }
  'scan:cancel': { args: [scanId: string]; result: void }
  'tree:children': {
    args: [
      scanId: string,
      nodeId: NodeId,
      sortKey: SortKey,
      sortDir: SortDir,
      offset: number,
      limit: number,
    ]
    result: TreePage | null
  }
  'tree:node': {
    args: [scanId: string, nodeId: NodeId, sortKey: SortKey, sortDir: SortDir]
    result: TreeNodeDetails | null
  }
  'tree:expand-ids': { args: [scanId: string, nodeId: NodeId, levels: number]; result: NodeId[] }
  'tree:refresh': { args: [scanId: string, nodeId: NodeId]; result: TreeNodeDetails | null }
  'treemap:layout': {
    args: [
      scanId: string,
      nodeId: NodeId,
      mode: SizeMode,
      depth: number,
      width: number,
      height: number,
    ]
    result: TreemapLayout | null
  }
  'shell:open-in-explorer': { args: [scanId: string, nodeId: NodeId]; result: void }
  'shell:context-menu': {
    args: [scanId: string, nodeId: NodeId, x: number, y: number, extended: boolean]
    result: ContextMenuOutcome
  }
  'folder:create': { args: [scanId: string, nodeId: NodeId]; result: CreateFolderResult }
  'clipboard:write-text': { args: [text: string]; result: void }
}

export type IpcChannel = keyof IpcContract
export type IpcArgs<C extends IpcChannel> = IpcContract[C]['args']
export type IpcResult<C extends IpcChannel> = IpcContract[C]['result']

/** Single source of truth for every main → renderer event and its payload. */
export interface IpcEventContract {
  'scan:progress': ScanProgress
  'scan:done': ScanDone
  'scan:failed': ScanFailed
  'tree:changed': TreeChanged
}

export type IpcEventChannel = keyof IpcEventContract
export type IpcEventPayload<E extends IpcEventChannel> = IpcEventContract[E]

/** Stops a subscription made with one of the `on…` functions. */
export type Unsubscribe = () => void

/** The API the preload script exposes to the renderer as `window.storageiq`. */
export interface StorageIQApi {
  getAppInfo(): Promise<AppInfo>
  quit(): Promise<void>
  selectFolder(): Promise<SelectFolderResult>
  /** Fixed and removable drives with label and space (network and optical drives are left out). */
  listDrives(): Promise<DriveInfo[]>
  /** Space, cluster size and file system of the drive holding `root`; null when unreadable. */
  getDriveInfo(root: string): Promise<DriveDetails | null>
  /** Documents, OneDrive folders and the recently scanned paths. */
  listPlaces(): Promise<Places>
  /** Starts scanning `path` (an absolute local folder); a running scan is superseded. */
  startScan(path: string): Promise<ScanStartResult>
  /** Stops the scan; unknown or finished IDs are ignored. */
  cancelScan(scanId: string): Promise<void>
  getChildren(
    scanId: string,
    nodeId: NodeId,
    sortKey: SortKey,
    sortDir: SortDir,
    offset: number,
    limit: number,
  ): Promise<TreePage | null>
  getNode(
    scanId: string,
    nodeId: NodeId,
    sortKey: SortKey,
    sortDir: SortDir,
  ): Promise<TreeNodeDetails | null>
  /** Folders to expand so `levels` levels below `nodeId` are visible (capped by the scanner). */
  getExpandIds(scanId: string, nodeId: NodeId, levels: number): Promise<NodeId[]>
  /** Rescans one folder of the current scan and updates its totals and its ancestors. */
  refreshFolder(scanId: string, nodeId: NodeId): Promise<TreeNodeDetails | null>
  getTreemap(
    scanId: string,
    nodeId: NodeId,
    mode: SizeMode,
    depth: number,
    width: number,
    height: number,
  ): Promise<TreemapLayout | null>
  openInExplorer(scanId: string, nodeId: NodeId): Promise<void>
  /** Shows the Windows Explorer context menu for a row at window coordinates (CSS px). */
  showContextMenu(
    scanId: string,
    nodeId: NodeId,
    x: number,
    y: number,
    extended: boolean,
  ): Promise<ContextMenuOutcome>
  /** Creates "New folder" (or "New folder (2)", …) in the row's folder and rescans that folder. */
  createFolder(scanId: string, nodeId: NodeId): Promise<CreateFolderResult>
  writeClipboardText(text: string): Promise<void>
  onScanProgress(listener: (progress: ScanProgress) => void): Unsubscribe
  onScanDone(listener: (done: ScanDone) => void): Unsubscribe
  onScanFailed(listener: (failed: ScanFailed) => void): Unsubscribe
  onTreeChanged(listener: (changed: TreeChanged) => void): Unsubscribe
}
```

- [ ] **Step 2: Scanner host tests (failing)**

`src/worker/scanner/scanner-host.test.ts`:

```ts
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ScanDone, ScanProgress } from '@shared/scan-types'
import type { ScannerMessage, ScannerQuery, ScanVolume } from '@shared/scanner-protocol'
import {
  createScannerHost,
  parseScannerRequest,
  REFRESH_BUSY_MESSAGE,
  SNAPSHOT_INTERVAL_MS,
} from './scanner-host'
import {
  createFakeWalkFs,
  dir,
  type FakeNode,
  type FakeWalkFsOptions,
  file,
} from './test/fake-walk-fs'

const ROOT = 'C:\\Data'
const VOLUME: ScanVolume = { clusterBytes: 4096, freeBytes: null }

function tree(): Record<string, FakeNode> {
  return {
    Photos: dir({ 'a.jpg': file(300, 50), 'b.jpg': file(200, 60) }),
    Music: dir({ 'c.mp3': file(100, 70) }),
    'notes.txt': file(5, 80),
  }
}

function setup(options: FakeWalkFsOptions = {}, children: Record<string, FakeNode> = tree()) {
  const root = dir(children)
  const fs = createFakeWalkFs(ROOT, root, options)
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
  let nextRequest = 1
  const query = async (q: ScannerQuery): Promise<unknown> => {
    const requestId = nextRequest
    nextRequest += 1
    host.handle({ type: 'query', requestId, query: q })
    await vi.waitFor(() =>
      expect(posted.some((m) => m.type === 'reply' && m.requestId === requestId)).toBe(true),
    )
    const reply = posted.find((m) => m.type === 'reply' && m.requestId === requestId)
    if (reply?.type !== 'reply') throw new Error('no reply')
    if (!reply.ok) throw new Error(reply.message)
    return reply.result
  }
  return {
    host,
    root,
    query,
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
  it('reports totals, allocated size and the elapsed time when a scan completes', async () => {
    const t = setup()
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    t.advance(40)
    await t.host.idle()

    expect(t.done()).toEqual([
      {
        scanId: 's1',
        status: 'complete',
        files: 4,
        folders: 2,
        bytes: 605,
        allocatedBytes: 4 * 4096,
        elapsedMs: 40,
        errors: [],
        errorCount: 0,
      },
    ])
  })

  it('posts a snapshot on every tick and stops ticking when the scan ends', async () => {
    const t = setup()
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })

    expect(SNAPSHOT_INTERVAL_MS).toBe(250)
    expect(t.intervalMs()).toBe(SNAPSHOT_INTERVAL_MS)
    t.tick()
    expect(t.progress()).toEqual([
      {
        scanId: 's1',
        files: 0,
        folders: 0,
        bytes: 0,
        allocatedBytes: 0,
        currentPath: ROOT,
        elapsedMs: 0,
        errorCount: 0,
      },
    ])

    await t.host.idle()
    expect(t.isTicking()).toBe(false)
  })

  it('cancels the running scan and reports partial results as canceled', async () => {
    const t = setup()
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    t.host.handle({ type: 'cancel', scanId: 's1' })
    await t.host.idle()

    expect(t.done()).toHaveLength(1)
    expect(t.done()[0]).toMatchObject({ scanId: 's1', status: 'canceled', files: 0, bytes: 0 })
  })

  it('ignores a cancel for a different scan', async () => {
    const t = setup()
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    t.host.handle({ type: 'cancel', scanId: 'someone-else' })
    await t.host.idle()

    expect(t.done()[0]).toMatchObject({ scanId: 's1', status: 'complete' })
  })

  it('lets a new start supersede the running scan and drops the old tree', async () => {
    const t = setup()
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    const first = t.host.currentStore()
    t.host.handle({ type: 'start', scanId: 's2', root: ROOT, volume: VOLUME })
    expect(t.host.currentStore()).not.toBe(first)
    await t.host.idle()

    await vi.waitFor(() => expect(t.done()).toHaveLength(2))
    const statusById = Object.fromEntries(t.done().map((done) => [done.scanId, done.status]))
    expect(statusById).toEqual({ s1: 'canceled', s2: 'complete' })
    expect(await t.query({ kind: 'totals', scanId: 's1' })).toBeNull()
  })

  it('counts a locked file at 0 bytes and reports it as a file', async () => {
    const notes = path.join(ROOT, 'notes.txt')
    const t = setup({ lstatErrors: { [notes]: 'EPERM' } })
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    await t.host.idle()

    expect(t.done()[0]).toMatchObject({
      files: 4,
      bytes: 600,
      errors: [{ path: notes, kind: 'file', reason: 'access-denied', code: 'EPERM' }],
      errorCount: 1,
    })
  })

  it('answers tree queries for the current scan, during and after it', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const t = setup({
      beforeOpendir: async (dirPath) => {
        if (dirPath === path.join(ROOT, 'Music')) await gate
      },
    })
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    await vi.waitFor(async () => {
      const live = (await t.query({ kind: 'totals', scanId: 's1' })) as { files: number }
      expect(live.files).toBe(3) // Photos and notes.txt are in; Music is still listing
    })
    release()
    await t.host.idle()

    const page = await t.query({
      kind: 'children',
      scanId: 's1',
      nodeId: 'd0',
      sortKey: 'size',
      sortDir: 'desc',
      offset: 0,
      limit: 10,
    })
    expect(page).toMatchObject({ total: 3, parent: { size: 605, files: 4 } })
    expect(await t.query({ kind: 'expand', scanId: 's1', nodeId: 'd0', levels: 1 })).toEqual(['d0'])
    expect(
      await t.query({ kind: 'node', scanId: 's1', nodeId: 'd0', sortKey: 'size', sortDir: 'desc' }),
    ).toMatchObject({ path: ROOT })
    const layout = await t.query({
      kind: 'treemap',
      scanId: 's1',
      nodeId: 'd0',
      mode: 'size',
      depth: 0,
      width: 100,
      height: 100,
    })
    expect(layout).toMatchObject({ nodeId: 'd0', width: 100, height: 100 })
  })

  it('answers queries for another scan id with nothing', async () => {
    const t = setup()
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    await t.host.idle()
    expect(await t.query({ kind: 'expand', scanId: 'old', nodeId: 'd0', levels: 2 })).toEqual([])
    expect(
      await t.query({ kind: 'node', scanId: 'old', nodeId: 'd0', sortKey: 'name', sortDir: 'asc' }),
    ).toBeNull()
  })

  it('refresh rescans the folder from disk and updates its ancestors', async () => {
    const children = tree()
    const t = setup({}, children)
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    await t.host.idle()
    const page = (await t.query({
      kind: 'children',
      scanId: 's1',
      nodeId: 'd0',
      sortKey: 'name',
      sortDir: 'asc',
      offset: 0,
      limit: 10,
    })) as { rows: Array<{ id: string; name: string }> }
    const photosId = page.rows.find((row) => row.name === 'Photos')?.id ?? ''

    // The disk changes: Photos loses b.jpg and gains a 5000-byte file.
    const photos = children['Photos']
    if (photos?.type !== 'dir') throw new Error('fixture')
    delete photos.children['b.jpg']
    photos.children['new.jpg'] = file(5000, 99)

    const details = await t.query({ kind: 'refresh', scanId: 's1', nodeId: photosId })
    expect(details).toMatchObject({ row: { id: photosId, size: 5300, files: 2, modifiedMs: 99 } })
    expect(await t.query({ kind: 'totals', scanId: 's1' })).toEqual({
      files: 4,
      folders: 2,
      bytes: 5405,
      allocatedBytes: 5 * 4096,
    })
  })

  it('refuses to refresh while the same scan is running', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const t = setup({ beforeOpendir: () => gate })
    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    await expect(t.query({ kind: 'refresh', scanId: 's1', nodeId: 'd0' })).rejects.toThrow(
      REFRESH_BUSY_MESSAGE,
    )
    release()
    await t.host.idle()
  })
})

describe('parseScannerRequest', () => {
  it('accepts start, cancel and query requests', () => {
    expect(
      parseScannerRequest({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME }),
    ).toEqual({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
    expect(parseScannerRequest({ type: 'cancel', scanId: 's1' })).toEqual({
      type: 'cancel',
      scanId: 's1',
    })
    const query: ScannerQuery = {
      kind: 'children',
      scanId: 's1',
      nodeId: 'd0',
      sortKey: 'size',
      sortDir: 'desc',
      offset: 0,
      limit: 100,
    }
    expect(parseScannerRequest({ type: 'query', requestId: 3, query })).toEqual({
      type: 'query',
      requestId: 3,
      query,
    })
  })

  it.each([
    null,
    'start',
    { type: 'start', scanId: 's1', root: ROOT },
    { type: 'start', scanId: 's1', root: ROOT, volume: { clusterBytes: 0, freeBytes: null } },
    { type: 'cancel' },
    { type: 'delete', scanId: 's1' },
    { type: 'query', requestId: 1, query: { kind: 'drop', scanId: 's1' } },
    { type: 'query', requestId: 'x', query: { kind: 'totals', scanId: 's1' } },
    {
      type: 'query',
      requestId: 1,
      query: {
        kind: 'treemap',
        scanId: 's1',
        nodeId: 'd0',
        mode: 'huge',
        depth: 0,
        width: 1,
        height: 1,
      },
    },
  ])('rejects %j', (data) => {
    expect(parseScannerRequest(data)).toBeNull()
  })
})
```

- [ ] **Step 3: Scanner host; remove the 2a tree and top folders**

`src/worker/scanner/scanner-host.ts`:

```ts
import type { ScanDone, ScanProgress } from '@shared/scan-types'
import type {
  ScannerMessage,
  ScannerQuery,
  ScannerQueryResults,
  ScannerRequest,
  ScanVolume,
} from '@shared/scanner-protocol'
import { SIZE_MODES, SORT_KEYS, type SizeMode, type SortKey } from '@shared/tree-types'
import {
  ChildSorter,
  childrenPage,
  expandIds,
  folderOf,
  nodeDetails,
  resolveNode,
} from './tree-queries'
import { TreeStore } from './tree-store'
import { treemapLayout } from './treemap'
import { walk, type WalkFs } from './walk'

export const SNAPSHOT_INTERVAL_MS = 250
export const REFRESH_BUSY_MESSAGE = 'A scan is running; refresh it when the scan ends.'

export interface ScannerHostDeps {
  fs: WalkFs
  post(message: ScannerMessage): void
  now(): number
  /** Calls `tick` every `intervalMs` until the returned function is called. */
  startTicker(tick: () => void, intervalMs: number): () => void
}

export interface ScannerHost {
  handle(request: ScannerRequest): void
  /** Resolves when the most recently started scan (and any refresh) has finished. */
  idle(): Promise<void>
  /** The tree of the latest scan, kept while it runs and after it ends; null before any scan. */
  currentStore(): TreeStore | null
}

interface RunningScan {
  scanId: string
  controller: AbortController
  finished: Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const str = (value: unknown): value is string => typeof value === 'string'
const int = (value: unknown): value is number => Number.isInteger(value)

function parseVolume(value: unknown): ScanVolume | null {
  if (!isRecord(value)) return null
  const clusterBytes = value['clusterBytes']
  const freeBytes = value['freeBytes']
  if (!int(clusterBytes) || clusterBytes <= 0) return null
  if (freeBytes !== null && (typeof freeBytes !== 'number' || freeBytes < 0)) return null
  return { clusterBytes, freeBytes }
}

function parseQuery(value: unknown): ScannerQuery | null {
  if (!isRecord(value) || !str(value['scanId'])) return null
  const scanId = value['scanId']
  const nodeId = value['nodeId']
  const sortKey = value['sortKey']
  const sortDir = value['sortDir']
  const isSort = SORT_KEYS.includes(sortKey as SortKey) && (sortDir === 'asc' || sortDir === 'desc')
  switch (value['kind']) {
    case 'children': {
      const { offset, limit } = value
      if (!str(nodeId) || !isSort || !int(offset) || !int(limit)) return null
      return {
        kind: 'children',
        scanId,
        nodeId,
        sortKey: sortKey as SortKey,
        sortDir: sortDir as 'asc' | 'desc',
        offset,
        limit,
      }
    }
    case 'node':
      if (!str(nodeId) || !isSort) return null
      return {
        kind: 'node',
        scanId,
        nodeId,
        sortKey: sortKey as SortKey,
        sortDir: sortDir as 'asc' | 'desc',
      }
    case 'expand':
      return str(nodeId) && int(value['levels'])
        ? { kind: 'expand', scanId, nodeId, levels: value['levels'] }
        : null
    case 'treemap': {
      const { mode, depth, width, height } = value
      if (!str(nodeId) || !SIZE_MODES.includes(mode as SizeMode)) return null
      if (!int(depth) || !int(width) || !int(height)) return null
      return { kind: 'treemap', scanId, nodeId, mode: mode as SizeMode, depth, width, height }
    }
    case 'refresh':
      return str(nodeId) ? { kind: 'refresh', scanId, nodeId } : null
    case 'totals':
      return { kind: 'totals', scanId }
    default:
      return null
  }
}

export function parseScannerRequest(data: unknown): ScannerRequest | null {
  if (!isRecord(data)) return null
  if (data['type'] === 'query') {
    const requestId = data['requestId']
    const query = parseQuery(data['query'])
    return int(requestId) && query !== null ? { type: 'query', requestId, query } : null
  }
  const scanId = data['scanId']
  if (!str(scanId)) return null
  if (data['type'] === 'start') {
    const root = data['root']
    const volume = parseVolume(data['volume'])
    return str(root) && volume !== null ? { type: 'start', scanId, root, volume } : null
  }
  if (data['type'] === 'cancel') return { type: 'cancel', scanId }
  return null
}

export function createScannerHost(deps: ScannerHostDeps): ScannerHost {
  let current: RunningScan | null = null
  let store: TreeStore | null = null
  let sorter: ChildSorter | null = null
  let storeScanId: string | null = null
  /** Refreshes run one after another, never during a scan of the same tree. */
  let refreshes: Promise<unknown> = Promise.resolve()

  const run = async (
    scanId: string,
    rootPath: string,
    tree: TreeStore,
    signal: AbortSignal,
  ): Promise<void> => {
    const startedAt = deps.now()
    const totals = () => {
      const { files, folders, bytes, allocatedBytes } = tree.totals()
      return { scanId, files, folders, bytes, allocatedBytes, elapsedMs: deps.now() - startedAt }
    }
    const stopTicker = deps.startTicker(() => {
      const progress: ScanProgress = {
        ...totals(),
        currentPath: tree.currentPath,
        errorCount: tree.errorCount,
      }
      deps.post({ type: 'progress', payload: progress })
    }, SNAPSHOT_INTERVAL_MS)
    try {
      await walk(rootPath, 0, tree, { fs: deps.fs, signal })
    } finally {
      stopTicker()
    }
    const done: ScanDone = {
      ...totals(),
      status: signal.aborted ? 'canceled' : 'complete',
      errors: [...tree.errors],
      errorCount: tree.errorCount,
    }
    deps.post({ type: 'done', payload: done })
  }

  const refresh = async (
    scanId: string,
    nodeId: string,
  ): Promise<ScannerQueryResults['refresh']> => {
    if (store === null || sorter === null || storeScanId !== scanId) return null
    if (current !== null && current.scanId === scanId) throw new Error(REFRESH_BUSY_MESSAGE)
    const tree = store
    const ref = resolveNode(tree, nodeId)
    if (ref === null) return null
    const folder = folderOf(tree, ref)
    tree.resetFolder(folder)
    await walk(tree.folderPath(folder), folder, tree, {
      fs: deps.fs,
      signal: new AbortController().signal,
    })
    return nodeDetails(tree, sorter, `d${folder}`, 'size', 'desc')
  }

  const answer = async (query: ScannerQuery): Promise<unknown> => {
    if (query.kind === 'refresh') {
      const next = refreshes.then(() => refresh(query.scanId, query.nodeId))
      refreshes = next.catch(() => undefined)
      return next
    }
    if (store === null || sorter === null || storeScanId !== query.scanId) {
      return query.kind === 'expand' ? [] : null
    }
    switch (query.kind) {
      case 'children':
        return childrenPage(
          store,
          sorter,
          query.nodeId,
          query.sortKey,
          query.sortDir,
          query.offset,
          query.limit,
        )
      case 'node':
        return nodeDetails(store, sorter, query.nodeId, query.sortKey, query.sortDir)
      case 'expand':
        return expandIds(store, query.nodeId, query.levels)
      case 'treemap':
        return treemapLayout(
          store,
          query.nodeId,
          query.mode,
          query.depth,
          query.width,
          query.height,
        )
      case 'totals':
        return store.totals()
    }
  }

  return {
    handle(request) {
      if (request.type === 'query') {
        answer(request.query).then(
          (result) => deps.post({ type: 'reply', requestId: request.requestId, ok: true, result }),
          (error: unknown) =>
            deps.post({
              type: 'reply',
              requestId: request.requestId,
              ok: false,
              message: error instanceof Error ? error.message : String(error),
            }),
        )
        return
      }
      if (request.type === 'cancel') {
        if (current?.scanId === request.scanId) current.controller.abort()
        return
      }
      current?.controller.abort() // a new start supersedes the running scan
      // The previous tree is dropped now, so two full trees are never held at once.
      store = new TreeStore(request.root, request.volume.clusterBytes, request.volume.freeBytes)
      sorter = new ChildSorter(store)
      storeScanId = request.scanId
      const controller = new AbortController()
      const scan: RunningScan = { scanId: request.scanId, controller, finished: Promise.resolve() }
      current = scan
      scan.finished = run(request.scanId, request.root, store, controller.signal).finally(() => {
        if (current === scan) current = null
      })
    },
    idle: async () => {
      await (current?.finished ?? Promise.resolve())
      await refreshes
    },
    currentStore: () => store,
  }
}
```

```powershell
git rm src/worker/scanner/tree.ts src/worker/scanner/tree.test.ts src/worker/scanner/top-folders.ts src/worker/scanner/top-folders.test.ts
```

`src/worker/scanner/entry.ts` is unchanged.

- [ ] **Step 4: Run the worker tests**

```powershell
npx vitest run src/worker
```

Expected: PASS — 5 files, 94 tests.

- [ ] **Step 5: Argument parsers (tests first, then code)**

`src/main/ipc/parse-args.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  childrenArgs,
  clipboardArgs,
  contextMenuArgs,
  expandArgs,
  InvalidIpcArgumentsError,
  MAX_CLIPBOARD_TEXT,
  nodeArgs,
  noArgs,
  oneString,
  scanNodeArgs,
  treemapArgs,
} from './parse-args'

const SCAN = '0d6b2f6e-8a3c-4c1e-9f61-2b8f6a1d5e10'

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

describe('scanNodeArgs', () => {
  it('accepts a scan id and a node id', () => {
    expect(scanNodeArgs([SCAN, 'd12'])).toEqual([SCAN, 'd12'])
    expect(scanNodeArgs([SCAN, 'g0'])).toEqual([SCAN, 'g0'])
    expect(scanNodeArgs([SCAN, 'f999'])).toEqual([SCAN, 'f999'])
  })

  it.each([
    [[SCAN]],
    [[SCAN, 'd1', 'extra']],
    [['not a scan id!', 'd1']],
    [[SCAN, 'C:\\Windows']],
    [[SCAN, 'x1']],
    [[SCAN, 'd']],
    [[SCAN, 'd1234567890']],
    [[SCAN, 7]],
  ])('rejects %j', (args) => {
    expect(() => scanNodeArgs(args)).toThrow(InvalidIpcArgumentsError)
  })
})

describe('childrenArgs', () => {
  it('accepts a full page request', () => {
    expect(childrenArgs([SCAN, 'd0', 'size', 'desc', 0, 200])).toEqual([
      SCAN,
      'd0',
      'size',
      'desc',
      0,
      200,
    ])
  })

  it.each([
    [[SCAN, 'd0', 'colour', 'desc', 0, 10]],
    [[SCAN, 'd0', 'size', 'down', 0, 10]],
    [[SCAN, 'd0', 'size', 'desc', -1, 10]],
    [[SCAN, 'd0', 'size', 'desc', 0, 0]],
    [[SCAN, 'd0', 'size', 'desc', 0, 1001]],
    [[SCAN, 'd0', 'size', 'desc', 0.5, 10]],
    [[SCAN, 'd0', 'size', 'desc', 0]],
  ])('rejects %j', (args) => {
    expect(() => childrenArgs(args)).toThrow(InvalidIpcArgumentsError)
  })
})

describe('nodeArgs and expandArgs', () => {
  it('accept valid arguments', () => {
    expect(nodeArgs([SCAN, 'f3', 'name', 'asc'])).toEqual([SCAN, 'f3', 'name', 'asc'])
    expect(expandArgs([SCAN, 'd0', 5])).toEqual([SCAN, 'd0', 5])
  })

  it('reject invalid arguments', () => {
    expect(() => nodeArgs([SCAN, 'f3', 'name'])).toThrow(InvalidIpcArgumentsError)
    expect(() => expandArgs([SCAN, 'd0', 0])).toThrow(InvalidIpcArgumentsError)
    expect(() => expandArgs([SCAN, 'd0', 65])).toThrow(InvalidIpcArgumentsError)
  })
})

describe('treemapArgs', () => {
  it('accepts a layout request', () => {
    expect(treemapArgs([SCAN, 'd0', 'allocated', 5, 800, 240])).toEqual([
      SCAN,
      'd0',
      'allocated',
      5,
      800,
      240,
    ])
  })

  it.each([
    [[SCAN, 'd0', 'colour', 0, 800, 240]],
    [[SCAN, 'd0', 'size', 6, 800, 240]],
    [[SCAN, 'd0', 'size', 0, 0, 240]],
    [[SCAN, 'd0', 'size', 0, 800, 10_001]],
  ])('rejects %j', (args) => {
    expect(() => treemapArgs(args)).toThrow(InvalidIpcArgumentsError)
  })
})

describe('contextMenuArgs', () => {
  it('accepts a menu request', () => {
    expect(contextMenuArgs([SCAN, 'd4', 120, 300, false])).toEqual([SCAN, 'd4', 120, 300, false])
  })

  it.each([
    [[SCAN, 'd4', 120, 300]],
    [[SCAN, 'd4', -1, 300, false]],
    [[SCAN, 'd4', 120, 300, 'yes']],
    [[SCAN, 'd4', 1.5, 300, true]],
  ])('rejects %j', (args) => {
    expect(() => contextMenuArgs(args)).toThrow(InvalidIpcArgumentsError)
  })
})

describe('clipboardArgs', () => {
  it('accepts text up to the limit', () => {
    expect(clipboardArgs(['C:\\Data'])).toEqual(['C:\\Data'])
  })

  it('rejects text over the limit and non-strings', () => {
    expect(() => clipboardArgs(['x'.repeat(MAX_CLIPBOARD_TEXT + 1)])).toThrow(
      InvalidIpcArgumentsError,
    )
    expect(() => clipboardArgs([5])).toThrow(InvalidIpcArgumentsError)
  })
})
```

`src/main/ipc/parse-args.ts`:

```ts
import {
  MAX_PAGE_ROWS,
  MAX_TREEMAP_DEPTH,
  NODE_ID_PATTERN,
  SIZE_MODES,
  SORT_KEYS,
  type NodeId,
  type SizeMode,
  type SortDir,
  type SortKey,
} from '@shared/tree-types'

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

/** Throws unless exactly `count` arguments were sent. */
export function expectCount(args: readonly unknown[], count: number): void {
  if (args.length !== count) {
    throw new InvalidIpcArgumentsError(`expected ${count} arguments, got ${args.length}`)
  }
}

/** Scan IDs are UUIDs made by main; anything else is refused before it reaches the scanner. */
export const SCAN_ID_PATTERN = /^[0-9a-f-]{1,64}$/i

export function scanIdArg(value: unknown): string {
  if (typeof value !== 'string' || !SCAN_ID_PATTERN.test(value)) {
    throw new InvalidIpcArgumentsError('expected a scan id')
  }
  return value
}

export function nodeIdArg(value: unknown): NodeId {
  if (typeof value !== 'string' || !NODE_ID_PATTERN.test(value)) {
    throw new InvalidIpcArgumentsError('expected a tree node id')
  }
  return value
}

export function sortKeyArg(value: unknown): SortKey {
  if (!SORT_KEYS.includes(value as SortKey)) {
    throw new InvalidIpcArgumentsError(`expected one of ${SORT_KEYS.join(', ')}`)
  }
  return value as SortKey
}

export function sortDirArg(value: unknown): SortDir {
  if (value !== 'asc' && value !== 'desc') {
    throw new InvalidIpcArgumentsError('expected "asc" or "desc"')
  }
  return value
}

export function sizeModeArg(value: unknown): SizeMode {
  if (!SIZE_MODES.includes(value as SizeMode)) {
    throw new InvalidIpcArgumentsError(`expected one of ${SIZE_MODES.join(', ')}`)
  }
  return value as SizeMode
}

export function intArg(value: unknown, min: number, max: number, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new InvalidIpcArgumentsError(`${name} must be a whole number from ${min} to ${max}`)
  }
  return value
}

export function booleanArg(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean')
    throw new InvalidIpcArgumentsError(`${name} must be true or false`)
  return value
}

/** Largest canvas the treemap lays out, in CSS px, per side. */
export const MAX_TREEMAP_SIDE = 10_000
/** Window coordinates accepted for the context menu, in CSS px. */
export const MAX_WINDOW_COORDINATE = 100_000
/** Longest text `clipboard:write-text` accepts (characters). */
export const MAX_CLIPBOARD_TEXT = 1_000_000

/** `[scanId, nodeId]` */
export function scanNodeArgs(args: readonly unknown[]): [string, NodeId] {
  expectCount(args, 2)
  return [scanIdArg(args[0]), nodeIdArg(args[1])]
}

/** `tree:children` */
export function childrenArgs(
  args: readonly unknown[],
): [string, NodeId, SortKey, SortDir, number, number] {
  expectCount(args, 6)
  return [
    scanIdArg(args[0]),
    nodeIdArg(args[1]),
    sortKeyArg(args[2]),
    sortDirArg(args[3]),
    intArg(args[4], 0, 2 ** 31 - 1, 'offset'),
    intArg(args[5], 1, MAX_PAGE_ROWS, 'limit'),
  ]
}

/** `tree:node` */
export function nodeArgs(args: readonly unknown[]): [string, NodeId, SortKey, SortDir] {
  expectCount(args, 4)
  return [scanIdArg(args[0]), nodeIdArg(args[1]), sortKeyArg(args[2]), sortDirArg(args[3])]
}

/** `tree:expand-ids` */
export function expandArgs(args: readonly unknown[]): [string, NodeId, number] {
  expectCount(args, 3)
  return [scanIdArg(args[0]), nodeIdArg(args[1]), intArg(args[2], 1, 64, 'levels')]
}

/** `treemap:layout` */
export function treemapArgs(
  args: readonly unknown[],
): [string, NodeId, SizeMode, number, number, number] {
  expectCount(args, 6)
  return [
    scanIdArg(args[0]),
    nodeIdArg(args[1]),
    sizeModeArg(args[2]),
    intArg(args[3], 0, MAX_TREEMAP_DEPTH, 'depth'),
    intArg(args[4], 1, MAX_TREEMAP_SIDE, 'width'),
    intArg(args[5], 1, MAX_TREEMAP_SIDE, 'height'),
  ]
}

/** `shell:context-menu` */
export function contextMenuArgs(
  args: readonly unknown[],
): [string, NodeId, number, number, boolean] {
  expectCount(args, 5)
  return [
    scanIdArg(args[0]),
    nodeIdArg(args[1]),
    intArg(args[2], 0, MAX_WINDOW_COORDINATE, 'x'),
    intArg(args[3], 0, MAX_WINDOW_COORDINATE, 'y'),
    booleanArg(args[4], 'extended'),
  ]
}

/** `clipboard:write-text` */
export function clipboardArgs(args: readonly unknown[]): [string] {
  const [text] = oneString(args)
  if (text.length > MAX_CLIPBOARD_TEXT) {
    throw new InvalidIpcArgumentsError(`text longer than ${MAX_CLIPBOARD_TEXT} characters`)
  }
  return [text]
}

/** `drive:info`: a drive root like `C:\` (or `C:`). */
export function driveRootArgs(args: readonly unknown[]): [string] {
  const [root] = oneString(args)
  const match = /^([A-Za-z]):\\?$/.exec(root)
  if (match === null) throw new InvalidIpcArgumentsError('expected a drive root like C:\\')
  return [`${(match[1] ?? '').toUpperCase()}:\\`]
}
```

- [ ] **Step 6: Scan service with queries**

`src/main/scan/scan-service.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ScanDone, ScanProgress } from '@shared/scan-types'
import type { ScannerRequest, ScanVolume } from '@shared/scanner-protocol'
import type { SendEvent } from '../ipc/send-event'
import {
  createScanService,
  QUERY_TIMEOUT_MESSAGE,
  SCAN_CRASH_MESSAGE,
  SCANNER_GONE_MESSAGE,
  type ScannerChild,
} from './scan-service'

const V: ScanVolume = { clusterBytes: 4096, freeBytes: null }

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
    allocatedBytes: 4096,
    currentPath: 'C:\\Data',
    elapsedMs: 250,
    errorCount: 0,
  }
}

function done(scanId: string, status: ScanDone['status'] = 'complete'): ScanDone {
  return {
    scanId,
    status,
    files: 1,
    folders: 0,
    bytes: 10,
    allocatedBytes: 4096,
    elapsedMs: 300,
    errors: [],
    errorCount: 0,
  }
}

function setup() {
  const timers: Array<() => void> = []
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
    setTimer: (callback) => {
      timers.push(callback)
      return () => {
        const index = timers.indexOf(callback)
        if (index !== -1) timers.splice(index, 1)
      }
    },
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
  return { service, children, events, child, timers }
}

describe('createScanService', () => {
  it('forks the scanner on the first start only and posts each start request', () => {
    const t = setup()
    expect(t.children).toHaveLength(0)

    expect(t.service.start('C:\\Data', V)).toEqual({ scanId: 'scan-1' })
    t.child().emit({ type: 'done', payload: done('scan-1') })
    expect(t.service.start('D:\\', V)).toEqual({ scanId: 'scan-2' })

    expect(t.children).toHaveLength(1)
    expect(t.child().posted).toEqual([
      { type: 'start', scanId: 'scan-1', root: 'C:\\Data', volume: V },
      { type: 'start', scanId: 'scan-2', root: 'D:\\', volume: V },
    ])
  })

  it('relays progress and done of the active scan to the window', () => {
    const t = setup()
    t.service.start('C:\\Data', V)
    t.child().emit({ type: 'progress', payload: progress('scan-1') })
    t.child().emit({ type: 'done', payload: done('scan-1') })

    expect(t.events).toEqual([
      ['scan:progress', progress('scan-1')],
      ['scan:done', done('scan-1')],
    ])
  })

  it('drops messages of other scans and malformed messages', () => {
    const t = setup()
    t.service.start('C:\\Data', V)
    t.child().emit({ type: 'progress', payload: progress('scan-0') })
    t.child().emit({ type: 'progress' })
    t.child().emit('garbage')
    t.child().emit({ type: 'other', payload: { scanId: 'scan-1' } })

    expect(t.events).toEqual([])
  })

  it('cancels the running scan when a new one starts, and relays only the new one', () => {
    const t = setup()
    t.service.start('C:\\Data', V)
    t.service.start('D:\\', V)
    t.child().emit({ type: 'done', payload: done('scan-1', 'canceled') })
    t.child().emit({ type: 'done', payload: done('scan-2') })

    expect(t.child().posted).toEqual([
      { type: 'start', scanId: 'scan-1', root: 'C:\\Data', volume: V },
      { type: 'cancel', scanId: 'scan-1' },
      { type: 'start', scanId: 'scan-2', root: 'D:\\', volume: V },
    ])
    expect(t.events).toEqual([['scan:done', done('scan-2')]])
  })

  it('cancels the active scan and ignores unknown or finished scans', () => {
    const t = setup()
    t.service.start('C:\\Data', V)
    t.service.cancel('nope')
    t.service.cancel('scan-1')
    t.child().emit({ type: 'done', payload: done('scan-1', 'canceled') })
    t.service.cancel('scan-1')

    expect(t.child().posted).toEqual([
      { type: 'start', scanId: 'scan-1', root: 'C:\\Data', volume: V },
      { type: 'cancel', scanId: 'scan-1' },
    ])
    expect(t.events).toEqual([['scan:done', done('scan-1', 'canceled')]])
  })

  it('turns an unexpected exit during a scan into scan:failed and forks anew next time', () => {
    const t = setup()
    t.service.start('C:\\Data', V)
    t.child().exit(1)

    expect(t.events).toEqual([['scan:failed', { scanId: 'scan-1', message: SCAN_CRASH_MESSAGE }]])

    t.service.start('C:\\Data', V)
    expect(t.children).toHaveLength(2)
    expect(t.child(1).posted).toEqual([
      { type: 'start', scanId: 'scan-2', root: 'C:\\Data', volume: V },
    ])
  })

  it('stays silent when an idle scanner exits', () => {
    const t = setup()
    t.service.start('C:\\Data', V)
    t.child().emit({ type: 'done', payload: done('scan-1') })
    t.child().exit(0)

    expect(t.events).toEqual([['scan:done', done('scan-1')]])
  })

  it('kills the scanner on quit and sends nothing afterwards', () => {
    const t = setup()
    t.service.start('C:\\Data', V)
    t.service.dispose()

    expect(t.child().killed).toBe(true)
    t.child().emit({ type: 'progress', payload: progress('scan-1') })
    t.child().exit(1)
    expect(t.events).toEqual([])
    expect(() => t.service.start('C:\\Data', V)).toThrow('shut down')
  })

  it('cancelActive cancels only a running scan', () => {
    const t = setup()
    t.service.cancelActive()
    expect(t.children).toHaveLength(0)

    t.service.start('C:\\Data', V)
    t.service.cancelActive()
    expect(t.child().posted.at(-1)).toEqual({ type: 'cancel', scanId: 'scan-1' })
  })

  it('remembers the current scan until the scanner exits', () => {
    const t = setup()
    expect(t.service.currentScan()).toBeNull()
    t.service.start('C:\\Data', V)
    expect(t.service.currentScan()).toEqual({ scanId: 'scan-1', root: 'C:\\Data' })
    expect(t.service.isScanning()).toBe(true)
    t.child().emit({ type: 'done', payload: done('scan-1') })
    expect(t.service.isScanning()).toBe(false)
    expect(t.service.currentScan()).toEqual({ scanId: 'scan-1', root: 'C:\\Data' })
    t.child().exit(0)
    expect(t.service.currentScan()).toBeNull()
  })

  it('sends queries to the scanner and resolves them with the matching reply', async () => {
    const t = setup()
    t.service.start('C:\\Data', V)
    const first = t.service.query({ kind: 'totals', scanId: 'scan-1' })
    const second = t.service.query({ kind: 'expand', scanId: 'scan-1', nodeId: 'd0', levels: 1 })
    expect(t.child().posted.slice(1)).toEqual([
      { type: 'query', requestId: 1, query: { kind: 'totals', scanId: 'scan-1' } },
      {
        type: 'query',
        requestId: 2,
        query: { kind: 'expand', scanId: 'scan-1', nodeId: 'd0', levels: 1 },
      },
    ])
    t.child().emit({ type: 'reply', requestId: 2, ok: true, result: ['d0'] })
    t.child().emit({ type: 'reply', requestId: 1, ok: false, message: 'busy' })
    await expect(second).resolves.toEqual(['d0'])
    await expect(first).rejects.toThrow('busy')
    expect(t.timers).toHaveLength(0)
  })

  it('rejects queries when there is no scanner, when it exits and when it does not answer', async () => {
    const t = setup()
    await expect(t.service.query({ kind: 'totals', scanId: 'x' })).rejects.toThrow(
      SCANNER_GONE_MESSAGE,
    )
    t.service.start('C:\\Data', V)
    const lost = t.service.query({ kind: 'totals', scanId: 'scan-1' })
    t.child().exit(1)
    await expect(lost).rejects.toThrow(SCAN_CRASH_MESSAGE)

    t.service.start('C:\\Data', V)
    const slow = t.service.query({ kind: 'totals', scanId: 'scan-2' })
    t.timers[0]?.()
    await expect(slow).rejects.toThrow(QUERY_TIMEOUT_MESSAGE)
  })
})
```

`src/main/scan/scan-service.ts`:

```ts
import type { ScanFailed, ScanStartResult } from '@shared/scan-types'
import type {
  ScannerMessage,
  ScannerQueryKind,
  ScannerQueryOf,
  ScannerQueryResults,
  ScannerRequest,
  ScanVolume,
} from '@shared/scanner-protocol'
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
  /** Rejects a query that gets no reply in time (default `QUERY_TIMEOUT_MS`). */
  setTimer?(callback: () => void, ms: number): () => void
}

/** The scan the tree queries belong to: the latest one started, kept after it ends. */
export interface CurrentScan {
  scanId: string
  root: string
}

export interface ScanService {
  /** Starts a scan; a running scan is canceled first (one scan at a time). */
  start(root: string, volume: ScanVolume): ScanStartResult
  /** Cancels the active scan; unknown or finished IDs are a no-op. */
  cancel(scanId: string): void
  /** Cancels whatever scan is running (used when the window reloads after a crash). */
  cancelActive(): void
  /** The latest scan, or null before the first scan and after a scanner crash. */
  currentScan(): CurrentScan | null
  /** True while the latest scan is still walking. */
  isScanning(): boolean
  /** Asks the scanner about its tree. Rejects if the scanner is gone or does not answer. */
  query<K extends ScannerQueryKind>(query: ScannerQueryOf<K>): Promise<ScannerQueryResults[K]>
  /** App quit: kill the scanner and send no more events. */
  dispose(): void
}

export const SCAN_CRASH_MESSAGE = 'The scanner process stopped unexpectedly.'
export const SCANNER_GONE_MESSAGE = 'The scanner is not running.'
export const QUERY_TIMEOUT_MESSAGE = 'The scanner did not answer in time.'
/** A refresh rescans a folder, so it gets the same generous limit as every other query. */
export const QUERY_TIMEOUT_MS = 120_000

function isScannerMessage(value: unknown): value is ScannerMessage {
  if (typeof value !== 'object' || value === null) return false
  const record = value as { type?: unknown; payload?: unknown; requestId?: unknown }
  if (record.type === 'reply') return typeof record.requestId === 'number'
  if (record.type !== 'progress' && record.type !== 'done') return false
  const payload = record.payload as { scanId?: unknown } | null | undefined
  return typeof payload === 'object' && payload !== null && typeof payload.scanId === 'string'
}

interface PendingQuery {
  resolve(result: unknown): void
  reject(error: Error): void
  clearTimer(): void
}

const defaultTimer = (callback: () => void, ms: number) => {
  const timer = setTimeout(callback, ms)
  return () => clearTimeout(timer)
}

export function createScanService(deps: ScanServiceDeps): ScanService {
  let child: ScannerChild | null = null
  let activeScanId: string | null = null
  let current: CurrentScan | null = null
  let disposed = false
  let nextRequestId = 1
  const pending = new Map<number, PendingQuery>()
  const setTimer = deps.setTimer ?? defaultTimer

  const rejectAll = (message: string) => {
    for (const query of pending.values()) {
      query.clearTimer()
      query.reject(new Error(message))
    }
    pending.clear()
  }

  const ensureChild = (): ScannerChild => {
    if (child) return child
    const forked = deps.forkScanner()
    forked.onMessage((message) => {
      if (disposed || child !== forked || !isScannerMessage(message)) return
      if (message.type === 'reply') {
        const query = pending.get(message.requestId)
        if (query === undefined) return
        pending.delete(message.requestId)
        query.clearTimer()
        if (message.ok) query.resolve(message.result)
        else query.reject(new Error(message.message))
        return
      }
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
      current = null // the tree lived in the process that just ended
      rejectAll(SCAN_CRASH_MESSAGE)
      if (disposed || activeScanId === null) return
      const failed: ScanFailed = { scanId: activeScanId, message: SCAN_CRASH_MESSAGE }
      activeScanId = null
      deps.sendEvent('scan:failed', failed)
    })
    child = forked
    return forked
  }

  return {
    start(root, volume) {
      if (disposed) throw new Error('The scan service has been shut down.')
      const scanner = ensureChild()
      if (activeScanId !== null) scanner.postMessage({ type: 'cancel', scanId: activeScanId })
      const scanId = deps.createScanId()
      activeScanId = scanId
      current = { scanId, root }
      scanner.postMessage({ type: 'start', scanId, root, volume })
      return { scanId }
    },

    cancel(scanId) {
      if (scanId === activeScanId) child?.postMessage({ type: 'cancel', scanId })
    },

    cancelActive() {
      if (activeScanId !== null) child?.postMessage({ type: 'cancel', scanId: activeScanId })
    },

    currentScan: () => current,

    isScanning: () => activeScanId !== null,

    query<K extends ScannerQueryKind>(query: ScannerQueryOf<K>): Promise<ScannerQueryResults[K]> {
      const scanner = child
      if (disposed || scanner === null) return Promise.reject(new Error(SCANNER_GONE_MESSAGE))
      const requestId = nextRequestId
      nextRequestId += 1
      return new Promise<ScannerQueryResults[K]>((resolve, reject) => {
        const clearTimer = setTimer(() => {
          pending.delete(requestId)
          reject(new Error(QUERY_TIMEOUT_MESSAGE))
        }, QUERY_TIMEOUT_MS)
        pending.set(requestId, {
          resolve: (result) => resolve(result as ScannerQueryResults[K]),
          reject,
          clearTimer,
        })
        scanner.postMessage({ type: 'query', requestId, query })
      })
    },

    dispose() {
      disposed = true
      activeScanId = null
      current = null
      rejectAll(SCANNER_GONE_MESSAGE)
      const scanner = child
      child = null
      scanner?.kill()
    },
  }
}
```

- [ ] **Step 7: Drive details through koffi**

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

/** Cluster size and file system of a volume. */
export interface VolumeDetails {
  /** Sectors per cluster × bytes per sector (`GetDiskFreeSpaceW`). */
  clusterBytes: number
  /** For example `NTFS`, `exFAT`, `FAT32` (`GetVolumeInformationW`); `''` when unreadable. */
  fileSystem: string
}

/** The Windows calls drive listing needs. The app passes koffi + `fs.statfs`; tests pass a fake. */
export interface DriveApi {
  /** Bit mask of existing drive letters (bit 0 = A:). */
  getLogicalDrives(): number
  getDriveType(root: string): number
  /** The volume label, `''` when the volume has none, or `null` when it cannot be read. */
  getVolumeLabel(root: string): string | null
  /** Cluster size and file system, or `null` when the volume cannot be read. */
  getVolumeDetails(root: string): VolumeDetails | null
  statfs(root: string): Promise<DriveSpace>
}
```

`src/main/drives/koffi-drive-api.ts`:

```ts
import { statfs } from 'node:fs/promises'
import type { DriveApi } from './drive-api'

/** MAX_PATH + 1 UTF-16 code units: the documented size for a volume-name buffer. */
const NAME_BUFFER_CHARS = 261

function readUtf16(buffer: Buffer): string {
  const text = buffer.toString('utf16le')
  const end = text.indexOf('\0')
  return end === -1 ? text : text.slice(0, end)
}

/**
 * Binds GetLogicalDrives, GetDriveTypeW, GetVolumeInformationW and GetDiskFreeSpaceW from
 * kernel32 with koffi. koffi is imported lazily, so a broken native module fails the drive
 * calls, not app startup. `__stdcall` is the WINAPI convention; koffi ignores it on x64.
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
      '_Out_ uint16_t *lpFileSystemNameBuffer, uint32_t nFileSystemNameSize)',
  )
  const getDiskFreeSpaceW = kernel32.func(
    'int __stdcall GetDiskFreeSpaceW(const char16_t *lpRootPathName, ' +
      '_Out_ uint32_t *lpSectorsPerCluster, _Out_ uint32_t *lpBytesPerSector, ' +
      '_Out_ uint32_t *lpNumberOfFreeClusters, _Out_ uint32_t *lpTotalNumberOfClusters)',
  )

  return {
    getLogicalDrives: () => Number(getLogicalDrives()),
    getDriveType: (root) => Number(getDriveTypeW(root)),
    getVolumeLabel: (root) => {
      const buffer = Buffer.alloc(NAME_BUFFER_CHARS * 2)
      const ok = Number(
        getVolumeInformationW(root, buffer, NAME_BUFFER_CHARS, null, null, null, null, 0),
      )
      return ok === 0 ? null : readUtf16(buffer)
    },
    getVolumeDetails: (root) => {
      const sectorsPerCluster = [0]
      const bytesPerSector = [0]
      const ok = Number(getDiskFreeSpaceW(root, sectorsPerCluster, bytesPerSector, [0], [0]))
      if (ok === 0) return null
      const fileSystem = Buffer.alloc(NAME_BUFFER_CHARS * 2)
      const named = Number(
        getVolumeInformationW(root, null, 0, null, null, null, fileSystem, NAME_BUFFER_CHARS),
      )
      return {
        clusterBytes: (sectorsPerCluster[0] ?? 0) * (bytesPerSector[0] ?? 0),
        fileSystem: named === 0 ? '' : readUtf16(fileSystem),
      }
    },
    statfs: (root) => statfs(root),
  }
}
```

`src/main/drives/drive-details.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { DriveApi } from './drive-api'
import { driveRootOf, isDriveRoot, readDriveDetails } from './drive-details'

function fakeApi(overrides: Partial<DriveApi> = {}): DriveApi {
  return {
    getLogicalDrives: () => 0b100,
    getDriveType: () => 3,
    getVolumeLabel: () => '',
    getVolumeDetails: () => ({ clusterBytes: 4096, fileSystem: 'NTFS' }),
    statfs: async () => ({ bsize: 4096, blocks: 1000, bavail: 250 }),
    ...overrides,
  }
}

describe('driveRootOf and isDriveRoot', () => {
  it.each([
    ['C:\\Users\\Ana', 'C:\\', false],
    ['d:/Photos', 'D:\\', false],
    ['C:\\', 'C:\\', true],
    ['E:', 'E:\\', true],
  ])('%s is on %s (drive root: %s)', (target, root, rootItself) => {
    expect(driveRootOf(target)).toBe(root)
    expect(isDriveRoot(target)).toBe(rootItself)
  })

  it('has no drive for a network path', () => {
    expect(driveRootOf('\\\\server\\share')).toBeNull()
  })
})

describe('readDriveDetails', () => {
  it('combines statfs space with the cluster size and file system', async () => {
    await expect(readDriveDetails(fakeApi(), 'C:\\')).resolves.toEqual({
      root: 'C:\\',
      totalBytes: 4_096_000,
      freeBytes: 1_024_000,
      clusterBytes: 4096,
      fileSystem: 'NTFS',
    })
  })

  it('returns null when the drive cannot be read', async () => {
    const notReady = fakeApi({
      statfs: async () => {
        throw new Error('EBUSY')
      },
    })
    await expect(readDriveDetails(notReady, 'E:\\')).resolves.toBeNull()
    await expect(
      readDriveDetails(fakeApi({ getVolumeDetails: () => null }), 'E:\\'),
    ).resolves.toBeNull()
  })
})
```

`src/main/drives/drive-details.ts`:

```ts
import path from 'node:path'
import type { DriveDetails } from '@shared/scan-types'
import type { DriveApi } from './drive-api'

/** `C:\Users\Me` → `C:\`; anything without a drive letter → null. */
export function driveRootOf(target: string): string | null {
  const match = /^([A-Za-z]):/.exec(path.win32.normalize(target))
  return match === null ? null : `${(match[1] ?? '').toUpperCase()}:\\`
}

/** True when `target` is a drive root itself (`C:\`), not a folder on it. */
export function isDriveRoot(target: string): boolean {
  return /^[A-Za-z]:[\\/]?$/.test(target)
}

/** Space, cluster size and file system of `root`, or null when the drive cannot be read. */
export async function readDriveDetails(api: DriveApi, root: string): Promise<DriveDetails | null> {
  let space
  try {
    space = await api.statfs(root)
  } catch {
    return null
  }
  const volume = api.getVolumeDetails(root)
  if (volume === null || volume.clusterBytes <= 0) return null
  return {
    root,
    totalBytes: space.blocks * space.bsize,
    freeBytes: space.bavail * space.bsize,
    clusterBytes: volume.clusterBytes,
    fileSystem: volume.fileSystem,
  }
}
```

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
    getVolumeDetails: () => ({ clusterBytes: 4096, fileSystem: 'NTFS' }),
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

- [ ] **Step 8: Places and recent scans**

`src/main/places/places.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import {
  createRecentScans,
  listPlaces,
  oneDriveFolders,
  parseRecent,
  type RecentScans,
} from './places'

const FILE = 'C:\\Users\\Ana\\AppData\\Roaming\\StorageIQ\\recent-scans.json'

function memoryRecent(initial = '[]') {
  let stored = initial
  const writeFile = vi.fn(async (_file: string, text: string) => {
    stored = text
  })
  const recent = createRecentScans({
    file: FILE,
    readFile: async () => stored,
    writeFile,
  })
  return { recent, writeFile, stored: () => stored }
}

describe('oneDriveFolders', () => {
  it('reads the OneDrive environment variables, personal first, without duplicates', () => {
    expect(
      oneDriveFolders({
        OneDrive: 'C:\\Users\\Ana\\OneDrive - Contoso',
        OneDriveConsumer: 'C:\\Users\\Ana\\OneDrive',
        OneDriveCommercial: 'C:\\Users\\Ana\\OneDrive - Contoso',
      }),
    ).toEqual([
      { kind: 'onedrive', label: 'OneDrive', path: 'C:\\Users\\Ana\\OneDrive' },
      {
        kind: 'onedrive',
        label: 'OneDrive - Contoso',
        path: 'C:\\Users\\Ana\\OneDrive - Contoso',
      },
    ])
  })

  it('ignores missing, relative and network values', () => {
    expect(oneDriveFolders({})).toEqual([])
    expect(oneDriveFolders({ OneDrive: 'OneDrive', OneDriveCommercial: '\\\\srv\\od' })).toEqual([])
  })
})

describe('listPlaces', () => {
  it('lists Documents and OneDrive folders that exist, plus the recent scans', async () => {
    const recent: RecentScans = { list: async () => ['D:\\Photos'], add: async () => undefined }
    const places = await listPlaces({
      documentsPath: () => 'C:\\Users\\Ana\\Documents',
      env: { OneDriveConsumer: 'C:\\Users\\Ana\\OneDrive', OneDrive: 'C:\\Users\\Ana\\Gone' },
      isDirectory: async (target) => !target.endsWith('Gone'),
      recent,
    })
    expect(places).toEqual({
      places: [
        { kind: 'documents', label: 'Documents', path: 'C:\\Users\\Ana\\Documents' },
        { kind: 'onedrive', label: 'OneDrive', path: 'C:\\Users\\Ana\\OneDrive' },
      ],
      recent: ['D:\\Photos'],
    })
  })

  it('leaves Documents out when Windows has none', async () => {
    const places = await listPlaces({
      documentsPath: () => null,
      env: {},
      isDirectory: async () => true,
      recent: { list: async () => [], add: async () => undefined },
    })
    expect(places).toEqual({ places: [], recent: [] })
  })
})

describe('recent scans', () => {
  it('starts empty and keeps the newest five, most recent first', async () => {
    const { recent } = memoryRecent()
    expect(await recent.list()).toEqual([])
    for (const target of ['A:\\', 'B:\\', 'C:\\', 'D:\\', 'E:\\', 'F:\\']) await recent.add(target)
    expect(await recent.list()).toEqual(['F:\\', 'E:\\', 'D:\\', 'C:\\', 'B:\\'])
  })

  it('moves a path scanned again to the top, whatever its letter case', async () => {
    const { recent } = memoryRecent(JSON.stringify(['D:\\Photos', 'C:\\Data']))
    await recent.add('c:\\data')
    expect(await recent.list()).toEqual(['c:\\data', 'D:\\Photos'])
  })

  it('applies adds in order', async () => {
    const { recent } = memoryRecent()
    await Promise.all([recent.add('C:\\One'), recent.add('C:\\Two')])
    expect(await recent.list()).toEqual(['C:\\Two', 'C:\\One'])
  })

  it('survives a missing or broken file', async () => {
    const recent = createRecentScans({
      file: FILE,
      readFile: async () => {
        throw new Error('ENOENT')
      },
      writeFile: async () => undefined,
    })
    expect(await recent.list()).toEqual([])
    expect(parseRecent('{not json')).toEqual([])
    expect(parseRecent('{"a":1}')).toEqual([])
    expect(parseRecent('["C:\\\\Ok", 5, "relative", "\\\\\\\\srv\\\\share"]')).toEqual(['C:\\Ok'])
  })
})
```

`src/main/places/places.ts`:

```ts
import path from 'node:path'
import { MAX_RECENT_SCANS, type Place, type Places } from '@shared/scan-types'

export const RECENT_SCANS_FILE = 'recent-scans.json'

export interface PlacesDeps {
  /** `app.getPath('documents')`; null when Windows has no Documents folder for this user. */
  documentsPath(): string | null
  env: Readonly<Record<string, string | undefined>>
  isDirectory(target: string): Promise<boolean>
  recent: RecentScans
}

/** `C:\…` only: the Select menu never offers network or relative paths. */
const LOCAL_ABSOLUTE = /^[A-Za-z]:\\/

/**
 * OneDrive folders from the environment variables the OneDrive client sets:
 * `OneDriveConsumer` (personal), `OneDriveCommercial` (work or school) and `OneDrive` (the
 * default one, usually equal to one of the others). The personal folder is labelled
 * "OneDrive"; a work folder keeps its own name, for example "OneDrive - Contoso".
 */
export function oneDriveFolders(env: Readonly<Record<string, string | undefined>>): Place[] {
  const found: Place[] = []
  const seen = new Set<string>()
  const add = (value: string | undefined, label: (folder: string) => string) => {
    if (value === undefined || !LOCAL_ABSOLUTE.test(value)) return
    const folder = path.win32.normalize(value)
    const key = folder.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    found.push({ kind: 'onedrive', label: label(folder), path: folder })
  }
  add(env['OneDriveConsumer'], () => 'OneDrive')
  add(env['OneDriveCommercial'], (folder) => path.win32.basename(folder))
  add(env['OneDrive'], (folder) => path.win32.basename(folder))
  return found
}

export async function listPlaces(deps: PlacesDeps): Promise<Places> {
  const candidates: Place[] = []
  const documents = deps.documentsPath()
  if (documents !== null && LOCAL_ABSOLUTE.test(documents)) {
    candidates.push({ kind: 'documents', label: 'Documents', path: documents })
  }
  candidates.push(...oneDriveFolders(deps.env))
  const exists = await Promise.all(candidates.map((place) => deps.isDirectory(place.path)))
  return {
    places: candidates.filter((_place, index) => exists[index] === true),
    recent: await deps.recent.list(),
  }
}

export interface RecentScansDeps {
  /** Full path of `recent-scans.json` in userData. */
  file: string
  readFile(file: string): Promise<string>
  writeFile(file: string, text: string): Promise<void>
}

export interface RecentScans {
  list(): Promise<string[]>
  /** Puts `target` first, removes an older copy (any letter case) and keeps the newest five. */
  add(target: string): Promise<void>
}

export function parseRecent(text: string): string[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  return data
    .filter((entry): entry is string => typeof entry === 'string' && LOCAL_ABSOLUTE.test(entry))
    .slice(0, MAX_RECENT_SCANS)
}

export function createRecentScans(deps: RecentScansDeps): RecentScans {
  /** Writes happen one at a time, in call order. */
  let queue: Promise<void> = Promise.resolve()
  const read = async () => parseRecent(await deps.readFile(deps.file).catch(() => '[]'))
  return {
    list: async () => {
      await queue
      return read()
    },
    add(target) {
      queue = queue.then(async () => {
        const current = await read()
        const key = target.toLowerCase()
        const next = [target, ...current.filter((entry) => entry.toLowerCase() !== key)].slice(
          0,
          MAX_RECENT_SCANS,
        )
        await deps.writeFile(deps.file, JSON.stringify(next)).catch(() => undefined)
      })
      return queue
    },
  }
}
```

- [ ] **Step 9: Menu ids and new-folder naming (pure; used by `folder:create` now and by the menu in Task 7)**

`src/main/shell-menu/menu-commands.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  classifyCommand,
  nextNewFolderName,
  plainMenuLabel,
  SHELL_FIRST_ID,
  SHELL_LAST_ID,
  STORAGEIQ_COMMAND_IDS,
  STORAGEIQ_MENU_LABELS,
  verbChangesFileSystem,
} from './menu-commands'

describe('classifyCommand', () => {
  it('maps StorageIQ’s ids to its items', () => {
    expect(classifyCommand(STORAGEIQ_COMMAND_IDS.refresh)).toEqual({
      kind: 'storageiq',
      item: 'refresh',
    })
    expect(classifyCommand(2)).toEqual({ kind: 'storageiq', item: 'copy-path' })
    expect(classifyCommand(3)).toEqual({ kind: 'storageiq', item: 'open' })
    expect(classifyCommand(4)).toEqual({ kind: 'storageiq', item: 'new-folder' })
  })

  it('maps the shell’s id range to an offset from its first id', () => {
    expect(classifyCommand(SHELL_FIRST_ID)).toEqual({ kind: 'shell', offset: 0 })
    expect(classifyCommand(SHELL_FIRST_ID + 17)).toEqual({ kind: 'shell', offset: 17 })
    expect(classifyCommand(SHELL_LAST_ID)).toEqual({
      kind: 'shell',
      offset: SHELL_LAST_ID - SHELL_FIRST_ID,
    })
  })

  it.each([0, -1, 5, SHELL_FIRST_ID - 1, SHELL_LAST_ID + 1, 1.5])(
    'treats %d as no choice',
    (id) => {
      expect(classifyCommand(id)).toEqual({ kind: 'none' })
    },
  )

  it('keeps StorageIQ’s ids below the shell range', () => {
    for (const id of Object.values(STORAGEIQ_COMMAND_IDS)) expect(id).toBeLessThan(SHELL_FIRST_ID)
  })
})

describe('plainMenuLabel', () => {
  it('drops access keys and shortcut text', () => {
    expect(plainMenuLabel(STORAGEIQ_MENU_LABELS['new-folder'])).toBe('New folder')
    expect(plainMenuLabel('P&roperties')).toBe('Properties')
    expect(plainMenuLabel('Copy &as path')).toBe('Copy as path')
    expect(plainMenuLabel('Fish && chips')).toBe('Fish & chips')
  })
})

describe('verbChangesFileSystem', () => {
  it.each(['delete', 'cut', 'rename', 'paste', 'undelete', 'link', 'Some3rdParty'])(
    '%s may change files',
    (verb) => {
      expect(verbChangesFileSystem(verb)).toBe(true)
    },
  )

  it('treats a command without a verb as a change', () => {
    expect(verbChangesFileSystem(null)).toBe(true)
  })

  it.each(['open', 'Properties', 'copy', 'copyaspath', 'pintohome', 'explore', 'runas'])(
    '%s only reads',
    (verb) => {
      expect(verbChangesFileSystem(verb)).toBe(false)
    },
  )
})

describe('nextNewFolderName', () => {
  it('follows Windows’ numbering and ignores letter case', () => {
    expect(nextNewFolderName([])).toBe('New folder')
    expect(nextNewFolderName(['a.txt'])).toBe('New folder')
    expect(nextNewFolderName(['new FOLDER'])).toBe('New folder (2)')
    expect(nextNewFolderName(['New folder', 'New folder (2)', 'New folder (4)'])).toBe(
      'New folder (3)',
    )
  })
})
```

`src/main/shell-menu/menu-commands.ts`:

```ts
/** StorageIQ's own items at the top of the Explorer context menu. */
export type StorageIQMenuItem = 'refresh' | 'copy-path' | 'open' | 'new-folder'

/** Command ids of StorageIQ's items. The shell's items start at `SHELL_FIRST_ID`. */
export const STORAGEIQ_COMMAND_IDS: Readonly<Record<StorageIQMenuItem, number>> = {
  refresh: 1,
  'copy-path': 2,
  open: 3,
  'new-folder': 4,
}

/** `IContextMenu::QueryContextMenu` gets ids from here to `SHELL_LAST_ID`. */
export const SHELL_FIRST_ID = 0x100
export const SHELL_LAST_ID = 0x7fff

/** Labels of StorageIQ's items (`&` marks the access key; `\t` starts the shortcut text). */
export const STORAGEIQ_MENU_LABELS = {
  submenu: '&StorageIQ',
  refresh: '&Refresh this folder',
  'copy-path': '&Copy path',
  open: '&Open in Explorer',
  'new-folder': 'New &folder\tCtrl+N',
} as const

/** What `TrackPopupMenuEx` returned, in StorageIQ's terms. */
export type MenuCommand =
  | { kind: 'none' }
  | { kind: 'storageiq'; item: StorageIQMenuItem }
  | { kind: 'shell'; offset: number }

export function classifyCommand(id: number): MenuCommand {
  if (!Number.isInteger(id) || id <= 0) return { kind: 'none' }
  if (id >= SHELL_FIRST_ID && id <= SHELL_LAST_ID)
    return { kind: 'shell', offset: id - SHELL_FIRST_ID }
  const entry = Object.entries(STORAGEIQ_COMMAND_IDS).find(([, value]) => value === id)
  return entry === undefined
    ? { kind: 'none' }
    : { kind: 'storageiq', item: entry[0] as StorageIQMenuItem }
}

/** Menu text without access-key markers and shortcut text: `New &folder\tCtrl+N` → `New folder`. */
export function plainMenuLabel(label: string): string {
  const [text = ''] = label.split('\t')
  return text.replace(/&(.)/g, '$1').trim()
}

/**
 * Shell verbs that only read, open or show something. Anything else (delete, cut, paste,
 * rename, restore previous versions, third-party commands, or a command with no verb) may
 * change the folder, so StorageIQ rescans it afterwards.
 */
export const READ_ONLY_VERBS: ReadonlySet<string> = new Set([
  'open',
  'opennewwindow',
  'opennewprocess',
  'opennewtab',
  'explore',
  'find',
  'properties',
  'copy',
  'copyaspath',
  'pintohome',
  'pintostartscreen',
  'runas',
  'openas',
  'print',
  'edit',
  'play',
  'enqueue',
  'preview',
  'sharing',
  'windows.share',
])

export function verbChangesFileSystem(verb: string | null): boolean {
  return verb === null || !READ_ONLY_VERBS.has(verb.toLowerCase())
}

/** Windows' naming for a new folder: "New folder", then "New folder (2)", "New folder (3)", … */
export function nextNewFolderName(existing: readonly string[]): string {
  const taken = new Set(existing.map((name) => name.toLowerCase()))
  const base = 'New folder'
  if (!taken.has(base.toLowerCase())) return base
  for (let n = 2; ; n += 1) {
    const candidate = `${base} (${n})`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}
```

- [ ] **Step 10: Handlers**

`src/main/ipc/test/fake-tree-service.ts`:

```ts
import { vi } from 'vitest'
import type { ScannerQuery } from '@shared/scanner-protocol'
import type { TreeNodeDetails, TreeRow, TreeTotals } from '@shared/tree-types'
import type { TreeScanService } from '../tree-handlers'

export const SCAN = '0d6b2f6e-8a3c-4c1e-9f61-2b8f6a1d5e10'
export const TOTALS: TreeTotals = { files: 3, folders: 1, bytes: 300, allocatedBytes: 12_288 }

export function row(overrides: Partial<TreeRow> = {}): TreeRow {
  return {
    id: 'd1',
    parentId: 'd0',
    kind: 'folder',
    name: 'Photos',
    size: 300,
    allocated: 8192,
    files: 2,
    folders: 0,
    modifiedMs: 0,
    childCount: 1,
    ...overrides,
  }
}

/** Nodes of a tiny scan of `D:\Data`: the root, Photos (d1), its "[N files]" (g1) and a file. */
export const NODES: Record<string, TreeNodeDetails> = {
  d0: {
    row: row({ id: 'd0', parentId: null, name: 'D:\\Data' }),
    path: 'D:\\Data',
    ancestorIds: [],
    locations: [],
  },
  d1: {
    row: row(),
    path: 'D:\\Data\\Photos',
    ancestorIds: ['d0'],
    locations: [{ parentId: 'd0', index: 0 }],
  },
  g1: {
    row: row({ id: 'g1', parentId: 'd1', kind: 'files', name: '' }),
    path: 'D:\\Data\\Photos',
    ancestorIds: ['d0', 'd1'],
    locations: [],
  },
  f7: {
    row: row({ id: 'f7', parentId: 'g1', kind: 'file', name: 'a.jpg', files: 1, childCount: 0 }),
    path: 'D:\\Data\\Photos\\a.jpg',
    ancestorIds: ['d0', 'd1', 'g1'],
    locations: [],
  },
}

/** A scan service whose scanner answers from `NODES`. */
export function fakeTreeService(options: { scanning?: boolean; current?: string | null } = {}) {
  const queries: ScannerQuery[] = []
  const service: TreeScanService = {
    currentScan: () =>
      options.current === null ? null : { scanId: options.current ?? SCAN, root: 'D:\\Data' },
    isScanning: () => options.scanning ?? false,
    query: vi.fn(async (query: ScannerQuery) => {
      queries.push(query)
      switch (query.kind) {
        case 'node':
        case 'refresh':
          return NODES[query.nodeId] ?? null
        case 'totals':
          return TOTALS
        case 'expand':
          return ['d0']
        default:
          return null
      }
    }) as TreeScanService['query'],
  }
  return { service, queries }
}
```

`src/main/ipc/tree-handlers.test.ts`:

```ts
import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import { InvalidIpcArgumentsError } from './parse-args'
import type { SendEvent } from './send-event'
import { fakeTreeService, NODES, SCAN, TOTALS } from './test/fake-tree-service'
import {
  createFolderRefresher,
  createTreeHandlers,
  folderIdOf,
  NOT_IN_SCAN_MESSAGE,
  resolveScanNode,
  SCAN_RUNNING_MESSAGE,
} from './tree-handlers'

const event = {} as IpcMainInvokeEvent

function setup(options: Parameters<typeof fakeTreeService>[0] = {}) {
  const fake = fakeTreeService(options)
  const events: Array<[string, unknown]> = []
  const sendEvent: SendEvent = (channel, payload) => {
    events.push([channel, payload])
  }
  const refreshFolder = createFolderRefresher(fake.service, sendEvent)
  const handlers = createTreeHandlers({ scanService: fake.service, refreshFolder })
  return { ...fake, events, handlers, refreshFolder }
}

describe('tree query handlers', () => {
  it('validate their arguments before asking the scanner', () => {
    const { handlers } = setup()
    expect(() =>
      handlers['tree:children'].parseArgs([SCAN, 'd0', 'size', 'desc', 0, 5000]),
    ).toThrow(InvalidIpcArgumentsError)
    expect(() => handlers['tree:node'].parseArgs([SCAN, '../etc'])).toThrow(
      InvalidIpcArgumentsError,
    )
    expect(() => handlers['treemap:layout'].parseArgs([SCAN, 'd0', 'size', 9, 1, 1])).toThrow(
      InvalidIpcArgumentsError,
    )
    expect(() => handlers['tree:expand-ids'].parseArgs([SCAN, 'd0'])).toThrow(
      InvalidIpcArgumentsError,
    )
  })

  it('forward each query to the scanner unchanged', async () => {
    const { handlers, queries } = setup()
    await handlers['tree:children'].handle(event, SCAN, 'd0', 'name', 'asc', 10, 20)
    await handlers['tree:node'].handle(event, SCAN, 'd1', 'size', 'desc')
    await handlers['tree:expand-ids'].handle(event, SCAN, 'd0', 3)
    await handlers['treemap:layout'].handle(event, SCAN, 'd0', 'files', 2, 640, 200)
    expect(queries).toEqual([
      {
        kind: 'children',
        scanId: SCAN,
        nodeId: 'd0',
        sortKey: 'name',
        sortDir: 'asc',
        offset: 10,
        limit: 20,
      },
      { kind: 'node', scanId: SCAN, nodeId: 'd1', sortKey: 'size', sortDir: 'desc' },
      { kind: 'expand', scanId: SCAN, nodeId: 'd0', levels: 3 },
      {
        kind: 'treemap',
        scanId: SCAN,
        nodeId: 'd0',
        mode: 'files',
        depth: 2,
        width: 640,
        height: 200,
      },
    ])
  })
})

describe('tree:refresh', () => {
  it('rescans the folder and sends tree:changed with the new totals', async () => {
    const { handlers, events } = setup()
    await expect(
      Promise.resolve(handlers['tree:refresh'].handle(event, SCAN, 'd1')),
    ).resolves.toEqual(NODES['d1'])
    expect(events).toEqual([['tree:changed', { scanId: SCAN, nodeId: 'd1', totals: TOTALS }]])
  })

  it('refuses while the scan runs and for another scan', async () => {
    await expect(setup({ scanning: true }).refreshFolder(SCAN, 'd1')).rejects.toThrow(
      SCAN_RUNNING_MESSAGE,
    )
    await expect(setup({ current: 'other' }).refreshFolder(SCAN, 'd1')).rejects.toThrow(
      NOT_IN_SCAN_MESSAGE,
    )
  })
})

describe('resolveScanNode', () => {
  it('returns the node of the current scan', async () => {
    const { service } = setup()
    await expect(resolveScanNode(service, SCAN, 'f7')).resolves.toEqual(NODES['f7'])
  })

  it('refuses another scan, no scan, and a node the scanner does not know', async () => {
    await expect(resolveScanNode(setup().service, 'other', 'd1')).rejects.toThrow(
      NOT_IN_SCAN_MESSAGE,
    )
    await expect(resolveScanNode(setup({ current: null }).service, SCAN, 'd1')).rejects.toThrow(
      NOT_IN_SCAN_MESSAGE,
    )
    await expect(resolveScanNode(setup().service, SCAN, 'd99')).rejects.toThrow(NOT_IN_SCAN_MESSAGE)
  })
})

describe('folderIdOf', () => {
  it('maps folders, "[N files]" rows and files to their folder', () => {
    expect(folderIdOf(NODES['d1']!)).toBe('d1')
    expect(folderIdOf(NODES['g1']!)).toBe('d1')
    expect(folderIdOf(NODES['f7']!)).toBe('d1')
  })
})

describe('createFolderRefresher', () => {
  it('sends nothing when the folder no longer exists', async () => {
    const { refreshFolder, events } = setup()
    await expect(refreshFolder(SCAN, 'd99')).resolves.toBeNull()
    expect(events).toEqual([])
  })
})
```

`src/main/ipc/tree-handlers.ts`:

```ts
import type { NodeId, TreeNodeDetails } from '@shared/tree-types'
import type { ScanService } from '../scan/scan-service'
import { childrenArgs, expandArgs, nodeArgs, scanNodeArgs, treemapArgs } from './parse-args'
import type { IpcHandlerMap } from './register'
import type { SendEvent } from './send-event'

export type TreeHandlers = Pick<
  IpcHandlerMap,
  'tree:children' | 'tree:node' | 'tree:expand-ids' | 'tree:refresh' | 'treemap:layout'
>

export const NOT_IN_SCAN_MESSAGE = 'That item is not part of the current scan.'
export const SCAN_RUNNING_MESSAGE = 'Wait for the scan to finish, then try again.'

export type TreeScanService = Pick<ScanService, 'query' | 'currentScan' | 'isScanning'>

/**
 * Looks a node up in the current scan. Used before any action that touches the disk or the
 * clipboard: the path must come from the scanner's tree, never from the renderer.
 */
export async function resolveScanNode(
  scanService: TreeScanService,
  scanId: string,
  nodeId: NodeId,
): Promise<TreeNodeDetails> {
  if (scanService.currentScan()?.scanId !== scanId) throw new Error(NOT_IN_SCAN_MESSAGE)
  const details = await scanService.query({
    kind: 'node',
    scanId,
    nodeId,
    sortKey: 'size',
    sortDir: 'desc',
  })
  if (details === null) throw new Error(NOT_IN_SCAN_MESSAGE)
  return details
}

/** The folder a row belongs to: a folder itself, the folder of "[N files]", a file's folder. */
export function folderIdOf(details: TreeNodeDetails): NodeId {
  const { row } = details
  if (row.kind === 'folder') return row.id
  if (row.kind === 'files') return `d${row.id.slice(1)}`
  const group = row.parentId ?? 'g0'
  return `d${group.slice(1)}`
}

export type RefreshFolder = (scanId: string, nodeId: NodeId) => Promise<TreeNodeDetails | null>

/** Rescans a folder in the scanner, then tells the renderer with `tree:changed`. */
export function createFolderRefresher(
  scanService: TreeScanService,
  sendEvent: SendEvent,
): RefreshFolder {
  return async (scanId, nodeId) => {
    if (scanService.currentScan()?.scanId !== scanId) throw new Error(NOT_IN_SCAN_MESSAGE)
    if (scanService.isScanning()) throw new Error(SCAN_RUNNING_MESSAGE)
    const details = await scanService.query({ kind: 'refresh', scanId, nodeId })
    if (details === null) return null
    const totals = await scanService.query({ kind: 'totals', scanId })
    if (totals !== null) sendEvent('tree:changed', { scanId, nodeId: details.row.id, totals })
    return details
  }
}

export function createTreeHandlers(deps: {
  scanService: TreeScanService
  refreshFolder: RefreshFolder
}): TreeHandlers {
  const { scanService } = deps
  return {
    'tree:children': {
      parseArgs: childrenArgs,
      handle: (_event, scanId, nodeId, sortKey, sortDir, offset, limit) =>
        scanService.query({ kind: 'children', scanId, nodeId, sortKey, sortDir, offset, limit }),
    },
    'tree:node': {
      parseArgs: nodeArgs,
      handle: (_event, scanId, nodeId, sortKey, sortDir) =>
        scanService.query({ kind: 'node', scanId, nodeId, sortKey, sortDir }),
    },
    'tree:expand-ids': {
      parseArgs: expandArgs,
      handle: (_event, scanId, nodeId, levels) =>
        scanService.query({ kind: 'expand', scanId, nodeId, levels }),
    },
    'tree:refresh': {
      parseArgs: scanNodeArgs,
      handle: (_event, scanId, nodeId) => deps.refreshFolder(scanId, nodeId),
    },
    'treemap:layout': {
      parseArgs: treemapArgs,
      handle: (_event, scanId, nodeId, mode, depth, width, height) =>
        scanService.query({ kind: 'treemap', scanId, nodeId, mode, depth, width, height }),
    },
  }
}
```

`src/main/ipc/shell-handlers.test.ts`:

```ts
import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { ShellMenuChoice } from '../shell-menu/context-menu'
import { InvalidIpcArgumentsError } from './parse-args'
import {
  createShellHandlers,
  SECOND_REFRESH_DELAY_MS,
  type ShellHandlerDeps,
} from './shell-handlers'
import { fakeTreeService, NODES, SCAN } from './test/fake-tree-service'
import { NOT_IN_SCAN_MESSAGE, SCAN_RUNNING_MESSAGE } from './tree-handlers'

const event = {} as IpcMainInvokeEvent

function setup(
  options: { choice?: ShellMenuChoice; scanning?: boolean; existing?: string[] } = {},
) {
  const fake = fakeTreeService({ scanning: options.scanning ?? false })
  const timers: Array<{ callback: () => void; ms: number }> = []
  const deps: ShellHandlerDeps = {
    scanService: fake.service,
    refreshFolder: vi.fn(async (_scanId: string, nodeId: string) => NODES[nodeId] ?? null),
    openPath: vi.fn(async () => ''),
    showItemInFolder: vi.fn(),
    writeClipboard: vi.fn(),
    readdir: vi.fn(async () => options.existing ?? ['a.jpg']),
    mkdir: vi.fn(async () => undefined),
    showShellMenu: vi.fn(
      async (): Promise<ShellMenuChoice> => options.choice ?? { kind: 'dismissed' },
    ),
    later: (callback, ms) => {
      timers.push({ callback, ms })
    },
  }
  return { deps, timers, handlers: createShellHandlers(deps) }
}

describe('shell:open-in-explorer', () => {
  it('opens a folder, and shows a file selected in its folder', async () => {
    const { handlers, deps } = setup()
    await handlers['shell:open-in-explorer'].handle(event, SCAN, 'd1')
    expect(deps.openPath).toHaveBeenCalledWith('D:\\Data\\Photos')
    await handlers['shell:open-in-explorer'].handle(event, SCAN, 'f7')
    expect(deps.showItemInFolder).toHaveBeenCalledWith('D:\\Data\\Photos\\a.jpg')
  })

  it('only opens paths of the current scan', async () => {
    const { handlers, deps } = setup()
    await expect(
      Promise.resolve().then(() => handlers['shell:open-in-explorer'].handle(event, 'other', 'd1')),
    ).rejects.toThrow(NOT_IN_SCAN_MESSAGE)
    expect(() => handlers['shell:open-in-explorer'].parseArgs([SCAN, 'C:\\Windows'])).toThrow(
      InvalidIpcArgumentsError,
    )
    expect(deps.openPath).not.toHaveBeenCalled()
  })

  it('reports Explorer’s error', async () => {
    const { handlers, deps } = setup()
    vi.mocked(deps.openPath).mockResolvedValue('Access is denied.')
    await expect(
      Promise.resolve().then(() => handlers['shell:open-in-explorer'].handle(event, SCAN, 'd1')),
    ).rejects.toThrow('Access is denied.')
  })
})

describe('shell:context-menu', () => {
  it('shows the menu for the node’s own path at the given window point', async () => {
    const { handlers, deps } = setup()
    await expect(
      Promise.resolve(handlers['shell:context-menu'].handle(event, SCAN, 'f7', 40, 90, true)),
    ).resolves.toEqual({ kind: 'dismissed' })
    expect(deps.showShellMenu).toHaveBeenCalledWith('D:\\Data\\Photos\\a.jpg', 40, 90, true)
  })

  it('runs StorageIQ’s items', async () => {
    let t = setup({ choice: { kind: 'storageiq', item: 'copy-path' } })
    await expect(
      t.handlers['shell:context-menu'].handle(event, SCAN, 'f7', 0, 0, false),
    ).resolves.toEqual({
      kind: 'copied',
    })
    expect(t.deps.writeClipboard).toHaveBeenCalledWith('D:\\Data\\Photos\\a.jpg')

    t = setup({ choice: { kind: 'storageiq', item: 'refresh' } })
    await expect(
      t.handlers['shell:context-menu'].handle(event, SCAN, 'f7', 0, 0, false),
    ).resolves.toEqual({
      kind: 'refreshed',
      nodeId: 'd1',
    })
    expect(t.deps.refreshFolder).toHaveBeenCalledWith(SCAN, 'd1')

    t = setup({ choice: { kind: 'storageiq', item: 'open' } })
    await expect(
      t.handlers['shell:context-menu'].handle(event, SCAN, 'd1', 0, 0, false),
    ).resolves.toEqual({
      kind: 'opened',
    })
    expect(t.deps.openPath).toHaveBeenCalledWith('D:\\Data\\Photos')

    t = setup({ choice: { kind: 'storageiq', item: 'new-folder' }, existing: ['New folder'] })
    await expect(
      t.handlers['shell:context-menu'].handle(event, SCAN, 'd1', 0, 0, false),
    ).resolves.toEqual({
      kind: 'created',
      nodeId: 'd1',
      name: 'New folder (2)',
    })
    expect(t.deps.mkdir).toHaveBeenCalledWith('D:\\Data\\Photos\\New folder (2)')
  })

  it('rescans the parent folder now and again shortly after a shell command that changes files', async () => {
    const { handlers, deps, timers } = setup({
      choice: { kind: 'shell', verb: 'delete', changed: true },
    })
    await expect(
      Promise.resolve(handlers['shell:context-menu'].handle(event, SCAN, 'd1', 0, 0, false)),
    ).resolves.toEqual({ kind: 'shell', verb: 'delete', changed: true })
    expect(deps.refreshFolder).toHaveBeenCalledWith(SCAN, 'd0')
    expect(timers.map((timer) => timer.ms)).toEqual([SECOND_REFRESH_DELAY_MS])
    timers[0]?.callback()
    expect(deps.refreshFolder).toHaveBeenCalledTimes(2)
  })

  it('rescans a file’s own folder after a change, and nothing after a read-only verb', async () => {
    let t = setup({ choice: { kind: 'shell', verb: null, changed: true } })
    await t.handlers['shell:context-menu'].handle(event, SCAN, 'f7', 0, 0, false)
    expect(t.deps.refreshFolder).toHaveBeenCalledWith(SCAN, 'd1')

    t = setup({ choice: { kind: 'shell', verb: 'properties', changed: false } })
    await t.handlers['shell:context-menu'].handle(event, SCAN, 'f7', 0, 0, false)
    expect(t.deps.refreshFolder).not.toHaveBeenCalled()
    expect(t.timers).toEqual([])
  })
})

describe('folder:create', () => {
  it('creates "New folder" in a folder, or in a file’s folder', async () => {
    const { handlers, deps } = setup()
    await expect(
      Promise.resolve(handlers['folder:create'].handle(event, SCAN, 'f7')),
    ).resolves.toEqual({
      parentId: 'd1',
      name: 'New folder',
    })
    expect(deps.readdir).toHaveBeenCalledWith('D:\\Data\\Photos')
    expect(deps.mkdir).toHaveBeenCalledWith('D:\\Data\\Photos\\New folder')
    expect(deps.refreshFolder).toHaveBeenCalledWith(SCAN, 'd1')
  })

  it('waits for the scan to finish', async () => {
    const { handlers, deps } = setup({ scanning: true })
    await expect(
      Promise.resolve().then(() => handlers['folder:create'].handle(event, SCAN, 'd1')),
    ).rejects.toThrow(SCAN_RUNNING_MESSAGE)
    expect(deps.mkdir).not.toHaveBeenCalled()
  })
})

describe('clipboard:write-text', () => {
  it('writes the text through main’s clipboard', () => {
    const { handlers, deps } = setup()
    handlers['clipboard:write-text'].handle(event, 'D:\\Data')
    expect(deps.writeClipboard).toHaveBeenCalledWith('D:\\Data')
    expect(() => handlers['clipboard:write-text'].parseArgs([{}])).toThrow(InvalidIpcArgumentsError)
  })
})
```

`src/main/ipc/shell-handlers.ts`:

```ts
import path from 'node:path'
import type { ContextMenuOutcome, CreateFolderResult } from '@shared/ipc-contract'
import type { NodeId, TreeNodeDetails } from '@shared/tree-types'
import type { ShellMenuChoice } from '../shell-menu/context-menu'
import { nextNewFolderName } from '../shell-menu/menu-commands'
import { clipboardArgs, contextMenuArgs, scanNodeArgs } from './parse-args'
import type { IpcHandlerMap } from './register'
import {
  folderIdOf,
  type RefreshFolder,
  resolveScanNode,
  SCAN_RUNNING_MESSAGE,
  type TreeScanService,
} from './tree-handlers'

export type ShellHandlers = Pick<
  IpcHandlerMap,
  'shell:open-in-explorer' | 'shell:context-menu' | 'folder:create' | 'clipboard:write-text'
>

/** A shell command may finish after InvokeCommand returns (a delete with a progress dialog). */
export const SECOND_REFRESH_DELAY_MS = 1500

export interface ShellHandlerDeps {
  scanService: TreeScanService
  refreshFolder: RefreshFolder
  /** `shell.openPath`: resolves with an error message, or `''` on success. */
  openPath(target: string): Promise<string>
  /** `shell.showItemInFolder`. */
  showItemInFolder(target: string): void
  /** `clipboard.writeText`. */
  writeClipboard(text: string): void
  readdir(folder: string): Promise<string[]>
  mkdir(folder: string): Promise<void>
  /** Shows the native Explorer menu at window CSS pixel `x`, `y` and runs the shell choice. */
  showShellMenu(target: string, x: number, y: number, extended: boolean): Promise<ShellMenuChoice>
  /** `setTimeout`, injectable for tests. */
  later(callback: () => void, ms: number): void
}

export function createShellHandlers(deps: ShellHandlerDeps): ShellHandlers {
  const { scanService } = deps

  const openInExplorer = async (details: TreeNodeDetails): Promise<void> => {
    if (details.row.kind === 'file') {
      deps.showItemInFolder(details.path)
      return
    }
    const problem = await deps.openPath(details.path)
    if (problem !== '') throw new Error(problem)
  }

  const createFolder = async (
    scanId: string,
    details: TreeNodeDetails,
  ): Promise<CreateFolderResult> => {
    if (scanService.isScanning()) throw new Error(SCAN_RUNNING_MESSAGE)
    const parentId = folderIdOf(details)
    const folderPath = details.row.kind === 'file' ? path.win32.dirname(details.path) : details.path
    const name = nextNewFolderName(await deps.readdir(folderPath))
    await deps.mkdir(path.win32.join(folderPath, name))
    await deps.refreshFolder(scanId, parentId)
    return { parentId, name }
  }

  /** After a shell command that may change the disk: rescan the item's folder, twice. */
  const refreshAfterShell = (scanId: string, details: TreeNodeDetails): void => {
    const target: NodeId =
      details.row.kind === 'folder'
        ? (details.ancestorIds.at(-1) ?? details.row.id)
        : folderIdOf(details)
    const refresh = () => {
      deps.refreshFolder(scanId, target).catch(() => undefined)
    }
    refresh()
    deps.later(refresh, SECOND_REFRESH_DELAY_MS)
  }

  return {
    'shell:open-in-explorer': {
      parseArgs: scanNodeArgs,
      handle: async (_event, scanId, nodeId) => {
        await openInExplorer(await resolveScanNode(scanService, scanId, nodeId))
      },
    },

    'shell:context-menu': {
      parseArgs: contextMenuArgs,
      handle: async (_event, scanId, nodeId, x, y, extended): Promise<ContextMenuOutcome> => {
        const details = await resolveScanNode(scanService, scanId, nodeId)
        const choice = await deps.showShellMenu(details.path, x, y, extended)
        if (choice.kind === 'dismissed') return { kind: 'dismissed' }
        if (choice.kind === 'shell') {
          if (choice.changed) refreshAfterShell(scanId, details)
          return { kind: 'shell', verb: choice.verb, changed: choice.changed }
        }
        switch (choice.item) {
          case 'refresh': {
            const refreshed = await deps.refreshFolder(scanId, folderIdOf(details))
            return { kind: 'refreshed', nodeId: refreshed?.row.id ?? folderIdOf(details) }
          }
          case 'copy-path':
            deps.writeClipboard(details.path)
            return { kind: 'copied' }
          case 'open':
            await openInExplorer(details)
            return { kind: 'opened' }
          case 'new-folder': {
            const created = await createFolder(scanId, details)
            return { kind: 'created', nodeId: created.parentId, name: created.name }
          }
        }
      },
    },

    'folder:create': {
      parseArgs: scanNodeArgs,
      handle: async (_event, scanId, nodeId) =>
        createFolder(scanId, await resolveScanNode(scanService, scanId, nodeId)),
    },

    'clipboard:write-text': {
      parseArgs: clipboardArgs,
      handle: (_event, text) => {
        deps.writeClipboard(text)
      },
    },
  }
}
```

`src/main/ipc/drive-handlers.test.ts`:

```ts
import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { DriveDetails, DriveInfo, Places } from '@shared/scan-types'
import { createDriveHandlers, type DriveHandlerDeps } from './drive-handlers'
import { InvalidIpcArgumentsError } from './parse-args'

const event = {} as IpcMainInvokeEvent
const drives: DriveInfo[] = [
  { root: 'C:\\', label: 'Local Disk', kind: 'fixed', totalBytes: 100, freeBytes: 40 },
]
const details: DriveDetails = {
  root: 'C:\\',
  totalBytes: 100,
  freeBytes: 40,
  clusterBytes: 4096,
  fileSystem: 'NTFS',
}
const places: Places = {
  places: [{ kind: 'documents', label: 'Documents', path: 'C:\\Users\\Ana\\Documents' }],
  recent: ['D:\\Photos'],
}

function setup() {
  const deps: DriveHandlerDeps = {
    listDrives: vi.fn(async () => drives),
    driveDetails: vi.fn(async () => details),
    listPlaces: vi.fn(async () => places),
  }
  return { deps, handlers: createDriveHandlers(deps) }
}

describe('drives:list', () => {
  it('returns the listed drives and takes no arguments', async () => {
    const { handlers } = setup()
    await expect(Promise.resolve(handlers['drives:list'].handle(event))).resolves.toEqual(drives)
    expect(() => handlers['drives:list'].parseArgs(['C:\\'])).toThrow(InvalidIpcArgumentsError)
  })
})

describe('drive:info', () => {
  it.each([
    ['C:\\', 'C:\\'],
    ['c:', 'C:\\'],
    ['d:\\', 'D:\\'],
  ])('accepts the drive root %j', (input, root) => {
    const { handlers } = setup()
    expect(handlers['drive:info'].parseArgs([input])).toEqual([root])
  })

  it.each([[[]], [['C:\\Windows']], [['\\\\server\\share']], [[3]], [['C:\\', 'D:\\']]])(
    'rejects %j',
    (args) => {
      const { handlers } = setup()
      expect(() => handlers['drive:info'].parseArgs(args)).toThrow(InvalidIpcArgumentsError)
    },
  )

  it('returns space, cluster size and file system', async () => {
    const { handlers, deps } = setup()
    await expect(Promise.resolve(handlers['drive:info'].handle(event, 'C:\\'))).resolves.toEqual(
      details,
    )
    expect(deps.driveDetails).toHaveBeenCalledWith('C:\\')
  })
})

describe('places:list', () => {
  it('returns the places and takes no arguments', async () => {
    const { handlers } = setup()
    await expect(Promise.resolve(handlers['places:list'].handle(event))).resolves.toEqual(places)
    expect(() => handlers['places:list'].parseArgs([1])).toThrow(InvalidIpcArgumentsError)
  })
})
```

`src/main/ipc/drive-handlers.ts`:

```ts
import type { DriveDetails, DriveInfo, Places } from '@shared/scan-types'
import { driveRootArgs, noArgs } from './parse-args'
import type { IpcHandlerMap } from './register'

export type DriveHandlers = Pick<IpcHandlerMap, 'drives:list' | 'drive:info' | 'places:list'>

export interface DriveHandlerDeps {
  listDrives(): Promise<DriveInfo[]>
  driveDetails(root: string): Promise<DriveDetails | null>
  listPlaces(): Promise<Places>
}

export function createDriveHandlers(deps: DriveHandlerDeps): DriveHandlers {
  return {
    'drives:list': { parseArgs: noArgs, handle: () => deps.listDrives() },
    'drive:info': { parseArgs: driveRootArgs, handle: (_event, root) => deps.driveDetails(root) },
    'places:list': { parseArgs: noArgs, handle: () => deps.listPlaces() },
  }
}
```

`src/main/ipc/scan-handlers.test.ts`:

```ts
import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { ScanVolume } from '@shared/scanner-protocol'
import { InvalidIpcArgumentsError } from './parse-args'
import { createScanHandlers } from './scan-handlers'

const event = {} as IpcMainInvokeEvent
const VOLUME: ScanVolume = { clusterBytes: 8192, freeBytes: null }

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
  const volumeFor = vi.fn(async () => VOLUME)
  const addRecent = vi.fn(async () => undefined)
  return {
    handlers: createScanHandlers({ scanService: { start, cancel }, stat, volumeFor, addRecent }),
    start,
    cancel,
    volumeFor,
    addRecent,
  }
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

  it('starts the scan with the drive’s cluster size and remembers the path', async () => {
    const { handlers, start, volumeFor, addRecent } = setup()
    await expect(
      Promise.resolve(handlers['scan:start'].handle(event, 'D:\\Photos')),
    ).resolves.toEqual({ scanId: 'scan-1' })
    expect(volumeFor).toHaveBeenCalledWith('D:\\Photos')
    expect(start).toHaveBeenCalledWith('D:\\Photos', VOLUME)
    expect(addRecent).toHaveBeenCalledWith('D:\\Photos')
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

`src/main/ipc/scan-handlers.ts`:

```ts
import path from 'node:path'
import type { ScanVolume } from '@shared/scanner-protocol'
import type { ScanService } from '../scan/scan-service'
import { InvalidIpcArgumentsError, oneString } from './parse-args'
import type { IpcHandlerMap } from './register'

export interface ScanHandlerDeps {
  scanService: Pick<ScanService, 'start' | 'cancel'>
  stat(path: string): Promise<{ isDirectory(): boolean }>
  /** Cluster size and free space for the drive holding `root` (koffi), with safe fallbacks. */
  volumeFor(root: string): Promise<ScanVolume>
  /** Remembers `root` in the "Recently scanned" list. Never throws. */
  addRecent(root: string): Promise<void>
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
      handle: async (_event, root) => {
        const volume = await deps.volumeFor(root)
        const started = deps.scanService.start(root, volume)
        void deps.addRecent(root)
        return started
      },
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

`src/main/ipc/app-handlers.test.ts`:

```ts
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { type AppHandlerDeps, createAppHandlers } from './app-handlers'
import { InvalidIpcArgumentsError } from './parse-args'

const event = {} as IpcMainInvokeEvent
const fakeWindow = {} as BrowserWindow

function setup(overrides: Partial<AppHandlerDeps> = {}) {
  const showOpenDialog = vi.fn<AppHandlerDeps['dialog']['showOpenDialog']>()
  const quit = vi.fn()
  const deps: AppHandlerDeps = {
    app: { getName: () => 'StorageIQ', getVersion: () => '0.1.0', quit },
    dialog: { showOpenDialog },
    getMainWindow: () => fakeWindow,
    runtime: { platform: 'win32', arch: 'x64', electronVersion: '38.0.0' },
    ...overrides,
  }
  return { handlers: createAppHandlers(deps), showOpenDialog, quit }
}

describe('app:quit', () => {
  it('takes no arguments and quits the app', () => {
    const { handlers, quit } = setup()
    expect(() => handlers['app:quit'].parseArgs(['now'])).toThrow(InvalidIpcArgumentsError)
    handlers['app:quit'].handle(event)
    expect(quit).toHaveBeenCalledTimes(1)
  })
})

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

`src/main/ipc/app-handlers.ts`:

```ts
import type { BrowserWindow, OpenDialogOptions, OpenDialogReturnValue } from 'electron'
import { noArgs } from './parse-args'
import type { IpcHandlerMap } from './register'

export interface AppHandlerDeps {
  app: { getName(): string; getVersion(): string; quit(): void }
  dialog: {
    showOpenDialog(
      window: BrowserWindow,
      options: OpenDialogOptions,
    ): Promise<OpenDialogReturnValue>
  }
  getMainWindow(): BrowserWindow | null
  runtime: { platform: string; arch: string; electronVersion: string }
}

export type AppHandlers = Pick<IpcHandlerMap, 'app:get-info' | 'app:quit' | 'dialog:select-folder'>

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

    'app:quit': {
      parseArgs: noArgs,
      handle: () => {
        deps.app.quit()
      },
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

`src/main/ipc/register.test.ts`:

```ts
import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { AppInfo } from '@shared/ipc-contract'
import {
  childrenArgs,
  clipboardArgs,
  contextMenuArgs,
  expandArgs,
  InvalidIpcArgumentsError,
  nodeArgs,
  noArgs,
  oneString,
  scanNodeArgs,
  treemapArgs,
} from './parse-args'
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
    'app:quit': { parseArgs: noArgs, handle: () => undefined },
    'dialog:select-folder': { parseArgs: noArgs, handle: () => ({ canceled: true }) },
    'drives:list': { parseArgs: noArgs, handle: () => [] },
    'drive:info': { parseArgs: oneString, handle: () => null },
    'places:list': { parseArgs: noArgs, handle: () => ({ places: [], recent: [] }) },
    'scan:start': { parseArgs: oneString, handle: () => ({ scanId: 'scan-1' }) },
    'scan:cancel': { parseArgs: oneString, handle: () => undefined },
    'tree:children': { parseArgs: childrenArgs, handle: () => null },
    'tree:node': { parseArgs: nodeArgs, handle: () => null },
    'tree:expand-ids': { parseArgs: expandArgs, handle: () => [] },
    'tree:refresh': { parseArgs: scanNodeArgs, handle: () => null },
    'treemap:layout': { parseArgs: treemapArgs, handle: () => null },
    'shell:open-in-explorer': { parseArgs: scanNodeArgs, handle: () => undefined },
    'shell:context-menu': { parseArgs: contextMenuArgs, handle: () => ({ kind: 'dismissed' }) },
    'folder:create': { parseArgs: scanNodeArgs, handle: () => ({ parentId: 'd0', name: 'x' }) },
    'clipboard:write-text': { parseArgs: clipboardArgs, handle: () => undefined },
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
    expect([...ipc.listeners.keys()].sort()).toEqual([
      'app:get-info',
      'app:quit',
      'clipboard:write-text',
      'dialog:select-folder',
      'drive:info',
      'drives:list',
      'folder:create',
      'places:list',
      'scan:cancel',
      'scan:start',
      'shell:context-menu',
      'shell:open-in-explorer',
      'tree:children',
      'tree:expand-ids',
      'tree:node',
      'tree:refresh',
      'treemap:layout',
    ])
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
})
```

- [ ] **Step 11: Self-test (Explorer menu probe and the root's rows instead of top folders)**

`src/main/self-test.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { DriveInfo, ScanDone, ScanFailed } from '@shared/scan-types'
import type { TreeRow } from '@shared/tree-types'
import { runSelfTest, SELF_TEST_EXIT, type SelfTestDeps, type SelfTestScan } from './self-test'

const DRIVES: DriveInfo[] = [
  { root: 'C:\\', label: 'Local Disk', kind: 'fixed', totalBytes: 100, freeBytes: 40 },
]
const NATIVE = 'C:\\App\\resources\\app.asar.unpacked\\koffi.node'
const MENU = ['StorageIQ', 'New folder', '', 'Open', 'Copy', 'Cut', 'Delete', 'Properties']

function row(name: string, kind: TreeRow['kind']): TreeRow {
  return {
    id: kind === 'folder' ? 'd1' : 'g0',
    parentId: 'd0',
    kind,
    name,
    size: 1,
    allocated: 4096,
    files: 1,
    folders: 0,
    modifiedMs: 0,
    childCount: 1,
  }
}

function scanDone(overrides: Partial<ScanDone> = {}): ScanDone {
  return {
    scanId: 'self-test',
    status: 'complete',
    files: 3,
    folders: 1,
    bytes: 900,
    allocatedBytes: 12_288,
    elapsedMs: 20,
    errors: [],
    errorCount: 0,
    ...overrides,
  }
}

const completed = (
  done = scanDone(),
  rootChildren = [row('app.asar.unpacked', 'folder'), row('', 'files')],
): SelfTestScan => ({ done, rootChildren })

function setup(overrides: Partial<SelfTestDeps> = {}) {
  const lines: string[] = []
  const deps: SelfTestDeps = {
    listDrives: vi.fn(async () => DRIVES),
    unpackedNativeModule: NATIVE,
    fileExists: vi.fn(() => true),
    scanRoot: 'C:\\App\\resources',
    scanOnce: vi.fn(async () => completed()),
    probeShellMenu: vi.fn(async () => MENU),
    log: (line) => {
      lines.push(line)
    },
    ...overrides,
  }
  return { deps, lines }
}

describe('runSelfTest', () => {
  it('passes when koffi lists drives, builds the shell menu and the scanner completes', async () => {
    const { deps, lines } = setup()
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.ok)
    expect(deps.fileExists).toHaveBeenCalledWith(NATIVE)
    expect(deps.scanOnce).toHaveBeenCalledWith('C:\\App\\resources')
    expect(deps.probeShellMenu).toHaveBeenCalledWith('C:\\App\\resources')
    expect(lines).toContain('drives: C:\\')
    expect(lines).toContain('shell menu: 7 items')
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

  it('fails when the shell menu cannot be built', async () => {
    const { deps } = setup({ probeShellMenu: vi.fn().mockRejectedValue(new Error('E_FAIL')) })
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.shellMenuFailed)
  })

  it('fails when the shell menu has only StorageIQ’s own items', async () => {
    const { deps } = setup({ probeShellMenu: vi.fn(async () => ['StorageIQ', 'New folder', '']) })
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.shellMenuFailed)
  })

  it('fails when the scanner process fails', async () => {
    const failed: ScanFailed = { scanId: 'self-test', message: 'crashed' }
    const { deps } = setup({ scanOnce: vi.fn(async () => ({ failed })) })
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.scanFailed)
  })

  it('fails when the scan does not complete', async () => {
    const { deps } = setup({
      scanOnce: vi.fn(async () => completed(scanDone({ status: 'canceled' }))),
    })
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.scanFailed)
  })

  it('fails when the scanner walked into app.asar instead of counting it as a file', async () => {
    const { deps } = setup({
      scanOnce: vi.fn(async () => completed(scanDone(), [row('app.asar', 'folder')])),
    })
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.asarEntered)
  })
})
```

`src/main/self-test.ts`:

```ts
import type { DriveInfo, ScanDone, ScanFailed } from '@shared/scan-types'
import type { TreeRow } from '@shared/tree-types'

/** Run the packaged exe with this switch to check koffi and the scanner process, then exit. */
export const SELF_TEST_FLAG = '--self-test'

export const SELF_TEST_EXIT = {
  ok: 0,
  drivesFailed: 10,
  noDrives: 11,
  nativeNotUnpacked: 12,
  shellMenuFailed: 13,
  scanFailed: 20,
  asarEntered: 21,
} as const

/** A real Explorer menu has Open, Copy, Properties and more; fewer items means COM failed. */
export const MIN_SHELL_MENU_ITEMS = 5

/** One finished scan plus the scanned root's direct child rows. */
export type SelfTestScan = { done: ScanDone; rootChildren: TreeRow[] } | { failed: ScanFailed }

export interface SelfTestDeps {
  listDrives(): Promise<DriveInfo[]>
  /** Where `koffi.node` must be in a packaged app; `null` when running unpackaged. */
  unpackedNativeModule: string | null
  fileExists(path: string): boolean
  /** The app's `resources` folder, which contains `app.asar`. */
  scanRoot: string
  scanOnce(root: string): Promise<SelfTestScan>
  /** Labels of the Explorer context menu for `path`, built and destroyed without showing it. */
  probeShellMenu(path: string): Promise<string[]>
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

  let labels: string[]
  try {
    labels = await deps.probeShellMenu(deps.scanRoot)
  } catch (error) {
    deps.log(`shell menu: ${String(error)}`)
    return SELF_TEST_EXIT.shellMenuFailed
  }
  const shellItems = labels.filter((label) => label !== '').length
  if (shellItems <= MIN_SHELL_MENU_ITEMS) {
    deps.log(`shell menu: only ${shellItems} items (${labels.join(' | ')})`)
    return SELF_TEST_EXIT.shellMenuFailed
  }
  deps.log(`shell menu: ${shellItems} items`)

  const result = await deps.scanOnce(deps.scanRoot)
  if ('failed' in result) {
    deps.log(`scan: did not complete (${result.failed.message})`)
    return SELF_TEST_EXIT.scanFailed
  }
  if (result.done.status !== 'complete') {
    deps.log(`scan: did not complete (${result.done.status})`)
    return SELF_TEST_EXIT.scanFailed
  }
  if (result.rootChildren.some((row) => row.kind === 'folder' && row.name === 'app.asar')) {
    deps.log('scan: walked into app.asar instead of counting it as a file')
    return SELF_TEST_EXIT.asarEntered
  }
  deps.log(`scan: ${result.done.files} files, ${result.done.folders} folders`)
  return SELF_TEST_EXIT.ok
}
```

- [ ] **Step 12: Wiring and bridge**

`src/main/index.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  app,
  type BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  screen,
  session,
  shell,
  utilityProcess,
} from 'electron'
import type { DriveDetails, ScanDone, ScanFailed } from '@shared/scan-types'
import {
  DEFAULT_CLUSTER_BYTES,
  SCANNER_SERVICE_NAME,
  type ScanVolume,
} from '@shared/scanner-protocol'
import { MAX_PAGE_ROWS, ROOT_NODE_ID } from '@shared/tree-types'
import type { DriveApi } from './drives/drive-api'
import { driveRootOf, isDriveRoot, readDriveDetails } from './drives/drive-details'
import { createKoffiDriveApi } from './drives/koffi-drive-api'
import { listDrives } from './drives/list-drives'
import { createAppHandlers } from './ipc/app-handlers'
import { createDriveHandlers } from './ipc/drive-handlers'
import { type IpcHandlerMap, registerIpcHandlers } from './ipc/register'
import { createScanHandlers } from './ipc/scan-handlers'
import { createEventSender } from './ipc/send-event'
import { createShellHandlers } from './ipc/shell-handlers'
import { createFolderRefresher, createTreeHandlers } from './ipc/tree-handlers'
import { createRecentScans, listPlaces, RECENT_SCANS_FILE } from './places/places'
import { createScanService, type ScannerChild } from './scan/scan-service'
import { hardenWebContents } from './security/harden-web-contents'
import { isTrustedRendererUrl } from './security/trusted-url'
import { isTrustedIpcSender } from './security/trusted-sender'
import { runSelfTest, SELF_TEST_FLAG, type SelfTestScan } from './self-test'
import {
  probeShellMenu,
  type ShellMenuChoice,
  type ShellMenuNative,
  showShellMenu,
} from './shell-menu/context-menu'
import { createWinShellMenu } from './shell-menu/win-shell-menu'
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
let shellMenuNative: Promise<ShellMenuNative> | null = null

/** Loads koffi on first use; a failed load is retried on the next call. */
function getDriveApi(): Promise<DriveApi> {
  driveApi ??= createKoffiDriveApi().catch((error: unknown) => {
    driveApi = null
    throw error
  })
  return driveApi
}

function getShellMenu(): Promise<ShellMenuNative> {
  shellMenuNative ??= createWinShellMenu().catch((error: unknown) => {
    shellMenuNative = null
    throw error
  })
  return shellMenuNative
}

async function listSystemDrives() {
  return listDrives(await getDriveApi())
}

async function driveDetails(root: string): Promise<DriveDetails | null> {
  try {
    return await readDriveDetails(await getDriveApi(), root)
  } catch {
    return null
  }
}

/** Cluster size for allocated sizes, and free space for the treemap when `root` is a drive. */
async function volumeFor(root: string): Promise<ScanVolume> {
  const driveRoot = driveRootOf(root)
  const details = driveRoot === null ? null : await driveDetails(driveRoot)
  return {
    clusterBytes: details?.clusterBytes ?? DEFAULT_CLUSTER_BYTES,
    freeBytes: details !== null && isDriveRoot(root) ? details.freeBytes : null,
  }
}

function windowHandle(window: BrowserWindow | null): bigint {
  return window === null ? 0n : window.getNativeWindowHandle().readBigUInt64LE(0)
}

/** Shows the Explorer menu at window CSS pixel `x`, `y` (converted to screen pixels). */
async function showContextMenuAt(
  target: string,
  x: number,
  y: number,
  extended: boolean,
): Promise<ShellMenuChoice> {
  const window = mainWindow
  if (window === null || window.isDestroyed()) return { kind: 'dismissed' }
  const native = await getShellMenu()
  const bounds = window.getContentBounds()
  const point = screen.dipToScreenPoint({ x: bounds.x + x, y: bounds.y + y })
  return showShellMenu(native, {
    hwnd: windowHandle(window),
    path: target,
    x: Math.round(point.x),
    y: Math.round(point.y),
    extended,
  })
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

const sendEvent = createEventSender(() => mainWindow)
const scanService = createScanService({
  forkScanner,
  sendEvent,
  createScanId: () => randomUUID(),
})

/** Self-test only: one scan in a fresh scanner process, plus the root's child rows. */
function scanOnce(root: string): Promise<SelfTestScan> {
  return new Promise((resolve) => {
    const service = createScanService({
      forkScanner,
      createScanId: () => randomUUID(),
      sendEvent: (channel, payload) => {
        if (channel === 'scan:failed') {
          service.dispose()
          resolve({ failed: payload as ScanFailed })
          return
        }
        if (channel !== 'scan:done') return
        const done = payload as ScanDone
        service
          .query({
            kind: 'children',
            scanId: done.scanId,
            nodeId: ROOT_NODE_ID,
            sortKey: 'name',
            sortDir: 'asc',
            offset: 0,
            limit: MAX_PAGE_ROWS,
          })
          .then(
            (page) => resolve({ done, rootChildren: page?.rows ?? [] }),
            () => resolve({ done, rootChildren: [] }),
          )
          .finally(() => service.dispose())
      },
    })
    service.start(root, { clusterBytes: DEFAULT_CLUSTER_BYTES, freeBytes: null })
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
  // No window, no single-instance lock: list drives, build the Explorer menu, run one scan,
  // exit with a status code. A temp userData keeps this run away from a live instance's profile.
  app.setPath('userData', path.join(app.getPath('temp'), 'StorageIQ-self-test'))
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
        probeShellMenu: async (target) => probeShellMenu(await getShellMenu(), 0n, target),
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

  // E2E only (unpackaged + STORAGEIQ_TEST_HOOKS=1): list the Explorer menu's labels for a path
  // without showing it, because Playwright cannot drive a native menu.
  if (!app.isPackaged && process.env['STORAGEIQ_TEST_HOOKS'] === '1') {
    Object.assign(globalThis, {
      __storageiqProbeShellMenu: async (target: string) =>
        probeShellMenu(await getShellMenu(), windowHandle(mainWindow), target),
    })
  }

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

      const recent = createRecentScans({
        file: path.join(app.getPath('userData'), RECENT_SCANS_FILE),
        readFile: (file) => readFile(file, 'utf8'),
        writeFile: (file, text) => writeFile(file, text, 'utf8'),
      })
      const refreshFolder = createFolderRefresher(scanService, sendEvent)

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
        ...createScanHandlers({
          scanService,
          stat,
          volumeFor,
          addRecent: (root) => recent.add(root),
        }),
        ...createDriveHandlers({
          listDrives: listSystemDrives,
          driveDetails,
          listPlaces: () =>
            listPlaces({
              documentsPath: () => {
                try {
                  return app.getPath('documents')
                } catch {
                  return null
                }
              },
              env: process.env,
              isDirectory: (target) =>
                stat(target).then(
                  (info) => info.isDirectory(),
                  () => false,
                ),
              recent,
            }),
        }),
        ...createTreeHandlers({ scanService, refreshFolder }),
        ...createShellHandlers({
          scanService,
          refreshFolder,
          openPath: (target) => shell.openPath(target),
          showItemInFolder: (target) => shell.showItemInFolder(target),
          writeClipboard: (text) => clipboard.writeText(text),
          readdir: (folder) => readdir(folder),
          mkdir: async (folder) => {
            await mkdir(folder)
          },
          showShellMenu: showContextMenuAt,
          later: (callback, ms) => {
            setTimeout(callback, ms)
          },
        }),
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

`src/preload/index.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcArgs, IpcChannel, IpcResult, StorageIQApi } from '@shared/ipc-contract'
import { subscribe } from './subscribe'

function invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<C>>
}

const api: StorageIQApi = {
  getAppInfo: () => invoke('app:get-info'),
  quit: () => invoke('app:quit'),
  selectFolder: () => invoke('dialog:select-folder'),
  listDrives: () => invoke('drives:list'),
  getDriveInfo: (root) => invoke('drive:info', root),
  listPlaces: () => invoke('places:list'),
  startScan: (root) => invoke('scan:start', root),
  cancelScan: (scanId) => invoke('scan:cancel', scanId),
  getChildren: (scanId, nodeId, sortKey, sortDir, offset, limit) =>
    invoke('tree:children', scanId, nodeId, sortKey, sortDir, offset, limit),
  getNode: (scanId, nodeId, sortKey, sortDir) =>
    invoke('tree:node', scanId, nodeId, sortKey, sortDir),
  getExpandIds: (scanId, nodeId, levels) => invoke('tree:expand-ids', scanId, nodeId, levels),
  refreshFolder: (scanId, nodeId) => invoke('tree:refresh', scanId, nodeId),
  getTreemap: (scanId, nodeId, mode, depth, width, height) =>
    invoke('treemap:layout', scanId, nodeId, mode, depth, width, height),
  openInExplorer: (scanId, nodeId) => invoke('shell:open-in-explorer', scanId, nodeId),
  showContextMenu: (scanId, nodeId, x, y, extended) =>
    invoke('shell:context-menu', scanId, nodeId, x, y, extended),
  createFolder: (scanId, nodeId) => invoke('folder:create', scanId, nodeId),
  writeClipboardText: (text) => invoke('clipboard:write-text', text),
  onScanProgress: (listener) => subscribe(ipcRenderer, 'scan:progress', listener),
  onScanDone: (listener) => subscribe(ipcRenderer, 'scan:done', listener),
  onScanFailed: (listener) => subscribe(ipcRenderer, 'scan:failed', listener),
  onTreeChanged: (listener) => subscribe(ipcRenderer, 'tree:changed', listener),
}

contextBridge.exposeInMainWorld('storageiq', api)
```

- [ ] **Step 13: Run the main, worker and preload tests**

```powershell
npx vitest run src/main src/worker src/preload
```

Expected: PASS — 26 files, 303 tests (Task 7 adds the menu orchestration tests). `npm run typecheck` fails until Task 7 creates `src/main/shell-menu/context-menu.ts` and `win-shell-menu.ts` (expected; see "Integration window").

- [ ] **Step 14: Format and lint**

```powershell
npm run format
npm run lint
```

Expected: lint clean.

- [ ] **Step 15: Commit**

```powershell
git add src/shared/scan-types.ts src/shared/scanner-protocol.ts src/shared/ipc-contract.ts src/worker/scanner/scanner-host.ts src/worker/scanner/scanner-host.test.ts src/main/ipc src/main/scan/scan-service.ts src/main/scan/scan-service.test.ts src/main/drives src/main/places src/main/shell-menu/menu-commands.ts src/main/shell-menu/menu-commands.test.ts src/main/self-test.ts src/main/self-test.test.ts src/main/index.ts src/preload/index.ts
git commit -m @'
feat(ipc): tree, treemap, drive, places, shell and clipboard channels; scanner queries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 5: Workspace store, Ribbon and Select menu

**Implementer tier:** standard

The workspace store replaces the scan store: scan lifecycle (with the 2a early-event buffer and cancel-before-id), drive details, Select menu data, Mode, Unit, sort, expanded set, selection, chunked child lists tagged with the data `revision` (bumped by every progress, done and `tree:changed` event, so visible chunks reload during a scan), treemap root/depth/visibility, banner and announcements. The visible-row model is built from segments, so a folder with a million children costs one segment. Menus and toolbars follow modern-web-guidance: native `focusgroup` (Chromium 156 has it) with a script fallback that jsdom uses; the menu popup is a `popover="manual"` element placed from script because Electron 45's Chromium has no CSS anchor positioning; explicit ARIA roles are kept (equal to the roles `focusgroup` infers) so tests and assistive technology see the same tree. The 2a screens go now because they depend on the removed scan store.

**Files:**

- Create: `src/renderer/src/lib/tree-view-model.ts` (+ test), `lib/use-focusgroup.ts`, `stores/workspace-store.ts` (+ test), `stores/workspace-store-context.tsx` (+ test), `components/MenuButton.tsx`, `RibbonButton.tsx`, `SelectMenu.tsx` (+ test), `Ribbon.tsx` (+ test)
- Modify: `src/renderer/src/lib/format.ts` (+ test), `env.d.ts`, `test/fake-api.ts`, `test/scan-fixtures.ts`, `test/render.tsx`
- Delete: `stores/scan-store.ts`, `scan-store.test.ts`, `scan-store-context.tsx`, `scan-store-context.test.tsx`, `components/PickLocationScreen.tsx` (+ test), `ScanningScreen.tsx` (+ test), `ResultScreen.tsx` (+ test), `CrashScreen.tsx` (+ test), `DriveCard.tsx`, `FolderBars.tsx`, `Stat.tsx`

**Interfaces:**

- Consumes: `StorageIQApi` and shared types (Task 4).
- Produces: `SizeUnit`, `SIZE_UNITS`, `formatSize`, `formatShare`, `formatDate`, `formatModeValue`, `shareOfParent`, `filesRowName`, `rowName` (plus 2a `formatCount formatBytes formatDuration percentOf middleTruncate`); `CHUNK_SIZE = 200`, `ChildChunk`, `ChildList`, `ChildLists`, `VisibleRow`, `ChunkRef`, `VisibleModel`, `rowInList`, `buildVisibleModel(lists, expanded, rootId)`, `chunksFor(model, first, last)`; `FocusgroupKind`, `hasNativeFocusgroup`, `useFocusgroupFallback(ref, kind, itemsKey?)`; `ScanPhase`, `ColumnId`, `LoadStatus`, `ScanTotals`, `Banner`, `WorkspaceState`, `WorkspaceStore`, `createWorkspaceStore(api)`, `effectiveSort`, `actionError`, `isNetworkPath`, `driveRootOf`, constants `FOLDER_PICKER_ERROR START_SCAN_ERROR NETWORK_PATH_ERROR SCAN_CRASH_MESSAGE PATH_COPIED EXPAND_ALL_LEVELS DEFAULT_TREEMAP_DEPTH`; `WorkspaceStoreProvider`, `useWorkspace`, `useWorkspaceStore`; `MenuEntry`, `MenuSection`, `MenuButtonProps`, `MenuButton`; `RIBBON_BUTTON_CLASS`, `RIBBON_SMALL_CLASS`, `RibbonButton`; `SelectMenu`; `RibbonTab`, `Ribbon({ onAbout })`; test helpers `TEST_DRIVE_DETAILS`, `TEST_PLACES`, `TEST_ROWS`, `fakeChildren`, `fakeNode`, `fakeTreemap`, `FakeApi.emitTreeChanged`, `renderWithStores(ui, api)` returning `{ api, appStore, workspace }`.

- [ ] **Step 1: Formatting (tests, then code)**

`src/renderer/src/lib/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  filesRowName,
  formatBytes,
  formatCount,
  formatDate,
  formatDuration,
  formatModeValue,
  formatShare,
  formatSize,
  middleTruncate,
  percentOf,
  rowName,
  shareOfParent,
} from './format'

const GB = 1024 ** 3
const MB = 1024 ** 2

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(1_234_567)).toBe('1,234,567')
  })
})

describe('formatBytes', () => {
  it.each([
    [0, '0 bytes'],
    [1, '1 byte'],
    [1023, '1,023 bytes'],
    [1024, '1.0 KB'],
    [5 * MB, '5.0 MB'],
    [150 * MB, '150 MB'],
    [3 * GB, '3.0 GB'],
    [2 * 1024 * GB, '2.0 TB'],
  ])('formats %d as %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text)
  })
})

describe('formatSize', () => {
  it('uses Auto like formatBytes and forces a unit otherwise', () => {
    expect(formatSize(3 * GB, 'auto')).toBe('3.0 GB')
    expect(formatSize(3 * GB, 'gb')).toBe('3.0 GB')
    expect(formatSize(3 * GB, 'mb')).toBe('3,072.0 MB')
    expect(formatSize(512, 'kb')).toBe('0.5 KB')
    expect(formatSize(100 * MB, 'gb')).toBe('0.1 GB')
  })
})

describe('formatShare', () => {
  it('shows one decimal and marks tiny shares', () => {
    expect(formatShare(1)).toBe('100.0%')
    expect(formatShare(0.599)).toBe('59.9%')
    expect(formatShare(0)).toBe('0.0%')
    expect(formatShare(0.0001)).toBe('<0.1%')
  })
})

describe('formatDate', () => {
  it('formats a date and leaves unknown dates empty', () => {
    expect(formatDate(new Date(2026, 10, 19, 14, 30).getTime())).toBe('11/19/2026')
    expect(formatDate(0)).toBe('')
  })
})

describe('formatDuration', () => {
  it.each([
    [40, 'under 0.1 s'],
    [1500, '1.5 s'],
    [12_400, '12 s'],
    [125_000, '2 min 05 s'],
    [3_780_000, '1 h 03 min'],
  ])('formats %d ms as %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text)
  })
})

describe('percentOf and shareOfParent', () => {
  it('guards against a zero total', () => {
    expect(percentOf(5, 0)).toBe(0)
    expect(percentOf(1, 4)).toBe(0.25)
  })

  it('uses the Mode value; the root is 100%', () => {
    const row = { size: 100, allocated: 4096, files: 1 }
    const parent = { size: 400, allocated: 8192, files: 4 }
    expect(shareOfParent(row, parent, 'size')).toBe(0.25)
    expect(shareOfParent(row, parent, 'percent')).toBe(0.25)
    expect(shareOfParent(row, parent, 'allocated')).toBe(0.5)
    expect(shareOfParent(row, parent, 'files')).toBe(0.25)
    expect(shareOfParent(row, null, 'size')).toBe(1)
  })
})

describe('formatModeValue', () => {
  const row = { size: 3 * GB, allocated: 4 * GB, files: 1234 }
  it('shows the Mode value', () => {
    expect(formatModeValue(row, 'size', 'auto', 0.5)).toBe('3.0 GB')
    expect(formatModeValue(row, 'allocated', 'mb', 0.5)).toBe('4,096.0 MB')
    expect(formatModeValue(row, 'files', 'auto', 0.5)).toBe('1,234')
    expect(formatModeValue(row, 'percent', 'auto', 0.5)).toBe('50.0%')
  })
})

describe('row names', () => {
  it('names the "[N files]" row', () => {
    expect(filesRowName(1)).toBe('[1 file]')
    expect(filesRowName(1200)).toBe('[1,200 files]')
    expect(rowName({ kind: 'files', name: '', files: 7 })).toBe('[7 files]')
    expect(rowName({ kind: 'folder', name: 'Photos', files: 7 })).toBe('Photos')
  })
})

describe('middleTruncate', () => {
  it('keeps both ends of a long path', () => {
    expect(middleTruncate('short', 10)).toBe('short')
    const text = middleTruncate('C:\\a-very-long-folder-name\\file.txt', 15)
    expect(text).toHaveLength(15)
    expect(text.startsWith('C:\\a-v')).toBe(true)
    expect(text.endsWith('le.txt')).toBe(true)
  })
})
```

`src/renderer/src/lib/format.ts`:

```ts
import { modeValue, type SizeMode, type TreeRow } from '@shared/tree-types'

const UNITS = ['KB', 'MB', 'GB', 'TB', 'PB'] as const
const countFormat = new Intl.NumberFormat('en-US')
const oneDecimal = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const dateFormat = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
})

/** The Unit toggle: Auto picks KB to PB per value; the others force one unit. */
export type SizeUnit = 'auto' | 'gb' | 'mb' | 'kb'
export const SIZE_UNITS: readonly SizeUnit[] = ['auto', 'gb', 'mb', 'kb']

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

const FORCED: Record<Exclude<SizeUnit, 'auto'>, { divisor: number; label: string }> = {
  gb: { divisor: 1024 ** 3, label: 'GB' },
  mb: { divisor: 1024 ** 2, label: 'MB' },
  kb: { divisor: 1024, label: 'KB' },
}

/** A size in the chosen unit, for example `12.3 GB` or `0.4 MB` (one decimal when forced). */
export function formatSize(bytes: number, unit: SizeUnit): string {
  if (unit === 'auto') return formatBytes(bytes)
  const { divisor, label } = FORCED[unit]
  return `${oneDecimal.format(bytes / divisor)} ${label}`
}

/** Share of the parent with one decimal: `59.9%`; tiny non-zero shares show `<0.1%`. */
export function formatShare(fraction: number): string {
  if (fraction > 0 && fraction < 0.0005) return '<0.1%'
  return `${oneDecimal.format(fraction * 100)}%`
}

export function formatDate(ms: number): string {
  return ms > 0 ? dateFormat.format(new Date(ms)) : ''
}

export function formatDuration(ms: number): string {
  if (ms < 100) return 'under 0.1 s'
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

/** Shortens long paths in the middle so both the drive and the file name stay visible. */
export function middleTruncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  const keep = maxLength - 1
  const head = Math.ceil(keep / 2)
  const tail = Math.floor(keep / 2)
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`
}

/** The value shown before a row's name: a size, a file count, or the share of the parent. */
export function formatModeValue(
  row: Pick<TreeRow, 'size' | 'allocated' | 'files'>,
  mode: SizeMode,
  unit: SizeUnit,
  share: number,
): string {
  switch (mode) {
    case 'size':
      return formatSize(row.size, unit)
    case 'allocated':
      return formatSize(row.allocated, unit)
    case 'files':
      return formatCount(row.files)
    case 'percent':
      return formatShare(share)
  }
}

/** The row's share of its parent in the given Mode (the root is 100%). */
export function shareOfParent(
  row: Pick<TreeRow, 'size' | 'allocated' | 'files'>,
  parent: Pick<TreeRow, 'size' | 'allocated' | 'files'> | null,
  mode: SizeMode,
): number {
  if (parent === null) return 1
  return percentOf(modeValue(row, mode), modeValue(parent, mode))
}

/** `[3 files]` / `[1 file]`: the row that groups the files directly in a folder. */
export function filesRowName(files: number): string {
  return files === 1 ? '[1 file]' : `[${formatCount(files)} files]`
}

/** The text shown for a row's name. */
export function rowName(row: Pick<TreeRow, 'kind' | 'name' | 'files'>): string {
  return row.kind === 'files' ? filesRowName(row.files) : row.name
}
```

- [ ] **Step 2: Visible-row model**

`src/renderer/src/lib/tree-view-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { TreeRow } from '@shared/tree-types'
import {
  buildVisibleModel,
  CHUNK_SIZE,
  type ChildList,
  type ChildLists,
  chunksFor,
  rowInList,
} from './tree-view-model'

function row(id: string, parentId: string | null, childCount = 0): TreeRow {
  return {
    id,
    parentId,
    kind: 'folder',
    name: id,
    size: 1,
    allocated: 1,
    files: 1,
    folders: 0,
    modifiedMs: 0,
    childCount,
  }
}

function list(parent: TreeRow, total: number, loaded: Record<number, TreeRow[]>): ChildList {
  const chunks = Object.fromEntries(
    Object.entries(loaded).map(([chunk, rows]) => [chunk, { rows, revision: 0 }]),
  )
  return { parent, total, chunks }
}

const root = row('d0', null, 3)
const a = row('d1', 'd0', 2)
const b = row('d2', 'd0', 0)
const c = row('d3', 'd0', 0)
const a1 = row('d4', 'd1', 0)
const a2 = row('d5', 'd1', 0)

const LISTS: ChildLists = {
  d0: list(root, 3, { 0: [a, b, c] }),
  d1: list(a, 2, { 0: [a1, a2] }),
}

describe('buildVisibleModel', () => {
  it('shows only the root while it is collapsed', () => {
    const model = buildVisibleModel(LISTS, new Set(), 'd0')
    expect(model.count).toBe(1)
    expect(model.rowAt(0)).toEqual({ row: root, parentId: null, index: 0, depth: 0, setSize: 1 })
  })

  it('shows nothing before the root is loaded', () => {
    expect(buildVisibleModel({}, new Set(['d0']), 'd0').count).toBe(0)
  })

  it('flattens expanded rows in order, with depth, position and set size', () => {
    const model = buildVisibleModel(LISTS, new Set(['d0', 'd1']), 'd0')
    expect(model.count).toBe(6)
    const lines = Array.from({ length: model.count }, (_, i) => model.rowAt(i))
    expect(lines.map((line) => [line?.row?.id, line?.depth, line?.index, line?.setSize])).toEqual([
      ['d0', 0, 0, 1],
      ['d1', 1, 0, 3],
      ['d4', 2, 0, 2],
      ['d5', 2, 1, 2],
      ['d2', 1, 1, 3],
      ['d3', 1, 2, 3],
    ])
    expect(model.rowAt(6)).toBeNull()
  })

  it('finds a loaded row and reports rows that are not visible', () => {
    const model = buildVisibleModel(LISTS, new Set(['d0', 'd1']), 'd0')
    expect(model.indexOf('d0')).toBe(0)
    expect(model.indexOf('d5')).toBe(3)
    expect(model.indexOf('d3')).toBe(5)
    expect(buildVisibleModel(LISTS, new Set(['d0']), 'd0').indexOf('d4')).toBe(-1)
  })

  it('counts rows of chunks that are not loaded yet as placeholders', () => {
    const big: ChildLists = { d0: list(row('d0', null, 1000), 1000, { 0: [a] }) }
    const model = buildVisibleModel(big, new Set(['d0']), 'd0')
    expect(model.count).toBe(1001)
    expect(model.rowAt(1)?.row?.id).toBe('d1')
    expect(model.rowAt(500)).toEqual({
      row: null,
      parentId: 'd0',
      index: 499,
      depth: 1,
      setSize: 1000,
    })
  })

  it('lists expanded rows whose children are missing', () => {
    const model = buildVisibleModel(LISTS, new Set(['d0', 'd1', 'd2']), 'd0')
    expect(model.missingLists).toEqual([])
    const missing = buildVisibleModel({ d0: LISTS['d0']! }, new Set(['d0', 'd1']), 'd0')
    expect(missing.missingLists).toEqual(['d1'])
  })

  it('handles a million children without one object per line', () => {
    const huge: ChildLists = { d0: list(row('d0', null, 1_000_000), 1_000_000, {}) }
    const started = performance.now()
    const model = buildVisibleModel(huge, new Set(['d0']), 'd0')
    expect(model.count).toBe(1_000_001)
    expect(model.rowAt(999_999)?.index).toBe(999_998)
    expect(performance.now() - started).toBeLessThan(50)
  })
})

describe('chunksFor', () => {
  it('asks for the chunks behind the lines in view and for missing lists', () => {
    const big: ChildLists = {
      d0: list(row('d0', null, 1000), 1000, { 0: [{ ...a, childCount: 2 }] }),
    }
    const model = buildVisibleModel(big, new Set(['d0', 'd1']), 'd0')
    expect(chunksFor(model, 0, 3)).toEqual([
      { nodeId: 'd0', chunk: 0 },
      { nodeId: 'd1', chunk: 0 },
    ])
    expect(chunksFor(model, 450, 451)).toEqual([
      { nodeId: 'd0', chunk: 2 },
      { nodeId: 'd1', chunk: 0 },
    ])
  })
})

describe('rowInList', () => {
  it('reads a row by its index across chunks', () => {
    const rows = Array.from({ length: 3 }, (_, i) => row(`d${100 + i}`, 'd0'))
    const l = list(root, CHUNK_SIZE + 3, { 1: rows })
    expect(rowInList(l, CHUNK_SIZE + 2)?.id).toBe('d102')
    expect(rowInList(l, 0)).toBeNull()
    expect(rowInList(undefined, 0)).toBeNull()
  })
})
```

`src/renderer/src/lib/tree-view-model.ts`:

```ts
import type { NodeId, TreeRow } from '@shared/tree-types'

/** Rows per `tree:children` request and per cached chunk. */
export const CHUNK_SIZE = 200

/** One loaded chunk of a row's children, tagged with the data revision it was fetched at. */
export interface ChildChunk {
  rows: TreeRow[]
  revision: number
}

/** What the renderer holds of one row's children: the count plus the chunks seen so far. */
export interface ChildList {
  parent: TreeRow
  total: number
  chunks: Readonly<Record<number, ChildChunk>>
}

export type ChildLists = Readonly<Record<NodeId, ChildList>>

/** One visible line of the tree. `row` is null while its chunk is loading. */
export interface VisibleRow {
  row: TreeRow | null
  /** null for the root line. */
  parentId: NodeId | null
  /** Position among the parent's children (0 for the root). */
  index: number
  /** 0 for the root, 1 for its children, … */
  depth: number
  /** Number of siblings, for `aria-setsize`. */
  setSize: number
}

export interface ChunkRef {
  nodeId: NodeId
  chunk: number
}

/** The flattened tree: only the root and the children of expanded, loaded rows. */
export interface VisibleModel {
  count: number
  rowAt(index: number): VisibleRow | null
  /** Index of a loaded row, or -1 when it is not visible (collapsed parent or not loaded). */
  indexOf(id: NodeId): number
  /** Expanded rows whose children have not been loaded yet. */
  missingLists: NodeId[]
}

interface Segment {
  /** Global index of the segment's first line. */
  start: number
  count: number
  /** null for the root line. */
  parentId: NodeId | null
  /** First child index in the parent's list. */
  from: number
  depth: number
}

export function rowInList(list: ChildList | undefined, index: number): TreeRow | null {
  if (list === undefined) return null
  const chunk = list.chunks[Math.floor(index / CHUNK_SIZE)]
  return chunk?.rows[index % CHUNK_SIZE] ?? null
}

function loadedIndices(list: ChildList): number[] {
  return Object.keys(list.chunks)
    .map(Number)
    .sort((a, b) => a - b)
}

/**
 * Builds the visible model as a list of segments (runs of siblings) instead of one object per
 * line, so a folder with a million children costs one segment, not a million rows.
 */
export function buildVisibleModel(
  lists: ChildLists,
  expanded: ReadonlySet<NodeId>,
  rootId: NodeId,
): VisibleModel {
  const segments: Segment[] = []
  const missingLists: NodeId[] = []
  let cursor = 0
  const root = lists[rootId]?.parent ?? null

  if (root !== null) {
    segments.push({ start: 0, count: 1, parentId: null, from: 0, depth: 0 })
    cursor = 1
  }

  const emitChildren = (parentId: NodeId, depth: number): void => {
    const list = lists[parentId]
    if (list === undefined) {
      missingLists.push(parentId)
      return
    }
    let from = 0
    for (const chunkIndex of loadedIndices(list)) {
      const chunk = list.chunks[chunkIndex]
      if (chunk === undefined) continue
      chunk.rows.forEach((row, offset) => {
        const index = chunkIndex * CHUNK_SIZE + offset
        if (!expanded.has(row.id) || row.childCount === 0 || index < from) return
        const count = index - from + 1
        segments.push({ start: cursor, count, parentId, from, depth })
        cursor += count
        from = index + 1
        emitChildren(row.id, depth + 1)
      })
    }
    if (from < list.total) {
      const count = list.total - from
      segments.push({ start: cursor, count, parentId, from, depth })
      cursor += count
    }
  }

  if (root !== null && expanded.has(rootId)) emitChildren(rootId, 1)

  const segmentAt = (index: number): Segment | null => {
    let low = 0
    let high = segments.length - 1
    while (low <= high) {
      const mid = (low + high) >> 1
      const segment = segments[mid]
      if (segment === undefined) return null
      if (index < segment.start) high = mid - 1
      else if (index >= segment.start + segment.count) low = mid + 1
      else return segment
    }
    return null
  }

  return {
    count: cursor,
    missingLists,
    rowAt(index) {
      const segment = segmentAt(index)
      if (segment === null) return null
      if (segment.parentId === null) {
        return { row: root, parentId: null, index: 0, depth: 0, setSize: 1 }
      }
      const list = lists[segment.parentId]
      const childIndex = segment.from + (index - segment.start)
      return {
        row: rowInList(list, childIndex),
        parentId: segment.parentId,
        index: childIndex,
        depth: segment.depth,
        setSize: list?.total ?? 0,
      }
    },
    indexOf(id) {
      if (root !== null && id === rootId) return 0
      for (const segment of segments) {
        if (segment.parentId === null) continue
        const list = lists[segment.parentId]
        if (list === undefined) continue
        for (let i = 0; i < segment.count; i += 1) {
          if (rowInList(list, segment.from + i)?.id === id) return segment.start + i
        }
      }
      return -1
    },
  }
}

/** The chunks needed to draw lines `first` to `last` (inclusive) and to fill expanded rows. */
export function chunksFor(model: VisibleModel, first: number, last: number): ChunkRef[] {
  const needed = new Map<string, ChunkRef>()
  const add = (nodeId: NodeId, chunk: number) => needed.set(`${nodeId}:${chunk}`, { nodeId, chunk })
  for (let i = Math.max(0, first); i <= Math.min(last, model.count - 1); i += 1) {
    const line = model.rowAt(i)
    if (line !== null && line.parentId !== null) {
      add(line.parentId, Math.floor(line.index / CHUNK_SIZE))
    }
  }
  for (const nodeId of model.missingLists) add(nodeId, 0)
  return [...needed.values()]
}
```

- [ ] **Step 3: Test helpers**

`src/renderer/src/test/fake-api.ts`:

```ts
import { vi } from 'vitest'
import type { AppInfo, SelectFolderResult, StorageIQApi } from '@shared/ipc-contract'
import type {
  DriveDetails,
  DriveInfo,
  Places,
  ScanDone,
  ScanFailed,
  ScanProgress,
  ScanStartResult,
} from '@shared/scan-types'
import type {
  NodeId,
  SortDir,
  SortKey,
  TreeChanged,
  TreemapLayout,
  TreeNodeDetails,
  TreePage,
  TreeRow,
} from '@shared/tree-types'

export const TEST_APP_INFO: AppInfo = {
  name: 'StorageIQ',
  version: '0.1.0',
  platform: 'win32',
  arch: 'x64',
  electronVersion: '45.3.4',
}

const MB = 1024 ** 2
const GB = 1024 ** 3

export const TEST_DRIVES: DriveInfo[] = [
  { root: 'C:\\', label: 'Local Disk', kind: 'fixed', totalBytes: 512 * GB, freeBytes: 128 * GB },
  { root: 'E:\\', label: 'Photos', kind: 'removable', totalBytes: 64 * GB, freeBytes: 16 * GB },
]

export const TEST_PLACES: Places = {
  places: [
    { kind: 'documents', label: 'Documents', path: 'C:\\Users\\Ana\\Documents' },
    { kind: 'onedrive', label: 'OneDrive', path: 'C:\\Users\\Ana\\OneDrive' },
  ],
  recent: [],
}

export const TEST_DRIVE_DETAILS: DriveDetails = {
  root: 'D:\\',
  totalBytes: 1024 * GB,
  freeBytes: 400 * GB,
  clusterBytes: 4096,
  fileSystem: 'NTFS',
}

function row(fields: Partial<TreeRow> & Pick<TreeRow, 'id' | 'name'>): TreeRow {
  return {
    parentId: 'd0',
    kind: 'folder',
    size: 0,
    allocated: 0,
    files: 0,
    folders: 0,
    modifiedMs: Date.UTC(2026, 10, 19, 12),
    childCount: 0,
    ...fields,
  }
}

/**
 * D:\ (3.0 GB)
 *   Videos 2.0 GB (d1) → Clips 1.5 GB (d3), [1 file] 0.5 GB (g1 → movie.mp4 f1)
 *   Photos 768 MB (d2)
 *   [3 files] 256 MB (g0)
 */
export const TEST_ROWS: Record<NodeId, TreeRow> = {
  d0: row({
    id: 'd0',
    parentId: null,
    name: 'D:\\',
    size: 3 * GB,
    allocated: 3 * GB + 8 * MB,
    files: 1014,
    folders: 53,
    childCount: 3,
  }),
  d1: row({
    id: 'd1',
    name: 'Videos',
    size: 2 * GB,
    allocated: 2 * GB,
    files: 10,
    folders: 1,
    childCount: 2,
  }),
  d2: row({
    id: 'd2',
    name: 'Photos',
    size: 768 * MB,
    allocated: 776 * MB,
    files: 1000,
    folders: 50,
    childCount: 0,
  }),
  g0: row({
    id: 'g0',
    kind: 'files',
    name: '',
    size: 256 * MB,
    allocated: 256 * MB,
    files: 3,
    childCount: 3,
  }),
  d3: row({
    id: 'd3',
    parentId: 'd1',
    name: 'Clips',
    size: 1.5 * GB,
    allocated: 1.5 * GB,
    files: 9,
    childCount: 0,
  }),
  g1: row({
    id: 'g1',
    parentId: 'd1',
    kind: 'files',
    name: '',
    size: 0.5 * GB,
    allocated: 0.5 * GB,
    files: 1,
    childCount: 1,
  }),
  f1: row({
    id: 'f1',
    parentId: 'g1',
    kind: 'file',
    name: 'movie.mp4',
    size: 0.5 * GB,
    allocated: 0.5 * GB,
    files: 1,
  }),
}

const CHILDREN: Record<NodeId, NodeId[]> = {
  d0: ['d1', 'd2', 'g0'],
  d1: ['d3', 'g1'],
  g1: ['f1'],
  g0: [],
}

const PATHS: Record<NodeId, string> = {
  d0: 'D:\\',
  d1: 'D:\\Videos',
  d2: 'D:\\Photos',
  g0: 'D:\\',
  d3: 'D:\\Videos\\Clips',
  g1: 'D:\\Videos',
  f1: 'D:\\Videos\\movie.mp4',
}

function sortedChildren(nodeId: NodeId, key: SortKey, dir: SortDir): TreeRow[] {
  const rows = (CHILDREN[nodeId] ?? []).map((id) => TEST_ROWS[id]).filter((r): r is TreeRow => !!r)
  const value = (r: TreeRow): number | string =>
    key === 'name' ? r.name : key === 'modified' ? r.modifiedMs : r[key]
  return rows.sort((a, b) => {
    const left = value(a)
    const right = value(b)
    const order =
      typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right))
    return (dir === 'asc' ? order : -order) || a.id.localeCompare(b.id)
  })
}

export function fakeChildren(
  nodeId: NodeId,
  key: SortKey,
  dir: SortDir,
  offset: number,
  limit: number,
): TreePage | null {
  const parent = TEST_ROWS[nodeId]
  if (parent === undefined) return null
  const rows = sortedChildren(nodeId, key, dir)
  return { parent, total: rows.length, offset, rows: rows.slice(offset, offset + limit) }
}

export function fakeNode(nodeId: NodeId, key: SortKey, dir: SortDir): TreeNodeDetails | null {
  const row = TEST_ROWS[nodeId]
  if (row === undefined) return null
  const chain: NodeId[] = []
  for (let id: NodeId | null = row.parentId; id !== null; id = TEST_ROWS[id]?.parentId ?? null) {
    chain.unshift(id)
  }
  const steps = [...chain, nodeId]
  const locations = steps.slice(1).map((id, i) => {
    const parentId = steps[i] ?? 'd0'
    return { parentId, index: sortedChildren(parentId, key, dir).findIndex((r) => r.id === id) }
  })
  return { row, path: PATHS[nodeId] ?? '', ancestorIds: chain, locations }
}

/** Two side-by-side blocks for the root's two largest children; enough to test clicks. */
export function fakeTreemap(nodeId: NodeId, width: number, height: number): TreemapLayout {
  const half = Math.round(width / 2)
  return {
    nodeId,
    width,
    height,
    rects: [
      {
        id: 'd1',
        kind: 'folder',
        name: 'Videos',
        value: 2 * GB,
        files: 10,
        depth: 0,
        x: 0,
        y: 0,
        w: half,
        h: height,
        nested: false,
      },
      {
        id: 'd2',
        kind: 'folder',
        name: 'Photos',
        value: 768 * MB,
        files: 1000,
        depth: 0,
        x: half,
        y: 0,
        w: width - half,
        h: height,
        nested: false,
      },
    ],
  }
}

/** A fake bridge plus `emit…` helpers that play the main process sending events. */
export interface FakeApi extends StorageIQApi {
  emitScanProgress(progress: ScanProgress): void
  emitScanDone(done: ScanDone): void
  emitScanFailed(failed: ScanFailed): void
  emitTreeChanged(changed: TreeChanged): void
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
  const changed = createChannel<TreeChanged>()
  return {
    getAppInfo: vi.fn(async () => TEST_APP_INFO),
    quit: vi.fn(async () => undefined),
    selectFolder: vi.fn(async (): Promise<SelectFolderResult> => ({ canceled: true })),
    listDrives: vi.fn(async () => TEST_DRIVES),
    getDriveInfo: vi.fn(async () => TEST_DRIVE_DETAILS),
    listPlaces: vi.fn(async () => TEST_PLACES),
    startScan: vi.fn(async (): Promise<ScanStartResult> => ({ scanId: 'scan-1' })),
    cancelScan: vi.fn(async () => undefined),
    getChildren: vi.fn(async (_scanId, nodeId, key, dir, offset, limit) =>
      fakeChildren(nodeId, key, dir, offset, limit),
    ),
    getNode: vi.fn(async (_scanId, nodeId, key, dir) => fakeNode(nodeId, key, dir)),
    getExpandIds: vi.fn(async () => ['d0', 'd1']),
    refreshFolder: vi.fn(async (_scanId, nodeId) => fakeNode(nodeId, 'size', 'desc')),
    getTreemap: vi.fn(async (_scanId, nodeId, _mode, _depth, width, height) =>
      fakeTreemap(nodeId, width, height),
    ),
    openInExplorer: vi.fn(async () => undefined),
    showContextMenu: vi.fn(async () => ({ kind: 'dismissed' as const })),
    createFolder: vi.fn(async () => ({ parentId: 'd1', name: 'New folder' })),
    writeClipboardText: vi.fn(async () => undefined),
    onScanProgress: vi.fn(progress.subscribe),
    onScanDone: vi.fn(done.subscribe),
    onScanFailed: vi.fn(failed.subscribe),
    onTreeChanged: vi.fn(changed.subscribe),
    ...overrides,
    emitScanProgress: progress.emit,
    emitScanDone: done.emit,
    emitScanFailed: failed.emit,
    emitTreeChanged: changed.emit,
    listenerCount: () => progress.size() + done.size() + failed.size() + changed.size(),
  }
}
```

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
    allocatedBytes: 6 * MB,
    currentPath: 'D:\\Photos\\2024\\Summer',
    elapsedMs: 1500,
    errorCount: 0,
    ...overrides,
  }
}

export function makeDone(overrides: Partial<ScanDone> = {}): ScanDone {
  return {
    scanId: 'scan-1',
    status: 'complete',
    files: 1014,
    folders: 53,
    bytes: 3 * GB,
    allocatedBytes: 3 * GB + 8 * MB,
    elapsedMs: 12_400,
    errors: [
      {
        path: 'D:\\System Volume Information',
        kind: 'folder',
        reason: 'access-denied',
        code: 'EPERM',
      },
      {
        path: 'D:\\Old\\Very\\Long\\Path',
        kind: 'folder',
        reason: 'path-too-long',
        code: 'ENAMETOOLONG',
      },
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
import { createWorkspaceStore } from '../stores/workspace-store'
import { WorkspaceStoreProvider } from '../stores/workspace-store-context'
import { createFakeApi, type FakeApi } from './fake-api'

/** Renders `ui` inside both store providers, backed by a fake bridge. */
export function renderWithStores(ui: ReactElement, api: FakeApi = createFakeApi()) {
  const appStore = createAppStore(api)
  const workspace = createWorkspaceStore(api)
  const result = render(
    <AppStoreProvider store={appStore}>
      <WorkspaceStoreProvider store={workspace}>{ui}</WorkspaceStoreProvider>
    </AppStoreProvider>,
  )
  return { ...result, api, appStore, workspace }
}
```

- [ ] **Step 4: Workspace store (tests, then code)**

`src/renderer/src/stores/workspace-store.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { ScanStartResult } from '@shared/scan-types'
import { createFakeApi, TEST_DRIVE_DETAILS, TEST_DRIVES, TEST_PLACES } from '../test/fake-api'
import { makeDone, makeFailed, makeProgress } from '../test/scan-fixtures'
import {
  actionError,
  createWorkspaceStore,
  driveRootOf,
  effectiveSort,
  FOLDER_PICKER_ERROR,
  NETWORK_PATH_ERROR,
  PATH_COPIED,
  SCAN_CRASH_MESSAGE,
  START_SCAN_ERROR,
} from './workspace-store'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

async function scanning(api = createFakeApi()) {
  const store = createWorkspaceStore(api)
  await store.getState().startScan('D:\\')
  return { api, store }
}

describe('createWorkspaceStore', () => {
  it('starts empty and subscribes to the four events', () => {
    const api = createFakeApi()
    const store = createWorkspaceStore(api)
    expect(store.getState()).toMatchObject({
      phase: 'empty',
      target: null,
      scanId: null,
      mode: 'size',
      unit: 'auto',
      sortColumn: null,
      sortDir: 'desc',
      treemapVisible: true,
      treemapDepth: 1,
      banner: null,
    })
    expect(api.listenerCount()).toBe(4)
    store.dispose()
    expect(api.listenerCount()).toBe(0)
  })

  it('loads drives and places for the Select menu', async () => {
    const store = createWorkspaceStore(createFakeApi())
    await store.getState().loadMenuData()
    expect(store.getState()).toMatchObject({
      drives: TEST_DRIVES,
      places: TEST_PLACES,
      menuDataStatus: 'ready',
    })
  })

  it('keeps what it could load when one list fails', async () => {
    const api = createFakeApi({ listDrives: vi.fn().mockRejectedValue(new Error('koffi')) })
    const store = createWorkspaceStore(api)
    await store.getState().loadMenuData()
    expect(store.getState()).toMatchObject({
      drives: [],
      places: TEST_PLACES,
      menuDataStatus: 'error',
    })
  })
})

describe('a scan', () => {
  it('starts with the root expanded and selected, and loads the drive details', async () => {
    const { api, store } = await scanning()
    expect(api.startScan).toHaveBeenCalledWith('D:\\')
    expect(api.getDriveInfo).toHaveBeenCalledWith('D:\\')
    await flush()
    expect(store.getState()).toMatchObject({
      phase: 'scanning',
      target: 'D:\\',
      scanId: 'scan-1',
      selectedId: 'd0',
      treemapRootId: 'd0',
      drive: TEST_DRIVE_DETAILS,
    })
    expect([...store.getState().expanded]).toEqual(['d0'])
  })

  it('applies progress of its own scan only and bumps the revision', async () => {
    const { api, store } = await scanning()
    const before = store.getState().revision
    api.emitScanProgress(makeProgress({ scanId: 'other' }))
    expect(store.getState().totals.files).toBe(0)
    api.emitScanProgress(makeProgress())
    expect(store.getState().totals).toEqual({
      files: 420,
      folders: 17,
      bytes: 5 * 1024 ** 2,
      allocatedBytes: 6 * 1024 ** 2,
      errorCount: 0,
    })
    expect(store.getState().revision).toBe(before + 1)
  })

  it('ends with the totals and errors; a canceled scan keeps its partial tree', async () => {
    const { api, store } = await scanning()
    api.emitScanDone(makeDone())
    expect(store.getState()).toMatchObject({ phase: 'done', errors: makeDone().errors })
    expect(store.getState().totals.errorCount).toBe(2)

    const second = await scanning()
    second.api.emitScanDone(makeDone({ status: 'canceled' }))
    expect(second.store.getState().phase).toBe('canceled')
  })

  it('shows the crash banner when the scanner fails, and Retry scans again', async () => {
    const { api, store } = await scanning()
    api.emitScanFailed(makeFailed())
    expect(store.getState()).toMatchObject({
      phase: 'failed',
      banner: { tone: 'crash', message: SCAN_CRASH_MESSAGE },
    })
    await store.getState().rescan()
    expect(api.startScan).toHaveBeenCalledTimes(2)
    expect(store.getState().banner).toBeNull()
  })

  it('replays events that arrive before scan:start returns', async () => {
    const pending = deferred<ScanStartResult>()
    const api = createFakeApi({ startScan: vi.fn(() => pending.promise) })
    const store = createWorkspaceStore(api)
    const starting = store.getState().startScan('D:\\')
    api.emitScanDone(makeDone())
    expect(store.getState().phase).toBe('scanning')
    pending.resolve({ scanId: 'scan-1' })
    await starting
    expect(store.getState().phase).toBe('done')
  })

  it('stops the running scan, also when Stop comes before the id is known', async () => {
    const { api, store } = await scanning()
    await store.getState().stopScan()
    expect(api.cancelScan).toHaveBeenCalledWith('scan-1')

    const pending = deferred<ScanStartResult>()
    const slow = createFakeApi({ startScan: vi.fn(() => pending.promise) })
    const slowStore = createWorkspaceStore(slow)
    const starting = slowStore.getState().startScan('D:\\')
    await slowStore.getState().stopScan()
    pending.resolve({ scanId: 'scan-7' })
    await starting
    expect(slow.cancelScan).toHaveBeenCalledWith('scan-7')
  })

  it('refuses network paths and reports a failed start', async () => {
    const api = createFakeApi({ startScan: vi.fn().mockRejectedValue(new Error('Invalid')) })
    const store = createWorkspaceStore(api)
    await store.getState().startScan('\\\\server\\share')
    expect(store.getState().banner).toEqual({ tone: 'error', message: NETWORK_PATH_ERROR })
    expect(api.startScan).not.toHaveBeenCalled()
    await store.getState().startScan('D:\\Gone')
    expect(store.getState()).toMatchObject({
      phase: 'empty',
      banner: { tone: 'error', message: START_SCAN_ERROR },
    })
  })

  it('scans the folder chosen in the picker and reports a picker failure', async () => {
    const api = createFakeApi({
      selectFolder: vi.fn().mockResolvedValue({ canceled: false, path: 'D:\\Projects' }),
    })
    const store = createWorkspaceStore(api)
    await store.getState().chooseFolder()
    expect(api.startScan).toHaveBeenCalledWith('D:\\Projects')

    const broken = createFakeApi({ selectFolder: vi.fn().mockRejectedValue(new Error('down')) })
    const brokenStore = createWorkspaceStore(broken)
    await brokenStore.getState().chooseFolder()
    expect(brokenStore.getState().banner).toEqual({ tone: 'error', message: FOLDER_PICKER_ERROR })
    brokenStore.getState().dismissBanner()
    expect(brokenStore.getState().banner).toBeNull()
  })

  it('updates totals when a folder is refreshed (tree:changed)', async () => {
    const { api, store } = await scanning()
    api.emitScanDone(makeDone())
    const before = store.getState().revision
    api.emitTreeChanged({
      scanId: 'scan-1',
      nodeId: 'd1',
      totals: { files: 9, folders: 2, bytes: 10, allocatedBytes: 4096 },
    })
    expect(store.getState().totals).toEqual({
      files: 9,
      folders: 2,
      bytes: 10,
      allocatedBytes: 4096,
      errorCount: 2,
    })
    expect(store.getState().revision).toBe(before + 1)
  })
})

describe('tree data', () => {
  it('loads requested chunks with the current sort and skips fresh ones', async () => {
    const { api, store } = await scanning()
    store.getState().requestChunks([{ nodeId: 'd0', chunk: 0 }])
    await flush()
    expect(api.getChildren).toHaveBeenCalledWith('scan-1', 'd0', 'size', 'desc', 0, 200)
    expect(store.getState().lists['d0']?.total).toBe(3)
    store.getState().requestChunks([{ nodeId: 'd0', chunk: 0 }])
    await flush()
    expect(api.getChildren).toHaveBeenCalledTimes(1)
  })

  it('reloads a chunk after the revision changes', async () => {
    const { api, store } = await scanning()
    store.getState().requestChunks([{ nodeId: 'd0', chunk: 0 }])
    await flush()
    api.emitScanProgress(makeProgress())
    store.getState().requestChunks([{ nodeId: 'd0', chunk: 0 }])
    await flush()
    expect(api.getChildren).toHaveBeenCalledTimes(2)
  })

  it('sorts by a column, reverses on a second click and follows the Mode for % of Parent', async () => {
    const { store } = await scanning()
    expect(effectiveSort(store.getState())).toEqual({ key: 'size', dir: 'desc' })
    store.getState().sortBy('name')
    expect(effectiveSort(store.getState())).toEqual({ key: 'name', dir: 'asc' })
    store.getState().sortBy('name')
    expect(effectiveSort(store.getState())).toEqual({ key: 'name', dir: 'desc' })
    store.getState().sortBy('percent')
    store.getState().setMode('allocated')
    expect(effectiveSort(store.getState())).toEqual({ key: 'allocated', dir: 'desc' })
    store.getState().sortBy('percent')
    expect(effectiveSort(store.getState())).toEqual({ key: 'allocated', dir: 'asc' })
    expect(store.getState().lists).toEqual({})
  })

  it('expands to a number of levels with the ids the scanner returns', async () => {
    const { api, store } = await scanning()
    await store.getState().expandLevels(2)
    expect(api.getExpandIds).toHaveBeenCalledWith('scan-1', 'd0', 2)
    expect([...store.getState().expanded]).toEqual(['d0', 'd1'])
  })

  it('selecting a row in the tree points the treemap at it', async () => {
    const { store } = await scanning()
    store.getState().select('d1')
    expect(store.getState()).toMatchObject({ selectedId: 'd1', treemapRootId: 'd1' })
  })

  it('reveal expands the ancestors, loads the row and scrolls to it without moving the treemap', async () => {
    const { store } = await scanning()
    await store.getState().reveal('f1')
    expect([...store.getState().expanded].sort()).toEqual(['d0', 'd1', 'g1'])
    expect(store.getState().lists['g1']?.chunks[0]?.rows[0]?.id).toBe('f1')
    expect(store.getState()).toMatchObject({
      selectedId: 'f1',
      treemapRootId: 'd0',
      scrollTarget: { id: 'f1', seq: 1 },
    })
  })

  it('drillInto shows the folder in the treemap; files cannot be drilled into', async () => {
    const { store } = await scanning()
    await store.getState().drillInto('d1')
    expect(store.getState()).toMatchObject({ selectedId: 'd1', treemapRootId: 'd1' })
    await store.getState().drillInto('f1')
    expect(store.getState().treemapRootId).toBe('d1')
  })
})

describe('actions on a row', () => {
  it('copies the path through main and announces it', async () => {
    const { api, store } = await scanning()
    await store.getState().copyPath('d1')
    expect(api.writeClipboardText).toHaveBeenCalledWith('D:\\Videos')
    expect(store.getState().announcement).toBe(PATH_COPIED)
  })

  it('opens the Explorer context menu at the given point and handles its outcome', async () => {
    const api = createFakeApi({
      showContextMenu: vi.fn(async () => ({
        kind: 'created' as const,
        nodeId: 'd1',
        name: 'New folder',
      })),
    })
    const { store } = await scanning(api)
    await store.getState().showContextMenu('d1', 10.6, 20.2, true)
    expect(api.showContextMenu).toHaveBeenCalledWith('scan-1', 'd1', 11, 20, true)
    expect(store.getState().announcement).toBe('Created “New folder”.')
  })

  it('creates a folder, opens in Explorer, and reports failures', async () => {
    const api = createFakeApi({
      openInExplorer: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "Error invoking remote method 'shell:open-in-explorer': Error: Access is denied.",
          ),
        ),
    })
    const { store } = await scanning(api)
    await store.getState().createFolder('d1')
    expect(api.createFolder).toHaveBeenCalledWith('scan-1', 'd1')
    await store.getState().openInExplorer('d1')
    expect(store.getState().banner).toEqual({
      tone: 'error',
      message: 'StorageIQ couldn’t do that: Access is denied.',
    })
  })

  it('lays out the treemap of the treemap root with the Mode and depth', async () => {
    const { api, store } = await scanning()
    store.getState().setTreemapDepth(9)
    store.getState().setMode('files')
    const layout = await store.getState().fetchTreemap(400.4, 200)
    expect(api.getTreemap).toHaveBeenCalledWith('scan-1', 'd0', 'files', 5, 400, 200)
    expect(layout?.rects).toHaveLength(2)
    store.getState().setTreemapVisible(false)
    expect(store.getState().treemapVisible).toBe(false)
  })

  it('quits through main', async () => {
    const api = createFakeApi()
    await createWorkspaceStore(api).getState().quit()
    expect(api.quit).toHaveBeenCalled()
  })
})

describe('helpers', () => {
  it('driveRootOf and actionError', () => {
    expect(driveRootOf('d:\\Photos')).toBe('D:\\')
    expect(driveRootOf('\\\\srv\\x')).toBeNull()
    expect(actionError('x')).toBe('StorageIQ couldn’t do that.')
  })
})
```

`src/renderer/src/stores/workspace-store.ts`:

```ts
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { ContextMenuOutcome, StorageIQApi } from '@shared/ipc-contract'
import type {
  DriveDetails,
  DriveInfo,
  Places,
  ScanDone,
  ScanError,
  ScanFailed,
  ScanProgress,
  ScanStartResult,
} from '@shared/scan-types'
import {
  MAX_TREEMAP_DEPTH,
  modeSortKey,
  ROOT_NODE_ID,
  type NodeId,
  type SizeMode,
  type SortDir,
  type SortKey,
  type TreeChanged,
  type TreemapLayout,
} from '@shared/tree-types'
import type { SizeUnit } from '../lib/format'
import { CHUNK_SIZE, type ChildLists, type ChunkRef, rowInList } from '../lib/tree-view-model'

/** `empty → scanning → done | canceled | failed`; any state can scan again. */
export type ScanPhase = 'empty' | 'scanning' | 'done' | 'canceled' | 'failed'

/** Column ids of the tree. "% of Parent" sorts by the Mode value. */
export type ColumnId = 'name' | 'size' | 'allocated' | 'files' | 'folders' | 'percent' | 'modified'

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface ScanTotals {
  files: number
  folders: number
  bytes: number
  allocatedBytes: number
  errorCount: number
}

export interface Banner {
  tone: 'error' | 'crash'
  message: string
}

export const FOLDER_PICKER_ERROR = 'StorageIQ couldn’t open the folder picker. Please try again.'
export const START_SCAN_ERROR =
  'StorageIQ couldn’t start a scan of that location. Please choose another one.'
export const NETWORK_PATH_ERROR =
  'StorageIQ can’t scan network locations. Please choose a drive or a folder on this PC.'
export const SCAN_CRASH_MESSAGE = 'The scan stopped unexpectedly. You can try again.'
export const PATH_COPIED = 'Path copied.'
export const EXPAND_ALL_LEVELS = 64
export const DEFAULT_TREEMAP_DEPTH = 1

const EMPTY_TOTALS: ScanTotals = {
  files: 0,
  folders: 0,
  bytes: 0,
  allocatedBytes: 0,
  errorCount: 0,
}

export function actionError(error: unknown): string {
  const detail =
    error instanceof Error
      ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      : ''
  return detail === '' ? 'StorageIQ couldn’t do that.' : `StorageIQ couldn’t do that: ${detail}`
}

export function isNetworkPath(target: string): boolean {
  return target.startsWith('\\\\') || target.startsWith('//')
}

/** `C:\Users\Ana` → `C:\`. */
export function driveRootOf(target: string): string | null {
  const match = /^([A-Za-z]):/.exec(target)
  return match === null ? null : `${(match[1] ?? '').toUpperCase()}:\\`
}

export interface WorkspaceState {
  phase: ScanPhase
  /** The drive or folder being scanned, or scanned last. */
  target: string | null
  /** Known once `scan:start` returns. */
  scanId: string | null
  totals: ScanTotals
  /** The first unreadable entries (at most 1000); `totals.errorCount` is the exact count. */
  errors: ScanError[]
  elapsedMs: number
  drive: DriveDetails | null
  drives: DriveInfo[]
  places: Places
  menuDataStatus: LoadStatus
  mode: SizeMode
  unit: SizeUnit
  /** null sorts by the Mode value. */
  sortColumn: ColumnId | null
  sortDir: SortDir
  lists: ChildLists
  expanded: ReadonlySet<NodeId>
  selectedId: NodeId | null
  /** Ask the tree to scroll a row into view (seq changes on every request). */
  scrollTarget: { id: NodeId; seq: number } | null
  /** Bumps whenever the scanner's tree may have changed; loaded chunks older than it reload. */
  revision: number
  treemapVisible: boolean
  treemapDepth: number
  /** The folder the treemap shows. */
  treemapRootId: NodeId | null
  banner: Banner | null
  /** Short polite message for screen readers (copied, created, …). */
  announcement: string
  folderPickerOpen: boolean

  loadMenuData(): Promise<void>
  chooseFolder(): Promise<void>
  startScan(target: string): Promise<void>
  stopScan(): Promise<void>
  rescan(): Promise<void>
  setMode(mode: SizeMode): void
  setUnit(unit: SizeUnit): void
  sortBy(column: ColumnId): void
  setExpanded(id: NodeId, open: boolean): void
  expandLevels(levels: number): Promise<void>
  select(id: NodeId): void
  /** Selects a row that may be hidden: expands its ancestors and loads its chunk. */
  reveal(id: NodeId): Promise<void>
  /** Treemap double-click: reveal the row and show its children in the treemap. */
  drillInto(id: NodeId): Promise<void>
  requestChunks(refs: readonly ChunkRef[]): void
  openInExplorer(id: NodeId): Promise<void>
  copyPath(id: NodeId): Promise<void>
  showContextMenu(id: NodeId, x: number, y: number, extended: boolean): Promise<void>
  createFolder(id: NodeId): Promise<void>
  /** Lays out the treemap of `treemapRootId` for a canvas of `width` × `height` CSS px. */
  fetchTreemap(width: number, height: number): Promise<TreemapLayout | null>
  setTreemapDepth(depth: number): void
  setTreemapVisible(visible: boolean): void
  dismissBanner(): void
  quit(): Promise<void>
}

export type WorkspaceStore = StoreApi<WorkspaceState> & { dispose(): void }

/** The sort the scanner is asked for. */
export function effectiveSort(state: Pick<WorkspaceState, 'sortColumn' | 'sortDir' | 'mode'>): {
  key: SortKey
  dir: SortDir
} {
  const column = state.sortColumn
  if (column === null || column === 'percent')
    return { key: modeSortKey(state.mode), dir: state.sortDir }
  return { key: column, dir: state.sortDir }
}

type ScanEvent =
  | { kind: 'progress'; payload: ScanProgress }
  | { kind: 'done'; payload: ScanDone }
  | { kind: 'failed'; payload: ScanFailed }

export function createWorkspaceStore(api: StorageIQApi): WorkspaceStore {
  /** Events that arrived while `scan:start` was still in flight (scan ID not known yet). */
  let early: ScanEvent[] = []
  let cancelWhenStarted = false
  const inFlight = new Set<string>()
  /** Changes whenever the lists are thrown away (new scan, new sort); stale replies are dropped. */
  let generation = 0

  const store = createStore<WorkspaceState>()((set, get) => {
    const fail = (error: unknown) => set({ banner: { tone: 'error', message: actionError(error) } })

    const loadDrive = (target: string) => {
      const root = driveRootOf(target)
      if (root === null) return
      api.getDriveInfo(root).then(
        (drive) => {
          if (get().target === target) set({ drive })
        },
        () => undefined,
      )
    }

    /** Fetches one chunk of a row's children into `lists`. */
    const fetchChunk = async (nodeId: NodeId, chunk: number): Promise<void> => {
      const { scanId, revision } = get()
      if (scanId === null) return
      const key = `${nodeId}:${chunk}`
      if (inFlight.has(key)) return
      inFlight.add(key)
      const startedGeneration = generation
      const { key: sortKey, dir } = effectiveSort(get())
      try {
        const page = await api.getChildren(
          scanId,
          nodeId,
          sortKey,
          dir,
          chunk * CHUNK_SIZE,
          CHUNK_SIZE,
        )
        if (startedGeneration !== generation || get().scanId !== scanId) return
        const lists = { ...get().lists }
        if (page === null) {
          delete lists[nodeId]
        } else {
          const old = lists[nodeId]
          lists[nodeId] = {
            parent: page.parent,
            total: page.total,
            chunks: { ...(old?.chunks ?? {}), [chunk]: { rows: page.rows, revision } },
          }
        }
        set({ lists })
      } catch {
        // The scanner is gone or busy; the next revision asks again.
      } finally {
        inFlight.delete(key)
      }
    }

    const findRow = (id: NodeId) => {
      for (const list of Object.values(get().lists)) {
        if (list.parent.id === id) return list.parent
        for (const chunk of Object.values(list.chunks)) {
          const row = chunk.rows.find((candidate) => candidate.id === id)
          if (row) return row
        }
      }
      return null
    }

    /** The treemap shows a folder or a "[N files]" row; a file shows its own group. */
    const treemapRootFor = (id: NodeId): NodeId => {
      if (!id.startsWith('f')) return id
      return findRow(id)?.parentId ?? get().treemapRootId ?? ROOT_NODE_ID
    }

    const resetTree = () => {
      generation += 1
      inFlight.clear()
      set({ lists: {} })
    }

    const handleOutcome = (outcome: ContextMenuOutcome) => {
      if (outcome.kind === 'copied') set({ announcement: PATH_COPIED })
      if (outcome.kind === 'created') set({ announcement: `Created “${outcome.name}”.` })
      if (outcome.kind === 'opened') set({ announcement: 'Opened in Explorer.' })
    }

    return {
      phase: 'empty',
      target: null,
      scanId: null,
      totals: EMPTY_TOTALS,
      errors: [],
      elapsedMs: 0,
      drive: null,
      drives: [],
      places: { places: [], recent: [] },
      menuDataStatus: 'idle',
      mode: 'size',
      unit: 'auto',
      sortColumn: null,
      sortDir: 'desc',
      lists: {},
      expanded: new Set<NodeId>(),
      selectedId: null,
      scrollTarget: null,
      revision: 0,
      treemapVisible: true,
      treemapDepth: DEFAULT_TREEMAP_DEPTH,
      treemapRootId: null,
      banner: null,
      announcement: '',
      folderPickerOpen: false,

      async loadMenuData() {
        if (get().menuDataStatus === 'loading') return
        set({ menuDataStatus: 'loading' })
        const [drives, places] = await Promise.allSettled([api.listDrives(), api.listPlaces()])
        set({
          drives: drives.status === 'fulfilled' ? drives.value : [],
          places: places.status === 'fulfilled' ? places.value : { places: [], recent: [] },
          menuDataStatus:
            drives.status === 'fulfilled' && places.status === 'fulfilled' ? 'ready' : 'error',
        })
      },

      async chooseFolder() {
        if (get().folderPickerOpen) return
        set({ folderPickerOpen: true })
        let picked: string | null
        try {
          const result = await api.selectFolder()
          picked = result.canceled ? null : result.path
        } catch {
          set({ folderPickerOpen: false, banner: { tone: 'error', message: FOLDER_PICKER_ERROR } })
          return
        }
        set({ folderPickerOpen: false })
        if (picked !== null) await get().startScan(picked)
      },

      async startScan(target) {
        if (isNetworkPath(target)) {
          set({ banner: { tone: 'error', message: NETWORK_PATH_ERROR } })
          return
        }
        early = []
        cancelWhenStarted = false
        resetTree()
        set({
          phase: 'scanning',
          target,
          scanId: null,
          totals: EMPTY_TOTALS,
          errors: [],
          elapsedMs: 0,
          drive: null,
          expanded: new Set([ROOT_NODE_ID]),
          selectedId: ROOT_NODE_ID,
          scrollTarget: null,
          treemapRootId: ROOT_NODE_ID,
          banner: null,
          revision: get().revision + 1,
        })
        loadDrive(target)
        let started: ScanStartResult
        try {
          started = await api.startScan(target)
        } catch {
          set({
            phase: 'empty',
            target: null,
            banner: { tone: 'error', message: START_SCAN_ERROR },
          })
          return
        }
        if (get().target !== target || get().scanId !== null) return // superseded meanwhile
        set({ scanId: started.scanId })
        const pending = early
        early = []
        for (const event of pending) applyEvent(event)
        if (cancelWhenStarted && get().phase === 'scanning') {
          await api.cancelScan(started.scanId).catch(() => undefined)
        }
        void get().loadMenuData() // "Recently scanned" now includes this path
      },

      async stopScan() {
        const { phase, scanId } = get()
        if (phase !== 'scanning') return
        if (scanId === null) {
          cancelWhenStarted = true
          return
        }
        try {
          await api.cancelScan(scanId)
        } catch (error) {
          fail(error)
        }
      },

      async rescan() {
        const { target, phase } = get()
        if (target !== null && phase !== 'scanning') await get().startScan(target)
      },

      setMode(mode) {
        if (get().mode === mode) return
        const byMode = get().sortColumn === null || get().sortColumn === 'percent'
        set({ mode })
        if (byMode) {
          resetTree()
          set({ revision: get().revision + 1 })
        }
      },

      setUnit(unit) {
        set({ unit })
      },

      sortBy(column) {
        const { sortColumn, sortDir } = get()
        const same = sortColumn === column || (sortColumn === null && column === 'percent')
        const dir: SortDir = same
          ? sortDir === 'desc'
            ? 'asc'
            : 'desc'
          : column === 'name'
            ? 'asc'
            : 'desc'
        resetTree()
        set({ sortColumn: column, sortDir: dir, revision: get().revision + 1 })
      },

      setExpanded(id, open) {
        const expanded = new Set(get().expanded)
        if (open) expanded.add(id)
        else expanded.delete(id)
        set({ expanded })
      },

      async expandLevels(levels) {
        const { scanId } = get()
        if (scanId === null) return
        try {
          const ids = await api.getExpandIds(scanId, ROOT_NODE_ID, levels)
          if (get().scanId === scanId) set({ expanded: new Set(ids) })
        } catch (error) {
          fail(error)
        }
      },

      select(id) {
        set({ selectedId: id, treemapRootId: treemapRootFor(id) })
      },

      async reveal(id) {
        const { scanId } = get()
        if (scanId === null) return
        const { key, dir } = effectiveSort(get())
        let details
        try {
          details = await api.getNode(scanId, id, key, dir)
        } catch (error) {
          fail(error)
          return
        }
        if (details === null || get().scanId !== scanId) return
        const expanded = new Set(get().expanded)
        for (const ancestor of details.ancestorIds) expanded.add(ancestor)
        set({ expanded })
        await Promise.all(
          details.locations
            .filter((location) => {
              const list = get().lists[location.parentId]
              return rowInList(list, location.index) === null
            })
            .map((location) =>
              fetchChunk(location.parentId, Math.floor(location.index / CHUNK_SIZE)),
            ),
        )
        const seq = (get().scrollTarget?.seq ?? 0) + 1
        set({ selectedId: id, scrollTarget: { id, seq } })
      },

      async drillInto(id) {
        if (id.startsWith('f')) return
        await get().reveal(id)
        set({ treemapRootId: id })
      },

      requestChunks(refs) {
        const { lists, revision } = get()
        for (const ref of refs) {
          const chunk = lists[ref.nodeId]?.chunks[ref.chunk]
          if (chunk !== undefined && chunk.revision === revision) continue
          void fetchChunk(ref.nodeId, ref.chunk)
        }
      },

      async openInExplorer(id) {
        const { scanId } = get()
        if (scanId === null) return
        try {
          await api.openInExplorer(scanId, id)
        } catch (error) {
          fail(error)
        }
      },

      async copyPath(id) {
        const { scanId } = get()
        if (scanId === null) return
        try {
          const details = await api.getNode(scanId, id, 'name', 'asc')
          if (details === null) return
          await api.writeClipboardText(details.path)
          set({ announcement: PATH_COPIED })
        } catch (error) {
          fail(error)
        }
      },

      async showContextMenu(id, x, y, extended) {
        const { scanId } = get()
        if (scanId === null) return
        try {
          handleOutcome(
            await api.showContextMenu(
              scanId,
              id,
              Math.max(0, Math.round(x)),
              Math.max(0, Math.round(y)),
              extended,
            ),
          )
        } catch (error) {
          fail(error)
        }
      },

      async createFolder(id) {
        const { scanId } = get()
        if (scanId === null) return
        try {
          const created = await api.createFolder(scanId, id)
          set({ announcement: `Created “${created.name}”.` })
        } catch (error) {
          fail(error)
        }
      },

      async fetchTreemap(width, height) {
        const { scanId, treemapRootId, mode, treemapDepth } = get()
        if (scanId === null || treemapRootId === null || width < 1 || height < 1) return null
        try {
          return await api.getTreemap(
            scanId,
            treemapRootId,
            mode,
            treemapDepth,
            Math.round(width),
            Math.round(height),
          )
        } catch {
          return null
        }
      },

      setTreemapDepth(depth) {
        set({ treemapDepth: Math.max(0, Math.min(MAX_TREEMAP_DEPTH, Math.round(depth))) })
      },

      setTreemapVisible(visible) {
        set({ treemapVisible: visible })
      },

      dismissBanner() {
        set({ banner: null })
      },

      async quit() {
        await api.quit()
      },
    }
  })

  function applyEvent(event: ScanEvent): void {
    const { phase, scanId } = store.getState()
    if (phase !== 'scanning') return
    if (scanId === null) {
      early.push(event)
      return
    }
    if (event.payload.scanId !== scanId) return
    const revision = store.getState().revision + 1
    if (event.kind === 'progress') {
      const { files, folders, bytes, allocatedBytes, errorCount, elapsedMs } = event.payload
      store.setState({
        totals: { files, folders, bytes, allocatedBytes, errorCount },
        elapsedMs,
        revision,
      })
    } else if (event.kind === 'done') {
      const { files, folders, bytes, allocatedBytes, errorCount, elapsedMs, errors, status } =
        event.payload
      store.setState({
        phase: status === 'complete' ? 'done' : 'canceled',
        totals: { files, folders, bytes, allocatedBytes, errorCount },
        errors,
        elapsedMs,
        revision,
      })
      const { target } = store.getState()
      const root = target === null ? null : driveRootOf(target)
      if (root !== null) {
        api.getDriveInfo(root).then(
          (drive) => {
            if (store.getState().target === target) store.setState({ drive })
          },
          () => undefined,
        )
      }
    } else {
      store.setState({ phase: 'failed', banner: { tone: 'crash', message: SCAN_CRASH_MESSAGE } })
    }
  }

  function applyTreeChanged(changed: TreeChanged): void {
    const state = store.getState()
    if (changed.scanId !== state.scanId) return
    store.setState({
      totals: { ...changed.totals, errorCount: state.totals.errorCount },
      revision: state.revision + 1,
    })
    const root = state.target === null ? null : driveRootOf(state.target)
    if (root !== null) {
      api.getDriveInfo(root).then(
        (drive) => store.setState({ drive }),
        () => undefined,
      )
    }
  }

  const unsubscribers = [
    api.onScanProgress((payload) => applyEvent({ kind: 'progress', payload })),
    api.onScanDone((payload) => applyEvent({ kind: 'done', payload })),
    api.onScanFailed((payload) => applyEvent({ kind: 'failed', payload })),
    api.onTreeChanged(applyTreeChanged),
  ]

  return Object.assign(store, {
    dispose() {
      for (const unsubscribe of unsubscribers) unsubscribe()
    },
  })
}
```

`src/renderer/src/stores/workspace-store-context.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useWorkspace } from './workspace-store-context'

function Probe() {
  useWorkspace((s) => s.phase)
  return null
}

describe('useWorkspace', () => {
  it('throws outside <WorkspaceStoreProvider>', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => render(<Probe />)).toThrow(
      'useWorkspace must be used inside <WorkspaceStoreProvider>',
    )
    consoleError.mockRestore()
  })
})
```

`src/renderer/src/stores/workspace-store-context.tsx`:

```tsx
import { createContext, type ReactNode, useContext } from 'react'
import { useStore } from 'zustand'
import type { WorkspaceState, WorkspaceStore } from './workspace-store'

const WorkspaceStoreContext = createContext<WorkspaceStore | null>(null)

export function WorkspaceStoreProvider({
  store,
  children,
}: {
  store: WorkspaceStore
  children: ReactNode
}) {
  return <WorkspaceStoreContext.Provider value={store}>{children}</WorkspaceStoreContext.Provider>
}

/**
 * Subscribe to a slice of the workspace store. The selector must return a primitive or a stable
 * reference; returning a fresh object or array every call makes React re-render in a loop.
 */
export function useWorkspace<T>(selector: (state: WorkspaceState) => T): T {
  const store = useContext(WorkspaceStoreContext)
  if (!store) {
    throw new Error('useWorkspace must be used inside <WorkspaceStoreProvider>')
  }
  return useStore(store, selector)
}

/** The store itself, for event handlers that read the latest state without subscribing. */
export function useWorkspaceStore(): WorkspaceStore {
  const store = useContext(WorkspaceStoreContext)
  if (!store) {
    throw new Error('useWorkspace must be used inside <WorkspaceStoreProvider>')
  }
  return store
}
```

- [ ] **Step 5: Remove the 2a scan store and screens**

```powershell
git rm src/renderer/src/stores/scan-store.ts src/renderer/src/stores/scan-store.test.ts src/renderer/src/stores/scan-store-context.tsx src/renderer/src/stores/scan-store-context.test.tsx
git rm src/renderer/src/components/PickLocationScreen.tsx src/renderer/src/components/PickLocationScreen.test.tsx src/renderer/src/components/ScanningScreen.tsx src/renderer/src/components/ScanningScreen.test.tsx src/renderer/src/components/ResultScreen.tsx src/renderer/src/components/ResultScreen.test.tsx src/renderer/src/components/CrashScreen.tsx src/renderer/src/components/CrashScreen.test.tsx src/renderer/src/components/DriveCard.tsx src/renderer/src/components/FolderBars.tsx src/renderer/src/components/Stat.tsx
```

`App.tsx`, `main.tsx` and `App.test.tsx` still import them until Task 8 replaces those files (expected).

- [ ] **Step 6: `focusgroup` attribute type and its fallback**

`src/renderer/src/env.d.ts`:

```ts
/// <reference types="vite/client" />
import type { StorageIQApi } from '@shared/ipc-contract'

declare global {
  interface Window {
    storageiq: StorageIQApi
  }
}

// The HTML `focusgroup` attribute (arrow-key navigation for toolbars, tab lists and menus).
// Chromium 150+ supports it; React passes unknown lower-case attributes through.
declare module 'react' {
  // `T` must match React's own declaration for the interfaces to merge.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface HTMLAttributes<T> {
    focusgroup?: string
  }
}

export {}
```

`src/renderer/src/lib/use-focusgroup.ts`:

```ts
import { type RefObject, useEffect } from 'react'

export type FocusgroupKind = 'toolbar' | 'tablist' | 'menu'

/** True when the browser provides `focusgroup` natively (Chromium 150+; Electron 45 has 156). */
export function hasNativeFocusgroup(): boolean {
  return typeof HTMLElement !== 'undefined' && 'focusGroup' in HTMLElement.prototype
}

const ITEM_SELECTOR = 'button:not([disabled])'

/**
 * Fallback for the `focusgroup` attribute (modern-web-guidance "toolbar", "tabs" and "menu"):
 * one tab stop (roving `tabindex`), arrow keys move between items and wrap, Home/End jump to
 * the ends. Installed only when native focusgroup is missing (for example in jsdom), so the
 * browser's own behaviour is never doubled. `items` are the container's own buttons, not
 * those of a nested group with its own focusgroup.
 */
export function useFocusgroupFallback(
  ref: RefObject<HTMLElement | null>,
  kind: FocusgroupKind,
  /** Change this when the set of items changes (for example a menu's item count). */
  itemsKey: unknown = null,
): void {
  useEffect(() => {
    const container = ref.current
    if (container === null || hasNativeFocusgroup()) return
    const items = () =>
      [...container.querySelectorAll<HTMLElement>(ITEM_SELECTOR)].filter(
        (item) => item.closest('[focusgroup]') === container,
      )
    const roving = kind !== 'menu'
    if (roving) {
      const all = items()
      const active =
        all.find((item) => item.getAttribute('aria-selected') === 'true') ?? all[0] ?? null
      for (const item of all) item.tabIndex = item === active ? 0 : -1
    }
    const onFocusIn = (event: FocusEvent) => {
      if (!roving) return
      const all = items()
      if (!all.includes(event.target as HTMLElement)) return
      for (const item of all) item.tabIndex = item === event.target ? 0 : -1
    }
    const vertical = kind === 'menu'
    const onKeyDown = (event: KeyboardEvent) => {
      const all = items()
      const current = all.indexOf(document.activeElement as HTMLElement)
      if (current === -1) return
      const step =
        event.key === (vertical ? 'ArrowDown' : 'ArrowRight')
          ? 1
          : event.key === (vertical ? 'ArrowUp' : 'ArrowLeft')
            ? -1
            : 0
      let next = -1
      if (step !== 0) next = (current + step + all.length) % all.length
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = all.length - 1
      if (next === -1) return
      event.preventDefault()
      all[next]?.focus()
    }
    container.addEventListener('focusin', onFocusIn)
    container.addEventListener('keydown', onKeyDown)
    return () => {
      container.removeEventListener('focusin', onFocusIn)
      container.removeEventListener('keydown', onKeyDown)
    }
  }, [ref, kind, itemsKey])
}
```

- [ ] **Step 7: Menu button and Select menu**

`src/renderer/src/components/MenuButton.tsx`:

```tsx
import type { LucideIcon } from 'lucide-react'
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useFocusgroupFallback } from '../lib/use-focusgroup'

export interface MenuEntry {
  id: string
  label: string
  icon?: LucideIcon
  /** Extra text at the end of the item, for example a drive letter. */
  hint?: string
  disabled?: boolean
  onSelect(): void
}

export interface MenuSection {
  id: string
  /** Visible group heading; also the group's accessible name. */
  label?: string
  entries: MenuEntry[]
  /** Shown as a disabled item when `entries` is empty, for example "(none)". */
  emptyText?: string
}

export interface MenuButtonProps {
  /** Accessible name of the menu (the trigger's visible text names the trigger). */
  menuLabel: string
  sections: MenuSection[]
  /** Called before the menu opens (for example to refresh the drive list). */
  onOpen?(): void
  className?: string
  disabled?: boolean
  title?: string
  children: ReactNode
}

const MENU_GAP = 2

/** jsdom has no Popover API; there the popup is a plain fixed element. */
const supportsPopover = () =>
  typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function'

/**
 * A menu button (modern-web-guidance "menu"): Enter, Space or click toggles; ArrowDown opens
 * and enters; a keyboard open focuses the first item, a pointer open keeps focus on the
 * trigger; Escape closes and returns focus; Tab and an outside click close. The popup is a
 * `popover="manual"` element in the top layer, placed below its trigger from script (Electron
 * 45's Chromium has no CSS anchor positioning) and flipped above when there is no room.
 * Arrow keys come from native `focusgroup="menu"`, with a script fallback.
 */
export function MenuButton({
  menuLabel,
  sections,
  onOpen,
  className = '',
  disabled = false,
  title,
  children,
}: MenuButtonProps) {
  const [open, setOpen] = useState(false)
  const enterOnOpen = useRef(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const itemCount = sections.reduce((sum, s) => sum + Math.max(1, s.entries.length), 0)
  useFocusgroupFallback(listRef, 'menu', `${open}:${itemCount}`)

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  const focusFirstItem = useCallback(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')
      ?.focus()
  }, [])

  const show = (enter: boolean) => {
    if (disabled) return
    enterOnOpen.current = enter
    onOpen?.()
    setOpen(true)
  }

  useLayoutEffect(() => {
    const popup = popupRef.current
    const trigger = triggerRef.current
    if (!open || popup === null || trigger === null) return
    if (typeof popup.showPopover === 'function' && !popup.matches(':popover-open')) {
      popup.showPopover()
    }
    const anchor = trigger.getBoundingClientRect()
    const box = popup.getBoundingClientRect()
    const below = anchor.bottom + MENU_GAP + box.height <= window.innerHeight
    popup.style.top = `${below ? anchor.bottom + MENU_GAP : Math.max(0, anchor.top - MENU_GAP - box.height)}px`
    popup.style.left = `${Math.max(0, Math.min(anchor.left, window.innerWidth - box.width))}px`
    if (enterOnOpen.current) focusFirstItem()
  }, [open, focusFirstItem])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (popupRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      close(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, close])

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
    } else if (event.key === 'Tab') {
      close(false)
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-disabled={disabled ? 'true' : undefined}
        className={className}
        onClick={(event) => {
          if (open) close(false)
          else show(event.detail === 0) // detail 0: Enter or Space, not a pointer
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            // Opens a closed menu and enters it; after a pointer open it enters the open menu.
            event.preventDefault()
            if (!open) show(true)
            else focusFirstItem()
          } else if (event.key === 'Escape' && open) {
            event.preventDefault()
            close(true)
          }
        }}
      >
        {children}
      </button>
      {open && (
        <div
          ref={popupRef}
          id={menuId}
          popover={supportsPopover() ? 'manual' : undefined}
          className="popup-menu z-50 min-w-56 rounded-panel border border-line bg-panel py-1 text-ink shadow-menu"
          onKeyDown={onMenuKeyDown}
        >
          <div ref={listRef} role="menu" aria-label={menuLabel} focusgroup="menu nomemory">
            {sections.map((section, sectionIndex) => (
              <MenuGroup
                key={section.id}
                section={section}
                first={sectionIndex === 0}
                onChoose={(entry) => {
                  close(true)
                  entry.onSelect()
                }}
              />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function MenuGroup({
  section,
  first,
  onChoose,
}: {
  section: MenuSection
  first: boolean
  onChoose(entry: MenuEntry): void
}) {
  const headingId = useId()
  return (
    <>
      {!first && <hr className="my-1 border-line" />}
      <div role="group" aria-labelledby={section.label ? headingId : undefined}>
        {section.label && (
          <div
            id={headingId}
            role="presentation"
            className="px-3 pt-1 pb-0.5 text-xs font-semibold text-ink-muted"
          >
            {section.label}
          </div>
        )}
        {section.entries.length === 0 && section.emptyText !== undefined ? (
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-disabled="true"
            className="flex min-h-8 w-full items-center gap-2 px-3 text-left text-ink-muted"
          >
            <span aria-hidden="true" className="size-4 shrink-0" />
            {section.emptyText}
          </button>
        ) : (
          section.entries.map((entry) => {
            const Icon = entry.icon
            return (
              <button
                key={entry.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={entry.disabled ? 'true' : undefined}
                onClick={() => {
                  if (!entry.disabled) onChoose(entry)
                }}
                className="flex min-h-8 w-full items-center gap-2 px-3 text-left hover:bg-row-hover focus-visible:bg-row-hover aria-disabled:text-ink-muted aria-disabled:hover:bg-transparent"
              >
                {Icon ? (
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                ) : (
                  <span aria-hidden="true" className="size-4 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                {entry.hint && (
                  <span aria-hidden="true" className="ml-4 text-xs text-ink-muted">
                    {entry.hint}
                  </span>
                )}
              </button>
            )
          })
        )}
      </div>
    </>
  )
}
```

`src/renderer/src/components/SelectMenu.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createFakeApi, TEST_PLACES } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { SelectMenu } from './SelectMenu'

async function openMenu(api = createFakeApi()) {
  const user = userEvent.setup()
  const utils = renderWithStores(<SelectMenu />, api)
  await user.click(screen.getByRole('button', { name: /^Select/ }))
  const menu = await screen.findByRole('menu', { name: 'Select a drive or folder' })
  await within(menu).findByRole('menuitem', { name: 'Local Disk (C:)' })
  return { ...utils, user, menu }
}

describe('<SelectMenu />', () => {
  it('lists drives, Documents and cloud, recent scans and the folder picker in groups', async () => {
    const { menu } = await openMenu()
    const groups = within(menu).getAllByRole('group')
    expect(groups.map((group) => group.getAttribute('aria-labelledby') !== null)).toEqual([
      true,
      true,
      true,
      true,
    ])
    expect(within(menu).getByRole('group', { name: 'Drives' })).toHaveTextContent(
      'Local Disk (C:)Photos (E:)',
    )
    expect(within(menu).getByRole('group', { name: 'Documents and cloud' })).toHaveTextContent(
      'DocumentsOneDrive',
    )
    const recent = within(menu).getByRole('group', { name: 'Recently scanned' })
    expect(within(recent).getByRole('menuitem', { name: '(none)' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(within(menu).getByRole('menuitem', { name: 'Choose a folder…' })).toBeInTheDocument()
  })

  it('keeps focus on the trigger after a pointer open', async () => {
    await openMenu()
    expect(screen.getByRole('button', { name: /^Select/ })).toHaveFocus()
    expect(screen.getByRole('button', { name: /^Select/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('scans a drive, a place or a recent path', async () => {
    const api = createFakeApi({
      listPlaces: vi.fn(async () => ({ ...TEST_PLACES, recent: ['D:\\Old scan'] })),
    })
    const { user } = await openMenu(api)
    await user.click(screen.getByRole('menuitem', { name: 'Photos (E:)' }))
    expect(api.startScan).toHaveBeenCalledWith('E:\\')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Select/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'OneDrive' }))
    expect(api.startScan).toHaveBeenLastCalledWith('C:\\Users\\Ana\\OneDrive')

    await user.click(screen.getByRole('button', { name: /^Select/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'D:\\Old scan' }))
    expect(api.startScan).toHaveBeenLastCalledWith('D:\\Old scan')
  })

  it('opens the folder picker from "Choose a folder…"', async () => {
    const api = createFakeApi({
      selectFolder: vi.fn().mockResolvedValue({ canceled: false, path: 'D:\\Projects' }),
    })
    const { user } = await openMenu(api)
    await user.click(screen.getByRole('menuitem', { name: 'Choose a folder…' }))
    await waitFor(() => expect(api.startScan).toHaveBeenCalledWith('D:\\Projects'))
  })

  it('opens from the keyboard into the first item, moves with arrows and closes with Escape', async () => {
    const user = userEvent.setup()
    const { workspace } = renderWithStores(<SelectMenu />)
    await act(() => workspace.getState().loadMenuData()) // the app loads it at startup
    const trigger = screen.getByRole('button', { name: /^Select/ })
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    const first = await screen.findByRole('menuitem', { name: 'Local Disk (C:)' })
    await waitFor(() => expect(first).toHaveFocus())
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Photos (E:)' })).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByRole('menuitem', { name: 'Choose a folder…' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('after a pointer open, ArrowDown enters the menu and Escape closes it', async () => {
    const { user } = await openMenu()
    const trigger = screen.getByRole('button', { name: /^Select/ })
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Local Disk (C:)' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on an outside click', async () => {
    const { user } = await openMenu()
    await user.click(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
```

`src/renderer/src/components/SelectMenu.tsx`:

```tsx
import { ChevronDown, Clock, Cloud, FileText, FolderSearch, HardDrive, Usb } from 'lucide-react'
import { useWorkspace } from '../stores/workspace-store-context'
import { MenuButton, type MenuSection } from './MenuButton'
import { RIBBON_BUTTON_CLASS } from './RibbonButton'

/** Ribbon "Select" button: drives, Documents and cloud, recently scanned, choose a folder. */
export function SelectMenu() {
  const drives = useWorkspace((s) => s.drives)
  const places = useWorkspace((s) => s.places)
  const loadMenuData = useWorkspace((s) => s.loadMenuData)
  const startScan = useWorkspace((s) => s.startScan)
  const chooseFolder = useWorkspace((s) => s.chooseFolder)
  const folderPickerOpen = useWorkspace((s) => s.folderPickerOpen)

  const sections: MenuSection[] = [
    {
      id: 'drives',
      label: 'Drives',
      emptyText: '(none)',
      entries: drives.map((drive) => ({
        id: drive.root,
        label: `${drive.label} (${drive.root.slice(0, 2)})`,
        icon: drive.kind === 'removable' ? Usb : HardDrive,
        onSelect: () => void startScan(drive.root),
      })),
    },
    {
      id: 'places',
      label: 'Documents and cloud',
      emptyText: '(none)',
      entries: places.places.map((place) => ({
        id: place.path,
        label: place.label,
        icon: place.kind === 'documents' ? FileText : Cloud,
        onSelect: () => void startScan(place.path),
      })),
    },
    {
      id: 'recent',
      label: 'Recently scanned',
      emptyText: '(none)',
      entries: places.recent.map((path) => ({
        id: `recent:${path}`,
        label: path,
        icon: Clock,
        onSelect: () => void startScan(path),
      })),
    },
    {
      id: 'directory',
      label: 'Directory',
      entries: [
        {
          id: 'choose',
          label: 'Choose a folder…',
          icon: FolderSearch,
          disabled: folderPickerOpen,
          onSelect: () => void chooseFolder(),
        },
      ],
    },
  ]

  return (
    <MenuButton
      menuLabel="Select a drive or folder"
      sections={sections}
      onOpen={() => void loadMenuData()}
      className={RIBBON_BUTTON_CLASS}
      title="Choose a drive or folder to scan"
    >
      <FolderSearch aria-hidden="true" className="size-6" />
      <span className="flex items-center gap-0.5">
        Select
        <ChevronDown aria-hidden="true" className="size-3" />
      </span>
    </MenuButton>
  )
}
```

- [ ] **Step 8: Ribbon**

`src/renderer/src/components/RibbonButton.tsx`:

```tsx
import type { LucideIcon } from 'lucide-react'

/** Large ribbon command: icon above a short label (WCAG 2.5.8: well over 24 × 24 px). */
export const RIBBON_BUTTON_CLASS =
  'flex min-h-16 min-w-14 flex-col items-center justify-start gap-1 rounded-control px-2 pt-1.5 pb-1 text-xs text-ink hover:bg-row-hover aria-pressed:bg-pressed aria-pressed:shadow-[inset_0_0_0_1px_var(--accent)] aria-disabled:cursor-default aria-disabled:text-ink-muted aria-disabled:hover:bg-transparent'

/** Small ribbon toggle (the unit buttons). */
export const RIBBON_SMALL_CLASS =
  'min-h-6 min-w-11 rounded-control px-2 text-xs text-ink hover:bg-row-hover aria-pressed:bg-pressed aria-pressed:font-semibold aria-pressed:shadow-[inset_0_0_0_1px_var(--accent)] aria-disabled:text-ink-muted'

export interface RibbonButtonProps {
  label: string
  icon: LucideIcon
  onClick(): void
  /** Toggle buttons pass their state; action buttons leave it undefined. */
  pressed?: boolean
  disabled?: boolean
  /** Tooltip; also the accessible description of what the command does. */
  title?: string
}

/**
 * A ribbon command. Disabled commands use `aria-disabled` so they stay reachable with the
 * arrow keys (modern-web-guidance "toolbar") and ignore clicks.
 */
export function RibbonButton({
  label,
  icon: Icon,
  onClick,
  pressed,
  disabled,
  title,
}: RibbonButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={pressed}
      aria-disabled={disabled ? 'true' : undefined}
      onClick={() => {
        if (!disabled) onClick()
      }}
      className={RIBBON_BUTTON_CLASS}
    >
      <Icon aria-hidden="true" className="size-6" />
      <span>{label}</span>
    </button>
  )
}
```

`src/renderer/src/components/Ribbon.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createFakeApi } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { makeDone } from '../test/scan-fixtures'
import { Ribbon } from './Ribbon'

function renderRibbon(api = createFakeApi()) {
  const onAbout = vi.fn()
  const utils = renderWithStores(<Ribbon onAbout={onAbout} />, api)
  return { ...utils, onAbout }
}

const toolbar = () => screen.getByRole('toolbar')
const command = (name: RegExp | string) => within(toolbar()).getByRole('button', { name })

describe('<Ribbon />', () => {
  it('has File, Home, Scan and View tabs with Home selected', () => {
    renderRibbon()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['File', 'Home', 'Scan', 'View'])
    expect(screen.getByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Home')
    expect(toolbar()).toHaveAccessibleName('Home commands')
  })

  it('groups the Home commands into Scan, Mode, Unit and Folder', () => {
    renderRibbon()
    expect(
      within(toolbar())
        .getAllByRole('group')
        .map((g) => g.getAttribute('aria-labelledby') && g.textContent),
    ).toHaveLength(4)
    for (const name of ['Scan', 'Mode', 'Unit', 'Folder']) {
      expect(within(toolbar()).getByRole('group', { name })).toBeInTheDocument()
    }
    expect(command(/^Select/)).toHaveAttribute('aria-haspopup', 'menu')
    expect(command('Stop')).toHaveAttribute('aria-disabled', 'true')
    expect(command('Refresh')).toHaveAttribute('aria-disabled', 'true')
  })

  it('switches tabs with the arrow keys (selection follows focus)', async () => {
    const user = userEvent.setup()
    renderRibbon()
    screen.getByRole('tab', { name: 'Home' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Scan' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Scan' })).toHaveAttribute('aria-selected', 'true')
    expect(within(toolbar()).getByRole('group', { name: 'Tree' })).toBeInTheDocument()
    await user.keyboard('{ArrowRight}')
    expect(within(toolbar()).getByRole('button', { name: 'Treemap' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('makes the toolbar one tab stop with arrow-key movement', async () => {
    const user = userEvent.setup()
    renderRibbon()
    const select = command(/^Select/)
    expect(select).toHaveAttribute('tabindex', '0')
    expect(command('Stop')).toHaveAttribute('tabindex', '-1')
    select.focus()
    await user.keyboard('{ArrowRight}')
    expect(command('Stop')).toHaveFocus()
  })

  it('toggles the Mode and the Unit', async () => {
    const user = userEvent.setup()
    const { workspace } = renderRibbon()
    expect(command('Size')).toHaveAttribute('aria-pressed', 'true')
    await user.click(command('Allocated'))
    expect(workspace.getState().mode).toBe('allocated')
    expect(command('Allocated')).toHaveAttribute('aria-pressed', 'true')
    expect(command('Size')).toHaveAttribute('aria-pressed', 'false')
    await user.click(command('MB'))
    expect(workspace.getState().unit).toBe('mb')
    expect(command('MB')).toHaveAttribute('aria-pressed', 'true')
  })

  it('enables Stop during a scan and Refresh after it', async () => {
    const user = userEvent.setup()
    const { api, workspace } = renderRibbon()
    await act(() => workspace.getState().startScan('D:\\'))
    expect(command('Stop')).not.toHaveAttribute('aria-disabled')
    await user.click(command('Stop'))
    expect(api.cancelScan).toHaveBeenCalledWith('scan-1')
    act(() => api.emitScanDone(makeDone({ status: 'canceled' })))
    await user.click(command('Refresh'))
    expect(api.startScan).toHaveBeenCalledTimes(2)
  })

  it('expands the tree by levels from the Expand menu', async () => {
    const user = userEvent.setup()
    const { api, workspace } = renderRibbon()
    await act(() => workspace.getState().startScan('D:\\'))
    await user.click(command(/^Expand/))
    await user.click(screen.getByRole('menuitem', { name: '3 levels' }))
    expect(api.getExpandIds).toHaveBeenCalledWith('scan-1', 'd0', 3)
    await user.click(command(/^Expand/))
    await user.click(screen.getByRole('menuitem', { name: 'All levels' }))
    expect(api.getExpandIds).toHaveBeenLastCalledWith('scan-1', 'd0', 64)
  })

  it('opens the selected item in Explorer and creates a folder in it', async () => {
    const user = userEvent.setup()
    const { api, workspace } = renderRibbon()
    await act(() => workspace.getState().startScan('D:\\'))
    act(() => api.emitScanDone(makeDone()))
    await user.click(command('Open in Explorer'))
    expect(api.openInExplorer).toHaveBeenCalledWith('scan-1', 'd0')
    await user.click(command('New folder'))
    expect(api.createFolder).toHaveBeenCalledWith('scan-1', 'd0')
  })

  it('File holds About and Exit; View toggles the treemap', async () => {
    const user = userEvent.setup()
    const { api, onAbout, workspace } = renderRibbon()
    await user.click(screen.getByRole('tab', { name: 'File' }))
    await user.click(command('About'))
    expect(onAbout).toHaveBeenCalled()
    await user.click(command('Exit'))
    expect(api.quit).toHaveBeenCalled()
    await user.click(screen.getByRole('tab', { name: 'View' }))
    await user.click(command('Treemap'))
    expect(workspace.getState().treemapVisible).toBe(false)
  })
})
```

`src/renderer/src/components/Ribbon.tsx`:

```tsx
import {
  ChevronDown,
  FileStack,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Info,
  ListTree,
  LogOut,
  PanelBottom,
  Percent,
  RefreshCw,
  Scale,
  Square,
} from 'lucide-react'
import { type ReactNode, useId, useRef, useState } from 'react'
import type { SizeMode } from '@shared/tree-types'
import { SIZE_UNITS, type SizeUnit } from '../lib/format'
import { useFocusgroupFallback } from '../lib/use-focusgroup'
import { EXPAND_ALL_LEVELS } from '../stores/workspace-store'
import { useWorkspace } from '../stores/workspace-store-context'
import { MenuButton } from './MenuButton'
import { RIBBON_BUTTON_CLASS, RIBBON_SMALL_CLASS, RibbonButton } from './RibbonButton'
import { SelectMenu } from './SelectMenu'

export type RibbonTab = 'file' | 'home' | 'scan' | 'view'

const TABS: Array<{ id: RibbonTab; label: string }> = [
  { id: 'file', label: 'File' },
  { id: 'home', label: 'Home' },
  { id: 'scan', label: 'Scan' },
  { id: 'view', label: 'View' },
]

const MODES: Array<{ mode: SizeMode; label: string; icon: typeof Scale; title: string }> = [
  { mode: 'size', label: 'Size', icon: Scale, title: 'Rank and draw by file size' },
  {
    mode: 'allocated',
    label: 'Allocated',
    icon: HardDrive,
    title: 'Rank and draw by space taken on disk (whole clusters)',
  },
  {
    mode: 'files',
    label: 'File count',
    icon: FileStack,
    title: 'Rank and draw by number of files',
  },
  {
    mode: 'percent',
    label: 'Percent',
    icon: Percent,
    title: 'Show each item’s share of its folder',
  },
]

const UNIT_LABELS: Record<SizeUnit, string> = { auto: 'Auto', gb: 'GB', mb: 'MB', kb: 'KB' }

function Group({ label, children }: { label: string; children: ReactNode }) {
  const captionId = useId()
  return (
    <div
      role="group"
      aria-labelledby={captionId}
      className="flex h-full flex-col justify-between border-r border-line px-1.5 last:border-r-0"
    >
      <div className="flex items-start gap-0.5">{children}</div>
      <span id={captionId} className="pb-0.5 text-center text-xs text-ink-muted">
        {label}
      </span>
    </div>
  )
}

/** The window's command ribbon: tabs File, Home, Scan and View over a toolbar of groups. */
export function Ribbon({ onAbout }: { onAbout(): void }) {
  const [tab, setTab] = useState<RibbonTab>('home')
  const tablistRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const baseId = useId()
  useFocusgroupFallback(tablistRef, 'tablist', tab)
  useFocusgroupFallback(toolbarRef, 'toolbar', tab)

  const phase = useWorkspace((s) => s.phase)
  const target = useWorkspace((s) => s.target)
  const selectedId = useWorkspace((s) => s.selectedId)
  const mode = useWorkspace((s) => s.mode)
  const unit = useWorkspace((s) => s.unit)
  const treemapVisible = useWorkspace((s) => s.treemapVisible)
  const stopScan = useWorkspace((s) => s.stopScan)
  const rescan = useWorkspace((s) => s.rescan)
  const setMode = useWorkspace((s) => s.setMode)
  const setUnit = useWorkspace((s) => s.setUnit)
  const expandLevels = useWorkspace((s) => s.expandLevels)
  const openInExplorer = useWorkspace((s) => s.openInExplorer)
  const createFolder = useWorkspace((s) => s.createFolder)
  const setTreemapVisible = useWorkspace((s) => s.setTreemapVisible)
  const quit = useWorkspace((s) => s.quit)

  const scanning = phase === 'scanning'
  const hasTree = phase !== 'empty' && phase !== 'failed'

  const scanGroup = (
    <Group label="Scan">
      <SelectMenu />
      <RibbonButton
        label="Stop"
        icon={Square}
        disabled={!scanning}
        title="Stop the running scan"
        onClick={() => void stopScan()}
      />
      <RibbonButton
        label="Refresh"
        icon={RefreshCw}
        disabled={scanning || target === null}
        title="Scan the same location again (F5)"
        onClick={() => void rescan()}
      />
    </Group>
  )

  const expandMenu = (
    <MenuButton
      menuLabel="Expand the tree"
      disabled={!hasTree}
      className={RIBBON_BUTTON_CLASS}
      title="Show more levels of the folder tree"
      sections={[
        {
          id: 'levels',
          entries: [
            ...[1, 2, 3, 4, 5].map((levels) => ({
              id: `level-${levels}`,
              label: levels === 1 ? '1 level' : `${levels} levels`,
              onSelect: () => void expandLevels(levels),
            })),
            {
              id: 'all',
              label: 'All levels',
              onSelect: () => void expandLevels(EXPAND_ALL_LEVELS),
            },
          ],
        },
      ]}
    >
      <ListTree aria-hidden="true" className="size-6" />
      <span className="flex items-center gap-0.5">
        Expand
        <ChevronDown aria-hidden="true" className="size-3" />
      </span>
    </MenuButton>
  )

  const modeGroup = (
    <Group label="Mode">
      {MODES.map((entry) => (
        <RibbonButton
          key={entry.mode}
          label={entry.label}
          icon={entry.icon}
          title={entry.title}
          pressed={mode === entry.mode}
          onClick={() => setMode(entry.mode)}
        />
      ))}
    </Group>
  )

  const unitGroup = (
    <Group label="Unit">
      <div className="grid grid-cols-2 gap-0.5 pt-1">
        {SIZE_UNITS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={unit === value}
            title={
              value === 'auto' ? 'Pick a unit for each size' : `Show sizes in ${UNIT_LABELS[value]}`
            }
            onClick={() => setUnit(value)}
            className={RIBBON_SMALL_CLASS}
          >
            {UNIT_LABELS[value]}
          </button>
        ))}
      </div>
    </Group>
  )

  const folderGroup = (
    <Group label="Folder">
      {expandMenu}
      <RibbonButton
        label="Open in Explorer"
        icon={FolderOpen}
        disabled={!hasTree || selectedId === null}
        title="Open the selected item in File Explorer (Enter)"
        onClick={() => {
          if (selectedId !== null) void openInExplorer(selectedId)
        }}
      />
      <RibbonButton
        label="New folder"
        icon={FolderPlus}
        disabled={!hasTree || scanning || selectedId === null}
        title="Create a folder in the selected folder (Ctrl+N)"
        onClick={() => {
          if (selectedId !== null) void createFolder(selectedId)
        }}
      />
    </Group>
  )

  const panels: Record<RibbonTab, ReactNode> = {
    file: (
      <Group label="App">
        <RibbonButton label="About" icon={Info} title="About StorageIQ" onClick={onAbout} />
        <RibbonButton
          label="Exit"
          icon={LogOut}
          title="Close StorageIQ"
          onClick={() => void quit()}
        />
      </Group>
    ),
    home: (
      <>
        {scanGroup}
        {modeGroup}
        {unitGroup}
        {folderGroup}
      </>
    ),
    scan: (
      <>
        {scanGroup}
        <Group label="Tree">{expandMenu}</Group>
      </>
    ),
    view: (
      <>
        {modeGroup}
        {unitGroup}
        <Group label="Treemap">
          <RibbonButton
            label="Treemap"
            icon={PanelBottom}
            pressed={treemapVisible}
            title="Show or hide the treemap"
            onClick={() => setTreemapVisible(!treemapVisible)}
          />
        </Group>
      </>
    ),
  }

  const active = TABS.find((entry) => entry.id === tab) ?? { id: 'home', label: 'Home' }

  return (
    <header className="border-b border-line bg-panel">
      <div
        ref={tablistRef}
        role="tablist"
        aria-label="Ribbon"
        focusgroup="tablist nomemory"
        className="flex h-(--size-tab-strip) items-end gap-0.5 px-1"
      >
        {TABS.map((entry) => (
          <button
            key={entry.id}
            id={`${baseId}-${entry.id}`}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
            onFocus={() => setTab(entry.id)}
            className="min-h-6 rounded-t-control px-3 text-sm text-ink hover:bg-row-hover aria-selected:bg-sunken aria-selected:font-semibold"
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        aria-labelledby={`${baseId}-${active.id}`}
        className="h-(--size-ribbon-body) bg-sunken px-1 py-1"
      >
        <div
          ref={toolbarRef}
          role="toolbar"
          aria-label={`${active.label} commands`}
          focusgroup="toolbar wrap"
          className="flex h-full items-stretch"
        >
          {panels[tab]}
        </div>
      </div>
    </header>
  )
}
```

- [ ] **Step 9: Run the renderer tests of this task**

```powershell
npx vitest run src/renderer/src/lib src/renderer/src/stores src/renderer/src/components/SelectMenu.test.tsx src/renderer/src/components/Ribbon.test.tsx src/renderer/src/components/Button.test.tsx
```

Expected: PASS — 10 files, 84 tests.

- [ ] **Step 10: Format and lint**

```powershell
npm run format
npm run lint
```

Expected: lint clean.

- [ ] **Step 11: Commit**

```powershell
git add src/renderer/src/lib src/renderer/src/stores src/renderer/src/test src/renderer/src/env.d.ts src/renderer/src/components/MenuButton.tsx src/renderer/src/components/RibbonButton.tsx src/renderer/src/components/SelectMenu.tsx src/renderer/src/components/SelectMenu.test.tsx src/renderer/src/components/Ribbon.tsx src/renderer/src/components/Ribbon.test.tsx
git commit -m @'
feat(renderer): workspace store, ribbon and Select menu; remove the 2a screens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 6: Virtualized column tree

**Implementer tier:** standard

A hand-rolled virtualizer (no dependency): the scroll container's height is the line count × 30 px; only lines in view plus 10 above and below are rendered, absolutely positioned; a `ResizeObserver` tracks the viewport. Every render asks the store for the chunks behind those lines (and the root's first chunk, which carries the root row), and stale chunks reload after each scanner update, so the tree draws during the scan. ARIA treegrid (modern-web-guidance "accessibility"; APG treegrid): focus stays on the grid and `aria-activedescendant` points at the selected row, which survives virtualization; rows carry level, set size, position, expanded and selected; sortable headers are buttons with `aria-sort`.

**Files:**

- Create: `src/renderer/src/components/TreeGrid.tsx`, `TreeGrid.test.tsx`

**Interfaces:**

- Consumes: Task 5 store, model and formatting.
- Produces: `TREE_ROW_HEIGHT = 30`, `BOLD_SHARE = 0.1`, `COLUMNS`, `EMPTY_TREE_TEXT`, `rowDomId(id)`, `TreeGrid()`.

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/components/TreeGrid.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createFakeApi } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { makeDone, makeProgress } from '../test/scan-fixtures'
import { EMPTY_TREE_TEXT, TreeGrid } from './TreeGrid'

async function renderTree(api = createFakeApi()) {
  const utils = renderWithStores(<TreeGrid />, api)
  await act(() => utils.workspace.getState().startScan('D:\\'))
  await screen.findByRole('row', { name: /Videos/ })
  return utils
}

const grid = () => screen.getByRole('treegrid', { name: 'Folder tree' })
const cells = (name: RegExp) =>
  within(screen.getByRole('row', { name }))
    .getAllByRole('gridcell')
    .map((cell) => cell.textContent)

describe('<TreeGrid />', () => {
  it('shows the empty-state line before any scan', () => {
    renderWithStores(<TreeGrid />)
    expect(screen.getByText(EMPTY_TREE_TEXT)).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Name',
      'Size',
      'Allocated',
      'Files',
      'Folders',
      '% of Parent▼',
      'Last Modified',
    ])
  })

  it('shows the root, its folders and one "[N files]" row with every column', async () => {
    await renderTree()
    expect(cells(/^.*D:\\/)).toEqual([
      '3.0 GBD:\\',
      '3.0 GB',
      '3.0 GB',
      '1,014',
      '53',
      '100.0%',
      '11/19/2026',
    ])
    expect(cells(/Videos/)).toEqual([
      '2.0 GBVideos',
      '2.0 GB',
      '2.0 GB',
      '10',
      '1',
      '66.7%',
      '11/19/2026',
    ])
    expect(screen.getByRole('row', { name: /\[3 files\]/ })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Videos/ })).toHaveAttribute('aria-level', '2')
    expect(screen.getByRole('row', { name: /Videos/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('makes rows of 10% or more bold and draws the bar at the share of the parent', async () => {
    await renderTree()
    const videos = screen.getByRole('row', { name: /Videos/ })
    expect(videos.className).toContain('font-semibold')
    expect(within(videos).getByTestId('name-bar')).toHaveStyle({ width: '66.66666666666666%' })
    const files = screen.getByRole('row', { name: /\[3 files\]/ })
    expect(files.className).not.toContain('font-semibold')
  })

  it('keeps exact byte counts on the size cells', async () => {
    await renderTree()
    const [, size, allocated] = within(screen.getByRole('row', { name: /Photos/ })).getAllByRole(
      'gridcell',
    )
    expect(size).toHaveAttribute('data-bytes', String(768 * 1024 ** 2))
    expect(allocated).toHaveAttribute('title', '813,694,976 bytes')
  })

  it('sorts by a header and reverses on a second click', async () => {
    const user = userEvent.setup()
    const { api } = await renderTree()
    await user.click(screen.getByRole('button', { name: /^Name/ }))
    await waitFor(() =>
      expect(api.getChildren).toHaveBeenLastCalledWith('scan-1', 'd0', 'name', 'asc', 0, 200),
    )
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
    await user.click(screen.getByRole('button', { name: /^Name/ }))
    await waitFor(() =>
      expect(api.getChildren).toHaveBeenLastCalledWith('scan-1', 'd0', 'name', 'desc', 0, 200),
    )
  })

  it('moves with ↑ ↓, expands with →, collapses with ← and opens with Enter', async () => {
    const user = userEvent.setup()
    const { api, workspace } = await renderTree()
    grid().focus()
    await user.keyboard('{ArrowDown}')
    expect(workspace.getState().selectedId).toBe('d1')
    expect(grid()).toHaveAttribute('aria-activedescendant', 'tree-row-d1')
    await user.keyboard('{ArrowRight}')
    expect(await screen.findByRole('row', { name: /Clips/ })).toHaveAttribute('aria-level', '3')
    await user.keyboard('{ArrowRight}')
    expect(workspace.getState().selectedId).toBe('d3')
    await user.keyboard('{ArrowLeft}')
    expect(workspace.getState().selectedId).toBe('d1')
    await user.keyboard('{ArrowLeft}')
    expect(screen.queryByRole('row', { name: /Clips/ })).not.toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(api.openInExplorer).toHaveBeenCalledWith('scan-1', 'd1')
    await user.keyboard('{End}')
    expect(workspace.getState().selectedId).toBe('g0')
    await user.keyboard('{Home}')
    expect(workspace.getState().selectedId).toBe('d0')
  })

  it('opens the Explorer menu on right-click and on Shift+F10, copies with Ctrl+C, creates with Ctrl+N', async () => {
    const user = userEvent.setup()
    const { api } = await renderTree()
    fireEvent.contextMenu(screen.getByRole('row', { name: /Photos/ }), {
      clientX: 120,
      clientY: 80,
      shiftKey: true,
    })
    await waitFor(() =>
      expect(api.showContextMenu).toHaveBeenCalledWith('scan-1', 'd2', 120, 80, true),
    )
    grid().focus()
    await user.keyboard('{Shift>}{F10}{/Shift}')
    expect(api.showContextMenu).toHaveBeenCalledTimes(2)
    expect(vi.mocked(api.showContextMenu).mock.calls[1]?.[1]).toBe('d2')
    await user.keyboard('{Control>}c{/Control}')
    await waitFor(() => expect(api.writeClipboardText).toHaveBeenCalledWith('D:\\Photos'))
    await user.keyboard('{Control>}n{/Control}')
    expect(api.createFolder).toHaveBeenCalledWith('scan-1', 'd2')
  })

  it('expands with a click on the row twice and toggles with the chevron', async () => {
    const user = userEvent.setup()
    await renderTree()
    await user.dblClick(screen.getByRole('row', { name: /Videos/ }))
    expect(await screen.findByRole('row', { name: /movie|\[1 file\]/ })).toBeInTheDocument()
  })

  it('refreshes the visible rows on every scanner update', async () => {
    const { api } = await renderTree()
    const calls = vi.mocked(api.getChildren).mock.calls.length
    act(() => api.emitScanProgress(makeProgress()))
    await waitFor(() => expect(vi.mocked(api.getChildren).mock.calls.length).toBeGreaterThan(calls))
    act(() => api.emitScanDone(makeDone()))
    await waitFor(() =>
      expect(vi.mocked(api.getChildren).mock.calls.length).toBeGreaterThan(calls + 1),
    )
  })
})
```

- [ ] **Step 2: Run them**

```powershell
npx vitest run src/renderer/src/components/TreeGrid.test.tsx
```

Expected: FAIL — `Cannot find module './TreeGrid'`.

- [ ] **Step 3: The tree**

`src/renderer/src/components/TreeGrid.tsx`:

```tsx
import { ChevronRight, File, Files, Folder, HardDrive } from 'lucide-react'
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ROOT_NODE_ID, type NodeId, type SizeMode, type TreeRow } from '@shared/tree-types'
import {
  formatCount,
  formatDate,
  formatModeValue,
  formatShare,
  formatSize,
  rowName,
  shareOfParent,
  type SizeUnit,
} from '../lib/format'
import { buildVisibleModel, chunksFor, type VisibleRow } from '../lib/tree-view-model'
import { type ColumnId, effectiveSort } from '../stores/workspace-store'
import { useWorkspace } from '../stores/workspace-store-context'

/** Must equal `--size-tree-row` in design/tokens.json. */
export const TREE_ROW_HEIGHT = 30
const OVERSCAN = 10
/** Rows taking this share of their parent or more are bold. */
export const BOLD_SHARE = 0.1
const INDENT = 16

export const COLUMNS: ReadonlyArray<{ id: ColumnId; label: string; numeric: boolean }> = [
  { id: 'name', label: 'Name', numeric: false },
  { id: 'size', label: 'Size', numeric: true },
  { id: 'allocated', label: 'Allocated', numeric: true },
  { id: 'files', label: 'Files', numeric: true },
  { id: 'folders', label: 'Folders', numeric: true },
  { id: 'percent', label: '% of Parent', numeric: true },
  { id: 'modified', label: 'Last Modified', numeric: false },
]

const GRID_TEMPLATE =
  'minmax(var(--size-col-name-min),1fr) var(--size-col-size) var(--size-col-allocated) var(--size-col-files) var(--size-col-folders) var(--size-col-percent) var(--size-col-modified)'

export const EMPTY_TREE_TEXT = 'Choose a drive or folder from Select to see what’s using the space.'

export function rowDomId(id: NodeId): string {
  return `tree-row-${id}`
}

function RowIcon({ row, root }: { row: TreeRow; root: boolean }) {
  const className = 'size-4 shrink-0 text-ink-muted'
  if (root) return <HardDrive aria-hidden="true" className={className} />
  if (row.kind === 'files') return <Files aria-hidden="true" className={className} />
  if (row.kind === 'file') return <File aria-hidden="true" className={className} />
  return <Folder aria-hidden="true" className={className} />
}

interface RowProps {
  line: VisibleRow
  row: TreeRow
  rowIndex: number
  parent: TreeRow | null
  expanded: boolean
  selected: boolean
  mode: SizeMode
  unit: SizeUnit
  onSelect(id: NodeId): void
  onToggle(id: NodeId, open: boolean): void
  onContextMenu(id: NodeId, event: MouseEvent): void
}

function GridRow({
  line,
  row,
  rowIndex,
  parent,
  expanded,
  selected,
  mode,
  unit,
  onSelect,
  onToggle,
  onContextMenu,
}: RowProps) {
  const share = shareOfParent(row, parent, mode)
  const bold = share >= BOLD_SHARE
  const hasChildren = row.childCount > 0
  return (
    <div
      id={rowDomId(row.id)}
      role="row"
      aria-rowindex={rowIndex + 2}
      aria-level={line.depth + 1}
      aria-setsize={line.setSize}
      aria-posinset={line.index + 1}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={selected}
      onClick={() => onSelect(row.id)}
      onDoubleClick={() => hasChildren && onToggle(row.id, !expanded)}
      onContextMenu={(event) => onContextMenu(row.id, event)}
      className={`absolute inset-x-0 grid cursor-default items-center border-b border-line/60 tabular-nums select-none ${
        selected ? 'bg-selection' : 'hover:bg-row-hover'
      } ${bold ? 'font-semibold' : ''}`}
      style={{
        gridTemplateColumns: GRID_TEMPLATE,
        height: TREE_ROW_HEIGHT,
        transform: `translateY(${rowIndex * TREE_ROW_HEIGHT}px)`,
      }}
    >
      <div
        role="gridcell"
        className="flex min-w-0 items-center gap-1 pr-2"
        style={{ paddingLeft: line.depth * INDENT + 4 }}
      >
        <span
          aria-hidden="true"
          onClick={(event) => {
            event.stopPropagation()
            if (hasChildren) onToggle(row.id, !expanded)
          }}
          className="flex size-5 shrink-0 items-center justify-center"
        >
          {hasChildren && (
            <ChevronRight
              className={`size-4 transition-transform ${expanded ? 'rotate-90' : ''}`}
            />
          )}
        </span>
        <RowIcon row={row} root={line.parentId === null} />
        <span className="relative flex min-w-0 flex-1 items-center gap-2 px-1">
          <span
            aria-hidden="true"
            data-testid="name-bar"
            className="absolute inset-y-1 left-0 rounded-sm bg-bar"
            style={{ width: `${Math.min(1, share) * 100}%` }}
          />
          <span className="relative shrink-0">{formatModeValue(row, mode, unit, share)}</span>
          <span className="relative min-w-0 truncate" title={rowName(row)}>
            {rowName(row)}
          </span>
        </span>
      </div>
      <div
        role="gridcell"
        className="pr-3 text-right"
        data-bytes={row.size}
        title={`${formatCount(row.size)} bytes`}
      >
        {formatSize(row.size, unit)}
      </div>
      <div
        role="gridcell"
        className="pr-3 text-right"
        data-bytes={row.allocated}
        title={`${formatCount(row.allocated)} bytes`}
      >
        {formatSize(row.allocated, unit)}
      </div>
      <div role="gridcell" className="pr-3 text-right">
        {formatCount(row.files)}
      </div>
      <div role="gridcell" className="pr-3 text-right">
        {formatCount(row.folders)}
      </div>
      <div role="gridcell" className="flex items-center gap-2 pr-3">
        <span aria-hidden="true" className="h-2 w-10 shrink-0 overflow-hidden rounded-full bg-bar">
          <span
            className="block h-full bg-bar-fill"
            style={{ width: `${Math.min(1, share) * 100}%` }}
          />
        </span>
        <span className="flex-1 text-right">{formatShare(share)}</span>
      </div>
      <div role="gridcell" className="truncate pr-2">
        {formatDate(row.modifiedMs)}
      </div>
    </div>
  )
}

/**
 * The column tree: an ARIA treegrid, virtualized by hand (only the lines in view, plus a few
 * above and below, are in the DOM; the scanner pages the rows in), sortable by every column.
 * Keyboard: ↑ ↓ Home End PageUp PageDown move, → expands or enters, ← collapses or goes up,
 * Enter opens in Explorer, Shift+F10 or the Menu key opens the Explorer context menu,
 * Ctrl+C copies the path and Ctrl+N creates a folder.
 */
export function TreeGrid() {
  const phase = useWorkspace((s) => s.phase)
  const scanId = useWorkspace((s) => s.scanId)
  const lists = useWorkspace((s) => s.lists)
  const expanded = useWorkspace((s) => s.expanded)
  const selectedId = useWorkspace((s) => s.selectedId)
  const scrollTarget = useWorkspace((s) => s.scrollTarget)
  const revision = useWorkspace((s) => s.revision)
  const mode = useWorkspace((s) => s.mode)
  const unit = useWorkspace((s) => s.unit)
  const sortColumn = useWorkspace((s) => s.sortColumn)
  const sortDir = useWorkspace((s) => s.sortDir)
  const requestChunks = useWorkspace((s) => s.requestChunks)
  const setExpanded = useWorkspace((s) => s.setExpanded)
  const select = useWorkspace((s) => s.select)
  const sortBy = useWorkspace((s) => s.sortBy)
  const openInExplorer = useWorkspace((s) => s.openInExplorer)
  const showContextMenu = useWorkspace((s) => s.showContextMenu)
  const createFolder = useWorkspace((s) => s.createFolder)
  const copyPath = useWorkspace((s) => s.copyPath)

  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(600)
  const handledScroll = useRef(0)

  const model = useMemo(() => buildVisibleModel(lists, expanded, ROOT_NODE_ID), [lists, expanded])
  const first = Math.max(0, Math.floor(scrollTop / TREE_ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(
    model.count - 1,
    Math.ceil((scrollTop + viewport) / TREE_ROW_HEIGHT) + OVERSCAN,
  )

  useEffect(() => {
    const element = scrollRef.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewport(entry.contentRect.height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Load the chunks for the lines in view (and refresh stale ones after each scanner update).
  useEffect(() => {
    if (scanId === null) return
    requestChunks([{ nodeId: ROOT_NODE_ID, chunk: 0 }, ...chunksFor(model, first, last)])
  }, [scanId, model, first, last, revision, requestChunks])

  const ensureVisible = (index: number) => {
    const element = scrollRef.current
    if (element === null || index < 0) return
    const top = index * TREE_ROW_HEIGHT
    const height = element.clientHeight || viewport
    if (top < element.scrollTop) element.scrollTop = top
    else if (top + TREE_ROW_HEIGHT > element.scrollTop + height) {
      element.scrollTop = top + TREE_ROW_HEIGHT - height
    }
    setScrollTop(element.scrollTop)
  }

  useLayoutEffect(() => {
    if (scrollTarget === null || scrollTarget.seq === handledScroll.current) return
    const index = model.indexOf(scrollTarget.id)
    if (index === -1) return
    handledScroll.current = scrollTarget.seq
    ensureVisible(index)
    // ensureVisible only reads refs and setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTarget, model])

  const selectedIndex = selectedId === null ? -1 : model.indexOf(selectedId)
  const selectedLine = selectedIndex === -1 ? null : model.rowAt(selectedIndex)

  const moveTo = (index: number) => {
    const clamped = Math.max(0, Math.min(model.count - 1, index))
    const line = model.rowAt(clamped)
    if (line?.row) {
      select(line.row.id)
      ensureVisible(clamped)
    }
  }

  const openMenuForSelected = (extended: boolean) => {
    if (selectedId === null) return
    const element = document.getElementById(rowDomId(selectedId))
    const rect = element?.getBoundingClientRect()
    void showContextMenu(selectedId, (rect?.left ?? 0) + 32, rect?.bottom ?? 0, extended)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (model.count === 0) return
    const row = selectedLine?.row ?? null
    const pageRows = Math.max(1, Math.floor(viewport / TREE_ROW_HEIGHT) - 1)
    const isExpanded = row !== null && expanded.has(row.id)
    let handled = true
    if (event.key === 'ArrowDown') moveTo(selectedIndex + 1)
    else if (event.key === 'ArrowUp') moveTo(selectedIndex === -1 ? 0 : selectedIndex - 1)
    else if (event.key === 'Home') moveTo(0)
    else if (event.key === 'End') moveTo(model.count - 1)
    else if (event.key === 'PageDown') moveTo(selectedIndex + pageRows)
    else if (event.key === 'PageUp') moveTo(selectedIndex - pageRows)
    else if (event.key === 'ArrowRight' && row !== null) {
      if (row.childCount > 0 && !isExpanded) setExpanded(row.id, true)
      else if (isExpanded) moveTo(selectedIndex + 1)
    } else if (event.key === 'ArrowLeft' && row !== null) {
      if (isExpanded) setExpanded(row.id, false)
      else if (selectedLine?.parentId) {
        const parentIndex = model.indexOf(selectedLine.parentId)
        if (parentIndex !== -1) moveTo(parentIndex)
      }
    } else if (event.key === 'Enter' && row !== null) void openInExplorer(row.id)
    else if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
      openMenuForSelected(false)
    } else if (event.ctrlKey && event.key.toLowerCase() === 'n' && row !== null) {
      void createFolder(row.id)
    } else if (event.ctrlKey && event.key.toLowerCase() === 'c' && row !== null) {
      void copyPath(row.id)
    } else handled = false
    if (handled) event.preventDefault()
  }

  const onRowContextMenu = (id: NodeId, event: MouseEvent) => {
    event.preventDefault()
    select(id)
    void showContextMenu(id, event.clientX, event.clientY, event.shiftKey)
  }

  const sort = effectiveSort({ sortColumn, sortDir, mode })
  const sortedColumn: ColumnId = sortColumn ?? 'percent'
  const lines: ReactNode[] = []
  for (let i = first; i <= last; i += 1) {
    const line = model.rowAt(i)
    if (line === null) continue
    if (line.row === null) {
      lines.push(
        <div
          key={`loading-${line.parentId}-${line.index}`}
          role="row"
          aria-rowindex={i + 2}
          aria-level={line.depth + 1}
          className="absolute inset-x-0 flex items-center text-ink-muted"
          style={{
            height: TREE_ROW_HEIGHT,
            transform: `translateY(${i * TREE_ROW_HEIGHT}px)`,
            paddingLeft: line.depth * INDENT + 32,
          }}
        >
          <div role="gridcell">Loading…</div>
        </div>,
      )
      continue
    }
    const parent = line.parentId === null ? null : (lists[line.parentId]?.parent ?? null)
    lines.push(
      <GridRow
        key={line.row.id}
        line={line}
        row={line.row}
        rowIndex={i}
        parent={parent}
        expanded={expanded.has(line.row.id)}
        selected={line.row.id === selectedId}
        mode={mode}
        unit={unit}
        onSelect={select}
        onToggle={setExpanded}
        onContextMenu={onRowContextMenu}
      />,
    )
  }

  const activeRendered = selectedId !== null && selectedIndex >= first && selectedIndex <= last

  return (
    <div
      role="treegrid"
      aria-label="Folder tree"
      aria-rowcount={model.count + 1}
      aria-colcount={COLUMNS.length}
      aria-multiselectable="false"
      aria-activedescendant={
        activeRendered && selectedId !== null ? rowDomId(selectedId) : undefined
      }
      tabIndex={0}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      className="flex min-h-0 flex-1 flex-col bg-panel focus-visible:outline-offset-[-2px]"
    >
      <div role="rowgroup" className="border-b border-line bg-sunken">
        <div
          role="row"
          aria-rowindex={1}
          className="grid h-(--size-header-row) items-stretch text-sm"
          style={{ gridTemplateColumns: GRID_TEMPLATE }}
        >
          {COLUMNS.map((column) => {
            const active =
              column.id === sortedColumn || (column.id === 'percent' && sortColumn === null)
            const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined
            return (
              <div
                key={column.id}
                role="columnheader"
                aria-sort={ariaSort}
                className="border-r border-line last:border-r-0"
              >
                <button
                  type="button"
                  onClick={() => sortBy(column.id)}
                  className={`flex size-full items-center gap-1 px-2 hover:bg-row-hover ${column.numeric ? 'justify-end' : ''}`}
                >
                  {column.label}
                  {active && (
                    <span aria-hidden="true" className="text-xs text-ink-muted">
                      {sort.dir === 'asc' ? '▲' : '▼'}
                    </span>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      </div>
      <div
        ref={scrollRef}
        role="rowgroup"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        className="relative min-h-0 flex-1 overflow-auto"
      >
        {phase === 'empty' ? (
          <div role="row">
            <p role="gridcell" className="px-4 py-3 text-ink-muted">
              {EMPTY_TREE_TEXT}
            </p>
          </div>
        ) : (
          <div className="relative" style={{ height: model.count * TREE_ROW_HEIGHT }}>
            {lines}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests**

```powershell
npx vitest run src/renderer/src/components/TreeGrid.test.tsx
```

Expected: PASS — 9 tests.

- [ ] **Step 5: Format and lint**

```powershell
npm run format
npm run lint
```

Expected: lint clean.

- [ ] **Step 6: Commit**

```powershell
git add src/renderer/src/components/TreeGrid.tsx src/renderer/src/components/TreeGrid.test.tsx
git commit -m @'
feat(renderer): virtualized column tree with sort, keyboard and live updates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 7: Native Explorer context menu

**Implementer tier:** standard

**Feasibility (verified in the dry run on Windows 11 with Electron 45.3.4 and koffi 3.3.8):**

- koffi represents pointers as `BigInt`; a COM method is called by reading the vtable with `koffi.decode(koffi.decode(obj, 'void *'), slot * 8, 'void *')` and `koffi.call(fnPtr, proto, obj, …)` (koffi docs `doc/pointers.md`, "Function pointers"). `SHParseDisplayName` → `SHBindToParent(IID_IShellFolder)` → `GetUIObjectOf(IID_IContextMenu)` → `QueryContextMenu` listed 27 real items for `C:\Windows` (Open, Pin to Quick access, third-party extensions, Give access to, Restore previous versions, Send to, Cut, Copy, Create shortcut, Delete, Properties).
- `BrowserWindow.hookWindowMessage(message, callback)` returns `void`, so it **cannot** supply the `LRESULT` that `WM_MENUCHAR` and `WM_MEASUREITEM`/`WM_DRAWITEM` need. The plan instead subclasses the app window only while the menu is open: `SetWindowSubclass` (comctl32) with a `koffi.register`ed `SUBCLASSPROC` that forwards `WM_INITMENUPOPUP`, `WM_DRAWITEM`, `WM_MEASUREITEM` and `WM_MENUCHAR` to `IContextMenu3::HandleMenuMsg2` (or `IContextMenu2::HandleMenuMsg`) and everything else to `DefSubclassProc`; `TrackPopupMenuEx` runs its modal loop on the main thread, so the registered callback re-enters JS synchronously. `SetForegroundWindow` is called first (TrackPopupMenu remarks).
- COM: Chromium already initialises an apartment on the Electron main thread; `CoInitializeEx(NULL, COINIT_APARTMENTTHREADED)` returns S_FALSE (or RPC_E_CHANGED_MODE, also accepted) and the menu works.
- In the dry run the shown menu matched Explorer's (with shell-extension icons), the StorageIQ ▸ Copy path item wrote the path through main's clipboard, Properties opened "folder-03 Properties" through `InvokeCommand`, and the packaged self-test listed 24 items. Not automatable: Playwright cannot drive a native menu, so `Send to`'s lazily filled submenu and a full keyboard walk are a **manual check in Task 9**.

StorageIQ's items take ids 1–4 (`StorageIQ ▸` Refresh this folder / Copy path / Open in Explorer, `New folder\tCtrl+N`), then a separator, then the shell's items from `0x100` to `0x7fff`. After a shell verb that may change the disk (anything except open/explore/properties/copy/copy as path/pin …, and any item without a verb), main rescans the item's folder at once and again 1.5 s later (a delete with a progress dialog can finish after `InvokeCommand` returns).

**Files:**

- Create: `src/main/shell-menu/context-menu.ts`, `context-menu.test.ts`, `win-shell-menu.ts`

**Interfaces:**

- Consumes: `menu-commands.ts` (Task 4).
- Produces: `BuiltShellMenu { labels(); track(x, y); verb(offset); invoke(offset, x, y, extended); release() }`, `ShellMenuNative { build(hwnd: bigint, path, extended) }`, `ShellMenuRequest`, `ShellMenuChoice`, `showShellMenu(native, request)`, `probeShellMenu(native, hwnd, path)`; `guid(text)`, `createWinShellMenu(): Promise<ShellMenuNative>`. With this task `npm run typecheck:node` is green again.

- [ ] **Step 1: Write the failing orchestration tests**

`src/main/shell-menu/context-menu.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import {
  type BuiltShellMenu,
  probeShellMenu,
  type ShellMenuNative,
  showShellMenu,
} from './context-menu'
import { SHELL_FIRST_ID, STORAGEIQ_COMMAND_IDS } from './menu-commands'

function fakeNative(chosenId: number, verb: string | null = 'delete') {
  const menu: BuiltShellMenu = {
    labels: vi.fn(() => ['&StorageIQ', 'New &folder\tCtrl+N', '', '&Open', 'P&roperties']),
    track: vi.fn(() => chosenId),
    verb: vi.fn(() => verb),
    invoke: vi.fn(),
    release: vi.fn(),
  }
  const native: ShellMenuNative = { build: vi.fn(() => menu) }
  return { native, menu }
}

const request = { hwnd: 42n, path: 'D:\\Data\\a.jpg', x: 300, y: 200, extended: false }

describe('showShellMenu', () => {
  it('builds the menu for the path and returns dismissed when nothing is chosen', () => {
    const { native, menu } = fakeNative(0)
    expect(showShellMenu(native, request)).toEqual({ kind: 'dismissed' })
    expect(native.build).toHaveBeenCalledWith(42n, 'D:\\Data\\a.jpg', false)
    expect(menu.track).toHaveBeenCalledWith(300, 200)
    expect(menu.invoke).not.toHaveBeenCalled()
    expect(menu.release).toHaveBeenCalledTimes(1)
  })

  it('returns StorageIQ’s item without invoking the shell', () => {
    const { native, menu } = fakeNative(STORAGEIQ_COMMAND_IDS['copy-path'])
    expect(showShellMenu(native, request)).toEqual({ kind: 'storageiq', item: 'copy-path' })
    expect(menu.invoke).not.toHaveBeenCalled()
  })

  it('invokes a shell item by its offset and reports whether it may change files', () => {
    const { native, menu } = fakeNative(SHELL_FIRST_ID + 9, 'delete')
    expect(showShellMenu(native, { ...request, extended: true })).toEqual({
      kind: 'shell',
      verb: 'delete',
      changed: true,
    })
    expect(menu.verb).toHaveBeenCalledWith(9)
    expect(menu.invoke).toHaveBeenCalledWith(9, 300, 200, true)
  })

  it('reports read-only shell verbs as unchanged', () => {
    const { native } = fakeNative(SHELL_FIRST_ID + 1, 'properties')
    expect(showShellMenu(native, request)).toEqual({
      kind: 'shell',
      verb: 'properties',
      changed: false,
    })
  })

  it('releases the menu even when the shell command fails', () => {
    const { native, menu } = fakeNative(SHELL_FIRST_ID + 2)
    vi.mocked(menu.invoke).mockImplementation(() => {
      throw new Error('InvokeCommand failed')
    })
    expect(() => showShellMenu(native, request)).toThrow('InvokeCommand failed')
    expect(menu.release).toHaveBeenCalledTimes(1)
  })
})

describe('probeShellMenu', () => {
  it('returns the labels and destroys the menu without showing it', () => {
    const { native, menu } = fakeNative(0)
    expect(probeShellMenu(native, 0n, 'C:\\')).toEqual([
      '&StorageIQ',
      'New &folder\tCtrl+N',
      '',
      '&Open',
      'P&roperties',
    ])
    expect(menu.track).not.toHaveBeenCalled()
    expect(menu.release).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run them**

```powershell
npx vitest run src/main/shell-menu/context-menu.test.ts
```

Expected: FAIL — `Cannot find module './context-menu'`.

- [ ] **Step 3: Orchestration (pure, testable with a fake native menu)**

`src/main/shell-menu/context-menu.ts`:

```ts
import { classifyCommand, type StorageIQMenuItem, verbChangesFileSystem } from './menu-commands'

/** One built menu: StorageIQ's items, a separator, then the shell's items for one path. */
export interface BuiltShellMenu {
  /** Item labels at the top level, in order (`''` for separators). */
  labels(): string[]
  /** Shows the menu at screen pixel `x`, `y` and waits; returns the chosen id (0 = none). */
  track(x: number, y: number): number
  /** The shell's verb for an item (`delete`, `properties`, …), or null when it has none. */
  verb(offset: number): string | null
  /** Runs the shell's item as Explorer would. */
  invoke(offset: number, x: number, y: number, extended: boolean): void
  /** Destroys the menu and releases every COM object. */
  release(): void
}

/** The Windows side, built with koffi in `win-shell-menu.ts`; tests pass a fake. */
export interface ShellMenuNative {
  build(hwnd: bigint, path: string, extended: boolean): BuiltShellMenu
}

export interface ShellMenuRequest {
  hwnd: bigint
  path: string
  /** Screen pixels. */
  x: number
  y: number
  /** Shift was held: also show the extended verbs (Copy as path, Open PowerShell here, …). */
  extended: boolean
}

export type ShellMenuChoice =
  | { kind: 'dismissed' }
  | { kind: 'storageiq'; item: StorageIQMenuItem }
  | { kind: 'shell'; verb: string | null; changed: boolean }

/** Shows the real Explorer context menu and runs the shell command the user picks. */
export function showShellMenu(native: ShellMenuNative, request: ShellMenuRequest): ShellMenuChoice {
  const menu = native.build(request.hwnd, request.path, request.extended)
  try {
    const command = classifyCommand(menu.track(request.x, request.y))
    if (command.kind === 'none') return { kind: 'dismissed' }
    if (command.kind === 'storageiq') return { kind: 'storageiq', item: command.item }
    const verb = menu.verb(command.offset)
    menu.invoke(command.offset, request.x, request.y, request.extended)
    return { kind: 'shell', verb, changed: verbChangesFileSystem(verb) }
  } finally {
    menu.release()
  }
}

/** Test seam: builds the menu without showing it and returns its labels. */
export function probeShellMenu(native: ShellMenuNative, hwnd: bigint, path: string): string[] {
  const menu = native.build(hwnd, path, false)
  try {
    return menu.labels()
  } finally {
    menu.release()
  }
}
```

- [ ] **Step 4: The koffi/COM implementation**

`src/main/shell-menu/win-shell-menu.ts`:

```ts
import type { BuiltShellMenu, ShellMenuNative } from './context-menu'
import {
  SHELL_FIRST_ID,
  SHELL_LAST_ID,
  STORAGEIQ_COMMAND_IDS,
  STORAGEIQ_MENU_LABELS,
} from './menu-commands'

// Win32 and COM constants (shobjidl_core.h, winuser.h, objbase.h).
const COINIT_APARTMENTTHREADED = 0x2
const S_OK = 0
const MF_STRING = 0x0
const MF_POPUP = 0x10
const MF_SEPARATOR = 0x800
const MF_BYPOSITION = 0x400
const CMF_NORMAL = 0x0
const CMF_EXPLORE = 0x4
const CMF_EXTENDEDVERBS = 0x100
const TPM_RIGHTBUTTON = 0x2
const TPM_RETURNCMD = 0x100
const GCS_VERBW = 0x4
const CMIC_MASK_UNICODE = 0x4000
const CMIC_MASK_SHIFT_DOWN = 0x10000000
const CMIC_MASK_PTINVOKE = 0x20000000
const SW_SHOWNORMAL = 1
const WM_DRAWITEM = 0x2b
const WM_MEASUREITEM = 0x2c
const WM_INITMENUPOPUP = 0x117
const WM_MENUCHAR = 0x120
const MENU_MESSAGES = new Set([WM_DRAWITEM, WM_MEASUREITEM, WM_INITMENUPOPUP, WM_MENUCHAR])
/** Our subclass id on the window (any constant unique to StorageIQ). */
const SUBCLASS_ID = 0x5149

const IID_IShellFolder = '000214E6-0000-0000-C000-000000000046'
const IID_IContextMenu = '000214E4-0000-0000-C000-000000000046'
const IID_IContextMenu2 = '000214F4-0000-0000-C000-000000000046'
const IID_IContextMenu3 = 'BCFCE0A0-EC17-11D0-8D10-00A0C90F2719'

// vtable slots (IUnknown 0-2, then the interface's own methods in declaration order).
const VT_RELEASE = 2
const VT_QUERY_INTERFACE = 0
const VT_SHELLFOLDER_GET_UI_OBJECT_OF = 10
const VT_CONTEXTMENU_QUERY_CONTEXT_MENU = 3
const VT_CONTEXTMENU_INVOKE_COMMAND = 4
const VT_CONTEXTMENU_GET_COMMAND_STRING = 5
const VT_CONTEXTMENU2_HANDLE_MENU_MSG = 6
const VT_CONTEXTMENU3_HANDLE_MENU_MSG2 = 7

interface Guid {
  d1: number
  d2: number
  d3: number
  d4: number[]
}

export function guid(text: string): Guid {
  const hex = text.replace(/[{}-]/g, '')
  const tail: number[] = []
  for (let i = 16; i < 32; i += 2) tail.push(parseInt(hex.slice(i, i + 2), 16))
  return {
    d1: parseInt(hex.slice(0, 8), 16),
    d2: parseInt(hex.slice(8, 12), 16),
    d3: parseInt(hex.slice(12, 16), 16),
    d4: tail,
  }
}

const failed = (hr: number) => hr < 0

/**
 * The real Explorer context menu through koffi: SHParseDisplayName + SHBindToParent give the
 * parent IShellFolder and the item's child id; GetUIObjectOf gives IContextMenu (plus
 * IContextMenu2/3 for "Send to", "Open with" and other submenus that fill themselves in or draw
 * their own items). The menu is shown with TrackPopupMenuEx(TPM_RETURNCMD) on the app window
 * while a temporary window subclass forwards the menu messages to HandleMenuMsg(2), and the
 * choice runs through InvokeCommand. koffi is imported lazily, like the drive API.
 */
export async function createWinShellMenu(): Promise<ShellMenuNative> {
  const { default: koffi } = await import('koffi')
  const ole32 = koffi.load('ole32.dll')
  const shell32 = koffi.load('shell32.dll')
  const user32 = koffi.load('user32.dll')
  const comctl32 = koffi.load('comctl32.dll')

  // Named types are referenced by name in the declarations below.
  koffi.struct('SIQ_GUID', {
    d1: 'uint32_t',
    d2: 'uint16_t',
    d3: 'uint16_t',
    d4: koffi.array('uint8_t', 8),
  })
  const POINT = koffi.struct('SIQ_POINT', { x: 'int32_t', y: 'int32_t' })
  const CMINVOKECOMMANDINFOEX = koffi.struct('SIQ_CMINVOKECOMMANDINFOEX', {
    cbSize: 'uint32_t',
    fMask: 'uint32_t',
    hwnd: 'void *',
    lpVerb: 'void *',
    lpParameters: 'void *',
    lpDirectory: 'void *',
    nShow: 'int32_t',
    dwHotKey: 'uint32_t',
    hIcon: 'void *',
    lpTitle: 'void *',
    lpVerbW: 'void *',
    lpParametersW: 'void *',
    lpDirectoryW: 'void *',
    lpTitleW: 'void *',
    ptInvoke: POINT,
  })

  const CoInitializeEx = ole32.func('int __stdcall CoInitializeEx(void *reserved, uint32_t coinit)')
  const CoTaskMemFree = ole32.func('void __stdcall CoTaskMemFree(void *pv)')
  const SHParseDisplayName = shell32.func(
    'int __stdcall SHParseDisplayName(const char16_t *name, void *bindCtx, _Out_ void **pidl, uint32_t sfgaoIn, void *sfgaoOut)',
  )
  const SHBindToParent = shell32.func(
    'int __stdcall SHBindToParent(void *pidl, SIQ_GUID *riid, _Out_ void **ppv, _Out_ void **childPidl)',
  )
  const CreatePopupMenu = user32.func('void * __stdcall CreatePopupMenu()')
  const DestroyMenu = user32.func('int __stdcall DestroyMenu(void *menu)')
  const AppendMenuW = user32.func(
    'int __stdcall AppendMenuW(void *menu, uint32_t flags, uintptr_t idOrSubmenu, const char16_t *text)',
  )
  const GetMenuItemCount = user32.func('int __stdcall GetMenuItemCount(void *menu)')
  const GetMenuStringW = user32.func(
    'int __stdcall GetMenuStringW(void *menu, uint32_t item, _Out_ uint16_t *text, int max, uint32_t flags)',
  )
  const SetForegroundWindow = user32.func('int __stdcall SetForegroundWindow(void *hwnd)')
  const TrackPopupMenuEx = user32.func(
    'int __stdcall TrackPopupMenuEx(void *menu, uint32_t flags, int x, int y, void *hwnd, void *params)',
  )
  const SubclassProc = koffi.proto(
    'intptr_t __stdcall SIQ_SubclassProc(void *hwnd, uint32_t msg, uintptr_t wParam, intptr_t lParam, uintptr_t id, uintptr_t refData)',
  )
  const SetWindowSubclass = comctl32.func(
    'int __stdcall SetWindowSubclass(void *hwnd, SIQ_SubclassProc *proc, uintptr_t id, uintptr_t refData)',
  )
  const RemoveWindowSubclass = comctl32.func(
    'int __stdcall RemoveWindowSubclass(void *hwnd, SIQ_SubclassProc *proc, uintptr_t id)',
  )
  const DefSubclassProc = comctl32.func(
    'intptr_t __stdcall DefSubclassProc(void *hwnd, uint32_t msg, uintptr_t wParam, intptr_t lParam)',
  )

  const Release = koffi.proto('uint32_t __stdcall SIQ_Release(void *self)')
  const QueryInterface = koffi.proto(
    'int __stdcall SIQ_QueryInterface(void *self, SIQ_GUID *riid, _Out_ void **ppv)',
  )
  const GetUIObjectOf = koffi.proto(
    'int __stdcall SIQ_GetUIObjectOf(void *self, void *hwnd, uint32_t count, void **children, SIQ_GUID *riid, void *reserved, _Out_ void **ppv)',
  )
  const QueryContextMenu = koffi.proto(
    'int __stdcall SIQ_QueryContextMenu(void *self, void *menu, uint32_t index, uint32_t first, uint32_t last, uint32_t flags)',
  )
  const InvokeCommand = koffi.proto(
    'int __stdcall SIQ_InvokeCommand(void *self, SIQ_CMINVOKECOMMANDINFOEX *info)',
  )
  const GetCommandString = koffi.proto(
    'int __stdcall SIQ_GetCommandString(void *self, uintptr_t id, uint32_t type, void *reserved, _Out_ uint16_t *name, uint32_t max)',
  )
  const HandleMenuMsg = koffi.proto(
    'int __stdcall SIQ_HandleMenuMsg(void *self, uint32_t msg, uintptr_t wParam, intptr_t lParam)',
  )
  const HandleMenuMsg2 = koffi.proto(
    'int __stdcall SIQ_HandleMenuMsg2(void *self, uint32_t msg, uintptr_t wParam, intptr_t lParam, _Out_ intptr_t *result)',
  )

  // The Electron main thread already runs a COM apartment (S_FALSE); if it is a different one,
  // RPC_E_CHANGED_MODE is returned and the existing apartment is used as is.
  CoInitializeEx(null, COINIT_APARTMENTTHREADED)

  /** Reads entry `slot` of a COM object's vtable. */
  const method = (object: unknown, slot: number): unknown =>
    koffi.decode(koffi.decode(object, 'void *'), slot * 8, 'void *')
  const release = (object: unknown) => {
    if (object) koffi.call(method(object, VT_RELEASE), Release, object)
  }
  const queryInterface = (object: unknown, iid: string): unknown => {
    const out: unknown[] = [null]
    const hr = Number(
      koffi.call(method(object, VT_QUERY_INTERFACE), QueryInterface, object, guid(iid), out),
    )
    return failed(hr) ? null : out[0]
  }

  const labelsOf = (menu: unknown): string[] => {
    const count = Number(GetMenuItemCount(menu))
    const labels: string[] = []
    for (let i = 0; i < count; i += 1) {
      const buffer = new Uint16Array(512)
      const length = Number(GetMenuStringW(menu, i, buffer, buffer.length, MF_BYPOSITION))
      labels.push(String.fromCharCode(...buffer.subarray(0, Math.max(0, length))))
    }
    return labels
  }

  return {
    build(hwnd, path, extended): BuiltShellMenu {
      const pidl: unknown[] = [null]
      let hr = Number(SHParseDisplayName(path, null, pidl, 0, null))
      if (failed(hr) || !pidl[0])
        throw new Error(`SHParseDisplayName failed (0x${(hr >>> 0).toString(16)})`)
      const folder: unknown[] = [null]
      const child: unknown[] = [null]
      let contextMenu: unknown = null
      let menu2: unknown = null
      let menu3: unknown = null
      let menu: unknown = null
      let submenu: unknown = null
      try {
        hr = Number(SHBindToParent(pidl[0], guid(IID_IShellFolder), folder, child))
        if (failed(hr)) throw new Error(`SHBindToParent failed (0x${(hr >>> 0).toString(16)})`)
        const out: unknown[] = [null]
        hr = Number(
          koffi.call(
            method(folder[0], VT_SHELLFOLDER_GET_UI_OBJECT_OF),
            GetUIObjectOf,
            folder[0],
            hwnd,
            1,
            [child[0]],
            guid(IID_IContextMenu),
            null,
            out,
          ),
        )
        if (failed(hr)) throw new Error(`GetUIObjectOf failed (0x${(hr >>> 0).toString(16)})`)
        contextMenu = out[0]
        menu3 = queryInterface(contextMenu, IID_IContextMenu3)
        menu2 = menu3 === null ? queryInterface(contextMenu, IID_IContextMenu2) : null

        menu = CreatePopupMenu()
        submenu = CreatePopupMenu()
        AppendMenuW(
          submenu,
          MF_STRING,
          STORAGEIQ_COMMAND_IDS.refresh,
          STORAGEIQ_MENU_LABELS.refresh,
        )
        AppendMenuW(
          submenu,
          MF_STRING,
          STORAGEIQ_COMMAND_IDS['copy-path'],
          STORAGEIQ_MENU_LABELS['copy-path'],
        )
        AppendMenuW(submenu, MF_STRING, STORAGEIQ_COMMAND_IDS.open, STORAGEIQ_MENU_LABELS.open)
        AppendMenuW(menu, MF_POPUP, submenu, STORAGEIQ_MENU_LABELS.submenu)
        submenu = null // owned by `menu` now; DestroyMenu(menu) destroys it
        AppendMenuW(
          menu,
          MF_STRING,
          STORAGEIQ_COMMAND_IDS['new-folder'],
          STORAGEIQ_MENU_LABELS['new-folder'],
        )
        AppendMenuW(menu, MF_SEPARATOR, 0, null)
        const flags = CMF_NORMAL | CMF_EXPLORE | (extended ? CMF_EXTENDEDVERBS : 0)
        hr = Number(
          koffi.call(
            method(contextMenu, VT_CONTEXTMENU_QUERY_CONTEXT_MENU),
            QueryContextMenu,
            contextMenu,
            menu,
            Number(GetMenuItemCount(menu)),
            SHELL_FIRST_ID,
            SHELL_LAST_ID,
            flags,
          ),
        )
        if (failed(hr)) throw new Error(`QueryContextMenu failed (0x${(hr >>> 0).toString(16)})`)
      } catch (error) {
        if (menu) DestroyMenu(menu)
        if (submenu) DestroyMenu(submenu)
        release(menu3)
        release(menu2)
        release(contextMenu)
        release(folder[0])
        CoTaskMemFree(pidl[0])
        throw error
      }

      const builtMenu = menu
      const forwardMenuMessage = (
        window: unknown,
        msg: number,
        wParam: unknown,
        lParam: unknown,
      ): unknown => {
        if (MENU_MESSAGES.has(msg)) {
          if (menu3) {
            const result: unknown[] = [0]
            const handled = Number(
              koffi.call(
                method(menu3, VT_CONTEXTMENU3_HANDLE_MENU_MSG2),
                HandleMenuMsg2,
                menu3,
                msg,
                wParam,
                lParam,
                result,
              ),
            )
            if (handled === S_OK) return result[0] ?? 0
          } else if (menu2) {
            const handled = Number(
              koffi.call(
                method(menu2, VT_CONTEXTMENU2_HANDLE_MENU_MSG),
                HandleMenuMsg,
                menu2,
                msg,
                wParam,
                lParam,
              ),
            )
            if (handled === S_OK) return 0
          }
        }
        return DefSubclassProc(window, msg, wParam, lParam)
      }

      return {
        labels: () => labelsOf(builtMenu),

        track(x, y) {
          const proc = koffi.register(forwardMenuMessage, koffi.pointer(SubclassProc))
          SetWindowSubclass(hwnd, proc, SUBCLASS_ID, 0)
          // TrackPopupMenuEx needs its owner in the foreground, or the menu does not close
          // when the user clicks elsewhere (TrackPopupMenu remarks).
          SetForegroundWindow(hwnd)
          try {
            return Number(
              TrackPopupMenuEx(builtMenu, TPM_RETURNCMD | TPM_RIGHTBUTTON, x, y, hwnd, null),
            )
          } finally {
            RemoveWindowSubclass(hwnd, proc, SUBCLASS_ID)
            koffi.unregister(proc)
          }
        },

        verb(offset) {
          const buffer = new Uint16Array(256)
          const result = Number(
            koffi.call(
              method(contextMenu, VT_CONTEXTMENU_GET_COMMAND_STRING),
              GetCommandString,
              contextMenu,
              offset,
              GCS_VERBW,
              null,
              buffer,
              buffer.length,
            ),
          )
          if (failed(result)) return null
          const end = buffer.indexOf(0)
          const verb = String.fromCharCode(...buffer.subarray(0, end === -1 ? buffer.length : end))
          return verb === '' ? null : verb
        },

        invoke(offset, x, y, shiftDown) {
          const info = {
            cbSize: koffi.sizeof(CMINVOKECOMMANDINFOEX),
            fMask: CMIC_MASK_UNICODE | CMIC_MASK_PTINVOKE | (shiftDown ? CMIC_MASK_SHIFT_DOWN : 0),
            hwnd,
            // MAKEINTRESOURCE(offset): the item is named by its offset from SHELL_FIRST_ID.
            lpVerb: BigInt(offset),
            lpParameters: null,
            lpDirectory: null,
            nShow: SW_SHOWNORMAL,
            dwHotKey: 0,
            hIcon: null,
            lpTitle: null,
            lpVerbW: BigInt(offset),
            lpParametersW: null,
            lpDirectoryW: null,
            lpTitleW: null,
            ptInvoke: { x, y },
          }
          const hr = Number(
            koffi.call(
              method(contextMenu, VT_CONTEXTMENU_INVOKE_COMMAND),
              InvokeCommand,
              contextMenu,
              info,
            ),
          )
          if (failed(hr)) throw new Error(`InvokeCommand failed (0x${(hr >>> 0).toString(16)})`)
        },

        release() {
          DestroyMenu(builtMenu)
          release(menu3)
          release(menu2)
          release(contextMenu)
          release(folder[0])
          CoTaskMemFree(pidl[0])
        },
      }
    },
  }
}
```

- [ ] **Step 5: Tests and node typecheck**

```powershell
npx vitest run src/main/shell-menu
npm run typecheck:node
```

Expected: PASS — 2 files, 32 tests; typecheck:node clean.

- [ ] **Step 6: Probe the real menu without showing it (dry-run check)**

```powershell
npx electron-vite build
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npx electron . --self-test
"exit $LASTEXITCODE"
```

Expected: `[self-test] shell menu: N items` with N > 5, then `exit 0`. (The renderer side does not compile until Task 8, but the self-test needs only main and the scanner; if the build stops on the renderer, run this step after Task 8.)

- [ ] **Step 7: Format and lint**

```powershell
npm run format
npm run lint
```

Expected: lint clean.

- [ ] **Step 8: Commit**

```powershell
git add src/main/shell-menu/context-menu.ts src/main/shell-menu/context-menu.test.ts src/main/shell-menu/win-shell-menu.ts
git commit -m @'
feat(shell): native Explorer context menu with StorageIQ items (koffi COM)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 8: Treemap pane, level bar, splitter, status bar and the workspace shell

**Implementer tier:** standard

The treemap canvas only draws: the scanner lays it out for the canvas size, Mode and Level (0–5); colours are read from the CSS tokens at draw time and redrawn when the system theme changes; the selected row's block gets a 2 px outline. A click reveals and selects the row (the treemap stays), a double-click drills in, × hides the pane (View → Treemap shows it again). The canvas is `role="img"` with a label, and the tree is the accessible equivalent (modern-web-guidance: the experimental canvas-to-HTML route is not adopted). The splitter is a focusable `separator` with a value. The crash screen becomes a banner with Retry; the unreadable list opens from the status bar's "excluded" count in a native `<dialog>`.

**Files:**

- Create: `src/renderer/src/lib/treemap-draw.ts` (+ test), `components/TreemapPane.tsx` (+ test, which also covers `LevelBar`), `LevelBar.tsx`, `Splitter.tsx` (+ test), `StatusBar.test.tsx`, `Banner.tsx`, `Dialog.tsx`
- Modify: `components/StatusBar.tsx`, `components/UnreadableList.tsx`, `App.tsx`, `App.test.tsx`, `main.tsx`

**Interfaces:**

- Consumes: Tasks 5–6.
- Produces: `TreemapColors`, `TREEMAP_FONT`, `readTreemapColors`, `fillFor`, `rectLabel`, `hitTest`, `drawTreemap`; `TreemapPane({ height })`, `LevelBar()`, `SPLITTER_STEP = 16`, `Splitter({ value, min, max, onChange })`, `StatusBar()`, `Banner()`, `Dialog({ title, onClose, children })`, `REASON_TEXT`, `reasonText`, `unreadableSummary`, `UnreadableList`; `TREEMAP_DEFAULT_HEIGHT = 260`, `TREEMAP_MIN_HEIGHT = 120`, `TREEMAP_MAX_HEIGHT = 900`, `App()`.

- [ ] **Step 1: Treemap drawing helpers**

`src/renderer/src/lib/treemap-draw.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { TreemapLayout, TreemapRect } from '@shared/tree-types'
import { drawTreemap, fillFor, hitTest, rectLabel, type TreemapColors } from './treemap-draw'

const COLORS: TreemapColors = {
  levels: ['#l0', '#l1', '#l2'],
  files: '#files',
  free: '#free',
  edge: '#edge',
  outline: '#outline',
  text: '#text',
}

function rect(fields: Partial<TreemapRect>): TreemapRect {
  return {
    id: 'd1',
    kind: 'folder',
    name: 'Videos',
    value: 2 * 1024 ** 3,
    files: 10,
    depth: 0,
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    nested: false,
    ...fields,
  }
}

const LAYOUT: TreemapLayout = {
  nodeId: 'd0',
  width: 200,
  height: 100,
  rects: [
    rect({ id: 'd1', w: 120, h: 100, nested: true }),
    rect({ id: 'd4', name: 'Inner', depth: 1, x: 2, y: 18, w: 60, h: 40 }),
    rect({ id: null, kind: 'free', name: 'Free space', x: 120, w: 80, h: 100 }),
  ],
}

describe('hitTest', () => {
  it('finds the deepest block under the point', () => {
    expect(hitTest(LAYOUT, 10, 30)?.id).toBe('d4')
    expect(hitTest(LAYOUT, 100, 90)?.id).toBe('d1')
    expect(hitTest(LAYOUT, 150, 50)?.kind).toBe('free')
    expect(hitTest(LAYOUT, 250, 50)).toBeNull()
  })
})

describe('fillFor and rectLabel', () => {
  it('colours by depth, files and free space', () => {
    expect(fillFor(rect({ depth: 0 }), COLORS)).toBe('#l0')
    expect(fillFor(rect({ depth: 4 }), COLORS)).toBe('#l1')
    expect(fillFor(rect({ kind: 'files' }), COLORS)).toBe('#files')
    expect(fillFor(rect({ kind: 'free' }), COLORS)).toBe('#free')
  })

  it('labels with the name and the Mode value', () => {
    expect(rectLabel(rect({}), 'size', 'auto')).toBe('Videos (2.0 GB)')
    expect(rectLabel(rect({ kind: 'files', name: '', files: 7 }), 'allocated', 'gb')).toBe(
      '[7 files] (2.0 GB)',
    )
    expect(rectLabel(rect({ value: 1234 }), 'files', 'auto')).toBe('Videos (1,234 files)')
  })
})

describe('drawTreemap', () => {
  it('fills every block, labels the ones that fit and outlines the selected one', () => {
    const calls: string[] = []
    const ctx = {
      clearRect: vi.fn(),
      fillRect: vi.fn(() => calls.push('fill')),
      strokeRect: vi.fn(),
      fillText: vi.fn((text: string) => calls.push(`text:${text}`)),
      measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
      set fillStyle(value: string) {
        calls.push(`style:${value}`)
      },
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textBaseline: 'alphabetic',
    } as unknown as CanvasRenderingContext2D
    drawTreemap(ctx, LAYOUT, { colors: COLORS, selectedId: 'd4', mode: 'size', unit: 'auto' })
    expect(calls.filter((call) => call === 'fill')).toHaveLength(3)
    expect(calls).toContain('style:#free')
    expect(calls.some((call) => call.startsWith('text:Videos'))).toBe(true)
    expect(calls.some((call) => call.startsWith('text:Free space'))).toBe(true)
    expect(ctx.strokeRect).toHaveBeenLastCalledWith(3, 19, 58, 38)
  })
})
```

`src/renderer/src/lib/treemap-draw.ts`:

```ts
import type { NodeId, SizeMode, TreemapLayout, TreemapRect } from '@shared/tree-types'
import { filesRowName, formatCount, formatSize, type SizeUnit } from './format'

/** Colours read from the CSS tokens at draw time, so the treemap follows light and dark. */
export interface TreemapColors {
  levels: [string, string, string]
  files: string
  free: string
  edge: string
  outline: string
  text: string
}

export const TREEMAP_FONT = '12px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif'
/** Height of the label strip the scanner leaves at the top of a nested block. */
const HEADER = 18
const MIN_LABEL_WIDTH = 36
const MIN_LABEL_HEIGHT = 16

export function readTreemapColors(element: Element): TreemapColors {
  const style = getComputedStyle(element)
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    levels: [
      token('--treemap-0', '#c6e3df'),
      token('--treemap-1', '#a9d4cf'),
      token('--treemap-2', '#8fc6c0'),
    ],
    files: token('--treemap-files', '#e1e6e6'),
    free: token('--treemap-free', '#f3e6c9'),
    edge: token('--treemap-edge', '#f6f7f7'),
    outline: token('--treemap-outline', '#1b2122'),
    text: token('--text', '#1b2122'),
  }
}

export function fillFor(rect: TreemapRect, colors: TreemapColors): string {
  if (rect.kind === 'free') return colors.free
  if (rect.kind === 'files' || rect.kind === 'file') return colors.files
  return colors.levels[rect.depth % 3] ?? colors.levels[0]
}

/** `Photos (12.3 GB)`, `[7 files] (59.5 GB)`, `Free space (45.7 GB)`. */
export function rectLabel(rect: TreemapRect, mode: SizeMode, unit: SizeUnit): string {
  const name = rect.kind === 'files' ? filesRowName(rect.files) : rect.name
  const value = mode === 'files' ? `${formatCount(rect.value)} files` : formatSize(rect.value, unit)
  return `${name} (${value})`
}

/** The deepest block under a point (nested blocks are drawn after their parent). */
export function hitTest(layout: TreemapLayout, x: number, y: number): TreemapRect | null {
  for (let i = layout.rects.length - 1; i >= 0; i -= 1) {
    const rect = layout.rects[i]
    if (rect && x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h)
      return rect
  }
  return null
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string | null {
  if (ctx.measureText(text).width <= maxWidth) return text
  for (let length = text.length - 1; length > 1; length -= 1) {
    const candidate = `${text.slice(0, length)}…`
    if (ctx.measureText(candidate).width <= maxWidth) return candidate
  }
  return null
}

/** Draws the layout in CSS pixels (the caller scales the context for the device pixel ratio). */
export function drawTreemap(
  ctx: CanvasRenderingContext2D,
  layout: TreemapLayout,
  options: {
    colors: TreemapColors
    selectedId: NodeId | null
    mode: SizeMode
    unit: SizeUnit
  },
): void {
  const { colors, selectedId, mode, unit } = options
  ctx.clearRect(0, 0, layout.width, layout.height)
  ctx.font = TREEMAP_FONT
  ctx.textBaseline = 'middle'
  let selected: TreemapRect | null = null
  for (const rect of layout.rects) {
    ctx.fillStyle = fillFor(rect, colors)
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
    ctx.strokeStyle = colors.edge
    ctx.lineWidth = 1
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, Math.max(0, rect.w - 1), Math.max(0, rect.h - 1))
    if (rect.id !== null && rect.id === selectedId) selected = rect
    if (rect.w < MIN_LABEL_WIDTH || rect.h < MIN_LABEL_HEIGHT) continue
    const text = fitText(ctx, rectLabel(rect, mode, unit), rect.w - 8)
    if (text === null) continue
    ctx.fillStyle = colors.text
    const labelY = rect.nested
      ? rect.y + HEADER / 2 + 1
      : rect.y + Math.min(rect.h / 2, HEADER / 2 + 1)
    ctx.fillText(text, rect.x + 4, labelY)
  }
  if (selected !== null) {
    ctx.strokeStyle = colors.outline
    ctx.lineWidth = 2
    ctx.strokeRect(
      selected.x + 1,
      selected.y + 1,
      Math.max(0, selected.w - 2),
      Math.max(0, selected.h - 2),
    )
  }
}
```

- [ ] **Step 2: Treemap pane and level bar**

`src/renderer/src/components/TreemapPane.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeApi } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { LevelBar } from './LevelBar'
import { TreemapPane } from './TreemapPane'

class FixedSizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ target, contentRect: { width: 400, height: 200 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    )
  }
  unobserve() {}
  disconnect() {}
}

const fakeContext = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  fillText: vi.fn(),
  measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  font: '',
  textBaseline: 'alphabetic',
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FixedSizeObserver)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    fakeContext as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 400, 200),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function renderPane(api = createFakeApi()) {
  const utils = renderWithStores(<TreemapPane height={260} />, api)
  await act(() => utils.workspace.getState().startScan('D:\\'))
  const canvas = await screen.findByRole('img')
  return { ...utils, canvas }
}

describe('<TreemapPane />', () => {
  it('asks the scanner for a layout of the selected folder at the canvas size and draws it', async () => {
    const { api, canvas } = await renderPane()
    await waitFor(() =>
      expect(api.getTreemap).toHaveBeenCalledWith('scan-1', 'd0', 'size', 1, 400, 200),
    )
    expect(canvas).toHaveAccessibleName(/The folder tree lists the same items\.$/)
    await waitFor(() => expect(fakeContext.fillRect).toHaveBeenCalled())
  })

  it('a click selects the block’s row in the tree; a double-click drills in', async () => {
    const { workspace, canvas } = await renderPane()
    fireEvent.click(canvas, { clientX: 300, clientY: 50 })
    await waitFor(() => expect(workspace.getState().selectedId).toBe('d2'))
    expect(workspace.getState().treemapRootId).toBe('d0')
    fireEvent.doubleClick(canvas, { clientX: 50, clientY: 50 })
    await waitFor(() => expect(workspace.getState().treemapRootId).toBe('d1'))
    expect(workspace.getState().selectedId).toBe('d1')
  })

  it('lays out again when the tree selection, the Mode or the level changes', async () => {
    const { api, workspace } = await renderPane()
    act(() => workspace.getState().select('d1'))
    await waitFor(() =>
      expect(api.getTreemap).toHaveBeenLastCalledWith('scan-1', 'd1', 'size', 1, 400, 200),
    )
    act(() => workspace.getState().setMode('allocated'))
    act(() => workspace.getState().setTreemapDepth(3))
    await waitFor(() =>
      expect(api.getTreemap).toHaveBeenLastCalledWith('scan-1', 'd1', 'allocated', 3, 400, 200),
    )
  })

  it('hides with the close button', async () => {
    const user = userEvent.setup()
    const { workspace } = await renderPane()
    await user.click(screen.getByRole('button', { name: 'Hide treemap' }))
    expect(workspace.getState().treemapVisible).toBe(false)
  })
})

describe('<LevelBar />', () => {
  it('offers Level 0 to Level 5 as toggles and sets the depth', async () => {
    const user = userEvent.setup()
    const { workspace } = renderWithStores(<LevelBar />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Level 0',
      'Level 1',
      'Level 2',
      'Level 3',
      'Level 4',
      'Level 5',
    ])
    expect(screen.getByRole('button', { name: 'Level 1' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Level 5' }))
    expect(workspace.getState().treemapDepth).toBe(5)
    screen.getByRole('button', { name: 'Level 5' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('button', { name: 'Level 0' })).toHaveFocus()
  })
})
```

`src/renderer/src/components/LevelBar.tsx`:

```tsx
import { useRef } from 'react'
import { MAX_TREEMAP_DEPTH } from '@shared/tree-types'
import { useFocusgroupFallback } from '../lib/use-focusgroup'
import { useWorkspace } from '../stores/workspace-store-context'

const LEVELS = Array.from({ length: MAX_TREEMAP_DEPTH + 1 }, (_, level) => level)

/** Treemap nesting depth, Level 0 (children only) to Level 5: one toggle per level. */
export function LevelBar() {
  const depth = useWorkspace((s) => s.treemapDepth)
  const setTreemapDepth = useWorkspace((s) => s.setTreemapDepth)
  const ref = useRef<HTMLDivElement>(null)
  useFocusgroupFallback(ref, 'toolbar')
  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Treemap levels"
      focusgroup="toolbar wrap"
      className="grid h-(--size-level-bar) shrink-0 grid-cols-6 gap-1 border-t border-line bg-sunken p-1"
    >
      {LEVELS.map((level) => (
        <button
          key={level}
          type="button"
          aria-pressed={depth === level}
          onClick={() => setTreemapDepth(level)}
          className="min-h-6 rounded-control border border-line bg-panel px-2 text-left text-sm hover:bg-row-hover aria-pressed:border-accent aria-pressed:bg-pressed aria-pressed:font-semibold"
        >
          Level {level}
        </button>
      ))}
    </div>
  )
}
```

`src/renderer/src/components/TreemapPane.tsx`:

```tsx
import { X } from 'lucide-react'
import { type MouseEvent, useEffect, useRef, useState } from 'react'
import type { TreemapLayout } from '@shared/tree-types'
import { rowName } from '../lib/format'
import { drawTreemap, hitTest, readTreemapColors } from '../lib/treemap-draw'
import { useWorkspace } from '../stores/workspace-store-context'
import { LevelBar } from './LevelBar'

interface Size {
  width: number
  height: number
}

/**
 * The treemap of the selected folder, drawn on a canvas. The canvas is an image to assistive
 * technology: the folder tree above lists the same items with the same values and is the
 * accessible way to explore them (modern-web-guidance: canvas content needs an HTML
 * equivalent; the experimental canvas-html route is not used).
 */
export function TreemapPane({ height }: { height: number }) {
  const scanId = useWorkspace((s) => s.scanId)
  const treemapRootId = useWorkspace((s) => s.treemapRootId)
  const mode = useWorkspace((s) => s.mode)
  const unit = useWorkspace((s) => s.unit)
  const depth = useWorkspace((s) => s.treemapDepth)
  const revision = useWorkspace((s) => s.revision)
  const selectedId = useWorkspace((s) => s.selectedId)
  const lists = useWorkspace((s) => s.lists)
  const fetchTreemap = useWorkspace((s) => s.fetchTreemap)
  const reveal = useWorkspace((s) => s.reveal)
  const drillInto = useWorkspace((s) => s.drillInto)
  const setTreemapVisible = useWorkspace((s) => s.setTreemapVisible)

  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  const [layout, setLayout] = useState<TreemapLayout | null>(null)
  const [themeVersion, setThemeVersion] = useState(0)

  useEffect(() => {
    const element = wrapperRef.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!query) return
    const onChange = () => setThemeVersion((version) => version + 1)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  // Ask the scanner for a layout; only the newest answer is drawn.
  useEffect(() => {
    if (scanId === null || size.width < 1 || size.height < 1) {
      setLayout(null)
      return
    }
    let current = true
    fetchTreemap(size.width, size.height).then(
      (next) => {
        if (current) setLayout(next)
      },
      () => undefined,
    )
    return () => {
      current = false
    }
  }, [scanId, treemapRootId, mode, depth, revision, size, fetchTreemap])

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || layout === null) return
    const ctx = canvas.getContext('2d')
    if (ctx === null) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(layout.width * ratio)
    canvas.height = Math.round(layout.height * ratio)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    drawTreemap(ctx, layout, { colors: readTreemapColors(canvas), selectedId, mode, unit })
  }, [layout, selectedId, mode, unit, themeVersion])

  const pointOf = (event: MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const rootRow =
    treemapRootId === null
      ? null
      : (lists[treemapRootId]?.parent ??
        Object.values(lists)
          .flatMap((list) => Object.values(list.chunks).flatMap((chunk) => chunk.rows))
          .find((row) => row.id === treemapRootId) ??
        null)
  const title = rootRow === null ? 'Treemap' : `Treemap of ${rowName(rootRow)}`

  return (
    <section
      aria-label="Treemap"
      className="flex shrink-0 flex-col border-t border-line bg-panel"
      style={{ height }}
    >
      <div className="flex h-7 items-center justify-between gap-2 border-b border-line px-2 text-sm">
        <span className="min-w-0 truncate text-ink-muted">{title}</span>
        <button
          type="button"
          aria-label="Hide treemap"
          title="Hide treemap"
          onClick={() => setTreemapVisible(false)}
          className="flex size-6 items-center justify-center rounded-control hover:bg-row-hover"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      <div ref={wrapperRef} className="relative min-h-0 flex-1">
        {layout !== null && (
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`${title}. The folder tree lists the same items.`}
            className="absolute inset-0 size-full"
            style={{ width: layout.width, height: layout.height }}
            onClick={(event) => {
              const { x, y } = pointOf(event)
              const hit = hitTest(layout, x, y)
              if (hit?.id) void reveal(hit.id)
            }}
            onDoubleClick={(event) => {
              const { x, y } = pointOf(event)
              const hit = hitTest(layout, x, y)
              if (hit?.id && hit.kind !== 'file' && hit.kind !== 'free') void drillInto(hit.id)
            }}
          />
        )}
      </div>
      <LevelBar />
    </section>
  )
}
```

- [ ] **Step 3: Splitter**

`src/renderer/src/components/Splitter.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Splitter, SPLITTER_STEP } from './Splitter'

describe('<Splitter />', () => {
  it('is a focusable separator with its value', () => {
    render(<Splitter value={260} min={120} max={900} onChange={vi.fn()} />)
    const separator = screen.getByRole('separator', { name: 'Resize treemap' })
    expect(separator).toHaveAttribute('aria-valuenow', '260')
    expect(separator).toHaveAttribute('aria-orientation', 'horizontal')
    expect(separator).toHaveAttribute('tabindex', '0')
  })

  it('resizes with the arrow keys, Home and End, within the limits', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Splitter value={260} min={120} max={900} onChange={onChange} />)
    screen.getByRole('separator').focus()
    await user.keyboard('{ArrowUp}')
    expect(onChange).toHaveBeenLastCalledWith(260 + SPLITTER_STEP)
    await user.keyboard('{ArrowDown}')
    expect(onChange).toHaveBeenLastCalledWith(260 - SPLITTER_STEP)
    await user.keyboard('{Home}')
    expect(onChange).toHaveBeenLastCalledWith(900)
    await user.keyboard('{End}')
    expect(onChange).toHaveBeenLastCalledWith(120)
  })

  it('resizes by dragging: up makes the treemap taller', () => {
    const onChange = vi.fn()
    render(<Splitter value={260} min={120} max={900} onChange={onChange} />)
    const separator = screen.getByRole('separator')
    fireEvent.pointerDown(separator, { clientY: 500, pointerId: 1 })
    fireEvent.pointerMove(separator, { clientY: 440, pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith(320)
    fireEvent.pointerUp(separator, { pointerId: 1 })
    fireEvent.pointerMove(separator, { clientY: 100, pointerId: 1 })
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
```

`src/renderer/src/components/Splitter.tsx`:

```tsx
import { type KeyboardEvent, type PointerEvent, useRef } from 'react'

export const SPLITTER_STEP = 16

/**
 * Horizontal splitter between the tree and the treemap: a focusable `separator` with a value
 * (WAI-ARIA window splitter). Drag with the pointer, or use ↑ ↓ (16 px), Home and End.
 */
export function Splitter({
  value,
  min,
  max,
  onChange,
}: {
  value: number
  min: number
  max: number
  onChange(value: number): void
}) {
  const drag = useRef<{ startY: number; startValue: number } | null>(null)
  const clamp = (next: number) => Math.max(min, Math.min(max, Math.round(next)))

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next =
      event.key === 'ArrowUp'
        ? value + SPLITTER_STEP
        : event.key === 'ArrowDown'
          ? value - SPLITTER_STEP
          : event.key === 'Home'
            ? max
            : event.key === 'End'
              ? min
              : null
    if (next === null) return
    event.preventDefault()
    onChange(clamp(next))
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = { startY: event.clientY, startValue: value }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current === null) return
    onChange(clamp(drag.current.startValue + (drag.current.startY - event.clientY)))
  }
  const onPointerUp = () => {
    drag.current = null
  }

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize treemap"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="h-(--size-splitter) shrink-0 cursor-row-resize bg-line hover:bg-line-strong focus-visible:bg-accent"
    />
  )
}
```

- [ ] **Step 4: Dialog, unreadable list and status bar**

`src/renderer/src/components/Dialog.tsx`:

```tsx
import { type ReactNode, useEffect, useId, useRef } from 'react'
import { Button } from './Button'

/**
 * A modal `<dialog>` (modern-web-guidance "html": native dialog, focus moves in and returns,
 * Escape closes). Shown with `showModal()`; jsdom has no `showModal`, so tests get `open`.
 */
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string
  onClose(): void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const returnFocus = useRef<Element | null>(null)

  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return
    returnFocus.current = document.activeElement
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal()
    } else {
      dialog.setAttribute('open', '')
    }
    return () => {
      const previous = returnFocus.current
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      className="m-auto w-[min(40rem,90vw)] rounded-panel border border-line bg-panel p-0 text-ink shadow-menu backdrop:bg-black/30"
    >
      <div className="flex max-h-[70vh] flex-col gap-3 p-5">
        <h2 id={titleId} className="font-display text-lg font-semibold">
          {title}
        </h2>
        <div className="min-h-0 overflow-auto">{children}</div>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose} autoFocus>
            Close
          </Button>
        </div>
      </div>
    </dialog>
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

export function reasonText(error: ScanError): string {
  return error.reason === 'other'
    ? `Windows reported an error (${error.code}).`
    : REASON_TEXT[error.reason]
}

/** "3 folders couldn’t be read", or "items" as soon as a file is among them. */
export function unreadableSummary(errors: readonly ScanError[], errorCount: number): string {
  // Entries beyond the listed ones are unknown, so only a fully folder list keeps the folder wording.
  const allFolders = errors.every((error) => error.kind === 'folder')
  const noun = allFolders ? 'folder' : 'item'
  return errorCount === 1
    ? `1 ${noun} couldn’t be read`
    : `${formatCount(errorCount)} ${noun}s couldn’t be read`
}

/** Every unreadable entry with a plain-language reason (shown in the "excluded" dialog). */
export function UnreadableList({
  errors,
  errorCount,
}: {
  errors: readonly ScanError[]
  errorCount: number
}) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {errors.map((error, index) => (
          <li key={`${index}:${error.path}`}>
            <p className="font-mono text-[13px] break-all">{error.path}</p>
            <p className="text-ink-muted">{reasonText(error)}</p>
          </li>
        ))}
      </ul>
      {errorCount > errors.length && (
        <p className="text-ink-muted">Showing the first {formatCount(errors.length)}.</p>
      )}
    </div>
  )
}
```

`src/renderer/src/components/StatusBar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithStores } from '../test/render'
import { makeDone, makeProgress } from '../test/scan-fixtures'
import { StatusBar } from './StatusBar'

afterEach(() => {
  vi.useRealTimers()
})

async function renderBar() {
  const utils = renderWithStores(<StatusBar />)
  await act(() => utils.workspace.getState().startScan('D:\\'))
  return utils
}

describe('<StatusBar />', () => {
  it('shows only the version before a scan', async () => {
    const { appStore } = renderWithStores(<StatusBar />)
    await act(() => appStore.getState().loadAppInfo())
    expect(await screen.findByText('StorageIQ 0.1.0')).toBeInTheDocument()
    expect(screen.queryByText(/files found/)).not.toBeInTheDocument()
  })

  it('shows free space, live files found, excluded count and the cluster size', async () => {
    const { api } = await renderBar()
    act(() => api.emitScanProgress(makeProgress({ files: 173_469, errorCount: 3 })))
    const footer = screen.getByRole('contentinfo')
    expect(footer).toHaveTextContent('Free space: 400 GB of 1.0 TB')
    expect(footer).toHaveTextContent('173,469 files found')
    expect(footer).toHaveTextContent('3 excluded')
    expect(footer).toHaveTextContent('4,096 bytes per cluster (NTFS)')
  })

  it('opens the list of unreadable items from the excluded count', async () => {
    const user = userEvent.setup()
    const { api } = await renderBar()
    act(() => api.emitScanDone(makeDone()))
    await user.click(screen.getByRole('button', { name: '2 excluded' }))
    const dialog = screen.getByRole('dialog', { name: '2 folders couldn’t be read' })
    expect(within(dialog).getByText('D:\\System Volume Information')).toBeInTheDocument()
    expect(
      within(dialog).getByText('Windows didn’t give StorageIQ permission to open it.'),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('says items when a file is among the unreadable entries', async () => {
    const user = userEvent.setup()
    const { api } = await renderBar()
    act(() =>
      api.emitScanDone(
        makeDone({
          errors: [
            { path: 'D:\\pagefile.sys', kind: 'file', reason: 'access-denied', code: 'EPERM' },
          ],
          errorCount: 1,
        }),
      ),
    )
    await user.click(screen.getByRole('button', { name: '1 excluded' }))
    expect(screen.getByRole('dialog', { name: '1 item couldn’t be read' })).toBeInTheDocument()
  })

  it('announces progress at most every 5 seconds', async () => {
    vi.useFakeTimers()
    const { api, container } = await renderBar()
    const live = container.querySelector('[aria-live="polite"]')
    act(() => api.emitScanProgress(makeProgress({ files: 999 })))
    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    expect(live).toHaveTextContent('999 files found so far.')
  })
})
```

`src/renderer/src/components/StatusBar.tsx`:

```tsx
import { useState } from 'react'
import { formatBytes, formatCount } from '../lib/format'
import { ANNOUNCE_INTERVAL_MS, useThrottledAnnouncement } from '../lib/use-throttled-announcement'
import { useAppStore } from '../stores/app-store-context'
import { useWorkspace } from '../stores/workspace-store-context'
import { Dialog } from './Dialog'
import { UnreadableList, unreadableSummary } from './UnreadableList'

/**
 * Free space of the drive, files found (live), the excluded (unreadable) count that opens the
 * list, and the cluster size with the file system. Progress is announced at most every 5 s.
 */
export function StatusBar() {
  const phase = useWorkspace((s) => s.phase)
  const totals = useWorkspace((s) => s.totals)
  const errors = useWorkspace((s) => s.errors)
  const drive = useWorkspace((s) => s.drive)
  const announcement = useWorkspace((s) => s.announcement)
  const appInfo = useAppStore((s) => s.appInfo)
  const [showExcluded, setShowExcluded] = useState(false)

  const scanning = phase === 'scanning'
  const progressText =
    phase === 'empty'
      ? ''
      : scanning
        ? `${formatCount(totals.files)} files found so far.`
        : phase === 'failed'
          ? 'The scan stopped.'
          : `Scan finished: ${formatCount(totals.files)} files.`
  const announced = useThrottledAnnouncement(progressText, ANNOUNCE_INTERVAL_MS)
  const excluded = totals.errorCount

  return (
    <footer className="flex h-(--size-status-bar) items-center gap-4 border-t border-line bg-panel px-3 text-xs text-ink-muted tabular-nums">
      {drive !== null && (
        <span>
          Free space: {formatBytes(drive.freeBytes)} of {formatBytes(drive.totalBytes)}
        </span>
      )}
      {phase !== 'empty' && <span>{formatCount(totals.files)} files found</span>}
      {phase !== 'empty' &&
        (excluded > 0 && phase !== 'scanning' ? (
          <button
            type="button"
            onClick={() => setShowExcluded(true)}
            className="min-h-6 rounded-control px-1 underline underline-offset-2 hover:bg-row-hover"
          >
            {formatCount(excluded)} excluded
          </button>
        ) : (
          <span>{formatCount(excluded)} excluded</span>
        ))}
      {drive !== null && (
        <span>
          {formatCount(drive.clusterBytes)} bytes per cluster
          {drive.fileSystem !== '' ? ` (${drive.fileSystem})` : ''}
        </span>
      )}
      {appInfo !== null && <span className="ml-auto shrink-0">StorageIQ {appInfo.version}</span>}
      <span className="sr-only" aria-live="polite">
        {announced}
      </span>
      <span className="sr-only" role="status">
        {announcement}
      </span>
      {showExcluded && (
        <Dialog title={unreadableSummary(errors, excluded)} onClose={() => setShowExcluded(false)}>
          <UnreadableList errors={errors} errorCount={excluded} />
        </Dialog>
      )}
    </footer>
  )
}
```

- [ ] **Step 5: Banner, App and entry**

`src/renderer/src/components/Banner.tsx`:

```tsx
import { useWorkspace } from '../stores/workspace-store-context'
import { Button } from './Button'

/** A problem above the tree: the scanner crashed (with Retry), or an action failed. */
export function Banner() {
  const banner = useWorkspace((s) => s.banner)
  const rescan = useWorkspace((s) => s.rescan)
  const dismissBanner = useWorkspace((s) => s.dismissBanner)
  if (banner === null) return null
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-4 border-b border-danger/40 bg-panel px-4 py-2 text-danger"
    >
      <p>{banner.message}</p>
      <div className="flex shrink-0 gap-2">
        {banner.tone === 'crash' && <Button onClick={() => void rescan()}>Retry</Button>}
        <Button variant="secondary" onClick={dismissBanner}>
          Dismiss
        </Button>
      </div>
    </div>
  )
}
```

`src/renderer/src/App.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { EMPTY_TREE_TEXT } from './components/TreeGrid'
import { SCAN_CRASH_MESSAGE } from './stores/workspace-store'
import { TEST_APP_INFO } from './test/fake-api'
import { renderWithStores } from './test/render'
import { makeDone, makeFailed, makeProgress } from './test/scan-fixtures'

describe('<App />', () => {
  it('opens on the empty workspace: ribbon, column tree, treemap pane and status bar', async () => {
    renderWithStores(<App />)
    expect(screen.getByRole('tablist', { name: 'Ribbon' })).toBeInTheDocument()
    expect(screen.getByRole('treegrid', { name: 'Folder tree' })).toBeInTheDocument()
    expect(screen.getByText(EMPTY_TREE_TEXT)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Treemap' })).toBeInTheDocument()
    expect(screen.getByRole('separator', { name: 'Resize treemap' })).toBeInTheDocument()
    expect(await screen.findByText(`StorageIQ ${TEST_APP_INFO.version}`)).toBeInTheDocument()
  })

  it('scans a drive picked from Select and fills the tree as the scan runs', async () => {
    const user = userEvent.setup()
    const { api } = renderWithStores(<App />)
    await user.click(screen.getByRole('button', { name: /^Select/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Local Disk (C:)' }))
    expect(api.startScan).toHaveBeenCalledWith('C:\\')
    expect(await screen.findByRole('row', { name: /Videos/ })).toBeInTheDocument()
    act(() => api.emitScanProgress(makeProgress()))
    expect(screen.getByRole('contentinfo')).toHaveTextContent('420 files found')
    act(() => api.emitScanDone(makeDone()))
    expect(screen.getByRole('contentinfo')).toHaveTextContent('1,014 files found')
  })

  it('shows the crash banner, and Retry scans again', async () => {
    const user = userEvent.setup()
    const { api, workspace } = renderWithStores(<App />)
    await act(() => workspace.getState().startScan('D:\\'))
    act(() => api.emitScanFailed(makeFailed()))
    expect(screen.getByRole('alert')).toHaveTextContent(SCAN_CRASH_MESSAGE)
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(api.startScan).toHaveBeenCalledTimes(2)
  })

  it('hides the treemap and its splitter, and shows them again from View', async () => {
    const user = userEvent.setup()
    renderWithStores(<App />)
    await user.click(screen.getByRole('button', { name: 'Hide treemap' }))
    expect(screen.queryByRole('region', { name: 'Treemap' })).not.toBeInTheDocument()
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'View' }))
    await user.click(screen.getByRole('button', { name: 'Treemap' }))
    expect(screen.getByRole('region', { name: 'Treemap' })).toBeInTheDocument()
  })

  it('F5 scans the same location again; About opens from File', async () => {
    const user = userEvent.setup()
    const { api, workspace } = renderWithStores(<App />)
    await act(() => workspace.getState().startScan('D:\\'))
    act(() => api.emitScanDone(makeDone()))
    await user.keyboard('{F5}')
    expect(api.startScan).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole('tab', { name: 'File' }))
    await user.click(screen.getByRole('button', { name: 'About' }))
    expect(screen.getByRole('dialog', { name: 'About StorageIQ' })).toHaveTextContent('MIT license')
  })
})
```

`src/renderer/src/App.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Banner } from './components/Banner'
import { Dialog } from './components/Dialog'
import { Ribbon } from './components/Ribbon'
import { Splitter } from './components/Splitter'
import { StatusBar } from './components/StatusBar'
import { TreeGrid } from './components/TreeGrid'
import { TreemapPane } from './components/TreemapPane'
import { useAppStore } from './stores/app-store-context'
import { useWorkspace } from './stores/workspace-store-context'

export const TREEMAP_DEFAULT_HEIGHT = 260
export const TREEMAP_MIN_HEIGHT = 120
export const TREEMAP_MAX_HEIGHT = 900

/** The analyzer workspace: ribbon, column tree, treemap pane and status bar, top to bottom. */
export function App() {
  const loadAppInfo = useAppStore((s) => s.loadAppInfo)
  const appInfo = useAppStore((s) => s.appInfo)
  const loadMenuData = useWorkspace((s) => s.loadMenuData)
  const treemapVisible = useWorkspace((s) => s.treemapVisible)
  const rescan = useWorkspace((s) => s.rescan)
  const [treemapHeight, setTreemapHeight] = useState(TREEMAP_DEFAULT_HEIGHT)
  const [aboutOpen, setAboutOpen] = useState(false)

  useEffect(() => {
    void loadAppInfo()
    void loadMenuData()
  }, [loadAppInfo, loadMenuData])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F5') {
        event.preventDefault()
        void rescan()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [rescan])

  return (
    <div className="flex h-full flex-col bg-app text-ink">
      <Ribbon onAbout={() => setAboutOpen(true)} />
      <Banner />
      <main className="flex min-h-0 flex-1 flex-col">
        <TreeGrid />
        {treemapVisible && (
          <>
            <Splitter
              value={treemapHeight}
              min={TREEMAP_MIN_HEIGHT}
              max={TREEMAP_MAX_HEIGHT}
              onChange={setTreemapHeight}
            />
            <TreemapPane height={treemapHeight} />
          </>
        )}
      </main>
      <StatusBar />
      {aboutOpen && (
        <Dialog title="About StorageIQ" onClose={() => setAboutOpen(false)}>
          <p>StorageIQ {appInfo?.version ?? ''}</p>
          <p className="text-ink-muted">
            Shows where your disk space went. Free and open source under the MIT license.
          </p>
        </Dialog>
      )}
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
import { createWorkspaceStore } from './stores/workspace-store'
import { WorkspaceStoreProvider } from './stores/workspace-store-context'
import './styles/global.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('StorageIQ: #root element is missing from index.html')
}

if (window.storageiq === undefined) {
  throw new Error('StorageIQ: the preload bridge is missing')
}

const appStore = createAppStore(window.storageiq)
const workspaceStore = createWorkspaceStore(window.storageiq)

createRoot(container).render(
  <StrictMode>
    <AppStoreProvider store={appStore}>
      <WorkspaceStoreProvider store={workspaceStore}>
        <App />
      </WorkspaceStoreProvider>
    </AppStoreProvider>
  </StrictMode>,
)
```

- [ ] **Step 6: All gates (the integration window closes here)**

```powershell
npm run format
npm run format:check
node scripts/build-tokens.mjs --check
npm run lint
npm run typecheck
npx vitest run
npm run test:perf
```

Expected: all green — 43 files, 424 tests; perf 1 test.

- [ ] **Step 7: Impeccable**

```powershell
& "<impeccable skill>\scripts\impeccable.cmd" detect --json src/renderer
```

Expected: `[]`.

- [ ] **Step 8: Commit**

```powershell
git add src/renderer/src/lib/treemap-draw.ts src/renderer/src/lib/treemap-draw.test.ts src/renderer/src/components/TreemapPane.tsx src/renderer/src/components/TreemapPane.test.tsx src/renderer/src/components/LevelBar.tsx src/renderer/src/components/Splitter.tsx src/renderer/src/components/Splitter.test.tsx src/renderer/src/components/StatusBar.tsx src/renderer/src/components/StatusBar.test.tsx src/renderer/src/components/Banner.tsx src/renderer/src/components/Dialog.tsx src/renderer/src/components/UnreadableList.tsx src/renderer/src/App.tsx src/renderer/src/App.test.tsx src/renderer/src/main.tsx
git commit -m @'
feat(renderer): treemap pane with levels, splitter, status bar and the workspace shell

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 9: Workspace E2E, CI perf gate, metrics, docs and checks by eye

**Implementer tier:** standard

E2E launches with `STORAGEIQ_TEST_HOOKS=1`, which (unpackaged runs only) exposes `__storageiqProbeShellMenu(path)` in main so a test can list the real menu's labels without showing it. Exact values are checked through `data-bytes` and the formatted cells, with the allocated sizes computed from the fixture's drive cluster size read through `drive:info`. Two opt-in specs: `metrics.spec.ts` (`STORAGEIQ_METRICS=1`) and `screenshots.spec.ts` (`STORAGEIQ_SCREENSHOTS=1`, light and dark, into the git-ignored `screenshots/`).

**Files:**

- Create: `e2e/support/workspace.ts`, `e2e/workspace.spec.ts`, `e2e/screenshots.spec.ts`
- Modify: `e2e/support/launch.ts`, `e2e/support/fixture.ts`, `e2e/app.spec.ts`, `e2e/metrics.spec.ts`, `scripts/report-metrics.mjs`, `scripts/check-packaged-app.mjs`, `.github/workflows/ci.yml`, `eslint.config.mjs`, `.gitignore`, `.prettierignore`, `README.md`, `docs/ROADMAP.md`, `PRODUCT.md`
- Delete: `e2e/scan.spec.ts`

**Interfaces:**

- Consumes: the whole app.
- Produces: `launchEnv.STORAGEIQ_TEST_HOOKS`; `ExpectedRow`, `ScanFixture.expected { files, folders, bytes, folders12, rootFiles, rootFileSizes }`, `sum`, `allocated(fileSizes, clusterBytes)`; `count`, `stubFolderDialog`, `ribbonButton`, `openSelectMenu`, `scanFolder`, `treegrid`, `treeRow`, `cellTexts`, `cellBytes`, `driveDetails`.

- [ ] **Step 1: E2E support**

`e2e/support/launch.ts`:

```ts
import path from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

// ELECTRON_RUN_AS_NODE makes Electron behave as plain Node, so it must not leak into the launch.
// STORAGEIQ_TEST_HOOKS exposes the test-only Explorer-menu probe in main (unpackaged runs only).
export const launchEnv: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== 'ELECTRON_RUN_AS_NODE',
    ),
  ),
  STORAGEIQ_TEST_HOOKS: '1',
}

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

`e2e/support/fixture.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Expected values of one tree row, before cluster rounding is applied. */
export interface ExpectedRow {
  name: string
  /** Sizes of the files below the row, to compute the allocated size for any cluster size. */
  fileSizes: number[]
  files: number
  folders: number
}

export interface ScanFixture {
  /** The folder to scan. */
  root: string
  expected: {
    files: number
    folders: number
    bytes: number
    /** The 12 top-level folders, largest first. */
    folders12: ExpectedRow[]
    /** The "[N files]" row of the root: root-file.txt and the junction (0 bytes). */
    rootFiles: ExpectedRow
    rootFileSizes: number[]
  }
  remove(): void
}

export const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

/** `ceil(size / cluster) * cluster` per file; 0-byte entries take 0 (spec §4). */
export function allocated(fileSizes: number[], clusterBytes: number): number {
  return sum(
    fileSizes.map((size) => (size === 0 ? 0 : Math.ceil(size / clusterBytes) * clusterBytes)),
  )
}

/**
 * 12 top-level folders of different sizes, each with a nested folder; one file directly in the
 * root; and a junction to a folder outside the root, which must be counted as one 0-byte entry
 * and never entered.
 */
export function createScanFixture(): ScanFixture {
  const base = mkdtempSync(path.join(os.tmpdir(), 'storageiq-e2e-'))
  const root = path.join(base, 'scan-me')
  const outside = path.join(base, 'outside')
  mkdirSync(root)
  mkdirSync(outside)
  writeFileSync(path.join(outside, 'not-counted.bin'), Buffer.alloc(50_000))

  const tops: ExpectedRow[] = []
  for (let i = 1; i <= 12; i += 1) {
    const name = `folder-${String(i).padStart(2, '0')}`
    const folder = path.join(root, name)
    const nested = path.join(folder, 'nested')
    mkdirSync(nested, { recursive: true })
    const size = i * 1000
    for (let f = 0; f < 3; f += 1)
      writeFileSync(path.join(folder, `file-${f}.bin`), Buffer.alloc(size))
    for (let f = 0; f < 2; f += 1)
      writeFileSync(path.join(nested, `file-${f}.bin`), Buffer.alloc(size))
    tops.push({ name, fileSizes: Array(5).fill(size) as number[], files: 5, folders: 1 })
  }
  writeFileSync(path.join(root, 'root-file.txt'), Buffer.alloc(777))
  symlinkSync(outside, path.join(root, 'link-to-outside'), 'junction')
  const rootFiles: ExpectedRow = { name: '[2 files]', fileSizes: [777, 0], files: 2, folders: 0 }

  const rootFileSizes = [...tops.flatMap((top) => top.fileSizes), ...rootFiles.fileSizes]
  return {
    root,
    expected: {
      files: rootFileSizes.length, // 62
      folders: tops.length * 2, // 24
      bytes: sum(rootFileSizes), // 390,777
      folders12: [...tops].sort((a, b) => sum(b.fileSizes) - sum(a.fileSizes)),
      rootFiles,
      rootFileSizes,
    },
    remove: () => rmSync(base, { recursive: true, force: true }),
  }
}

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

`e2e/support/workspace.ts`:

```ts
import { type ElectronApplication, expect, type Locator, type Page } from '@playwright/test'
import type { StorageIQApi } from '../../src/shared/ipc-contract'
import type { DriveDetails } from '../../src/shared/scan-types'

export const count = new Intl.NumberFormat('en-US')

/** Makes the next native folder dialog return `folder`. */
export async function stubFolderDialog(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [chosen],
    })) as typeof dialog.showOpenDialog
  }, folder)
}

export function ribbonButton(page: Page, name: string | RegExp): Locator {
  return page.getByRole('toolbar').getByRole('button', { name })
}

export async function openSelectMenu(page: Page): Promise<Locator> {
  await ribbonButton(page, /^Select/).click()
  const menu = page.getByRole('menu', { name: 'Select a drive or folder' })
  await expect(menu).toBeVisible()
  return menu
}

/** Picks `folder` through Select → "Choose a folder…" and waits for the scan to end. */
export async function scanFolder(app: ElectronApplication, page: Page, folder: string) {
  await stubFolderDialog(app, folder)
  const menu = await openSelectMenu(page)
  await menu.getByRole('menuitem', { name: 'Choose a folder…' }).click()
  await expect(ribbonButton(page, 'Refresh')).not.toHaveAttribute('aria-disabled', 'true', {
    timeout: 20_000,
  })
}

export const treegrid = (page: Page) => page.getByRole('treegrid', { name: 'Folder tree' })

/** The tree row whose name cell ends with `name`. */
export function treeRow(page: Page, name: string): Locator {
  return treegrid(page)
    .getByRole('row')
    .filter({ has: page.getByRole('gridcell').first().getByTitle(name, { exact: true }) })
}

export async function cellTexts(row: Locator): Promise<string[]> {
  return row.getByRole('gridcell').allTextContents()
}

export async function cellBytes(row: Locator, column: 1 | 2): Promise<number> {
  return Number(await row.getByRole('gridcell').nth(column).getAttribute('data-bytes'))
}

export function driveDetails(page: Page, root: string): Promise<DriveDetails | null> {
  return page.evaluate(
    (driveRoot) =>
      (globalThis as unknown as { storageiq: StorageIQApi }).storageiq.getDriveInfo(driveRoot),
    root,
  )
}
```

- [ ] **Step 2: Specs**

`e2e/app.spec.ts`:

```ts
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import type { StorageIQApi } from '../src/shared/ipc-contract'
import type { ScanDone } from '../src/shared/scan-types'
import type { TreePage } from '../src/shared/tree-types'
import { createScanFixture } from './support/fixture'
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
  await expect(page.getByRole('tablist', { name: 'Ribbon' })).toBeVisible()

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
  expect(keys).toEqual([
    'cancelScan',
    'createFolder',
    'getAppInfo',
    'getChildren',
    'getDriveInfo',
    'getExpandIds',
    'getNode',
    'getTreemap',
    'listDrives',
    'listPlaces',
    'onScanDone',
    'onScanFailed',
    'onScanProgress',
    'onTreeChanged',
    'openInExplorer',
    'quit',
    'refreshFolder',
    'selectFolder',
    'showContextMenu',
    'startScan',
    'writeClipboardText',
  ])
})

test('shows the version reported by the main process', async () => {
  const version = await app!.evaluate(({ app: electronApp }) => electronApp.getVersion())
  await expect(
    page.getByRole('contentinfo').getByText(`StorageIQ ${version}`, { exact: true }),
  ).toBeVisible()
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

test('scans a folder through the bridge and pages its children from the scanner', async () => {
  const fixture = createScanFixture()
  try {
    const result = await page.evaluate(async (root) => {
      const api = (globalThis as unknown as { storageiq: StorageIQApi }).storageiq
      const done = await new Promise<ScanDone>((resolve, reject) => {
        const off = api.onScanDone((value) => {
          off()
          resolve(value)
        })
        api.startScan(root).catch(reject)
      })
      const page: TreePage | null = await api.getChildren(done.scanId, 'd0', 'name', 'asc', 0, 5)
      return { done, page }
    }, fixture.root)

    expect(result.done).toMatchObject({
      status: 'complete',
      files: fixture.expected.files,
      folders: fixture.expected.folders,
      bytes: fixture.expected.bytes,
      errorCount: 0,
    })
    expect(result.page?.total).toBe(13)
    expect(result.page?.rows.map((row) => row.name || '[files]')).toEqual([
      '[files]',
      'folder-01',
      'folder-02',
      'folder-03',
      'folder-04',
    ])
  } finally {
    fixture.remove()
  }
})

test('rejects a relative scan path and a malformed tree query before the scanner sees them', async () => {
  const outcome = await page.evaluate(async () => {
    const api = (globalThis as unknown as { storageiq: StorageIQApi }).storageiq
    const attempt = async (call: () => Promise<unknown>) => {
      try {
        await call()
        return 'resolved'
      } catch (error) {
        return String(error)
      }
    }
    return {
      relative: await attempt(() => api.startScan('relative\\folder')),
      node: await attempt(() => api.getChildren('scan', '../../etc', 'size', 'desc', 0, 10)),
      limit: await attempt(() => api.getChildren('scan', 'd0', 'size', 'desc', 0, 1_000_000)),
    }
  })
  expect(outcome.relative).toContain('Invalid IPC arguments')
  expect(outcome.node).toContain('Invalid IPC arguments')
  expect(outcome.limit).toContain('Invalid IPC arguments')
})

test('opens in Explorer and copies only paths of the current scan', async () => {
  const outcome = await page.evaluate(async () => {
    const api = (globalThis as unknown as { storageiq: StorageIQApi }).storageiq
    try {
      await api.openInExplorer('00000000-0000-0000-0000-000000000000', 'd0')
      return 'resolved'
    } catch (error) {
      return String(error)
    }
  })
  expect(outcome).toContain('not part of the current scan')
})

test('lists the system drive and reads its cluster size through koffi', async () => {
  const systemRoot = `${process.env['SystemDrive'] ?? 'C:'}\\`
  const { drives, details } = await page.evaluate(async (root) => {
    const api = (globalThis as unknown as { storageiq: StorageIQApi }).storageiq
    return { drives: await api.listDrives(), details: await api.getDriveInfo(root) }
  }, systemRoot)
  expect(drives).toContainEqual(expect.objectContaining({ root: systemRoot, kind: 'fixed' }))
  for (const drive of drives) expect(['fixed', 'removable']).toContain(drive.kind)
  expect(details).toMatchObject({ root: systemRoot, fileSystem: 'NTFS' })
  expect(details?.clusterBytes).toBeGreaterThanOrEqual(512)
})

test('quits cleanly when closed while the first page is still loading', async () => {
  // Quitting aborts the in-flight load; that must not raise the modal startup-error box.
  await app!.close()
  app = undefined
})
```

`e2e/workspace.spec.ts`:

```ts
import { existsSync } from 'node:fs'
import path from 'node:path'
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import { SCANNER_SERVICE_NAME } from '../src/shared/scanner-protocol'
import { allocated, createScanFixture, type ScanFixture, sum } from './support/fixture'
import { consoleErrors, launchApp } from './support/launch'
import {
  cellBytes,
  cellTexts,
  count,
  driveDetails,
  openSelectMenu,
  ribbonButton,
  scanFolder,
  treegrid,
  treeRow,
} from './support/workspace'

let app: ElectronApplication | undefined
let page: Page
let fixture: ScanFixture | undefined

const systemDrive = process.env['SystemDrive'] ?? 'C:'

test.beforeEach(async () => {
  const launched = await launchApp()
  app = launched.app
  page = launched.page
})

test.afterEach(async () => {
  await app?.close()
  app = undefined
  fixture?.remove()
  fixture = undefined
})

async function scanFixture(): Promise<{ fixture: ScanFixture; cluster: number }> {
  fixture = createScanFixture()
  const details = await driveDetails(page, `${fixture.root.slice(0, 2)}\\`)
  expect(details).not.toBeNull()
  await scanFolder(app!, page, fixture.root)
  return { fixture, cluster: details!.clusterBytes }
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
  const menu = await openSelectMenu(page)
  await menu.getByRole('menuitem', { name: new RegExp(`\\(${systemDrive}\\)`) }).click()
  await expect(ribbonButton(page, 'Stop')).not.toHaveAttribute('aria-disabled', 'true')
  await expect.poll(scannerPid).toBeDefined()
}

test('opens on the empty workspace', async () => {
  await expect(page.getByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'true')
  await expect(treegrid(page)).toContainText('Choose a drive or folder from Select')
  await expect(
    page.getByRole('toolbar', { name: 'Treemap levels' }).getByRole('button'),
  ).toHaveCount(6)
  expect(await consoleErrors(app!)).toEqual([])
})

test('the Select menu lists the system drive', async () => {
  const menu = await openSelectMenu(page)
  await expect(menu.getByRole('group', { name: 'Drives' })).toContainText(`(${systemDrive})`)
  await expect(menu.getByRole('menuitem', { name: 'Choose a folder…' })).toBeVisible()
})

test('every column of the tree matches the generated fixture exactly', async () => {
  const { fixture: f, cluster } = await scanFixture()
  const root = treeRow(page, f.root)
  expect(await cellBytes(root, 1)).toBe(f.expected.bytes)
  expect(await cellBytes(root, 2)).toBe(allocated(f.expected.rootFileSizes, cluster))
  const rootCells = await cellTexts(root)
  expect(rootCells.slice(3, 6)).toEqual([
    count.format(f.expected.files),
    count.format(f.expected.folders),
    '100.0%',
  ])

  for (const expected of f.expected.folders12) {
    const row = treeRow(page, expected.name)
    expect(await cellBytes(row, 1)).toBe(sum(expected.fileSizes))
    expect(await cellBytes(row, 2)).toBe(allocated(expected.fileSizes, cluster))
    const cells = await cellTexts(row)
    expect(cells[3]).toBe(count.format(expected.files))
    expect(cells[4]).toBe(count.format(expected.folders))
    const share = (sum(expected.fileSizes) / f.expected.bytes) * 100
    expect(cells[5]).toBe(share < 0.05 ? '<0.1%' : `${share.toFixed(1)}%`)
    expect(cells[6]).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/)
  }
  const files = treeRow(page, f.expected.rootFiles.name)
  expect(await cellBytes(files, 1)).toBe(777)
  expect(await cellBytes(files, 2)).toBe(allocated(f.expected.rootFiles.fileSizes, cluster))
  expect((await cellTexts(files))[3]).toBe('2')

  await expect(page.getByRole('contentinfo')).toContainText(
    `${count.format(f.expected.files)} files found`,
  )
  await expect(page.getByRole('contentinfo')).toContainText('0 excluded')
  await expect(page.getByRole('contentinfo')).toContainText(
    `${count.format(cluster)} bytes per cluster`,
  )
  expect(await consoleErrors(app!)).toEqual([])
})

test('sorts by a column and reverses on a second click', async () => {
  await scanFixture()
  const names = async () =>
    (
      await treegrid(page)
        .locator('[role="row"] > [role="gridcell"]:first-child span[title]')
        .allTextContents()
    ).slice(1, 4)
  expect(await names()).toEqual(['folder-12', 'folder-11', 'folder-10'])
  await treegrid(page).getByRole('button', { name: /^Name/ }).click()
  await expect.poll(names).toEqual(['[2 files]', 'folder-01', 'folder-02'])
  await treegrid(page).getByRole('button', { name: /^Name/ }).click()
  await expect.poll(names).toEqual(['folder-12', 'folder-11', 'folder-10'])
  await expect(treegrid(page).getByRole('columnheader', { name: /Name/ })).toHaveAttribute(
    'aria-sort',
    'descending',
  )
})

test('expands and moves with the keyboard, and copies the selected path', async () => {
  const { fixture: f } = await scanFixture()
  await treegrid(page).focus()
  await page.keyboard.press('ArrowDown')
  await expect(treeRow(page, 'folder-12')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowRight')
  await expect(treeRow(page, 'nested')).toHaveAttribute('aria-level', '3')
  // Children are sorted by size: "[3 files]" (36,000 bytes) comes before "nested" (24,000).
  await page.keyboard.press('ArrowRight')
  await expect(treeRow(page, '[3 files]')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowDown')
  await expect(treeRow(page, 'nested')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Control+c')
  await expect
    .poll(() => app!.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe(path.join(f.root, 'folder-12', 'nested'))
  await page.keyboard.press('ArrowLeft')
  await expect(treeRow(page, 'folder-12')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowLeft')
  await expect(treeRow(page, 'nested')).toHaveCount(0)
})

test('a treemap click selects the matching tree row; a double-click drills in', async () => {
  await scanFixture()
  const canvas = page.getByRole('img', { name: /^Treemap of/ })
  await expect(canvas).toBeVisible()
  // Squarify places the largest child (folder-12) first, at the top-left corner; at Level 1
  // the point (10, 10) is in its label strip, above its nested blocks.
  await canvas.click({ position: { x: 10, y: 10 } })
  await expect(treeRow(page, 'folder-12')).toHaveAttribute('aria-selected', 'true')
  await canvas.dblclick({ position: { x: 10, y: 10 } })
  await expect(canvas).toHaveAccessibleName(/^Treemap of folder-12/)
  await page
    .getByRole('toolbar', { name: 'Treemap levels' })
    .getByRole('button', { name: 'Level 0' })
    .click()
  await expect(
    page.getByRole('toolbar', { name: 'Treemap levels' }).getByRole('button', { name: 'Level 0' }),
  ).toHaveAttribute('aria-pressed', 'true')
})

test('hides the treemap with × and shows it from the View tab', async () => {
  await page.getByRole('button', { name: 'Hide treemap' }).click()
  await expect(page.getByRole('region', { name: 'Treemap' })).toHaveCount(0)
  await page.getByRole('tab', { name: 'View' }).click()
  await ribbonButton(page, 'Treemap').click()
  await expect(page.getByRole('region', { name: 'Treemap' })).toBeVisible()
})

test('the Explorer context menu holds StorageIQ’s items and the shell’s items', async () => {
  const { fixture: f } = await scanFixture()
  const labels = await app!.evaluate(async (_electron, target) => {
    const probe = (
      globalThis as unknown as {
        __storageiqProbeShellMenu: (path: string) => Promise<string[]>
      }
    ).__storageiqProbeShellMenu
    return probe(target)
  }, f.root)
  expect(labels.slice(0, 3)).toEqual(['&StorageIQ', 'New &folder\tCtrl+N', ''])
  const shellItems = labels.slice(3).filter((label) => label !== '')
  expect(shellItems.length).toBeGreaterThan(5)
})

test('New folder creates "New folder" and the tree shows it', async () => {
  const { fixture: f } = await scanFixture()
  await treeRow(page, 'folder-01').click()
  await treegrid(page).focus()
  await page.keyboard.press('Control+n')
  await treeRow(page, 'folder-01').dblclick()
  await expect(treeRow(page, 'New folder')).toBeVisible()
  await expect(treeRow(page, 'folder-01').getByRole('gridcell').nth(4)).toHaveText('2')
  expect(existsSync(path.join(f.root, 'folder-01', 'New folder'))).toBe(true)
})

test('the tree and the status bar update while a scan runs, and Stop ends it quickly', async () => {
  await startSystemDriveScan()
  const footer = page.getByRole('contentinfo')
  const filesFound = async () =>
    Number(
      (/([\d,]+) files found/.exec((await footer.textContent()) ?? '')?.[1] ?? '0').replace(
        /,/g,
        '',
      ),
    )
  await expect.poll(filesFound).toBeGreaterThan(0)
  const first = await filesFound()
  await expect.poll(filesFound, { timeout: 10_000 }).toBeGreaterThan(first)
  await expect(treegrid(page).getByRole('row').nth(1)).toBeVisible()
  await expect(footer).toContainText('bytes per cluster')

  const clickedAt = Date.now()
  await ribbonButton(page, 'Stop').click()
  await expect(ribbonButton(page, 'Stop')).toHaveAttribute('aria-disabled', 'true')
  expect(Date.now() - clickedAt).toBeLessThan(2_000)
})

test('shows the crash banner when the scanner process dies, and Retry scans again', async () => {
  await startSystemDriveScan()
  const pid = await scannerPid()
  expect(pid).toBeDefined()
  process.kill(pid!)
  await expect(page.getByRole('alert')).toContainText(
    'The scan stopped unexpectedly. You can try again.',
  )
  await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click()
  await expect(ribbonButton(page, 'Stop')).not.toHaveAttribute('aria-disabled', 'true')
})

test('quitting during a scan leaves no scanner process behind', async () => {
  await startSystemDriveScan()
  const pid = await scannerPid()
  expect(pid).toBeDefined()
  await app!.close()
  app = undefined
  await expect.poll(() => isAlive(pid!), { timeout: 5_000 }).toBe(false)
})

test('a scanned folder appears under "Recently scanned"', async () => {
  const { fixture: f } = await scanFixture()
  const menu = await openSelectMenu(page)
  await expect(menu.getByRole('group', { name: 'Recently scanned' })).toContainText(f.root)
})
```

`e2e/metrics.spec.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { createLargeFixture } from './support/fixture'
import { launchApp } from './support/launch'
import { openSelectMenu, ribbonButton, scanFolder } from './support/workspace'

// Report-only CI metrics. Never gating; skipped unless asked for.
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

    let startedAt = Date.now()
    await scanFolder(app, page, fixture.root)
    const scanWallMs = Date.now() - startedAt

    const systemDrive = process.env['SystemDrive'] ?? 'C:'
    const menu = await openSelectMenu(page)
    await menu.getByRole('menuitem', { name: new RegExp(`\\(${systemDrive}\\)`) }).click()
    await expect(ribbonButton(page, 'Stop')).not.toHaveAttribute('aria-disabled', 'true')
    await page.waitForTimeout(1_000)
    startedAt = Date.now()
    await ribbonButton(page, 'Stop').click()
    await expect(ribbonButton(page, 'Stop')).toHaveAttribute('aria-disabled', 'true')
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

`e2e/screenshots.spec.ts`:

```ts
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { createScanFixture } from './support/fixture'
import { launchApp } from './support/launch'
import { openSelectMenu, ribbonButton, scanFolder, treegrid, treeRow } from './support/workspace'

// By-eye check (spec §5): every view in light and dark. Not a gate; run on demand with
// STORAGEIQ_SCREENSHOTS=1 and look at screenshots/*.png.
test.skip(process.env['STORAGEIQ_SCREENSHOTS'] !== '1', 'Set STORAGEIQ_SCREENSHOTS=1')

for (const scheme of ['light', 'dark'] as const) {
  test(`captures every view in ${scheme} mode`, async () => {
    test.setTimeout(120_000)
    const dir = path.resolve('screenshots')
    mkdirSync(dir, { recursive: true })
    const fixture = createScanFixture()
    const { app, page } = await launchApp()
    try {
      await page.emulateMedia({ colorScheme: scheme })
      const shot = (name: string) =>
        page.screenshot({ path: path.join(dir, `${scheme}-${name}.png`) })
      await expect(treegrid(page)).toBeVisible()
      await shot('1-empty')
      await openSelectMenu(page)
      await shot('2-select-menu')
      await page.keyboard.press('Escape')
      await scanFolder(app, page, fixture.root)
      await treeRow(page, 'folder-12').dblclick()
      await shot('3-tree-and-treemap')
      await page
        .getByRole('toolbar', { name: 'Treemap levels' })
        .getByRole('button', { name: 'Level 3' })
        .click()
      await ribbonButton(page, 'Allocated').click()
      await shot('4-allocated-level-3')
      await page.getByRole('tab', { name: 'View' }).click()
      await ribbonButton(page, 'Treemap').click()
      await shot('5-view-tab-treemap-hidden')
      await page.getByRole('tab', { name: 'File' }).click()
      await ribbonButton(page, 'About').click()
      await shot('6-about')
      await page.keyboard.press('Escape')
      await page.getByRole('tab', { name: 'Home' }).click()
      const menu = await openSelectMenu(page)
      await menu
        .getByRole('menuitem', { name: new RegExp(`\\(${process.env['SystemDrive'] ?? 'C:'}\\)`) })
        .click()
      await page.waitForTimeout(2_000)
      await shot('7-scanning-drive')
      await ribbonButton(page, 'Stop').click()
    } finally {
      await app.close()
      fixture.remove()
    }
  })
}
```

```powershell
git rm e2e/scan.spec.ts
```

- [ ] **Step 3: Ignore screenshots; CI perf gate; metrics and packaged-check text**

Append `screenshots/` to `.gitignore` and `screenshots` to `.prettierignore`.

`eslint.config.mjs`:

```js
import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  {
    ignores: [
      'out/**',
      'release/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'metrics/**',
      'screenshots/**',
    ],
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
    files: [
      'src/main/**/*.ts',
      'src/preload/**/*.ts',
      'src/worker/**/*.ts',
      'e2e/**/*.ts',
      '*.config.{ts,mts,mjs}',
      'scripts/**/*.mjs',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['e2e/support/capture-console.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['e2e/support/csp-listener.cjs'],
    languageOptions: { sourceType: 'script', globals: globals.browser },
  },
)
```

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
          node-version: 24
          cache: npm

      - run: npm ci
      - run: npm run format:check
      - name: Design tokens are up to date (design/tokens.css from design/tokens.json)
        run: node scripts/build-tokens.mjs --check
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - name: Performance limits, 1M generated files (hard limits; writes metrics/perf.json)
        run: npm run test:perf

      - name: Build
        run: npx electron-vite build

      - name: End-to-end tests
        run: npx playwright test

      - name: Package installer
        run: npx electron-builder --win --x64 --publish never

      - name: Packaged app self-test (koffi from app.asar.unpacked, Explorer menu, scanner)
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

`scripts/report-metrics.mjs`:

```js
// Report-only metrics for CI: renderer bundle size, installer size, idle RAM, scan time of a
// generated ~20,000-file tree, cancel latency, and the 1M-file tree-store perf figures (whose
// limits are enforced by src/worker/scanner/tree-store.perf.test.ts). Never fails the build.
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

function perfMetrics() {
  const file = path.join('metrics', 'perf.json')
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}

const bundle = rendererBundleBytes()
const perf = perfMetrics()
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
  [
    'Tree memory, 1M files (limit 300 MB; 125 B/file)',
    perf ? `${perf.memoryMb.toFixed(1)} MB (${perf.bytesPerFile.toFixed(0)} B/file)` : 'n/a',
  ],
  ['First tree page, 1M files (limit 100 ms)', perf ? `${perf.firstPageMs.toFixed(1)} ms` : 'n/a'],
  ['Treemap layout, 1M files (limit 100 ms)', perf ? `${perf.treemapMs.toFixed(1)} ms` : 'n/a'],
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

`scripts/check-packaged-app.mjs`:

```js
// Runs the packaged app with --self-test: koffi must load from app.asar.unpacked, at least one
// drive must be listed, the Explorer context menu must build through COM, and the scanner
// utilityProcess must complete a scan of the resources folder without walking into app.asar.
// Exit code 0 means pass (codes: src/main/self-test.ts).
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
console.log(
  'Packaged self-test passed: koffi loaded from app.asar.unpacked; the Explorer menu built; the scanner ran.',
)
```

- [ ] **Step 4: Build and run every E2E test**

```powershell
npx electron-vite build
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npx playwright test
```

Expected: 22 passed, 3 skipped (metrics and the two screenshot tests).

- [ ] **Step 5: Package and run the packaged self-test**

```powershell
npx electron-builder --win --x64 --publish never
npm run test:packaged
```

Expected: `[self-test] shell menu: N items` (N > 5), `[self-test] scan: … files`, then `Packaged self-test passed: koffi loaded from app.asar.unpacked; the Explorer menu built; the scanner ran.`

- [ ] **Step 6: Report-only metrics**

```powershell
$env:STORAGEIQ_METRICS='1'; npx playwright test e2e/metrics.spec.ts; $env:STORAGEIQ_METRICS=''
npm run test:perf
npm run metrics
```

Expected: a table with bundle (about 677 kB), installer (about 116 MB), idle RAM, 20,000-file scan time, cancel latency (< 500 ms), tree memory, first page and treemap time (dry run: 360 MB idle, 1.1 s, 218 ms, 72 MB, 8 ms, 66 ms before the warm-up change / under 1 ms after it).

- [ ] **Step 7: Check every view by eye, light and dark**

```powershell
$env:STORAGEIQ_SCREENSHOTS='1'; npx playwright test e2e/screenshots.spec.ts; $env:STORAGEIQ_SCREENSHOTS=''
```

Open `screenshots/light-*.png` and `screenshots/dark-*.png` (empty workspace, Select menu, tree and treemap, Allocated at Level 3, View tab with the treemap hidden, About, a running drive scan). Check: ribbon groups and captions aligned; pressed toggles visible; bars inside the Name cell; bold rows at ≥ 10 %; "[N files]" rows; treemap labels legible in both themes; status bar content. Record "by-eye OK" or the defects in the ledger.

- [ ] **Step 8: Manual Explorer-menu check (Playwright cannot drive a native menu)**

Run `npm run dev`, scan a test folder, then on a folder row and on a file row: (1) right-click → the menu shows StorageIQ ▸, New folder Ctrl+N, a separator and Explorer's items with their icons; (2) hover Send to → its submenu fills in; (3) StorageIQ ▸ Copy path → the path is on the clipboard; (4) New folder → "New folder" appears in the tree; (5) Delete a test file → it goes to the Recycle Bin and the tree and status bar update within 2 s; (6) Properties opens; (7) with the keyboard: select a row, Shift+F10 and the Menu key open the menu at the row, arrows and Enter work, Escape closes it; (8) Shift+right-click shows extended verbs (Copy as path). Record the result in the ledger.

- [ ] **Step 9: Docs**

`README.md`: replace the `> **Status:** …` paragraph with:

```markdown
> **Status:** early development. Phase 3 (Analyzer Workspace) turns the scanner into a full workspace: a ribbon with a Select menu (drives, Documents, OneDrive, recent scans, any folder), a virtualized column tree (size, allocated size, files, folders, share of the parent, last modified), a treemap pane with levels 0–5, the Windows Explorer context menu on every row, and a status bar with free space and cluster size. Next: side views (top files, file types, file age). See the [roadmap](docs/ROADMAP.md).
```

add `npm run tokens       # regenerate design/tokens.css from design/tokens.json` and `npm run test:perf    # 1M-file tree-store limits` to the Development commands, and replace the `## Architecture` section with:

```markdown
## Architecture

- `src/main`: Electron main process (window, security policy, IPC handlers, drive and volume details through koffi, the Explorer context menu through COM)
- `src/worker`: the scanner utilityProcess (directory walk, columnar tree store, tree pages, treemap layout, folder refresh)
- `src/preload`: the only bridge to the renderer (`window.storageiq`)
- `src/renderer`: React UI (Tailwind, Zustand, Lucide icons): ribbon, column tree, treemap, status bar
- `src/shared`: types shared by every process, including the IPC contract
- `design`: design tokens (`tokens.json` → `tokens.css`), component specs and the contrast report

Security baseline: context isolation, sandboxed renderer, no Node integration, strict CSP, blocked navigation and pop-ups, a sender check and argument validation on every IPC call, and shell actions only on paths from the current scan. Read [docs/ROADMAP.md](docs/ROADMAP.md) for the architecture decisions.
```

`docs/ROADMAP.md`: set `**Current phase:** Phase 3 — Analyzer Workspace`; replace the `## Roadmap` section (heading and table, up to the first `### Phase 1` heading) with:

```markdown
## Roadmap

Roadmap v3, approved 2026-11-19 ([spec](superpowers/specs/2026-11-19-phase-3-workspace-design.md) §2). It supersedes the phase order of roadmap v2; the Phase 2a scanner, IPC and drive code stay.

| #   | Phase              | Status                                                                      | Exit criterion                                                                                                                                           |
| --- | ------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Foundation         | **Done**                                                                    | Secure app shell, typed IPC, tests, installer, CI                                                                                                        |
| 2a  | Core scanner       | **Done** (merged in PR #1)                                                  | Scans a drive in a utilityProcess with live progress, cancel and unreadable folders listed                                                               |
| 3   | Analyzer workspace | **In progress** — [plan](superpowers/plans/2026-11-19-phase-3-workspace.md) | Ribbon, Select menu, virtualized column tree, treemap pane (Level 0–5, hideable), Explorer context menu, status bar; 1M-file perf limits in CI           |
| 4   | Side views         | Not started                                                                 | Top files, file types, file age                                                                                                                          |
| 5   | Charts and export  | Not started                                                                 | Pie and bar charts; CSV and Excel export                                                                                                                 |
| 6   | Actions            | Not started                                                                 | Delete to Recycle Bin with confirmation, search — **MVP complete; first GitHub release**                                                                 |
| 7+  | Post-MVP           | Not started                                                                 | Honest totals (cloud-only files, hardlinks, real size of locked system files, reconciliation), duplicates, scan history, plain-language explanations, AI |
```

and insert before `### Release checklist`:

```markdown
### Phase 3 — Analyzer Workspace (task checklist)

- [x] T1 Design system: `design/tokens.json` → `tokens.css` → Tailwind, `components.md`, contrast report (0 AA failures), Lucide icons
- [x] T2 Columnar tree store in the scanner (folders and files, allocated size from the cluster size), 1M-file perf test
- [x] T3 Scanner queries: children pages and sort, node details, expand levels, squarified treemap, folder refresh
- [x] T4 Main and preload: `drive:info`, `places:list`, tree and treemap channels, open in Explorer, clipboard, new folder, `app:quit`
- [x] T5 Workspace store, Ribbon and Select menu
- [x] T6 Virtualized column tree (treegrid)
- [x] T7 Native Explorer context menu (koffi COM) with StorageIQ's items
- [x] T8 Treemap pane (Level 0–5, hide/show), splitter, status bar, workspace shell
- [x] T9 2a screens removed, workspace E2E, CI perf report, docs

### Phase 3 — Outcome

To be filled in by the final task's controller run: test counts, metrics, deviations.

Decisions recorded with the plan:

- `lucide-react` 1.69.0 is the renderer's icon set (dev dependency, bundled by Vite).
- The right-click menu is the real Windows Explorer menu, built from main with koffi (`SHParseDisplayName`, `SHBindToParent`, `IShellFolder::GetUIObjectOf`, `IContextMenu`/`2`/`3`, `TrackPopupMenuEx`, `InvokeCommand`). Explorer's own commands, including Delete, therefore work from StorageIQ; StorageIQ's own code still never deletes (Phase 6).
- Tree and treemap requests name rows by scanner ids (`d…`, `g…`, `f…`); main resolves every path that reaches the shell or the clipboard from the scanner's tree, never from the renderer.
```

Fill the Outcome with the counts and metrics of Steps 4–6. `PRODUCT.md`: replace the `## Capabilities and Constraints` section with:

```markdown
## Capabilities and Constraints

- Roadmap v3 (2026-11-19): Phase 3 analyzer workspace (ribbon, Select menu, column tree, treemap, status bar); Phase 4 side views (top files, file types, file age); Phase 5 charts and export; Phase 6 actions (delete to Recycle Bin with confirmation, search) — MVP complete and first release; Phase 7+ honest totals, duplicates, history, explanations, AI.
- Read-only by default: StorageIQ's own commands never delete or move files until Phase 6. Since Phase 3 a right-click shows the Windows Explorer context menu for the item, so Explorer's own commands (Open, Send to, Delete to the Recycle Bin, Properties, …) are available exactly as in Explorer; StorageIQ adds only "New folder" and refreshes the folder after a command that may change it.
- Windows 10 1809+ and Windows 11, x64 only.
- License: MIT.
- Undecided: how AI insights will run (locally or through a cloud service).
```

- [ ] **Step 10: Final gates**

```powershell
npm run format
npm run format:check
node scripts/build-tokens.mjs --check
npm run lint
npm run typecheck
npx vitest run
npm run test:perf
```

Expected: all green.

- [ ] **Step 11: Commit**

```powershell
git rm e2e/scan.spec.ts
git add e2e/support/launch.ts e2e/support/fixture.ts e2e/support/workspace.ts e2e/app.spec.ts e2e/workspace.spec.ts e2e/metrics.spec.ts e2e/screenshots.spec.ts eslint.config.mjs .github/workflows/ci.yml scripts/report-metrics.mjs scripts/check-packaged-app.mjs .gitignore .prettierignore README.md docs/ROADMAP.md PRODUCT.md
git commit -m @'
test(e2e): workspace end to end; CI perf gate and metrics; docs for roadmap v3

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

## Self-review

### Spec coverage

| Spec item                                                                                                                                                                                    | Task(s)                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| §1 trade-dress boundary: own name, Lucide icons, palette, copy; no reference assets                                                                                                          | 1 (tokens, icons), all UI tasks (fresh copy); Global Constraints                                                |
| §2 roadmap v3                                                                                                                                                                                | 9 (ROADMAP, README, PRODUCT)                                                                                    |
| §3.1 ribbon: File (Exit, About), Home (Scan: Select, Stop, Refresh; Mode; Unit; Folder: Expand levels 1–5/all, Open in Explorer), Scan and View tabs                                         | 5 (Ribbon), 8 (About dialog)                                                                                    |
| §3.2 Select menu: drives with label and letter; Documents + OneDrive from env; last 5 recent paths in userData JSON, "(none)"; Choose a folder…                                              | 4 (places, recent), 5 (SelectMenu)                                                                              |
| §3.3 columns, sort and reverse, default Mode value desc; Name cell value + bar; % cell bar + number; bold ≥ 10 %; root + folders + "[N files]"; virtualized, live during scan; ↑ ↓ → ← Enter | 3 (sort), 5 (model, store), 6 (TreeGrid)                                                                        |
| §3.3 context menu (owner's override: native Explorer menu + StorageIQ items, Shift+F10/Menu key, refresh after changes, New folder)                                                          | 4 (handlers, ids, naming, refresh), 6 (right-click and keys), 7 (COM menu), 9 (probe E2E, manual check)         |
| §3.4 treemap below the tree, splitter, squarified by Mode, labels, free space at drive root, click selects, double-click drills, Level 0–5, canvas with text alternative, hide/show (owner)  | 3 (layout), 8 (pane, splitter, level bar), 5 (View toggle)                                                      |
| §3.5 status bar: free of total, files found live, excluded (clickable list), bytes per cluster + FS                                                                                          | 4 (drive:info), 8 (StatusBar)                                                                                   |
| §3.6 empty state                                                                                                                                                                             | 6 (`EMPTY_TREE_TEXT`)                                                                                           |
| §3 light/dark, keyboard, WCAG 2.2 AA                                                                                                                                                         | 1 (tokens + contrast report), 5–8 (keyboard, ARIA)                                                              |
| §4 columnar storage, budget ≤ ~250 MB for 2M                                                                                                                                                 | 2 (store), 3 (perf asserts ≤ 125 B/file)                                                                        |
| §4 allocated size from cluster (koffi `GetDiskFreeSpaceW`) + FS name (`GetVolumeInformationW`), passed at scan start; documented approximation                                               | 2 (`allocatedSize` doc), 4 (`volumeFor`, koffi)                                                                 |
| §4 new IPC with `parseArgs`                                                                                                                                                                  | 4                                                                                                               |
| §4 renderer: workspace-store, Ribbon, SelectMenu, TreeGrid, TreemapCanvas, LevelBar, StatusBar; 2a screens removed; crash screen → banner                                                    | 5, 6, 8                                                                                                         |
| §4 design system: tokens.json, tokens.css, Tailwind mapping, components.md, 0 AA failures                                                                                                    | 1                                                                                                               |
| §5 unit tests: store, allocated, paging/sort, squarify (area, overlap, stable), parseArgs, places, workspace store, components                                                               | 2, 3, 4, 5, 6, 7, 8                                                                                             |
| §5 E2E: exact columns, sort, expand + keyboard, treemap click selects row, copy path, drive menu lists system drive, cluster size in status bar                                              | 9 (`workspace.spec.ts`; copy path via Ctrl+C plus the menu probe)                                               |
| §5 performance (1M files: worker memory ≤ 300 MB, first page ≤ 100 ms, treemap ≤ 100 ms; CI, reported, hard limit)                                                                           | 3 (`test:perf`), 9 (CI step + metrics report)                                                                   |
| §5 impeccable no warnings; screenshots light/dark by eye                                                                                                                                     | 8 (detect), 9 (screenshots)                                                                                     |
| AC1 every §3 element by mouse and keyboard                                                                                                                                                   | 5, 6, 8; 9 manual check for the native menu                                                                     |
| AC2 exact columns for the fixture                                                                                                                                                            | 9                                                                                                               |
| AC3 tree and status bar update during the scan; Stop < 500 ms                                                                                                                                | 6 (revision reloads), 8, 9 (live E2E; metrics cancel latency, 218 ms in the dry run; E2E gate 2 s for CI noise) |
| AC4 treemap and tree in sync both ways                                                                                                                                                       | 5 (`select`, `reveal`, `drillInto`), 8, 9                                                                       |
| AC5 perf limits                                                                                                                                                                              | 3, 9                                                                                                            |
| AC6 no reference asset or copy; Lucide icons                                                                                                                                                 | 1, Global Constraints                                                                                           |
| AC7 all gates green incl. packaged self-test and CI                                                                                                                                          | 8, 9                                                                                                            |

### Placeholder scan

Every code step contains the complete file; every test has real assertions. Generated files (`design/tokens.css`, `design/contrast-report.txt`, `package-lock.json`) are produced by the commands shown. The only machine-specific values are the two skill paths in Task 1 Step 10 and Task 8 Step 7, which the controller fills in.

### Type-name consistency

The names in "Shared type names" are the only spellings used in the code blocks (checked with a search of the dry-run tree: `TreeRow`, `TreePage`, `TreeNodeDetails`, `TreemapLayout`, `ScannerQuery`, `ScanVolume`, `WorkspaceState`, `ChildLists`, `VisibleModel`, `ShellMenuChoice`, `BuiltShellMenu`, `ContextMenuOutcome`).

### Not verified automatically

- The native menu's owner-drawn and lazily filled submenus (Send to, Open with, Give access to) through `HandleMenuMsg2`: the forwarding code ran without error while the menu was shown, but only a person can confirm the submenus fill in (Task 9 Step 8).
- CI on GitHub (windows-latest) has not run this plan; all gates were run locally.

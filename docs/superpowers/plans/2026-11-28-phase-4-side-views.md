# Phase 4 — Side Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The bottom pane gets four tabs, **Treemap | Top files | Types | Age**. The three new views describe the current treemap folder: the 1,000 largest files, bytes per file extension, and bytes per modification-age bucket. Each list has **Copy as CSV**, and the View ribbon tab gets a "Pane" group with one toggle per tab.

**Architecture:** The work follows the existing treemap path end to end: renderer, preload, main IPC handler with a typed `parseArgs`, scanner query, reply. Three pure functions in `src/worker/scanner/side-views.ts` (heap for the top files, a `Map` per extension, 8 fixed age buckets) walk the files of the folder once, and a small `SideViews` class keeps the last results until `store.version` changes, as the treemap does. The renderer fetches each view through the Zustand workspace store (`paneTab`, `fetchTopFiles`, `fetchTypes`, `fetchAges`), a `useSideView` hook refetches on folder, Mode and tree-revision changes, and CSV text is built in the renderer and written to the clipboard by main through a new `clipboard:copy-text` channel (the renderer's own clipboard permission is denied).

**Tech Stack:** Electron 45, React 19, TypeScript 6 (strict), Tailwind 4, Zustand 5, Vitest 5 + Testing Library + jsdom, Playwright. **No new dependency.**

**Spec:** [Phase 4 — Side Views design](../specs/2026-11-28-phase-4-side-views-design.md). It governs; "Self-review" at the end maps every section to a task.

**Model routing (for the controller):** every task starts with an `**Implementer tier:**` line. `Haiku` means the plan contains all code and tests, so a fast model can transcribe and run it. `Sonnet` means the task integrates with several existing files, the UI or Electron, and needs judgment if a test needs a small adjustment (review on the strong model).

**Dry run:** every task below was applied in the working tree on 2026-11-28 and all gates passed with every task applied: `typecheck`, `lint`, 1,312 unit tests (the one failure of a full run is the timing-sensitive `win-shell-menu.native.test.ts`, which passes alone), the perf test (1M files: top 1,000 files of the root 30 ms, types 110 ms, limit 300 ms), and 48 E2E tests (3 opt-in tests skipped). The code blocks are the dry-run files after `npm run format`; diffs are against the commit that holds the spec.

## Global Constraints

Carried forward from Phases 1 to 3 (binding):

- Installed versions stay as recorded. Do not upgrade anything and **add no dependency**. Never use `--force` or `--legacy-peer-deps`.
- Target Windows 10 1809+ / Windows 11, x64 only. The app stays **read-only**: delete, search and charts belong to later phases.
- Renderer security baseline unchanged: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict CSP, every IPC call checks its sender (`registerIpcHandlers` does it for every channel, including `clipboard:copy-text`), all permission requests denied.
- Every IPC channel has a typed `parseArgs`; invalid arguments reject with `InvalidIpcArgumentsError` and the handler never runs. The renderer sends only `(scanId, nodeId[, mode])` for the side views and one string of at most 4 MiB for `clipboard:copy-text`. Rows carry a `NodeId`, so `icons:for-nodes` and `shell:context-menu` work unchanged.
- TypeScript `strict` plus `noUncheckedIndexedAccess`. No `any`, no `@ts-ignore`. Path aliases `@shared/*`, `@renderer/*`.
- Prettier style: no semicolons, single quotes, print width 100, trailing commas. Format with `npx prettier --write src e2e` (not `npm run format`: it would also rewrite the unformatted spec file before Task 9 does it on purpose).
- Copy is plain language and uses typographic punctuation (`’`, `…`, `–`). The exact UI strings are the ones in this plan's code.
- Spec values used verbatim: `TOP_FILES_LIMIT` = 1,000 files; at most 500 extensions, the rest in one "Other extensions" row; files without an extension are "(no extension)"; extensions are lower-cased; the 8 age buckets (Last 30 days: age < 30 d; 1–3 months: 30 d ≤ age < 91 d; 3–6 months: 91 d ≤ age < 182 d; 6–12 months: 182 d ≤ age < 365 d; 1–2 years: 365 d ≤ age < 730 d; 2–5 years: 730 d ≤ age < 1826 d; Over 5 years: age ≥ 1826 d; Unknown date: modified = 0 or > now + 1 d), always all 8 in this order; speed target under 300 ms for the root of a 2M-file tree; `clipboard:copy-text` accepts only a string of at most 4 MiB; CSV is RFC 4180 with a header row, raw byte counts and ISO 8601 UTC dates; feedback "Copied N rows"; "Too many rows to copy".
- **Environment quirks (Windows):**
  - Run Vitest through PowerShell, not Git Bash (Git Bash breaks it): `powershell.exe -NoProfile -Command "npx vitest run <path>"`. The same applies to the other `npx`/`npm` commands below.
  - Before launching Electron (dev or E2E): `Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue`. E2E needs an interactive desktop session and builds first (`npx electron-vite build`).
  - Gates, run at the end of every task that touches code: `npm run typecheck`, `npm run lint`, `npm run format:check`. Until Task 9 `format:check` also reports the spec file (`docs/superpowers/specs/2026-11-28-phase-4-side-views-design.md`, committed unformatted); ignore that one path until Task 9 formats it.
  - `src/main/shell-menu/win-shell-menu.native.test.ts` is timing-sensitive and can fail in a full parallel run; if it is the only failure, run it alone.
- Commits: one per task (Task 9 has two), conventional-commit message, **no AI attribution trailer** (no `Co-Authored-By`, no "Generated with" line). Stage **explicit paths only** (`git add <path> …`); never `git add -A`, `git add .` or `git commit -a`.

## Decisions made while planning (spec ambiguities)

1. "`paneTab` persisted with the other view settings": no view setting is persisted today (`mode`, `treemapDepth`, `treemapVisible` live in memory). `paneTab` is in memory too; nothing new is persisted.
2. The spec lists Enter together with the context-menu keys. Enter does what it does in the tree: it shows the file in Explorer (`shell:open-in-explorer`). The Menu key, Shift+F10 and right-click open the Explorer menu (`shell:context-menu`). Ctrl+C copies the paths. The Delete key is **not** wired in Top files (the store's delete acts on the tree's selection, not on this list).
3. "Rows use the existing selection model": Top files keeps its own selection in component state, built from the same `lib/selection.ts` helpers, so a selected row that is hidden in the tree never disturbs the tree's selection or the treemap folder.
4. The spec's "existing 'Scanning…' note" does not exist in the UI; a one-line `ScanningNote` ("Scanning… These are the results so far.") is added to each view.
5. A "[N files]" row (`g<n>`) stands for its folder: the side views describe the whole folder subtree, as for a file (`folderOf`).
6. "At most 500 extensions" counts every group, "(no extension)" included; the "Other extensions" row is the 501st row.
7. The Age view uses the wall clock (`ScannerHostDeps.wallClock`, default `Date.now`); the host's `now()` is `performance.now()` and cannot date files.
8. The ribbon's old "Treemap" group becomes the "Pane" group; its Treemap button keeps its name, so the existing hide/show tests and E2E still apply. `treemapVisible` keeps its name and now means "the bottom pane is shown".
9. The hide button is named "Hide treemap" on the Treemap tab (existing tests) and "Hide pane" on the other tabs. The region keeps the name "Treemap" on the Treemap tab and is named after the view on the others.
10. CSV values are copied as they are, so a file name that starts with `=`, `+`, `-` or `@` is not neutralized for spreadsheets (the spec asks for raw values). Known limitation, noted in `csv.ts`.
11. Known limitation: `icon-cache.request` keeps only the newest unsent set of ids, so if the tree and Top files ask for icons in the same 40 ms window one list may keep placeholder icons until it re-renders. Cosmetic; not changed here.

## File Map

| File                                                                                                                                            | Responsibility                                                             | Task |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---- |
| `src/shared/tree-types.ts`                                                                                                                      | `TopFileRow`, `TypeRow`, `AgeRow`, `AGE_BUCKETS`, limits                   | 1    |
| `src/worker/scanner/side-views.ts` (+ test)                                                                                                     | `topFiles`, `typeBreakdown`, `ageBreakdown`, `rankByOf`, `SideViews` cache | 1    |
| `src/shared/scanner-protocol.ts`, `src/worker/scanner/scanner-host.ts` (+ test), `tree-store.perf.test.ts`                                      | `top-files`, `types`, `age` queries; perf cases                            | 2    |
| `src/shared/ipc-contract.ts`, `src/main/ipc/parse-args.ts`, `tree-handlers.ts`, `shell-handlers.ts` (+ tests), `src/preload/index.ts` (+ test)  | `side:*` and `clipboard:copy-text` channels, bridge methods                | 3    |
| `src/renderer/src/test/fake-api.ts`, `e2e/app.spec.ts`                                                                                          | Fake bridge data and the exposed-API list                                  | 3    |
| `src/renderer/src/stores/workspace-store.ts` (+ new test)                                                                                       | `paneTab`, fetchers, `copyCsv`                                             | 4    |
| `components/PaneShell.tsx`, `SideViewTabs.tsx`, `SideViewParts.tsx`, `PaneView.tsx`, `lib/use-pane-folder.ts`, `lib/use-side-view.ts` (+ tests) | The pane frame, tabs, shared parts and the fetching hook                   | 5    |
| `TreemapPane.tsx`, `Ribbon.tsx`, `App.tsx`, `FileIcon.tsx`, `lib/icons.ts`                                                                      | Treemap uses the frame; "Pane" ribbon group; icons                         | 5    |
| `lib/csv.ts`, `lib/side-view-model.ts`, `components/CopyCsvButton.tsx` (+ tests)                                                                | CSV text, labels and icon keys, Copy as CSV button                         | 6    |
| `components/TopFilesView.tsx` (+ test), `PaneView.tsx`                                                                                          | Top files view                                                             | 7    |
| `components/TypesView.tsx`, `AgeView.tsx`, `TreemapLegend.tsx`, `PaneView.tsx`, `App.test.tsx` (+ tests)                                        | Types and Age views, colour chip                                           | 8    |
| `e2e/side-views.spec.ts`, `docs/ROADMAP.md`, `CHANGELOG.md`, the spec file                                                                      | End-to-end test, Phase 4 checklist, changelog, formatting                  | 9    |

(Paths in the second half of the table are under `src/renderer/src/`.)

---

### Task 1: Shared types and the scanner's side-view functions

**Implementer tier:** Haiku (all code and tests are in the plan).

**Files:**

- Modify: `src/shared/tree-types.ts` (append at the end)
- Create: `src/worker/scanner/side-views.ts`
- Test: `src/worker/scanner/side-views.test.ts`

**Interfaces:**

- Consumes: `TreeStore` (`fileLength`, `isLiveFile(file)`, `filesIn(folder)`, `childFolders(folder)`, `fileName`, `fileSize`, `fileAllocated`, `fileModified`, `fileParent`, `fileCategoryOf`, `folderPath`, `version`), `resolveNode(store, id): NodeRef | null` and `folderOf(store, ref): number` from `tree-queries.ts`, `fileExtension(name)` from `@shared/file-category`.
- Produces (`tree-types.ts`):
  - `TOP_FILES_LIMIT = 1000`, `TYPE_ROWS_LIMIT = 500`
  - `interface TopFileRow { id: NodeId; name: string; folder: string; size: number; allocated: number; modifiedMs: number }`
  - `type TypeRowKind = 'extension' | 'none' | 'other'`; `interface TypeRow { kind: TypeRowKind; ext: string; category: FileCategory | null; size: number; allocated: number; files: number }`
  - `type AgeBucketId = 'last-30-days' | 'months-1-3' | 'months-3-6' | 'months-6-12' | 'years-1-2' | 'years-2-5' | 'over-5-years' | 'unknown'`; `AGE_BUCKETS: ReadonlyArray<{ id: AgeBucketId; label: string }>` (8 entries, display order); `interface AgeRow { id: AgeBucketId; label: string; size: number; allocated: number; files: number }`
- Produces (`side-views.ts`):
  - `rankByOf(mode: SizeMode): 'size' | 'allocated'`
  - `topFiles(store: TreeStore, folder: number, rankBy: 'size' | 'allocated', limit: number): TopFileRow[]`
  - `typeBreakdown(store: TreeStore, folder: number, limit: number): TypeRow[]`
  - `ageBreakdown(store: TreeStore, folder: number, nowMs: number): AgeRow[]`
  - `class SideViews { constructor(store: TreeStore, nowMs?: () => number); topFiles(nodeId: NodeId, mode: SizeMode): TopFileRow[] | null; types(nodeId: NodeId): TypeRow[] | null; age(nodeId: NodeId): AgeRow[] | null }`

- [ ] **Step 1: Add the shared types**

Append to `src/shared/tree-types.ts`:

```diff
--- a/src/shared/tree-types.ts
+++ b/src/shared/tree-types.ts
@@ -186,3 +186,69 @@ export function modeSortKey(mode: SizeMode): SortKey {
 export function folderIndexOf(id: NodeId): number | null {
   return id.startsWith('d') || id.startsWith('g') ? Number(id.slice(1)) : null
 }
+
+/** Most rows the Top files view lists. */
+export const TOP_FILES_LIMIT = 1000
+/** Most extensions the Types view lists before it sums the rest into "Other extensions". */
+export const TYPE_ROWS_LIMIT = 500
+
+/** One row of the Top files view. */
+export interface TopFileRow {
+  /** `f<n>`: works with `icons:for-nodes` and `shell:context-menu`. */
+  id: NodeId
+  name: string
+  /** Path of the folder that holds the file. */
+  folder: string
+  /** Logical size in bytes. */
+  size: number
+  /** Size rounded up to whole clusters. */
+  allocated: number
+  /** Modification time in ms since the epoch, to the second (0 when unknown). */
+  modifiedMs: number
+}
+
+/** `extension`: files with that extension; `none`: files without one; `other`: the rest. */
+export type TypeRowKind = 'extension' | 'none' | 'other'
+
+/** One row of the Types view: the files of one extension below a folder. */
+export interface TypeRow {
+  kind: TypeRowKind
+  /** Lower case, no dot; `''` for `none` and `other`. */
+  ext: string
+  /** The file type colour; `null` for the "Other extensions" row. */
+  category: FileCategory | null
+  size: number
+  allocated: number
+  files: number
+}
+
+export type AgeBucketId =
+  | 'last-30-days'
+  | 'months-1-3'
+  | 'months-3-6'
+  | 'months-6-12'
+  | 'years-1-2'
+  | 'years-2-5'
+  | 'over-5-years'
+  | 'unknown'
+
+/** The age buckets in display order; the scanner always returns one row per entry. */
+export const AGE_BUCKETS: ReadonlyArray<{ id: AgeBucketId; label: string }> = [
+  { id: 'last-30-days', label: 'Last 30 days' },
+  { id: 'months-1-3', label: '1–3 months' },
+  { id: 'months-3-6', label: '3–6 months' },
+  { id: 'months-6-12', label: '6–12 months' },
+  { id: 'years-1-2', label: '1–2 years' },
+  { id: 'years-2-5', label: '2–5 years' },
+  { id: 'over-5-years', label: 'Over 5 years' },
+  { id: 'unknown', label: 'Unknown date' },
+]
+
+/** One row of the Age view: the files of one modification-age bucket below a folder. */
+export interface AgeRow {
+  id: AgeBucketId
+  label: string
+  size: number
+  allocated: number
+  files: number
+}
```

- [ ] **Step 2: Write the failing test**

Create `src/worker/scanner/side-views.test.ts`:

```ts
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AGE_BUCKETS } from '@shared/tree-types'
import { ageBreakdown, rankByOf, SideViews, topFiles, typeBreakdown } from './side-views'
import { TreeStore } from './tree-store'

const ROOT = 'C:\\Data'
const DAY = 86_400_000
/** A whole number of seconds, because the store keeps modification times in seconds. */
const NOW = Date.UTC(2026, 10, 28, 12)

/**
 * Data
 *   A
 *     big.MP4 3000 (f0)
 *     B: mid.jpg 1500 (f1), tie.jpg 1500 (f2)
 *   C: tiny.txt 10 (f3)
 *   root.bin 2000 (f4)
 */
function sample() {
  const store = new TreeStore(ROOT, 1024)
  const a = store.folder(0, 'A', 0)
  const b = store.folder(a, 'B', 0)
  const c = store.folder(0, 'C', 0)
  store.file(a, 3000, 'big.MP4', NOW)
  store.file(b, 1500, 'mid.jpg', NOW)
  store.file(b, 1500, 'tie.jpg', NOW)
  store.file(c, 10, 'tiny.txt', NOW)
  store.file(0, 2000, 'root.bin', NOW)
  return { store, a, b, c }
}

const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id)

describe('topFiles', () => {
  it('lists the biggest files first and keeps the earlier file on a tie', () => {
    const { store } = sample()
    expect(ids(topFiles(store, 0, 'size', 10))).toEqual(['f0', 'f4', 'f1', 'f2', 'f3'])
    expect(ids(topFiles(store, 0, 'size', 2))).toEqual(['f0', 'f4'])
    expect(topFiles(store, 0, 'size', 0)).toEqual([])
  })

  it('ranks by allocated size (whole clusters) when asked', () => {
    const { store } = sample()
    // Allocated: f0 3072, f1 2048, f2 2048, f4 2048, f3 1024.
    expect(ids(topFiles(store, 0, 'allocated', 10))).toEqual(['f0', 'f1', 'f2', 'f4', 'f3'])
  })

  it('describes each row and covers only the subtree of the folder', () => {
    const { store, a } = sample()
    const rows = topFiles(store, a, 'size', 10)
    expect(ids(rows)).toEqual(['f0', 'f1', 'f2'])
    expect(rows[0]).toEqual({
      id: 'f0',
      name: 'big.MP4',
      folder: path.join(ROOT, 'A'),
      size: 3000,
      allocated: 3072,
      modifiedMs: NOW,
    })
    expect(rows[1]?.folder).toBe(path.join(ROOT, 'A', 'B'))
  })

  it('matches a full sort for many files, with and without the root shortcut', () => {
    const store = new TreeStore(ROOT, 4096)
    const sub = store.folder(0, 'Sub', 0)
    const sizes: number[] = []
    for (let i = 0; i < 300; i += 1) {
      const size = (i * 7919) % 211 // many ties
      sizes.push(size)
      store.file(i % 2 === 0 ? sub : 0, size, `f${i}.dat`, NOW)
    }
    const expected = sizes
      .map((size, index) => ({ size, index }))
      .sort((x, y) => y.size - x.size || x.index - y.index)
      .slice(0, 25)
      .map((entry) => `f${entry.index}`)
    expect(ids(topFiles(store, 0, 'size', 25))).toEqual(expected)
  })

  it('leaves out files of a folder that was reset', () => {
    const { store, a } = sample()
    store.resetFolder(a)
    expect(ids(topFiles(store, 0, 'size', 10))).toEqual(['f4', 'f3'])
  })
})

describe('typeBreakdown', () => {
  function extensions() {
    const store = new TreeStore(ROOT, 1024)
    store.file(0, 100, 'a.JPG', NOW)
    store.file(0, 50, 'b.jpg', NOW)
    store.file(0, 10, '.gitignore', NOW)
    store.file(0, 5, 'README', NOW)
    store.file(0, 1, 'dot.', NOW)
    store.file(0, 200, 'x.tar.gz', NOW)
    store.file(0, 7, 'c.xyz1', NOW)
    return store
  }

  it('groups by lower-case extension, biggest first, with files without one together', () => {
    expect(typeBreakdown(extensions(), 0, 500)).toEqual([
      { kind: 'extension', ext: 'gz', category: 'archive', size: 200, allocated: 1024, files: 1 },
      { kind: 'extension', ext: 'jpg', category: 'image', size: 150, allocated: 2048, files: 2 },
      { kind: 'none', ext: '', category: 'other', size: 16, allocated: 3072, files: 3 },
      { kind: 'extension', ext: 'xyz1', category: 'other', size: 7, allocated: 1024, files: 1 },
    ])
  })

  it('sums the groups beyond the limit into one "other" row', () => {
    expect(typeBreakdown(extensions(), 0, 2)).toEqual([
      { kind: 'extension', ext: 'gz', category: 'archive', size: 200, allocated: 1024, files: 1 },
      { kind: 'extension', ext: 'jpg', category: 'image', size: 150, allocated: 2048, files: 2 },
      { kind: 'other', ext: '', category: null, size: 23, allocated: 4096, files: 4 },
    ])
  })

  it('covers only the subtree of the folder', () => {
    const { store, c } = sample()
    expect(typeBreakdown(store, c, 500).map((row) => row.ext)).toEqual(['txt'])
  })
})

describe('ageBreakdown', () => {
  it('puts files in the right bucket at every edge and keeps all 8 buckets in order', () => {
    const store = new TreeStore(ROOT, 1024)
    const at = (ageMs: number) => store.file(0, 100, `f${store.fileLength}.dat`, NOW - ageMs)
    at(30 * DAY - 1000) // just under 30 days
    at(30 * DAY)
    at(91 * DAY)
    at(182 * DAY)
    at(365 * DAY)
    at(730 * DAY)
    at(1826 * DAY)
    at(-12 * 3_600_000) // modified 12 hours in the future: still "Last 30 days"
    store.file(0, 100, 'zero.dat', 0)
    store.file(0, 100, 'future.dat', NOW + 2 * DAY)
    const rows = ageBreakdown(store, 0, NOW)
    expect(rows.map((row) => row.id)).toEqual(AGE_BUCKETS.map((bucket) => bucket.id))
    expect(rows.map((row) => row.label)).toContain('Unknown date')
    expect(rows.map((row) => row.files)).toEqual([2, 1, 1, 1, 1, 1, 1, 2])
    expect(rows[0]).toMatchObject({ size: 200, allocated: 2048 })
  })

  it('lists empty buckets too', () => {
    const rows = ageBreakdown(new TreeStore(ROOT, 1024), 0, NOW)
    expect(rows).toHaveLength(8)
    expect(rows.every((row) => row.files === 0 && row.size === 0)).toBe(true)
  })
})

describe('SideViews', () => {
  it('maps the Mode to the ranking: allocated for Allocated, size for the others', () => {
    expect(rankByOf('allocated')).toBe('allocated')
    expect(['size', 'files', 'percent'].map((mode) => rankByOf(mode as 'size'))).toEqual([
      'size',
      'size',
      'size',
    ])
  })

  it('answers for a folder, a "[N files]" row and a file as for their folder', () => {
    const { store, a } = sample()
    const views = new SideViews(store, () => NOW)
    expect(ids(views.topFiles(`d${a}`, 'size') ?? [])).toEqual(['f0', 'f1', 'f2'])
    expect(ids(views.topFiles(`g${a}`, 'size') ?? [])).toEqual(['f0', 'f1', 'f2'])
    expect(ids(views.topFiles('f0', 'size') ?? [])).toEqual(['f0', 'f1', 'f2'])
    expect(views.types('d0')?.map((row) => row.ext)).toEqual(['jpg', 'mp4', 'bin', 'txt'])
    expect(views.age('d0')?.[0]?.files).toBe(5)
  })

  it('answers null for a node that does not exist', () => {
    const { store } = sample()
    const views = new SideViews(store, () => NOW)
    expect(views.topFiles('d99', 'size')).toBeNull()
    expect(views.types('f99')).toBeNull()
    expect(views.age('../x')).toBeNull()
  })

  it('keeps a result until the tree changes, per folder and ranking', () => {
    const { store, a } = sample()
    const views = new SideViews(store, () => NOW)
    const first = views.topFiles('d0', 'size')
    expect(views.topFiles('d0', 'files')).toBe(first) // the same ranking
    expect(views.topFiles('d0', 'allocated')).not.toBe(first)
    expect(views.topFiles(`d${a}`, 'size')).not.toBe(first)
    expect(views.topFiles('d0', 'size')).toBe(first)
    store.file(0, 9999, 'new.bin', NOW)
    const second = views.topFiles('d0', 'size')
    expect(second).not.toBe(first)
    expect(second?.[0]?.name).toBe('new.bin')
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/worker/scanner/side-views.test.ts"`
Expected: FAIL (`Failed to resolve import "./side-views"`).

- [ ] **Step 4: Write the implementation**

Create `src/worker/scanner/side-views.ts`:

```ts
import { fileExtension } from '@shared/file-category'
import {
  AGE_BUCKETS,
  FILE_CATEGORIES,
  TOP_FILES_LIMIT,
  TYPE_ROWS_LIMIT,
  type AgeRow,
  type NodeId,
  type SizeMode,
  type TopFileRow,
  type TypeRow,
} from '@shared/tree-types'
import { folderOf, resolveNode } from './tree-queries'
import type { TreeStore } from './tree-store'

const DAY_MS = 86_400_000
/** Upper edges of the first six age buckets, in days (the last two buckets have no edge). */
const AGE_EDGES_DAYS = [30, 91, 182, 365, 730, 1826] as const
/** Results kept between calls; a change to the tree empties them. */
const CACHE_SIZE = 24

/** Top files rank by allocated size in Allocated mode and by logical size in every other mode. */
export function rankByOf(mode: SizeMode): 'size' | 'allocated' {
  return mode === 'allocated' ? 'allocated' : 'size'
}

/** Calls `visit` for every file below `folder`. The root loops over all files instead of walking. */
function forEachFile(store: TreeStore, folder: number, visit: (file: number) => void): void {
  if (folder === 0) {
    for (let file = 0; file < store.fileLength; file += 1) {
      if (store.isLiveFile(file)) visit(file)
    }
    return
  }
  const pending = [folder]
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    for (const file of store.filesIn(next)) visit(file)
    for (const child of store.childFolders(next)) pending.push(child)
  }
}

/**
 * The `limit` biggest files below `folder`, biggest first; equal sizes keep the file that was
 * scanned first. A min-heap of `limit` files holds the best so far, so memory stays small.
 */
export function topFiles(
  store: TreeStore,
  folder: number,
  rankBy: 'size' | 'allocated',
  limit: number,
): TopFileRow[] {
  if (limit <= 0) return []
  const value = (file: number) =>
    rankBy === 'allocated' ? store.fileAllocated(file) : store.fileSize(file)
  /** True when `a` ranks below `b`. */
  const worse = (a: number, b: number) => {
    const diff = value(a) - value(b)
    return diff !== 0 ? diff < 0 : a > b
  }
  const heap: number[] = []
  const swap = (i: number, j: number) => {
    const held = heap[i] as number
    heap[i] = heap[j] as number
    heap[j] = held
  }
  const siftUp = (from: number) => {
    for (let i = from; i > 0;) {
      const parent = (i - 1) >> 1
      if (!worse(heap[i] as number, heap[parent] as number)) return
      swap(i, parent)
      i = parent
    }
  }
  const siftDown = (from: number) => {
    for (let i = from; ;) {
      let lowest = i
      const left = 2 * i + 1
      const right = left + 1
      if (left < heap.length && worse(heap[left] as number, heap[lowest] as number)) lowest = left
      if (right < heap.length && worse(heap[right] as number, heap[lowest] as number))
        lowest = right
      if (lowest === i) return
      swap(i, lowest)
      i = lowest
    }
  }
  forEachFile(store, folder, (file) => {
    if (heap.length < limit) {
      heap.push(file)
      siftUp(heap.length - 1)
    } else if (worse(heap[0] as number, file)) {
      heap[0] = file
      siftDown(0)
    }
  })
  heap.sort((a, b) => (worse(a, b) ? 1 : worse(b, a) ? -1 : 0))
  const folders = new Map<number, string>()
  return heap.map((file) => {
    const parent = store.fileParent(file)
    let path = folders.get(parent)
    if (path === undefined) {
      path = store.folderPath(parent)
      folders.set(parent, path)
    }
    return {
      id: `f${file}`,
      name: store.fileName(file),
      folder: path,
      size: store.fileSize(file),
      allocated: store.fileAllocated(file),
      modifiedMs: store.fileModified(file),
    }
  })
}

/**
 * Bytes per file extension below `folder`, biggest first (ties by extension). Files without an
 * extension are one `none` row. When there are more than `limit` groups, the rest are summed into
 * one `other` row after the first `limit`.
 */
export function typeBreakdown(store: TreeStore, folder: number, limit: number): TypeRow[] {
  const groups = new Map<string, TypeRow>()
  forEachFile(store, folder, (file) => {
    const ext = fileExtension(store.fileName(file))
    let group = groups.get(ext)
    if (group === undefined) {
      group = {
        kind: ext === '' ? 'none' : 'extension',
        ext,
        category: FILE_CATEGORIES[store.fileCategoryOf(file)] ?? 'other',
        size: 0,
        allocated: 0,
        files: 0,
      }
      groups.set(ext, group)
    }
    group.size += store.fileSize(file)
    group.allocated += store.fileAllocated(file)
    group.files += 1
  })
  const rows = [...groups.values()].sort((a, b) => b.size - a.size || a.ext.localeCompare(b.ext))
  if (rows.length <= limit) return rows
  const rest: TypeRow = { kind: 'other', ext: '', category: null, size: 0, allocated: 0, files: 0 }
  for (const row of rows.slice(limit)) {
    rest.size += row.size
    rest.allocated += row.allocated
    rest.files += row.files
  }
  return [...rows.slice(0, limit), rest]
}

/** Index into `AGE_BUCKETS` for a file modified at `modifiedMs`, seen at `nowMs`. */
function bucketOf(modifiedMs: number, nowMs: number): number {
  if (modifiedMs === 0 || modifiedMs > nowMs + DAY_MS) return AGE_BUCKETS.length - 1
  const ageMs = nowMs - modifiedMs
  const edge = AGE_EDGES_DAYS.findIndex((days) => ageMs < days * DAY_MS)
  return edge === -1 ? AGE_EDGES_DAYS.length : edge
}

/** Bytes per modification-age bucket below `folder`: always all 8 buckets, in display order. */
export function ageBreakdown(store: TreeStore, folder: number, nowMs: number): AgeRow[] {
  const rows: AgeRow[] = AGE_BUCKETS.map((bucket) => ({
    ...bucket,
    size: 0,
    allocated: 0,
    files: 0,
  }))
  forEachFile(store, folder, (file) => {
    const row = rows[bucketOf(store.fileModified(file), nowMs)]
    if (row === undefined) return
    row.size += store.fileSize(file)
    row.allocated += store.fileAllocated(file)
    row.files += 1
  })
  return rows
}

/**
 * The three side views of one tree, with their last results kept until the tree changes
 * (`store.version`), the way the treemap layout is kept. A node that is gone gives `null`; a
 * file or "[N files]" row stands for its folder.
 */
export class SideViews {
  private version = -1
  private readonly cache = new Map<string, unknown>()

  constructor(
    private readonly store: TreeStore,
    private readonly nowMs: () => number = Date.now,
  ) {}

  topFiles(nodeId: NodeId, mode: SizeMode): TopFileRow[] | null {
    const rankBy = rankByOf(mode)
    return this.answer(nodeId, `top:${rankBy}`, (folder) =>
      topFiles(this.store, folder, rankBy, TOP_FILES_LIMIT),
    )
  }

  types(nodeId: NodeId): TypeRow[] | null {
    return this.answer(nodeId, 'types', (folder) =>
      typeBreakdown(this.store, folder, TYPE_ROWS_LIMIT),
    )
  }

  age(nodeId: NodeId): AgeRow[] | null {
    return this.answer(nodeId, 'age', (folder) => ageBreakdown(this.store, folder, this.nowMs()))
  }

  private answer<T>(nodeId: NodeId, kind: string, compute: (folder: number) => T): T | null {
    const ref = resolveNode(this.store, nodeId)
    if (ref === null) return null
    const folder = folderOf(this.store, ref)
    if (this.version !== this.store.version) {
      this.cache.clear()
      this.version = this.store.version
    }
    const key = `${kind}:${folder}`
    if (this.cache.has(key)) return this.cache.get(key) as T
    const result = compute(folder)
    if (this.cache.size >= CACHE_SIZE) this.cache.delete(this.cache.keys().next().value as string)
    this.cache.set(key, result)
    return result
  }
}
```

- [ ] **Step 5: Run the test and the gates**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/worker/scanner/side-views.test.ts; npm run typecheck:node; npm run lint"`
Expected: 14 tests PASS, typecheck and lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/shared/tree-types.ts src/worker/scanner/side-views.ts src/worker/scanner/side-views.test.ts
git commit -m "feat(scanner): top files, file types and file age queries over the tree store"
```

---

### Task 2: Scanner protocol, host wiring and perf cases

**Implementer tier:** Haiku (all code and tests are in the plan).

**Files:**

- Modify: `src/shared/scanner-protocol.ts`, `src/worker/scanner/scanner-host.ts`
- Test: `src/worker/scanner/scanner-host.test.ts`, `src/worker/scanner/tree-store.perf.test.ts`

**Interfaces:**

- Consumes: `SideViews`, `rankByOf`, `topFiles`, `typeBreakdown`, `ageBreakdown` (Task 1); `SIZE_MODES`, `SizeMode` from `tree-types.ts`.
- Produces (`scanner-protocol.ts`):
  - `ScannerQuery` gains `{ kind: 'top-files'; scanId: string; nodeId: NodeId; mode: SizeMode }`, `{ kind: 'types'; scanId: string; nodeId: NodeId }` and `{ kind: 'age'; scanId: string; nodeId: NodeId }`.
  - `ScannerQueryResults` gains `'top-files': TopFileRow[] | null`, `types: TypeRow[] | null`, `age: AgeRow[] | null`.
- Produces (`scanner-host.ts`): `ScannerHostDeps.wallClock?(): number` (milliseconds since the epoch; default `Date.now`). A query for another scan id or a missing node answers `null`.
- Produces (perf): `PERF_LIMITS.maxSideViewMs = 300`.

- [ ] **Step 1: Write the failing tests**

Host test (a new `it`, plus four rejected requests in the `parseScannerRequest` table):

```diff
--- a/src/worker/scanner/scanner-host.test.ts
+++ b/src/worker/scanner/scanner-host.test.ts
@@ -315,6 +315,41 @@ describe('createScannerHost', () => {
     expect(layout).toMatchObject({ nodeId: 'd0', width: 100, height: 100 })
   })

+  it('answers the three side-view queries and null for a node that does not exist', async () => {
+    const t = setup({}, tree(), { wallClock: () => 1_000_000 })
+    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
+    await t.host.idle()
+
+    const top = (await t.query({
+      kind: 'top-files',
+      scanId: 's1',
+      nodeId: 'd0',
+      mode: 'size',
+    })) as Array<{ name: string }> | null
+    expect(top?.map((row) => row.name)).toEqual(['a.jpg', 'b.jpg', 'c.mp3', 'notes.txt'])
+    const types = (await t.query({ kind: 'types', scanId: 's1', nodeId: 'd0' })) as Array<{
+      ext: string
+      size: number
+    }> | null
+    expect(types?.map((row) => [row.ext, row.size])).toEqual([
+      ['jpg', 500],
+      ['mp3', 100],
+      ['txt', 5],
+    ])
+    const age = (await t.query({ kind: 'age', scanId: 's1', nodeId: 'd0' })) as Array<{
+      id: string
+      files: number
+    }> | null
+    expect(age).toHaveLength(8)
+    // The fake files were modified within the first second of 1970: that is not a usable date.
+    expect(age?.find((row) => row.id === 'unknown')?.files).toBe(4)
+    expect(await t.query({ kind: 'types', scanId: 's1', nodeId: 'd99' })).toBeNull()
+    expect(await t.query({ kind: 'age', scanId: 'old', nodeId: 'd0' })).toBeNull()
+    expect(
+      await t.query({ kind: 'top-files', scanId: 'old', nodeId: 'd0', mode: 'size' }),
+    ).toBeNull()
+  })
+
   it('answers queries for another scan id with nothing', async () => {
     const t = setup()
     t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
@@ -469,6 +504,14 @@ describe('parseScannerRequest', () => {
     { type: 'cancel' },
     { type: 'delete', scanId: 's1' },
     { type: 'query', requestId: 1, query: { kind: 'drop', scanId: 's1' } },
+    { type: 'query', requestId: 1, query: { kind: 'top-files', scanId: 's1', nodeId: 'd0' } },
+    {
+      type: 'query',
+      requestId: 1,
+      query: { kind: 'top-files', scanId: 's1', nodeId: 'd0', mode: 'huge' },
+    },
+    { type: 'query', requestId: 1, query: { kind: 'types', scanId: 's1', nodeId: 7 } },
+    { type: 'query', requestId: 1, query: { kind: 'age', scanId: 's1' } },
     { type: 'query', requestId: 'x', query: { kind: 'totals', scanId: 's1' } },
     {
       type: 'query',
```

Perf test (three new cases over the 1M-file tree, built once):

```diff
--- a/src/worker/scanner/tree-store.perf.test.ts
+++ b/src/worker/scanner/tree-store.perf.test.ts
@@ -1,5 +1,7 @@
 import { mkdirSync, writeFileSync } from 'node:fs'
 import { describe, expect, it } from 'vitest'
+import { TOP_FILES_LIMIT, TYPE_ROWS_LIMIT } from '@shared/tree-types'
+import { ageBreakdown, topFiles, typeBreakdown } from './side-views'
 import { ChildSorter, childrenPage } from './tree-queries'
 import { TreeStore } from './tree-store'
 import { treemapLayout } from './treemap'
@@ -13,6 +15,8 @@ export const PERF_LIMITS = {
   maxBytesPerFile: 125,
   maxFirstPageMs: 100,
   maxTreemapMs: 100,
+  /** Phase 4 spec §3.1: each side view of the root, one walk over every file. */
+  maxSideViewMs: 300,
 } as const

 function usedBytes(): number {
@@ -127,3 +131,57 @@ describe('tree store performance (1M files)', () => {
     expect(firstPageMs).toBeLessThanOrEqual(PERF_LIMITS.maxFirstPageMs)
   }, 60_000)
 })
+
+let shared: TreeStore | undefined
+/** The 1M-file tree, built once for the three side-view cases. */
+const sharedStore = () => (shared ??= generate())
+
+/** The median of three runs after one warm-up run (the first call also pays for JIT compiling). */
+function medianMs(run: () => void): number {
+  run()
+  const times: number[] = []
+  for (let i = 0; i < 3; i += 1) {
+    const started = performance.now()
+    run()
+    times.push(performance.now() - started)
+  }
+  return times.sort((a, b) => a - b)[1] ?? Infinity
+}
+
+describe('side views (1M files)', () => {
+  it('lists the top 1,000 files of the root inside the limit', () => {
+    const store = sharedStore()
+    let rows = 0
+    const ms = medianMs(() => {
+      rows = topFiles(store, 0, 'size', TOP_FILES_LIMIT).length
+    })
+    console.log(`[perf] ${JSON.stringify({ topFilesMs: ms })}`)
+    expect(rows).toBe(TOP_FILES_LIMIT)
+    expect(ms).toBeLessThanOrEqual(PERF_LIMITS.maxSideViewMs)
+  }, 60_000)
+
+  it('breaks the root down by file type inside the limit', () => {
+    const store = sharedStore()
+    let rows = 0
+    const ms = medianMs(() => {
+      rows = typeBreakdown(store, 0, TYPE_ROWS_LIMIT).length
+    })
+    console.log(`[perf] ${JSON.stringify({ typesMs: ms })}`)
+    expect(rows).toBe(1) // every generated file is "document-N.dat"
+    expect(ms).toBeLessThanOrEqual(PERF_LIMITS.maxSideViewMs)
+  }, 60_000)
+
+  it('breaks the root down by file age inside the limit', () => {
+    const store = sharedStore()
+    let files = 0
+    const ms = medianMs(() => {
+      files = ageBreakdown(store, 0, 1_700_000_000_000 + 86_400_000).reduce(
+        (sum, row) => sum + row.files,
+        0,
+      )
+    })
+    console.log(`[perf] ${JSON.stringify({ ageMs: ms })}`)
+    expect(files).toBe(PERF_LIMITS.files)
+    expect(ms).toBeLessThanOrEqual(PERF_LIMITS.maxSideViewMs)
+  }, 60_000)
+})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/worker/scanner/scanner-host.test.ts"`
Expected: FAIL (the host ignores the new query kinds, so the new `it` times out in `vi.waitFor`).

- [ ] **Step 3: Write the implementation**

```diff
--- a/src/shared/scanner-protocol.ts
+++ b/src/shared/scanner-protocol.ts
@@ -1,14 +1,17 @@
 import type { ScanDone, ScanFailed, ScanProgress } from './scan-types'
 import type {
+  AgeRow,
   NodeId,
   SizeMode,
   SortDir,
   SortKey,
+  TopFileRow,
   TreemapLayout,
   TreeNodeDetails,
   TreeNodePath,
   TreePage,
   TreeTotals,
+  TypeRow,
 } from './tree-types'

 /** Name of the scanner utilityProcess; it is the `name` in `app.getAppMetrics()`. */
@@ -44,6 +47,10 @@ export type ScannerQuery =
       width: number
       height: number
     }
+  /** The biggest files below a folder, ranked by the Mode (see `rankByOf`). */
+  | { kind: 'top-files'; scanId: string; nodeId: NodeId; mode: SizeMode }
+  | { kind: 'types'; scanId: string; nodeId: NodeId }
+  | { kind: 'age'; scanId: string; nodeId: NodeId }
   | { kind: 'refresh'; scanId: string; nodeId: NodeId }
   | { kind: 'totals'; scanId: string }

@@ -54,6 +61,9 @@ export interface ScannerQueryResults {
   expand: NodeId[]
   paths: Array<TreeNodePath | null>
   treemap: TreemapLayout | null
+  'top-files': TopFileRow[] | null
+  types: TypeRow[] | null
+  age: AgeRow[] | null
   refresh: TreeNodeDetails | null
   totals: TreeTotals | null
 }
```

```diff
--- a/src/worker/scanner/scanner-host.ts
+++ b/src/worker/scanner/scanner-host.ts
@@ -18,6 +18,7 @@ import {
   resolveNode,
 } from './tree-queries'
 import { TreeStore } from './tree-store'
+import { SideViews } from './side-views'
 import { treemapLayout } from './treemap'
 import { walk, type DirectoryLister, type WalkSink } from './walk'
 import { WalkerStartupError } from './walker-pool'
@@ -40,6 +41,8 @@ export interface ScannerHostDeps {
   ): Promise<{ walkers: number }>
   post(message: ScannerMessage): void
   now(): number
+  /** Milliseconds since the epoch, for the Age view (`now()` may be a monotonic clock). */
+  wallClock?(): number
   /** Calls `tick` every `intervalMs` until the returned function is called. */
   startTicker(tick: () => void, intervalMs: number): () => void
 }
@@ -114,6 +117,16 @@ function parseQuery(value: unknown): ScannerQuery | null {
       if (!int(depth) || !int(width) || !int(height)) return null
       return { kind: 'treemap', scanId, nodeId, mode: mode as SizeMode, depth, width, height }
     }
+    case 'top-files': {
+      const { mode } = value
+      return str(nodeId) && SIZE_MODES.includes(mode as SizeMode)
+        ? { kind: 'top-files', scanId, nodeId, mode: mode as SizeMode }
+        : null
+    }
+    case 'types':
+      return str(nodeId) ? { kind: 'types', scanId, nodeId } : null
+    case 'age':
+      return str(nodeId) ? { kind: 'age', scanId, nodeId } : null
     case 'paths': {
       const ids = value['nodeIds']
       if (!Array.isArray(ids) || ids.length > MAX_PATH_QUERY_IDS || !ids.every(str)) return null
@@ -150,6 +163,7 @@ export function createScannerHost(deps: ScannerHostDeps): ScannerHost {
   let current: RunningScan | null = null
   let store: TreeStore | null = null
   let sorter: ChildSorter | null = null
+  let sideViews: SideViews | null = null
   let storeScanId: string | null = null
   /** Refreshes run one after another, never during a scan of the same tree. */
   let refreshes: Promise<unknown> = Promise.resolve()
@@ -236,7 +250,7 @@ export function createScannerHost(deps: ScannerHostDeps): ScannerHost {
       refreshes = next.catch(() => undefined)
       return next
     }
-    if (store === null || sorter === null || storeScanId !== query.scanId) {
+    if (store === null || sorter === null || sideViews === null || storeScanId !== query.scanId) {
       return query.kind === 'expand'
         ? []
         : query.kind === 'paths'
@@ -269,6 +283,12 @@ export function createScannerHost(deps: ScannerHostDeps): ScannerHost {
           query.width,
           query.height,
         )
+      case 'top-files':
+        return sideViews.topFiles(query.nodeId, query.mode)
+      case 'types':
+        return sideViews.types(query.nodeId)
+      case 'age':
+        return sideViews.age(query.nodeId)
       case 'totals':
         return store.totals()
     }
@@ -298,6 +318,7 @@ export function createScannerHost(deps: ScannerHostDeps): ScannerHost {
       // The previous tree is dropped now, so two full trees are never held at once.
       store = new TreeStore(request.root, request.volume.clusterBytes, request.volume.freeBytes)
       sorter = new ChildSorter(store)
+      sideViews = new SideViews(store, deps.wallClock)
       storeScanId = request.scanId
       const controller = new AbortController()
       const scan: RunningScan = { scanId: request.scanId, controller, finished: Promise.resolve() }
```

- [ ] **Step 4: Run the tests, the perf test and the gates**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/worker/scanner; npx vitest run --config vitest.perf.config.mts --reporter verbose; npm run typecheck:node; npm run lint"`
Expected: scanner tests PASS; perf PASS (dry run: top files 30 ms, types 110 ms, each limit 300 ms); typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/scanner-protocol.ts src/worker/scanner/scanner-host.ts src/worker/scanner/scanner-host.test.ts src/worker/scanner/tree-store.perf.test.ts
git commit -m "feat(scanner): answer the top-files, types and age queries; perf cases at 1M files"
```

---

### Task 3: Main IPC channels, preload bridge and `clipboard:copy-text`

**Implementer tier:** Haiku (all code and tests are in the plan).

**Files:**

- Modify: `src/shared/ipc-contract.ts`, `src/main/ipc/parse-args.ts`, `src/main/ipc/tree-handlers.ts`, `src/main/ipc/shell-handlers.ts`, `src/preload/index.ts`, `src/renderer/src/test/fake-api.ts`, `e2e/app.spec.ts`
- Test: `src/main/ipc/parse-args.test.ts`, `tree-handlers.test.ts`, `shell-handlers.test.ts`, `register.test.ts`, `src/preload/index.test.ts`

**Interfaces:**

- Consumes: the `top-files`, `types` and `age` query kinds (Task 2); `scanNodeArgs`, `sizeModeArg`, `oneString`, `expectCount`, `scanIdArg`, `nodeIdArg`, `InvalidIpcArgumentsError` from `parse-args.ts`; `ShellHandlerDeps.writeClipboard(text: string): void` (already wired to `clipboard.writeText` in `src/main/index.ts`, which needs no change: it spreads `createTreeHandlers` and `createShellHandlers`).
- Produces:
  - `IpcContract` gains `'side:top-files': { args: [scanId: string, nodeId: NodeId, mode: SizeMode]; result: TopFileRow[] | null }`, `'side:types': { args: [scanId: string, nodeId: NodeId]; result: TypeRow[] | null }`, `'side:age': { args: [scanId: string, nodeId: NodeId]; result: AgeRow[] | null }` and `'clipboard:copy-text': { args: [text: string]; result: void }`.
  - `MAX_CLIPBOARD_TEXT = 4 * 1024 * 1024` (characters) exported from `ipc-contract.ts`.
  - `topFilesArgs(args): [string, NodeId, SizeMode]` and `copyTextArgs(args): [string]` in `parse-args.ts`.
  - `StorageIQApi` gains `getTopFiles(scanId, nodeId, mode): Promise<TopFileRow[] | null>`, `getTypeBreakdown(scanId, nodeId): Promise<TypeRow[] | null>`, `getAgeBreakdown(scanId, nodeId): Promise<AgeRow[] | null>`, `copyText(text: string): Promise<void>`.
  - `fake-api.ts` exports `TEST_TOP_FILES: TopFileRow[]` (2 rows: `movie.mp4`, `holiday, 2025.jpg`), `TEST_TYPES: TypeRow[]` (mp4, jpg, none), `TEST_AGE: AgeRow[]` (8 rows) and the fake bridge answers them.

- [ ] **Step 1: Write the failing tests**

```diff
--- a/src/main/ipc/parse-args.test.ts
+++ b/src/main/ipc/parse-args.test.ts
@@ -3,6 +3,7 @@ import {
   aboutLinkArg,
   childrenArgs,
   contextMenuArgs,
+  copyTextArgs,
   deleteArgs,
   expandArgs,
   iconNodesArgs,
@@ -16,8 +17,10 @@ import {
   oneBoolean,
   oneString,
   scanNodeArgs,
+  topFilesArgs,
   treemapArgs,
 } from './parse-args'
+import { MAX_CLIPBOARD_TEXT } from '@shared/ipc-contract'

 const SCAN = '0d6b2f6e-8a3c-4c1e-9f61-2b8f6a1d5e10'

@@ -126,6 +129,38 @@ describe('treemapArgs', () => {
   })
 })

+describe('topFilesArgs', () => {
+  it('accepts a scan id, a node id and a Mode', () => {
+    expect(topFilesArgs([SCAN, 'd0', 'allocated'])).toEqual([SCAN, 'd0', 'allocated'])
+    expect(topFilesArgs([SCAN, 'f12', 'files'])).toEqual([SCAN, 'f12', 'files'])
+  })
+
+  it.each([
+    [[SCAN, 'd0']],
+    [[SCAN, 'd0', 'colour']],
+    [[SCAN, 'C:\\Windows', 'size']],
+    [['not a scan id!', 'd0', 'size']],
+    [[SCAN, 'd0', 'size', 'extra']],
+  ])('rejects %j', (args) => {
+    expect(() => topFilesArgs(args)).toThrow(InvalidIpcArgumentsError)
+  })
+})
+
+describe('copyTextArgs', () => {
+  it('accepts text up to the limit', () => {
+    expect(copyTextArgs(['Name,Size\r\nA,1\r\n'])).toEqual(['Name,Size\r\nA,1\r\n'])
+    const longest = 'x'.repeat(MAX_CLIPBOARD_TEXT)
+    expect(copyTextArgs([longest])).toEqual([longest])
+  })
+
+  it.each([[[]], [['']], [[42]], [['a', 'b']], [['x'.repeat(MAX_CLIPBOARD_TEXT + 1)]]])(
+    'rejects %j',
+    (args) => {
+      expect(() => copyTextArgs(args)).toThrow(InvalidIpcArgumentsError)
+    },
+  )
+})
+
 describe('contextMenuArgs', () => {
   const ids = (n: number) => Array.from({ length: n }, (_, i) => `f${i + 1}`)

```

```diff
--- a/src/main/ipc/tree-handlers.test.ts
+++ b/src/main/ipc/tree-handlers.test.ts
@@ -40,6 +40,25 @@ describe('tree query handlers', () => {
     expect(() => handlers['tree:expand-ids'].parseArgs([SCAN, 'd0'])).toThrow(
       InvalidIpcArgumentsError,
     )
+    expect(() => handlers['side:top-files'].parseArgs([SCAN, 'd0', 'huge'])).toThrow(
+      InvalidIpcArgumentsError,
+    )
+    expect(() => handlers['side:types'].parseArgs([SCAN, '../etc'])).toThrow(
+      InvalidIpcArgumentsError,
+    )
+    expect(() => handlers['side:age'].parseArgs([SCAN])).toThrow(InvalidIpcArgumentsError)
+  })
+
+  it('forward the side-view queries to the scanner unchanged', async () => {
+    const { handlers, queries } = setup()
+    await handlers['side:top-files'].handle(event, SCAN, 'd1', 'allocated')
+    await handlers['side:types'].handle(event, SCAN, 'd1')
+    await handlers['side:age'].handle(event, SCAN, 'f7')
+    expect(queries).toEqual([
+      { kind: 'top-files', scanId: SCAN, nodeId: 'd1', mode: 'allocated' },
+      { kind: 'types', scanId: SCAN, nodeId: 'd1' },
+      { kind: 'age', scanId: SCAN, nodeId: 'f7' },
+    ])
   })

   it('forward each query to the scanner unchanged', async () => {
```

```diff
--- a/src/main/ipc/shell-handlers.test.ts
+++ b/src/main/ipc/shell-handlers.test.ts
@@ -581,6 +581,26 @@ describe('clipboard:copy-path', () => {
   })
 })

+describe('clipboard:copy-text', () => {
+  it('writes exactly the text it was given', async () => {
+    const { handlers, deps } = setup()
+    await handlers['clipboard:copy-text'].handle(event, 'Name,Size\r\n"a, b",1\r\n')
+    expect(deps.writeClipboard).toHaveBeenCalledWith('Name,Size\r\n"a, b",1\r\n')
+  })
+
+  it('refuses anything but one string of 1 to 4 MiB', () => {
+    const { handlers } = setup()
+    expect(() => handlers['clipboard:copy-text'].parseArgs([])).toThrow(InvalidIpcArgumentsError)
+    expect(() => handlers['clipboard:copy-text'].parseArgs([''])).toThrow(InvalidIpcArgumentsError)
+    expect(() => handlers['clipboard:copy-text'].parseArgs([{ text: 'x' }])).toThrow(
+      InvalidIpcArgumentsError,
+    )
+    expect(() =>
+      handlers['clipboard:copy-text'].parseArgs(['x'.repeat(4 * 1024 * 1024 + 1)]),
+    ).toThrow(InvalidIpcArgumentsError)
+  })
+})
+
 describe('menu refresh of the scan root', () => {
   it('announces the new scan with scan:restarted before its progress', async () => {
     const fake = fakeTreeService()
```

```diff
--- a/src/main/ipc/register.test.ts
+++ b/src/main/ipc/register.test.ts
@@ -4,6 +4,7 @@ import type { AppInfo } from '@shared/ipc-contract'
 import {
   childrenArgs,
   contextMenuArgs,
+  copyTextArgs,
   deleteArgs,
   expandArgs,
   iconNodesArgs,
@@ -16,6 +17,7 @@ import {
   oneString,
   scanNodeArgs,
   scanNodesArgs,
+  topFilesArgs,
   treemapArgs,
 } from './parse-args'
 import {
@@ -52,6 +54,9 @@ function createHandlers(overrides: Partial<IpcHandlerMap> = {}): IpcHandlerMap {
     'tree:expand-ids': { parseArgs: expandArgs, handle: () => [] },
     'tree:refresh': { parseArgs: scanNodeArgs, handle: () => null },
     'treemap:layout': { parseArgs: treemapArgs, handle: () => null },
+    'side:top-files': { parseArgs: topFilesArgs, handle: () => null },
+    'side:types': { parseArgs: scanNodeArgs, handle: () => null },
+    'side:age': { parseArgs: scanNodeArgs, handle: () => null },
     'icons:for-nodes': {
       parseArgs: iconNodesArgs,
       handle: () => ({ keys: {}, images: {}, pending: [] }),
@@ -98,6 +103,7 @@ function createHandlers(overrides: Partial<IpcHandlerMap> = {}): IpcHandlerMap {
     'shell:delete': { parseArgs: deleteArgs, handle: () => ({ kind: 'dismissed' }) },
     'folder:create': { parseArgs: scanNodeArgs, handle: () => ({ parentId: 'd0', name: 'x' }) },
     'clipboard:copy-path': { parseArgs: scanNodesArgs, handle: () => undefined },
+    'clipboard:copy-text': { parseArgs: copyTextArgs, handle: () => undefined },
     ...overrides,
   }
 }
@@ -143,6 +149,7 @@ describe('registerIpcHandlers', () => {
       'app:open-notices',
       'app:quit',
       'clipboard:copy-path',
+      'clipboard:copy-text',
       'dialog:select-folder',
       'drive:info',
       'drives:list',
@@ -161,6 +168,9 @@ describe('registerIpcHandlers', () => {
       'shell:context-menu',
       'shell:delete',
       'shell:open-in-explorer',
+      'side:age',
+      'side:top-files',
+      'side:types',
       'tree:children',
       'tree:expand-ids',
       'tree:node',
```

```diff
--- a/src/preload/index.test.ts
+++ b/src/preload/index.test.ts
@@ -120,9 +120,24 @@ describe('preload bridge', () => {
     expect(ipcRenderer.invoke).toHaveBeenCalledWith('clipboard:copy-path', 'scan-1', ['d1', 'f2'])
   })

-  it('exposes copyNodePath and no free-text clipboard writer', () => {
+  it('exposes copyNodePath, and copyText that sends one string and nothing else', async () => {
+    const { ipcRenderer } = await import('electron')
     expect(typeof exposed['copyNodePath']).toBe('function')
     expect(exposed['writeClipboardText']).toBeUndefined()
+    await (exposed['copyText'] as unknown as (...args: unknown[]) => Promise<unknown>)('a,b\r\n')
+    expect(ipcRenderer.invoke).toHaveBeenCalledWith('clipboard:copy-text', 'a,b\r\n')
+  })
+
+  it('the side-view calls send only ids and the Mode', async () => {
+    const { ipcRenderer } = await import('electron')
+    const call = (name: string, ...args: unknown[]) =>
+      (exposed[name] as unknown as (...a: unknown[]) => Promise<unknown>)(...args)
+    await call('getTopFiles', 'scan-1', 'd1', 'allocated')
+    expect(ipcRenderer.invoke).toHaveBeenCalledWith('side:top-files', 'scan-1', 'd1', 'allocated')
+    await call('getTypeBreakdown', 'scan-1', 'd1')
+    expect(ipcRenderer.invoke).toHaveBeenCalledWith('side:types', 'scan-1', 'd1')
+    await call('getAgeBreakdown', 'scan-1', 'f2')
+    expect(ipcRenderer.invoke).toHaveBeenCalledWith('side:age', 'scan-1', 'f2')
   })

   it('getIcons and getTypeIcons send only ids and type keys', async () => {
```

- [ ] **Step 2: Run them to verify they fail**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/main/ipc src/preload"`
Expected: FAIL (`topFilesArgs`/`copyTextArgs` are not exported, the new handlers and bridge methods do not exist).

- [ ] **Step 3: Write the implementation**

```diff
--- a/src/shared/ipc-contract.ts
+++ b/src/shared/ipc-contract.ts
@@ -9,16 +9,22 @@ import type {
   ScanStartResult,
 } from './scan-types'
 import type {
+  AgeRow,
   NodeId,
   SizeMode,
   SortDir,
   SortKey,
+  TopFileRow,
   TreeChanged,
   TreemapLayout,
   TreeNodeDetails,
   TreePage,
+  TypeRow,
 } from './tree-types'

+/** Longest text `clipboard:copy-text` takes, in characters (4 MiB of ASCII). */
+export const MAX_CLIPBOARD_TEXT = 4 * 1024 * 1024
+
 /** Metadata about the running application, shown in the status bar and the About box. */
 export interface AppInfo {
   name: string
@@ -170,6 +176,12 @@ export interface IpcContract {
     ]
     result: TreemapLayout | null
   }
+  'side:top-files': {
+    args: [scanId: string, nodeId: NodeId, mode: SizeMode]
+    result: TopFileRow[] | null
+  }
+  'side:types': { args: [scanId: string, nodeId: NodeId]; result: TypeRow[] | null }
+  'side:age': { args: [scanId: string, nodeId: NodeId]; result: AgeRow[] | null }
   'shell:open-in-explorer': { args: [scanId: string, nodeId: NodeId]; result: void }
   'shell:context-menu': {
     args: [scanId: string, nodeIds: NodeId[], x: number, y: number, extended: boolean]
@@ -181,6 +193,7 @@ export interface IpcContract {
   }
   'folder:create': { args: [scanId: string, nodeId: NodeId]; result: CreateFolderResult }
   'clipboard:copy-path': { args: [scanId: string, nodeIds: NodeId[]]; result: void }
+  'clipboard:copy-text': { args: [text: string]; result: void }
   'icons:for-nodes': { args: [scanId: string, nodeIds: NodeId[]]; result: IconBatch }
   'icons:for-types': { args: [typeKeys: string[]]; result: Record<string, IconImage> }
   'update:install': { args: []; result: void }
@@ -263,6 +276,16 @@ export interface StorageIQApi {
     width: number,
     height: number,
   ): Promise<TreemapLayout | null>
+  /**
+   * The biggest files below a folder (up to 1,000), ranked by the Mode: allocated size for
+   * Allocated, logical size otherwise. A file or "[N files]" row stands for its folder; null when
+   * the node no longer exists.
+   */
+  getTopFiles(scanId: string, nodeId: NodeId, mode: SizeMode): Promise<TopFileRow[] | null>
+  /** Bytes per file extension below a folder (up to 500, then one "other" row); null when gone. */
+  getTypeBreakdown(scanId: string, nodeId: NodeId): Promise<TypeRow[] | null>
+  /** Bytes per modification-age bucket below a folder (always 8 rows); null when gone. */
+  getAgeBreakdown(scanId: string, nodeId: NodeId): Promise<AgeRow[] | null>
   openInExplorer(scanId: string, nodeId: NodeId): Promise<void>
   /**
    * Shows the Windows Explorer context menu for one or more rows (1 to 1,000) at window
@@ -288,6 +311,8 @@ export interface StorageIQApi {
    * the paths).
    */
   copyNodePath(scanId: string, nodeIds: NodeId[]): Promise<void>
+  /** Copies text the renderer built (a CSV of a list view) to the clipboard; at most 4 MiB. */
+  copyText(text: string): Promise<void>
   /**
    * Windows’ own icons for rows of the current scan (1 to 64 ids). A key missing from `images`
    * means “keep the placeholder”; native failures answer empty, only invalid arguments reject.
```

```diff
--- a/src/main/ipc/parse-args.ts
+++ b/src/main/ipc/parse-args.ts
@@ -1,4 +1,4 @@
-import type { AboutLink } from '@shared/ipc-contract'
+import { type AboutLink, MAX_CLIPBOARD_TEXT } from '@shared/ipc-contract'
 import {
   MAX_PAGE_ROWS,
   MAX_TREEMAP_DEPTH,
@@ -162,6 +162,21 @@ export function treemapArgs(
   ]
 }

+/** `side:top-files`: `[scanId, nodeId, mode]` */
+export function topFilesArgs(args: readonly unknown[]): [string, NodeId, SizeMode] {
+  expectCount(args, 3)
+  return [scanIdArg(args[0]), nodeIdArg(args[1]), sizeModeArg(args[2])]
+}
+
+/** `clipboard:copy-text`: one string of 1 to `MAX_CLIPBOARD_TEXT` characters. */
+export function copyTextArgs(args: readonly unknown[]): [string] {
+  const [text] = oneString(args)
+  if (text.length < 1 || text.length > MAX_CLIPBOARD_TEXT) {
+    throw new InvalidIpcArgumentsError(`expected 1 to ${MAX_CLIPBOARD_TEXT} characters of text`)
+  }
+  return [text]
+}
+
 /** Most rows one Explorer action (menu, copy paths) takes. */
 export const MAX_ACTION_ITEMS = 1000

```

```diff
--- a/src/main/ipc/tree-handlers.ts
+++ b/src/main/ipc/tree-handlers.ts
@@ -1,13 +1,27 @@
 import { type NodeId, ROOT_NODE_ID, type TreeNodeDetails } from '@shared/tree-types'
 import type { ScanVolume } from '@shared/scanner-protocol'
 import type { ScanService } from '../scan/scan-service'
-import { childrenArgs, expandArgs, nodeArgs, scanNodeArgs, treemapArgs } from './parse-args'
+import {
+  childrenArgs,
+  expandArgs,
+  nodeArgs,
+  scanNodeArgs,
+  topFilesArgs,
+  treemapArgs,
+} from './parse-args'
 import type { IpcHandlerMap } from './register'
 import type { SendEvent } from './send-event'

 export type TreeHandlers = Pick<
   IpcHandlerMap,
-  'tree:children' | 'tree:node' | 'tree:expand-ids' | 'tree:refresh' | 'treemap:layout'
+  | 'tree:children'
+  | 'tree:node'
+  | 'tree:expand-ids'
+  | 'tree:refresh'
+  | 'treemap:layout'
+  | 'side:top-files'
+  | 'side:types'
+  | 'side:age'
 >

 export const NOT_IN_SCAN_MESSAGE = 'That item is not part of the current scan.'
@@ -113,5 +127,18 @@ export function createTreeHandlers(deps: {
       handle: (_event, scanId, nodeId, mode, depth, width, height) =>
         scanService.query({ kind: 'treemap', scanId, nodeId, mode, depth, width, height }),
     },
+    'side:top-files': {
+      parseArgs: topFilesArgs,
+      handle: (_event, scanId, nodeId, mode) =>
+        scanService.query({ kind: 'top-files', scanId, nodeId, mode }),
+    },
+    'side:types': {
+      parseArgs: scanNodeArgs,
+      handle: (_event, scanId, nodeId) => scanService.query({ kind: 'types', scanId, nodeId }),
+    },
+    'side:age': {
+      parseArgs: scanNodeArgs,
+      handle: (_event, scanId, nodeId) => scanService.query({ kind: 'age', scanId, nodeId }),
+    },
   }
 }
```

```diff
--- a/src/main/ipc/shell-handlers.ts
+++ b/src/main/ipc/shell-handlers.ts
@@ -14,7 +14,13 @@ import { E_FAIL, isShellPathGone } from '../shell-menu/shell-menu-error'
 import { ShellBusyError } from '../shell-menu/shell-worker-pool'
 import type { ItemWatcher } from './item-watcher'
 import { mapLimit } from './map-limit'
-import { contextMenuArgs, deleteArgs, scanNodeArgs, scanNodesArgs } from './parse-args'
+import {
+  contextMenuArgs,
+  copyTextArgs,
+  deleteArgs,
+  scanNodeArgs,
+  scanNodesArgs,
+} from './parse-args'
 import type { IpcHandlerMap } from './register'
 import {
   folderIdOf,
@@ -32,6 +38,7 @@ export type ShellHandlers = Pick<
   | 'shell:delete'
   | 'folder:create'
   | 'clipboard:copy-path'
+  | 'clipboard:copy-text'
 >

 /** For verbs that leave the item in place: the folder is rescanned once more after this delay. */
@@ -586,5 +593,14 @@ export function createShellHandlers(deps: ShellHandlerDeps): ShellHandlers {
         deps.writeClipboard([...new Set(items.map((item) => item.path))].join('\r\n'))
       },
     },
+
+    // The text is the renderer's own (a CSV it built from a scanner list), so unlike
+    // `clipboard:copy-path` there is no node to resolve; the length limit is in `copyTextArgs`.
+    'clipboard:copy-text': {
+      parseArgs: copyTextArgs,
+      handle: (_event, text) => {
+        deps.writeClipboard(text)
+      },
+    },
   }
 }
```

```diff
--- a/src/preload/index.ts
+++ b/src/preload/index.ts
@@ -23,12 +23,16 @@ const api: StorageIQApi = {
   refreshFolder: (scanId, nodeId) => invoke('tree:refresh', scanId, nodeId),
   getTreemap: (scanId, nodeId, mode, depth, width, height) =>
     invoke('treemap:layout', scanId, nodeId, mode, depth, width, height),
+  getTopFiles: (scanId, nodeId, mode) => invoke('side:top-files', scanId, nodeId, mode),
+  getTypeBreakdown: (scanId, nodeId) => invoke('side:types', scanId, nodeId),
+  getAgeBreakdown: (scanId, nodeId) => invoke('side:age', scanId, nodeId),
   openInExplorer: (scanId, nodeId) => invoke('shell:open-in-explorer', scanId, nodeId),
   showContextMenu: (scanId, nodeIds, x, y, extended) =>
     invoke('shell:context-menu', scanId, nodeIds, x, y, extended),
   deleteNodes: (scanId, nodeIds, permanent) => invoke('shell:delete', scanId, nodeIds, permanent),
   createFolder: (scanId, nodeId) => invoke('folder:create', scanId, nodeId),
   copyNodePath: (scanId, nodeIds) => invoke('clipboard:copy-path', scanId, nodeIds),
+  copyText: (text) => invoke('clipboard:copy-text', text),
   getIcons: (scanId, nodeIds) => invoke('icons:for-nodes', scanId, nodeIds),
   getTypeIcons: (typeKeys) => invoke('icons:for-types', typeKeys),
   onScanProgress: (listener) => subscribe(ipcRenderer, 'scan:progress', listener),
```

Fake bridge data for the renderer tests (used from Task 4 on) and the exposed-API list of the E2E test:

```diff
--- a/src/renderer/src/test/fake-api.ts
+++ b/src/renderer/src/test/fake-api.ts
@@ -20,15 +20,19 @@ import type {
   ScanRestarted,
   ScanStartResult,
 } from '@shared/scan-types'
-import type {
-  NodeId,
-  SortDir,
-  SortKey,
-  TreeChanged,
-  TreemapLayout,
-  TreeNodeDetails,
-  TreePage,
-  TreeRow,
+import {
+  AGE_BUCKETS,
+  type AgeRow,
+  type NodeId,
+  type SortDir,
+  type SortKey,
+  type TopFileRow,
+  type TreeChanged,
+  type TreemapLayout,
+  type TreeNodeDetails,
+  type TreePage,
+  type TreeRow,
+  type TypeRow,
 } from '@shared/tree-types'

 export const TEST_APP_INFO: AppInfo = {
@@ -172,6 +176,50 @@ export const TEST_ROWS: Record<NodeId, TreeRow> = {
   }),
 }

+/** The files the Top files view shows for the sample tree, biggest first. */
+export const TEST_TOP_FILES: TopFileRow[] = [
+  {
+    id: 'f1',
+    name: 'movie.mp4',
+    folder: 'D:\\Videos',
+    size: 0.5 * GB,
+    allocated: 0.5 * GB,
+    modifiedMs: Date.UTC(2026, 10, 19, 12),
+  },
+  {
+    id: 'f2',
+    name: 'holiday, 2025.jpg',
+    folder: 'D:\\Photos',
+    size: 12 * MB,
+    allocated: 12 * MB + 4096,
+    modifiedMs: Date.UTC(2024, 5, 1, 12),
+  },
+]
+
+/** The file types of the sample tree (3 GB in all, like the root). */
+export const TEST_TYPES: TypeRow[] = [
+  { kind: 'extension', ext: 'mp4', category: 'video', size: 2 * GB, allocated: 2 * GB, files: 10 },
+  {
+    kind: 'extension',
+    ext: 'jpg',
+    category: 'image',
+    size: 768 * MB,
+    allocated: 776 * MB,
+    files: 1000,
+  },
+  { kind: 'none', ext: '', category: 'other', size: 256 * MB, allocated: 256 * MB, files: 3 },
+]
+
+/** The age buckets of the sample tree: all 8 rows, as the scanner returns them. */
+export const TEST_AGE: AgeRow[] = AGE_BUCKETS.map((bucket) => {
+  const filled: Record<string, Pick<AgeRow, 'size' | 'allocated' | 'files'>> = {
+    'last-30-days': { size: 2 * GB, allocated: 2 * GB, files: 10 },
+    'years-2-5': { size: 768 * MB, allocated: 776 * MB, files: 1000 },
+    unknown: { size: 256 * MB, allocated: 256 * MB, files: 3 },
+  }
+  return { ...bucket, ...(filled[bucket.id] ?? { size: 0, allocated: 0, files: 0 }) }
+})
+
 const CHILDREN: Record<NodeId, NodeId[]> = {
   d0: ['d1', 'd2', 'g0'],
   d1: ['d3', 'g1'],
@@ -331,11 +379,15 @@ export function createFakeApi(overrides: Partial<StorageIQApi> = {}): FakeApi {
     getTreemap: vi.fn(async (_scanId, nodeId, _mode, _depth, width, height) =>
       fakeTreemap(nodeId, width, height),
     ),
+    getTopFiles: vi.fn(async (): Promise<TopFileRow[] | null> => TEST_TOP_FILES),
+    getTypeBreakdown: vi.fn(async (): Promise<TypeRow[] | null> => TEST_TYPES),
+    getAgeBreakdown: vi.fn(async (): Promise<AgeRow[] | null> => TEST_AGE),
     openInExplorer: vi.fn(async () => undefined),
     showContextMenu: vi.fn(async () => ({ kind: 'dismissed' as const })),
     deleteNodes: vi.fn(async () => ({ kind: 'dismissed' as const })),
     createFolder: vi.fn(async () => ({ parentId: 'd1', name: 'New folder' })),
     copyNodePath: vi.fn(async () => undefined),
+    copyText: vi.fn(async () => undefined),
     getIcons: vi.fn(async (): Promise<IconBatch> => ({ keys: {}, images: {}, pending: [] })),
     getTypeIcons: vi.fn(async () => ({})),
     onScanProgress: vi.fn(progress.subscribe),
```

```diff
--- a/e2e/app.spec.ts
+++ b/e2e/app.spec.ts
@@ -40,9 +40,11 @@ test('launches a locked-down renderer with the StorageIQ bridge', async () => {
     'cancelScan',
     'checkForUpdates',
     'copyNodePath',
+    'copyText',
     'createFolder',
     'deleteNodes',
     'downloadUpdate',
+    'getAgeBreakdown',
     'getAppInfo',
     'getAutoUpdate',
     'getChangelog',
@@ -53,7 +55,9 @@ test('launches a locked-down renderer with the StorageIQ bridge', async () => {
     'getNode',
     'getOptionsState',
     'getReleaseNotes',
+    'getTopFiles',
     'getTreemap',
+    'getTypeBreakdown',
     'getTypeIcons',
     'getUpdateState',
     'getWhatsNewDue',
```

- [ ] **Step 4: Run the tests and the gates**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/main src/preload; npm run typecheck; npm run lint"`
Expected: all PASS; typecheck (node and web) and lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc-contract.ts src/main/ipc/parse-args.ts src/main/ipc/parse-args.test.ts src/main/ipc/tree-handlers.ts src/main/ipc/tree-handlers.test.ts src/main/ipc/shell-handlers.ts src/main/ipc/shell-handlers.test.ts src/main/ipc/register.test.ts src/preload/index.ts src/preload/index.test.ts src/renderer/src/test/fake-api.ts e2e/app.spec.ts
git commit -m "feat(ipc): side-view channels and clipboard:copy-text, with the preload bridge"
```

---

### Task 4: Workspace store — `paneTab`, side-view fetching and `copyCsv`

**Implementer tier:** Haiku (all code and tests are in the plan).

**Files:**

- Modify: `src/renderer/src/stores/workspace-store.ts`
- Test: `src/renderer/src/stores/workspace-store-side-views.test.ts` (new)

**Interfaces:**

- Consumes: `StorageIQApi.getTopFiles/getTypeBreakdown/getAgeBreakdown/copyText/getTypeIcons`, `MAX_CLIPBOARD_TEXT` (Task 3); `fake-api.ts` test data (Task 3).
- Produces (`workspace-store.ts`):
  - `type PaneTab = 'treemap' | 'top' | 'types' | 'age'`; `CSV_TOO_LARGE_MESSAGE = 'Too many rows to copy.'`
  - State `paneTab: PaneTab` (default `'treemap'`); `treemapVisible` now means "the bottom pane is shown".
  - `setPaneTab(tab: PaneTab): void` (also shows the pane), `togglePane(tab: PaneTab): void` (hides the pane when it already shows `tab`, else shows `tab`).
  - `fetchTopFiles(): Promise<TopFileRow[] | null>` (uses `scanId`, `treemapRootId`, `mode`), `fetchTypes(): Promise<TypeRow[] | null>`, `fetchAges(): Promise<AgeRow[] | null>`: each answers `null` before a scan, when the node is gone and when the call fails.
  - `loadTypeIcons(typeKeys: string[]): Promise<Record<string, IconImage>>` (empty for no keys or a failed call).
  - `copyCsv(csv: string, rows: number): Promise<void>`: refuses text longer than `MAX_CLIPBOARD_TEXT` with the announcement "Too many rows to copy."; otherwise `api.copyText(csv)` and the announcement `Copied N rows.` (`Copied 1 row.`); a failure shows the error banner.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/stores/workspace-store-side-views.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { MAX_CLIPBOARD_TEXT } from '@shared/ipc-contract'
import { createFakeApi, TEST_AGE, TEST_TOP_FILES, TEST_TYPES } from '../test/fake-api'
import { CSV_TOO_LARGE_MESSAGE, createWorkspaceStore } from './workspace-store'

async function scanning(api = createFakeApi()) {
  const store = createWorkspaceStore(api)
  await store.getState().startScan('D:\\')
  return { api, store }
}

describe('the bottom pane tabs', () => {
  it('starts on the treemap, shown', () => {
    const store = createWorkspaceStore(createFakeApi())
    expect(store.getState()).toMatchObject({ paneTab: 'treemap', treemapVisible: true })
  })

  it('setPaneTab shows that view and the pane', () => {
    const store = createWorkspaceStore(createFakeApi())
    store.getState().setTreemapVisible(false)
    store.getState().setPaneTab('types')
    expect(store.getState()).toMatchObject({ paneTab: 'types', treemapVisible: true })
  })

  it('togglePane hides the pane when it already shows that view, else shows the view', () => {
    const store = createWorkspaceStore(createFakeApi())
    store.getState().togglePane('treemap')
    expect(store.getState().treemapVisible).toBe(false)
    store.getState().togglePane('top')
    expect(store.getState()).toMatchObject({ paneTab: 'top', treemapVisible: true })
    store.getState().togglePane('age')
    expect(store.getState()).toMatchObject({ paneTab: 'age', treemapVisible: true })
    store.getState().togglePane('age')
    expect(store.getState().treemapVisible).toBe(false)
  })
})

describe('fetching the side views', () => {
  it('asks for the treemap folder of the current scan, with the Mode for Top files', async () => {
    const { api, store } = await scanning()
    expect(await store.getState().fetchTopFiles()).toEqual(TEST_TOP_FILES)
    expect(api.getTopFiles).toHaveBeenLastCalledWith('scan-1', 'd0', 'size')
    store.getState().setMode('allocated')
    store.getState().select('d1')
    await store.getState().fetchTopFiles()
    expect(api.getTopFiles).toHaveBeenLastCalledWith('scan-1', 'd1', 'allocated')
    expect(await store.getState().fetchTypes()).toEqual(TEST_TYPES)
    expect(api.getTypeBreakdown).toHaveBeenLastCalledWith('scan-1', 'd1')
    expect(await store.getState().fetchAges()).toEqual(TEST_AGE)
    expect(api.getAgeBreakdown).toHaveBeenLastCalledWith('scan-1', 'd1')
  })

  it('answers null before a scan, when the node is gone and when the call fails', async () => {
    const idle = createWorkspaceStore(createFakeApi())
    expect(await idle.getState().fetchTopFiles()).toBeNull()
    expect(await idle.getState().fetchTypes()).toBeNull()
    expect(await idle.getState().fetchAges()).toBeNull()

    const gone = await scanning(createFakeApi({ getTypeBreakdown: vi.fn(async () => null) }))
    expect(await gone.store.getState().fetchTypes()).toBeNull()

    const broken = await scanning(
      createFakeApi({
        getTopFiles: vi.fn(async () => {
          throw new Error('scanner busy')
        }),
      }),
    )
    expect(await broken.store.getState().fetchTopFiles()).toBeNull()
  })

  it('loadTypeIcons asks for the keys, and answers empty for no keys or a failed call', async () => {
    const image = { small: 'data:image/png;base64,AA==', large: 'data:image/png;base64,BB==' }
    const api = createFakeApi({ getTypeIcons: vi.fn(async () => ({ 'ext:jpg': image })) })
    const store = createWorkspaceStore(api)
    expect(await store.getState().loadTypeIcons(['ext:jpg'])).toEqual({ 'ext:jpg': image })
    expect(api.getTypeIcons).toHaveBeenCalledWith(['ext:jpg'])
    expect(await store.getState().loadTypeIcons([])).toEqual({})
    expect(api.getTypeIcons).toHaveBeenCalledTimes(1)
    const failing = createWorkspaceStore(
      createFakeApi({
        getTypeIcons: vi.fn(async () => {
          throw new Error('no icons')
        }),
      }),
    )
    expect(await failing.getState().loadTypeIcons(['file'])).toEqual({})
  })
})

describe('copyCsv', () => {
  it('sends the text to main and announces the row count', async () => {
    const { api, store } = await scanning()
    await store.getState().copyCsv('Name\r\na\r\n', 1)
    expect(api.copyText).toHaveBeenCalledWith('Name\r\na\r\n')
    expect(store.getState().announcement).toBe('Copied 1 row.')
    await store.getState().copyCsv('Name\r\na\r\nb\r\n', 2)
    expect(store.getState().announcement).toBe('Copied 2 rows.')
  })

  it('refuses text over the limit without calling main', async () => {
    const { api, store } = await scanning()
    await store.getState().copyCsv('x'.repeat(MAX_CLIPBOARD_TEXT + 1), 5000)
    expect(api.copyText).not.toHaveBeenCalled()
    expect(store.getState().announcement).toBe(CSV_TOO_LARGE_MESSAGE)
  })

  it('shows the error banner when main refuses', async () => {
    const { store } = await scanning(
      createFakeApi({
        copyText: vi.fn(async () => {
          throw new Error("Error invoking remote method 'clipboard:copy-text': Error: no")
        }),
      }),
    )
    await store.getState().copyCsv('a', 1)
    expect(store.getState().banner).toMatchObject({ tone: 'error' })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/renderer/src/stores/workspace-store-side-views.test.ts"`
Expected: FAIL (`setPaneTab is not a function` and similar).

- [ ] **Step 3: Write the implementation**

```diff
--- a/src/renderer/src/stores/workspace-store.ts
+++ b/src/renderer/src/stores/workspace-store.ts
@@ -1,14 +1,16 @@
 import { createStore, type StoreApi } from 'zustand/vanilla'
-import type {
-  AboutLink,
-  ChangelogEntry,
-  ContextMenuOutcome,
-  LaunchRequest,
-  OptionsChangeResult,
-  OptionsState,
-  ReleaseNotes,
-  StorageIQApi,
-  UpdateState,
+import {
+  type AboutLink,
+  type ChangelogEntry,
+  type ContextMenuOutcome,
+  type IconImage,
+  type LaunchRequest,
+  MAX_CLIPBOARD_TEXT,
+  type OptionsChangeResult,
+  type OptionsState,
+  type ReleaseNotes,
+  type StorageIQApi,
+  type UpdateState,
 } from '@shared/ipc-contract'
 import type {
   DriveDetails,
@@ -26,12 +28,15 @@ import {
   MAX_TREEMAP_DEPTH,
   modeSortKey,
   ROOT_NODE_ID,
+  type AgeRow,
   type NodeId,
   type SizeMode,
   type SortDir,
   type SortKey,
+  type TopFileRow,
   type TreeChanged,
   type TreemapLayout,
+  type TypeRow,
 } from '@shared/tree-types'
 import type { SizeUnit } from '../lib/format'
 import { dropDescendants, type Selection, single } from '../lib/selection'
@@ -51,6 +56,9 @@ export type ColumnId = 'name' | 'size' | 'allocated' | 'files' | 'folders' | 'pe

 export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

+/** The views of the bottom pane: the treemap and the three side views. */
+export type PaneTab = 'treemap' | 'top' | 'types' | 'age'
+
 export interface ScanTotals {
   files: number
   folders: number
@@ -75,6 +83,7 @@ export const GONE_MESSAGE = 'That item no longer exists. The list was refreshed.
 export const BUSY_MESSAGE = 'Windows is still working on earlier actions. Try again in a moment.'
 export const BIN_MIXED_MESSAGE = 'Select the Recycle Bin on its own to empty it.'
 export const TOO_MANY_MESSAGE = 'Too many items selected (the limit is 1,000).'
+export const CSV_TOO_LARGE_MESSAGE = 'Too many rows to copy.'
 /** Rows one Explorer action takes (the same limit as main). */
 export const MAX_ACTION_ITEMS = 1000
 /** A selection larger than this is not re-checked against the scanner; it shrinks to the active row. */
@@ -143,7 +152,10 @@ export interface WorkspaceState {
   scrollTarget: { id: NodeId; seq: number } | null
   /** Bumps whenever the scanner's tree may have changed; loaded chunks older than it reload. */
   revision: number
+  /** Whether the bottom pane (the treemap or a side view) is shown. */
   treemapVisible: boolean
+  /** The view the bottom pane shows. */
+  paneTab: PaneTab
   treemapDepth: number
   /** The folder the treemap shows. */
   treemapRootId: NodeId | null
@@ -196,8 +208,22 @@ export interface WorkspaceState {
   deleteSelection(permanent: boolean): Promise<void>
   /** Lays out the treemap of `treemapRootId` for a canvas of `width` × `height` CSS px. */
   fetchTreemap(width: number, height: number): Promise<TreemapLayout | null>
+  /** The biggest files below `treemapRootId`, ranked by the Mode; null when it is gone. */
+  fetchTopFiles(): Promise<TopFileRow[] | null>
+  /** Bytes per file extension below `treemapRootId`; null when it is gone. */
+  fetchTypes(): Promise<TypeRow[] | null>
+  /** Bytes per modification-age bucket below `treemapRootId`; null when it is gone. */
+  fetchAges(): Promise<AgeRow[] | null>
+  /** Windows' icons for file type keys (`ext:jpg`, `file`); empty when the call fails. */
+  loadTypeIcons(typeKeys: string[]): Promise<Record<string, IconImage>>
+  /** Puts a list view's CSV on the clipboard and announces "Copied N rows." */
+  copyCsv(csv: string, rows: number): Promise<void>
   setTreemapDepth(depth: number): void
   setTreemapVisible(visible: boolean): void
+  /** Shows another view in the bottom pane (and the pane itself when it was hidden). */
+  setPaneTab(tab: PaneTab): void
+  /** The ribbon's Pane buttons: show that view, or hide the pane when it already shows it. */
+  togglePane(tab: PaneTab): void
   dismissBanner(): void
   /** A validated `--scan` request from main: scans now, or asks first while a scan runs. */
   receiveLaunchRequest(request: LaunchRequest): void
@@ -458,6 +484,7 @@ export function createWorkspaceStore(api: StorageIQApi): WorkspaceStore {
       scrollTarget: null,
       revision: 0,
       treemapVisible: true,
+      paneTab: 'treemap',
       treemapDepth: DEFAULT_TREEMAP_DEPTH,
       treemapRootId: null,
       banner: null,
@@ -791,6 +818,58 @@ export function createWorkspaceStore(api: StorageIQApi): WorkspaceStore {
         }
       },

+      async fetchTopFiles() {
+        const { scanId, treemapRootId, mode } = get()
+        if (scanId === null || treemapRootId === null) return null
+        try {
+          return await api.getTopFiles(scanId, treemapRootId, mode)
+        } catch {
+          return null
+        }
+      },
+
+      async fetchTypes() {
+        const { scanId, treemapRootId } = get()
+        if (scanId === null || treemapRootId === null) return null
+        try {
+          return await api.getTypeBreakdown(scanId, treemapRootId)
+        } catch {
+          return null
+        }
+      },
+
+      async fetchAges() {
+        const { scanId, treemapRootId } = get()
+        if (scanId === null || treemapRootId === null) return null
+        try {
+          return await api.getAgeBreakdown(scanId, treemapRootId)
+        } catch {
+          return null
+        }
+      },
+
+      async loadTypeIcons(typeKeys) {
+        if (typeKeys.length === 0) return {}
+        try {
+          return await api.getTypeIcons(typeKeys)
+        } catch {
+          return {}
+        }
+      },
+
+      async copyCsv(csv, rows) {
+        if (csv.length > MAX_CLIPBOARD_TEXT) {
+          set({ announcement: CSV_TOO_LARGE_MESSAGE })
+          return
+        }
+        try {
+          await api.copyText(csv)
+          set({ announcement: `Copied ${rows} ${rows === 1 ? 'row' : 'rows'}.` })
+        } catch (error) {
+          fail(error)
+        }
+      },
+
       setTreemapDepth(depth) {
         set({ treemapDepth: Math.max(0, Math.min(MAX_TREEMAP_DEPTH, Math.round(depth))) })
       },
@@ -799,6 +878,16 @@ export function createWorkspaceStore(api: StorageIQApi): WorkspaceStore {
         set({ treemapVisible: visible })
       },

+      setPaneTab(tab) {
+        set({ paneTab: tab, treemapVisible: true })
+      },
+
+      togglePane(tab) {
+        const { treemapVisible, paneTab } = get()
+        if (treemapVisible && paneTab === tab) set({ treemapVisible: false })
+        else set({ paneTab: tab, treemapVisible: true })
+      },
+
       dismissBanner() {
         set({ banner: null })
       },
```

- [ ] **Step 4: Run the store tests and the gates**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/renderer/src/stores; npm run typecheck:web; npm run lint"`
Expected: all PASS (101 tests in the dry run); clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/stores/workspace-store.ts src/renderer/src/stores/workspace-store-side-views.test.ts
git commit -m "feat(renderer): pane tab, side-view fetching and Copy as CSV in the workspace store"
```

---

### Task 5: The pane frame — tabs, shell, hook, Treemap refactor and the ribbon's Pane group

**Implementer tier:** Sonnet (edits five existing components and their tests; the code is complete, but a jsdom test may need a small adjustment).

**Files:**

- Create: `components/SideViewTabs.tsx`, `components/PaneShell.tsx`, `components/SideViewParts.tsx`, `components/PaneView.tsx`, `lib/use-pane-folder.ts`, `lib/use-side-view.ts`
- Modify: `components/TreemapPane.tsx`, `components/Ribbon.tsx`, `components/FileIcon.tsx`, `lib/icons.ts`, and `src/renderer/src/App.tsx`
- Test: `components/SideViewTabs.test.tsx` (new), `lib/use-side-view.test.tsx` (new), `components/Ribbon.test.tsx`

Paths are under `src/renderer/src/` except `src/renderer/src/App.tsx`, which is written in full.

**Interfaces:**

- Consumes: `PaneTab`, `setPaneTab`, `togglePane`, `fetch*` and `treemapVisible` from the store (Task 4); `useFocusgroupFallback(ref, 'tablist', itemsKey)`; `BUTTON_VARIANT_CLASSES`; `IconDismiss`; `LevelBar`; `TreemapLegend`.
- Produces:
  - `PANE_TABS: ReadonlyArray<{ id: PaneTab; label: string }>`, `PANE_PANEL_ID = 'pane-panel'`, `paneTabId(tab: PaneTab): string`, `SideViewTabs()` (a `tablist` named "Pane views", automatic activation, `aria-disabled` before a scan).
  - `PaneShell({ height, label, hideLabel?, actions?, children })`: the region (`aria-label={label}`), the header (tabs, "in **folder**", `actions`, hide button named `hideLabel`, default "Hide pane") and the `tabpanel` (`id=PANE_PANEL_ID`).
  - `ShareBar({ share })`, `ScanningNote()`, `PaneMessage({ children })`, `SideViewTable({ label, columns, children })`, `interface TableColumn { label: string; numeric?: boolean }`, `SIDE_ROW_CLASS`.
  - `usePaneFolderName(): string | null`; `useSideView<T>(fetch: () => Promise<T[] | null>, extraKey?: string): SideViewState<T>` with `SideViewState<T> = { status: 'loading' } | { status: 'ready'; rows: T[] } | { status: 'gone' }`.
  - `PaneView({ height })`: chooses the view from `paneTab` (Tasks 7 and 8 add the side views to its `switch`).
  - `FileIcon` takes `row: Pick<TreeRow, 'id' | 'kind' | 'name'>`; `icons.ts` exports `IconTopFiles`, `IconTypes`, `IconAge`.

- [ ] **Step 1: Write the failing tests**

```tsx
// @vitest-environment jsdom
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderWithStores } from '../test/render'
import { PANE_PANEL_ID, SideViewTabs } from './SideViewTabs'

const tabs = () => screen.getAllByRole('tab')

describe('<SideViewTabs />', () => {
  it('offers Treemap, Top files, Types and Age as tabs of one tab list', () => {
    renderWithStores(<SideViewTabs />)
    expect(screen.getByRole('tablist', { name: 'Pane views' })).toBeInTheDocument()
    expect(tabs().map((tab) => tab.textContent)).toEqual(['Treemap', 'Top files', 'Types', 'Age'])
    expect(tabs().map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ])
    for (const tab of tabs()) expect(tab).toHaveAttribute('aria-controls', PANE_PANEL_ID)
  })

  it('is disabled until a scan exists, and then a click shows that view', async () => {
    const user = userEvent.setup()
    const { workspace } = renderWithStores(<SideViewTabs />)
    for (const tab of tabs()) expect(tab).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('tab', { name: 'Types' }))
    expect(workspace.getState().paneTab).toBe('treemap')

    await act(() => workspace.getState().startScan('D:\\'))
    for (const tab of tabs()) expect(tab).not.toHaveAttribute('aria-disabled')
    await user.click(screen.getByRole('tab', { name: 'Types' }))
    expect(workspace.getState().paneTab).toBe('types')
    expect(screen.getByRole('tab', { name: 'Types' })).toHaveAttribute('aria-selected', 'true')
  })

  it('moves between the tabs with the arrow keys, Home and End, and shows each view', async () => {
    const user = userEvent.setup()
    const { workspace } = renderWithStores(<SideViewTabs />)
    await act(() => workspace.getState().startScan('D:\\'))
    screen.getByRole('tab', { name: 'Treemap' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Top files' })).toHaveFocus()
    expect(workspace.getState().paneTab).toBe('top')
    await user.keyboard('{End}')
    expect(workspace.getState().paneTab).toBe('age')
    await user.keyboard('{ArrowRight}')
    expect(workspace.getState().paneTab).toBe('treemap')
    await user.keyboard('{ArrowLeft}')
    expect(workspace.getState().paneTab).toBe('age')
    await user.keyboard('{Home}')
    expect(workspace.getState().paneTab).toBe('treemap')
  })

  it('has one tab stop: only the selected tab is in the Tab order', async () => {
    const { workspace } = renderWithStores(<SideViewTabs />)
    await act(() => workspace.getState().startScan('D:\\'))
    act(() => workspace.getState().setPaneTab('types'))
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, -1, 0, -1])
  })
})
```

```tsx
// @vitest-environment jsdom
import { act, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithStores } from '../test/render'
import { useSideView } from './use-side-view'

function Probe({
  fetch,
  extraKey = '',
}: {
  fetch: () => Promise<string[] | null>
  extraKey?: string
}) {
  const state = useSideView(fetch, extraKey)
  return <p data-testid="state">{state.status === 'ready' ? state.rows.join(',') : state.status}</p>
}

const shown = () => screen.getByTestId('state').textContent

describe('useSideView', () => {
  it('stays loading before a scan, then shows the rows of the answer', async () => {
    const fetch = vi.fn(async () => ['a', 'b'])
    const { workspace } = renderWithStores(<Probe fetch={fetch} />)
    expect(shown()).toBe('loading')
    expect(fetch).not.toHaveBeenCalled()
    await act(() => workspace.getState().startScan('D:\\'))
    await waitFor(() => expect(shown()).toBe('a,b'))
  })

  it('shows "gone" when the answer is null', async () => {
    const { workspace } = renderWithStores(<Probe fetch={async () => null} />)
    await act(() => workspace.getState().startScan('D:\\'))
    await waitFor(() => expect(shown()).toBe('gone'))
  })

  it('asks again when the folder or the tree revision changes', async () => {
    const fetch = vi.fn(async () => ['a'])
    const { workspace } = renderWithStores(<Probe fetch={fetch} />)
    await act(() => workspace.getState().startScan('D:\\'))
    await waitFor(() => expect(shown()).toBe('a'))
    const calls = fetch.mock.calls.length
    act(() => workspace.getState().select('d1'))
    await waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThan(calls))
    const afterFolder = fetch.mock.calls.length
    act(() => workspace.setState({ revision: workspace.getState().revision + 1 }))
    await waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThan(afterFolder))
  })

  it('keeps the previous rows while the next answer is on its way, and drops a stale answer', async () => {
    let release: (rows: string[]) => void = () => undefined
    const fetch = vi
      .fn<() => Promise<string[] | null>>()
      .mockResolvedValueOnce(['first'])
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve
          }),
      )
      .mockResolvedValue(['third'])
    const { workspace } = renderWithStores(<Probe fetch={fetch} />)
    await act(() => workspace.getState().startScan('D:\\'))
    await waitFor(() => expect(shown()).toBe('first'))
    act(() => workspace.getState().select('d1')) // the second answer is pending...
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(shown()).toBe('first')
    act(() => workspace.getState().select('d2')) // ...and a third one supersedes it
    await waitFor(() => expect(shown()).toBe('third'))
    await act(async () => release(['stale']))
    expect(shown()).toBe('third')
  })
})
```

```diff
--- a/src/renderer/src/components/Ribbon.test.tsx
+++ b/src/renderer/src/components/Ribbon.test.tsx
@@ -158,6 +158,33 @@ describe('<Ribbon />', () => {
     expect(workspace.getState().treemapVisible).toBe(false)
   })

+  it('the View tab has a Pane group with one toggle per bottom-pane view', async () => {
+    const user = userEvent.setup()
+    const { workspace } = renderRibbon()
+    await user.click(screen.getByRole('tab', { name: 'View' }))
+    const group = within(toolbar()).getByRole('group', { name: 'Pane' })
+    const buttons = within(group).getAllByRole('button')
+    expect(buttons.map((button) => button.textContent)).toEqual([
+      'Treemap',
+      'Top files',
+      'Types',
+      'Age',
+    ])
+    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual([
+      'true',
+      'false',
+      'false',
+      'false',
+    ])
+    await user.click(command('Types'))
+    expect(workspace.getState()).toMatchObject({ paneTab: 'types', treemapVisible: true })
+    expect(command('Types')).toHaveAttribute('aria-pressed', 'true')
+    expect(command('Treemap')).toHaveAttribute('aria-pressed', 'false')
+    await user.click(command('Types'))
+    expect(workspace.getState().treemapVisible).toBe(false)
+    expect(command('Types')).toHaveAttribute('aria-pressed', 'false')
+  })
+
   it('the Options tab shows the Application group', async () => {
     const user = userEvent.setup()
     renderRibbon()
```

- [ ] **Step 2: Run them to verify they fail**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/renderer/src/components/SideViewTabs.test.tsx src/renderer/src/lib/use-side-view.test.tsx src/renderer/src/components/Ribbon.test.tsx"`
Expected: FAIL (modules not found; the ribbon has no "Pane" group).

- [ ] **Step 3: Create the new files**

`src/renderer/src/lib/use-pane-folder.ts`:

```ts
import { rowName } from './format'
import { useWorkspace } from '../stores/workspace-store-context'

/** The name of the folder the bottom pane describes (the treemap folder), once its row is loaded. */
export function usePaneFolderName(): string | null {
  const treemapRootId = useWorkspace((s) => s.treemapRootId)
  const lists = useWorkspace((s) => s.lists)
  if (treemapRootId === null) return null
  const row =
    lists[treemapRootId]?.parent ??
    Object.values(lists)
      .flatMap((list) => Object.values(list.chunks).flatMap((chunk) => chunk.rows))
      .find((candidate) => candidate.id === treemapRootId) ??
    null
  return row === null ? null : rowName(row)
}
```

`src/renderer/src/lib/use-side-view.ts`:

```ts
import { useEffect, useState } from 'react'
import { useWorkspace } from '../stores/workspace-store-context'

/** What a side view has: nothing yet, the rows, or "that folder no longer exists". */
export type SideViewState<T> =
  { status: 'loading' } | { status: 'ready'; rows: T[] } | { status: 'gone' }

/**
 * Loads a side view for the treemap folder of the current scan, and again whenever the folder,
 * the scan or the tree revision (throttled while a scan runs, like the treemap) changes, or
 * `extraKey` does (the Mode, for Top files). The rows of the previous answer stay on screen until
 * the new one arrives, and an answer that is no longer the newest is dropped.
 */
export function useSideView<T>(fetch: () => Promise<T[] | null>, extraKey = ''): SideViewState<T> {
  const scanId = useWorkspace((s) => s.scanId)
  const treemapRootId = useWorkspace((s) => s.treemapRootId)
  const revision = useWorkspace((s) => s.revision)
  const [state, setState] = useState<SideViewState<T>>({ status: 'loading' })

  useEffect(() => {
    if (scanId === null || treemapRootId === null) {
      setState({ status: 'loading' })
      return
    }
    let current = true
    void fetch().then((rows) => {
      if (current) setState(rows === null ? { status: 'gone' } : { status: 'ready', rows })
    })
    return () => {
      current = false
    }
  }, [scanId, treemapRootId, revision, extraKey, fetch])

  return state
}
```

`src/renderer/src/components/SideViewTabs.tsx`:

```tsx
import { useRef } from 'react'
import { useFocusgroupFallback } from '../lib/use-focusgroup'
import type { PaneTab } from '../stores/workspace-store'
import { useWorkspace } from '../stores/workspace-store-context'

export const PANE_TABS: ReadonlyArray<{ id: PaneTab; label: string }> = [
  { id: 'treemap', label: 'Treemap' },
  { id: 'top', label: 'Top files' },
  { id: 'types', label: 'Types' },
  { id: 'age', label: 'Age' },
]

/** The one tab panel of the bottom pane: whichever view is shown. */
export const PANE_PANEL_ID = 'pane-panel'

export function paneTabId(tab: PaneTab): string {
  return `pane-tab-${tab}`
}

/**
 * The tabs of the bottom pane (WAI-ARIA tabs, modern-web-guidance "tabs"): one tab stop, arrow
 * keys move between the tabs and show each view at once, Home and End jump to the ends. Before a
 * scan the tabs are `aria-disabled`: they stay reachable and ignore clicks, like the ribbon's
 * disabled commands.
 */
export function SideViewTabs() {
  const paneTab = useWorkspace((s) => s.paneTab)
  const hasScan = useWorkspace((s) => s.scanId !== null)
  const setPaneTab = useWorkspace((s) => s.setPaneTab)
  const ref = useRef<HTMLDivElement>(null)
  useFocusgroupFallback(ref, 'tablist', paneTab)
  return (
    <div
      ref={ref}
      role="tablist"
      aria-label="Pane views"
      focusgroup="tablist nomemory"
      className="flex items-end gap-0.5"
    >
      {PANE_TABS.map((tab) => (
        <button
          key={tab.id}
          id={paneTabId(tab.id)}
          type="button"
          role="tab"
          aria-selected={paneTab === tab.id}
          aria-controls={PANE_PANEL_ID}
          aria-disabled={hasScan ? undefined : 'true'}
          onClick={() => {
            if (hasScan) setPaneTab(tab.id)
          }}
          onFocus={() => {
            if (hasScan) setPaneTab(tab.id)
          }}
          className="relative min-h-6 rounded-control px-2.5 text-[13px] leading-[18px] font-medium text-ink-muted transition-colors duration-[120ms] after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-[1px] after:bg-accent after:opacity-0 hover:bg-row-hover hover:text-ink aria-disabled:cursor-default aria-disabled:text-ink-subtle aria-disabled:hover:bg-transparent aria-disabled:hover:text-ink-subtle aria-selected:font-semibold aria-selected:text-ink aria-selected:after:opacity-100 forced-colors:aria-selected:underline forced-colors:aria-selected:decoration-2 forced-colors:aria-selected:decoration-[Highlight] forced-colors:aria-selected:underline-offset-4"
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
```

`src/renderer/src/components/PaneShell.tsx`:

```tsx
import type { ReactNode } from 'react'
import { IconDismiss } from '../lib/icons'
import { usePaneFolderName } from '../lib/use-pane-folder'
import { useWorkspace } from '../stores/workspace-store-context'
import { BUTTON_VARIANT_CLASSES } from './Button'
import { PANE_PANEL_ID, paneTabId, SideViewTabs } from './SideViewTabs'

/**
 * The frame every view of the bottom pane shares: a region named after the view, a header with
 * the tabs, the folder the view describes, the view's own actions and the hide button, and the
 * tab panel that holds the view.
 */
export function PaneShell({
  height,
  label,
  hideLabel = 'Hide pane',
  actions,
  children,
}: {
  height: number
  /** The region's name: the view's name. */
  label: string
  hideLabel?: string
  /** Buttons of the view, left of the hide button (for example "Copy as CSV"). */
  actions?: ReactNode
  children: ReactNode
}) {
  const paneTab = useWorkspace((s) => s.paneTab)
  const setTreemapVisible = useWorkspace((s) => s.setTreemapVisible)
  const folderName = usePaneFolderName()
  return (
    <section
      aria-label={label}
      className="flex shrink-0 flex-col border-t border-line bg-panel"
      style={{ height }}
    >
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 px-3 text-[13px] leading-[18px]">
        <div className="flex min-w-0 items-center gap-3">
          <SideViewTabs />
          {folderName !== null && (
            <span className="min-w-0 truncate text-ink-muted">
              in{' '}
              <strong className="text-[15px] leading-5 font-semibold text-ink">{folderName}</strong>
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          <button
            type="button"
            aria-label={hideLabel}
            title={hideLabel}
            onClick={() => setTreemapVisible(false)}
            className={`flex size-6 items-center justify-center rounded-control ${BUTTON_VARIANT_CLASSES.quiet} transition-colors duration-[120ms]`}
          >
            <IconDismiss aria-hidden="true" focusable={false} />
          </button>
        </div>
      </div>
      <div
        role="tabpanel"
        id={PANE_PANEL_ID}
        aria-labelledby={paneTabId(paneTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        {children}
      </div>
    </section>
  )
}
```

`src/renderer/src/components/SideViewParts.tsx`:

```tsx
import type { ReactNode } from 'react'
import { formatShare } from '../lib/format'
import { useWorkspace } from '../stores/workspace-store-context'

/** Row height of the side-view tables (the same as the folder tree's rows). */
export const SIDE_ROW_CLASS = 'h-[30px]'

/** A bar and the share as text, like the tree's "% of Parent" cell; the text is the accessible value. */
export function ShareBar({ share }: { share: number }) {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="h-1.5 w-12 shrink-0 overflow-hidden rounded-pill bg-bar-track"
      >
        <span
          className="block h-full rounded-pill bg-bar-fill forced-colors:bg-[Highlight]"
          style={{ width: `${Math.min(1, share) * 100}%` }}
        />
      </span>
      <span className="flex-1 text-right">{formatShare(share)}</span>
    </span>
  )
}

/** A line above the list while the scan is still running: the rows are what was found so far. */
export function ScanningNote() {
  const scanning = useWorkspace((s) => s.phase === 'scanning')
  if (!scanning) return null
  return (
    <p className="shrink-0 px-3 pb-1 text-xs leading-4 text-ink-muted">
      Scanning… These are the results so far.
    </p>
  )
}

/** A calm one-line message in the body of a view. */
export function PaneMessage({ children }: { children: ReactNode }) {
  return <p className="px-4 py-3 text-ink-muted">{children}</p>
}

export interface TableColumn {
  label: string
  numeric?: boolean
}

/**
 * A short table (Types and Age): a `grid` with column headers, in a focusable scroll area so the
 * keyboard can scroll it. The header stays in view while the rows scroll.
 */
export function SideViewTable({
  label,
  columns,
  children,
}: {
  label: string
  columns: TableColumn[]
  children: ReactNode
}) {
  return (
    <div tabIndex={0} className="min-h-0 flex-1 overflow-auto focus-visible:outline-offset-[-2px]">
      <table
        role="grid"
        aria-label={label}
        className="w-full border-collapse text-[13px] leading-[18px] tabular-nums"
      >
        <thead className="sticky top-0 bg-panel">
          <tr>
            {columns.map((column) => (
              <th
                key={column.label}
                scope="col"
                className={`h-(--size-header-row) border-b border-line px-3 font-medium text-ink-muted ${column.numeric ? 'text-right' : 'text-left'}`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}
```

`src/renderer/src/components/PaneView.tsx` (this is the Task 5 version; until Tasks 7 and 8 every tab shows the treemap):

```tsx
import { useWorkspace } from '../stores/workspace-store-context'
import { TreemapPane } from './TreemapPane'

/** The view the bottom pane shows: the treemap or one of the side views. */
export function PaneView({ height }: { height: number }) {
  const paneTab = useWorkspace((s) => s.paneTab)
  switch (paneTab) {
    case 'treemap':
    default:
      return <TreemapPane height={height} />
  }
}
```

- [ ] **Step 4: Edit the existing files**

The treemap now sits in the shared frame (its header, hide button and region come from `PaneShell`; its own fetch and drawing code is unchanged):

```diff
--- a/src/renderer/src/components/TreemapPane.tsx
+++ b/src/renderer/src/components/TreemapPane.tsx
@@ -1,11 +1,10 @@
 import { type MouseEvent, useEffect, useRef, useState } from 'react'
 import type { SizeMode, TreemapLayout } from '@shared/tree-types'
-import { rowName } from '../lib/format'
-import { IconDismiss } from '../lib/icons'
 import { drawTreemap, hitTest, readTreemapColors } from '../lib/treemap-draw'
+import { usePaneFolderName } from '../lib/use-pane-folder'
 import { useWorkspace } from '../stores/workspace-store-context'
-import { BUTTON_VARIANT_CLASSES } from './Button'
 import { LevelBar } from './LevelBar'
+import { PaneShell } from './PaneShell'
 import { TreemapLegend } from './TreemapLegend'

 interface Size {
@@ -34,11 +33,9 @@ export function TreemapPane({ height }: { height: number }) {
   const depth = useWorkspace((s) => s.treemapDepth)
   const revision = useWorkspace((s) => s.revision)
   const selectedId = useWorkspace((s) => s.selectedId)
-  const lists = useWorkspace((s) => s.lists)
   const fetchTreemap = useWorkspace((s) => s.fetchTreemap)
   const reveal = useWorkspace((s) => s.reveal)
   const drillInto = useWorkspace((s) => s.drillInto)
-  const setTreemapVisible = useWorkspace((s) => s.setTreemapVisible)

   const wrapperRef = useRef<HTMLDivElement>(null)
   const canvasRef = useRef<HTMLCanvasElement>(null)
@@ -139,44 +136,11 @@ export function TreemapPane({ height }: { height: number }) {
   const clickable =
     shown !== null && shown.scanId === scanId && shown.layout.nodeId === treemapRootId

-  const rootRow =
-    treemapRootId === null
-      ? null
-      : (lists[treemapRootId]?.parent ??
-        Object.values(lists)
-          .flatMap((list) => Object.values(list.chunks).flatMap((chunk) => chunk.rows))
-          .find((row) => row.id === treemapRootId) ??
-        null)
-  const folderName = rootRow === null ? null : rowName(rootRow)
+  const folderName = usePaneFolderName()
   const title = folderName === null ? 'Treemap' : `Treemap of ${folderName}`

   return (
-    <section
-      aria-label="Treemap"
-      className="flex shrink-0 flex-col border-t border-line bg-panel"
-      style={{ height }}
-    >
-      <div className="flex h-7 shrink-0 items-center justify-between gap-2 px-3 text-[13px] leading-[18px]">
-        <span className="min-w-0 truncate text-ink-muted">
-          {folderName === null ? (
-            'Treemap'
-          ) : (
-            <>
-              Treemap of{' '}
-              <strong className="text-[15px] leading-5 font-semibold text-ink">{folderName}</strong>
-            </>
-          )}
-        </span>
-        <button
-          type="button"
-          aria-label="Hide treemap"
-          title="Hide treemap"
-          onClick={() => setTreemapVisible(false)}
-          className={`flex size-6 items-center justify-center rounded-control ${BUTTON_VARIANT_CLASSES.quiet} transition-colors duration-[120ms]`}
-        >
-          <IconDismiss aria-hidden="true" focusable={false} />
-        </button>
-      </div>
+    <PaneShell height={height} label="Treemap" hideLabel="Hide treemap">
       <div ref={wrapperRef} className="relative min-h-0 flex-1 bg-(--treemap-edge)">
         {failed && (
           <p
@@ -210,6 +174,6 @@ export function TreemapPane({ height }: { height: number }) {
       </div>
       <TreemapLegend layout={clickable ? layout : null} />
       <LevelBar />
-    </section>
+    </PaneShell>
   )
 }
```

`App` renders `PaneView` in place of `TreemapPane`:

```diff
--- a/src/renderer/src/App.tsx
+++ b/src/renderer/src/App.tsx
@@ -6,7 +6,7 @@ import { Ribbon } from './components/Ribbon'
 import { Splitter } from './components/Splitter'
 import { StatusBar } from './components/StatusBar'
 import { TreeGrid } from './components/TreeGrid'
-import { TreemapPane } from './components/TreemapPane'
+import { PaneView } from './components/PaneView'
 import { UpdateBanner } from './components/UpdateBanner'
 import { WhatsNewDialog } from './components/WhatsNewDialog'
 import { useAppStore } from './stores/app-store-context'
@@ -79,7 +79,7 @@ export function App() {
               max={treemapMax}
               onChange={setTreemapHeight}
             />
-            <TreemapPane height={shownHeight} />
+            <PaneView height={shownHeight} />
           </>
         )}
       </main>
```

`FileIcon` accepts the three fields it uses, so a Top files row can pass a plain object:

```diff
--- a/src/renderer/src/components/FileIcon.tsx
+++ b/src/renderer/src/components/FileIcon.tsx
@@ -16,7 +16,13 @@ const isDriveName = (name: string): boolean => /^[A-Za-z]:\\?$/.test(name)
  * decoration: the row's accessible name is its file name. "[N files]" rows only ever show the
  * placeholder.
  */
-export function FileIcon({ row, root }: { row: TreeRow; root: boolean }) {
+export function FileIcon({
+  row,
+  root,
+}: {
+  row: Pick<TreeRow, 'id' | 'kind' | 'name'>
+  root: boolean
+}) {
   const cache = useIconCache()
   const image = useRowIcon(row.kind === 'files' ? '' : row.id)
   const className = 'size-4 shrink-0 text-ink-muted'
```

Three Fluent icons for the Pane buttons (checked to exist in `@fluentui/react-icons` 2.0.345):

```diff
--- a/src/renderer/src/lib/icons.ts
+++ b/src/renderer/src/lib/icons.ts
@@ -2,6 +2,7 @@ import {
   ArrowCircleDown24Regular,
   ArrowSync24Color,
   Bug24Regular,
+  CalendarClock24Regular,
   CheckmarkCircle16Color,
   ChevronDown12Regular,
   ChevronRight16Regular,
@@ -13,6 +14,7 @@ import {
   Delete24Regular,
   Dismiss16Regular,
   Document16Regular,
+  DocumentBulletList24Regular,
   DocumentMultiple16Regular,
   DocumentMultiple24Regular,
   DocumentText20Color,
@@ -33,6 +35,7 @@ import {
   SignOut24Regular,
   Sparkle24Regular,
   Stop24Regular,
+  TagMultiple24Regular,
   TextBulletListTree24Regular,
   Usb20Regular,
   Warning16Color,
@@ -98,6 +101,9 @@ export const IconReportProblem = Bug24Regular
 export const IconCheckUpdates = ArrowCircleDown24Regular
 export const IconWhatsNew = Sparkle24Regular
 export const IconTreemap = DataTreemap24Regular
+export const IconTopFiles = DocumentBulletList24Regular
+export const IconTypes = TagMultiple24Regular
+export const IconAge = CalendarClock24Regular

 // Menus (20)
 export const IconDrive = HardDrive20Regular
```

The View tab's "Treemap" group becomes the "Pane" group:

```diff
--- a/src/renderer/src/components/Ribbon.tsx
+++ b/src/renderer/src/components/Ribbon.tsx
@@ -4,6 +4,7 @@ import { SIZE_UNITS, type SizeUnit } from '../lib/format'
 import {
   type FluentIcon,
   IconAbout,
+  IconAge,
   IconCheckUpdates,
   IconChevronDown,
   IconDelete,
@@ -19,11 +20,13 @@ import {
   IconRefresh,
   IconReportProblem,
   IconStop,
+  IconTopFiles,
   IconTreemap,
+  IconTypes,
   IconWhatsNew,
 } from '../lib/icons'
 import { useFocusgroupFallback } from '../lib/use-focusgroup'
-import { EXPAND_ALL_LEVELS } from '../stores/workspace-store'
+import { EXPAND_ALL_LEVELS, type PaneTab } from '../stores/workspace-store'
 import { useWorkspace } from '../stores/workspace-store-context'
 import { MenuButton } from './MenuButton'
 import { OptionsGroup } from './OptionsGroup'
@@ -69,6 +72,28 @@ const MODES: Array<{ mode: SizeMode; label: string; icon: FluentIcon; title: str
   },
 ]

+const PANE_BUTTONS: Array<{ tab: PaneTab; label: string; icon: FluentIcon; title: string }> = [
+  { tab: 'treemap', label: 'Treemap', icon: IconTreemap, title: 'Show or hide the treemap' },
+  {
+    tab: 'top',
+    label: 'Top files',
+    icon: IconTopFiles,
+    title: 'Show or hide the largest files in the selected folder',
+  },
+  {
+    tab: 'types',
+    label: 'Types',
+    icon: IconTypes,
+    title: 'Show or hide the space each file type uses in the selected folder',
+  },
+  {
+    tab: 'age',
+    label: 'Age',
+    icon: IconAge,
+    title: 'Show or hide the space used by files of each age in the selected folder',
+  },
+]
+
 const UNIT_LABELS: Record<SizeUnit, string> = { auto: 'Auto', gb: 'GB', mb: 'MB', kb: 'KB' }

 /** The window's command ribbon: tabs File, Home, Scan, View, Options and Help over a toolbar of groups. */
@@ -87,6 +112,7 @@ export function Ribbon({ onAbout }: { onAbout(): void }) {
   const mode = useWorkspace((s) => s.mode)
   const unit = useWorkspace((s) => s.unit)
   const treemapVisible = useWorkspace((s) => s.treemapVisible)
+  const paneTab = useWorkspace((s) => s.paneTab)
   const stopScan = useWorkspace((s) => s.stopScan)
   const rescan = useWorkspace((s) => s.rescan)
   const setMode = useWorkspace((s) => s.setMode)
@@ -95,7 +121,7 @@ export function Ribbon({ onAbout }: { onAbout(): void }) {
   const openInExplorer = useWorkspace((s) => s.openInExplorer)
   const createFolder = useWorkspace((s) => s.createFolder)
   const deleteSelection = useWorkspace((s) => s.deleteSelection)
-  const setTreemapVisible = useWorkspace((s) => s.setTreemapVisible)
+  const togglePane = useWorkspace((s) => s.togglePane)
   const quit = useWorkspace((s) => s.quit)
   const checkForUpdates = useWorkspace((s) => s.checkForUpdates)
   const openLink = useWorkspace((s) => s.openLink)
@@ -320,14 +346,17 @@ export function Ribbon({ onAbout }: { onAbout(): void }) {
       <>
         {modeGroup}
         {unitGroup}
-        <Group label="Treemap">
-          <RibbonButton
-            label="Treemap"
-            icon={IconTreemap}
-            pressed={treemapVisible}
-            title="Show or hide the treemap"
-            onClick={() => setTreemapVisible(!treemapVisible)}
-          />
+        <Group label="Pane">
+          {PANE_BUTTONS.map((entry) => (
+            <RibbonButton
+              key={entry.tab}
+              label={entry.label}
+              icon={entry.icon}
+              pressed={treemapVisible && paneTab === entry.tab}
+              title={entry.title}
+              onClick={() => togglePane(entry.tab)}
+            />
+          ))}
         </Group>
       </>
     ),
```

- [ ] **Step 5: Format, run the renderer tests and the gates**

Run: `powershell.exe -NoProfile -Command "npx prettier --write src e2e; npx vitest run src/renderer; npm run typecheck:web; npm run lint"`
Expected: all renderer tests PASS (the existing `TreemapPane`, `App` and `Ribbon` tests are unchanged and still pass: the Treemap region, "Hide treemap", "Resize treemap" and the ribbon's "Treemap" button keep their names); clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/SideViewTabs.tsx src/renderer/src/components/SideViewTabs.test.tsx src/renderer/src/components/PaneShell.tsx src/renderer/src/components/SideViewParts.tsx src/renderer/src/components/PaneView.tsx src/renderer/src/lib/use-pane-folder.ts src/renderer/src/lib/use-side-view.ts src/renderer/src/lib/use-side-view.test.tsx src/renderer/src/components/TreemapPane.tsx src/renderer/src/components/Ribbon.tsx src/renderer/src/components/Ribbon.test.tsx src/renderer/src/App.tsx src/renderer/src/components/FileIcon.tsx src/renderer/src/lib/icons.ts
git commit -m "feat(renderer): bottom pane tabs, shared pane frame and the ribbon's Pane group"
```

---

### Task 6: CSV text, type labels and the Copy as CSV button

**Implementer tier:** Haiku (all code and tests are in the plan).

**Files:**

- Create: `src/renderer/src/lib/csv.ts`, `src/renderer/src/lib/side-view-model.ts`, `src/renderer/src/components/CopyCsvButton.tsx`
- Test: `src/renderer/src/lib/csv.test.ts`, `src/renderer/src/lib/side-view-model.test.ts`, `src/renderer/src/components/CopyCsvButton.test.tsx`

**Interfaces:**

- Consumes: `TopFileRow`, `TypeRow`, `AgeRow`, `FileCategory` (Task 1); `CATEGORY_LABELS` from `@shared/file-category`; `copyCsv(csv, rows)` and `CSV_TOO_LARGE_MESSAGE` (Task 4); `BUTTON_VARIANT_CLASSES`.
- Produces:
  - `csv.ts`: `csvField(value: string | number): string`, `toCsv(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number>>): string` (CRLF lines, final CRLF), `isoDate(ms: number): string` (`''` for 0), `topFilesCsv(rows: readonly TopFileRow[]): string`, `typesCsv(rows: readonly TypeRow[]): string`, `ageCsv(rows: readonly AgeRow[]): string`.
  - `side-view-model.ts`: `NO_EXTENSION_LABEL`, `OTHER_EXTENSIONS_LABEL`, `MAX_TYPE_ICON_KEYS = 64`, `typeLabel(row): string` (`.jpg` / `(no extension)` / `Other extensions`), `typeCategoryLabel(row): string` (`''` when `category` is null), `typeIconKey(row): string | null` (`ext:jpg`, `file`, or null), `typeIconKeys(rows): string[]` (unique, at most 64), `totalSize(rows): number`.
  - `CopyCsvButton({ build, rows }: { build(): string; rows: number })`: a button named "Copy as CSV"; `aria-disabled` and inert when `rows === 0`; on click `copyCsv(build(), rows)`.

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/lib/csv.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ageCsv, csvField, isoDate, toCsv, topFilesCsv, typesCsv } from './csv'
import { TEST_AGE, TEST_TOP_FILES, TEST_TYPES } from '../test/fake-api'

describe('csvField', () => {
  it('leaves plain text and numbers alone', () => {
    expect(csvField('movie.mp4')).toBe('movie.mp4')
    expect(csvField(1536)).toBe('1536')
    expect(csvField('')).toBe('')
  })

  it('quotes a field with a comma, a quote or a line break, and doubles the quotes', () => {
    expect(csvField('holiday, 2025.jpg')).toBe('"holiday, 2025.jpg"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('a\nb')).toBe('"a\nb"')
    expect(csvField('a\r\nb')).toBe('"a\r\nb"')
  })
})

describe('toCsv', () => {
  it('writes a header and one CRLF-terminated line per row', () => {
    expect(toCsv(['A', 'B'], [['x', 1]])).toBe('A,B\r\nx,1\r\n')
    expect(toCsv(['A'], [])).toBe('A\r\n')
  })
})

describe('isoDate', () => {
  it('is ISO 8601 in UTC, and empty for an unknown date', () => {
    expect(isoDate(Date.UTC(2026, 10, 19, 12))).toBe('2026-11-19T12:00:00.000Z')
    expect(isoDate(0)).toBe('')
  })
})

describe('the list CSVs', () => {
  it('Top files: name, folder, raw bytes and ISO dates', () => {
    expect(topFilesCsv(TEST_TOP_FILES)).toBe(
      [
        'Name,Folder,Size (bytes),Allocated (bytes),Modified (UTC)',
        'movie.mp4,D:\\Videos,536870912,536870912,2026-11-19T12:00:00.000Z',
        '"holiday, 2025.jpg",D:\\Photos,12582912,12587008,2024-06-01T12:00:00.000Z',
        '',
      ].join('\r\n'),
    )
  })

  it('Types: the extension as shown, the file type and raw numbers', () => {
    expect(typesCsv(TEST_TYPES)).toBe(
      [
        'Extension,Category,Size (bytes),Allocated (bytes),Files',
        '.mp4,Video,2147483648,2147483648,10',
        '.jpg,Images,805306368,813694976,1000',
        '(no extension),Other,268435456,268435456,3',
        '',
      ].join('\r\n'),
    )
  })

  it('Types: the "Other extensions" row has no category', () => {
    const csv = typesCsv([
      { kind: 'other', ext: '', category: null, size: 5, allocated: 4096, files: 2 },
    ])
    expect(csv.split('\r\n')[1]).toBe('Other extensions,,5,4096,2')
  })

  it('Age: all 8 buckets', () => {
    const lines = ageCsv(TEST_AGE).split('\r\n')
    expect(lines[0]).toBe('Age,Size (bytes),Allocated (bytes),Files')
    expect(lines).toHaveLength(1 + 8 + 1)
    expect(lines[1]).toBe('Last 30 days,2147483648,2147483648,10')
    expect(lines[2]).toBe('1–3 months,0,0,0')
    expect(lines[8]).toBe('Unknown date,268435456,268435456,3')
  })
})
```

`src/renderer/src/lib/side-view-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  MAX_TYPE_ICON_KEYS,
  totalSize,
  typeCategoryLabel,
  typeIconKey,
  typeIconKeys,
  typeLabel,
} from './side-view-model'

const ext = (name: string) => ({ kind: 'extension' as const, ext: name })

describe('typeLabel and typeCategoryLabel', () => {
  it('name the three kinds of row', () => {
    expect(typeLabel(ext('jpg'))).toBe('.jpg')
    expect(typeLabel({ kind: 'none', ext: '' })).toBe('(no extension)')
    expect(typeLabel({ kind: 'other', ext: '' })).toBe('Other extensions')
    expect(typeCategoryLabel({ category: 'video' })).toBe('Video')
    expect(typeCategoryLabel({ category: null })).toBe('')
  })
})

describe('typeIconKey', () => {
  it('is ext:<extension> for a normal extension and file for files without one', () => {
    expect(typeIconKey(ext('jpg'))).toBe('ext:jpg')
    expect(typeIconKey({ kind: 'none', ext: '' })).toBe('file')
  })

  it('is null for the "other" row and for an extension main would refuse', () => {
    expect(typeIconKey({ kind: 'other', ext: '' })).toBeNull()
    expect(typeIconKey(ext('a'.repeat(17)))).toBeNull()
    expect(typeIconKey(ext('a b'))).toBeNull()
    expect(typeIconKey(ext('é'))).toBeNull()
  })
})

describe('typeIconKeys', () => {
  it('lists each key once, skips rows without one and stops at 64', () => {
    expect(
      typeIconKeys([ext('jpg'), ext('jpg'), ext('bad ext'), { kind: 'none', ext: '' }]),
    ).toEqual(['ext:jpg', 'file'])
    const many = Array.from({ length: 100 }, (_, i) => ext(`e${i}`))
    expect(typeIconKeys(many)).toHaveLength(MAX_TYPE_ICON_KEYS)
  })
})

describe('totalSize', () => {
  it('adds the sizes', () => {
    expect(totalSize([{ size: 1 }, { size: 2 }, { size: 4 }])).toBe(7)
    expect(totalSize([])).toBe(0)
  })
})
```

`src/renderer/src/components/CopyCsvButton.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { MAX_CLIPBOARD_TEXT } from '@shared/ipc-contract'
import { CSV_TOO_LARGE_MESSAGE } from '../stores/workspace-store'
import { renderWithStores } from '../test/render'
import { CopyCsvButton } from './CopyCsvButton'

const copyButton = () => screen.getByRole('button', { name: 'Copy as CSV' })

describe('<CopyCsvButton />', () => {
  it('builds the CSV when pressed, sends it through main and announces the row count', async () => {
    const user = userEvent.setup()
    const { api, workspace } = renderWithStores(
      <CopyCsvButton build={() => 'Name\r\na\r\nb\r\n'} rows={2} />,
    )
    await act(() => workspace.getState().startScan('D:\\'))
    await user.click(copyButton())
    expect(api.copyText).toHaveBeenCalledWith('Name\r\na\r\nb\r\n')
    await waitFor(() => expect(workspace.getState().announcement).toBe('Copied 2 rows.'))
  })

  it('does nothing while the list is empty, and stays reachable', async () => {
    const user = userEvent.setup()
    const { api } = renderWithStores(<CopyCsvButton build={() => 'Name\r\n'} rows={0} />)
    expect(copyButton()).toHaveAttribute('aria-disabled', 'true')
    await user.click(copyButton())
    expect(api.copyText).not.toHaveBeenCalled()
  })

  it('says "Too many rows to copy." instead of sending more than the limit', async () => {
    const user = userEvent.setup()
    const { api, workspace } = renderWithStores(
      <CopyCsvButton build={() => 'x'.repeat(MAX_CLIPBOARD_TEXT + 1)} rows={5000} />,
    )
    await user.click(copyButton())
    expect(api.copyText).not.toHaveBeenCalled()
    expect(workspace.getState().announcement).toBe(CSV_TOO_LARGE_MESSAGE)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/renderer/src/lib/csv.test.ts src/renderer/src/lib/side-view-model.test.ts src/renderer/src/components/CopyCsvButton.test.tsx"`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write the implementation**

`src/renderer/src/lib/side-view-model.ts`:

```ts
import { CATEGORY_LABELS } from '@shared/file-category'
import type { TypeRow } from '@shared/tree-types'

export const NO_EXTENSION_LABEL = '(no extension)'
export const OTHER_EXTENSIONS_LABEL = 'Other extensions'

/** Most icon keys one `icons:for-types` call takes (the same limit as main). */
export const MAX_TYPE_ICON_KEYS = 64
/** The extension part of an icon key that main accepts (main's `ICON_TYPE_KEY_PATTERN`). */
const ICON_EXTENSION = /^[a-z0-9_$~-]{1,16}$/

/** The text of a Types row: `.jpg`, `(no extension)` or `Other extensions`. */
export function typeLabel(row: Pick<TypeRow, 'kind' | 'ext'>): string {
  if (row.kind === 'none') return NO_EXTENSION_LABEL
  if (row.kind === 'other') return OTHER_EXTENSIONS_LABEL
  return `.${row.ext}`
}

/** The file type name of a Types row; `''` for the "Other extensions" row. */
export function typeCategoryLabel(row: Pick<TypeRow, 'category'>): string {
  return row.category === null ? '' : CATEGORY_LABELS[row.category]
}

/** The icon key of a Types row (`ext:jpg`, `file`), or null when it has no icon to ask for. */
export function typeIconKey(row: Pick<TypeRow, 'kind' | 'ext'>): string | null {
  if (row.kind === 'none') return 'file'
  if (row.kind === 'extension' && ICON_EXTENSION.test(row.ext)) return `ext:${row.ext}`
  return null
}

/** The icon keys to ask for: the first rows that have one, each once, at most 64. */
export function typeIconKeys(rows: ReadonlyArray<Pick<TypeRow, 'kind' | 'ext'>>): string[] {
  const keys = new Set<string>()
  for (const row of rows) {
    const key = typeIconKey(row)
    if (key !== null) keys.add(key)
    if (keys.size >= MAX_TYPE_ICON_KEYS) break
  }
  return [...keys]
}

/** The sum of the `size` of every row (the "% of folder" bars are shares of it). */
export function totalSize(rows: ReadonlyArray<{ size: number }>): number {
  return rows.reduce((sum, row) => sum + row.size, 0)
}
```

`src/renderer/src/lib/csv.ts`:

```ts
import type { AgeRow, TopFileRow, TypeRow } from '@shared/tree-types'
import { typeCategoryLabel, typeLabel } from './side-view-model'

/** One CSV field (RFC 4180): quoted when it holds a comma, a quote or a line break. */
export function csvField(value: string | number): string {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** A header row and the rows, comma separated, one per line (CRLF), with a final line break. */
export function toCsv(
  header: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number>>,
): string {
  return [header, ...rows].map((fields) => fields.map(csvField).join(',')).join('\r\n') + '\r\n'
}

/** ISO 8601 in UTC (`2026-11-19T12:00:00.000Z`); `''` when the date is unknown. */
export function isoDate(ms: number): string {
  return ms > 0 ? new Date(ms).toISOString() : ''
}

/**
 * The CSV of each list view. Sizes are raw byte counts and dates are ISO 8601, so a spreadsheet
 * can sort and add them. Values are copied as they are: a file name that starts with `=`, `+`,
 * `-` or `@` is not changed, so a spreadsheet may read it as a formula.
 */
export function topFilesCsv(rows: readonly TopFileRow[]): string {
  return toCsv(
    ['Name', 'Folder', 'Size (bytes)', 'Allocated (bytes)', 'Modified (UTC)'],
    rows.map((row) => [row.name, row.folder, row.size, row.allocated, isoDate(row.modifiedMs)]),
  )
}

export function typesCsv(rows: readonly TypeRow[]): string {
  return toCsv(
    ['Extension', 'Category', 'Size (bytes)', 'Allocated (bytes)', 'Files'],
    rows.map((row) => [typeLabel(row), typeCategoryLabel(row), row.size, row.allocated, row.files]),
  )
}

export function ageCsv(rows: readonly AgeRow[]): string {
  return toCsv(
    ['Age', 'Size (bytes)', 'Allocated (bytes)', 'Files'],
    rows.map((row) => [row.label, row.size, row.allocated, row.files]),
  )
}
```

`src/renderer/src/components/CopyCsvButton.tsx`:

```tsx
import { useWorkspace } from '../stores/workspace-store-context'
import { BUTTON_VARIANT_CLASSES } from './Button'

/**
 * "Copy as CSV" in a list view's header. `build` makes the CSV of the whole list when the button
 * is pressed; main puts it on the clipboard and the status bar announces "Copied N rows.". With
 * no rows the button stays reachable but does nothing (`aria-disabled`).
 */
export function CopyCsvButton({ build, rows }: { build(): string; rows: number }) {
  const copyCsv = useWorkspace((s) => s.copyCsv)
  const empty = rows === 0
  return (
    <button
      type="button"
      title="Copy this list to the clipboard as CSV"
      aria-disabled={empty ? 'true' : undefined}
      onClick={() => {
        if (!empty) void copyCsv(build(), rows)
      }}
      className={`h-6 rounded-control px-2 text-[13px] leading-[18px] font-medium transition-colors duration-[120ms] aria-disabled:cursor-default aria-disabled:opacity-60 ${BUTTON_VARIANT_CLASSES.quiet}`}
    >
      Copy as CSV
    </button>
  )
}
```

- [ ] **Step 4: Run the tests and the gates**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/renderer/src/lib src/renderer/src/components/CopyCsvButton.test.tsx; npm run typecheck:web; npm run lint"`
Expected: all PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/csv.ts src/renderer/src/lib/csv.test.ts src/renderer/src/lib/side-view-model.ts src/renderer/src/lib/side-view-model.test.ts src/renderer/src/components/CopyCsvButton.tsx src/renderer/src/components/CopyCsvButton.test.tsx
git commit -m "feat(renderer): CSV text for the side views and the Copy as CSV button"
```

---

### Task 7: Top files view

**Implementer tier:** Sonnet (virtualization, selection and keyboard; the code is complete, but a jsdom test may need a small adjustment).

**Files:**

- Create: `src/renderer/src/components/TopFilesView.tsx`
- Modify: `src/renderer/src/components/PaneView.tsx`
- Test: `src/renderer/src/components/TopFilesView.test.tsx`

**Interfaces:**

- Consumes: `PaneShell`, `ScanningNote`, `useSideView`, `FileIcon` (accepts `Pick<TreeRow, 'id' | 'kind' | 'name'>`), `CopyCsvButton`, `topFilesCsv`, store `fetchTopFiles`, `reveal`, `openInExplorer`, `showContextMenu`, `copyPaths`, `announce`, `mode`, `unit`, `scanId`, `GONE_MESSAGE`; `lib/selection.ts` (`single`, `toggle`, `rangeTo`, `extendBy`, `selectAll`, `Selection`); `TREE_ROW_HEIGHT` and `SINGLE_ITEM_MESSAGE` from `TreeGrid.tsx`; `middleTruncate`, `formatSize`, `formatDate`, `formatCount`; `useIconCache()`.
- Produces: `TopFilesView({ height }: { height: number })` (region "Top files"; grid "Largest files", columns Name, Size, Allocated, Modified, Folder; the ranking column carries `aria-sort="descending"`), `NO_FILES_TEXT = 'There are no files in this folder.'`, `topRowDomId(id: NodeId): string` (`top-row-<id>`).

Behaviour: click, Ctrl+click and Shift+click select like the tree; ↑ ↓ Home End PageUp PageDown move (Shift extends, Ctrl moves only the focus); Space and Ctrl+A; Esc keeps the active row; Enter shows the active file in Explorer (several rows: "Select a single item first."); Menu key, Shift+F10 and right-click open the Explorer menu for the selection; Ctrl+C copies the paths; double-click reveals the file in the folder tree; icons are requested for the rows in view.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/components/TopFilesView.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { topFilesCsv } from '../lib/csv'
import { formatDate, formatSize } from '../lib/format'
import { GONE_MESSAGE } from '../stores/workspace-store'
import { createFakeApi, TEST_TOP_FILES } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { SINGLE_ITEM_MESSAGE } from './TreeGrid'
import { NO_FILES_TEXT, TopFilesView } from './TopFilesView'

async function renderView(api = createFakeApi()) {
  const utils = renderWithStores(<TopFilesView height={260} />, api)
  await act(() => utils.workspace.getState().startScan('D:\\'))
  await screen.findByRole('row', { name: /movie\.mp4/ })
  return utils
}

const grid = () => screen.getByRole('grid', { name: 'Largest files' })
const row = (name: RegExp) => screen.getByRole('row', { name })

describe('<TopFilesView />', () => {
  it('lists the files with every column, under tabs and the folder name', async () => {
    await renderView()
    expect(screen.getByRole('region', { name: 'Top files' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Top files' })).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Name',
      'Size▼',
      'Allocated',
      'Modified',
      'Folder',
    ])
    const [movie, holiday] = TEST_TOP_FILES
    expect(
      within(row(/movie\.mp4/))
        .getAllByRole('gridcell')
        .map((cell) => cell.textContent),
    ).toEqual([
      'movie.mp4',
      formatSize(movie!.size, 'auto'),
      formatSize(movie!.allocated, 'auto'),
      formatDate(movie!.modifiedMs),
      'D:\\Videos',
    ])
    expect(within(row(/holiday/)).getAllByRole('gridcell')[4]).toHaveAttribute(
      'title',
      holiday!.folder,
    )
  })

  it('asks for the treemap folder and ranks by allocated size in Allocated mode', async () => {
    const { api, workspace } = await renderView()
    expect(api.getTopFiles).toHaveBeenLastCalledWith('scan-1', 'd0', 'size')
    act(() => workspace.getState().setMode('allocated'))
    await waitFor(() =>
      expect(api.getTopFiles).toHaveBeenLastCalledWith('scan-1', 'd0', 'allocated'),
    )
    expect(
      screen.getAllByRole('columnheader').find((h) => h.getAttribute('aria-sort') !== null),
    ).toHaveTextContent('Allocated')
    act(() => workspace.getState().select('d1'))
    await waitFor(() =>
      expect(api.getTopFiles).toHaveBeenLastCalledWith('scan-1', 'd1', 'allocated'),
    )
  })

  it('shows the calm message when the folder is gone', async () => {
    const utils = renderWithStores(
      <TopFilesView height={260} />,
      createFakeApi({ getTopFiles: vi.fn(async () => null) }),
    )
    await act(() => utils.workspace.getState().startScan('D:\\'))
    expect(await screen.findByText(GONE_MESSAGE)).toBeInTheDocument()
  })

  it('says so when the folder has no files', async () => {
    const utils = renderWithStores(
      <TopFilesView height={260} />,
      createFakeApi({ getTopFiles: vi.fn(async () => []) }),
    )
    await act(() => utils.workspace.getState().startScan('D:\\'))
    expect(await screen.findByText(NO_FILES_TEXT)).toBeInTheDocument()
  })

  it('selects with the mouse like the tree, and the Explorer menu acts on the selection', async () => {
    const { api } = await renderView()
    fireEvent.click(row(/movie\.mp4/))
    expect(row(/movie\.mp4/)).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(row(/holiday/), { ctrlKey: true })
    expect(row(/movie\.mp4/)).toHaveAttribute('aria-selected', 'true')
    expect(row(/holiday/)).toHaveAttribute('aria-selected', 'true')
    fireEvent.contextMenu(row(/holiday/), { clientX: 10, clientY: 20 })
    await waitFor(() =>
      expect(api.showContextMenu).toHaveBeenCalledWith('scan-1', ['f1', 'f2'], 10, 20, false),
    )
    // A right-click outside the selection selects just that row.
    fireEvent.click(row(/movie\.mp4/))
    fireEvent.contextMenu(row(/holiday/), { clientX: 5, clientY: 6, shiftKey: true })
    await waitFor(() =>
      expect(api.showContextMenu).toHaveBeenLastCalledWith('scan-1', ['f2'], 5, 6, true),
    )
    expect(row(/movie\.mp4/)).toHaveAttribute('aria-selected', 'false')
  })

  it('moves and selects with the keyboard; Enter, the menu key and Ctrl+C reuse the tree actions', async () => {
    const user = userEvent.setup()
    const { api, workspace } = await renderView()
    grid().focus()
    await user.keyboard('{ArrowDown}')
    expect(row(/movie\.mp4/)).toHaveAttribute('aria-selected', 'true')
    expect(grid()).toHaveAttribute('aria-activedescendant', 'top-row-f1')
    await user.keyboard('{ArrowDown}')
    expect(row(/holiday/)).toHaveAttribute('aria-selected', 'true')
    expect(row(/movie\.mp4/)).toHaveAttribute('aria-selected', 'false')
    await user.keyboard('{Home}')
    expect(row(/movie\.mp4/)).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(api.openInExplorer).toHaveBeenCalledWith('scan-1', 'f1')
    await user.keyboard('{Control>}c{/Control}')
    expect(api.copyNodePath).toHaveBeenCalledWith('scan-1', ['f1'])
    await user.keyboard('{Shift>}{F10}{/Shift}')
    await waitFor(() =>
      expect(api.showContextMenu).toHaveBeenCalledWith('scan-1', ['f1'], 32, 0, false),
    )
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}')
    expect(row(/holiday/)).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(workspace.getState().announcement).toBe(SINGLE_ITEM_MESSAGE)
  })

  it('Ctrl+A selects every row and Escape keeps only the active one', async () => {
    const user = userEvent.setup()
    await renderView()
    grid().focus()
    await user.keyboard('{ArrowDown}{Control>}a{/Control}')
    expect(screen.getAllByRole('row', { selected: true })).toHaveLength(2)
    await user.keyboard('{Escape}')
    expect(screen.getAllByRole('row', { selected: true })).toHaveLength(1)
  })

  it('a double-click reveals the file in the folder tree', async () => {
    const { api, workspace } = await renderView()
    fireEvent.doubleClick(row(/movie\.mp4/))
    await waitFor(() => expect(workspace.getState().selectedId).toBe('f1'))
    expect(api.getNode).toHaveBeenCalledWith('scan-1', 'f1', 'size', 'desc')
    expect(workspace.getState().expanded.has('d1')).toBe(true)
  })

  it('Copy as CSV sends the whole list through main', async () => {
    const user = userEvent.setup()
    const { api, workspace } = await renderView()
    await user.click(screen.getByRole('button', { name: 'Copy as CSV' }))
    expect(api.copyText).toHaveBeenCalledWith(topFilesCsv(TEST_TOP_FILES))
    await waitFor(() => expect(workspace.getState().announcement).toBe('Copied 2 rows.'))
  })

  it('asks for the icons of the rows in view', async () => {
    const { api } = await renderView()
    await waitFor(() => expect(api.getIcons).toHaveBeenCalledWith('scan-1', ['f1', 'f2']))
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/renderer/src/components/TopFilesView.test.tsx"`
Expected: FAIL (`Failed to resolve import "./TopFilesView"`).

- [ ] **Step 3: Write the implementation**

Create `src/renderer/src/components/TopFilesView.tsx`:

```tsx
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { NodeId, TopFileRow } from '@shared/tree-types'
import { topFilesCsv } from '../lib/csv'
import { formatCount, formatDate, formatSize, middleTruncate } from '../lib/format'
import { useIconCache } from '../lib/icon-cache-context'
import { extendBy, rangeTo, selectAll, type Selection, single, toggle } from '../lib/selection'
import { useSideView } from '../lib/use-side-view'
import { GONE_MESSAGE } from '../stores/workspace-store'
import { useWorkspace } from '../stores/workspace-store-context'
import { CopyCsvButton } from './CopyCsvButton'
import { FileIcon } from './FileIcon'
import { PaneShell } from './PaneShell'
import { ScanningNote } from './SideViewParts'
import { SINGLE_ITEM_MESSAGE, TREE_ROW_HEIGHT } from './TreeGrid'

const OVERSCAN = 10
/** The folder column is shortened in the middle to this many characters. */
const FOLDER_CHARS = 48
const NO_ROWS: TopFileRow[] = []
const NO_SELECTION: Selection = { ids: new Set(), activeId: null, anchorId: null }

export const NO_FILES_TEXT = 'There are no files in this folder.'

const GRID_TEMPLATE =
  'minmax(var(--size-col-name-min),1.2fr) var(--size-col-size) var(--size-col-allocated) var(--size-col-modified) minmax(160px,1fr)'

const COLUMNS = ['Name', 'Size', 'Allocated', 'Modified', 'Folder'] as const
const NUMERIC = new Set<string>(['Size', 'Allocated'])

export function topRowDomId(id: NodeId): string {
  return `top-row-${id}`
}

/**
 * The largest files below the treemap folder (up to 1,000), as an ARIA grid virtualized by hand
 * like the folder tree. The Mode decides the ranking (Allocated by allocated size, the others by
 * size). Selection and keys follow the tree's: click, Ctrl+click and Shift+click; arrows, Home,
 * End, PageUp and PageDown (Shift extends, Ctrl moves only the focus); Space, Ctrl+A and Esc;
 * Enter shows the file in Explorer; Shift+F10, the Menu key and right-click open the Explorer
 * menu; Ctrl+C copies the paths. Double-click reveals the file in the folder tree.
 */
export function TopFilesView({ height }: { height: number }) {
  const scanId = useWorkspace((s) => s.scanId)
  const mode = useWorkspace((s) => s.mode)
  const unit = useWorkspace((s) => s.unit)
  const fetchTopFiles = useWorkspace((s) => s.fetchTopFiles)
  const reveal = useWorkspace((s) => s.reveal)
  const announce = useWorkspace((s) => s.announce)
  const openInExplorer = useWorkspace((s) => s.openInExplorer)
  const showContextMenu = useWorkspace((s) => s.showContextMenu)
  const copyPaths = useWorkspace((s) => s.copyPaths)

  const state = useSideView(fetchTopFiles, mode)
  const rows = state.status === 'ready' ? state.rows : NO_ROWS
  const ids = useMemo(() => rows.map((row) => row.id), [rows])

  const iconCache = useIconCache()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(400)
  const [selection, setSelection] = useState<Selection>(NO_SELECTION)

  const first = Math.max(0, Math.floor(scrollTop / TREE_ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(
    rows.length - 1,
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

  // Windows' icons for the rendered rows; the cache batches and dedupes.
  useEffect(() => {
    if (scanId === null || iconCache === null) return
    iconCache.request(scanId, ids.slice(first, last + 1))
  }, [scanId, iconCache, ids, first, last])

  const activeIndex = selection.activeId === null ? -1 : ids.indexOf(selection.activeId)

  const ensureVisible = (index: number) => {
    const element = scrollRef.current
    if (element === null || index < 0) return
    const top = index * TREE_ROW_HEIGHT
    const visible = element.clientHeight || viewport
    if (top < element.scrollTop) element.scrollTop = top
    else if (top + TREE_ROW_HEIGHT > element.scrollTop + visible) {
      element.scrollTop = top + TREE_ROW_HEIGHT - visible
    }
    setScrollTop(element.scrollTop)
  }

  /** The rows an action takes: the selected rows in list order, or the active row alone. */
  const actionIds = (): NodeId[] => {
    const selected = ids.filter((id) => selection.ids.has(id))
    if (selected.length > 0) return selected
    return selection.activeId === null ? [] : [selection.activeId]
  }

  const moveTo = (index: number, event: KeyboardEvent<HTMLDivElement>) => {
    const clamped = Math.max(0, Math.min(ids.length - 1, index))
    const id = ids[clamped]
    if (id === undefined) return
    if (event.shiftKey && event.ctrlKey) setSelection(rangeTo(selection, ids, id, true))
    else if (event.shiftKey) setSelection(rangeTo(selection, ids, id, false))
    else if (event.ctrlKey) setSelection({ ...selection, activeId: id })
    else setSelection(single(id))
    ensureVisible(clamped)
  }

  const openMenuForActive = () => {
    if (selection.activeId === null) return
    const rect = document.getElementById(topRowDomId(selection.activeId))?.getBoundingClientRect()
    void showContextMenu(actionIds(), (rect?.left ?? 0) + 32, rect?.bottom ?? 0, false)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || ids.length === 0) return
    const pageRows = Math.max(1, Math.floor(viewport / TREE_ROW_HEIGHT) - 1)
    const several = selection.ids.size > 1
    const key = event.key
    let handled = true
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      const delta = key === 'ArrowDown' ? 1 : -1
      if (event.shiftKey && !event.ctrlKey) {
        setSelection(extendBy(selection, ids, delta))
        ensureVisible(activeIndex + delta)
      } else moveTo(activeIndex === -1 ? 0 : activeIndex + delta, event)
    } else if (key === 'Home') moveTo(0, event)
    else if (key === 'End') moveTo(ids.length - 1, event)
    else if (key === 'PageDown') moveTo(activeIndex + pageRows, event)
    else if (key === 'PageUp') moveTo(activeIndex - pageRows, event)
    else if (key === ' ' && selection.activeId !== null) {
      setSelection(toggle(selection, selection.activeId))
    } else if (event.ctrlKey && key.toLowerCase() === 'a') {
      setSelection(selectAll(ids, selection))
    } else if (key === 'Escape') {
      if (several && selection.activeId !== null) setSelection(single(selection.activeId))
      else handled = false
    } else if (key === 'Enter' && selection.activeId !== null) {
      if (several) announce(SINGLE_ITEM_MESSAGE)
      else void openInExplorer(selection.activeId)
    } else if ((key === 'F10' && event.shiftKey) || key === 'ContextMenu') {
      openMenuForActive()
    } else if (event.ctrlKey && key.toLowerCase() === 'c' && selection.activeId !== null) {
      void copyPaths(actionIds())
    } else handled = false
    if (handled) event.preventDefault()
  }

  const onRowClick = (id: NodeId, event: MouseEvent) => {
    const additive = event.ctrlKey || event.metaKey
    if (event.shiftKey) setSelection(rangeTo(selection, ids, id, additive))
    else if (additive) setSelection(toggle(selection, id))
    else setSelection(single(id))
  }

  const onRowContextMenu = (id: NodeId, event: MouseEvent) => {
    event.preventDefault()
    let sent: NodeId[]
    if (selection.ids.has(id)) {
      // Inside the selection: the menu acts on all of it; the clicked row becomes the active one.
      setSelection({ ...selection, activeId: id })
      sent = ids.filter((candidate) => selection.ids.has(candidate))
    } else {
      setSelection(single(id))
      sent = [id]
    }
    void showContextMenu(sent, event.clientX, event.clientY, event.shiftKey)
  }

  const lines: ReactNode[] = []
  for (let i = first; i <= last; i += 1) {
    const row = rows[i]
    if (row === undefined) continue
    const selected = selection.ids.has(row.id)
    lines.push(
      <div
        key={row.id}
        id={topRowDomId(row.id)}
        role="row"
        aria-rowindex={i + 2}
        aria-selected={selected}
        data-active={row.id === selection.activeId ? 'true' : undefined}
        onClick={(event) => onRowClick(row.id, event)}
        onDoubleClick={(event) => {
          if (event.shiftKey || event.ctrlKey || event.metaKey) return
          void reveal(row.id)
        }}
        onContextMenu={(event) => onRowContextMenu(row.id, event)}
        className={`absolute inset-x-0 grid cursor-default items-center tabular-nums select-none ${
          selected ? 'bg-selection shadow-[inset_2px_0_0_var(--accent)]' : 'hover:bg-row-hover'
        }`}
        style={{
          gridTemplateColumns: GRID_TEMPLATE,
          height: TREE_ROW_HEIGHT,
          transform: `translateY(${i * TREE_ROW_HEIGHT}px)`,
        }}
      >
        <div role="gridcell" className="flex min-w-0 items-center gap-2 px-3">
          <FileIcon row={{ id: row.id, kind: 'file', name: row.name }} root={false} />
          <span className="min-w-0 truncate" title={row.name}>
            {row.name}
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
        <div role="gridcell" className="truncate pr-2">
          {formatDate(row.modifiedMs)}
        </div>
        <div role="gridcell" className="truncate pr-3 text-ink-muted" title={row.folder}>
          {middleTruncate(row.folder, FOLDER_CHARS)}
        </div>
      </div>,
    )
  }

  const ranked = mode === 'allocated' ? 'Allocated' : 'Size'
  const activeRendered = activeIndex >= first && activeIndex <= last
  const message =
    state.status === 'gone'
      ? GONE_MESSAGE
      : state.status === 'ready' && rows.length === 0
        ? NO_FILES_TEXT
        : null

  return (
    <PaneShell
      height={height}
      label="Top files"
      actions={<CopyCsvButton build={() => topFilesCsv(rows)} rows={rows.length} />}
    >
      <ScanningNote />
      <div
        role="grid"
        aria-label="Largest files"
        aria-rowcount={rows.length + 1}
        aria-colcount={COLUMNS.length}
        aria-multiselectable="true"
        aria-activedescendant={
          activeRendered && selection.activeId !== null
            ? topRowDomId(selection.activeId)
            : undefined
        }
        tabIndex={0}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => event.preventDefault()}
        className="flex min-h-0 flex-1 flex-col focus-visible:outline-offset-[-2px]"
      >
        <div role="rowgroup" className="border-b border-line bg-panel">
          <div
            role="row"
            aria-rowindex={1}
            className="grid h-(--size-header-row) items-stretch text-[13px] leading-[18px]"
            style={{ gridTemplateColumns: GRID_TEMPLATE }}
          >
            {COLUMNS.map((column) => (
              <div
                key={column}
                role="columnheader"
                aria-sort={column === ranked ? 'descending' : undefined}
                className={`flex items-center gap-1 px-3 ${column === ranked ? 'font-semibold text-ink' : 'font-medium text-ink-muted'} ${NUMERIC.has(column) ? 'justify-end' : ''}`}
              >
                {column}
                {column === ranked && (
                  <span aria-hidden="true" className="text-xs text-accent">
                    ▼
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
        <div
          ref={scrollRef}
          role="rowgroup"
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          className="relative min-h-0 flex-1 overflow-auto"
        >
          {message !== null ? (
            <div role="row">
              <p role="gridcell" className="px-4 py-3 text-ink-muted">
                {message}
              </p>
            </div>
          ) : (
            <div className="relative" style={{ height: rows.length * TREE_ROW_HEIGHT }}>
              {lines}
            </div>
          )}
        </div>
      </div>
    </PaneShell>
  )
}
```

Show it from the "Top files" tab: in `src/renderer/src/components/PaneView.tsx` replace

```tsx
import { TreemapPane } from './TreemapPane'
```

with

```tsx
import { TopFilesView } from './TopFilesView'
import { TreemapPane } from './TreemapPane'
```

and replace

```tsx
  switch (paneTab) {
    case 'treemap':
```

with

```tsx
  switch (paneTab) {
    case 'top':
      return <TopFilesView height={height} />
    case 'treemap':
```

- [ ] **Step 4: Run the renderer tests and the gates**

Run: `powershell.exe -NoProfile -Command "npx prettier --write src e2e; npx vitest run src/renderer; npm run typecheck:web; npm run lint"`
Expected: all PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/TopFilesView.tsx src/renderer/src/components/TopFilesView.test.tsx src/renderer/src/components/PaneView.tsx
git commit -m "feat(renderer): Top files view"
```

---

### Task 8: Types and Age views

**Implementer tier:** Haiku (all code and tests are in the plan; verified in the dry run).

**Files:**

- Create: `src/renderer/src/components/TypesView.tsx`, `src/renderer/src/components/AgeView.tsx`
- Modify: `src/renderer/src/components/TreemapLegend.tsx`, `src/renderer/src/components/PaneView.tsx`
- Test: `src/renderer/src/components/TypesView.test.tsx`, `src/renderer/src/components/AgeView.test.tsx`, `src/renderer/src/App.test.tsx`

**Interfaces:**

- Consumes: `PaneShell`, `ScanningNote`, `PaneMessage`, `ShareBar`, `SideViewTable`, `SIDE_ROW_CLASS`, `useSideView`, `CopyCsvButton`, `typesCsv`, `ageCsv`, `typeLabel`, `typeCategoryLabel`, `typeIconKey`, `typeIconKeys`, `totalSize`, store `fetchTypes`, `fetchAges`, `loadTypeIcons`, `unit`, `GONE_MESSAGE`, `LARGE_ICON_MIN_DPR` from `FileIcon.tsx`, `percentOf`, `formatSize`, `formatCount`.
- Produces: `CategorySwatch({ category }: { category: FileCategory })` exported from `TreemapLegend.tsx`; `TypesView({ height })` (region "Types"; grid "File types in this folder"; columns Extension, Category, Size, Allocated, Files, % of folder), `NO_TYPES_TEXT`; `AgeView({ height })` (region "Age"; grid "File age in this folder"; columns Age, Size, Allocated, Files, % of folder; the age cell is a `rowheader`).

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/components/TypesView.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { typesCsv } from '../lib/csv'
import { formatCount, formatShare, formatSize } from '../lib/format'
import { GONE_MESSAGE } from '../stores/workspace-store'
import { createFakeApi, TEST_TYPES } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { NO_TYPES_TEXT, TypesView } from './TypesView'

async function renderView(api = createFakeApi()) {
  const utils = renderWithStores(<TypesView height={260} />, api)
  await act(() => utils.workspace.getState().startScan('D:\\'))
  await screen.findByRole('row', { name: /\.mp4/ })
  return utils
}

const table = () => screen.getByRole('grid', { name: 'File types in this folder' })

describe('<TypesView />', () => {
  it('lists each extension with its type, sizes, file count and share of the folder', async () => {
    await renderView()
    expect(screen.getByRole('region', { name: 'Types' })).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Extension',
      'Category',
      'Size',
      'Allocated',
      'Files',
      '% of folder',
    ])
    const [mp4, jpg, none] = TEST_TYPES
    const total = TEST_TYPES.reduce((sum, row) => sum + row.size, 0)
    const cells = (name: RegExp) =>
      within(screen.getByRole('row', { name }))
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
    expect(cells(/\.mp4/)).toEqual([
      '.mp4',
      'Video',
      formatSize(mp4!.size, 'auto'),
      formatSize(mp4!.allocated, 'auto'),
      formatCount(mp4!.files),
      formatShare(mp4!.size / total),
    ])
    expect(cells(/\.jpg/)[1]).toBe('Images')
    expect(cells(/\(no extension\)/)).toEqual([
      '(no extension)',
      'Other',
      formatSize(none!.size, 'auto'),
      formatSize(none!.allocated, 'auto'),
      formatCount(none!.files),
      formatShare(none!.size / total),
    ])
    expect(jpg!.files).toBe(1000)
    expect(within(table()).getAllByRole('row')).toHaveLength(1 + TEST_TYPES.length)
  })

  it('shows the colour of each file type and no colour for "Other extensions"', async () => {
    const api = createFakeApi({
      getTypeBreakdown: vi.fn(async () => [
        ...TEST_TYPES,
        { kind: 'other' as const, ext: '', category: null, size: 1, allocated: 4096, files: 1 },
      ]),
    })
    await renderView(api)
    const swatches = (name: RegExp) =>
      screen.getByRole('row', { name }).querySelectorAll('[style*="--treemap-"]')
    expect(swatches(/\.mp4/)[0]?.getAttribute('style')).toContain('var(--treemap-video)')
    expect(swatches(/Other extensions/)).toHaveLength(0)
  })

  it('asks for Windows’ icons by type key', async () => {
    const { api } = await renderView()
    await waitFor(() =>
      expect(api.getTypeIcons).toHaveBeenCalledWith(['ext:mp4', 'ext:jpg', 'file']),
    )
  })

  it('Copy as CSV sends the whole list through main', async () => {
    const user = userEvent.setup()
    const { api, workspace } = await renderView()
    await user.click(screen.getByRole('button', { name: 'Copy as CSV' }))
    expect(api.copyText).toHaveBeenCalledWith(typesCsv(TEST_TYPES))
    await waitFor(() => expect(workspace.getState().announcement).toBe('Copied 3 rows.'))
  })

  it('asks for the treemap folder again when it changes', async () => {
    const { api, workspace } = await renderView()
    expect(api.getTypeBreakdown).toHaveBeenLastCalledWith('scan-1', 'd0')
    act(() => workspace.getState().select('d1'))
    await waitFor(() => expect(api.getTypeBreakdown).toHaveBeenLastCalledWith('scan-1', 'd1'))
  })

  it('shows the calm message when the folder is gone or has no files', async () => {
    const gone = renderWithStores(
      <TypesView height={260} />,
      createFakeApi({ getTypeBreakdown: vi.fn(async () => null) }),
    )
    await act(() => gone.workspace.getState().startScan('D:\\'))
    expect(await screen.findByText(GONE_MESSAGE)).toBeInTheDocument()
    gone.unmount()

    const empty = renderWithStores(
      <TypesView height={260} />,
      createFakeApi({ getTypeBreakdown: vi.fn(async () => []) }),
    )
    await act(() => empty.workspace.getState().startScan('D:\\'))
    expect(await screen.findByText(NO_TYPES_TEXT)).toBeInTheDocument()
  })

  it('notes that the results are partial while the scan runs', async () => {
    await renderView()
    expect(screen.getByText(/Scanning…/)).toBeInTheDocument()
  })
})
```

`src/renderer/src/components/AgeView.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AGE_BUCKETS } from '@shared/tree-types'
import { ageCsv } from '../lib/csv'
import { formatCount, formatShare, formatSize } from '../lib/format'
import { GONE_MESSAGE } from '../stores/workspace-store'
import { createFakeApi, TEST_AGE } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { AgeView } from './AgeView'

async function renderView(api = createFakeApi()) {
  const utils = renderWithStores(<AgeView height={260} />, api)
  await act(() => utils.workspace.getState().startScan('D:\\'))
  await screen.findByRole('row', { name: /Last 30 days/ })
  return utils
}

describe('<AgeView />', () => {
  it('lists all 8 buckets in order, empty ones too, with sizes, files and shares', async () => {
    await renderView()
    expect(screen.getByRole('region', { name: 'Age' })).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Age',
      'Size',
      'Allocated',
      'Files',
      '% of folder',
    ])
    const body = screen.getAllByRole('row').slice(1)
    expect(body.map((row) => within(row).getByRole('rowheader').textContent)).toEqual(
      AGE_BUCKETS.map((bucket) => bucket.label),
    )
    const total = TEST_AGE.reduce((sum, row) => sum + row.size, 0)
    const recent = TEST_AGE[0]!
    expect(
      within(body[0]!)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual([
      formatSize(recent.size, 'auto'),
      formatSize(recent.allocated, 'auto'),
      formatCount(recent.files),
      formatShare(recent.size / total),
    ])
    expect(within(body[1]!).getAllByRole('cell')[2]).toHaveTextContent('0')
    expect(within(body[1]!).getAllByRole('cell')[3]).toHaveTextContent('0.0%')
  })

  it('Copy as CSV sends all 8 buckets through main', async () => {
    const user = userEvent.setup()
    const { api, workspace } = await renderView()
    await user.click(screen.getByRole('button', { name: 'Copy as CSV' }))
    expect(api.copyText).toHaveBeenCalledWith(ageCsv(TEST_AGE))
    await waitFor(() => expect(workspace.getState().announcement).toBe('Copied 8 rows.'))
  })

  it('asks for the treemap folder of the current scan again when it changes', async () => {
    const { api, workspace } = await renderView()
    expect(api.getAgeBreakdown).toHaveBeenLastCalledWith('scan-1', 'd0')
    act(() => workspace.getState().select('d2'))
    await waitFor(() => expect(api.getAgeBreakdown).toHaveBeenLastCalledWith('scan-1', 'd2'))
  })

  it('shows the calm message when the folder is gone', async () => {
    const utils = renderWithStores(
      <AgeView height={260} />,
      createFakeApi({ getAgeBreakdown: vi.fn(async () => null) }),
    )
    await act(() => utils.workspace.getState().startScan('D:\\'))
    expect(await screen.findByText(GONE_MESSAGE)).toBeInTheDocument()
  })
})
```

The whole-pane flow, in `App.test.tsx`:

```diff
--- a/src/renderer/src/App.test.tsx
+++ b/src/renderer/src/App.test.tsx
@@ -54,6 +54,29 @@ describe('<App />', () => {
     expect(screen.getByRole('region', { name: 'Treemap' })).toBeInTheDocument()
   })

+  it('shows each side view in the bottom pane from its tab, and the ribbon follows', async () => {
+    const user = userEvent.setup()
+    const { api, workspace } = renderWithStores(<App />)
+    await act(() => workspace.getState().startScan('D:\\'))
+    expect(await screen.findByRole('region', { name: 'Treemap' })).toBeInTheDocument()
+    await user.click(screen.getByRole('tab', { name: 'Top files' }))
+    expect(await screen.findByRole('region', { name: 'Top files' })).toBeInTheDocument()
+    expect(screen.queryByRole('region', { name: 'Treemap' })).not.toBeInTheDocument()
+    expect(await screen.findByRole('row', { name: /movie\.mp4/ })).toBeInTheDocument()
+    await user.click(screen.getByRole('tab', { name: 'Types' }))
+    expect(await screen.findByRole('region', { name: 'Types' })).toBeInTheDocument()
+    await user.click(screen.getByRole('tab', { name: 'Age' }))
+    expect(await screen.findByRole('region', { name: 'Age' })).toBeInTheDocument()
+    expect(api.getAgeBreakdown).toHaveBeenCalledWith('scan-1', 'd0')
+    await user.click(screen.getByRole('tab', { name: 'View' }))
+    expect(screen.getByRole('button', { name: 'Age' })).toHaveAttribute('aria-pressed', 'true')
+    expect(screen.getByRole('button', { name: 'Treemap' })).toHaveAttribute('aria-pressed', 'false')
+    await user.click(screen.getByRole('button', { name: 'Top files' }))
+    expect(await screen.findByRole('region', { name: 'Top files' })).toBeInTheDocument()
+    await user.click(screen.getByRole('button', { name: 'Top files' }))
+    expect(screen.queryByRole('region', { name: 'Top files' })).not.toBeInTheDocument()
+  })
+
   it('F5 scans the same location again', async () => {
     const user = userEvent.setup()
     const { api, workspace } = renderWithStores(<App />)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/renderer/src/components/TypesView.test.tsx src/renderer/src/components/AgeView.test.tsx src/renderer/src/App.test.tsx"`
Expected: FAIL (modules not found; the Types and Age tabs still show the treemap).

- [ ] **Step 3: Write the implementation**

`src/renderer/src/components/TypesView.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { IconImage } from '@shared/ipc-contract'
import { typesCsv } from '../lib/csv'
import { formatCount, formatSize, percentOf } from '../lib/format'
import { IconRowFile } from '../lib/icons'
import {
  totalSize,
  typeCategoryLabel,
  typeIconKey,
  typeIconKeys,
  typeLabel,
} from '../lib/side-view-model'
import { useSideView } from '../lib/use-side-view'
import { GONE_MESSAGE } from '../stores/workspace-store'
import { useWorkspace } from '../stores/workspace-store-context'
import { CopyCsvButton } from './CopyCsvButton'
import { LARGE_ICON_MIN_DPR } from './FileIcon'
import { PaneShell } from './PaneShell'
import { PaneMessage, ScanningNote, ShareBar, SIDE_ROW_CLASS, SideViewTable } from './SideViewParts'
import { CategorySwatch } from './TreemapLegend'

export const NO_TYPES_TEXT = 'There are no files in this folder.'

const COLUMNS = [
  { label: 'Extension' },
  { label: 'Category' },
  { label: 'Size', numeric: true },
  { label: 'Allocated', numeric: true },
  { label: 'Files', numeric: true },
  { label: '% of folder' },
]

/** A type's Windows icon (16 CSS px, like the tree's), or the file placeholder until it arrives. */
function TypeIcon({ image }: { image: IconImage | undefined }) {
  if (image === undefined) {
    return (
      <IconRowFile
        aria-hidden="true"
        focusable={false}
        className="size-4 shrink-0 text-ink-muted"
      />
    )
  }
  const large = window.devicePixelRatio >= LARGE_ICON_MIN_DPR
  return (
    <img
      src={large ? image.large : image.small}
      width={16}
      height={16}
      alt=""
      aria-hidden="true"
      draggable={false}
      className="size-4 shrink-0 object-contain"
    />
  )
}

/**
 * The space each file extension uses below the treemap folder: Windows' icon and the extension,
 * the file type with its treemap colour, Size, Allocated, Files and a "% of folder" bar. Sorted by
 * Size; the scanner folds extensions beyond the 500 biggest into "Other extensions".
 */
export function TypesView({ height }: { height: number }) {
  const unit = useWorkspace((s) => s.unit)
  const fetchTypes = useWorkspace((s) => s.fetchTypes)
  const loadTypeIcons = useWorkspace((s) => s.loadTypeIcons)
  const state = useSideView(fetchTypes)
  const rows = state.status === 'ready' ? state.rows : null
  const [icons, setIcons] = useState<Record<string, IconImage>>({})

  useEffect(() => {
    if (rows === null) return
    let current = true
    void loadTypeIcons(typeIconKeys(rows)).then((found) => {
      if (current) setIcons((known) => ({ ...known, ...found }))
    })
    return () => {
      current = false
    }
  }, [rows, loadTypeIcons])

  const total = rows === null ? 0 : totalSize(rows)

  return (
    <PaneShell
      height={height}
      label="Types"
      actions={
        <CopyCsvButton build={() => typesCsv(rows ?? [])} rows={rows === null ? 0 : rows.length} />
      }
    >
      <ScanningNote />
      {state.status === 'gone' && <PaneMessage>{GONE_MESSAGE}</PaneMessage>}
      {rows !== null && rows.length === 0 && <PaneMessage>{NO_TYPES_TEXT}</PaneMessage>}
      {rows !== null && rows.length > 0 && (
        <SideViewTable label="File types in this folder" columns={COLUMNS}>
          {rows.map((row) => {
            const key = typeIconKey(row)
            return (
              <tr key={`${row.kind}:${row.ext}`} className="hover:bg-row-hover">
                <td className={`${SIDE_ROW_CLASS} px-3`}>
                  <span className="flex min-w-0 items-center gap-2">
                    <TypeIcon image={key === null ? undefined : icons[key]} />
                    <span className="truncate">{typeLabel(row)}</span>
                  </span>
                </td>
                <td className="px-3">
                  <span className="flex items-center gap-1.5">
                    {row.category !== null && <CategorySwatch category={row.category} />}
                    {typeCategoryLabel(row)}
                  </span>
                </td>
                <td className="px-3 text-right" title={`${formatCount(row.size)} bytes`}>
                  {formatSize(row.size, unit)}
                </td>
                <td className="px-3 text-right" title={`${formatCount(row.allocated)} bytes`}>
                  {formatSize(row.allocated, unit)}
                </td>
                <td className="px-3 text-right">{formatCount(row.files)}</td>
                <td className="px-3">
                  <ShareBar share={percentOf(row.size, total)} />
                </td>
              </tr>
            )
          })}
        </SideViewTable>
      )}
    </PaneShell>
  )
}
```

`src/renderer/src/components/AgeView.tsx`:

```tsx
import { ageCsv } from '../lib/csv'
import { formatCount, formatSize, percentOf } from '../lib/format'
import { totalSize } from '../lib/side-view-model'
import { useSideView } from '../lib/use-side-view'
import { GONE_MESSAGE } from '../stores/workspace-store'
import { useWorkspace } from '../stores/workspace-store-context'
import { CopyCsvButton } from './CopyCsvButton'
import { PaneShell } from './PaneShell'
import { PaneMessage, ScanningNote, ShareBar, SIDE_ROW_CLASS, SideViewTable } from './SideViewParts'

const COLUMNS = [
  { label: 'Age' },
  { label: 'Size', numeric: true },
  { label: 'Allocated', numeric: true },
  { label: 'Files', numeric: true },
  { label: '% of folder' },
]

/**
 * The space used by files of each modification age below the treemap folder. The scanner always
 * returns all 8 buckets, in order, so empty ones show too; "Unknown date" also holds files dated
 * in the future.
 */
export function AgeView({ height }: { height: number }) {
  const unit = useWorkspace((s) => s.unit)
  const fetchAges = useWorkspace((s) => s.fetchAges)
  const state = useSideView(fetchAges)
  const rows = state.status === 'ready' ? state.rows : null
  const total = rows === null ? 0 : totalSize(rows)

  return (
    <PaneShell
      height={height}
      label="Age"
      actions={
        <CopyCsvButton build={() => ageCsv(rows ?? [])} rows={rows === null ? 0 : rows.length} />
      }
    >
      <ScanningNote />
      {state.status === 'gone' && <PaneMessage>{GONE_MESSAGE}</PaneMessage>}
      {rows !== null && (
        <SideViewTable label="File age in this folder" columns={COLUMNS}>
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-row-hover">
              <th scope="row" className={`${SIDE_ROW_CLASS} px-3 text-left font-normal`}>
                {row.label}
              </th>
              <td className="px-3 text-right" title={`${formatCount(row.size)} bytes`}>
                {formatSize(row.size, unit)}
              </td>
              <td className="px-3 text-right" title={`${formatCount(row.allocated)} bytes`}>
                {formatSize(row.allocated, unit)}
              </td>
              <td className="px-3 text-right">{formatCount(row.files)}</td>
              <td className="px-3">
                <ShareBar share={percentOf(row.size, total)} />
              </td>
            </tr>
          ))}
        </SideViewTable>
      )}
    </PaneShell>
  )
}
```

The colour chip of the legend, reused by the Types view:

```diff
--- a/src/renderer/src/components/TreemapLegend.tsx
+++ b/src/renderer/src/components/TreemapLegend.tsx
@@ -42,6 +42,17 @@ function swatchStyle(item: LegendItem): { background: string } {
   return { background: 'var(--treemap-folder)' }
 }

+/** The colour chip of one file type, as in the legend (the Types view uses it too). */
+export function CategorySwatch({ category }: { category: FileCategory }) {
+  return (
+    <span
+      aria-hidden="true"
+      className={SWATCH}
+      style={{ background: `var(--treemap-${category})` }}
+    />
+  )
+}
+
 /** One row under the treemap that names the colours: file types with their shares. */
 export function TreemapLegend({ layout }: { layout: TreemapLayout | null }) {
   const items = layout === null ? [] : legendItems(layout)
```

Show them from their tabs: in `src/renderer/src/components/PaneView.tsx` replace

```tsx
import { TopFilesView } from './TopFilesView'
import { TreemapPane } from './TreemapPane'
```

with

```tsx
import { AgeView } from './AgeView'
import { TopFilesView } from './TopFilesView'
import { TreemapPane } from './TreemapPane'
import { TypesView } from './TypesView'
```

and replace

```tsx
    case 'top':
      return <TopFilesView height={height} />
```

with

```tsx
    case 'top':
      return <TopFilesView height={height} />
    case 'types':
      return <TypesView height={height} />
    case 'age':
      return <AgeView height={height} />
```

The final file is:

```tsx
import { useWorkspace } from '../stores/workspace-store-context'
import { AgeView } from './AgeView'
import { TopFilesView } from './TopFilesView'
import { TreemapPane } from './TreemapPane'
import { TypesView } from './TypesView'

/** The view the bottom pane shows: the treemap or one of the side views. */
export function PaneView({ height }: { height: number }) {
  const paneTab = useWorkspace((s) => s.paneTab)
  switch (paneTab) {
    case 'top':
      return <TopFilesView height={height} />
    case 'types':
      return <TypesView height={height} />
    case 'age':
      return <AgeView height={height} />
    case 'treemap':
    default:
      return <TreemapPane height={height} />
  }
}
```

- [ ] **Step 4: Run the renderer tests and the gates**

Run: `powershell.exe -NoProfile -Command "npx prettier --write src e2e; npx vitest run src/renderer; npm run typecheck:web; npm run lint"`
Expected: all PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/TypesView.tsx src/renderer/src/components/TypesView.test.tsx src/renderer/src/components/AgeView.tsx src/renderer/src/components/AgeView.test.tsx src/renderer/src/components/TreemapLegend.tsx src/renderer/src/components/PaneView.tsx src/renderer/src/App.test.tsx
git commit -m "feat(renderer): Types and Age views"
```

---

### Task 9: End-to-end test, docs and the final gates

**Implementer tier:** Sonnet (E2E needs an interactive desktop; the docs edits are small but touch a wide table).

**Files:**

- Create: `e2e/side-views.spec.ts`
- Modify: `docs/ROADMAP.md`, `CHANGELOG.md`, `docs/superpowers/specs/2026-11-28-phase-4-side-views-design.md` (formatting only)

**Interfaces:**

- Consumes: the E2E helpers `launchApp`, `consoleErrors`, `scanFolder`, `driveDetails`, `ribbonButton`, `treeRow`, `cellBytes`, `count`, and the scan fixture (`createScanFixture`: 62 files and the junction's 0-byte entry, 12 folders of 5 files each of `i * 1000` bytes, `root-file.txt` of 777 bytes).
- Produces: nothing later tasks use.

- [ ] **Step 1: Write the E2E test**

Create `e2e/side-views.spec.ts` (the top row's size and folder are asserted, not its name: the five 12,000-byte files of `folder-12` tie, and the walk order decides which comes first; in a Playwright locator the cells of a `role="grid"` table are `gridcell`):

```ts
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import { allocated, createScanFixture, type ScanFixture } from './support/fixture'
import { consoleErrors, launchApp } from './support/launch'
import {
  cellBytes,
  count,
  driveDetails,
  ribbonButton,
  scanFolder,
  treeRow,
} from './support/workspace'

let app: ElectronApplication | undefined
let page: Page
let fixture: ScanFixture | undefined

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

const tab = (name: string) => page.getByRole('tab', { name, exact: true })
const readClipboard = () => app!.evaluate(({ clipboard }) => clipboard.readText())

test('the bottom pane has four tabs, and the View tab follows them', async () => {
  await scanFixture()
  await expect(page.getByRole('tablist', { name: 'Pane views' }).getByRole('tab')).toHaveText([
    'Treemap',
    'Top files',
    'Types',
    'Age',
  ])
  await expect(tab('Treemap')).toHaveAttribute('aria-selected', 'true')
  await tab('Top files').click()
  await expect(page.getByRole('region', { name: 'Top files' })).toBeVisible()
  await expect(page.getByRole('toolbar', { name: 'Treemap levels' })).toHaveCount(0)
  await page.getByRole('tab', { name: 'View' }).click()
  await expect(ribbonButton(page, 'Top files')).toHaveAttribute('aria-pressed', 'true')
  await ribbonButton(page, 'Age').click()
  await expect(page.getByRole('region', { name: 'Age' })).toBeVisible()
  await ribbonButton(page, 'Age').click()
  await expect(page.getByRole('region', { name: 'Age' })).toHaveCount(0)
  await ribbonButton(page, 'Treemap').click()
  await expect(page.getByRole('region', { name: 'Treemap' })).toBeVisible()
  expect(await consoleErrors(app!)).toEqual([])
})

test('Top files lists the largest files first and reveals one in the tree', async () => {
  const { fixture: f } = await scanFixture()
  await tab('Top files').click()
  const grid = page.getByRole('grid', { name: 'Largest files' })
  // 62 files and the junction's 0-byte entry are all listed; the header is row 1.
  await expect(grid).toHaveAttribute('aria-rowcount', String(f.expected.files + 1))
  const rows = grid.getByRole('row')
  const top = rows.nth(1)
  // folder-12 holds the biggest files (12,000 bytes each); which of its five comes first depends
  // on the walk order, so the test checks the size and the folder, not the name.
  expect(await cellBytes(top, 1)).toBe(12_000)
  await expect(top.getByRole('gridcell').nth(4)).toHaveAttribute('title', /folder-12/)
  const sizes = await rows.evaluateAll((all) =>
    all
      .slice(1)
      .map((row) =>
        Number(row.querySelectorAll('[role="gridcell"]')[1]?.getAttribute('data-bytes')),
      ),
  )
  expect([...sizes].sort((a, b) => b - a)).toEqual(sizes)

  const name = (await top.getByRole('gridcell').first().textContent()) ?? ''
  await top.dblclick()
  await expect(treeRow(page, name)).toHaveAttribute('aria-selected', 'true')
})

test('Types sums every file by extension, and Age puts the new files in the last 30 days', async () => {
  const { fixture: f, cluster } = await scanFixture()
  await tab('Types').click()
  const types = page.getByRole('grid', { name: 'File types in this folder' })
  const txt = types.getByRole('row').filter({ hasText: '.txt' })
  await expect(txt.getByRole('gridcell').nth(1)).toHaveText('Documents')
  await expect(txt.getByRole('gridcell').nth(2)).toHaveAttribute('title', '777 bytes')
  await expect(txt.getByRole('gridcell').nth(3)).toHaveAttribute(
    'title',
    `${count.format(allocated([777], cluster))} bytes`,
  )
  await expect(txt.getByRole('gridcell').nth(4)).toHaveText('1')
  const files = await types
    .getByRole('row')
    .evaluateAll((all) =>
      all
        .slice(1)
        .map((row) => Number(row.querySelectorAll('td')[4]?.textContent?.replaceAll(',', ''))),
    )
  expect(files.reduce((sum, value) => sum + value, 0)).toBe(f.expected.files)

  await tab('Age').click()
  const age = page.getByRole('grid', { name: 'File age in this folder' })
  await expect(age.getByRole('row')).toHaveCount(9)
  const recent = age.getByRole('row').filter({ hasText: 'Last 30 days' })
  await expect(recent.getByRole('gridcell').nth(2)).toHaveText(count.format(f.expected.files))
  await expect(recent.getByRole('gridcell').nth(3)).toHaveText('100.0%')
})

test('Copy as CSV puts the whole list on the clipboard through main', async () => {
  const { fixture: f, cluster } = await scanFixture()
  await tab('Types').click()
  await page.getByRole('button', { name: 'Copy as CSV' }).click()
  await expect
    .poll(readClipboard)
    .toContain('Extension,Category,Size (bytes),Allocated (bytes),Files\r\n')
  const types = await readClipboard()
  expect(types).toContain(`.txt,Documents,777,${allocated([777], cluster)},1\r\n`)

  await tab('Top files').click()
  await page.getByRole('button', { name: 'Copy as CSV' }).click()
  await expect
    .poll(async () => (await readClipboard()).startsWith('Name,Folder,Size (bytes),'))
    .toBe(true)
  const lines = (await readClipboard()).trimEnd().split('\r\n')
  expect(lines).toHaveLength(f.expected.files + 1)
  expect(lines[1]).toMatch(/^file-\d\.[a-z0-9]+,.*folder-12.*,12000,/)
  expect(await consoleErrors(app!)).toEqual([])
})
```

- [ ] **Step 2: Build and run the E2E tests**

Run: `powershell.exe -NoProfile -Command "Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; npx electron-vite build; npx playwright test e2e/side-views.spec.ts e2e/app.spec.ts"`
Expected: PASS (4 new tests; `app.spec.ts` checks the exposed API list from Task 3).

- [ ] **Step 3: Update the roadmap and the changelog**

`docs/ROADMAP.md`, four edits (then run `npx prettier --write docs/ROADMAP.md`, which realigns the table):

1. Header: replace `**Current phase:** Phase 3 — Analyzer Workspace` with `**Current phase:** Phase 4 — Side Views` and `**Last updated:** 2026-11-19` with `**Last updated:** 2026-11-28`.
2. In the Roadmap table, row 4: replace the status cell `Not started` with `**In progress** — [plan](superpowers/plans/2026-11-28-phase-4-side-views.md)`.
3. In the Phase 1 carry-over list, replace `— **still scheduled for Phase 4**` (item 9) with `— **done (Phase 4, Tasks 3 and 6)**`.
4. Insert this section just before `### Release checklist (before first public release, not tied to a phase)`:

```markdown
### Phase 4 — Side Views (task checklist)

Spec: [Phase 4 — Side Views design](superpowers/specs/2026-11-28-phase-4-side-views-design.md). Plan: [Phase 4 plan](superpowers/plans/2026-11-28-phase-4-side-views.md).

- [x] T1 Scanner `side-views.ts`: top files (heap), bytes per extension, bytes per age bucket, cached per tree version
- [x] T2 Scanner queries `top-files`, `types`, `age`; 1M-file perf cases (limit 300 ms)
- [x] T3 Main channels `side:top-files`, `side:types`, `side:age`, `clipboard:copy-text` (4 MiB), preload bridge
- [x] T4 Workspace store: `paneTab`, side-view fetching, `copyCsv`
- [x] T5 Pane frame: Treemap | Top files | Types | Age tabs, ribbon "Pane" group
- [x] T6 CSV text (RFC 4180, raw bytes, ISO 8601 UTC) and the Copy as CSV button
- [x] T7 Top files view (virtualized, selection, keyboard, Explorer menu, reveal in tree)
- [x] T8 Types and Age views
- [x] T9 E2E (tabs, top row, types and age, Copy as CSV read from main's clipboard), docs

Decisions: see the plan's "Decisions made while planning". Not in this phase: charts (Phase 5), filtering Top files by clicking a Types or Age row, explanations of known space hogs, the future date in the Last Modified roll-up.
```

`CHANGELOG.md`: insert this above `## [0.2.0-beta.2] - 2026-11-25` (the About box skips `[Unreleased]`):

```markdown
## [Unreleased]

### Added

- The pane under the folder tree now has four tabs: Treemap, Top files, Types and Age. Each describes the folder selected in the tree (or the folder of the selected file).
- Top files lists the largest files below that folder (up to 1,000), ranked by size, or by space on disk in Allocated mode. Right-click for Explorer's menu, or double-click a file to find it in the tree.
- Types shows how much space each file extension uses, with Windows' icon and the treemap colour of its file type.
- Age shows how much space is used by files changed in the last 30 days, 1–3 months, 3–6 months, 6–12 months, 1–2 years, 2–5 years, more than 5 years ago, or with an unknown date.
- Copy as CSV in each list puts the whole list on the clipboard, ready for a spreadsheet.
- A Pane group on the View tab shows or hides each of the four views.
```

- [ ] **Step 4: Format the docs, including the spec**

Run: `powershell.exe -NoProfile -Command "npx prettier --write docs/ROADMAP.md CHANGELOG.md docs/superpowers/specs/2026-11-28-phase-4-side-views-design.md docs/superpowers/plans/2026-11-28-phase-4-side-views.md"`
Expected: the files are rewritten; `git diff` of the spec shows whitespace-only changes.

- [ ] **Step 5: Run every gate**

Run: `powershell.exe -NoProfile -Command "npm run typecheck; npm run lint; npm run format:check; npx vitest run; npx vitest run --config vitest.perf.config.mts; Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; npx electron-vite build; npx playwright test"`
Expected: typecheck, lint and `format:check` clean (the spec now passes); unit tests PASS (about 1,310; if only `win-shell-menu.native.test.ts` fails, run it alone and it passes); perf PASS; E2E 48 passed, 3 skipped (the opt-in metrics and screenshot runs).

- [ ] **Step 6: Commit**

```bash
git add e2e/side-views.spec.ts
git commit -m "test(e2e): side views, Copy as CSV through main's clipboard"
git add docs/ROADMAP.md CHANGELOG.md docs/superpowers/specs/2026-11-28-phase-4-side-views-design.md
git commit -m "docs: Phase 4 checklist and changelog; format the Phase 4 spec"
```

---

## Self-review

**Spec coverage** (each spec section and the task that implements it):

| Spec                                                                                       | Task                                                                        |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| §1 four tabs, folder = treemap folder, splitter/Level bar/hide kept, View "Pane" group     | 4 (`paneTab`), 5 (tabs, frame, ribbon group)                                |
| §2.1 Top files: limit 1,000, ranking by Mode, columns, selection, keys, menu, reveal       | 1 (`topFiles`, `rankByOf`), 2, 7                                            |
| §2.2 Types: columns, icons, swatch, sort, 500 cap, "Other extensions", "(no extension)"    | 1 (`typeBreakdown`), 6 (labels, icon keys), 8                               |
| §2.3 Age: 8 buckets, always all, order, edges, future dates in Unknown                     | 1 (`ageBreakdown`), 8                                                       |
| §2.4 Copy as CSV: whole result, RFC 4180, raw bytes, ISO UTC, `clipboard:copy-text`, 4 MiB | 3 (channel, `copyTextArgs`), 4 (`copyCsv`), 6 (`csv.ts`, button), 7, 8      |
| §3.1 scanner functions, subtree walk and root loop, cache by `store.version`, 300 ms, perf | 1, 2                                                                        |
| §3.2 channels, `parseArgs` in the `treemap:layout` style, rows carry `NodeId`              | 3                                                                           |
| §3.3 store, new components, shared code, accessibility (tabs pattern, grids, text percent) | 4, 5, 6, 7, 8                                                               |
| §4 states: disabled tabs without a scan, partial results while scanning, gone, too large   | 5 (`aria-disabled`, `ScanningNote`), 7, 8 (`GONE_MESSAGE`), 4 and 6 (limit) |
| §5 tests: unit, parsers, csv quoting, views, perf, E2E (read the clipboard from main)      | every task; E2E in 9                                                        |
| §6 out of scope                                                                            | not implemented                                                             |

**Placeholder scan:** no "TBD", "TODO" or "similar to Task N"; every step has its code, diff or edit text. Diffs are the dry-run changes against `HEAD`.

**Type consistency:** `TopFileRow`, `TypeRow`, `AgeRow`, `AGE_BUCKETS` (Task 1) are used unchanged in the protocol (2), the IPC contract and fake bridge (3), the store (4), `csv.ts` (6) and the views (7, 8). The query kinds `top-files`, `types`, `age` (2) match the handlers (3). `paneTab`, `togglePane`, `setPaneTab`, `fetchTopFiles`, `fetchTypes`, `fetchAges`, `loadTypeIcons`, `copyCsv` (4) match their uses in Tasks 5 to 8. `PaneShell` props (5) match the three views' calls (7, 8). `CopyCsvButton({ build, rows })` (6) matches its calls (7, 8). `PaneView`'s `switch` cases are added in 7 and 8 and end as the file shown in Task 8.

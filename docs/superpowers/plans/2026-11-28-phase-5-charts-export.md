# Phase 5 — Charts and Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Types tab gets a donut chart of space by file type and the Age tab gets a bar chart of space by age. The File ribbon tab gets **Export to CSV…** and **Export to Excel…**, which write the whole tree below the pane's folder to a file the owner chooses. Three small Phase 4 issues are fixed on the way.

**Architecture:** Charts are hand-drawn SVG. A pure module (`lib/chart-geometry.ts`) makes the slice angles, the donut path and the bar lengths; two components draw them and a Zustand flag (`chartVisible`) hides them. The export follows the existing path end to end: renderer → preload → main handler (typed `parseArgs`, **main shows the save dialog**) → scanner query `export`. The scanner process writes the file itself, streaming, so a million rows never cross IPC: a generator walks the `TreeStore` depth first, a CSV writer batches 64 KiB strings, and a small streaming XLSX writer (inline strings, deflated ZIP entries with data descriptors, built on `node:zlib`) writes four sheets. The CSV writer and the list columns move to `src/shared` so Copy as CSV and the export use the same code, and both neutralize spreadsheet formulas.

**Tech Stack:** Electron 45, React 19, TypeScript 6 (strict), Tailwind 4, Zustand 5, Vitest 5 + Testing Library + jsdom, Playwright. **No new dependency.**

**Spec:** [Phase 5 — Charts and Export design](../specs/2026-11-28-phase-5-charts-export-design.md). It governs; "Self-review" at the end maps every section to a task.

**Model routing (for the controller):** every task starts with an `**Implementer tier:**` line. `Haiku` means the plan contains all code and tests, so a fast model can transcribe and run it. `Sonnet` means the task integrates with several existing files, the UI or Electron, and needs judgment if a test needs a small adjustment (review on the strong model).

**Dry run:** every task below was applied in the working tree on 2026-11-28, one commit each, and all gates passed with every task applied: `typecheck`, `lint`, `format:check`, 1,404 unit tests (one run in four showed the timing-sensitive native shell-menu test failing; it passes alone and on a rerun), the perf test (1M files: **CSV export 4.8 s, limit 10 s; Excel export 8.6 s, limit 20 s**; the Phase 4 side views are unchanged at 20 to 100 ms), and 54 (3 opt-in tests skipped) E2E tests. The code blocks are the dry-run files after `npx prettier --write`; modified files are shown as the diff of that task's commit.

## Global Constraints

Carried forward from Phases 1 to 4 (binding):

- Installed versions stay as recorded. Do not upgrade anything and **add no dependency**. Never use `--force` or `--legacy-peer-deps`.
- Target Windows 10 1809+ / Windows 11, x64 only. StorageIQ's own code stays **read-only** with respect to the scanned folders: the only thing it writes is the one export file the owner chose in the save dialog.
- Renderer security baseline unchanged: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict CSP, every IPC call checks its sender (`registerIpcHandlers` does it for every channel, including the two new ones), all permission requests denied.
- Every IPC channel has a typed `parseArgs`; invalid arguments reject with `InvalidIpcArgumentsError` and the handler never runs.
- TypeScript `strict` plus `noUncheckedIndexedAccess`. No `any`, no `@ts-ignore`. Path aliases `@shared/*`, `@renderer/*`.
- Prettier style: no semicolons, single quotes, print width 100, trailing commas. Format with `npx prettier --write src e2e docs CHANGELOG.md`.
- Copy is plain language and uses typographic punctuation (`’`, `…`, `–`). The exact UI strings are the ones in this plan's code.
- Spec values used verbatim (Phase 5 spec §2 to §4):
  - Pie: slices clockwise from 12 o'clock, largest first; a slice under 1 % is still drawn at a minimum of 1°; the centre shows the total; the SVG is `role="img"` with an `aria-label` that summarises the top three entries (`Video 41 %, Documents 22 %, Images 12 %`); forced-colors strokes use `CanvasText`.
  - Bars: horizontal, length = size / largest bucket's size, bucket name on the left, size on the right, accent colour, "Unknown date" in the muted colour.
  - "Chart" toggle button in the tab header, on by default, kept in the workspace store; below 720 px of pane width the chart moves above the table.
  - Export: **Export to CSV…** and **Export to Excel…** in an Export group of the File tab; enabled only when a finished scan exists; `export:run` takes `(scanId, nodeId, format)` and never a path; main shows the save dialog, default name `<folder name> - StorageIQ.csv` or `.xlsx`, in Documents; cancel is `{ status: 'cancelled' }`; the reply is `{ status: 'done', rows, truncated, filePath }` or `{ status: 'failed', message }`; `shell:show-export` takes no argument and opens only the last export.
  - Tree columns: Path, Name, Type (`Folder`/`File`), Extension, Size (bytes), Allocated (bytes), Files, Folders, Modified (UTC) (ISO 8601), % of parent (0–100, one decimal); depth first, children by size descending.
  - CSV: UTF-8 with a BOM, CRLF, RFC 4180, no row limit. Excel: sheets Tree, Top files (1,000 rows), Types, Age; bold frozen header; numbers as numbers, dates as dates; hard cap of 1,048,575 data rows on Tree (`truncated`); inline strings only; deflate with data descriptors; no ZIP64 (fail clearly past 4 GiB).
  - Formula injection: a text cell that starts with `=`, `+`, `-`, `@`, a tab or a CR gets a leading `'` in both CSV outputs; numbers never; Excel cells are inline strings, never formulas.
  - Speed: the 1M-file fixture exports to CSV in under 10 s and to Excel in under 20 s.
- **Environment quirks (Windows):**
  - Run Vitest and npm through PowerShell, not Git Bash (Git Bash breaks Vitest): `powershell.exe -NoProfile -Command "npx vitest run <path>"`.
  - In Git Bash, heredocs and Python edits mangle backslashes: write files with the editor, not with `cat <<EOF`.
  - Before launching Electron (E2E): `Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue`. E2E needs an interactive desktop session and builds first (`npm run build`). **Never show the owner a modal dialog:** the E2E tests replace `dialog.showSaveDialog` (`stubSaveDialog`).
  - Gates, run at the end of every task that touches code: `npm run typecheck`, `npm run lint`, `npm run format:check`.
  - `src/main/shell-menu/win-shell-menu.native.test.ts` is timing-sensitive and can fail in a full parallel run; if it is the only failure, run it alone.
  - Perf output is printed with `npx vitest run --config vitest.perf.config.mts --reporter=verbose --disable-console-intercept`.
- Commits: one per task (Task 9 has two), conventional-commit message, **no AI attribution trailer** (no `Co-Authored-By`, no "Generated with" line). Stage **explicit paths only** (`git add <path> …`); never `git add -A`, `git add .` or `git commit -a`.

## Decisions made while planning (spec ambiguities and errors)

1. **"Other extensions" has no category.** The spec says the row "counts under the category its scanner row reports", but the scanner gives it `category: null` (it sums many extensions). It counts as **Other** in the donut (`categoryTotals`).
2. **The chart panel is 420 px wide, not 240.** A 160 px donut with its legend beside it cannot fit in 240 px. The panel is `@[720px]:w-[420px]`; the 720 px switch to "chart above the table" is unchanged (a container query on the pane, not a media query).
3. **One `chartVisible` flag** serves both Types and Age (the spec says "kept in the workspace store, like `paneTab`"): in memory, not persisted, like every view setting today.
4. **Tree row order:** children by logical size descending; on a tie, folders come before files, then scan order. "% of parent" uses logical size whatever the Mode. The first level's parent is the exported folder.
5. **The Top files sheet ranks by logical size**, not by the Mode (an export must not depend on a toggle in the ribbon). It still has the view's 1,000 rows and columns.
6. **Export is enabled only when `phase === 'done'`** (a cancelled scan is a partial tree; the spec says "finished scan"). Main also refuses while a scan runs, and runs one export at a time (`EXPORT_RUNNING_MESSAGE`), so a second window or a fast double click cannot open two dialogs.
7. **The exported folder is the pane folder** (`treemapRootId`). The file name uses its name with the characters Windows refuses removed (the root `D:\` gives `D - StorageIQ.csv`; an empty name gives `Export - StorageIQ.csv`).
8. **The scanner opens the file first** and waits for it, so a file that is open in Excel fails at once with a calm message (`EBUSY`/`EPERM`/`EACCES` become "The file is open in another program, or StorageIQ is not allowed to write there."; `ENOSPC` becomes "There is not enough free space to save the file."). A file that was opened and then failed is deleted; a file that could not be opened is never touched.
9. **zlib level 1 for the workbook.** Level 6 took 15 s for 1M rows; level 1 takes 8.6 s and the file is 60 MB instead of 45 MB. Rows are also built without `path.join` (a million calls) and column names are remembered.
10. **Whole-number cells use the `0` number format** (style 3), because Excel's General format shows a 13-digit byte count as `1.23E+12`. Dates use the custom format `yyyy-mm-dd hh:mm:ss`.
11. **Shared code moved to `@shared`:** `csv.ts` (`Cell`, `csvField`, `csvLine`, `toCsv`, BOM) and `side-view-columns.ts` (labels and the column lists of the three views). Dates are `Date` cells, so the old `isoDate` helper is gone. `side-view-model.ts` re-exports the labels, so existing imports keep working.
12. **The formula prefix also applies to Copy as CSV** (spec §3.3). A known cost: a file called `-draft.txt` is written as `'-draft.txt` in a CSV. The Excel export is not affected.
13. **Side-view fetchers no longer swallow errors** (spec §4.1): `fetchTopFiles`, `fetchTypes` and `fetchAges` reject, `useSideView` has an `error` state with `retry()`, and only a `null` answer means "gone".
14. **"Exporting…" appears as soon as the command is pressed**, which includes the time the save dialog is open, so a second dialog can never be started. It is cleared when the dialog is cancelled.
15. **The success banner is a `role="status"`**, errors stay `role="alert"`. "Show in folder" is not clicked in E2E (it would open an Explorer window); the unit tests cover `shell:show-export`.
16. **Not verified in Microsoft Excel itself** (none on the dev machine). The workbook follows the minimal OOXML parts (content types, rels, workbook, styles, worksheets) and the unit tests re-read it with an independent ZIP reader (central directory, CRC-32, descriptors).

## File Map

| File                                                                                                                                                                                            | Responsibility                                                          | Task |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---- |
| `src/shared/csv.ts`, `src/shared/side-view-columns.ts` (+ test), `src/renderer/src/lib/csv.ts`, `side-view-model.ts`                                                                            | CSV writing with the formula rule; list columns shared with the export  | 1    |
| `lib/use-side-view.ts`, `components/SideViewParts.tsx`, `TopFilesView.tsx`, `TypesView.tsx`, `AgeView.tsx`, `stores/workspace-store.ts` (+ tests)                                               | Failed load vs missing folder; Top files selection reset                | 2    |
| `lib/chart-geometry.ts`, `lib/side-view-model.ts` (+ tests)                                                                                                                                     | Pie slices, donut path, bar lengths, category totals, chart summaries   | 3    |
| `src/worker/scanner/xlsx-writer.ts`, `test/unzip.ts` (+ test)                                                                                                                                   | Streaming ZIP and workbook writer                                       | 4    |
| `src/shared/scanner-protocol.ts`, `src/worker/scanner/export-tree.ts`, `scanner-host.ts`, `tree-store.perf.test.ts` (+ tests)                                                                   | `export` query, tree rows, CSV and Excel files, perf cases              | 5    |
| `src/shared/ipc-contract.ts`, `src/main/ipc/parse-args.ts`, `export-handlers.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/test/fake-api.ts`, `e2e/app.spec.ts` (+ tests) | `export:run`, `shell:show-export`, bridge methods                       | 6    |
| `stores/workspace-store.ts`, `components/Ribbon.tsx`, `Banner.tsx`, `StatusBar.tsx`, `lib/icons.ts` (+ tests)                                                                                   | Export commands, "Exporting…", success and error banners                | 7    |
| `components/ChartParts.tsx`, `TypesChart.tsx`, `AgeChart.tsx`, `TypesView.tsx`, `AgeView.tsx`, `stores/workspace-store.ts` (+ tests)                                                            | Donut, bars, Chart toggle and layout                                    | 8    |
| `e2e/export.spec.ts`, `e2e/support/*`, `docs/ROADMAP.md`, `CHANGELOG.md`                                                                                                                        | End-to-end tests with the save dialog stubbed, Phase 5 checklist, notes | 9    |

(Paths in the middle rows without a prefix are under `src/renderer/src/`.)

---

### Task 1: A shared CSV writer that neutralizes spreadsheet formulas

**Implementer tier:** Haiku (all code and tests are in the plan).

**Files:**

- Modify: `src/renderer/src/lib/csv.test.ts`
- Modify: `src/renderer/src/lib/csv.ts`
- Modify: `src/renderer/src/lib/side-view-model.ts`
- Create: `src/shared/csv.test.ts`
- Create: `src/shared/csv.ts`
- Create: `src/shared/side-view-columns.ts`

**Interfaces:**

- Consumes: `TopFileRow`, `TypeRow`, `AgeRow` (`@shared/tree-types`), `CATEGORY_LABELS` (`@shared/file-category`).
- Produces (`@shared/csv`): `type Cell = string | number | Date | null`, `CSV_BOM`, `csvField(value: Cell): string`, `csvLine(fields: readonly Cell[]): string` (CRLF-terminated), `toCsv(header: readonly string[], rows: ReadonlyArray<readonly Cell[]>): string`.
- Produces (`@shared/side-view-columns`): `typeLabel`, `typeCategoryLabel`, `NO_EXTENSION_LABEL`, `OTHER_EXTENSIONS_LABEL`, `dateCell(ms: number): Date | null`, `interface ListColumns<T> { header: readonly string[]; cells(row: T): Cell[] }`, and `TOP_FILES_COLUMNS`, `TYPES_COLUMNS`, `AGE_COLUMNS`.
- The renderer's `lib/csv.ts` keeps `topFilesCsv`, `typesCsv`, `ageCsv`, `csvField`, `toCsv`; `lib/side-view-model.ts` re-exports the four label items, so no caller changes. `isoDate` is removed (nothing used it outside its test).

The renderer's old `csvField` and `isoDate` tests are replaced by the new `src/shared/csv.test.ts`. The `lib/csv.test.ts` diff below only drops them.

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/lib/csv.test.ts`:

```diff
--- a/src/renderer/src/lib/csv.test.ts
+++ b/src/renderer/src/lib/csv.test.ts
@@ -1,36 +1,7 @@
 import { describe, expect, it } from 'vitest'
-import { ageCsv, csvField, isoDate, toCsv, topFilesCsv, typesCsv } from './csv'
+import { ageCsv, topFilesCsv, typesCsv } from './csv'
 import { TEST_AGE, TEST_TOP_FILES, TEST_TYPES } from '../test/fake-api'

-describe('csvField', () => {
-  it('leaves plain text and numbers alone', () => {
-    expect(csvField('movie.mp4')).toBe('movie.mp4')
-    expect(csvField(1536)).toBe('1536')
-    expect(csvField('')).toBe('')
-  })
-
-  it('quotes a field with a comma, a quote or a line break, and doubles the quotes', () => {
-    expect(csvField('holiday, 2025.jpg')).toBe('"holiday, 2025.jpg"')
-    expect(csvField('say "hi"')).toBe('"say ""hi"""')
-    expect(csvField('a\nb')).toBe('"a\nb"')
-    expect(csvField('a\r\nb')).toBe('"a\r\nb"')
-  })
-})
-
-describe('toCsv', () => {
-  it('writes a header and one CRLF-terminated line per row', () => {
-    expect(toCsv(['A', 'B'], [['x', 1]])).toBe('A,B\r\nx,1\r\n')
-    expect(toCsv(['A'], [])).toBe('A\r\n')
-  })
-})
-
-describe('isoDate', () => {
-  it('is ISO 8601 in UTC, and empty for an unknown date', () => {
-    expect(isoDate(Date.UTC(2026, 10, 19, 12))).toBe('2026-11-19T12:00:00.000Z')
-    expect(isoDate(0)).toBe('')
-  })
-})
-
 describe('the list CSVs', () => {
   it('Top files: name, folder, raw bytes and ISO dates', () => {
     expect(topFilesCsv(TEST_TOP_FILES)).toBe(
```

`src/shared/csv.test.ts` (new):

```ts
import { describe, expect, it } from 'vitest'
import { csvField, csvLine, toCsv } from './csv'

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

  it('writes a date as ISO 8601 in UTC and an empty cell as nothing', () => {
    expect(csvField(new Date(Date.UTC(2026, 10, 19, 12)))).toBe('2026-11-19T12:00:00.000Z')
    expect(csvField(null)).toBe('')
  })

  it('prefixes text that a spreadsheet could read as a formula, but never numbers', () => {
    expect(csvField('=1+1')).toBe("'=1+1")
    expect(csvField('+SUM(A1)')).toBe("'+SUM(A1)")
    expect(csvField('-2')).toBe("'-2")
    expect(csvField('@cmd')).toBe("'@cmd")
    expect(csvField('\tx')).toBe("'\tx")
    expect(csvField('\rx')).toBe('"\'\rx"')
    expect(csvField('a=b')).toBe('a=b')
    expect(csvField(-5)).toBe('-5')
    expect(csvField('=HYPERLINK("x","y")')).toBe('"\'=HYPERLINK(""x"",""y"")"')
  })
})

describe('toCsv and csvLine', () => {
  it('writes a header and one CRLF-terminated line per row', () => {
    expect(toCsv(['A', 'B'], [['x', 1]])).toBe('A,B\r\nx,1\r\n')
    expect(toCsv(['A'], [])).toBe('A\r\n')
    expect(csvLine(['a', null, 2])).toBe('a,,2\r\n')
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/shared/csv.test.ts src/renderer/src/lib"`
Expected: FAIL: `./csv` and `@shared/csv` do not export the new functions.

- [ ] **Step 3: Implement**

`src/renderer/src/lib/csv.ts`:

```diff
--- a/src/renderer/src/lib/csv.ts
+++ b/src/renderer/src/lib/csv.ts
@@ -1,47 +1,32 @@
+import { toCsv } from '@shared/csv'
+import { AGE_COLUMNS, TOP_FILES_COLUMNS, TYPES_COLUMNS } from '@shared/side-view-columns'
 import type { AgeRow, TopFileRow, TypeRow } from '@shared/tree-types'
-import { typeCategoryLabel, typeLabel } from './side-view-model'

-/** One CSV field (RFC 4180): quoted when it holds a comma, a quote or a line break. */
-export function csvField(value: string | number): string {
-  const text = String(value)
-  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
-}
-
-/** A header row and the rows, comma separated, one per line (CRLF), with a final line break. */
-export function toCsv(
-  header: readonly string[],
-  rows: ReadonlyArray<ReadonlyArray<string | number>>,
-): string {
-  return [header, ...rows].map((fields) => fields.map(csvField).join(',')).join('\r\n') + '\r\n'
-}
-
-/** ISO 8601 in UTC (`2026-11-19T12:00:00.000Z`); `''` when the date is unknown. */
-export function isoDate(ms: number): string {
-  return ms > 0 ? new Date(ms).toISOString() : ''
-}
+export { csvField, toCsv } from '@shared/csv'

 /**
- * The CSV of each list view. Sizes are raw byte counts and dates are ISO 8601, so a spreadsheet
- * can sort and add them. Values are copied as they are: a file name that starts with `=`, `+`,
- * `-` or `@` is not changed, so a spreadsheet may read it as a formula.
+ * The CSV of each list view (the columns are shared with the Excel export). Sizes are raw byte
+ * counts and dates are ISO 8601 UTC, so a spreadsheet can sort and add them. A text value that a
+ * spreadsheet could read as a formula (it starts with `=`, `+`, `-`, `@`, a tab or a CR) gets a
+ * leading `'`.
  */
 export function topFilesCsv(rows: readonly TopFileRow[]): string {
   return toCsv(
-    ['Name', 'Folder', 'Size (bytes)', 'Allocated (bytes)', 'Modified (UTC)'],
-    rows.map((row) => [row.name, row.folder, row.size, row.allocated, isoDate(row.modifiedMs)]),
+    TOP_FILES_COLUMNS.header,
+    rows.map((row) => TOP_FILES_COLUMNS.cells(row)),
   )
 }

 export function typesCsv(rows: readonly TypeRow[]): string {
   return toCsv(
-    ['Extension', 'Category', 'Size (bytes)', 'Allocated (bytes)', 'Files'],
-    rows.map((row) => [typeLabel(row), typeCategoryLabel(row), row.size, row.allocated, row.files]),
+    TYPES_COLUMNS.header,
+    rows.map((row) => TYPES_COLUMNS.cells(row)),
   )
 }

 export function ageCsv(rows: readonly AgeRow[]): string {
   return toCsv(
-    ['Age', 'Size (bytes)', 'Allocated (bytes)', 'Files'],
-    rows.map((row) => [row.label, row.size, row.allocated, row.files]),
+    AGE_COLUMNS.header,
+    rows.map((row) => AGE_COLUMNS.cells(row)),
   )
 }
```

`src/renderer/src/lib/side-view-model.ts`:

```diff
--- a/src/renderer/src/lib/side-view-model.ts
+++ b/src/renderer/src/lib/side-view-model.ts
@@ -1,26 +1,17 @@
-import { CATEGORY_LABELS } from '@shared/file-category'
 import type { TypeRow } from '@shared/tree-types'

-export const NO_EXTENSION_LABEL = '(no extension)'
-export const OTHER_EXTENSIONS_LABEL = 'Other extensions'
+export {
+  NO_EXTENSION_LABEL,
+  OTHER_EXTENSIONS_LABEL,
+  typeCategoryLabel,
+  typeLabel,
+} from '@shared/side-view-columns'

 /** Most icon keys one `icons:for-types` call takes (the same limit as main). */
 export const MAX_TYPE_ICON_KEYS = 64
 /** The extension part of an icon key that main accepts (main's `ICON_TYPE_KEY_PATTERN`). */
 const ICON_EXTENSION = /^[a-z0-9_$~-]{1,16}$/

-/** The text of a Types row: `.jpg`, `(no extension)` or `Other extensions`. */
-export function typeLabel(row: Pick<TypeRow, 'kind' | 'ext'>): string {
-  if (row.kind === 'none') return NO_EXTENSION_LABEL
-  if (row.kind === 'other') return OTHER_EXTENSIONS_LABEL
-  return `.${row.ext}`
-}
-
-/** The file type name of a Types row; `''` for the "Other extensions" row. */
-export function typeCategoryLabel(row: Pick<TypeRow, 'category'>): string {
-  return row.category === null ? '' : CATEGORY_LABELS[row.category]
-}
-
 /** The icon key of a Types row (`ext:jpg`, `file`), or null when it has no icon to ask for. */
 export function typeIconKey(row: Pick<TypeRow, 'kind' | 'ext'>): string | null {
   if (row.kind === 'none') return 'file'
```

`src/shared/csv.ts` (new):

```ts
/** One spreadsheet cell: text, a number, a date (UTC), or empty. */
export type Cell = string | number | Date | null

/** UTF-8 byte order mark: Excel needs it to open a UTF-8 CSV with the right characters. */
export const CSV_BOM = '﻿'

/** Text that starts with one of these is read by a spreadsheet as a formula (OWASP). */
const FORMULA_START = /^[=+\-@\t\r]/

/**
 * One CSV field (RFC 4180): quoted when it holds a comma, a quote or a line break. A text cell that
 * could be read as a formula gets a leading `'`; numbers are never changed. Dates are ISO 8601 in
 * UTC (`2026-11-19T12:00:00.000Z`), and an empty cell is empty.
 */
export function csvField(value: Cell): string {
  if (value === null) return ''
  if (value instanceof Date) return value.toISOString()
  const text = typeof value === 'string' && FORMULA_START.test(value) ? `'${value}` : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** One CSV line, CRLF-terminated. */
export function csvLine(fields: readonly Cell[]): string {
  return fields.map(csvField).join(',') + '\r\n'
}

/** A header row and the rows, comma separated, one per line (CRLF), with a final line break. */
export function toCsv(header: readonly string[], rows: ReadonlyArray<readonly Cell[]>): string {
  return [header, ...rows].map(csvLine).join('')
}
```

`src/shared/side-view-columns.ts` (new):

```ts
import type { Cell } from './csv'
import { CATEGORY_LABELS } from './file-category'
import type { AgeRow, TopFileRow, TypeRow } from './tree-types'

export const NO_EXTENSION_LABEL = '(no extension)'
export const OTHER_EXTENSIONS_LABEL = 'Other extensions'

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

/** A modification time as a UTC date; empty when unknown (0). */
export const dateCell = (ms: number): Date | null => (ms > 0 ? new Date(ms) : null)

/** The columns of a list view as a table: the Copy as CSV text and the Excel sheets share them. */
export interface ListColumns<T> {
  header: readonly string[]
  cells(row: T): Cell[]
}

/** Sizes are raw byte counts, so a spreadsheet can sort and add them. */
export const TOP_FILES_COLUMNS: ListColumns<TopFileRow> = {
  header: ['Name', 'Folder', 'Size (bytes)', 'Allocated (bytes)', 'Modified (UTC)'],
  cells: (row) => [row.name, row.folder, row.size, row.allocated, dateCell(row.modifiedMs)],
}

export const TYPES_COLUMNS: ListColumns<TypeRow> = {
  header: ['Extension', 'Category', 'Size (bytes)', 'Allocated (bytes)', 'Files'],
  cells: (row) => [typeLabel(row), typeCategoryLabel(row), row.size, row.allocated, row.files],
}

export const AGE_COLUMNS: ListColumns<AgeRow> = {
  header: ['Age', 'Size (bytes)', 'Allocated (bytes)', 'Files'],
  cells: (row) => [row.label, row.size, row.allocated, row.files],
}
```

- [ ] **Step 4: Run the tests and the gates**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/shared/csv.test.ts src/renderer/src/lib"`
Expected: PASS.

Then: `powershell.exe -NoProfile -Command "npm run typecheck; npm run lint; npm run format:check"` (clean).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/csv.test.ts src/renderer/src/lib/csv.ts src/renderer/src/lib/side-view-model.ts src/shared/csv.test.ts src/shared/csv.ts src/shared/side-view-columns.ts
git commit -m "feat(csv): shared CSV writer that neutralizes spreadsheet formulas"
```

---

### Task 2: Phase 4 minors: a failed load is not a missing folder, and Top files forgets its selection

**Implementer tier:** Sonnet (touches the hook, the store and three views).

**Files:**

- Modify: `src/renderer/src/components/AgeView.tsx`
- Modify: `src/renderer/src/components/SideViewParts.tsx`
- Modify: `src/renderer/src/components/TopFilesView.test.tsx`
- Modify: `src/renderer/src/components/TopFilesView.tsx`
- Modify: `src/renderer/src/components/TypesView.test.tsx`
- Modify: `src/renderer/src/components/TypesView.tsx`
- Modify: `src/renderer/src/lib/use-side-view.test.tsx`
- Modify: `src/renderer/src/lib/use-side-view.ts`
- Modify: `src/renderer/src/stores/workspace-store-side-views.test.ts`
- Modify: `src/renderer/src/stores/workspace-store.ts`

**Interfaces:**

- Consumes: `useSideView(fetch, extraKey)` and the three `fetch*` store actions from Phase 4.
- Produces: `SideViewState<T>` gains `{ status: 'error' }`; `useSideView` returns `SideViewState<T> & { retry(): void }`. `fetchTopFiles`, `fetchTypes`, `fetchAges` now **reject** when the bridge call fails and still answer `null` before a scan or when the node is gone. `SideViewError({ onRetry })` and `LOAD_ERROR_TEXT = 'Couldn’t load this view.'` in `SideViewParts.tsx`.

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/components/TopFilesView.test.tsx`:

```diff
--- a/src/renderer/src/components/TopFilesView.test.tsx
+++ b/src/renderer/src/components/TopFilesView.test.tsx
@@ -7,6 +7,7 @@ import { formatDate, formatSize } from '../lib/format'
 import { GONE_MESSAGE } from '../stores/workspace-store'
 import { createFakeApi, TEST_TOP_FILES } from '../test/fake-api'
 import { renderWithStores } from '../test/render'
+import { LOAD_ERROR_TEXT } from './SideViewParts'
 import { SINGLE_ITEM_MESSAGE } from './TreeGrid'
 import { NO_FILES_TEXT, TopFilesView } from './TopFilesView'

@@ -75,6 +76,28 @@ describe('<TopFilesView />', () => {
     expect(await screen.findByText(GONE_MESSAGE)).toBeInTheDocument()
   })

+  it('clears the selection when the folder changes', async () => {
+    const { workspace } = await renderView()
+    fireEvent.click(row(/movie\.mp4/))
+    expect(row(/movie\.mp4/)).toHaveAttribute('aria-selected', 'true')
+    act(() => workspace.getState().select('d2'))
+    await waitFor(() => expect(row(/movie\.mp4/)).toHaveAttribute('aria-selected', 'false'))
+  })
+
+  it('says the view could not load when the call fails', async () => {
+    const utils = renderWithStores(
+      <TopFilesView height={260} />,
+      createFakeApi({
+        getTopFiles: vi.fn(async () => {
+          throw new Error('scanner busy')
+        }),
+      }),
+    )
+    await act(() => utils.workspace.getState().startScan('D:\\'))
+    expect(await screen.findByText(LOAD_ERROR_TEXT)).toBeInTheDocument()
+    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
+  })
+
   it('says so when the folder has no files', async () => {
     const utils = renderWithStores(
       <TopFilesView height={260} />,
```

`src/renderer/src/components/TypesView.test.tsx`:

```diff
--- a/src/renderer/src/components/TypesView.test.tsx
+++ b/src/renderer/src/components/TypesView.test.tsx
@@ -7,6 +7,7 @@ import { formatCount, formatShare, formatSize } from '../lib/format'
 import { GONE_MESSAGE } from '../stores/workspace-store'
 import { createFakeApi, TEST_TYPES } from '../test/fake-api'
 import { renderWithStores } from '../test/render'
+import { LOAD_ERROR_TEXT } from './SideViewParts'
 import { NO_TYPES_TEXT, TypesView } from './TypesView'

 async function renderView(api = createFakeApi()) {
@@ -57,6 +58,20 @@ describe('<TypesView />', () => {
     expect(within(table()).getAllByRole('row')).toHaveLength(1 + TEST_TYPES.length)
   })

+  it('says the view could not load when the call fails, and Try again loads it', async () => {
+    const user = userEvent.setup()
+    const getTypeBreakdown = vi
+      .fn<() => Promise<typeof TEST_TYPES | null>>()
+      .mockRejectedValueOnce(new Error('scanner busy'))
+      .mockResolvedValue(TEST_TYPES)
+    const utils = renderWithStores(<TypesView height={260} />, createFakeApi({ getTypeBreakdown }))
+    await act(() => utils.workspace.getState().startScan('D:\\'))
+    expect(await screen.findByText(LOAD_ERROR_TEXT)).toBeInTheDocument()
+    expect(screen.queryByText(GONE_MESSAGE)).not.toBeInTheDocument()
+    await user.click(screen.getByRole('button', { name: 'Try again' }))
+    expect(await screen.findByRole('row', { name: /\.mp4/ })).toBeInTheDocument()
+  })
+
   it('shows the colour of each file type and no colour for "Other extensions"', async () => {
     const api = createFakeApi({
       getTypeBreakdown: vi.fn(async () => [
```

`src/renderer/src/lib/use-side-view.test.tsx`:

```diff
--- a/src/renderer/src/lib/use-side-view.test.tsx
+++ b/src/renderer/src/lib/use-side-view.test.tsx
@@ -12,7 +12,14 @@ function Probe({
   extraKey?: string
 }) {
   const state = useSideView(fetch, extraKey)
-  return <p data-testid="state">{state.status === 'ready' ? state.rows.join(',') : state.status}</p>
+  return (
+    <>
+      <p data-testid="state">{state.status === 'ready' ? state.rows.join(',') : state.status}</p>
+      <button type="button" onClick={state.retry}>
+        retry
+      </button>
+    </>
+  )
 }

 const shown = () => screen.getByTestId('state').textContent
@@ -33,6 +40,18 @@ describe('useSideView', () => {
     await waitFor(() => expect(shown()).toBe('gone'))
   })

+  it('shows "error" when the call fails, and retry asks again', async () => {
+    const fetch = vi
+      .fn<() => Promise<string[] | null>>()
+      .mockRejectedValueOnce(new Error('scanner busy'))
+      .mockResolvedValue(['ok'])
+    const { workspace } = renderWithStores(<Probe fetch={fetch} />)
+    await act(() => workspace.getState().startScan('D:\\'))
+    await waitFor(() => expect(shown()).toBe('error'))
+    act(() => screen.getByRole('button', { name: 'retry' }).click())
+    await waitFor(() => expect(shown()).toBe('ok'))
+  })
+
   it('asks again when the folder or the tree revision changes', async () => {
     const fetch = vi.fn(async () => ['a'])
     const { workspace } = renderWithStores(<Probe fetch={fetch} />)
```

`src/renderer/src/stores/workspace-store-side-views.test.ts`:

```diff
--- a/src/renderer/src/stores/workspace-store-side-views.test.ts
+++ b/src/renderer/src/stores/workspace-store-side-views.test.ts
@@ -50,7 +50,7 @@ describe('fetching the side views', () => {
     expect(api.getAgeBreakdown).toHaveBeenLastCalledWith('scan-1', 'd1')
   })

-  it('answers null before a scan, when the node is gone and when the call fails', async () => {
+  it('answers null before a scan and when the node is gone', async () => {
     const idle = createWorkspaceStore(createFakeApi())
     expect(await idle.getState().fetchTopFiles()).toBeNull()
     expect(await idle.getState().fetchTypes()).toBeNull()
@@ -58,7 +58,9 @@ describe('fetching the side views', () => {

     const gone = await scanning(createFakeApi({ getTypeBreakdown: vi.fn(async () => null) }))
     expect(await gone.store.getState().fetchTypes()).toBeNull()
+  })

+  it('lets a failed call reject, so a view can tell "failed" from "gone"', async () => {
     const broken = await scanning(
       createFakeApi({
         getTopFiles: vi.fn(async () => {
@@ -66,7 +68,7 @@ describe('fetching the side views', () => {
         }),
       }),
     )
-    expect(await broken.store.getState().fetchTopFiles()).toBeNull()
+    await expect(broken.store.getState().fetchTopFiles()).rejects.toThrow('scanner busy')
   })

   it('loadTypeIcons asks for the keys, and answers empty for no keys or a failed call', async () => {
```

- [ ] **Step 2: Run them and watch them fail**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/renderer"`
Expected: FAIL: `LOAD_ERROR_TEXT` is not exported, `retry` is undefined, the store fetchers still answer null on a failed call, the selection stays after `select('d2')`.

- [ ] **Step 3: Implement**

`src/renderer/src/components/AgeView.tsx`:

```diff
--- a/src/renderer/src/components/AgeView.tsx
+++ b/src/renderer/src/components/AgeView.tsx
@@ -6,7 +6,14 @@ import { GONE_MESSAGE } from '../stores/workspace-store'
 import { useWorkspace } from '../stores/workspace-store-context'
 import { CopyCsvButton } from './CopyCsvButton'
 import { PaneShell } from './PaneShell'
-import { PaneMessage, ScanningNote, ShareBar, SIDE_ROW_CLASS, SideViewTable } from './SideViewParts'
+import {
+  PaneMessage,
+  ScanningNote,
+  ShareBar,
+  SIDE_ROW_CLASS,
+  SideViewError,
+  SideViewTable,
+} from './SideViewParts'

 const COLUMNS = [
   { label: 'Age' },
@@ -38,6 +45,7 @@ export function AgeView({ height }: { height: number }) {
     >
       <ScanningNote />
       {state.status === 'gone' && <PaneMessage>{GONE_MESSAGE}</PaneMessage>}
+      {state.status === 'error' && <SideViewError onRetry={state.retry} />}
       {rows !== null && (
         <SideViewTable label="File age in this folder" columns={COLUMNS}>
           {rows.map((row) => (
```

`src/renderer/src/components/SideViewParts.tsx`:

```diff
--- a/src/renderer/src/components/SideViewParts.tsx
+++ b/src/renderer/src/components/SideViewParts.tsx
@@ -1,6 +1,7 @@
 import type { ReactNode } from 'react'
 import { formatShare } from '../lib/format'
 import { useWorkspace } from '../stores/workspace-store-context'
+import { Button } from './Button'

 /** Row height of the side-view tables (the same as the folder tree's rows). */
 export const SIDE_ROW_CLASS = 'h-[30px]'
@@ -39,6 +40,20 @@ export function PaneMessage({ children }: { children: ReactNode }) {
   return <p className="px-4 py-3 text-ink-muted">{children}</p>
 }

+export const LOAD_ERROR_TEXT = 'Couldn’t load this view.'
+
+/** The view could not be loaded (the scanner did not answer): say so and offer to ask again. */
+export function SideViewError({ onRetry }: { onRetry(): void }) {
+  return (
+    <div className="flex items-center gap-3 px-4 py-3 text-ink-muted">
+      <p>{LOAD_ERROR_TEXT}</p>
+      <Button variant="secondary" onClick={onRetry}>
+        Try again
+      </Button>
+    </div>
+  )
+}
+
 export interface TableColumn {
   label: string
   numeric?: boolean
```

`src/renderer/src/components/TopFilesView.tsx`:

```diff
--- a/src/renderer/src/components/TopFilesView.tsx
+++ b/src/renderer/src/components/TopFilesView.tsx
@@ -18,7 +18,8 @@ import { useWorkspace } from '../stores/workspace-store-context'
 import { CopyCsvButton } from './CopyCsvButton'
 import { FileIcon } from './FileIcon'
 import { PaneShell } from './PaneShell'
-import { ScanningNote } from './SideViewParts'
+import { Button } from './Button'
+import { LOAD_ERROR_TEXT, ScanningNote } from './SideViewParts'
 import { SINGLE_ITEM_MESSAGE, TREE_ROW_HEIGHT } from './TreeGrid'

 const OVERSCAN = 10
@@ -49,6 +50,7 @@ export function topRowDomId(id: NodeId): string {
  */
 export function TopFilesView({ height }: { height: number }) {
   const scanId = useWorkspace((s) => s.scanId)
+  const treemapRootId = useWorkspace((s) => s.treemapRootId)
   const mode = useWorkspace((s) => s.mode)
   const unit = useWorkspace((s) => s.unit)
   const fetchTopFiles = useWorkspace((s) => s.fetchTopFiles)
@@ -90,6 +92,11 @@ export function TopFilesView({ height }: { height: number }) {
     iconCache.request(scanId, ids.slice(first, last + 1))
   }, [scanId, iconCache, ids, first, last])

+  // The rows belong to one folder of one scan: a selection never outlives them.
+  useEffect(() => {
+    setSelection(NO_SELECTION)
+  }, [scanId, treemapRootId])
+
   const activeIndex = selection.activeId === null ? -1 : ids.indexOf(selection.activeId)

   const ensureVisible = (index: number) => {
@@ -245,12 +252,19 @@ export function TopFilesView({ height }: { height: number }) {

   const ranked = mode === 'allocated' ? 'Allocated' : 'Size'
   const activeRendered = activeIndex >= first && activeIndex <= last
-  const message =
-    state.status === 'gone'
-      ? GONE_MESSAGE
-      : state.status === 'ready' && rows.length === 0
-        ? NO_FILES_TEXT
-        : null
+  const message: ReactNode =
+    state.status === 'gone' ? (
+      GONE_MESSAGE
+    ) : state.status === 'error' ? (
+      <>
+        <span>{LOAD_ERROR_TEXT}</span>
+        <Button variant="secondary" onClick={state.retry}>
+          Try again
+        </Button>
+      </>
+    ) : state.status === 'ready' && rows.length === 0 ? (
+      NO_FILES_TEXT
+    ) : null

   return (
     <PaneShell
@@ -307,9 +321,9 @@ export function TopFilesView({ height }: { height: number }) {
         >
           {message !== null ? (
             <div role="row">
-              <p role="gridcell" className="px-4 py-3 text-ink-muted">
+              <div role="gridcell" className="flex items-center gap-3 px-4 py-3 text-ink-muted">
                 {message}
-              </p>
+              </div>
             </div>
           ) : (
             <div className="relative" style={{ height: rows.length * TREE_ROW_HEIGHT }}>
```

`src/renderer/src/components/TypesView.tsx`:

```diff
--- a/src/renderer/src/components/TypesView.tsx
+++ b/src/renderer/src/components/TypesView.tsx
@@ -16,7 +16,14 @@ import { useWorkspace } from '../stores/workspace-store-context'
 import { CopyCsvButton } from './CopyCsvButton'
 import { LARGE_ICON_MIN_DPR } from './FileIcon'
 import { PaneShell } from './PaneShell'
-import { PaneMessage, ScanningNote, ShareBar, SIDE_ROW_CLASS, SideViewTable } from './SideViewParts'
+import {
+  PaneMessage,
+  ScanningNote,
+  ShareBar,
+  SIDE_ROW_CLASS,
+  SideViewError,
+  SideViewTable,
+} from './SideViewParts'
 import { CategorySwatch } from './TreemapLegend'

 export const NO_TYPES_TEXT = 'There are no files in this folder.'
@@ -91,6 +98,7 @@ export function TypesView({ height }: { height: number }) {
     >
       <ScanningNote />
       {state.status === 'gone' && <PaneMessage>{GONE_MESSAGE}</PaneMessage>}
+      {state.status === 'error' && <SideViewError onRetry={state.retry} />}
       {rows !== null && rows.length === 0 && <PaneMessage>{NO_TYPES_TEXT}</PaneMessage>}
       {rows !== null && rows.length > 0 && (
         <SideViewTable label="File types in this folder" columns={COLUMNS}>
```

`src/renderer/src/lib/use-side-view.ts`:

```diff
--- a/src/renderer/src/lib/use-side-view.ts
+++ b/src/renderer/src/lib/use-side-view.ts
@@ -1,9 +1,12 @@
 import { useEffect, useState } from 'react'
 import { useWorkspace } from '../stores/workspace-store-context'

-/** What a side view has: nothing yet, the rows, or "that folder no longer exists". */
+/**
+ * What a side view has: nothing yet, the rows, "that folder no longer exists" (the scanner
+ * answered `null`), or "the call failed" (the scanner did not answer; `retry` asks again).
+ */
 export type SideViewState<T> =
-  { status: 'loading' } | { status: 'ready'; rows: T[] } | { status: 'gone' }
+  { status: 'loading' } | { status: 'ready'; rows: T[] } | { status: 'gone' } | { status: 'error' }

 /**
  * Loads a side view for the treemap folder of the current scan, and again whenever the folder,
@@ -11,11 +14,15 @@ export type SideViewState<T> =
  * `extraKey` does (the Mode, for Top files). The rows of the previous answer stay on screen until
  * the new one arrives, and an answer that is no longer the newest is dropped.
  */
-export function useSideView<T>(fetch: () => Promise<T[] | null>, extraKey = ''): SideViewState<T> {
+export function useSideView<T>(
+  fetch: () => Promise<T[] | null>,
+  extraKey = '',
+): SideViewState<T> & { retry(): void } {
   const scanId = useWorkspace((s) => s.scanId)
   const treemapRootId = useWorkspace((s) => s.treemapRootId)
   const revision = useWorkspace((s) => s.revision)
   const [state, setState] = useState<SideViewState<T>>({ status: 'loading' })
+  const [attempt, setAttempt] = useState(0)

   useEffect(() => {
     if (scanId === null || treemapRootId === null) {
@@ -23,13 +30,24 @@ export function useSideView<T>(fetch: () => Promise<T[] | null>, extraKey = ''):
       return
     }
     let current = true
-    void fetch().then((rows) => {
-      if (current) setState(rows === null ? { status: 'gone' } : { status: 'ready', rows })
-    })
+    fetch().then(
+      (rows) => {
+        if (current) setState(rows === null ? { status: 'gone' } : { status: 'ready', rows })
+      },
+      () => {
+        if (current) setState({ status: 'error' })
+      },
+    )
     return () => {
       current = false
     }
-  }, [scanId, treemapRootId, revision, extraKey, fetch])
+  }, [scanId, treemapRootId, revision, extraKey, fetch, attempt])

-  return state
+  return {
+    ...state,
+    retry: () => {
+      setState({ status: 'loading' })
+      setAttempt((count) => count + 1)
+    },
+  }
 }
```

`src/renderer/src/stores/workspace-store.ts`:

```diff
--- a/src/renderer/src/stores/workspace-store.ts
+++ b/src/renderer/src/stores/workspace-store.ts
@@ -821,31 +821,19 @@ export function createWorkspaceStore(api: StorageIQApi): WorkspaceStore {
       async fetchTopFiles() {
         const { scanId, treemapRootId, mode } = get()
         if (scanId === null || treemapRootId === null) return null
-        try {
-          return await api.getTopFiles(scanId, treemapRootId, mode)
-        } catch {
-          return null
-        }
+        return await api.getTopFiles(scanId, treemapRootId, mode)
       },

       async fetchTypes() {
         const { scanId, treemapRootId } = get()
         if (scanId === null || treemapRootId === null) return null
-        try {
-          return await api.getTypeBreakdown(scanId, treemapRootId)
-        } catch {
-          return null
-        }
+        return await api.getTypeBreakdown(scanId, treemapRootId)
       },

       async fetchAges() {
         const { scanId, treemapRootId } = get()
         if (scanId === null || treemapRootId === null) return null
-        try {
-          return await api.getAgeBreakdown(scanId, treemapRootId)
-        } catch {
-          return null
-        }
+        return await api.getAgeBreakdown(scanId, treemapRootId)
       },

       async loadTypeIcons(typeKeys) {
```

- [ ] **Step 4: Run the tests and the gates**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/renderer"`
Expected: PASS. All renderer tests (about 416) pass.

Then: `powershell.exe -NoProfile -Command "npm run typecheck; npm run lint; npm run format:check"` (clean).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/AgeView.tsx src/renderer/src/components/SideViewParts.tsx src/renderer/src/components/TopFilesView.test.tsx src/renderer/src/components/TopFilesView.tsx src/renderer/src/components/TypesView.test.tsx src/renderer/src/components/TypesView.tsx src/renderer/src/lib/use-side-view.test.tsx src/renderer/src/lib/use-side-view.ts src/renderer/src/stores/workspace-store-side-views.test.ts src/renderer/src/stores/workspace-store.ts
git commit -m "fix(side-views): say a failed load is not a missing folder, and drop stale Top files selection"
```

---

### Task 3: Chart geometry, category totals and chart summaries

**Implementer tier:** Haiku (all code and tests are in the plan).

**Files:**

- Create: `src/renderer/src/lib/chart-geometry.test.ts`
- Create: `src/renderer/src/lib/chart-geometry.ts`
- Modify: `src/renderer/src/lib/side-view-model.test.ts`
- Modify: `src/renderer/src/lib/side-view-model.ts`

**Interfaces:**

- Consumes: `CategoryShare { category: FileCategory; bytes: number }`, `FILE_CATEGORIES`, `TypeRow` from `@shared/tree-types`.
- Produces (`lib/chart-geometry.ts`): `MIN_SLICE_DEGREES = 1`; `interface PieSlice { index: number; share: number; startDeg: number; endDeg: number }`; `pieSlices(values: readonly number[]): PieSlice[]` (input order, clockwise from 12 o'clock, zero values skipped, sums to exactly 360°, every slice at least 1°); `donutPath(cx, cy, outer, inner, startDeg, endDeg): string`; `barLengths(values: readonly number[]): number[]` (fractions of the longest).
- Produces (`lib/side-view-model.ts`): `categoryTotals(rows: readonly TypeRow[]): CategoryShare[]` (per category, biggest first, no empty ones; a `null` category counts as `other`); `chartSummary(entries: ReadonlyArray<{ label: string; value: number }>): string` (`Video 53 %, Documents 29 %, Images 16 %`, or `No data`).

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/lib/chart-geometry.test.ts` (new):

```ts
import { describe, expect, it } from 'vitest'
import { barLengths, donutPath, MIN_SLICE_DEGREES, pieSlices } from './chart-geometry'

const sweep = (slice: { startDeg: number; endDeg: number }) => slice.endDeg - slice.startDeg

describe('pieSlices', () => {
  it('starts at 12 o’clock, follows the input order and fills exactly 360°', () => {
    const slices = pieSlices([50, 30, 20])
    expect(slices.map((slice) => slice.index)).toEqual([0, 1, 2])
    expect(slices[0]).toMatchObject({ startDeg: 0, endDeg: 180, share: 0.5 })
    expect(slices[1]?.startDeg).toBeCloseTo(180)
    expect(slices[1]?.endDeg).toBeCloseTo(288)
    expect(slices[2]?.endDeg).toBe(360)
  })

  it('gives a value of zero no slice but keeps the index of the others', () => {
    const slices = pieSlices([0, 10, 0, 10])
    expect(slices.map((slice) => slice.index)).toEqual([1, 3])
    expect(slices.reduce((sum, slice) => sum + sweep(slice), 0)).toBeCloseTo(360)
  })

  it('widens a tiny slice to 1° and takes the difference from the others', () => {
    const slices = pieSlices([1_000_000, 1])
    expect(sweep(slices[1]!)).toBe(MIN_SLICE_DEGREES)
    expect(sweep(slices[0]!)).toBeCloseTo(359)
    expect(slices[1]?.endDeg).toBe(360)
  })

  it('keeps every slice at 1° or more when widening one shrinks another under 1°', () => {
    const slices = pieSlices([100_000, 1_000, 280, 1, 1, 1, 1, 1, 1, 1])
    for (const slice of slices) {
      expect(sweep(slice)).toBeGreaterThanOrEqual(MIN_SLICE_DEGREES - 1e-9)
    }
    expect(slices.reduce((sum, slice) => sum + sweep(slice), 0)).toBeCloseTo(360)
  })

  it('is one full turn for one value, and nothing for no value', () => {
    expect(pieSlices([7])).toEqual([{ index: 0, share: 1, startDeg: 0, endDeg: 360 }])
    expect(pieSlices([])).toEqual([])
    expect(pieSlices([0, 0])).toEqual([])
  })
})

describe('donutPath', () => {
  it('draws a quarter turn with the small arc, clockwise', () => {
    expect(donutPath(80, 80, 70, 40, 0, 90)).toBe(
      'M 80 10 A 70 70 0 0 1 150 80 L 120 80 A 40 40 0 0 0 80 40 Z',
    )
  })

  it('uses the large arc past a half turn', () => {
    expect(donutPath(80, 80, 70, 40, 0, 270)).toContain('A 70 70 0 1 1')
  })

  it('draws the whole circle as two half turns on each edge', () => {
    const path = donutPath(80, 80, 70, 40, 0, 360)
    expect(path.match(/A 70 70/g)).toHaveLength(2)
    expect(path.match(/A 40 40/g)).toHaveLength(2)
  })
})

describe('barLengths', () => {
  it('scales each bar by the longest one', () => {
    expect(barLengths([50, 100, 0, 25])).toEqual([0.5, 1, 0, 0.25])
  })

  it('is all zero when there is nothing to show', () => {
    expect(barLengths([])).toEqual([])
    expect(barLengths([0, 0])).toEqual([0, 0])
  })
})
```

`src/renderer/src/lib/side-view-model.test.ts`:

```diff
--- a/src/renderer/src/lib/side-view-model.test.ts
+++ b/src/renderer/src/lib/side-view-model.test.ts
@@ -1,5 +1,7 @@
 import { describe, expect, it } from 'vitest'
 import {
+  categoryTotals,
+  chartSummary,
   MAX_TYPE_ICON_KEYS,
   totalSize,
   typeCategoryLabel,
@@ -50,3 +52,53 @@ describe('totalSize', () => {
     expect(totalSize([])).toBe(0)
   })
 })
+
+describe('categoryTotals', () => {
+  const row = (category: 'video' | 'image' | null, size: number) => ({
+    kind: 'extension' as const,
+    ext: 'x',
+    category,
+    size,
+    allocated: size,
+    files: 1,
+  })
+
+  it('sums the rows per file type, biggest first, without empty types', () => {
+    expect(
+      categoryTotals([row('image', 10), row('video', 5), row('image', 20), row('video', 0)]),
+    ).toEqual([
+      { category: 'image', bytes: 30 },
+      { category: 'video', bytes: 5 },
+    ])
+  })
+
+  it('counts the "Other extensions" row (no category) as Other', () => {
+    expect(categoryTotals([row('video', 5), row(null, 9)])).toEqual([
+      { category: 'other', bytes: 9 },
+      { category: 'video', bytes: 5 },
+    ])
+  })
+
+  it('is empty for no rows', () => {
+    expect(categoryTotals([])).toEqual([])
+  })
+})
+
+describe('chartSummary', () => {
+  it('names the three biggest entries with their rounded share', () => {
+    expect(
+      chartSummary([
+        { label: 'Images', value: 12 },
+        { label: 'Video', value: 41 },
+        { label: 'Audio', value: 2 },
+        { label: 'Documents', value: 22 },
+        { label: 'Code', value: 0 },
+      ]),
+    ).toBe('Video 53 %, Documents 29 %, Images 16 %')
+  })
+
+  it('says there is no data when everything is zero', () => {
+    expect(chartSummary([{ label: 'Video', value: 0 }])).toBe('No data')
+    expect(chartSummary([])).toBe('No data')
+  })
+})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/renderer/src/lib"`
Expected: FAIL: `./chart-geometry` does not exist; `categoryTotals` and `chartSummary` are not exported.

- [ ] **Step 3: Implement**

`src/renderer/src/lib/chart-geometry.ts` (new):

```ts
/** The least a non-empty slice turns, so a sliver of 0.01 % is still drawn. */
export const MIN_SLICE_DEGREES = 1

export interface PieSlice {
  /** Position of the value in the input array. */
  index: number
  /** Fraction of the total, 0 to 1. */
  share: number
  /** Degrees clockwise from 12 o'clock. */
  startDeg: number
  endDeg: number
}

/**
 * The slices of a pie for `values`, in input order (sort first for "largest first"), starting at
 * 12 o'clock and going clockwise. Zero (and negative) values get no slice. The slices fill exactly
 * 360°, and no slice turns less than 1°: tiny ones are widened and the others give up the
 * difference.
 */
export function pieSlices(values: readonly number[]): PieSlice[] {
  const entries = values.flatMap((value, index) => (value > 0 ? [{ index, value }] : []))
  const total = entries.reduce((sum, entry) => sum + entry.value, 0)
  if (total === 0) return []
  const clamped = new Set<number>()
  let scale = 1
  // Widening a slice shrinks the rest, which can push another one under 1°: repeat until stable.
  for (;;) {
    const free = entries.filter((entry) => !clamped.has(entry.index))
    const freeDegrees = 360 - clamped.size * MIN_SLICE_DEGREES
    const freeValue = free.reduce((sum, entry) => sum + entry.value, 0)
    scale = freeValue > 0 ? freeDegrees / freeValue : 0
    const small = free.filter((entry) => entry.value * scale < MIN_SLICE_DEGREES)
    if (small.length === 0) break
    for (const entry of small) clamped.add(entry.index)
  }
  let angle = 0
  return entries.map((entry, position) => {
    const degrees = clamped.has(entry.index) ? MIN_SLICE_DEGREES : entry.value * scale
    const startDeg = angle
    angle = position === entries.length - 1 ? 360 : angle + degrees
    return { index: entry.index, share: entry.value / total, startDeg, endDeg: angle }
  })
}

const round = (n: number) => Math.round(n * 100) / 100

/** The point at `deg` clockwise from 12 o'clock on a circle around (cx, cy). */
function point(cx: number, cy: number, radius: number, deg: number): string {
  const radians = (deg * Math.PI) / 180
  return `${round(cx + radius * Math.sin(radians))} ${round(cy - radius * Math.cos(radians))}`
}

/**
 * The SVG path of a donut slice between two angles. A slice of the whole circle is drawn as two
 * half turns, because one arc cannot start and end on the same point.
 */
export function donutPath(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  startDeg: number,
  endDeg: number,
): string {
  if (endDeg - startDeg >= 360 - 1e-6) {
    const mid = startDeg + 180
    return (
      `M ${point(cx, cy, outer, startDeg)} A ${outer} ${outer} 0 1 1 ${point(cx, cy, outer, mid)} ` +
      `A ${outer} ${outer} 0 1 1 ${point(cx, cy, outer, startDeg)} ` +
      `M ${point(cx, cy, inner, startDeg)} A ${inner} ${inner} 0 1 0 ${point(cx, cy, inner, mid)} ` +
      `A ${inner} ${inner} 0 1 0 ${point(cx, cy, inner, startDeg)} Z`
    )
  }
  const large = endDeg - startDeg > 180 ? 1 : 0
  return (
    `M ${point(cx, cy, outer, startDeg)} A ${outer} ${outer} 0 ${large} 1 ${point(cx, cy, outer, endDeg)} ` +
    `L ${point(cx, cy, inner, endDeg)} A ${inner} ${inner} 0 ${large} 0 ${point(cx, cy, inner, startDeg)} Z`
  )
}

/** Each bar's length as a fraction (0 to 1) of the longest bar; all zero when nothing is positive. */
export function barLengths(values: readonly number[]): number[] {
  const longest = Math.max(0, ...values)
  return values.map((value) => (longest > 0 && value > 0 ? value / longest : 0))
}
```

`src/renderer/src/lib/side-view-model.ts`:

```diff
--- a/src/renderer/src/lib/side-view-model.ts
+++ b/src/renderer/src/lib/side-view-model.ts
@@ -1,4 +1,9 @@
-import type { TypeRow } from '@shared/tree-types'
+import {
+  type CategoryShare,
+  FILE_CATEGORIES,
+  type FileCategory,
+  type TypeRow,
+} from '@shared/tree-types'

 export {
   NO_EXTENSION_LABEL,
@@ -34,3 +39,31 @@ export function typeIconKeys(rows: ReadonlyArray<Pick<TypeRow, 'kind' | 'ext'>>)
 export function totalSize(rows: ReadonlyArray<{ size: number }>): number {
   return rows.reduce((sum, row) => sum + row.size, 0)
 }
+
+/**
+ * The Types rows summed per file type (the treemap's categories), biggest first, without empty
+ * ones. The "Other extensions" row has no category of its own (the scanner folds the rest of the
+ * extensions into it), so it counts as "Other".
+ */
+export function categoryTotals(rows: readonly TypeRow[]): CategoryShare[] {
+  const bytes = new Map<FileCategory, number>()
+  for (const row of rows) {
+    const category = row.category ?? 'other'
+    bytes.set(category, (bytes.get(category) ?? 0) + row.size)
+  }
+  return FILE_CATEGORIES.filter((category) => (bytes.get(category) ?? 0) > 0)
+    .map((category) => ({ category, bytes: bytes.get(category) ?? 0 }))
+    .sort((a, b) => b.bytes - a.bytes)
+}
+
+/** A chart's accessible name: its three biggest entries and their shares, like `Video 41 %, …`. */
+export function chartSummary(entries: ReadonlyArray<{ label: string; value: number }>): string {
+  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.value), 0)
+  if (total === 0) return 'No data'
+  return entries
+    .filter((entry) => entry.value > 0)
+    .sort((a, b) => b.value - a.value)
+    .slice(0, 3)
+    .map((entry) => `${entry.label} ${Math.round((entry.value / total) * 100)} %`)
+    .join(', ')
+}
```

- [ ] **Step 4: Run the tests and the gates**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/renderer/src/lib"`
Expected: PASS.

Then: `powershell.exe -NoProfile -Command "npm run typecheck; npm run lint; npm run format:check"` (clean).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/chart-geometry.test.ts src/renderer/src/lib/chart-geometry.ts src/renderer/src/lib/side-view-model.test.ts src/renderer/src/lib/side-view-model.ts
git commit -m "feat(charts): pie and bar geometry, category totals and chart summaries"
```

---

### Task 4: A streaming XLSX writer

**Implementer tier:** Haiku (all code and tests are in the plan).

**Files:**

- Create: `src/worker/scanner/xlsx-writer.test.ts`
- Create: `src/worker/scanner/xlsx-writer.ts`

**Interfaces:**

- Consumes: `Cell` from `@shared/csv`; `crc32` and `createDeflateRaw` from `node:zlib` (Node 24 in Electron 45).
- Produces (`src/worker/scanner/xlsx-writer.ts`): `XLSX_MAX_ROWS = 1_048_575`; `ZIP_TOO_LARGE_MESSAGE`; `type Write = (chunk: Buffer) => Promise<void> | void` (awaiting it is the backpressure); `class ZipWriter { constructor(write: Write, limit?: number); addEntry(name: string, fill: (push: (text: string) => Promise<void>) => Promise<void>): Promise<void>; finish(): Promise<void> }`; `interface SheetSpec { name; header: readonly string[]; widths: readonly number[]; rows: Iterable<readonly Cell[]>; maxRows?: number }`; `interface SheetResult { rows: number; truncated: boolean }`; `writeXlsx(write: Write, sheets: readonly SheetSpec[]): Promise<SheetResult[]>`.

The test file has a private `unzip` reader (central directory, CRC-32, sizes, data descriptors); Task 5 moves it to `test/unzip.ts` so the export tests share it. The writer deflates at the default level here; Task 5 measures the export and settles on level 1 and cached column names (decision 9).

- [ ] **Step 1: Write the failing tests**

`src/worker/scanner/xlsx-writer.test.ts` (new):

```ts
import { randomBytes } from 'node:crypto'
import { crc32, inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { writeXlsx, XLSX_MAX_ROWS, ZIP_TOO_LARGE_MESSAGE, ZipWriter } from './xlsx-writer'

/** Reads a ZIP the way a reader does: the central directory, then each entry's bytes. */
function unzip(zip: Buffer): Map<string, string> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  expect(end).toBeGreaterThanOrEqual(0)
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  const files = new Map<string, string>()
  for (let i = 0; i < count; i += 1) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50)
    const flags = zip.readUInt16LE(at + 8)
    expect(flags & 0x0808).toBe(0x0808) // data descriptor and UTF-8 names
    const crc = zip.readUInt32LE(at + 16)
    const compressed = zip.readUInt32LE(at + 20)
    const size = zip.readUInt32LE(at + 24)
    const nameLength = zip.readUInt16LE(at + 28)
    const local = zip.readUInt32LE(at + 42)
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    expect(zip.readUInt32LE(local)).toBe(0x04034b50)
    const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const data = inflateRawSync(zip.subarray(dataStart, dataStart + compressed))
    expect(data.length).toBe(size)
    expect(crc32(data)).toBe(crc)
    // The descriptor right after the data repeats the numbers.
    expect(zip.readUInt32LE(dataStart + compressed)).toBe(0x08074b50)
    expect(zip.readUInt32LE(dataStart + compressed + 4)).toBe(crc)
    files.set(name, data.toString('utf8'))
    at += 46 + nameLength
  }
  return files
}

function collect() {
  const chunks: Buffer[] = []
  return { write: (chunk: Buffer) => void chunks.push(chunk), bytes: () => Buffer.concat(chunks) }
}

describe('ZipWriter', () => {
  it('writes entries a ZIP reader accepts, with correct sizes and checksums', async () => {
    const out = collect()
    const zip = new ZipWriter(out.write)
    await zip.addEntry('a.txt', async (push) => {
      await push('hello ')
      await push('wörld')
    })
    await zip.addEntry('dir/b.txt', (push) => push('x'.repeat(100_000)))
    await zip.finish()
    const files = unzip(out.bytes())
    expect([...files.keys()]).toEqual(['a.txt', 'dir/b.txt'])
    expect(files.get('a.txt')).toBe('hello wörld')
    expect(files.get('dir/b.txt')).toBe('x'.repeat(100_000))
  })

  it('fails clearly instead of writing a ZIP past its size limit (no ZIP64)', async () => {
    const zip = new ZipWriter(() => undefined, 200)
    // Random text does not compress, so the output really passes the limit.
    const noise = randomBytes(2000).toString('hex')
    await expect(zip.addEntry('big.txt', (push) => push(noise))).rejects.toThrow(
      ZIP_TOO_LARGE_MESSAGE,
    )
  })

  it('passes on an error from the writer', async () => {
    const zip = new ZipWriter(() => {
      throw new Error('disk full')
    })
    await expect(zip.addEntry('a.txt', (push) => push('x'))).rejects.toThrow('disk full')
  })
})

describe('writeXlsx', () => {
  const date = new Date(Date.UTC(2026, 10, 19, 12))

  it('writes the parts of a workbook and one worksheet per spec, in order', async () => {
    const out = collect()
    const results = await writeXlsx(out.write, [
      { name: 'Tree', header: ['Path'], widths: [40], rows: [['C:\\a']] },
      { name: 'Age', header: ['Age', 'Files'], widths: [20, 10], rows: [] },
    ])
    expect(results).toEqual([
      { rows: 1, truncated: false },
      { rows: 0, truncated: false },
    ])
    const files = unzip(out.bytes())
    expect([...files.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ])
    expect(files.get('xl/workbook.xml')).toContain('<sheet name="Tree" sheetId="1" r:id="rId1"/>')
    expect(files.get('xl/workbook.xml')).toContain('<sheet name="Age" sheetId="2" r:id="rId2"/>')
    expect(files.get('[Content_Types].xml')).toContain('/xl/worksheets/sheet2.xml')
    expect(files.get('xl/_rels/workbook.xml.rels')).toContain('Target="styles.xml"')
  })

  it('freezes and bolds the header and stores numbers and dates as numbers', async () => {
    const out = collect()
    await writeXlsx(out.write, [
      {
        name: 'Tree',
        header: ['Name', 'Size', 'Modified', 'Share'],
        widths: [30, 12, 20, 10],
        rows: [['a.txt', 1536, date, 12.5]],
      },
    ])
    const sheet = unzip(out.bytes()).get('xl/worksheets/sheet1.xml') ?? ''
    expect(sheet).toContain(
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>',
    )
    expect(sheet).toContain('<col min="1" max="1" width="30" customWidth="1"/>')
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="1"><is><t>Name</t></is></c>')
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t>a.txt</t></is></c>')
    expect(sheet).toContain('<c r="B2" s="3"><v>1536</v></c>')
    expect(sheet).toContain(
      `<c r="C2" s="2"><v>${Date.UTC(2026, 10, 19, 12) / 86_400_000 + 25_569}</v></c>`,
    )
    expect(sheet).toContain('<c r="D2"><v>12.5</v></c>')
    expect(unzip(out.bytes()).get('xl/styles.xml')).toContain('yyyy\\-mm\\-dd\\ hh:mm:ss')
  })

  it('never writes a formula: text is an inline string, escaped, and empty cells are skipped', async () => {
    const out = collect()
    await writeXlsx(out.write, [
      {
        name: 'Tree',
        header: ['A', 'B', 'C'],
        widths: [10, 10, 10],
        rows: [['=1+1 & <b>', null, ' padded \u0001']],
      },
    ])
    const sheet = unzip(out.bytes()).get('xl/worksheets/sheet1.xml') ?? ''
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t>=1+1 &amp; &lt;b&gt;</t></is></c>')
    expect(sheet).not.toContain('<f>')
    expect(sheet).not.toContain('r="B2"')
    expect(sheet).toContain('<t xml:space="preserve"> padded </t>')
  })

  it('names columns past Z like a spreadsheet does', async () => {
    const out = collect()
    const header = Array.from({ length: 28 }, (_, i) => `h${i}`)
    await writeXlsx(out.write, [{ name: 'Wide', header, widths: [], rows: [] }])
    const sheet = unzip(out.bytes()).get('xl/worksheets/sheet1.xml') ?? ''
    expect(sheet).toContain('r="Z1"')
    expect(sheet).toContain('r="AA1"')
    expect(sheet).toContain('r="AB1"')
  })

  it('stops at the row limit and says so, but not when the rows just fit', async () => {
    expect(XLSX_MAX_ROWS).toBe(1_048_575)
    const rows = [['1'], ['2'], ['3']]
    const full = collect()
    const [fits] = await writeXlsx(full.write, [
      { name: 'T', header: ['n'], widths: [5], rows, maxRows: 3 },
    ])
    expect(fits).toEqual({ rows: 3, truncated: false })
    const cut = collect()
    const [short] = await writeXlsx(cut.write, [
      { name: 'T', header: ['n'], widths: [5], rows, maxRows: 2 },
    ])
    expect(short).toEqual({ rows: 2, truncated: true })
    const sheet = unzip(cut.bytes()).get('xl/worksheets/sheet1.xml') ?? ''
    expect(sheet).toContain('<row r="3">')
    expect(sheet).not.toContain('<row r="4">')
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/worker/scanner/xlsx-writer.test.ts"`
Expected: FAIL: `./xlsx-writer` does not exist.

- [ ] **Step 3: Implement**

`src/worker/scanner/xlsx-writer.ts` (new):

```ts
import { once } from 'node:events'
import { crc32, createDeflateRaw } from 'node:zlib'
import type { Cell } from '@shared/csv'

/** Data rows a worksheet holds (Excel's 1,048,576 rows, minus the header). */
export const XLSX_MAX_ROWS = 1_048_575
export const ZIP_TOO_LARGE_MESSAGE =
  'The data is too large for one Excel file. Export to CSV instead.'

/** Sends bytes to the file; resolves when the sink can take more (backpressure). */
export type Write = (chunk: Buffer) => Promise<void> | void

const MAX_U32 = 0xffff_ffff
/** 2020-01-01 00:00 in MS-DOS format; the files carry no meaningful time. */
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1
/** Bit 3: sizes follow the data (streaming). Bit 11: names are UTF-8. */
const FLAGS = 0x0808

interface ZipEntry {
  name: Buffer
  crc: number
  compressed: number
  size: number
  offset: number
}

/**
 * A streaming ZIP writer: each entry is deflated as it is produced and its sizes follow the data
 * (a data descriptor), so a big sheet is never held in memory. No ZIP64: anything past 4 GiB
 * fails with a clear message.
 */
export class ZipWriter {
  private offset = 0
  private readonly entries: ZipEntry[] = []

  constructor(
    private readonly write: Write,
    private readonly limit = MAX_U32,
  ) {}

  private async raw(chunk: Buffer): Promise<void> {
    this.offset += chunk.length
    if (this.offset > this.limit) throw new Error(ZIP_TOO_LARGE_MESSAGE)
    await this.write(chunk)
  }

  /** Adds a file; `fill` pushes its text piece by piece. */
  async addEntry(
    name: string,
    fill: (push: (text: string) => Promise<void>) => Promise<void>,
  ): Promise<void> {
    const nameBytes = Buffer.from(name, 'utf8')
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(FLAGS, 6)
    header.writeUInt16LE(8, 8) // deflate
    header.writeUInt16LE(0, 10)
    header.writeUInt16LE(DOS_DATE, 12)
    header.writeUInt16LE(nameBytes.length, 26)
    const entry: ZipEntry = {
      name: nameBytes,
      crc: 0,
      compressed: 0,
      size: 0,
      offset: this.offset,
    }
    await this.raw(Buffer.concat([header, nameBytes]))

    const deflate = createDeflateRaw()
    const drained = (async () => {
      for await (const chunk of deflate as AsyncIterable<Buffer>) {
        entry.compressed += chunk.length
        await this.raw(chunk)
      }
    })()
    drained.catch(() => undefined) // reported below; avoids an unhandled rejection meanwhile
    try {
      await fill(async (text) => {
        const bytes = Buffer.from(text, 'utf8')
        entry.crc = crc32(bytes, entry.crc)
        entry.size += bytes.length
        if (entry.size > MAX_U32) throw new Error(ZIP_TOO_LARGE_MESSAGE)
        if (!deflate.write(bytes)) await once(deflate, 'drain')
      })
      deflate.end()
      await drained
    } catch (error) {
      deflate.destroy()
      throw error
    }
    const descriptor = Buffer.alloc(16)
    descriptor.writeUInt32LE(0x08074b50, 0)
    descriptor.writeUInt32LE(entry.crc, 4)
    descriptor.writeUInt32LE(entry.compressed, 8)
    descriptor.writeUInt32LE(entry.size, 12)
    await this.raw(descriptor)
    this.entries.push(entry)
  }

  /** Writes the central directory; call once, after the last entry. */
  async finish(): Promise<void> {
    const start = this.offset
    for (const entry of this.entries) {
      const record = Buffer.alloc(46)
      record.writeUInt32LE(0x02014b50, 0)
      record.writeUInt16LE(20, 4)
      record.writeUInt16LE(20, 6)
      record.writeUInt16LE(FLAGS, 8)
      record.writeUInt16LE(8, 10)
      record.writeUInt16LE(0, 12)
      record.writeUInt16LE(DOS_DATE, 14)
      record.writeUInt32LE(entry.crc, 16)
      record.writeUInt32LE(entry.compressed, 20)
      record.writeUInt32LE(entry.size, 24)
      record.writeUInt16LE(entry.name.length, 28)
      record.writeUInt32LE(entry.offset, 42)
      await this.raw(Buffer.concat([record, entry.name]))
    }
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(this.entries.length, 8)
    end.writeUInt16LE(this.entries.length, 10)
    end.writeUInt32LE(this.offset - start, 12)
    end.writeUInt32LE(start, 16)
    await this.raw(end)
  }
}

// ---- Worksheets --------------------------------------------------------------------------------

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml'

/** Cell styles (`cellXfs` in `styles.xml`). */
const STYLE_BOLD = 1
const STYLE_DATE = 2
const STYLE_INTEGER = 3

/** Characters XML 1.0 cannot hold are dropped; the markup characters are escaped. */
// eslint-disable-next-line no-control-regex -- the control characters are exactly what is removed
const XML_UNSAFE = /[&<>\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }
const escapeXml = (text: string) => text.replace(XML_UNSAFE, (char) => ESCAPES[char] ?? '')

/** Excel's longest cell text. */
const MAX_CELL_CHARS = 32_767
/** Days from 1899-12-30 (Excel's day 0) to 1970-01-01. */
const EXCEL_EPOCH_DAYS = 25_569

function columnName(index: number): string {
  let name = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name
  }
  return name
}

function textCell(ref: string, text: string, style: number): string {
  const clipped = escapeXml(text.length > MAX_CELL_CHARS ? text.slice(0, MAX_CELL_CHARS) : text)
  const space = /^\s|\s$/.test(clipped) ? ' xml:space="preserve"' : ''
  const s = style === 0 ? '' : ` s="${style}"`
  return `<c r="${ref}" t="inlineStr"${s}><is><t${space}>${clipped}</t></is></c>`
}

/** Text is an inline string (never a formula); numbers and dates are stored as numbers. */
function cellXml(ref: string, cell: Cell): string {
  if (cell === null) return ''
  if (typeof cell === 'string') return textCell(ref, cell, 0)
  if (cell instanceof Date) {
    const days = cell.getTime() / 86_400_000 + EXCEL_EPOCH_DAYS
    return `<c r="${ref}" s="${STYLE_DATE}"><v>${days}</v></c>`
  }
  if (!Number.isFinite(cell)) return ''
  const style = Number.isInteger(cell) ? ` s="${STYLE_INTEGER}"` : ''
  return `<c r="${ref}"${style}><v>${cell}</v></c>`
}

export interface SheetSpec {
  /** At most 31 characters, none of `[]:*?/\`. */
  name: string
  /** Bold, frozen first row. */
  header: readonly string[]
  /** Column widths in characters, one per column. */
  widths: readonly number[]
  rows: Iterable<readonly Cell[]>
  /** Data rows after which the sheet stops (default: Excel's limit). */
  maxRows?: number
}

export interface SheetResult {
  rows: number
  /** The rows ran out of room: some were left out. */
  truncated: boolean
}

/** About this much text is gathered before it goes to the compressor. */
const BATCH_CHARS = 64 * 1024

async function writeSheet(
  push: (text: string) => Promise<void>,
  sheet: SheetSpec,
): Promise<SheetResult> {
  const cols = sheet.widths
    .map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`)
    .join('')
  let batch =
    `${XML_HEAD}<worksheet xmlns="${MAIN_NS}"><sheetViews><sheetView workbookViewId="0">` +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView>' +
    `</sheetViews><cols>${cols}</cols><sheetData>`
  const flush = async () => {
    const text = batch
    batch = ''
    await push(text)
  }
  batch +=
    '<row r="1">' +
    sheet.header.map((text, i) => textCell(`${columnName(i)}1`, text, STYLE_BOLD)).join('') +
    '</row>'
  const maxRows = sheet.maxRows ?? XLSX_MAX_ROWS
  let rows = 0
  let truncated = false
  for (const row of sheet.rows) {
    if (rows === maxRows) {
      truncated = true
      break
    }
    rows += 1
    batch += `<row r="${rows + 1}">`
    row.forEach((cell, i) => {
      batch += cellXml(`${columnName(i)}${rows + 1}`, cell)
    })
    batch += '</row>'
    if (batch.length >= BATCH_CHARS) await flush()
  }
  batch += '</sheetData></worksheet>'
  await flush()
  return { rows, truncated }
}

const STYLES_XML =
  `${XML_HEAD}<styleSheet xmlns="${MAIN_NS}">` +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm:ss"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>'

/**
 * Writes a workbook with one worksheet per spec, streaming, and says how many rows each got.
 * Inline strings only (no shared-strings part) and four cell styles: normal, bold header, date and
 * whole number (so a size of 13 digits is not shown as 1.2E+12).
 */
export async function writeXlsx(
  write: Write,
  sheets: readonly SheetSpec[],
): Promise<SheetResult[]> {
  const zip = new ZipWriter(write)
  const part = (name: string, xml: string) => zip.addEntry(name, (push) => push(xml))
  const indexes = sheets.map((_, i) => i + 1)

  await part(
    '[Content_Types].xml',
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      `<Override PartName="/xl/workbook.xml" ContentType="${CT}.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="${CT}.styles+xml"/>` +
      indexes
        .map(
          (n) =>
            `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="${CT}.worksheet+xml"/>`,
        )
        .join('') +
      '</Types>',
  )
  await part(
    '_rels/.rels',
    `${XML_HEAD}<Relationships xmlns="${REL_NS}">` +
      `<Relationship Id="rId1" Type="${DOC_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  )
  await part(
    'xl/workbook.xml',
    `${XML_HEAD}<workbook xmlns="${MAIN_NS}" xmlns:r="${DOC_REL}"><sheets>` +
      sheets
        .map(
          (sheet, i) =>
            `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
        )
        .join('') +
      '</sheets></workbook>',
  )
  await part(
    'xl/_rels/workbook.xml.rels',
    `${XML_HEAD}<Relationships xmlns="${REL_NS}">` +
      indexes
        .map(
          (n) =>
            `<Relationship Id="rId${n}" Type="${DOC_REL}/worksheet" Target="worksheets/sheet${n}.xml"/>`,
        )
        .join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="${DOC_REL}/styles" Target="styles.xml"/>` +
      '</Relationships>',
  )
  await part('xl/styles.xml', STYLES_XML)

  const results: SheetResult[] = []
  for (const [i, sheet] of sheets.entries()) {
    await zip.addEntry(`xl/worksheets/sheet${i + 1}.xml`, async (push) => {
      results.push(await writeSheet(push, sheet))
    })
  }
  await zip.finish()
  return results
}
```

- [ ] **Step 4: Run the tests and the gates**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/worker/scanner/xlsx-writer.test.ts"`
Expected: PASS.

Then: `powershell.exe -NoProfile -Command "npm run typecheck; npm run lint; npm run format:check"` (clean).

- [ ] **Step 5: Commit**

```bash
git add src/worker/scanner/xlsx-writer.test.ts src/worker/scanner/xlsx-writer.ts
git commit -m "feat(export): streaming XLSX writer with a minimal ZIP"
```

---

### Task 5: The scanner writes the whole tree to CSV or Excel

**Implementer tier:** Sonnet (integrates the protocol, the host and the perf test).

**Files:**

- Modify: `src/shared/scanner-protocol.ts`
- Create: `src/worker/scanner/export-tree.test.ts`
- Create: `src/worker/scanner/export-tree.ts`
- Modify: `src/worker/scanner/scanner-host.test.ts`
- Modify: `src/worker/scanner/scanner-host.ts`
- Create: `src/worker/scanner/test/unzip.ts`
- Modify: `src/worker/scanner/tree-store.perf.test.ts`
- Modify: `src/worker/scanner/xlsx-writer.test.ts`
- Modify: `src/worker/scanner/xlsx-writer.ts`

**Interfaces:**

- Consumes: `TreeStore` (`childFolders`, `filesIn`, `folderSize`, `folderAllocated`, `folderFiles`, `folderFolders`, `folderModified`, `folderName`, `folderPath`, `fileName`, `fileSize`, `fileAllocated`, `fileModified`), `SideViews` (`topFiles(nodeId, 'size')`, `types(nodeId)`, `age(nodeId)`), `resolveNode`, `folderOf`, `csvLine`, `CSV_BOM`, `fileExtension`, the column lists from Task 1, `writeXlsx` from Task 4.
- Produces (`@shared/scanner-protocol`): `type ExportFormat = 'csv' | 'xlsx'`, `EXPORT_FORMATS`, `interface ExportSummary { rows: number; truncated: boolean }`, the query `{ kind: 'export'; scanId; nodeId; format: ExportFormat; filePath: string }` and the result `export: ExportSummary | null`.
- Produces (`export-tree.ts`): `TREE_HEADER`, `treeRows(store, root: number): Generator<Cell[]>`, `exportTree(store, views, nodeId, format, filePath, maxRows = XLSX_MAX_ROWS): Promise<ExportSummary | null>` (null when the node is gone; rejects with a plain message on a write error).
- `parseScannerRequest` accepts an `export` query only with a known format and an **absolute** `filePath`.
- Produces (test helper `src/worker/scanner/test/unzip.ts`): `unzip(zip: Buffer): Map<string, string>`, moved out of `xlsx-writer.test.ts`; it asserts the flags, CRC-32, sizes and data descriptors while it reads.

- [ ] **Step 1: Write the failing tests**

`src/worker/scanner/export-tree.test.ts` (new):

```ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { exportTree, TREE_HEADER, treeRows } from './export-tree'
import { SideViews } from './side-views'
import { unzip } from './test/unzip'
import { TreeStore } from './tree-store'

const ROOT = 'C:\\Data'
/** A whole number of seconds, because the store keeps modification times in seconds. */
const NOW = Date.UTC(2026, 10, 28, 12)

/**
 * Data
 *   A
 *     B: mid.jpg 1500 (f1), tie.jpg 1500 (f2)
 *     big.MP4 3000 (f0)
 *   C: tiny.txt 10 (f3)
 *   root.bin 2000 (f4)
 *   =cmd.txt 1 (f5)
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
  store.file(0, 1, '=cmd.txt', 0)
  return { store, views: new SideViews(store, () => NOW + 1000) }
}

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'storageiq-export-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('treeRows', () => {
  it('lists every folder and file below the folder, depth first, biggest first', () => {
    const { store } = sample()
    const rows = [...treeRows(store, 0)]
    expect(rows.map((row) => row[0])).toEqual([
      path.join(ROOT, 'A'),
      path.join(ROOT, 'A', 'B'),
      path.join(ROOT, 'A', 'B', 'mid.jpg'),
      path.join(ROOT, 'A', 'B', 'tie.jpg'),
      path.join(ROOT, 'A', 'big.MP4'),
      path.join(ROOT, 'root.bin'),
      path.join(ROOT, 'C'),
      path.join(ROOT, 'C', 'tiny.txt'),
      path.join(ROOT, '=cmd.txt'),
    ])
  })

  it('fills the columns for a folder and for a file', () => {
    const { store } = sample()
    const rows = [...treeRows(store, 0)]
    expect(TREE_HEADER).toHaveLength(rows[0]?.length ?? -1)
    // Folder A: 6000 bytes of the root's 8011, in 3 files and 1 folder.
    expect(rows[0]).toEqual([
      path.join(ROOT, 'A'),
      'A',
      'Folder',
      '',
      6000,
      7168,
      3,
      1,
      expect.any(Date),
      74.9,
    ])
    // big.MP4: half of A.
    expect(rows[4]).toEqual([
      path.join(ROOT, 'A', 'big.MP4'),
      'big.MP4',
      'File',
      'mp4',
      3000,
      3072,
      1,
      0,
      new Date(NOW),
      50,
    ])
    // A file with an unknown date has an empty date.
    expect(rows[8]?.[8]).toBeNull()
  })

  it('starts below the folder it is given, with shares of that folder', () => {
    const { store } = sample()
    const rows = [...treeRows(store, 1)]
    expect(rows.map((row) => row[1])).toEqual(['B', 'mid.jpg', 'tie.jpg', 'big.MP4'])
    expect(rows[0]?.[9]).toBe(50) // B is 3000 of A's 6000
  })
})

describe('exportTree to CSV', () => {
  it('writes a BOM, the header and one CRLF line per row, with no formula injection', async () => {
    const { store, views } = sample()
    const file = path.join(dir, 'out.csv')
    expect(await exportTree(store, views, 'd0', 'csv', file)).toEqual({ rows: 9, truncated: false })
    const text = readFileSync(file, 'utf8')
    expect(text.startsWith('\uFEFFPath,Name,Type,Extension,Size (bytes),')).toBe(true)
    const lines = text.slice(1).split('\r\n')
    expect(lines).toHaveLength(1 + 9 + 1)
    const iso = new Date(NOW).toISOString()
    expect(lines[5]).toBe(
      `${path.join(ROOT, 'A', 'big.MP4')},big.MP4,File,mp4,3000,3072,1,0,${iso},50`,
    )
    // The name starts with "=": it gets a leading quote; the path starts with the drive and does not.
    expect(lines[9]).toBe(`${path.join(ROOT, '=cmd.txt')},'=cmd.txt,File,txt,1,1024,1,0,,0`)
    expect(lines[10]).toBe('')
  })

  it('has no row limit', async () => {
    const { store, views } = sample()
    const file = path.join(dir, 'out.csv')
    expect(await exportTree(store, views, 'd0', 'csv', file, 2)).toMatchObject({ rows: 9 })
  })

  it('answers null for a node that is gone and writes no file', async () => {
    const { store, views } = sample()
    const file = path.join(dir, 'none.csv')
    expect(await exportTree(store, views, 'd99', 'csv', file)).toBeNull()
    expect(() => readFileSync(file)).toThrow()
  })

  it('fails with the system’s message when the file cannot be created', async () => {
    const { store, views } = sample()
    const folder = path.join(dir, 'a-folder')
    mkdirSync(folder)
    await expect(exportTree(store, views, 'd0', 'csv', folder)).rejects.toThrow()
    await expect(
      exportTree(store, views, 'd0', 'csv', path.join(dir, 'missing', 'out.csv')),
    ).rejects.toThrow(/ENOENT|no such file/i)
  })
})

describe('exportTree to Excel', () => {
  it('writes four sheets: the tree, the top files, the types and the age', async () => {
    const { store, views } = sample()
    const file = path.join(dir, 'out.xlsx')
    expect(await exportTree(store, views, 'd0', 'xlsx', file)).toEqual({
      rows: 9,
      truncated: false,
    })
    const files = unzip(readFileSync(file))
    expect(files.get('xl/workbook.xml')).toMatch(
      /name="Tree".*name="Top files".*name="Types".*name="Age"/,
    )
    const tree = files.get('xl/worksheets/sheet1.xml') ?? ''
    expect(tree).toContain('<t>Path</t>')
    expect(tree.match(/<row /g)).toHaveLength(1 + 9)
    // Text is never a formula, so the "=" file name needs no prefix here.
    expect(tree).toContain('<t>=cmd.txt</t>')
    expect(tree).not.toContain('<f>')
    const top = files.get('xl/worksheets/sheet2.xml') ?? ''
    expect(top.match(/<row /g)).toHaveLength(1 + 6)
    expect(top).toContain('<t>big.MP4</t>')
    const types = files.get('xl/worksheets/sheet3.xml') ?? ''
    expect(types).toContain('<t>.jpg</t>')
    const age = files.get('xl/worksheets/sheet4.xml') ?? ''
    expect(age.match(/<row /g)).toHaveLength(1 + 8)
  })

  it('stops the Tree sheet at the row limit and says so', async () => {
    const { store, views } = sample()
    const file = path.join(dir, 'out.xlsx')
    expect(await exportTree(store, views, 'd0', 'xlsx', file, 4)).toEqual({
      rows: 4,
      truncated: true,
    })
    const tree = unzip(readFileSync(file)).get('xl/worksheets/sheet1.xml') ?? ''
    expect(tree.match(/<row /g)).toHaveLength(1 + 4)
  })

  it('removes a file it could not finish', async () => {
    const { store } = sample()
    const file = path.join(dir, 'half.xlsx')
    const broken = new SideViews(store)
    broken.topFiles = () => {
      throw new Error('boom')
    }
    await expect(exportTree(store, broken, 'd0', 'xlsx', file)).rejects.toThrow('boom')
    expect(() => readFileSync(file)).toThrow()
  })
})
```

`src/worker/scanner/scanner-host.test.ts`:

```diff
--- a/src/worker/scanner/scanner-host.test.ts
+++ b/src/worker/scanner/scanner-host.test.ts
@@ -1,3 +1,5 @@
+import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
+import os from 'node:os'
 import path from 'node:path'
 import { describe, expect, it, vi } from 'vitest'
 import type { ScanDone, ScanProgress } from '@shared/scan-types'
@@ -350,6 +352,23 @@ describe('createScannerHost', () => {
     ).toBeNull()
   })

+  it('exports the tree to the file main chose, and answers null for a node that is gone', async () => {
+    const t = setup()
+    t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
+    await t.host.idle()
+    const dir = mkdtempSync(path.join(os.tmpdir(), 'storageiq-host-export-'))
+    try {
+      const filePath = path.join(dir, 'out.csv')
+      const query = { kind: 'export', scanId: 's1', nodeId: 'd0', format: 'csv', filePath } as const
+      expect(await t.query(query)).toEqual({ rows: 6, truncated: false })
+      expect(readFileSync(filePath, 'utf8').split('\r\n')).toHaveLength(1 + 6 + 1)
+      expect(await t.query({ ...query, nodeId: 'd99' })).toBeNull()
+      expect(await t.query({ ...query, scanId: 'old' })).toBeNull()
+    } finally {
+      rmSync(dir, { recursive: true, force: true })
+    }
+  })
+
   it('answers queries for another scan id with nothing', async () => {
     const t = setup()
     t.host.handle({ type: 'start', scanId: 's1', root: ROOT, volume: VOLUME })
@@ -512,6 +531,21 @@ describe('parseScannerRequest', () => {
     },
     { type: 'query', requestId: 1, query: { kind: 'types', scanId: 's1', nodeId: 7 } },
     { type: 'query', requestId: 1, query: { kind: 'age', scanId: 's1' } },
+    {
+      type: 'query',
+      requestId: 1,
+      query: { kind: 'export', scanId: 's1', nodeId: 'd0', format: 'pdf', filePath: 'C:\\x.pdf' },
+    },
+    {
+      type: 'query',
+      requestId: 1,
+      query: { kind: 'export', scanId: 's1', nodeId: 'd0', format: 'csv', filePath: 'rel.csv' },
+    },
+    {
+      type: 'query',
+      requestId: 1,
+      query: { kind: 'export', scanId: 's1', nodeId: 'd0', format: 'csv' },
+    },
     { type: 'query', requestId: 'x', query: { kind: 'totals', scanId: 's1' } },
     {
       type: 'query',
```

`src/worker/scanner/test/unzip.ts` (new):

```ts
import { crc32, inflateRawSync } from 'node:zlib'
import { expect } from 'vitest'

/** Reads a ZIP the way a reader does: the central directory, then each entry's bytes. */
export function unzip(zip: Buffer): Map<string, string> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  expect(end).toBeGreaterThanOrEqual(0)
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  const files = new Map<string, string>()
  for (let i = 0; i < count; i += 1) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50)
    const flags = zip.readUInt16LE(at + 8)
    expect(flags & 0x0808).toBe(0x0808) // data descriptor and UTF-8 names
    const crc = zip.readUInt32LE(at + 16)
    const compressed = zip.readUInt32LE(at + 20)
    const size = zip.readUInt32LE(at + 24)
    const nameLength = zip.readUInt16LE(at + 28)
    const local = zip.readUInt32LE(at + 42)
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    expect(zip.readUInt32LE(local)).toBe(0x04034b50)
    const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const data = inflateRawSync(zip.subarray(dataStart, dataStart + compressed))
    expect(data.length).toBe(size)
    expect(crc32(data)).toBe(crc)
    // The descriptor right after the data repeats the numbers.
    expect(zip.readUInt32LE(dataStart + compressed)).toBe(0x08074b50)
    expect(zip.readUInt32LE(dataStart + compressed + 4)).toBe(crc)
    files.set(name, data.toString('utf8'))
    at += 46 + nameLength
  }
  return files
}
```

`src/worker/scanner/tree-store.perf.test.ts`:

```diff
--- a/src/worker/scanner/tree-store.perf.test.ts
+++ b/src/worker/scanner/tree-store.perf.test.ts
@@ -1,7 +1,10 @@
-import { mkdirSync, writeFileSync } from 'node:fs'
+import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
+import os from 'node:os'
+import path from 'node:path'
 import { describe, expect, it } from 'vitest'
 import { TOP_FILES_LIMIT, TYPE_ROWS_LIMIT } from '@shared/tree-types'
-import { ageBreakdown, topFiles, typeBreakdown } from './side-views'
+import { exportTree } from './export-tree'
+import { ageBreakdown, SideViews, topFiles, typeBreakdown } from './side-views'
 import { ChildSorter, childrenPage } from './tree-queries'
 import { TreeStore } from './tree-store'
 import { treemapLayout } from './treemap'
@@ -17,6 +20,9 @@ export const PERF_LIMITS = {
   maxTreemapMs: 100,
   /** Phase 4 spec §3.1: each side view of the root, one walk over every file. */
   maxSideViewMs: 300,
+  /** Phase 5 spec §5: exporting the whole 1M-file tree to a file. */
+  maxCsvExportMs: 10_000,
+  maxXlsxExportMs: 20_000,
 } as const

 function usedBytes(): number {
@@ -185,3 +191,38 @@ describe('side views (1M files)', () => {
     expect(ms).toBeLessThanOrEqual(PERF_LIMITS.maxSideViewMs)
   }, 60_000)
 })
+
+describe('export (1M files)', () => {
+  const exportMs = async (format: 'csv' | 'xlsx') => {
+    const store = sharedStore()
+    const dir = mkdtempSync(path.join(os.tmpdir(), 'storageiq-perf-export-'))
+    try {
+      const file = path.join(dir, `tree.${format}`)
+      const started = performance.now()
+      const summary = await exportTree(store, new SideViews(store), 'd0', format, file)
+      const ms = performance.now() - started
+      const mb = statSync(file).size / 1024 / 1024
+      console.log(
+        `[perf] ${JSON.stringify({ [`${format}ExportMs`]: ms, [`${format}ExportMb`]: mb })}`,
+      )
+      return { summary, ms }
+    } finally {
+      rmSync(dir, { recursive: true, force: true })
+    }
+  }
+
+  // The tree has 1M files and 10,100 folders; Excel's sheet holds 1,048,575 data rows, so it fits.
+  const ROWS = PERF_LIMITS.files + 100 + 10_000
+
+  it('writes every row to a CSV inside the limit', async () => {
+    const { summary, ms } = await exportMs('csv')
+    expect(summary).toEqual({ rows: ROWS, truncated: false })
+    expect(ms).toBeLessThanOrEqual(PERF_LIMITS.maxCsvExportMs)
+  }, 120_000)
+
+  it('writes every row to an Excel workbook inside the limit', async () => {
+    const { summary, ms } = await exportMs('xlsx')
+    expect(summary).toEqual({ rows: ROWS, truncated: false })
+    expect(ms).toBeLessThanOrEqual(PERF_LIMITS.maxXlsxExportMs)
+  }, 120_000)
+})
```

`src/worker/scanner/xlsx-writer.test.ts`:

```diff
--- a/src/worker/scanner/xlsx-writer.test.ts
+++ b/src/worker/scanner/xlsx-writer.test.ts
@@ -1,39 +1,8 @@
 import { randomBytes } from 'node:crypto'
-import { crc32, inflateRawSync } from 'node:zlib'
 import { describe, expect, it } from 'vitest'
+import { unzip } from './test/unzip'
 import { writeXlsx, XLSX_MAX_ROWS, ZIP_TOO_LARGE_MESSAGE, ZipWriter } from './xlsx-writer'

-/** Reads a ZIP the way a reader does: the central directory, then each entry's bytes. */
-function unzip(zip: Buffer): Map<string, string> {
-  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
-  expect(end).toBeGreaterThanOrEqual(0)
-  const count = zip.readUInt16LE(end + 10)
-  let at = zip.readUInt32LE(end + 16)
-  const files = new Map<string, string>()
-  for (let i = 0; i < count; i += 1) {
-    expect(zip.readUInt32LE(at)).toBe(0x02014b50)
-    const flags = zip.readUInt16LE(at + 8)
-    expect(flags & 0x0808).toBe(0x0808) // data descriptor and UTF-8 names
-    const crc = zip.readUInt32LE(at + 16)
-    const compressed = zip.readUInt32LE(at + 20)
-    const size = zip.readUInt32LE(at + 24)
-    const nameLength = zip.readUInt16LE(at + 28)
-    const local = zip.readUInt32LE(at + 42)
-    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8')
-    expect(zip.readUInt32LE(local)).toBe(0x04034b50)
-    const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
-    const data = inflateRawSync(zip.subarray(dataStart, dataStart + compressed))
-    expect(data.length).toBe(size)
-    expect(crc32(data)).toBe(crc)
-    // The descriptor right after the data repeats the numbers.
-    expect(zip.readUInt32LE(dataStart + compressed)).toBe(0x08074b50)
-    expect(zip.readUInt32LE(dataStart + compressed + 4)).toBe(crc)
-    files.set(name, data.toString('utf8'))
-    at += 46 + nameLength
-  }
-  return files
-}
-
 function collect() {
   const chunks: Buffer[] = []
   return { write: (chunk: Buffer) => void chunks.push(chunk), bytes: () => Buffer.concat(chunks) }
```

- [ ] **Step 2: Run them and watch them fail**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/worker"`
Expected: FAIL: `./export-tree` does not exist; the host answers `null` to `export`; `parseScannerRequest` rejects the new query.

- [ ] **Step 3: Implement**

`src/shared/scanner-protocol.ts`:

```diff
--- a/src/shared/scanner-protocol.ts
+++ b/src/shared/scanner-protocol.ts
@@ -23,6 +23,18 @@ export const MAX_PATH_QUERY_IDS = 64
 /** Used when main could not read the drive's cluster size (the NTFS default). */
 export const DEFAULT_CLUSTER_BYTES = 4096

+/** The two file formats of the export. */
+export type ExportFormat = 'csv' | 'xlsx'
+export const EXPORT_FORMATS: readonly ExportFormat[] = ['csv', 'xlsx']
+
+/** What an export wrote. */
+export interface ExportSummary {
+  /** Tree rows written (the file also has a header row, and the Excel file three more sheets). */
+  rows: number
+  /** The Excel sheet ran out of rows: the rest of the tree is not in the file. */
+  truncated: boolean
+}
+
 /** Questions main asks the scanner about its tree, plus the folder refresh. */
 export type ScannerQuery =
   | {
@@ -51,6 +63,8 @@ export type ScannerQuery =
   | { kind: 'top-files'; scanId: string; nodeId: NodeId; mode: SizeMode }
   | { kind: 'types'; scanId: string; nodeId: NodeId }
   | { kind: 'age'; scanId: string; nodeId: NodeId }
+  /** Writes the whole tree below a folder to `filePath` (main's save dialog chose it). */
+  | { kind: 'export'; scanId: string; nodeId: NodeId; format: ExportFormat; filePath: string }
   | { kind: 'refresh'; scanId: string; nodeId: NodeId }
   | { kind: 'totals'; scanId: string }

@@ -64,6 +78,7 @@ export interface ScannerQueryResults {
   'top-files': TopFileRow[] | null
   types: TypeRow[] | null
   age: AgeRow[] | null
+  export: ExportSummary | null
   refresh: TreeNodeDetails | null
   totals: TreeTotals | null
 }
```

`src/worker/scanner/export-tree.ts` (new):

```ts
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { finished } from 'node:stream/promises'
import { CSV_BOM, type Cell, csvLine } from '@shared/csv'
import { fileExtension } from '@shared/file-category'
import type { ExportFormat, ExportSummary } from '@shared/scanner-protocol'
import { AGE_COLUMNS, dateCell, TOP_FILES_COLUMNS, TYPES_COLUMNS } from '@shared/side-view-columns'
import type { NodeId } from '@shared/tree-types'
import type { SideViews } from './side-views'
import { folderOf, resolveNode } from './tree-queries'
import type { TreeStore } from './tree-store'
import { type SheetSpec, writeXlsx, XLSX_MAX_ROWS } from './xlsx-writer'

export const TREE_HEADER = [
  'Path',
  'Name',
  'Type',
  'Extension',
  'Size (bytes)',
  'Allocated (bytes)',
  'Files',
  'Folders',
  'Modified (UTC)',
  '% of parent',
] as const

interface Entry {
  isFolder: boolean
  index: number
  size: number
}

/** Children of a folder, biggest first; on a tie folders come before files, then scan order. */
function sortedEntries(store: TreeStore, folder: number): Entry[] {
  const entries: Entry[] = []
  for (const index of store.childFolders(folder)) {
    entries.push({ isFolder: true, index, size: store.folderSize(index) })
  }
  for (const index of store.filesIn(folder)) {
    entries.push({ isFolder: false, index, size: store.fileSize(index) })
  }
  return entries.sort(
    (a, b) => b.size - a.size || Number(b.isFolder) - Number(a.isFolder) || a.index - b.index,
  )
}

/** `path.join` for a folder path and one name, without its normalizing (a million calls). */
const child = (folderPath: string, name: string) =>
  folderPath.endsWith(path.sep) ? folderPath + name : folderPath + path.sep + name

/** One decimal, 0 to 100. */
const percent = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0

/**
 * Every folder and file below `root`, depth first: a folder comes before its children, and the
 * children of each folder are in `sortedEntries` order. The root itself is not a row.
 */
export function* treeRows(store: TreeStore, root: number): Generator<Cell[]> {
  interface Frame {
    path: string
    size: number
    entries: Entry[]
    next: number
  }
  const frame = (folder: number, folderPath: string): Frame => ({
    path: folderPath,
    size: store.folderSize(folder),
    entries: sortedEntries(store, folder),
    next: 0,
  })
  const stack = [frame(root, store.folderPath(root))]
  for (let top = stack.at(-1); top !== undefined; top = stack.at(-1)) {
    const entry = top.entries[top.next]
    if (entry === undefined) {
      stack.pop()
      continue
    }
    top.next += 1
    if (entry.isFolder) {
      const name = store.folderName(entry.index)
      const folderPath = child(top.path, name)
      yield [
        folderPath,
        name,
        'Folder',
        '',
        entry.size,
        store.folderAllocated(entry.index),
        store.folderFiles(entry.index),
        store.folderFolders(entry.index),
        dateCell(store.folderModified(entry.index)),
        percent(entry.size, top.size),
      ]
      stack.push(frame(entry.index, folderPath))
    } else {
      const name = store.fileName(entry.index)
      yield [
        child(top.path, name),
        name,
        'File',
        fileExtension(name),
        entry.size,
        store.fileAllocated(entry.index),
        1,
        0,
        dateCell(store.fileModified(entry.index)),
        percent(entry.size, top.size),
      ]
    }
  }
}

/** Text is gathered to about this size before it is written. */
const BATCH_CHARS = 64 * 1024

/** What the user sees when the file cannot be written; anything else keeps the system's words. */
function friendlyError(error: unknown): Error {
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
    return new Error(
      'The file is open in another program, or StorageIQ is not allowed to write there.',
    )
  }
  if (code === 'ENOSPC') return new Error('There is not enough free space to save the file.')
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Writes the whole tree below `nodeId` to `filePath`, streaming: a CSV (UTF-8 with a BOM, CRLF,
 * no row limit) or an Excel workbook (Tree, Top files, Types and Age sheets; the Tree sheet stops
 * at `maxRows`). Null when the node is gone. A file that could not be finished is deleted.
 */
export async function exportTree(
  store: TreeStore,
  views: SideViews,
  nodeId: NodeId,
  format: ExportFormat,
  filePath: string,
  maxRows = XLSX_MAX_ROWS,
): Promise<ExportSummary | null> {
  const ref = resolveNode(store, nodeId)
  if (ref === null) return null
  const folder = folderOf(store, ref)

  const out = createWriteStream(filePath)
  let opened = false
  let failure = null as Error | null
  // An error event with no listener would end the scanner process.
  out.on('error', (error) => {
    failure ??= error
  })
  const write = async (chunk: string | Buffer) => {
    if (failure !== null) throw failure
    if (!out.write(chunk)) await once(out, 'drain')
  }

  try {
    await once(out, 'open') // a file that is open elsewhere fails here, before any work
    opened = true
    let summary: ExportSummary
    if (format === 'csv') {
      await write(CSV_BOM + csvLine(TREE_HEADER))
      let batch = ''
      let rows = 0
      for (const row of treeRows(store, folder)) {
        batch += csvLine(row)
        rows += 1
        if (batch.length >= BATCH_CHARS) {
          await write(batch)
          batch = ''
        }
      }
      if (batch !== '') await write(batch)
      summary = { rows, truncated: false }
    } else {
      const sheets: SheetSpec[] = [
        {
          name: 'Tree',
          header: TREE_HEADER,
          widths: [70, 30, 8, 10, 14, 16, 8, 8, 20, 11],
          rows: treeRows(store, folder),
          maxRows,
        },
        {
          name: 'Top files',
          header: TOP_FILES_COLUMNS.header,
          widths: [32, 60, 14, 16, 20],
          rows: (views.topFiles(nodeId, 'size') ?? []).map((row) => TOP_FILES_COLUMNS.cells(row)),
        },
        {
          name: 'Types',
          header: TYPES_COLUMNS.header,
          widths: [18, 22, 14, 16, 10],
          rows: (views.types(nodeId) ?? []).map((row) => TYPES_COLUMNS.cells(row)),
        },
        {
          name: 'Age',
          header: AGE_COLUMNS.header,
          widths: [16, 14, 16, 10],
          rows: (views.age(nodeId) ?? []).map((row) => AGE_COLUMNS.cells(row)),
        },
      ]
      const [tree] = await writeXlsx(write, sheets)
      summary = { rows: tree?.rows ?? 0, truncated: tree?.truncated ?? false }
    }
    out.end()
    await finished(out)
    return summary
  } catch (error) {
    out.destroy()
    if (opened) {
      if (!out.closed) await once(out, 'close').catch(() => undefined)
      await rm(filePath, { force: true }).catch(() => undefined)
    }
    throw friendlyError(failure ?? error)
  }
}
```

`src/worker/scanner/scanner-host.ts`:

```diff
--- a/src/worker/scanner/scanner-host.ts
+++ b/src/worker/scanner/scanner-host.ts
@@ -1,3 +1,4 @@
+import path from 'node:path'
 import type { ScanDone, ScanProgress } from '@shared/scan-types'
 import type {
   ScannerMessage,
@@ -6,7 +7,7 @@ import type {
   ScannerRequest,
   ScanVolume,
 } from '@shared/scanner-protocol'
-import { MAX_PATH_QUERY_IDS } from '@shared/scanner-protocol'
+import { EXPORT_FORMATS, MAX_PATH_QUERY_IDS, type ExportFormat } from '@shared/scanner-protocol'
 import { SIZE_MODES, SORT_KEYS, type SizeMode, type SortKey } from '@shared/tree-types'
 import {
   ChildSorter,
@@ -17,6 +18,7 @@ import {
   nodeDetails,
   resolveNode,
 } from './tree-queries'
+import { exportTree } from './export-tree'
 import { TreeStore } from './tree-store'
 import { SideViews } from './side-views'
 import { treemapLayout } from './treemap'
@@ -127,6 +129,12 @@ function parseQuery(value: unknown): ScannerQuery | null {
       return str(nodeId) ? { kind: 'types', scanId, nodeId } : null
     case 'age':
       return str(nodeId) ? { kind: 'age', scanId, nodeId } : null
+    case 'export': {
+      const { format, filePath } = value
+      if (!str(nodeId) || !EXPORT_FORMATS.includes(format as ExportFormat)) return null
+      if (!str(filePath) || !path.isAbsolute(filePath)) return null
+      return { kind: 'export', scanId, nodeId, format: format as ExportFormat, filePath }
+    }
     case 'paths': {
       const ids = value['nodeIds']
       if (!Array.isArray(ids) || ids.length > MAX_PATH_QUERY_IDS || !ids.every(str)) return null
@@ -289,6 +297,8 @@ export function createScannerHost(deps: ScannerHostDeps): ScannerHost {
         return sideViews.types(query.nodeId)
       case 'age':
         return sideViews.age(query.nodeId)
+      case 'export':
+        return exportTree(store, sideViews, query.nodeId, query.format, query.filePath)
       case 'totals':
         return store.totals()
     }
```

`src/worker/scanner/xlsx-writer.ts`:

```diff
--- a/src/worker/scanner/xlsx-writer.ts
+++ b/src/worker/scanner/xlsx-writer.ts
@@ -67,7 +67,7 @@ export class ZipWriter {
     }
     await this.raw(Buffer.concat([header, nameBytes]))

-    const deflate = createDeflateRaw()
+    const deflate = createDeflateRaw({ level: 1 })
     const drained = (async () => {
       for await (const chunk of deflate as AsyncIterable<Buffer>) {
         entry.compressed += chunk.length
@@ -151,10 +151,16 @@ const MAX_CELL_CHARS = 32_767
 /** Days from 1899-12-30 (Excel's day 0) to 1970-01-01. */
 const EXCEL_EPOCH_DAYS = 25_569

+const columnNames: string[] = []
+/** `A`, `B`, … `Z`, `AA`, … (remembered: a million rows ask for the same few). */
 function columnName(index: number): string {
-  let name = ''
-  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
-    name = String.fromCharCode(65 + ((n - 1) % 26)) + name
+  let name = columnNames[index]
+  if (name === undefined) {
+    name = ''
+    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
+      name = String.fromCharCode(65 + ((n - 1) % 26)) + name
+    }
+    columnNames[index] = name
   }
   return name
 }
@@ -230,9 +236,9 @@ async function writeSheet(
     }
     rows += 1
     batch += `<row r="${rows + 1}">`
-    row.forEach((cell, i) => {
-      batch += cellXml(`${columnName(i)}${rows + 1}`, cell)
-    })
+    for (let i = 0; i < row.length; i += 1) {
+      batch += cellXml(columnName(i) + (rows + 1), row[i] ?? null)
+    }
     batch += '</row>'
     if (batch.length >= BATCH_CHARS) await flush()
   }
```

- [ ] **Step 4: Run the tests and the gates**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/worker"`
Expected: PASS. Then the perf test: `powershell.exe -NoProfile -Command "npx vitest run --config vitest.perf.config.mts --reporter=verbose --disable-console-intercept"` prints `csvExportMs` about 4,800 (limit 10,000) and `xlsxExportMs` about 8,600 (limit 20,000) on the dev machine.

Then: `powershell.exe -NoProfile -Command "npm run typecheck; npm run lint; npm run format:check"` (clean).

- [ ] **Step 5: Commit**

```bash
git add src/shared/scanner-protocol.ts src/worker/scanner/export-tree.test.ts src/worker/scanner/export-tree.ts src/worker/scanner/scanner-host.test.ts src/worker/scanner/scanner-host.ts src/worker/scanner/test/unzip.ts src/worker/scanner/tree-store.perf.test.ts src/worker/scanner/xlsx-writer.test.ts src/worker/scanner/xlsx-writer.ts
git commit -m "feat(export): scanner writes the whole tree to CSV or Excel"
```

---

### Task 6: Main: `export:run`, `shell:show-export` and the preload bridge

**Implementer tier:** Haiku (all code and tests are in the plan).

**Files:**

- Modify: `e2e/app.spec.ts`
- Modify: `src/main/index.ts`
- Create: `src/main/ipc/export-handlers.test.ts`
- Create: `src/main/ipc/export-handlers.ts`
- Modify: `src/main/ipc/parse-args.test.ts`
- Modify: `src/main/ipc/parse-args.ts`
- Modify: `src/main/ipc/register.test.ts`
- Modify: `src/preload/index.test.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/test/fake-api.ts`
- Modify: `src/shared/ipc-contract.ts`

**Interfaces:**

- Consumes: `resolveScanNode`, `NOT_IN_SCAN_MESSAGE`, `SCAN_RUNNING_MESSAGE`, `TreeScanService` from `tree-handlers.ts`; the `export` query (Task 5).
- Produces (`ipc-contract.ts`): `type ExportResult = { status: 'cancelled' } | ({ status: 'done'; filePath: string } & ExportSummary) | { status: 'failed'; message: string }`; channels `'export:run': { args: [scanId, nodeId, format: ExportFormat]; result: ExportResult }` and `'shell:show-export': { args: []; result: void }`; bridge methods `exportTree(scanId, nodeId, format): Promise<ExportResult>` and `showExport(): Promise<void>`.
- Produces (`parse-args.ts`): `exportArgs(args): [string, NodeId, ExportFormat]`.
- Produces (`export-handlers.ts`): `createExportHandlers(deps: ExportHandlerDeps): ExportHandlers`, `ExportHandlerDeps { scanService: TreeScanService; dialog: { showSaveDialog(window, options) }; getMainWindow(); defaultFolder(): string; showItemInFolder(target: string): void }`, `exportFileName(folderName, format)`, `EXPORT_RUNNING_MESSAGE`.
- Produces (test): `TEST_EXPORT_PATH` and fake `exportTree` / `showExport` in `src/renderer/src/test/fake-api.ts`.

- [ ] **Step 1: Write the failing tests**

`e2e/app.spec.ts`:

```diff
--- a/e2e/app.spec.ts
+++ b/e2e/app.spec.ts
@@ -44,6 +44,7 @@ test('launches a locked-down renderer with the StorageIQ bridge', async () => {
     'createFolder',
     'deleteNodes',
     'downloadUpdate',
+    'exportTree',
     'getAgeBreakdown',
     'getAppInfo',
     'getAutoUpdate',
@@ -82,6 +83,7 @@ test('launches a locked-down renderer with the StorageIQ bridge', async () => {
     'setExplorerMenu',
     'setRunAsAdmin',
     'showContextMenu',
+    'showExport',
     'startScan',
     'takeLaunchRequest',
   ])
```

`src/main/ipc/export-handlers.test.ts` (new):

```ts
import path from 'node:path'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { ScannerQuery } from '@shared/scanner-protocol'
import {
  createExportHandlers,
  EXPORT_RUNNING_MESSAGE,
  exportFileName,
  type ExportHandlerDeps,
} from './export-handlers'
import { InvalidIpcArgumentsError } from './parse-args'
import { fakeTreeService, SCAN } from './test/fake-tree-service'
import { NOT_IN_SCAN_MESSAGE, SCAN_RUNNING_MESSAGE } from './tree-handlers'

const event = {} as IpcMainInvokeEvent
const window = {} as BrowserWindow

function setup(
  options: {
    scanning?: boolean
    chosen?: { canceled: boolean; filePath: string }
    summary?: { rows: number; truncated: boolean } | null | Error
    window?: BrowserWindow | null
  } = {},
) {
  const fake = fakeTreeService({ scanning: options.scanning })
  const exportQueries: ScannerQuery[] = []
  const query = fake.service.query
  fake.service.query = vi.fn(async (q: ScannerQuery) => {
    if (q.kind !== 'export') return query(q as never)
    exportQueries.push(q)
    const summary = options.summary === undefined ? { rows: 42, truncated: false } : options.summary
    if (summary instanceof Error) throw summary
    return summary
  }) as typeof fake.service.query
  const showSaveDialog = vi.fn<ExportHandlerDeps['dialog']['showSaveDialog']>(
    async () => options.chosen ?? { canceled: false, filePath: 'C:\\Out\\Photos - StorageIQ.csv' },
  )
  const showItemInFolder = vi.fn<(target: string) => void>()
  const handlers = createExportHandlers({
    scanService: fake.service,
    dialog: { showSaveDialog },
    getMainWindow: () => (options.window === undefined ? window : options.window),
    defaultFolder: () => 'C:\\Users\\Ana\\Documents',
    showItemInFolder,
  })
  return { handlers, exportQueries, showSaveDialog, showItemInFolder }
}

describe('exportFileName', () => {
  it('is the folder name and "StorageIQ", without characters Windows refuses', () => {
    expect(exportFileName('Photos', 'csv')).toBe('Photos - StorageIQ.csv')
    expect(exportFileName('Reports 2026', 'xlsx')).toBe('Reports 2026 - StorageIQ.xlsx')
    expect(exportFileName('D:\\', 'csv')).toBe('D - StorageIQ.csv')
    expect(exportFileName('a/b:c*d?', 'csv')).toBe('abcd - StorageIQ.csv')
    expect(exportFileName('', 'xlsx')).toBe('Export - StorageIQ.xlsx')
  })
})

describe('export:run', () => {
  it('validates its arguments before anything happens', () => {
    const { handlers, showSaveDialog } = setup()
    expect(() => handlers['export:run'].parseArgs([SCAN, 'd1', 'pdf'])).toThrow(
      InvalidIpcArgumentsError,
    )
    expect(() => handlers['export:run'].parseArgs([SCAN, 'd1', 'csv', 'C:\\x.csv'])).toThrow(
      InvalidIpcArgumentsError,
    )
    expect(showSaveDialog).not.toHaveBeenCalled()
  })

  it('asks where to save, then has the scanner write exactly that file', async () => {
    const { handlers, exportQueries, showSaveDialog } = setup()
    const result = await handlers['export:run'].handle(event, SCAN, 'd1', 'csv')
    expect(result).toEqual({
      status: 'done',
      filePath: 'C:\\Out\\Photos - StorageIQ.csv',
      rows: 42,
      truncated: false,
    })
    expect(showSaveDialog).toHaveBeenCalledWith(window, {
      title: 'Export to CSV',
      defaultPath: path.join('C:\\Users\\Ana\\Documents', 'Photos - StorageIQ.csv'),
      filters: [{ name: 'CSV file', extensions: ['csv'] }],
    })
    expect(exportQueries).toEqual([
      {
        kind: 'export',
        scanId: SCAN,
        nodeId: 'd1',
        format: 'csv',
        filePath: 'C:\\Out\\Photos - StorageIQ.csv',
      },
    ])
  })

  it('offers an Excel filter and name for xlsx', async () => {
    const { handlers, showSaveDialog } = setup()
    await handlers['export:run'].handle(event, SCAN, 'd1', 'xlsx')
    expect(showSaveDialog).toHaveBeenCalledWith(
      window,
      expect.objectContaining({
        title: 'Export to Excel',
        defaultPath: path.join('C:\\Users\\Ana\\Documents', 'Photos - StorageIQ.xlsx'),
        filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
      }),
    )
  })

  it('passes on that the Excel sheet was cut', async () => {
    const { handlers } = setup({ summary: { rows: 1_048_575, truncated: true } })
    expect(await handlers['export:run'].handle(event, SCAN, 'd1', 'xlsx')).toMatchObject({
      status: 'done',
      truncated: true,
    })
  })

  it('writes nothing when the save dialog is cancelled', async () => {
    const { handlers, exportQueries } = setup({ chosen: { canceled: true, filePath: '' } })
    expect(await handlers['export:run'].handle(event, SCAN, 'd1', 'csv')).toEqual({
      status: 'cancelled',
    })
    expect(exportQueries).toEqual([])
  })

  it('reports a write error with its message', async () => {
    const { handlers } = setup({ summary: new Error('The file is open in another program.') })
    expect(await handlers['export:run'].handle(event, SCAN, 'd1', 'csv')).toEqual({
      status: 'failed',
      message: 'The file is open in another program.',
    })
  })

  it('refuses during a scan, for another scan, and for a node that is gone', async () => {
    const scanning = setup({ scanning: true })
    expect(await scanning.handlers['export:run'].handle(event, SCAN, 'd1', 'csv')).toEqual({
      status: 'failed',
      message: SCAN_RUNNING_MESSAGE,
    })
    const idle = setup()
    expect(await idle.handlers['export:run'].handle(event, 'f0f0', 'd1', 'csv')).toEqual({
      status: 'failed',
      message: NOT_IN_SCAN_MESSAGE,
    })
    expect(await idle.handlers['export:run'].handle(event, SCAN, 'd99', 'csv')).toEqual({
      status: 'failed',
      message: NOT_IN_SCAN_MESSAGE,
    })
    expect(idle.showSaveDialog).not.toHaveBeenCalled()
  })

  it('runs one export at a time', async () => {
    const { handlers, showSaveDialog } = setup()
    let release: (value: { canceled: boolean; filePath: string }) => void = () => undefined
    showSaveDialog.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const first = handlers['export:run'].handle(event, SCAN, 'd1', 'csv')
    await vi.waitFor(() => expect(showSaveDialog).toHaveBeenCalledTimes(1))
    expect(await handlers['export:run'].handle(event, SCAN, 'd1', 'csv')).toEqual({
      status: 'failed',
      message: EXPORT_RUNNING_MESSAGE,
    })
    release({ canceled: true, filePath: '' })
    expect(await first).toEqual({ status: 'cancelled' })
    // The next export is allowed again.
    expect(await handlers['export:run'].handle(event, SCAN, 'd1', 'csv')).toMatchObject({
      status: 'done',
    })
  })
})

describe('shell:show-export', () => {
  it('takes no arguments and does nothing before an export', async () => {
    const { handlers, showItemInFolder } = setup()
    expect(() => handlers['shell:show-export'].parseArgs(['C:\\Windows'])).toThrow(
      InvalidIpcArgumentsError,
    )
    await handlers['shell:show-export'].handle(event)
    expect(showItemInFolder).not.toHaveBeenCalled()
  })

  it('shows the file of the last successful export only', async () => {
    const { handlers, showItemInFolder } = setup()
    await handlers['export:run'].handle(event, SCAN, 'd1', 'csv')
    await handlers['shell:show-export'].handle(event)
    expect(showItemInFolder).toHaveBeenCalledWith('C:\\Out\\Photos - StorageIQ.csv')
  })
})
```

`src/main/ipc/parse-args.test.ts`:

```diff
--- a/src/main/ipc/parse-args.test.ts
+++ b/src/main/ipc/parse-args.test.ts
@@ -17,6 +17,7 @@ import {
   oneBoolean,
   oneString,
   scanNodeArgs,
+  exportArgs,
   topFilesArgs,
   treemapArgs,
 } from './parse-args'
@@ -146,6 +147,24 @@ describe('topFilesArgs', () => {
   })
 })

+describe('exportArgs', () => {
+  it('accepts a scan id, a node id and a format', () => {
+    expect(exportArgs([SCAN, 'd0', 'csv'])).toEqual([SCAN, 'd0', 'csv'])
+    expect(exportArgs([SCAN, 'd12', 'xlsx'])).toEqual([SCAN, 'd12', 'xlsx'])
+  })
+
+  it.each([
+    [[SCAN, 'd0']],
+    [[SCAN, 'd0', 'pdf']],
+    [[SCAN, 'd0', 'csv', 'C:\\out.csv']],
+    [[SCAN, 'C:\\Windows', 'csv']],
+    [['not a scan id!', 'd0', 'csv']],
+    [[SCAN, 'd0', undefined]],
+  ])('rejects %j', (args) => {
+    expect(() => exportArgs(args)).toThrow(InvalidIpcArgumentsError)
+  })
+})
+
 describe('copyTextArgs', () => {
   it('accepts text up to the limit', () => {
     expect(copyTextArgs(['Name,Size\r\nA,1\r\n'])).toEqual(['Name,Size\r\nA,1\r\n'])
```

`src/main/ipc/register.test.ts`:

```diff
--- a/src/main/ipc/register.test.ts
+++ b/src/main/ipc/register.test.ts
@@ -17,6 +17,7 @@ import {
   oneString,
   scanNodeArgs,
   scanNodesArgs,
+  exportArgs,
   topFilesArgs,
   treemapArgs,
 } from './parse-args'
@@ -57,6 +58,8 @@ function createHandlers(overrides: Partial<IpcHandlerMap> = {}): IpcHandlerMap {
     'side:top-files': { parseArgs: topFilesArgs, handle: () => null },
     'side:types': { parseArgs: scanNodeArgs, handle: () => null },
     'side:age': { parseArgs: scanNodeArgs, handle: () => null },
+    'export:run': { parseArgs: exportArgs, handle: () => ({ status: 'cancelled' }) },
+    'shell:show-export': { parseArgs: noArgs, handle: () => undefined },
     'icons:for-nodes': {
       parseArgs: iconNodesArgs,
       handle: () => ({ keys: {}, images: {}, pending: [] }),
@@ -153,6 +156,7 @@ describe('registerIpcHandlers', () => {
       'dialog:select-folder',
       'drive:info',
       'drives:list',
+      'export:run',
       'folder:create',
       'icons:for-nodes',
       'icons:for-types',
@@ -168,6 +172,7 @@ describe('registerIpcHandlers', () => {
       'shell:context-menu',
       'shell:delete',
       'shell:open-in-explorer',
+      'shell:show-export',
       'side:age',
       'side:top-files',
       'side:types',
```

`src/preload/index.test.ts`:

```diff
--- a/src/preload/index.test.ts
+++ b/src/preload/index.test.ts
@@ -140,6 +140,16 @@ describe('preload bridge', () => {
     expect(ipcRenderer.invoke).toHaveBeenCalledWith('side:age', 'scan-1', 'f2')
   })

+  it('the export calls send ids and a format, never a path', async () => {
+    const { ipcRenderer } = await import('electron')
+    const call = (name: string, ...args: unknown[]) =>
+      (exposed[name] as unknown as (...a: unknown[]) => Promise<unknown>)(...args)
+    await call('exportTree', 'scan-1', 'd1', 'xlsx')
+    expect(ipcRenderer.invoke).toHaveBeenCalledWith('export:run', 'scan-1', 'd1', 'xlsx')
+    await call('showExport')
+    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('shell:show-export')
+  })
+
   it('getIcons and getTypeIcons send only ids and type keys', async () => {
     const { ipcRenderer } = await import('electron')
     await (exposed['getIcons'] as unknown as (...args: unknown[]) => Promise<unknown>)('scan-1', [
```

- [ ] **Step 2: Run them and watch them fail**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/main src/preload src/shared"`
Expected: FAIL: `./export-handlers` does not exist; `exportArgs` is not exported; the channel list in `register.test.ts` is missing the two channels.

- [ ] **Step 3: Implement**

`src/main/index.ts`:

```diff
--- a/src/main/index.ts
+++ b/src/main/index.ts
@@ -41,6 +41,7 @@ import { createScanHandlers } from './ipc/scan-handlers'
 import { createEventSender } from './ipc/send-event'
 import { createItemWatcher } from './ipc/item-watcher'
 import { createShellHandlers, itemExists } from './ipc/shell-handlers'
+import { createExportHandlers } from './ipc/export-handlers'
 import { createFolderRefresher, createTreeHandlers } from './ipc/tree-handlers'
 import { autoUpdater } from 'electron-updater'
 import { findScanArgument, parseSecondInstanceData } from './launch/launch-args'
@@ -581,6 +582,19 @@ if (process.argv.includes(SELF_TEST_FLAG)) {
             }),
         }),
         ...createTreeHandlers({ scanService, refreshFolder }),
+        ...createExportHandlers({
+          scanService,
+          dialog,
+          getMainWindow: () => mainWindow,
+          defaultFolder: () => {
+            try {
+              return app.getPath('documents')
+            } catch {
+              return app.getPath('home')
+            }
+          },
+          showItemInFolder: (target) => shell.showItemInFolder(target),
+        }),
         ...createIconHandlers({
           scanService,
           icons: {
```

`src/main/ipc/export-handlers.ts` (new):

```ts
import path from 'node:path'
import type { BrowserWindow, SaveDialogOptions, SaveDialogReturnValue } from 'electron'
import type { ExportResult } from '@shared/ipc-contract'
import type { ExportFormat } from '@shared/scanner-protocol'
import { exportArgs, noArgs } from './parse-args'
import type { IpcHandlerMap } from './register'
import {
  NOT_IN_SCAN_MESSAGE,
  resolveScanNode,
  SCAN_RUNNING_MESSAGE,
  type TreeScanService,
} from './tree-handlers'

export type ExportHandlers = Pick<IpcHandlerMap, 'export:run' | 'shell:show-export'>

export const EXPORT_RUNNING_MESSAGE = 'An export is already running.'

export interface ExportHandlerDeps {
  scanService: TreeScanService
  dialog: {
    showSaveDialog(
      window: BrowserWindow,
      options: SaveDialogOptions,
    ): Promise<SaveDialogReturnValue>
  }
  getMainWindow(): BrowserWindow | null
  /** Where the save dialog opens (the Documents folder). */
  defaultFolder(): string
  /** `shell.showItemInFolder`. */
  showItemInFolder(target: string): void
}

const FILTERS: Record<
  ExportFormat,
  { title: string; filter: { name: string; extensions: string[] } }
> = {
  csv: { title: 'Export to CSV', filter: { name: 'CSV file', extensions: ['csv'] } },
  xlsx: { title: 'Export to Excel', filter: { name: 'Excel workbook', extensions: ['xlsx'] } },
}

/** `<folder name> - StorageIQ.csv`, without characters Windows does not allow in a file name. */
export function exportFileName(folderName: string, format: ExportFormat): string {
  const base = folderName.replace(/[\\/:*?"<>|]/g, '').trim()
  return `${base === '' ? 'Export' : base} - StorageIQ.${format}`
}

/**
 * Exports the folder's tree to a file. The renderer sends only (scan id, node id, format): the file
 * is chosen in main's save dialog and written by the scanner, so no path ever comes from the
 * renderer. Remembers the last file written so "Show in folder" can open it.
 */
export function createExportHandlers(deps: ExportHandlerDeps): ExportHandlers {
  const { scanService } = deps
  let running = false
  let lastExport: string | null = null

  const failed = (error: unknown): ExportResult => ({
    status: 'failed',
    message: error instanceof Error ? error.message : String(error),
  })

  return {
    'export:run': {
      parseArgs: exportArgs,
      handle: async (_event, scanId, nodeId, format): Promise<ExportResult> => {
        if (running) return { status: 'failed', message: EXPORT_RUNNING_MESSAGE }
        if (scanService.isScanning()) return { status: 'failed', message: SCAN_RUNNING_MESSAGE }
        running = true
        try {
          const details = await resolveScanNode(scanService, scanId, nodeId)
          const window = deps.getMainWindow()
          if (window === null) return { status: 'cancelled' }
          const { title, filter } = FILTERS[format]
          const name = exportFileName(details.row.kind === 'folder' ? details.row.name : '', format)
          const chosen = await deps.dialog.showSaveDialog(window, {
            title,
            defaultPath: path.join(deps.defaultFolder(), name),
            filters: [filter],
          })
          if (chosen.canceled || !chosen.filePath) return { status: 'cancelled' }
          const summary = await scanService.query({
            kind: 'export',
            scanId,
            nodeId,
            format,
            filePath: chosen.filePath,
          })
          if (summary === null) return { status: 'failed', message: NOT_IN_SCAN_MESSAGE }
          lastExport = chosen.filePath
          return { status: 'done', filePath: chosen.filePath, ...summary }
        } catch (error) {
          return failed(error)
        } finally {
          running = false
        }
      },
    },

    'shell:show-export': {
      parseArgs: noArgs,
      handle: () => {
        if (lastExport !== null) deps.showItemInFolder(lastExport)
      },
    },
  }
}
```

`src/main/ipc/parse-args.ts`:

```diff
--- a/src/main/ipc/parse-args.ts
+++ b/src/main/ipc/parse-args.ts
@@ -1,4 +1,5 @@
 import { type AboutLink, MAX_CLIPBOARD_TEXT } from '@shared/ipc-contract'
+import { EXPORT_FORMATS, type ExportFormat } from '@shared/scanner-protocol'
 import {
   MAX_PAGE_ROWS,
   MAX_TREEMAP_DEPTH,
@@ -168,6 +169,16 @@ export function topFilesArgs(args: readonly unknown[]): [string, NodeId, SizeMod
   return [scanIdArg(args[0]), nodeIdArg(args[1]), sizeModeArg(args[2])]
 }

+/** `export:run`: `[scanId, nodeId, format]` */
+export function exportArgs(args: readonly unknown[]): [string, NodeId, ExportFormat] {
+  expectCount(args, 3)
+  const format = args[2]
+  if (!EXPORT_FORMATS.includes(format as ExportFormat)) {
+    throw new InvalidIpcArgumentsError(`expected one of ${EXPORT_FORMATS.join(', ')}`)
+  }
+  return [scanIdArg(args[0]), nodeIdArg(args[1]), format as ExportFormat]
+}
+
 /** `clipboard:copy-text`: one string of 1 to `MAX_CLIPBOARD_TEXT` characters. */
 export function copyTextArgs(args: readonly unknown[]): [string] {
   const [text] = oneString(args)
```

`src/preload/index.ts`:

```diff
--- a/src/preload/index.ts
+++ b/src/preload/index.ts
@@ -26,6 +26,8 @@ const api: StorageIQApi = {
   getTopFiles: (scanId, nodeId, mode) => invoke('side:top-files', scanId, nodeId, mode),
   getTypeBreakdown: (scanId, nodeId) => invoke('side:types', scanId, nodeId),
   getAgeBreakdown: (scanId, nodeId) => invoke('side:age', scanId, nodeId),
+  exportTree: (scanId, nodeId, format) => invoke('export:run', scanId, nodeId, format),
+  showExport: () => invoke('shell:show-export'),
   openInExplorer: (scanId, nodeId) => invoke('shell:open-in-explorer', scanId, nodeId),
   showContextMenu: (scanId, nodeIds, x, y, extended) =>
     invoke('shell:context-menu', scanId, nodeIds, x, y, extended),
```

`src/renderer/src/test/fake-api.ts`:

```diff
--- a/src/renderer/src/test/fake-api.ts
+++ b/src/renderer/src/test/fake-api.ts
@@ -2,6 +2,7 @@ import { vi } from 'vitest'
 import type {
   AppInfo,
   ChangelogEntry,
+  ExportResult,
   IconBatch,
   LaunchRequest,
   OptionsChangeResult,
@@ -45,6 +46,9 @@ export const TEST_APP_INFO: AppInfo = {
   channel: 'Stable',
 }

+/** The file the fake bridge says an export wrote. */
+export const TEST_EXPORT_PATH = 'C:\\Users\\Ana\\Documents\\D - StorageIQ.csv'
+
 export const TEST_OPTIONS_STATE: OptionsState = {
   available: true,
   explorerMenu: false,
@@ -382,6 +386,13 @@ export function createFakeApi(overrides: Partial<StorageIQApi> = {}): FakeApi {
     getTopFiles: vi.fn(async (): Promise<TopFileRow[] | null> => TEST_TOP_FILES),
     getTypeBreakdown: vi.fn(async (): Promise<TypeRow[] | null> => TEST_TYPES),
     getAgeBreakdown: vi.fn(async (): Promise<AgeRow[] | null> => TEST_AGE),
+    exportTree: vi.fn(async (): Promise<ExportResult> => ({
+      status: 'done',
+      rows: 3,
+      truncated: false,
+      filePath: TEST_EXPORT_PATH,
+    })),
+    showExport: vi.fn(async () => undefined),
     openInExplorer: vi.fn(async () => undefined),
     showContextMenu: vi.fn(async () => ({ kind: 'dismissed' as const })),
     deleteNodes: vi.fn(async () => ({ kind: 'dismissed' as const })),
```

`src/shared/ipc-contract.ts`:

```diff
--- a/src/shared/ipc-contract.ts
+++ b/src/shared/ipc-contract.ts
@@ -8,6 +8,7 @@ import type {
   ScanRestarted,
   ScanStartResult,
 } from './scan-types'
+import type { ExportFormat, ExportSummary } from './scanner-protocol'
 import type {
   AgeRow,
   NodeId,
@@ -139,6 +140,12 @@ export interface OptionsChangeResult {
 /** A launch with `--scan <path>`: main already validated the path (or says why it is not usable). */
 export type LaunchRequest = { kind: 'scan'; path: string } | { kind: 'invalid'; message: string }

+/** How an export ended: no file (cancelled in the save dialog), the file written, or an error. */
+export type ExportResult =
+  | { status: 'cancelled' }
+  | ({ status: 'done'; filePath: string } & ExportSummary)
+  | { status: 'failed'; message: string }
+
 export interface IpcContract {
   'drives:list': { args: []; result: DriveInfo[] }
   'drive:info': { args: [root: string]; result: DriveDetails | null }
@@ -182,6 +189,11 @@ export interface IpcContract {
   }
   'side:types': { args: [scanId: string, nodeId: NodeId]; result: TypeRow[] | null }
   'side:age': { args: [scanId: string, nodeId: NodeId]; result: AgeRow[] | null }
+  'export:run': {
+    args: [scanId: string, nodeId: NodeId, format: ExportFormat]
+    result: ExportResult
+  }
+  'shell:show-export': { args: []; result: void }
   'shell:open-in-explorer': { args: [scanId: string, nodeId: NodeId]; result: void }
   'shell:context-menu': {
     args: [scanId: string, nodeIds: NodeId[], x: number, y: number, extended: boolean]
@@ -286,6 +298,13 @@ export interface StorageIQApi {
   getTypeBreakdown(scanId: string, nodeId: NodeId): Promise<TypeRow[] | null>
   /** Bytes per modification-age bucket below a folder (always 8 rows); null when gone. */
   getAgeBreakdown(scanId: string, nodeId: NodeId): Promise<AgeRow[] | null>
+  /**
+   * Exports the whole tree below a folder to a CSV or Excel file: main shows the save dialog and
+   * the scanner writes the file, so the renderer never sees a path until it is written.
+   */
+  exportTree(scanId: string, nodeId: NodeId, format: ExportFormat): Promise<ExportResult>
+  /** Shows the file of the last successful export in File Explorer; nothing before one. */
+  showExport(): Promise<void>
   openInExplorer(scanId: string, nodeId: NodeId): Promise<void>
   /**
    * Shows the Windows Explorer context menu for one or more rows (1 to 1,000) at window
```

- [ ] **Step 4: Run the tests and the gates**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/main src/preload src/shared"`
Expected: PASS.

Then: `powershell.exe -NoProfile -Command "npm run typecheck; npm run lint; npm run format:check"` (clean).

- [ ] **Step 5: Commit**

```bash
git add e2e/app.spec.ts src/main/index.ts src/main/ipc/export-handlers.test.ts src/main/ipc/export-handlers.ts src/main/ipc/parse-args.test.ts src/main/ipc/parse-args.ts src/main/ipc/register.test.ts src/preload/index.test.ts src/preload/index.ts src/renderer/src/test/fake-api.ts src/shared/ipc-contract.ts
git commit -m "feat(export): export:run and shell:show-export channels with a save dialog in main"
```

---

### Task 7: The File tab Export group, the status bar and the banners

**Implementer tier:** Sonnet (store, ribbon, banner and status bar).

**Files:**

- Modify: `src/renderer/src/components/Banner.test.tsx`
- Modify: `src/renderer/src/components/Banner.tsx`
- Modify: `src/renderer/src/components/Ribbon.test.tsx`
- Modify: `src/renderer/src/components/Ribbon.tsx`
- Modify: `src/renderer/src/components/StatusBar.test.tsx`
- Modify: `src/renderer/src/components/StatusBar.tsx`
- Modify: `src/renderer/src/lib/icons.ts`
- Create: `src/renderer/src/stores/workspace-store-export.test.ts`
- Modify: `src/renderer/src/stores/workspace-store.ts`

**Interfaces:**

- Consumes: `api.exportTree`, `api.showExport` (Task 6), `formatCount`.
- Produces (`workspace-store.ts`): `Banner.tone` gains `'success'` and `Banner.showExport?: boolean`; state `exporting: ExportFormat | null`; actions `exportTree(format: ExportFormat): Promise<void>` (only when `phase === 'done'` and nothing is exporting; sets `exporting` and the announcement `Exporting…`; ends with a success banner, an error banner or nothing when cancelled) and `showExport(): Promise<void>`; exports `EXPORTING_MESSAGE`, `EXPORT_CUT_MESSAGE`, `exportedMessage(result)`.
- Produces (UI): an **Export** group on the File tab with `Export to CSV…` and `Export to Excel…` (disabled unless the scan is done and nothing is exporting); `Exporting…` in the status bar; the success banner is `role="status"` with a **Show in folder** button; icons `IconExportCsv`, `IconExportExcel`.

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/components/Banner.test.tsx`:

```diff
--- a/src/renderer/src/components/Banner.test.tsx
+++ b/src/renderer/src/components/Banner.test.tsx
@@ -1,5 +1,6 @@
 // @vitest-environment jsdom
 import { act, screen } from '@testing-library/react'
+import userEvent from '@testing-library/user-event'
 import { describe, expect, it } from 'vitest'
 import { renderWithStores } from '../test/render'
 import { Banner } from './Banner'
@@ -22,6 +23,28 @@ describe('<Banner />', () => {
     expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveAccessibleName('Dismiss')
   })

+  it('a finished export is a calm status, with a Show in folder button', async () => {
+    const user = userEvent.setup()
+    const { api, workspace } = renderWithStores(<Banner />)
+    act(() =>
+      workspace.setState({
+        banner: { tone: 'success', message: 'Exported 3 rows to a.csv.', showExport: true },
+      }),
+    )
+    const status = screen.getByRole('status')
+    expect(status).toHaveTextContent('Exported 3 rows to a.csv.')
+    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
+    await user.click(screen.getByRole('button', { name: 'Show in folder' }))
+    expect(api.showExport).toHaveBeenCalledTimes(1)
+    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
+  })
+
+  it('an error has no Show in folder button', () => {
+    const { workspace } = renderWithStores(<Banner />)
+    act(() => workspace.setState({ banner: { tone: 'error', message: 'No.' } }))
+    expect(screen.queryByRole('button', { name: 'Show in folder' })).not.toBeInTheDocument()
+  })
+
   it('a scanner crash shows the colour error icon and a Retry button', () => {
     const { workspace } = renderWithStores(<Banner />)
     act(() => workspace.setState({ banner: { tone: 'crash', message: 'The scanner stopped.' } }))
```

`src/renderer/src/components/Ribbon.test.tsx`:

```diff
--- a/src/renderer/src/components/Ribbon.test.tsx
+++ b/src/renderer/src/components/Ribbon.test.tsx
@@ -2,6 +2,7 @@
 import { act, screen, waitFor, within } from '@testing-library/react'
 import userEvent from '@testing-library/user-event'
 import { describe, expect, it, vi } from 'vitest'
+import type { ExportResult } from '@shared/ipc-contract'
 import { createFakeApi } from '../test/fake-api'
 import { renderWithStores } from '../test/render'
 import { makeDone } from '../test/scan-fixtures'
@@ -158,6 +159,50 @@ describe('<Ribbon />', () => {
     expect(workspace.getState().treemapVisible).toBe(false)
   })

+  it('the File tab has an Export group that waits for a finished scan', async () => {
+    const user = userEvent.setup()
+    const { api, workspace } = renderRibbon()
+    await user.click(screen.getByRole('tab', { name: 'File' }))
+    const group = within(toolbar()).getByRole('group', { name: 'Export' })
+    const buttons = within(group).getAllByRole('button')
+    expect(buttons.map((button) => button.textContent)).toEqual([
+      'Export to CSV…',
+      'Export to Excel…',
+    ])
+    for (const button of buttons) expect(button).toHaveAttribute('aria-disabled', 'true')
+
+    await act(() => workspace.getState().startScan('D:\\'))
+    for (const button of buttons) expect(button).toHaveAttribute('aria-disabled', 'true')
+    act(() => api.emitScanDone(makeDone()))
+    for (const button of buttons) expect(button).not.toHaveAttribute('aria-disabled')
+
+    await user.click(buttons[1] as HTMLElement)
+    expect(api.exportTree).toHaveBeenCalledWith('scan-1', 'd0', 'xlsx')
+    await waitFor(() => expect(workspace.getState().exporting).toBeNull())
+  })
+
+  it('both Export commands wait while an export runs', async () => {
+    const user = userEvent.setup()
+    let release: () => void = () => undefined
+    const api = createFakeApi({
+      exportTree: vi.fn(
+        () =>
+          new Promise<ExportResult>((resolve) => {
+            release = () => resolve({ status: 'cancelled' })
+          }),
+      ),
+    })
+    const { workspace } = renderRibbon(api)
+    await user.click(screen.getByRole('tab', { name: 'File' }))
+    await act(() => workspace.getState().startScan('D:\\'))
+    act(() => api.emitScanDone(makeDone()))
+    await user.click(command('Export to CSV…'))
+    expect(command('Export to CSV…')).toHaveAttribute('aria-disabled', 'true')
+    expect(command('Export to Excel…')).toHaveAttribute('aria-disabled', 'true')
+    await act(async () => release())
+    await waitFor(() => expect(command('Export to CSV…')).not.toHaveAttribute('aria-disabled'))
+  })
+
   it('the View tab has a Pane group with one toggle per bottom-pane view', async () => {
     const user = userEvent.setup()
     const { workspace } = renderRibbon()
```

`src/renderer/src/components/StatusBar.test.tsx`:

```diff
--- a/src/renderer/src/components/StatusBar.test.tsx
+++ b/src/renderer/src/components/StatusBar.test.tsx
@@ -35,6 +35,15 @@ describe('<StatusBar />', () => {
     expect(footer).toHaveTextContent('4,096 bytes per cluster (NTFS)')
   })

+  it('says "Exporting…" while an export runs', async () => {
+    const { workspace } = await renderBar()
+    expect(screen.getByRole('contentinfo')).not.toHaveTextContent('Exporting…')
+    act(() => workspace.setState({ exporting: 'csv' }))
+    expect(screen.getByRole('contentinfo')).toHaveTextContent('Exporting…')
+    act(() => workspace.setState({ exporting: null }))
+    expect(screen.getByRole('contentinfo')).not.toHaveTextContent('Exporting…')
+  })
+
   it('opens the list of unreadable items from the excluded count', async () => {
     const user = userEvent.setup()
     const { api } = await renderBar()
```

`src/renderer/src/stores/workspace-store-export.test.ts` (new):

```ts
import { describe, expect, it, vi } from 'vitest'
import type { ExportResult } from '@shared/ipc-contract'
import { createFakeApi, TEST_EXPORT_PATH } from '../test/fake-api'
import { makeDone } from '../test/scan-fixtures'
import {
  createWorkspaceStore,
  EXPORT_CUT_MESSAGE,
  EXPORTING_MESSAGE,
  exportedMessage,
} from './workspace-store'

async function finished(api = createFakeApi()) {
  const store = createWorkspaceStore(api)
  await store.getState().startScan('D:\\')
  api.emitScanDone(makeDone())
  return { api, store }
}

describe('exportedMessage', () => {
  it('names the number of rows and the file, not its folder', () => {
    expect(
      exportedMessage({
        status: 'done',
        rows: 12_345,
        truncated: false,
        filePath: TEST_EXPORT_PATH,
      }),
    ).toBe('Exported 12,345 rows to D - StorageIQ.csv.')
    expect(
      exportedMessage({ status: 'done', rows: 1, truncated: false, filePath: 'E:/x/Data.xlsx' }),
    ).toBe('Exported 1 row to Data.xlsx.')
  })

  it('says when the Excel sheet was cut', () => {
    expect(
      exportedMessage({ status: 'done', rows: 1_048_575, truncated: true, filePath: 'C:\\a.xlsx' }),
    ).toBe(`Exported 1,048,575 rows to a.xlsx. ${EXPORT_CUT_MESSAGE}`)
  })
})

describe('exportTree', () => {
  it('exports the treemap folder of the finished scan and ends with a calm banner', async () => {
    const { api, store } = await finished()
    store.getState().select('d1')
    await store.getState().exportTree('xlsx')
    expect(api.exportTree).toHaveBeenCalledWith('scan-1', 'd1', 'xlsx')
    expect(store.getState()).toMatchObject({
      exporting: null,
      banner: {
        tone: 'success',
        message: 'Exported 3 rows to D - StorageIQ.csv.',
        showExport: true,
      },
      announcement: 'Exported 3 rows to D - StorageIQ.csv.',
    })
  })

  it('shows "Exporting…" and refuses a second export while one runs', async () => {
    let release: (result: ExportResult) => void = () => undefined
    const exportTree = vi.fn(
      () =>
        new Promise<ExportResult>((resolve) => {
          release = resolve
        }),
    )
    const { store } = await finished(createFakeApi({ exportTree }))
    const first = store.getState().exportTree('csv')
    expect(store.getState()).toMatchObject({ exporting: 'csv', announcement: EXPORTING_MESSAGE })
    await store.getState().exportTree('xlsx')
    expect(exportTree).toHaveBeenCalledTimes(1)
    release({ status: 'cancelled' })
    await first
    expect(store.getState()).toMatchObject({ exporting: null, announcement: '', banner: null })
  })

  it('does nothing before a scan has finished, or while one runs', async () => {
    const api = createFakeApi()
    const store = createWorkspaceStore(api)
    await store.getState().exportTree('csv')
    await store.getState().startScan('D:\\')
    await store.getState().exportTree('csv') // still scanning
    expect(api.exportTree).not.toHaveBeenCalled()
  })

  it('shows the message of a failed export in an error banner', async () => {
    const { store } = await finished(
      createFakeApi({
        exportTree: vi.fn(async () => ({
          status: 'failed' as const,
          message: 'The file is open in another program.',
        })),
      }),
    )
    await store.getState().exportTree('csv')
    expect(store.getState().banner).toEqual({
      tone: 'error',
      message: 'Couldn’t export the tree. The file is open in another program.',
    })
    expect(store.getState().exporting).toBeNull()
  })

  it('shows an error banner when the call itself fails', async () => {
    const { store } = await finished(
      createFakeApi({
        exportTree: vi.fn(async () => {
          throw new Error('bridge down')
        }),
      }),
    )
    await store.getState().exportTree('csv')
    expect(store.getState().banner?.tone).toBe('error')
    expect(store.getState().exporting).toBeNull()
  })
})

describe('showExport', () => {
  it('asks main to show the last export', async () => {
    const { api, store } = await finished()
    await store.getState().showExport()
    expect(api.showExport).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/renderer"`
Expected: FAIL: `exportTree` / `exportedMessage` do not exist on the store; the ribbon has no Export group; the banner has no `status` role.

- [ ] **Step 3: Implement**

`src/renderer/src/components/Banner.tsx`:

```diff
--- a/src/renderer/src/components/Banner.tsx
+++ b/src/renderer/src/components/Banner.tsx
@@ -23,14 +23,16 @@ export const BANNER_ICONS: Record<BannerVariant, FluentIcon> = {
 export function Banner() {
   const banner = useWorkspace((s) => s.banner)
   const rescan = useWorkspace((s) => s.rescan)
+  const showExport = useWorkspace((s) => s.showExport)
   const dismissBanner = useWorkspace((s) => s.dismissBanner)
   if (banner === null) return null
   // A recoverable failure is calm (info); only a scanner crash is danger.
-  const variant: BannerVariant = banner.tone === 'crash' ? 'danger' : 'info'
+  const variant: BannerVariant =
+    banner.tone === 'crash' ? 'danger' : banner.tone === 'success' ? 'success' : 'info'
   const Icon = BANNER_ICONS[variant]
   return (
     <div
-      role="alert"
+      role={banner.tone === 'success' ? 'status' : 'alert'}
       className={`flex items-center justify-between gap-4 border-b border-line px-4 py-2 ${BANNER_VARIANT_CLASSES[variant]}`}
     >
       <div className="flex min-w-0 items-center gap-3">
@@ -39,6 +41,11 @@ export function Banner() {
       </div>
       <div className="flex shrink-0 gap-2">
         {banner.tone === 'crash' && <Button onClick={() => void rescan()}>Retry</Button>}
+        {banner.showExport === true && (
+          <Button variant="secondary" onClick={() => void showExport()}>
+            Show in folder
+          </Button>
+        )}
         <Button variant="quiet" onClick={dismissBanner}>
           Dismiss
         </Button>
```

`src/renderer/src/components/Ribbon.tsx`:

```diff
--- a/src/renderer/src/components/Ribbon.tsx
+++ b/src/renderer/src/components/Ribbon.tsx
@@ -9,6 +9,8 @@ import {
   IconChevronDown,
   IconDelete,
   IconExit,
+  IconExportCsv,
+  IconExportExcel,
   IconExpand,
   IconHelp,
   IconModeAllocated,
@@ -113,6 +115,8 @@ export function Ribbon({ onAbout }: { onAbout(): void }) {
   const unit = useWorkspace((s) => s.unit)
   const treemapVisible = useWorkspace((s) => s.treemapVisible)
   const paneTab = useWorkspace((s) => s.paneTab)
+  const exporting = useWorkspace((s) => s.exporting)
+  const exportTree = useWorkspace((s) => s.exportTree)
   const stopScan = useWorkspace((s) => s.stopScan)
   const rescan = useWorkspace((s) => s.rescan)
   const setMode = useWorkspace((s) => s.setMode)
@@ -136,6 +140,7 @@ export function Ribbon({ onAbout }: { onAbout(): void }) {
   const scanning = phase === 'scanning'
   const hasTree = phase !== 'empty' && phase !== 'failed'
   const cannotDelete = !hasTree || scanning || selectedId === null
+  const cannotExport = phase !== 'done' || exporting !== null

   const scanGroup = (
     <Group label="Scan">
@@ -319,14 +324,32 @@ export function Ribbon({ onAbout }: { onAbout(): void }) {

   const panels: Record<RibbonTab, ReactNode> = {
     file: (
-      <Group label="App">
-        <RibbonButton
-          label="Exit"
-          icon={IconExit}
-          title="Close StorageIQ"
-          onClick={() => void quit()}
-        />
-      </Group>
+      <>
+        <Group label="Export">
+          <RibbonButton
+            label="Export to CSV…"
+            icon={IconExportCsv}
+            disabled={cannotExport}
+            title="Save every folder and file below the folder shown in the pane as a CSV file"
+            onClick={() => void exportTree('csv')}
+          />
+          <RibbonButton
+            label="Export to Excel…"
+            icon={IconExportExcel}
+            disabled={cannotExport}
+            title="Save the same list, with the top files, types and ages, as an Excel workbook"
+            onClick={() => void exportTree('xlsx')}
+          />
+        </Group>
+        <Group label="App">
+          <RibbonButton
+            label="Exit"
+            icon={IconExit}
+            title="Close StorageIQ"
+            onClick={() => void quit()}
+          />
+        </Group>
+      </>
     ),
     home: (
       <>
```

`src/renderer/src/components/StatusBar.tsx`:

```diff
--- a/src/renderer/src/components/StatusBar.tsx
+++ b/src/renderer/src/components/StatusBar.tsx
@@ -5,6 +5,7 @@ import { selectionTotal } from '../lib/selection'
 import { rowIndexOf } from '../lib/tree-view-model'
 import { ANNOUNCE_INTERVAL_MS, useThrottledAnnouncement } from '../lib/use-throttled-announcement'
 import { useAppStore } from '../stores/app-store-context'
+import { EXPORTING_MESSAGE } from '../stores/workspace-store'
 import { useWorkspace } from '../stores/workspace-store-context'
 import { Dialog } from './Dialog'
 import { UnreadableList, unreadableSummary } from './UnreadableList'
@@ -26,6 +27,7 @@ export function StatusBar() {
   const errors = useWorkspace((s) => s.errors)
   const drive = useWorkspace((s) => s.drive)
   const announcement = useWorkspace((s) => s.announcement)
+  const exporting = useWorkspace((s) => s.exporting)
   const selectedIds = useWorkspace((s) => s.selectedIds)
   const lists = useWorkspace((s) => s.lists)
   const unit = useWorkspace((s) => s.unit)
@@ -98,6 +100,8 @@ export function StatusBar() {
         ) : (
           <span>{formatCount(excluded)} excluded</span>
         ))}
+      {exporting !== null && <Divider />}
+      {exporting !== null && <span>{EXPORTING_MESSAGE}</span>}
       {selectionText !== '' && <Divider />}
       {selectionText !== '' && <span>{selectionText}</span>}
       {drive !== null && <Divider />}
```

`src/renderer/src/lib/icons.ts`:

```diff
--- a/src/renderer/src/lib/icons.ts
+++ b/src/renderer/src/lib/icons.ts
@@ -14,9 +14,11 @@ import {
   Delete24Regular,
   Dismiss16Regular,
   Document16Regular,
+  DocumentArrowRight24Regular,
   DocumentBulletList24Regular,
   DocumentMultiple16Regular,
   DocumentMultiple24Regular,
+  DocumentTableArrowRight24Regular,
   DocumentText20Color,
   ErrorCircle16Color,
   type FluentIcon,
@@ -96,6 +98,8 @@ export const IconDelete = Delete24Regular
 export const IconNewFolder = folderTint(FolderAdd24Filled)
 export const IconAbout = Info24Regular
 export const IconExit = SignOut24Regular
+export const IconExportCsv = DocumentArrowRight24Regular
+export const IconExportExcel = DocumentTableArrowRight24Regular
 export const IconHelp = QuestionCircle24Regular
 export const IconReportProblem = Bug24Regular
 export const IconCheckUpdates = ArrowCircleDown24Regular
```

`src/renderer/src/stores/workspace-store.ts`:

```diff
--- a/src/renderer/src/stores/workspace-store.ts
+++ b/src/renderer/src/stores/workspace-store.ts
@@ -3,6 +3,7 @@ import {
   type AboutLink,
   type ChangelogEntry,
   type ContextMenuOutcome,
+  type ExportResult,
   type IconImage,
   type LaunchRequest,
   MAX_CLIPBOARD_TEXT,
@@ -12,6 +13,7 @@ import {
   type StorageIQApi,
   type UpdateState,
 } from '@shared/ipc-contract'
+import type { ExportFormat } from '@shared/scanner-protocol'
 import type {
   DriveDetails,
   DriveInfo,
@@ -38,7 +40,7 @@ import {
   type TreemapLayout,
   type TypeRow,
 } from '@shared/tree-types'
-import type { SizeUnit } from '../lib/format'
+import { formatCount, type SizeUnit } from '../lib/format'
 import { dropDescendants, type Selection, single } from '../lib/selection'
 import {
   CHUNK_SIZE,
@@ -68,8 +70,11 @@ export interface ScanTotals {
 }

 export interface Banner {
-  tone: 'error' | 'crash'
+  /** `success` is a calm confirmation (an export is done); `crash` offers Retry. */
+  tone: 'error' | 'crash' | 'success'
   message: string
+  /** Offers "Show in folder" for the file of the last export. */
+  showExport?: boolean
 }

 export const FOLDER_PICKER_ERROR = 'StorageIQ couldn’t open the folder picker. Please try again.'
@@ -84,6 +89,17 @@ export const BUSY_MESSAGE = 'Windows is still working on earlier actions. Try ag
 export const BIN_MIXED_MESSAGE = 'Select the Recycle Bin on its own to empty it.'
 export const TOO_MANY_MESSAGE = 'Too many items selected (the limit is 1,000).'
 export const CSV_TOO_LARGE_MESSAGE = 'Too many rows to copy.'
+export const EXPORTING_MESSAGE = 'Exporting…'
+/** The Excel sheet holds about a million rows; a bigger tree is cut. */
+export const EXPORT_CUT_MESSAGE =
+  'Excel’s row limit was reached, so the rest of the tree is not in the file. Export to CSV to get every row.'
+
+/** "Exported 12,345 rows to Data - StorageIQ.xlsx." (and a note when the sheet was cut). */
+export function exportedMessage(result: Extract<ExportResult, { status: 'done' }>): string {
+  const name = result.filePath.split(/[\\/]/).pop() ?? result.filePath
+  const rows = `${formatCount(result.rows)} ${result.rows === 1 ? 'row' : 'rows'}`
+  return `Exported ${rows} to ${name}.${result.truncated ? ` ${EXPORT_CUT_MESSAGE}` : ''}`
+}
 /** Rows one Explorer action takes (the same limit as main). */
 export const MAX_ACTION_ITEMS = 1000
 /** A selection larger than this is not re-checked against the scanner; it shrinks to the active row. */
@@ -170,6 +186,8 @@ export interface WorkspaceState {
   dismissedDownloadError: boolean
   /** Short polite message for screen readers (copied, created, …). */
   announcement: string
+  /** The format being exported right now (null when none); the Export commands wait for it. */
+  exporting: ExportFormat | null
   folderPickerOpen: boolean
   /** A launched `--scan` path waiting for the owner to confirm stopping the running scan. */
   pendingLaunchScan: string | null
@@ -218,6 +236,13 @@ export interface WorkspaceState {
   loadTypeIcons(typeKeys: string[]): Promise<Record<string, IconImage>>
   /** Puts a list view's CSV on the clipboard and announces "Copied N rows." */
   copyCsv(csv: string, rows: number): Promise<void>
+  /**
+   * Exports the whole tree below the treemap folder to a file of the owner's choice (main shows
+   * the save dialog). Only after a finished scan, and one export at a time. Ends with a banner.
+   */
+  exportTree(format: ExportFormat): Promise<void>
+  /** Shows the file of the last export in File Explorer. */
+  showExport(): Promise<void>
   setTreemapDepth(depth: number): void
   setTreemapVisible(visible: boolean): void
   /** Shows another view in the bottom pane (and the pane itself when it was hidden). */
@@ -493,6 +518,7 @@ export function createWorkspaceStore(api: StorageIQApi): WorkspaceStore {
       whatsNew: null,
       dismissedDownloadError: false,
       announcement: '',
+      exporting: null,
       folderPickerOpen: false,
       pendingLaunchScan: null,

@@ -858,6 +884,39 @@ export function createWorkspaceStore(api: StorageIQApi): WorkspaceStore {
         }
       },

+      async exportTree(format) {
+        const { scanId, treemapRootId, phase, exporting } = get()
+        if (scanId === null || treemapRootId === null || phase !== 'done' || exporting !== null) {
+          return
+        }
+        set({ exporting: format, announcement: EXPORTING_MESSAGE })
+        try {
+          const result = await api.exportTree(scanId, treemapRootId, format)
+          if (result.status === 'done') {
+            const message = exportedMessage(result)
+            set({ banner: { tone: 'success', message, showExport: true }, announcement: message })
+          } else if (result.status === 'failed') {
+            set({
+              banner: { tone: 'error', message: `Couldn’t export the tree. ${result.message}` },
+              announcement: '',
+            })
+          } else set({ announcement: '' })
+        } catch (error) {
+          fail(error)
+          set({ announcement: '' })
+        } finally {
+          set({ exporting: null })
+        }
+      },
+
+      async showExport() {
+        try {
+          await api.showExport()
+        } catch (error) {
+          fail(error)
+        }
+      },
+
       setTreemapDepth(depth) {
         set({ treemapDepth: Math.max(0, Math.min(MAX_TREEMAP_DEPTH, Math.round(depth))) })
       },
```

- [ ] **Step 4: Run the tests and the gates**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/renderer"`
Expected: PASS.

Then: `powershell.exe -NoProfile -Command "npm run typecheck; npm run lint; npm run format:check"` (clean).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Banner.test.tsx src/renderer/src/components/Banner.tsx src/renderer/src/components/Ribbon.test.tsx src/renderer/src/components/Ribbon.tsx src/renderer/src/components/StatusBar.test.tsx src/renderer/src/components/StatusBar.tsx src/renderer/src/lib/icons.ts src/renderer/src/stores/workspace-store-export.test.ts src/renderer/src/stores/workspace-store.ts
git commit -m "feat(export): File tab Export group, status and a banner with Show in folder"
```

---

### Task 8: The donut, the bars and the Chart toggle

**Implementer tier:** Sonnet (SVG components and the two views).

**Files:**

- Create: `src/renderer/src/components/AgeChart.tsx`
- Modify: `src/renderer/src/components/AgeView.tsx`
- Create: `src/renderer/src/components/ChartParts.tsx`
- Create: `src/renderer/src/components/Charts.test.tsx`
- Create: `src/renderer/src/components/TypesChart.tsx`
- Modify: `src/renderer/src/components/TypesView.tsx`
- Modify: `src/renderer/src/stores/workspace-store-side-views.test.ts`
- Modify: `src/renderer/src/stores/workspace-store.ts`

**Interfaces:**

- Consumes: `pieSlices`, `donutPath`, `barLengths`, `categoryTotals`, `chartSummary` (Task 3), `CategorySwatch` (`TreemapLegend.tsx`), `formatSize`, `formatShare`.
- Produces (`workspace-store.ts`): `chartVisible: boolean` (default `true`) and `toggleChart(): void`.
- Produces (components): `ChartToggle()` (a `Chart` button with `aria-pressed`), `ChartLayout({ chart, children })` (the 420 px panel left of the table, above it below 720 px of pane width, absent when the chart is hidden), `TypesChart({ rows })`, `AgeChart({ rows })`. Both charts are `role="img"` with `aria-label` `Space by file type: Video 67 %, …` / `Space by file age: Last 30 days 67 %, …`.

- [ ] **Step 1: Write the failing tests**

`src/renderer/src/components/Charts.test.tsx` (new):

```tsx
// @vitest-environment jsdom
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { formatShare, formatSize } from '../lib/format'
import { createFakeApi, TEST_AGE, TEST_TYPES } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { AgeChart } from './AgeChart'
import { ChartLayout, ChartToggle } from './ChartParts'
import { TypesChart } from './TypesChart'
import { AgeView } from './AgeView'
import { TypesView } from './TypesView'

describe('<TypesChart />', () => {
  it('is named by the three biggest file types and draws one slice per type', () => {
    renderWithStores(<TypesChart rows={TEST_TYPES} />)
    const chart = screen.getByRole('img')
    expect(chart).toHaveAccessibleName('Space by file type: Video 67 %, Images 25 %, Other 8 %')
    const slices = chart.querySelectorAll('path')
    expect(slices).toHaveLength(3)
    expect(slices[0]?.getAttribute('style')).toContain('var(--treemap-video)')
    expect(slices[1]?.getAttribute('style')).toContain('var(--treemap-image)')
    expect(slices[2]?.getAttribute('style')).toContain('var(--treemap-other)')
  })

  it('shows the total in the middle and a legend with each type, its size and its share', () => {
    renderWithStores(<TypesChart rows={TEST_TYPES} />)
    const total = TEST_TYPES.reduce((sum, row) => sum + row.size, 0)
    expect(screen.getByRole('img').querySelector('text:last-of-type')).toHaveTextContent(
      formatSize(total, 'auto'),
    )
    const items = within(screen.getByRole('list', { name: 'File types by size' })).getAllByRole(
      'listitem',
    )
    expect(items.map((item) => item.textContent)).toEqual([
      `Video${formatSize(2 * 1024 ** 3, 'auto')}${formatShare(2048 / 3072)}`,
      `Images${formatSize(768 * 1024 ** 2, 'auto')}${formatShare(0.25)}`,
      `Other${formatSize(256 * 1024 ** 2, 'auto')}${formatShare(256 / 3072)}`,
    ])
  })

  it('adds up the extensions of one type, and counts "Other extensions" as Other', () => {
    renderWithStores(
      <TypesChart
        rows={[
          { kind: 'extension', ext: 'mp4', category: 'video', size: 30, allocated: 30, files: 1 },
          { kind: 'extension', ext: 'mkv', category: 'video', size: 30, allocated: 30, files: 1 },
          { kind: 'other', ext: '', category: null, size: 40, allocated: 40, files: 2 },
        ]}
      />,
    )
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Space by file type: Video 60 %, Other 40 %',
    )
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('draws nothing for a folder with no bytes', () => {
    const { container } = renderWithStores(<TypesChart rows={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('<AgeChart />', () => {
  it('draws a bar for each bucket that holds bytes, longest for the biggest', () => {
    renderWithStores(<AgeChart rows={TEST_AGE} />)
    const chart = screen.getByRole('img')
    expect(chart).toHaveAccessibleName(
      'Space by file age: Last 30 days 67 %, 2–5 years 25 %, Unknown date 8 %',
    )
    const bars = [...chart.querySelectorAll('rect')]
    expect(bars).toHaveLength(3)
    const widths = bars.map((bar) => Number(bar.getAttribute('width')))
    expect(widths[0]).toBe(200)
    expect(widths[1]).toBeCloseTo(75)
    expect(widths[2]).toBeCloseTo(25)
  })

  it('labels every bucket, empty ones too, and draws "Unknown date" in the muted colour', () => {
    renderWithStores(<AgeChart rows={TEST_AGE} />)
    const labels = [...screen.getByRole('img').querySelectorAll('text')].map((t) => t.textContent)
    expect(labels).toContain('Last 30 days')
    expect(labels).toContain('1–3 months')
    expect(labels).toContain('Unknown date')
    expect(labels).toContain(formatSize(0, 'auto'))
    const bars = [...screen.getByRole('img').querySelectorAll('rect')]
    expect(bars[0]).toHaveClass('fill-bar-fill')
    expect(bars[2]).toHaveClass('fill-ink-subtle')
  })

  it('gives a very small bucket a bar that can be seen', () => {
    const [first] = TEST_AGE
    renderWithStores(
      <AgeChart
        rows={[
          { ...first!, size: 1_000_000_000_000 },
          { ...first!, id: 'months-1-3', label: '1–3 months', size: 1 },
        ]}
      />,
    )
    const bars = [...screen.getByRole('img').querySelectorAll('rect')]
    expect(Number(bars[1]?.getAttribute('width'))).toBe(2)
  })
})

describe('the Chart toggle', () => {
  it('shows and hides the chart panel, and is pressed while it is shown', async () => {
    const user = userEvent.setup()
    renderWithStores(
      <>
        <ChartToggle />
        <ChartLayout chart={<p>the chart</p>}>
          <p>the table</p>
        </ChartLayout>
      </>,
    )
    const toggle = screen.getByRole('button', { name: 'Chart' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('the chart')).toBeInTheDocument()
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText('the chart')).not.toBeInTheDocument()
    expect(screen.getByText('the table')).toBeInTheDocument()
  })
})

describe('the charts in the views', () => {
  it('Types shows its chart left of the table, and the toggle hides it', async () => {
    const user = userEvent.setup()
    const utils = renderWithStores(<TypesView height={260} />, createFakeApi())
    await act(() => utils.workspace.getState().startScan('D:\\'))
    expect(await screen.findByRole('img', { name: /^Space by file type/ })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'File types in this folder' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Chart' }))
    expect(screen.queryByRole('img', { name: /^Space by file type/ })).not.toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'File types in this folder' })).toBeInTheDocument()
  })

  it('Age shows its chart, and the choice is shared with Types', async () => {
    const user = userEvent.setup()
    const utils = renderWithStores(<AgeView height={260} />, createFakeApi())
    await act(() => utils.workspace.getState().startScan('D:\\'))
    expect(await screen.findByRole('img', { name: /^Space by file age/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Chart' }))
    expect(utils.workspace.getState().chartVisible).toBe(false)
    expect(screen.queryByRole('img', { name: /^Space by file age/ })).not.toBeInTheDocument()
  })
})
```

`src/renderer/src/stores/workspace-store-side-views.test.ts`:

```diff
--- a/src/renderer/src/stores/workspace-store-side-views.test.ts
+++ b/src/renderer/src/stores/workspace-store-side-views.test.ts
@@ -35,6 +35,17 @@ describe('the bottom pane tabs', () => {
   })
 })

+describe('the chart toggle', () => {
+  it('starts shown and toggles for the Types and Age views together', () => {
+    const store = createWorkspaceStore(createFakeApi())
+    expect(store.getState().chartVisible).toBe(true)
+    store.getState().toggleChart()
+    expect(store.getState().chartVisible).toBe(false)
+    store.getState().toggleChart()
+    expect(store.getState().chartVisible).toBe(true)
+  })
+})
+
 describe('fetching the side views', () => {
   it('asks for the treemap folder of the current scan, with the Mode for Top files', async () => {
     const { api, store } = await scanning()
```

- [ ] **Step 2: Run them and watch them fail**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/renderer"`
Expected: FAIL: `./TypesChart`, `./AgeChart` and `./ChartParts` do not exist; the store has no `chartVisible`.

- [ ] **Step 3: Implement**

`src/renderer/src/components/AgeChart.tsx` (new):

```tsx
import type { AgeRow } from '@shared/tree-types'
import { barLengths } from '../lib/chart-geometry'
import { formatSize } from '../lib/format'
import { chartSummary } from '../lib/side-view-model'
import { useWorkspace } from '../stores/workspace-store-context'

const WIDTH = 396
const ROW_HEIGHT = 22
const LABEL_WIDTH = 88
const BAR_MAX = 200
const BAR_HEIGHT = 12

/**
 * Horizontal bars of the space in each age bucket, in the buckets' fixed order: the bucket on the
 * left, its size on the right, the bar as long as its share of the biggest bucket. "Unknown date"
 * is drawn in the muted colour. The picture is named by its three biggest buckets.
 */
export function AgeChart({ rows }: { rows: readonly AgeRow[] }) {
  const unit = useWorkspace((s) => s.unit)
  const lengths = barLengths(rows.map((row) => row.size))
  const summary = chartSummary(rows.map((row) => ({ label: row.label, value: row.size })))
  return (
    <svg
      role="img"
      aria-label={`Space by file age: ${summary}`}
      viewBox={`0 0 ${WIDTH} ${rows.length * ROW_HEIGHT}`}
      className="w-full max-w-[396px]"
    >
      {rows.map((row, i) => {
        const y = i * ROW_HEIGHT
        const length = lengths[i] ?? 0
        // A bucket with bytes always shows a bar, however small.
        const barWidth = row.size > 0 ? Math.max(2, length * BAR_MAX) : 0
        return (
          <g key={row.id}>
            <text x={0} y={y + 15} className="fill-ink text-xs">
              {row.label}
            </text>
            {barWidth > 0 && (
              <rect
                x={LABEL_WIDTH + 4}
                y={y + (ROW_HEIGHT - BAR_HEIGHT) / 2}
                width={barWidth}
                height={BAR_HEIGHT}
                rx={2}
                strokeWidth={1}
                className={`${row.id === 'unknown' ? 'fill-ink-subtle' : 'fill-bar-fill'} stroke-none forced-colors:stroke-[CanvasText]`}
              />
            )}
            <text x={WIDTH} y={y + 15} textAnchor="end" className="fill-ink-muted text-xs">
              {formatSize(row.size, unit)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
```

`src/renderer/src/components/AgeView.tsx`:

```diff
--- a/src/renderer/src/components/AgeView.tsx
+++ b/src/renderer/src/components/AgeView.tsx
@@ -4,6 +4,8 @@ import { totalSize } from '../lib/side-view-model'
 import { useSideView } from '../lib/use-side-view'
 import { GONE_MESSAGE } from '../stores/workspace-store'
 import { useWorkspace } from '../stores/workspace-store-context'
+import { AgeChart } from './AgeChart'
+import { ChartLayout, ChartToggle } from './ChartParts'
 import { CopyCsvButton } from './CopyCsvButton'
 import { PaneShell } from './PaneShell'
 import {
@@ -40,32 +42,37 @@ export function AgeView({ height }: { height: number }) {
       height={height}
       label="Age"
       actions={
-        <CopyCsvButton build={() => ageCsv(rows ?? [])} rows={rows === null ? 0 : rows.length} />
+        <>
+          <ChartToggle />
+          <CopyCsvButton build={() => ageCsv(rows ?? [])} rows={rows === null ? 0 : rows.length} />
+        </>
       }
     >
       <ScanningNote />
       {state.status === 'gone' && <PaneMessage>{GONE_MESSAGE}</PaneMessage>}
       {state.status === 'error' && <SideViewError onRetry={state.retry} />}
       {rows !== null && (
-        <SideViewTable label="File age in this folder" columns={COLUMNS}>
-          {rows.map((row) => (
-            <tr key={row.id} className="hover:bg-row-hover">
-              <th scope="row" className={`${SIDE_ROW_CLASS} px-3 text-left font-normal`}>
-                {row.label}
-              </th>
-              <td className="px-3 text-right" title={`${formatCount(row.size)} bytes`}>
-                {formatSize(row.size, unit)}
-              </td>
-              <td className="px-3 text-right" title={`${formatCount(row.allocated)} bytes`}>
-                {formatSize(row.allocated, unit)}
-              </td>
-              <td className="px-3 text-right">{formatCount(row.files)}</td>
-              <td className="px-3">
-                <ShareBar share={percentOf(row.size, total)} />
-              </td>
-            </tr>
-          ))}
-        </SideViewTable>
+        <ChartLayout chart={<AgeChart rows={rows} />}>
+          <SideViewTable label="File age in this folder" columns={COLUMNS}>
+            {rows.map((row) => (
+              <tr key={row.id} className="hover:bg-row-hover">
+                <th scope="row" className={`${SIDE_ROW_CLASS} px-3 text-left font-normal`}>
+                  {row.label}
+                </th>
+                <td className="px-3 text-right" title={`${formatCount(row.size)} bytes`}>
+                  {formatSize(row.size, unit)}
+                </td>
+                <td className="px-3 text-right" title={`${formatCount(row.allocated)} bytes`}>
+                  {formatSize(row.allocated, unit)}
+                </td>
+                <td className="px-3 text-right">{formatCount(row.files)}</td>
+                <td className="px-3">
+                  <ShareBar share={percentOf(row.size, total)} />
+                </td>
+              </tr>
+            ))}
+          </SideViewTable>
+        </ChartLayout>
       )}
     </PaneShell>
   )
```

`src/renderer/src/components/ChartParts.tsx` (new):

```tsx
import type { ReactNode } from 'react'
import { useWorkspace } from '../stores/workspace-store-context'
import { BUTTON_VARIANT_CLASSES } from './Button'

/** The "Chart" button in the header of the Types and Age views: shows or hides their chart. */
export function ChartToggle() {
  const chartVisible = useWorkspace((s) => s.chartVisible)
  const toggleChart = useWorkspace((s) => s.toggleChart)
  return (
    <button
      type="button"
      aria-pressed={chartVisible}
      title={chartVisible ? 'Hide the chart' : 'Show the chart'}
      onClick={toggleChart}
      className={`h-6 rounded-control px-2 text-[13px] leading-[18px] font-medium transition-colors duration-[120ms] aria-pressed:bg-accent-subtle aria-pressed:text-accent ${BUTTON_VARIANT_CLASSES.quiet}`}
    >
      Chart
    </button>
  )
}

/**
 * A chart panel left of the table (below 720 px of pane width, above it). The panel is as wide as
 * a donut with its legend needs: 420 px. Hidden with the Chart toggle.
 */
export function ChartLayout({ chart, children }: { chart: ReactNode; children: ReactNode }) {
  const chartVisible = useWorkspace((s) => s.chartVisible)
  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-auto @[720px]:flex-row @[720px]:overflow-hidden">
        {chartVisible && (
          <div className="shrink-0 border-b border-line p-3 @[720px]:w-[420px] @[720px]:overflow-auto @[720px]:border-r @[720px]:border-b-0">
            {chart}
          </div>
        )}
        <div className="flex min-h-40 min-w-0 flex-1 flex-col @[720px]:min-h-0">{children}</div>
      </div>
    </div>
  )
}
```

`src/renderer/src/components/TypesChart.tsx` (new):

```tsx
import { CATEGORY_LABELS } from '@shared/file-category'
import type { TypeRow } from '@shared/tree-types'
import { donutPath, pieSlices } from '../lib/chart-geometry'
import { formatShare, formatSize } from '../lib/format'
import { categoryTotals, chartSummary } from '../lib/side-view-model'
import { useWorkspace } from '../stores/workspace-store-context'
import { CategorySwatch } from './TreemapLegend'

const SIZE = 160
const CENTER = SIZE / 2
const OUTER = 76
const INNER = 48

/**
 * A donut of the folder's space by file type, in the treemap's colours: largest first, clockwise
 * from 12 o'clock, the total in the middle and a legend beside it. The picture is named by its
 * three biggest types; the table next to it holds all the data.
 */
export function TypesChart({ rows }: { rows: readonly TypeRow[] }) {
  const unit = useWorkspace((s) => s.unit)
  const totals = categoryTotals(rows)
  const total = totals.reduce((sum, entry) => sum + entry.bytes, 0)
  if (total === 0) return null
  const slices = pieSlices(totals.map((entry) => entry.bytes))
  const summary = chartSummary(
    totals.map((entry) => ({ label: CATEGORY_LABELS[entry.category], value: entry.bytes })),
  )
  return (
    <div className="flex items-center gap-3">
      <svg
        role="img"
        aria-label={`Space by file type: ${summary}`}
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="shrink-0"
      >
        {slices.map((slice) => {
          const entry = totals[slice.index]
          if (entry === undefined) return null
          return (
            <path
              key={entry.category}
              d={donutPath(CENTER, CENTER, OUTER, INNER, slice.startDeg, slice.endDeg)}
              style={{ fill: `var(--treemap-${entry.category})` }}
              strokeWidth={1}
              className="stroke-panel forced-colors:stroke-[CanvasText]"
            />
          )
        })}
        <text x={CENTER} y={CENTER - 4} textAnchor="middle" className="fill-ink-muted text-xs">
          Total
        </text>
        <text
          x={CENTER}
          y={CENTER + 14}
          textAnchor="middle"
          className="fill-ink text-[15px] font-semibold"
        >
          {formatSize(total, unit)}
        </text>
      </svg>
      <ul aria-label="File types by size" className="min-w-0 flex-1 text-xs leading-5 tabular-nums">
        {totals.map((entry) => (
          <li key={entry.category} className="flex items-center gap-1.5">
            <CategorySwatch category={entry.category} />
            <span className="min-w-0 flex-1 truncate text-ink">
              {CATEGORY_LABELS[entry.category]}
            </span>
            <span className="text-ink-muted">{formatSize(entry.bytes, unit)}</span>
            <span className="w-11 text-right text-ink-muted">
              {formatShare(entry.bytes / total)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

`src/renderer/src/components/TypesView.tsx`:

```diff
--- a/src/renderer/src/components/TypesView.tsx
+++ b/src/renderer/src/components/TypesView.tsx
@@ -13,6 +13,7 @@ import {
 import { useSideView } from '../lib/use-side-view'
 import { GONE_MESSAGE } from '../stores/workspace-store'
 import { useWorkspace } from '../stores/workspace-store-context'
+import { ChartLayout, ChartToggle } from './ChartParts'
 import { CopyCsvButton } from './CopyCsvButton'
 import { LARGE_ICON_MIN_DPR } from './FileIcon'
 import { PaneShell } from './PaneShell'
@@ -25,6 +26,7 @@ import {
   SideViewTable,
 } from './SideViewParts'
 import { CategorySwatch } from './TreemapLegend'
+import { TypesChart } from './TypesChart'

 export const NO_TYPES_TEXT = 'There are no files in this folder.'

@@ -93,7 +95,13 @@ export function TypesView({ height }: { height: number }) {
       height={height}
       label="Types"
       actions={
-        <CopyCsvButton build={() => typesCsv(rows ?? [])} rows={rows === null ? 0 : rows.length} />
+        <>
+          <ChartToggle />
+          <CopyCsvButton
+            build={() => typesCsv(rows ?? [])}
+            rows={rows === null ? 0 : rows.length}
+          />
+        </>
       }
     >
       <ScanningNote />
@@ -101,37 +109,39 @@ export function TypesView({ height }: { height: number }) {
       {state.status === 'error' && <SideViewError onRetry={state.retry} />}
       {rows !== null && rows.length === 0 && <PaneMessage>{NO_TYPES_TEXT}</PaneMessage>}
       {rows !== null && rows.length > 0 && (
-        <SideViewTable label="File types in this folder" columns={COLUMNS}>
-          {rows.map((row) => {
-            const key = typeIconKey(row)
-            return (
-              <tr key={`${row.kind}:${row.ext}`} className="hover:bg-row-hover">
-                <td className={`${SIDE_ROW_CLASS} px-3`}>
-                  <span className="flex min-w-0 items-center gap-2">
-                    <TypeIcon image={key === null ? undefined : icons[key]} />
-                    <span className="truncate">{typeLabel(row)}</span>
-                  </span>
-                </td>
-                <td className="px-3">
-                  <span className="flex items-center gap-1.5">
-                    {row.category !== null && <CategorySwatch category={row.category} />}
-                    {typeCategoryLabel(row)}
-                  </span>
-                </td>
-                <td className="px-3 text-right" title={`${formatCount(row.size)} bytes`}>
-                  {formatSize(row.size, unit)}
-                </td>
-                <td className="px-3 text-right" title={`${formatCount(row.allocated)} bytes`}>
-                  {formatSize(row.allocated, unit)}
-                </td>
-                <td className="px-3 text-right">{formatCount(row.files)}</td>
-                <td className="px-3">
-                  <ShareBar share={percentOf(row.size, total)} />
-                </td>
-              </tr>
-            )
-          })}
-        </SideViewTable>
+        <ChartLayout chart={<TypesChart rows={rows} />}>
+          <SideViewTable label="File types in this folder" columns={COLUMNS}>
+            {rows.map((row) => {
+              const key = typeIconKey(row)
+              return (
+                <tr key={`${row.kind}:${row.ext}`} className="hover:bg-row-hover">
+                  <td className={`${SIDE_ROW_CLASS} px-3`}>
+                    <span className="flex min-w-0 items-center gap-2">
+                      <TypeIcon image={key === null ? undefined : icons[key]} />
+                      <span className="truncate">{typeLabel(row)}</span>
+                    </span>
+                  </td>
+                  <td className="px-3">
+                    <span className="flex items-center gap-1.5">
+                      {row.category !== null && <CategorySwatch category={row.category} />}
+                      {typeCategoryLabel(row)}
+                    </span>
+                  </td>
+                  <td className="px-3 text-right" title={`${formatCount(row.size)} bytes`}>
+                    {formatSize(row.size, unit)}
+                  </td>
+                  <td className="px-3 text-right" title={`${formatCount(row.allocated)} bytes`}>
+                    {formatSize(row.allocated, unit)}
+                  </td>
+                  <td className="px-3 text-right">{formatCount(row.files)}</td>
+                  <td className="px-3">
+                    <ShareBar share={percentOf(row.size, total)} />
+                  </td>
+                </tr>
+              )
+            })}
+          </SideViewTable>
+        </ChartLayout>
       )}
     </PaneShell>
   )
```

`src/renderer/src/stores/workspace-store.ts`:

```diff
--- a/src/renderer/src/stores/workspace-store.ts
+++ b/src/renderer/src/stores/workspace-store.ts
@@ -172,6 +172,8 @@ export interface WorkspaceState {
   treemapVisible: boolean
   /** The view the bottom pane shows. */
   paneTab: PaneTab
+  /** Whether the Types and Age views show their chart (in memory, like `paneTab`). */
+  chartVisible: boolean
   treemapDepth: number
   /** The folder the treemap shows. */
   treemapRootId: NodeId | null
@@ -249,6 +251,8 @@ export interface WorkspaceState {
   setPaneTab(tab: PaneTab): void
   /** The ribbon's Pane buttons: show that view, or hide the pane when it already shows it. */
   togglePane(tab: PaneTab): void
+  /** The "Chart" button of the Types and Age views. */
+  toggleChart(): void
   dismissBanner(): void
   /** A validated `--scan` request from main: scans now, or asks first while a scan runs. */
   receiveLaunchRequest(request: LaunchRequest): void
@@ -510,6 +514,7 @@ export function createWorkspaceStore(api: StorageIQApi): WorkspaceStore {
       revision: 0,
       treemapVisible: true,
       paneTab: 'treemap',
+      chartVisible: true,
       treemapDepth: DEFAULT_TREEMAP_DEPTH,
       treemapRootId: null,
       banner: null,
@@ -935,6 +940,10 @@ export function createWorkspaceStore(api: StorageIQApi): WorkspaceStore {
         else set({ paneTab: tab, treemapVisible: true })
       },

+      toggleChart() {
+        set({ chartVisible: !get().chartVisible })
+      },
+
       dismissBanner() {
         set({ banner: null })
       },
```

- [ ] **Step 4: Run the tests and the gates**

Run: `powershell.exe -NoProfile -Command "npx vitest run src/renderer"`
Expected: PASS.

Then: `powershell.exe -NoProfile -Command "npm run typecheck; npm run lint; npm run format:check"` (clean).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/AgeChart.tsx src/renderer/src/components/AgeView.tsx src/renderer/src/components/ChartParts.tsx src/renderer/src/components/Charts.test.tsx src/renderer/src/components/TypesChart.tsx src/renderer/src/components/TypesView.tsx src/renderer/src/stores/workspace-store-side-views.test.ts src/renderer/src/stores/workspace-store.ts
git commit -m "feat(charts): donut of space by type and bars of space by age, with a Chart toggle"
```

---

### Task 9: End-to-end tests and docs

**Implementer tier:** Sonnet (E2E and docs).

**Files:**

- Create: `e2e/export.spec.ts`
- Modify: `e2e/support/workspace.ts`
- Create: `e2e/support/zip.ts`
- Modify: `CHANGELOG.md`
- Modify: `docs/ROADMAP.md`

**Interfaces:**

- Consumes: everything above. The save dialog is replaced in the main process (`stubSaveDialog`), as `stubFolderDialog` does for the folder picker: **the owner never sees a dialog**.
- Produces: `stubSaveDialog(app, file | null)` (`e2e/support/workspace.ts`), `zipFiles(zip: Buffer): Map<string, string>` (`e2e/support/zip.ts`), `e2e/export.spec.ts` (6 tests), the Phase 5 checklist and a `## [Unreleased]` changelog entry written for end users.

- [ ] **Step 1: Write the failing tests**

`e2e/export.spec.ts` (new):

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import { createScanFixture, type ScanFixture } from './support/fixture'
import { consoleErrors, launchApp } from './support/launch'
import { ribbonButton, scanFolder, stubSaveDialog } from './support/workspace'
import { zipFiles } from './support/zip'

let app: ElectronApplication | undefined
let page: Page
let fixture: ScanFixture | undefined
let outDir = ''

test.beforeEach(async () => {
  const launched = await launchApp()
  app = launched.app
  page = launched.page
  outDir = mkdtempSync(path.join(os.tmpdir(), 'storageiq-e2e-export-'))
})

test.afterEach(async () => {
  await app?.close()
  app = undefined
  fixture?.remove()
  fixture = undefined
  rmSync(outDir, { recursive: true, force: true })
})

async function scanFixture(): Promise<ScanFixture> {
  fixture = createScanFixture()
  await page.getByRole('tab', { name: 'Home', exact: true }).click()
  await scanFolder(app!, page, fixture.root)
  return fixture
}

const openFileTab = () => page.getByRole('tab', { name: 'File', exact: true }).click()
const tab = (name: string) => page.getByRole('tab', { name, exact: true })
/** The calm confirmation above the tree (the status bar repeats it for screen readers). */
const doneBanner = () =>
  page
    .locator('[role="status"]')
    .filter({ has: page.getByRole('button', { name: 'Show in folder' }) })

test('Export waits for a finished scan', async () => {
  await openFileTab()
  await expect(ribbonButton(page, 'Export to CSV…')).toHaveAttribute('aria-disabled', 'true')
  await expect(ribbonButton(page, 'Export to Excel…')).toHaveAttribute('aria-disabled', 'true')
  await scanFixture()
  await openFileTab()
  await expect(ribbonButton(page, 'Export to CSV…')).not.toHaveAttribute('aria-disabled', 'true')
  await expect(ribbonButton(page, 'Export to Excel…')).not.toHaveAttribute('aria-disabled', 'true')
})

test('Export to CSV writes every folder and file, biggest first, and says so', async () => {
  const f = await scanFixture()
  const file = path.join(outDir, 'tree.csv')
  await stubSaveDialog(app!, file)
  await openFileTab()
  await ribbonButton(page, 'Export to CSV…').click()

  // 24 folders and 62 files (the junction is one 0-byte file) below the scan root.
  const rows = f.expected.folders + f.expected.files
  await expect(doneBanner()).toContainText(`Exported ${rows} rows to tree.csv.`)
  await expect(page.getByRole('button', { name: 'Show in folder' })).toBeVisible()

  const text = readFileSync(file, 'utf8')
  expect(text.startsWith('﻿Path,Name,Type,Extension,Size (bytes),Allocated (bytes),')).toBe(true)
  const lines = text.slice(1).split('\r\n')
  expect(lines).toHaveLength(1 + rows + 1)
  // folder-12 is the biggest folder: 5 files of 12,000 bytes.
  expect(lines[1]).toMatch(
    new RegExp(
      `^${f.root.replaceAll('\\', '\\\\')}\\\\folder-12,folder-12,Folder,,60000,\\d+,5,1,`,
    ),
  )
  expect(await consoleErrors(app!)).toEqual([])
})

test('Export to Excel writes a workbook of four sheets', async () => {
  const f = await scanFixture()
  const file = path.join(outDir, 'tree.xlsx')
  await stubSaveDialog(app!, file)
  await openFileTab()
  await ribbonButton(page, 'Export to Excel…').click()
  const rows = f.expected.folders + f.expected.files
  await expect(doneBanner()).toContainText(`Exported ${rows} rows to tree.xlsx.`)

  const files = zipFiles(readFileSync(file))
  const workbook = files.get('xl/workbook.xml') ?? ''
  expect([...workbook.matchAll(/<sheet name="([^"]+)"/g)].map((match) => match[1])).toEqual([
    'Tree',
    'Top files',
    'Types',
    'Age',
  ])
  for (const n of [1, 2, 3, 4]) expect(files.has(`xl/worksheets/sheet${n}.xml`)).toBe(true)
  expect(files.get('xl/worksheets/sheet1.xml')?.match(/<row /g)).toHaveLength(1 + rows)
  expect(files.get('xl/worksheets/sheet2.xml')?.match(/<row /g)).toHaveLength(1 + f.expected.files)
  expect(files.get('xl/worksheets/sheet4.xml')?.match(/<row /g)).toHaveLength(1 + 8)
  expect(await consoleErrors(app!)).toEqual([])
})

test('a cancelled save dialog writes nothing and shows no banner', async () => {
  await scanFixture()
  await stubSaveDialog(app!, null)
  await openFileTab()
  await ribbonButton(page, 'Export to CSV…').click()
  await expect(ribbonButton(page, 'Export to CSV…')).not.toHaveAttribute('aria-disabled', 'true')
  await expect(doneBanner()).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(existsSync(path.join(outDir, 'tree.csv'))).toBe(false)
})

test('a file that cannot be written shows the error and leaves Export usable', async () => {
  await scanFixture()
  await stubSaveDialog(app!, path.join(outDir, 'missing-folder', 'tree.csv'))
  await openFileTab()
  await ribbonButton(page, 'Export to CSV…').click()
  await expect(page.getByRole('alert')).toContainText('Couldn’t export the tree.')
  await expect(ribbonButton(page, 'Export to CSV…')).not.toHaveAttribute('aria-disabled', 'true')
})

test('Types and Age show a chart that the Chart button hides', async () => {
  await scanFixture()
  await tab('Types').click()
  const pie = page.getByRole('img', { name: /^Space by file type: / })
  await expect(pie).toBeVisible()
  await expect(pie).toHaveAccessibleName(/\d+ %, .* \d+ %/)
  await expect(
    page.getByRole('list', { name: 'File types by size' }).getByRole('listitem'),
  ).not.toHaveCount(0)
  await page.getByRole('button', { name: 'Chart', exact: true }).click()
  await expect(pie).toHaveCount(0)
  await expect(page.getByRole('table', { name: 'File types in this folder' })).toBeVisible()

  await tab('Age').click()
  await expect(
    page.getByRole('img', { name: /^Space by file age: Last 30 days 100 %/ }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Chart', exact: true }).click()
  await expect(
    page.getByRole('img', { name: /^Space by file age: Last 30 days 100 %/ }),
  ).toBeVisible()
  expect(await consoleErrors(app!)).toEqual([])
})
```

`e2e/support/workspace.ts`:

```diff
--- a/e2e/support/workspace.ts
+++ b/e2e/support/workspace.ts
@@ -14,6 +14,19 @@ export async function stubFolderDialog(app: ElectronApplication, folder: string)
   }, folder)
 }

+/**
+ * Makes the native save dialog return `file`, or "cancelled" when `file` is null, so no dialog is
+ * ever shown to the person at the desk.
+ */
+export async function stubSaveDialog(app: ElectronApplication, file: string | null): Promise<void> {
+  await app.evaluate(({ dialog }, chosen) => {
+    dialog.showSaveDialog = (async () =>
+      chosen === null
+        ? { canceled: true, filePath: '' }
+        : { canceled: false, filePath: chosen }) as typeof dialog.showSaveDialog
+  }, file)
+}
+
 /** A command of the ribbon's active tab (the level bar is a toolbar too, so match by name). */
 export function ribbonButton(page: Page, name: string | RegExp): Locator {
   return page.getByRole('toolbar', { name: /commands$/ }).getByRole('button', { name })
```

`e2e/support/zip.ts` (new):

```ts
import { inflateRawSync } from 'node:zlib'

/** The files of a ZIP by name, read through its central directory (what the .xlsx test needs). */
export function zipFiles(zip: Buffer): Map<string, string> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (end < 0) throw new Error('not a ZIP file')
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  const files = new Map<string, string>()
  for (let i = 0; i < count; i += 1) {
    const compressed = zip.readUInt32LE(at + 20)
    const nameLength = zip.readUInt16LE(at + 28)
    const local = zip.readUInt32LE(at + 42)
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    files.set(name, inflateRawSync(zip.subarray(start, start + compressed)).toString('utf8'))
    at += 46 + nameLength
  }
  return files
}
```

- [ ] **Step 2: Run them and watch them fail**

Run: `powershell.exe -NoProfile -Command "Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; npm run build; npx playwright test e2e/export.spec.ts"`
Expected: FAIL: `stubSaveDialog` and the Export commands are not wired (the first run also showed that `scanFolder` needs the Home tab to be active, so the spec clicks it first).

- [ ] **Step 3: Implement**

`CHANGELOG.md`:

```diff
--- a/CHANGELOG.md
+++ b/CHANGELOG.md
@@ -2,6 +2,20 @@

 All notable changes to StorageIQ are listed here, newest first. The format follows Keep a Changelog and the versions follow Semantic Versioning.

+## [Unreleased]
+
+### Added
+
+- Types now shows a donut chart of the space used by each kind of file, in the same colours as the treemap, with a legend beside it. Age shows bars for the space in each age group. A Chart button in the header hides or shows the chart; the table next to it still has every number.
+- Export to CSV… and Export to Excel… on the File tab save every folder and file below the folder shown in the pane, biggest first, with sizes in bytes, dates, and each item's share of its folder. The Excel file also has Top files, Types and Age sheets. A message tells you how many rows were saved, with a Show in folder button.
+- A CSV file has no row limit. An Excel sheet holds about a million rows; if the tree is bigger, the file says so and the rest is left out, so use CSV for those.
+
+### Fixed
+
+- Top files, Types and Age no longer say "That item no longer exists" when the list simply could not be loaded; they say so and offer Try again.
+- Top files no longer keeps a row selected after you choose another folder or scan again.
+- File names that begin with =, +, - or @ are saved with a leading ' in CSV files (Copy as CSV too), so a spreadsheet does not read them as formulas.
+
 ## [0.3.0-beta.1] - 2026-11-28

 ### Added
```

`docs/ROADMAP.md`:

```diff
--- a/docs/ROADMAP.md
+++ b/docs/ROADMAP.md
@@ -2,7 +2,7 @@

 Living document owned by the technical lead. Update it whenever a phase completes: tick tasks, record decisions, and name the next phase.

-**Current phase:** Phase 4 — Side Views
+**Current phase:** Phase 5 — Charts and Export
 **Last updated:** 2026-11-28

 ---
@@ -110,15 +110,15 @@ StorageIQ/

 Roadmap v3, approved 2026-11-19 ([spec](superpowers/specs/2026-11-19-phase-3-workspace-design.md) §2). It supersedes the phase order of roadmap v2; the Phase 2a scanner, IPC and drive code stay.

-| #   | Phase              | Status                                                                       | Exit criterion                                                                                                                                                  |
-| --- | ------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
-| 1   | Foundation         | **Done**                                                                     | Secure app shell, typed IPC, tests, installer, CI                                                                                                               |
-| 2a  | Core scanner       | **Done** (merged in PR #1)                                                   | Scans a drive in a utilityProcess with live progress, cancel and unreadable folders listed                                                                      |
-| 3   | Analyzer workspace | **In progress** — [plan](superpowers/plans/2026-11-19-phase-3-workspace.md)  | Ribbon, Select menu, virtualized column tree, file-type treemap with legend (Level 0–5, hideable), Explorer context menu, status bar; 1M-file perf limits in CI |
-| 4   | Side views         | **In progress** — [plan](superpowers/plans/2026-11-28-phase-4-side-views.md) | Top files, file types, file age                                                                                                                                 |
-| 5   | Charts and export  | Not started                                                                  | Pie and bar charts; CSV and Excel export                                                                                                                        |
-| 6   | Actions            | Not started                                                                  | Delete to Recycle Bin with confirmation, search — **MVP complete; first GitHub release**                                                                        |
-| 7+  | Post-MVP           | Not started                                                                  | Honest totals (cloud-only files, hardlinks, real size of locked system files, reconciliation), duplicates, scan history, plain-language explanations, AI        |
+| #   | Phase              | Status                                                                          | Exit criterion                                                                                                                                                  |
+| --- | ------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
+| 1   | Foundation         | **Done**                                                                        | Secure app shell, typed IPC, tests, installer, CI                                                                                                               |
+| 2a  | Core scanner       | **Done** (merged in PR #1)                                                      | Scans a drive in a utilityProcess with live progress, cancel and unreadable folders listed                                                                      |
+| 3   | Analyzer workspace | **In progress** — [plan](superpowers/plans/2026-11-19-phase-3-workspace.md)     | Ribbon, Select menu, virtualized column tree, file-type treemap with legend (Level 0–5, hideable), Explorer context menu, status bar; 1M-file perf limits in CI |
+| 4   | Side views         | **Done** — [plan](superpowers/plans/2026-11-28-phase-4-side-views.md)           | Top files, file types, file age                                                                                                                                 |
+| 5   | Charts and export  | **In progress** — [plan](superpowers/plans/2026-11-28-phase-5-charts-export.md) | Pie and bar charts; CSV and Excel export                                                                                                                        |
+| 6   | Actions            | Not started                                                                     | Delete to Recycle Bin with confirmation, search — **MVP complete; first GitHub release**                                                                        |
+| 7+  | Post-MVP           | Not started                                                                     | Honest totals (cloud-only files, hardlinks, real size of locked system files, reconciliation), duplicates, scan history, plain-language explanations, AI        |

 ### Phase 1 — Project Foundation (task checklist)

@@ -251,6 +251,22 @@ Spec: [Phase 4 — Side Views design](superpowers/specs/2026-11-28-phase-4-side-

 Decisions: see the plan's "Decisions made while planning". Not in this phase: charts (Phase 5), filtering Top files by clicking a Types or Age row, explanations of known space hogs, the future date in the Last Modified roll-up.

+### Phase 5 — Charts and Export (task checklist)
+
+Spec: [Phase 5 — Charts and Export design](superpowers/specs/2026-11-28-phase-5-charts-export-design.md). Plan: [Phase 5 plan](superpowers/plans/2026-11-28-phase-5-charts-export.md).
+
+- [x] T1 Shared CSV writer: one place for the list columns, formula-safe text (`'` prefix for `=`, `+`, `-`, `@`, tab, CR)
+- [x] T2 Phase 4 minors: "Couldn't load this view" with Try again (only `null` means gone), Top files selection cleared on folder or scan change
+- [x] T3 Chart geometry (pie slices with a 1° minimum, donut path, bar lengths), category totals, chart summaries
+- [x] T4 Streaming XLSX writer (inline strings, deflated ZIP with data descriptors, no ZIP64)
+- [x] T5 Scanner `export` query: tree rows, CSV, Excel (Tree, Top files, Types, Age); 1M-file perf cases (CSV limit 10 s, Excel 20 s)
+- [x] T6 Main channels `export:run` (save dialog) and `shell:show-export`, preload bridge
+- [x] T7 File tab Export group, "Exporting…" in the status bar, success and error banners with Show in folder
+- [x] T8 Types donut and Age bars with a Chart toggle
+- [x] T9 E2E (save dialog stubbed), docs
+
+Decisions: see the plan's "Decisions made while planning". Not in this phase: choosing export columns or depth, exporting a selection, other chart types, printing, charts inside the workbook.
+
 ### Release checklist (before first public release, not tied to a phase)

 Decided before the first public build; the MVP (Phase 6) is the first public release:
```

- [ ] **Step 4: Run the tests and the gates**

Run: `powershell.exe -NoProfile -Command "Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; npm run build; npx playwright test e2e/export.spec.ts"`
Expected: PASS. Then every gate: `powershell.exe -NoProfile -Command "npm run typecheck; npm run lint; npm run format:check; npx vitest run; npx vitest run --config vitest.perf.config.mts; Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; npm run build; npx playwright test"` — 1,404 unit tests, perf inside the limits, 54 (3 opt-in tests skipped) E2E.

Then: `powershell.exe -NoProfile -Command "npm run typecheck; npm run lint; npm run format:check"` (clean).

- [ ] **Step 5: Commit**

```bash
git add e2e/export.spec.ts e2e/support/workspace.ts e2e/support/zip.ts
git commit -m "test(e2e): export to CSV and Excel with the save dialog stubbed, and the charts"
git add CHANGELOG.md docs/ROADMAP.md
git commit -m "docs: Phase 5 checklist and changelog"
```

---

## Self-review

**Spec coverage** (each spec section and the task that implements it):

| Spec                                                                                                             | Task                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1 Outcome, no new dependency                                                                                    | All; no `package.json` change                                                                                                                         |
| §2.1 Types donut (data, look, small slices)                                                                      | 3 (`categoryTotals`, `pieSlices`, `donutPath`), 8 (`TypesChart`)                                                                                      |
| §2.2 Age bars                                                                                                    | 3 (`barLengths`), 8 (`AgeChart`)                                                                                                                      |
| §2.3 Panel, toggle, accessibility, shared geometry module                                                        | 3, 8 (`ChartLayout`, `ChartToggle`, `role="img"`, `chartSummary`, forced-colors strokes)                                                              |
| §3.1 Commands, when enabled, scope                                                                               | 7 (Ribbon), 6 (main refuses during a scan)                                                                                                            |
| §3.2 Flow: `export:run`, save dialog, cancel, scanner writes, banners, `shell:show-export`                       | 5 (scanner), 6 (main, preload), 7 (store, banner, status bar)                                                                                         |
| §3.3 Tree rows, CSV, Excel sheets, XLSX writer, formula injection                                                | 1 (CSV rule), 4 (XLSX writer), 5 (rows, CSV, workbook, truncation)                                                                                    |
| §3.4 Trust boundary                                                                                              | 5 (`parseQuery` accepts only an absolute path and a known format), 6 (`exportArgs`, no path from the renderer, `shell:show-export` without arguments) |
| §4.1 Wrong message on failure                                                                                    | 2                                                                                                                                                     |
| §4.2 Stale Top files selection                                                                                   | 2                                                                                                                                                     |
| §4.3 CSV formula injection                                                                                       | 1                                                                                                                                                     |
| §5 Unit tests (geometry, components, injection, XLSX unzip + CRC, row generator + cap, parser + handler, minors) | 1 to 8 (each task's tests)                                                                                                                            |
| §5 Perf (CSV under 10 s, Excel under 20 s)                                                                       | 5                                                                                                                                                     |
| §5 E2E (export both formats, 4 sheets, banner, chart aria-label)                                                 | 9                                                                                                                                                     |
| §6 Out of scope                                                                                                  | Nothing added                                                                                                                                         |

**Placeholder scan:** every step has the real code, test or command; no "TBD", "similar to Task N" or "add error handling".

**Type consistency:** `Cell` (`string | number | Date | null`), `ListColumns<T>` and the three column lists are defined in Task 1 and used by Tasks 4, 5. `ExportFormat`, `EXPORT_FORMATS` and `ExportSummary` (Task 5, `scanner-protocol.ts`) are used by `exportArgs` and `ExportResult` (Task 6) and the store (Task 7). `ExportResult` (Task 6) is returned by `api.exportTree` and read by `workspace-store.exportTree` (Task 7). `pieSlices`, `donutPath`, `barLengths` (Task 3) are used by `TypesChart` and `AgeChart` (Task 8); `categoryTotals` and `chartSummary` (Task 3) likewise. `useSideView` returns `SideViewState<T> & { retry(): void }` (Task 2) and the three views use `state.retry`. `chartVisible` and `toggleChart` (Task 8) are the only store additions of that task; `exporting`, `exportTree` and `showExport` (Task 7) the only ones of that task.

**Known gaps (decided, not forgotten):** the workbook was not opened in Microsoft Excel (decision 16); "Show in folder" is not clicked in E2E (decision 15); a mid-export scan restart or folder refresh is not guarded in the scanner (the export reads the tree it started with; a refresh that runs at the same moment may be partly reflected).

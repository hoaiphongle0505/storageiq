# Phase 4 — Side Views (Top files, File types, File age) — Design

Status: design. The owner asked to proceed with the recommended defaults (2026-11-28).

## 1. Outcome

The bottom pane, which today shows only the treemap, gets four tabs: **Treemap | Top files | Types | Age**.

- Every tab describes the **current treemap folder**: the folder selected in the tree, or the parent folder when a file is selected.
- The pane keeps its splitter, its Level bar (Treemap tab only) and its hide/show toggle.
- The View ribbon tab gets a "Pane" group with one toggle button per tab, so each view can be reached from the ribbon too.
- The app stays read-only. Delete, search and charts belong to later phases.

## 2. The views

### 2.1 Top files

The largest files under the folder.

- **Limit:** at most 1,000 files (`TOP_FILES_LIMIT`).
- **Ranking:** follows the Mode toggle. Size and Percent rank by logical size, Allocated ranks by allocated size, and File count falls back to logical size.
- **Columns:** Name (shell icon), Size, Allocated, Modified, Folder (the parent path, shortened in the middle).
- **Interaction:**
  - Rows use the existing selection model and keyboard rules.
  - The keys Enter, Context menu and Shift+F10, and right-click, reuse `shell:context-menu`.
  - Double-click reveals the file in the tree (it expands the ancestors and selects the file).

### 2.2 Types

Bytes per **file extension** under the folder.

- **Columns:** Extension (shell icon for the type through the existing `icons:for-types`, plus the category colour swatch from the treemap legend), Category, Size, Allocated, Files, % of folder (bar).
- **Grouping:**
  - Sorted by Size, descending.
  - At most 500 extensions. The rest are summed into one "Other extensions" row.
  - Files with no extension are grouped as "(no extension)".
  - Extensions are lower-cased.

### 2.3 Age

Bytes per modification-age bucket under the folder. The buckets are measured from the moment of the query:

| Bucket       | Rule                         |
| ------------ | ---------------------------- |
| Last 30 days | age < 30 d                   |
| 1–3 months   | 30 d ≤ age < 91 d            |
| 3–6 months   | 91 d ≤ age < 182 d           |
| 6–12 months  | 182 d ≤ age < 365 d          |
| 1–2 years    | 365 d ≤ age < 730 d          |
| 2–5 years    | 730 d ≤ age < 1826 d         |
| Over 5 years | age ≥ 1826 d                 |
| Unknown date | modified = 0, or > now + 1 d |

- **Columns:** Age, Size, Allocated, Files, % of folder (bar).
- All 8 buckets are always listed, in this order, including empty ones.
- **Future dates:** "Unknown date" also absorbs future-dated files (for example the 2081 file seen on C:). The Last Modified column fix is out of scope.

### 2.4 Copy as CSV

Each list view (Top files, Types, Age) has a **Copy as CSV** button in its tab header.

- **Contents:** the whole result the scanner returned (up to the limits above), with a header row, RFC 4180 quoting and raw byte counts. Dates are ISO 8601 (UTC).
- **Clipboard path:** the renderer cannot use the clipboard (permission denied, roadmap note 9). It builds the CSV text and sends it over a new channel, `clipboard:copy-text`.
  - Main accepts only a string of at most 4 MiB.
  - Main rejects the message if the sender is not the main window's top frame (the existing IPC sender validation).
- **Feedback:** a polite live-region message, "Copied N rows".

## 3. Architecture

The work follows the existing treemap path end to end: renderer → preload → main IPC handler → scanner query → reply.

### 3.1 Scanner (`src/worker/scanner/side-views.ts`, new)

Three pure functions over `TreeStore`. Each walks the files of the folder's subtree once.

```ts
topFiles(store, folder, rankBy: 'size' | 'allocated', limit): TopFileRow[]   // min-heap of size `limit`
typeBreakdown(store, folder, limit): TypeRow[]                               // Map<ext, acc>
ageBreakdown(store, folder, nowMs): AgeRow[]                                  // 8 fixed buckets
```

- **Subtree walk:**
  - Iterate folders depth-first with `childFolders`, and each folder's files with `filesIn`.
  - When the folder is the scan root, loop over every live file index instead (faster, same result).
- **Cache:** results are cached per `(kind, nodeId, rankBy)` and dropped when `store.version` changes, the same way the treemap caches.
- **Speed target:** under 300 ms for a 2M-file root on the CI perf fixture. The existing 1M-file perf test gets three new cases.

New `ScannerQuery` kinds: `top-files`, `types`, `age`. The results are listed in `ScannerQueryResults` and `src/shared/tree-types.ts`.

### 3.2 Main and preload

- **New IPC channels:**
  - `side:top-files` (scanId, nodeId, mode)
  - `side:types` (scanId, nodeId)
  - `side:age` (scanId, nodeId)
  - `clipboard:copy-text` (text)
- Each has an argument parser in the same style as `treemap:layout`: validate `scanId` and the `NodeId` pattern, and that mode is one of `SizeMode`.
- Rows carry a `NodeId`, so the existing `icons:for-nodes` and `shell:context-menu` work unchanged.

### 3.3 Renderer

- **Workspace store:**
  - `paneTab: 'treemap' | 'top' | 'types' | 'age'`, persisted with the other view settings.
  - Each side view fetches when its tab is visible and the folder, mode or scan version changes. This follows the treemap's existing refresh trigger.
- **New components:** `SideViewTabs.tsx` (tablist, roving focus, `aria-controls`), `TopFilesView.tsx`, `TypesView.tsx` and `AgeView.tsx`.
  - Top files is virtualized like `TreeGrid`.
  - Types and Age are short, plain tables.
- **Shared code:**
  - CSV building in `src/renderer/src/lib/csv.ts`.
  - Size and date formatting from `lib/format.ts`.
- **Accessibility:**
  - The tabs use the WAI-ARIA tabs pattern.
  - Tables are `role="grid"` with column headers.
  - Bars carry a text percentage.
  - Contrast uses the existing tokens.

## 4. Errors and states

- **No scan yet:** the tabs are disabled, as the treemap is.
- **While scanning:** the views show partial results with the existing "Scanning…" note. They refresh on the same throttle as the treemap.
- **Missing node:** a query whose node no longer exists returns `null`. The view then shows the existing calm "no longer exists" message.
- **Clipboard too large:** text over the limit is refused and shown as "Too many rows to copy". The limits keep real lists far below 4 MiB.

## 5. Testing

- **Unit (vitest):**
  - `side-views.ts`: heap ordering and ties, the extension rules (no extension, dot files, case), the bucket edges including the future and zero dates, cache invalidation.
  - The argument parsers.
  - `csv.ts` quoting.
  - Each view's rendering and keyboard handling.
- **Perf:** the 1M-file fixture runs the three queries within budget.
- **E2E:** scan the fixture, open each tab, check the expected top row, use Copy as CSV, and read the clipboard from main.

## 6. Out of scope

- Charts (Phase 5).
- Filtering Top files by type or age (clicking a Types or Age row).
- Explanations of well-known space hogs (post-MVP).
- Fixing the future date in the Last Modified roll-up.

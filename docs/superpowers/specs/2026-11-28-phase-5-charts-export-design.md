# Phase 5 — Charts and Export — Design

Status: design. The owner asked to proceed straight away, so the defaults below were chosen without asking (2026-11-28).

## 1. Outcome

- **Charts.** The Types tab gets a pie chart of space by file type. The Age tab gets a bar chart of space by age. Each chart sits left of the existing table and describes the same data.
- **Export.** The File ribbon tab gets two commands that write the current folder's whole tree to a file of the user's choice:
  - **Export to CSV…**
  - **Export to Excel…**
- **Phase 4 minors.** Three small issues left over from Phase 4 are fixed (§4).
- **No new dependency.** The charts are hand-drawn SVG. The Excel file comes from a small built-in XLSX writer that uses Node's `zlib`.

## 2. Charts

### 2.1 Types: a pie chart (donut) by file type

- **Data:** the Types rows summed per category, which are the 10 treemap categories. The "Other extensions" row also counts, under the category its scanner row reports. Categories with no bytes are left out.
- **Look:**
  - The donut is 160 px.
  - Each slice uses the category's treemap colour, which is the token the legend already uses.
  - Slices run clockwise from 12 o'clock, largest first.
  - The centre shows the folder's total size.
  - A legend to the right lists each category with its colour swatch, size and percentage.
- **Small slices:** any slice under 1 % is still drawn, at a minimum of 1°, and stays in the legend.

### 2.2 Age: a bar chart

- **Data:** the 8 age buckets, in their fixed order.
- **Look:**
  - Bars are horizontal.
  - Each bar's length is the bucket's size divided by the largest bucket's size.
  - The label on the left is the bucket name. The value on the right is the size.
  - All bars use the accent colour. "Unknown date" uses the muted colour.

### 2.3 Common to both charts

- **Layout:** the chart sits in a panel left of the table, 240 px wide. Below 720 px of pane width the chart moves above the table.
- **Toggle:** a "Chart" toggle button in the tab header shows or hides the chart. It is on by default and kept in the workspace store, like `paneTab`.
- **Accessibility:**
  - The SVG is `role="img"` with an `aria-label` that summarises the top three entries. Example: "Video 41 %, Documents 22 %, Images 12 %".
  - The table stays the full accessible data.
  - In forced-colors mode, slices and bars get a `CanvasText` stroke so they stay apart.
- **Shared code:** a pure geometry module, `src/renderer/src/lib/chart-geometry.ts` (`pieSlices`, `barLengths`), with unit tests.

## 3. Export

### 3.1 Commands

- **Where:** the File ribbon tab gets an **Export** group with **Export to CSV…** and **Export to Excel…**.
- **When they are enabled:** only when a finished scan exists (not while scanning).
- **Scope:** the current pane folder, the same folder the side views use.

### 3.2 Flow

1. The renderer calls `export:run` with `(scanId, nodeId, format)`. The renderer never sends a path.
2. Main shows `dialog.showSaveDialog`.
   - The default name is `<folder name> - StorageIQ.csv` or `.xlsx`, saved in Documents.
   - The filter matches the chosen format.
   - If the user cancels, the result is `{ status: 'cancelled' }`.
3. Main sends a scanner query `export` with `(scanId, nodeId, format, filePath)`. The scanner process writes the file itself, streaming, so millions of rows never cross IPC.
4. The reply is `{ status: 'done', rows, truncated, filePath }` or `{ status: 'failed', message }`.
   - The renderer shows a calm banner: "Exported 12,345 rows to Data - StorageIQ.xlsx", with a **Show in folder** button. That button uses a new channel, `shell:show-export`, which only accepts the path from the last export.
   - On failure the renderer shows an error banner with the OS message, for example "The file is open in another program".
5. While the export runs, the status bar shows "Exporting…" and both Export commands are disabled.

### 3.3 Contents

**Tree rows.** One row per folder and file below the folder, depth-first, children ordered by size descending. Columns:

| Column            | Value                         |
| ----------------- | ----------------------------- |
| Path              | full path                     |
| Name              | name                          |
| Type              | `Folder` or `File`            |
| Extension         | lower-case, empty for folders |
| Size (bytes)      | logical bytes                 |
| Allocated (bytes) | allocated bytes               |
| Files             | files below (1 for a file)    |
| Folders           | folders below (0 for a file)  |
| Modified (UTC)    | ISO 8601, empty when unknown  |
| % of parent       | 0–100, one decimal            |

**CSV.**

- UTF-8 with a BOM, so Excel opens it correctly.
- CRLF line endings and RFC 4180 quoting.
- There is no row limit.

**Excel (.xlsx).** The workbook has these sheets:

1. **Tree:** the tree rows above.
   - The header row is bold and frozen.
   - Numbers are stored as numbers and dates as dates.
   - There is a hard cap of 1,048,575 data rows. If the cap is hit, `truncated` is true and the banner says so.
2. **Top files:** the same rows as the Top files view (1,000).
3. **Types:** the same rows as the Types view.
4. **Age:** the same rows as the Age view.

**XLSX writer.** It lives in `src/worker/scanner/xlsx-writer.ts` and is minimal:

- Inline strings only (`t="inlineStr"`, no shared-strings table) and one bold style.
- ZIP entries are deflated with `zlib.createDeflateRaw` and written with data descriptors (bit 3), so a sheet streams without being buffered.
- No ZIP64: the writer fails clearly if any entry passes 4 GiB.

**Formula injection.** Both CSV outputs (export and Copy as CSV) prefix a `'` to a text cell that starts with `=`, `+`, `-`, `@`, a tab or a CR (OWASP rule). Numbers are never prefixed. In XLSX, cells are inline strings and never formulas, so nothing is prefixed.

### 3.4 Trust boundary

- `export:run` validates the scan id, the `NodeId` pattern and that `format` is `'csv' | 'xlsx'`.
- The file path comes only from main's save dialog.
- The scanner writes only the path main gives it.
- `shell:show-export` accepts no path argument; it opens the last successful export.

## 4. Phase 4 minors fixed here

1. **Wrong message on failure:** a failed side-view fetch now shows "Couldn't load this view." with a **Try again** button instead of the "no longer exists" message. Only a `null` result means the node is gone.
2. **Stale selection:** Top files clears its selection when the folder or the scan changes.
3. **CSV formula injection:** fixed by the rule in §3.3.

## 5. Testing

- **Unit:**
  - `chart-geometry` (angles sum to 360°, the 1° minimum, bar scaling, an empty input).
  - The chart components (aria-label text, legend).
  - The CSV injection rule.
  - The XLSX writer: unzip the output in the test with `zlib.inflateRawSync`, check the CRCs, and check the sheet XML against expected cells.
  - The export row generator (order, columns, the truncation cap via a small cap override).
  - The `export:run` parser and the handler (cancel, done, failed).
  - The three minors.
- **Perf:** exporting the 1M-file fixture to CSV in under 10 s, and to XLSX in under 20 s.
- **E2E:** scan the fixture, Export to CSV and Export to Excel with the save dialog stubbed (as `stubFolderDialog` does). Check that the CSV has the expected first rows, that the XLSX opens as a ZIP with 4 sheets, and that the banner appears. Check that the Types tab shows the chart with its aria-label.

## 6. Out of scope

- Choosing the export columns or depth.
- Exporting a selection rather than the folder.
- Chart types other than these two.
- Printing.
- Charts in the exported workbook.

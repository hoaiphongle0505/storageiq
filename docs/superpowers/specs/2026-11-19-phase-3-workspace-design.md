# Roadmap v3 and Phase 3 — Analyzer Workspace: Design

**Status:** design approved by the product owner on 2026-11-19.
**Why:** the owner tested Phase 2a and found it "just a scanner". The app must work like a full disk analyzer workspace, with the same functions and layout structure as popular disk analyzers (from the owner's reference screenshots and internal research notes).
**Supersedes:** the phase order in [roadmap v2](2026-11-18-roadmap-v2-research-driven-design.md) §2–3. The 2a scanner, IPC and drive code stay.

## 1. Trade-dress boundary (binding)

The **functions, layout structure and behaviour** follow the reference. StorageIQ's own name, icons (Lucide, MIT), colour palette, fonts and copy are used throughout. Every label is written fresh. No third-party screenshots, icons or text go into the repo. This matches the design-system rules and PRODUCT.md.

## 2. Roadmap v3

| Phase | Scope                                                                                                                                                               | Notes                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 1     | Foundation                                                                                                                                                          | Done                                   |
| 2a    | Core scanner                                                                                                                                                        | Done (merged in PR #1)                 |
| **3** | Analyzer workspace: ribbon, Select menu, column tree, treemap pane, status bar                                                                                      | This spec                              |
| 4     | Side views: Top files, File types, File age                                                                                                                         |                                        |
| 5     | Charts (pie, bar) and Export (CSV, Excel)                                                                                                                           |                                        |
| 6     | Actions: delete to Recycle Bin (with confirmation), New Folder, search                                                                                              | **MVP complete; first GitHub release** |
| 7+    | Honest totals (former 2b: cloud-only files, hardlinks, real size of locked system files, reconciliation), duplicates, scan history, plain-language explanations, AI | Post-MVP                               |

PRODUCT.md's "read-only by default" principle stays until Phase 6. Phase 6 re-opens it with a confirmation and Recycle-Bin-only design.

## 3. Phase 3 user-visible outcome

One window, top to bottom:

1. **Ribbon.** Tabs File, Home, Scan, View. The Home tab has four groups:
   - **Scan:** Select ▾ (menu), Stop, Refresh.
   - **Mode:** a toggle group of Size, Allocated, File count and Percent. It picks the value the tree bars and the treemap use.
   - **Unit:** Auto, GB, MB, KB.
   - **Folder:** Expand ▾ (levels 1–5, or all) and Open in Explorer.
   - The Scan and View tabs repeat the relevant commands; File holds Exit and About.
2. **Select menu.** Sections:
   - **Drives:** fixed and removable drives, each with its label and letter.
   - **Documents and cloud:** the user's Documents folder, plus OneDrive folders found from the `OneDrive*` environment variables.
   - **Recently scanned:** the last 5 paths, stored in userData as JSON. "(none)" when empty.
   - **Directory:** "Choose a folder…".
3. **Column tree.**
   - **Columns:** Name, Size, Allocated, Files, Folders, % of Parent, Last Modified. Clicking a header sorts by that column, and clicking again reverses the order. The default sort is the Mode value, descending.
   - **The Name cell** shows the Mode value plus the name, over a bar proportional to the share of the parent. The % of Parent cell shows a bar plus the number. Rows that take 10% or more of the parent are bold.
   - **Content:** the root row, then the child folders, plus one "[N files]" row per folder that aggregates the files sitting directly in it.
   - **Behaviour:**
     - The tree is virtualized and draws during the scan, refreshing about every 250 ms from the scanner.
     - Keyboard: ↑ ↓ moves, → expands, ← collapses, Enter opens the folder in Explorer.
     - Context menu: Open in Explorer, Copy path, Refresh this folder.
4. **Treemap pane** below the tree, resizable with a splitter.
   - It draws the selected folder's children as squarified rectangles sized by the Mode value, with labels when they fit.
   - When the drive root is selected and the Mode is Size or Allocated, a "Free space" block is shown.
   - Clicking a block selects that node in the tree. Double-clicking drills in.
   - A level bar (Level 0, 1 and 2) sets the nesting depth.
   - Drawn on `<canvas>`, with a text alternative (the tree is the accessible equivalent).
5. **Status bar:** free space of total for the drive, files found (live), excluded count (unreadable items, clickable to open their list), and bytes per cluster with the file system name.
6. **Empty state:** a single line telling the user to choose a drive or folder from Select.

Light and dark themes follow Windows. The whole app is keyboard-operable, and WCAG 2.2 AA is the floor.

## 4. Architecture changes

- **Scanner keeps file entries.** Compact columnar storage in the worker (typed arrays plus a string table):
  - per folder: parent, name, size, allocated, files, folders, last-modified;
  - per file: parent folder, name, size, allocated, last-modified.
  - Budget: no more than about 250 MB in the worker for 2M entries. A perf test enforces it.
- **Allocated size.** The worker computes it per file as `ceil(size / clusterSize) * clusterSize`; 0-byte files allocate 0.
  - The cluster size comes from koffi `GetDiskFreeSpaceW` in main and is passed to the worker at scan start, together with the file system name from `GetVolumeInformationW`.
  - This approximation is documented; the real on-disk size of compressed and sparse files is Phase 7.
- **New IPC.** Every channel validates its arguments with `parseArgs`.
  - `tree:children(scanId, nodeId, sortKey, sortDir, offset, limit)` returns a page of rows.
  - `tree:node(scanId, nodeId)` returns one node.
  - `treemap:layout(scanId, nodeId, mode, depth, width, height)` returns rectangles. The squarify algorithm runs in the worker, so the renderer only draws.
  - `shell:open-in-explorer(path)`: the path must belong to the current scan tree.
  - `clipboard:write-text(text)`: this was carry-over 9.
  - `places:list()` returns the Documents, OneDrive and recent paths.
  - `drive:info(root)` returns free, total, cluster size and file system.
- **Renderer.**
  - A `workspace-store` replaces the single-screen flow. It holds the selection, expanded set, mode, unit, sort and treemap depth.
  - New components: Ribbon, SelectMenu, TreeGrid (virtualized), TreemapCanvas, LevelBar and StatusBar.
  - The 2a pick, scanning and result screens are removed. The crash screen becomes a banner.
- **Design system** (design system):
  - `design/tokens.json`, `tokens.css`, the Tailwind mapping and `components.md` are measured from the reference for structure only: density, row height, column widths, spacing.
  - StorageIQ keeps its own palette and fonts.
  - The contrast report must have zero AA failures.

## 5. Testing and stability gates

- **Unit tests:**
  - columnar tree store;
  - allocated size;
  - children paging and sort;
  - squarify layout (area-proportional, no overlap, stable);
  - each `parseArgs`;
  - places discovery;
  - workspace store;
  - each component.
- **E2E:**
  - Select a fixture folder, then check that the tree shows exact sizes and counts per column, that sorting works, that expanding and keyboard navigation work, and that a treemap click selects the matching tree row.
  - The context menu copies the path.
  - The drive menu lists the system drive.
  - The status bar shows the cluster size.
- **Performance** (CI, reported, with a hard limit). On a generated tree of 1M files:
  - worker memory at most 300 MB;
  - first tree page after the scan within 100 ms;
  - treemap layout within 100 ms.
- **CI must be green before merge.** `impeccable detect` must report no findings at "warning" or above. Each screen is checked by eye from screenshots in light and dark mode.

## 6. Acceptance criteria

1. Every element in §3 exists and works by mouse and keyboard.
2. For the E2E fixture, every column in the tree matches the generated values exactly.
3. The tree and the status bar update while a scan runs, and Stop works within 500 ms.
4. The treemap and the tree stay in sync both ways.
5. The performance limits in §5 hold.
6. No third-party asset or copy is in the repo, and icons are Lucide.
7. All gates are green: format, lint, typecheck, unit, E2E, packaged self-test and CI.

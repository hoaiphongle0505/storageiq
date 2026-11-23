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

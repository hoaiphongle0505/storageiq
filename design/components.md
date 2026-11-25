# StorageIQ components (Phase 3 workspace, Strata look)

Structure follows the owner's reference layout (ribbon, column tree, treemap pane, level bar,
status bar); names, colours and copy are StorageIQ's own; icons are Windows' own shell icons (drawn by Windows at runtime) in the tree and Fluent UI System Icons (MIT) elsewhere. Visual values:
`docs/superpowers/specs/2026-11-23-strata-visual-design.md`. Tokens:
`design/tokens.json` → `design/tokens.css` (`npm run tokens`) → Tailwind utilities in
`src/renderer/src/styles/global.css`. Contrast: `design/contrast-report.txt` (0 AA failures).

```
Ribbon
  parts     tab strip (File, Home, Scan, View; 28 px) over one toolbar panel (92 px) of groups, each a
            raised pill (64 px) with its caption (12/16) under it
  groups    Home: Scan (Select ▾, Stop, Refresh) · Mode (Size, Allocated, File count, Percent)
            · Unit (Auto, GB, MB, KB) · Folder (Expand ▾, Open in Explorer, New folder)
            Scan: Scan · Tree (Expand ▾) · View: Mode · Unit · Treemap (toggle) · File: About, Exit
  states    tab: default (ink-muted), hover (row-hover), selected (ink, semibold, 2 px accent bar
            from an after: pseudo-element)
            command: default, hover (row-hover), pressed (aria-pressed: accent-subtle, accent
            icon and label, 1 px inset accent), open menu (aria-expanded: row-hover),
            disabled (aria-disabled: ink-subtle, no hover), focus-visible (2 px focus ring)
            unit toggles: segmented track (sunken, pill) with a raised pressed segment
  tokens    bg app / raised / sunken / accent-subtle, text ink / ink-muted / ink-subtle,
            border line, radius group / pill, shadow raised, motion fast (120 ms)
  a11y      role=tablist (focusgroup="tablist nomemory", selection follows focus) + tabpanel;
            role=toolbar (focusgroup="toolbar wrap") with role=group per group, named by its
            caption; one tab stop, arrows move, Home/End; disabled stays focusable
  files     components/Ribbon.tsx, RibbonButton.tsx

MenuButton / SelectMenu
  sections  Drives · Documents and cloud · Recently scanned ("(none)" when empty) · Directory
            ("Choose a folder…"); each a role=group named by its heading
  states    closed, open (aria-expanded), item hover/focus (row-hover), item disabled
  tokens    bg raised, border line, radius panel / control, shadow menu, ink-subtle hints,
            min item height 32 px
  a11y      Enter/Space/click toggle; ArrowDown opens and enters; keyboard open focuses the first
            item, pointer open keeps focus on the trigger; Escape closes and returns focus; Tab
            and outside click close; popover="manual" in the top layer, placed from script
  files     components/MenuButton.tsx, SelectMenu.tsx

TreeGrid (column tree)
  columns   Name (min 280 px, flexible) · Size 112 · Allocated 112 · Files 96 · Folders 96 ·
            % of Parent 112 · Last Modified 120 (the reference's order and proportions)
  rows      30 px, no row lines; indent 16 px per level; chevron, Windows shell icon (Fluent placeholder until it loads, always in a fixed 16 px box), Mode value + name
            over a bar (bg bar, 3 px radius) sized to the share of the parent; % column has a
            48 × 6 px meter (bar-track, bar-fill); bold at ≥ 10 %; "[N files]" row per folder
  states    default, hover (row-hover), selected (selection + 2 px inset accent left edge),
            sorted header (ink, semibold, accent arrow), loading line ("Loading…"),
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
  parts     header strip (title "Treemap of …", quiet × Hide treemap) · canvas · legend ·
            level bar (segmented track of six toggles)
  blocks    squarified (scanner); a file takes its type's colour (treemap-<category>); a folder
            or "[N files]" block the dominant type's colour at ≥ 50 % of its logical bytes,
            else treemap-folder; nested blocks are treemap-folder frames under an 18 px label
            strip; "Free space" is treemap-free with 45° hatch; blocks inset 1 px over a
            treemap-edge gap; cushion gradient on blocks ≥ 12 px; labels "name (value)" when
            they fit; selection = 2 px accent outline plus 1 px treemap-halo
  modes     prefers-contrast: more = no cushion, ink gaps; forced-colors = Canvas fills,
            CanvasText gaps and labels, 3 px Highlight selection, no cushion or hatch
  a11y      canvas role=img with a label; the tree is the accessible equivalent; level bar is a
            toolbar of six aria-pressed toggles (Level 0–5)
  files     components/TreemapPane.tsx, LevelBar.tsx, lib/treemap-draw.ts

Treemap legend
  content   one row (28 px) under the canvas: file types by share (swatch, label, share), then
            "Free space" with its size and "Mixed folders" when drawn
  states    overflow scrolls horizontally; empty (no layout) keeps the row, no list
  tokens    caption 12/16, text ink / ink-muted, swatch 10 × 10 px radius 3 border line-strong
            filled from var(--treemap-<category>); forced-colors hides the swatches
  a11y      <ul aria-label="File types in this folder">; swatches aria-hidden
  files     components/TreemapLegend.tsx, shared/file-category.ts

Splitter
  states    default (1 px line rule + grip, both from pseudo-elements), hover (line-strong rule),
            focus-visible and dragging (2 px accent rule and grip)
  a11y      role=separator, aria-orientation=horizontal, aria-valuenow/min/max, ↑ ↓ 16 px, Home, End

StatusBar
  content   Free space (40 × 4 px meter + text) · N files found (live) · N excluded (quiet button
            with a warning icon → dialog) · N bytes per cluster (FS) · StorageIQ version;
            items separated by 1 px divider spans
  tokens    bg panel, caption ink-muted, bar-track / bar-fill, version ink-subtle
  a11y      progress announced politely at most every 5 s; action results in role=status

Banner, Dialog, Button
  Banner    role=alert; variants info (recoverable errors), danger (scanner crash, Retry),
            warning, success (reserved): tinted strip, 3 px tone stripe, Fluent icon (colour variant where Fluent has one)
            (BANNER_ICONS), Retry primary, Dismiss quiet; BANNER_VARIANT_CLASSES is shared
  Dialog    native <dialog> via showModal(); bg raised, shadow dialog, backdrop token; Escape
            and Close; focus returns to the opener
  Button    primary (accent) / secondary (raised + border + shadow) / quiet (transparent);
            busy = aria-disabled, opacity 60 %, no hover change
```

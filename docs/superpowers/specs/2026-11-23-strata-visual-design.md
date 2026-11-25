# Strata: StorageIQ visual design (Phase 3 addendum)

Date: 2026-11-23 · Status: approved direction ("Strata – warm & calm"), values below are final for Task 8c · Branch: `phase-3-workspace`

The Phase 3 preview read as generic: a grey ribbon of loose icons, pale teal bars, a flat grey treemap and an alarming red banner. Strata keeps every structure measured in Phase 3 (row heights, column widths, pane order, level bar) and replaces the surface: warm paper-like neutrals, one deep teal accent, ribbon commands gathered in raised pill groups, and a treemap coloured by what the bytes are (file type) with soft cushion shading and a legend. Dark mode is "night ink": blue-black slate, never pure black, with warm off-white text.

This spec is the single source for Task 8c of `docs/superpowers/plans/2026-11-23-phase-3-addendum.md`. It never names another product; icons are Lucide only; fonts are the Windows system fonts (no web fonts, the app is offline).

## 1. Principles

1. **One accent, used sparingly.** Deep teal marks state: the selected tab, pressed toggles, the selected row's edge, the treemap selection, focus. Nothing decorative is teal. Category colours belong to the treemap and its legend only.
2. **Warm and calm, not grey.** Light surfaces are warm off-whites (paper); dark surfaces are cool blue-black slates (ink). Text is warm in both. No pure `#000` or pure `#fff` text.
3. **Soft but distinct data colour.** Ten file-type hues spread around the colour wheel at one lightness band per theme, so no hue shouts and every pair is told apart. Colour is never the only cue: tiles carry labels, the legend names categories with shares, and the tree is the accessible equivalent.
4. **Depth by surface, not by line.** Raised pills and menus sit on the warm app background with a faint shadow; borders are hairlines. Rows have no grid lines.
5. **Numbers are data.** Every number uses `tabular-nums`; sizes right-align; percentages keep the existing `formatShare` text.
6. **Calm about problems.** Recoverable messages use the info style (blue-grey, an `Info` icon); only a scanner crash uses the danger style, and even that is a tinted strip with an icon, not a red slab.
7. **Contrast is a gate.** Every text pair passes WCAG 2.2 AA (4.5:1) and every UI pair 3:1, in both themes; the checker runs in the task gates. The cushion shading only ever moves a tile _away_ from its label colour, so the flat tile colour is the worst case the checker measures.
8. **Respect the system.** Follow light/dark; `prefers-contrast: more` turns the cushion off and draws ink edges; `forced-colors: active` draws the treemap in system colours; `prefers-reduced-motion` keeps all transitions at 0.

## 2. Tokens

Source of truth stays `design/tokens.json` → `node scripts/build-tokens.mjs` → `design/tokens.css` → Tailwind mapping in `src/renderer/src/styles/global.css`. Components never use raw hex.

### 2.1 Colour (50 tokens per theme)

Renames from Phase 3: `text` → `ink`, `text-muted` → `ink-muted`, `border` → `line`, `border-strong` → `line-strong`. Removed: `treemap-0`, `treemap-1`, `treemap-2`, `treemap-files`, `treemap-outline`. `pressed` stays as an alias value of `accent-subtle` so existing `aria-pressed:bg-pressed` utilities keep working.

| Token                   | Light                      | Dark                  | Role                                                                       |
| ----------------------- | -------------------------- | --------------------- | -------------------------------------------------------------------------- |
| `surface-app`           | `#f5f3ef`                  | `#151a21`             | window and ribbon body background                                          |
| `surface-panel`         | `#fcfbf9`                  | `#1a2029`             | tree, treemap pane, status bar                                             |
| `surface-raised`        | `#ffffff`                  | `#212833`             | ribbon pills, menus, dialogs, secondary buttons                            |
| `surface-sunken`        | `#ece8e1`                  | `#10141a`             | segmented-control tracks, inactive wells                                   |
| `ink`                   | `#24211d`                  | `#ebe7df`             | primary text and icons                                                     |
| `ink-muted`             | `#5c564e`                  | `#aaa59c`             | secondary text, captions, header labels                                    |
| `ink-subtle`            | `#6e685f`                  | `#928e86`             | disabled labels, shortcuts, tertiary text (still AA)                       |
| `line`                  | `#e3ded5`                  | `#2b333e`             | hairlines and borders                                                      |
| `line-strong`           | `#8a8276`                  | `#6e7a87`             | control borders that must be seen (3:1), swatch outlines, splitter grip    |
| `accent`                | `#0d6b63`                  | `#5cc3b5`             | the one accent: selected tab bar, pressed labels, selection outline, links |
| `accent-hover`          | `#0a5850`                  | `#7ad1c5`             | primary button hover                                                       |
| `on-accent`             | `#ffffff`                  | `#06201c`             | text on accent                                                             |
| `accent-subtle`         | `#dcebe6`                  | `#1d3a38`             | pressed toggle background                                                  |
| `focus`                 | `#0d6b63`                  | `#5cc3b5`             | focus ring (2 px, 2 px offset)                                             |
| `selection`             | `#d5e8e2`                  | `#1f3d3a`             | selected tree row                                                          |
| `row-hover`             | `#efebe4`                  | `#1f2731`             | hover on rows, menu items, quiet buttons                                   |
| `pressed`               | `#dcebe6`                  | `#1d3a38`             | same value as accent-subtle (kept for existing utilities)                  |
| `danger`                | `#a3321f`                  | `#f0a99a`             | crash banner stripe and icon                                               |
| `on-danger`             | `#ffffff`                  | `#2a0d07`             | text on solid danger                                                       |
| `danger-subtle`         | `#f7e3dd`                  | `#3a2220`             | crash banner background                                                    |
| `warning`               | `#835400`                  | `#e6c27a`             | warning icon (excluded count)                                              |
| `on-warning`            | `#ffffff`                  | `#2a1d02`             | text on solid warning                                                      |
| `warning-subtle`        | `#f6ead0`                  | `#352c1a`             | warning banner background                                                  |
| `success`               | `#2f6b3c`                  | `#9dd0a5`             | success icon                                                               |
| `on-success`            | `#ffffff`                  | `#0c2412`             | text on solid success                                                      |
| `success-subtle`        | `#e0eedd`                  | `#1e3124`             | success banner background                                                  |
| `info`                  | `#245d84`                  | `#9cc6ea`             | info banner stripe and icon                                                |
| `on-info`               | `#ffffff`                  | `#0a1d2c`             | text on solid info                                                         |
| `info-subtle`           | `#e0eaf2`                  | `#1c2d3d`             | info banner background (recoverable errors)                                |
| `bar`                   | `#d3e7e1`                  | `#1f3a37`             | Name-cell share bar (text sits on it)                                      |
| `bar-track`             | `#e9e4dc`                  | `#262e38`             | % column meter track                                                       |
| `bar-fill`              | `#2f8076`                  | `#5cc3b5`             | % column meter fill                                                        |
| `treemap-video`         | `#eba48c`                  | `#8c4b3b`             | Video                                                                      |
| `treemap-image`         | `#e9c46c`                  | `#715820`             | Images                                                                     |
| `treemap-audio`         | `#d2a8dc`                  | `#6c4a7c`             | Audio                                                                      |
| `treemap-document`      | `#9dc3e8`                  | `#2f5879`             | Documents                                                                  |
| `treemap-archive`       | `#c3d282`                  | `#505e26`             | Archives                                                                   |
| `treemap-code`          | `#8fd0bf`                  | `#26665b`             | Code                                                                       |
| `treemap-app`           | `#b2b6ec`                  | `#474d8a`             | Apps & installers                                                          |
| `treemap-system`        | `#b9c3ca`                  | `#46525d`             | System & libraries                                                         |
| `treemap-disk-image`    | `#e8a8c0`                  | `#7d3e57`             | Disk images                                                                |
| `treemap-other`         | `#d8d2c8`                  | `#4a4640`             | Other                                                                      |
| `treemap-folder`        | `#e6e1d8`                  | `#262e39`             | folder frame (nested folder blocks, mixed folders)                         |
| `treemap-free`          | `#f2ecdf`                  | `#2c2a22`             | free space block                                                           |
| `treemap-edge`          | `#f5f3ef`                  | `#151a21`             | 2 px gaps between blocks (= surface-app)                                   |
| `treemap-free-hatch`    | `#cfc6b4`                  | `#4a4535`             | free space 45° hatch lines                                                 |
| `treemap-halo`          | `#ffffff`                  | `#10141a`             | 1 px inner ring inside the selection outline                               |
| `treemap-cushion-inner` | `rgba(255, 255, 255, 0.5)` | `rgba(0, 0, 0, 0)`    | cushion gradient centre stop                                               |
| `treemap-cushion-outer` | `rgba(255, 255, 255, 0)`   | `rgba(0, 0, 0, 0.35)` | cushion gradient outer stop                                                |
| `backdrop`              | `rgba(36, 33, 29, 0.32)`   | `rgba(5, 7, 10, 0.6)` | dialog backdrop scrim                                                      |

Notes on the colour set:

- `surface-raised` is pure white in light mode only as a _surface_; text is never white except `on-accent` and the `on-<tone>` colours on solid fills.
- `ink-subtle` passes AA on every surface it is listed against, so even disabled labels and shortcut hints stay readable (WCAG exempts disabled text; Strata does not rely on that).
- The four `<tone>` colours pass 4.5:1 as text on both `surface-panel` and their own `<tone>-subtle`, so a banner may set its title in the tone colour; the body text is `ink`.
- The treemap category colours sit in one lightness band per theme: light tiles about L\* 75–82 (labels in `ink`, 7.8–9.8:1), dark tiles about L\* 32–40 (labels in `ink`, 5.3–6.5:1). The accent selection outline passes 3:1 against every category tile in both themes (lowest: light Video 3.10:1, dark Images 3.18:1); the `treemap-halo` ring inside it guarantees separation on any tile anyway.
- `treemap-cushion-*` are gradient stops, not checked colours: light mode only lightens (white, 50 % → 0 %), dark mode only darkens (black, 0 % → 35 %). Labels are `ink` in both themes, so lightening a light tile or darkening a dark tile only raises label contrast.

### 2.2 Elevation (new `elevation` block in tokens.json, per theme)

| Token    | Light                                                                   | Dark                                                             | Use                           |
| -------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------- |
| `raised` | `0 1px 2px rgba(36, 33, 29, 0.06), 0 0 0 1px rgba(36, 33, 29, 0.02)`    | `0 1px 2px rgba(0, 0, 0, 0.35)`                                  | ribbon pills, pressed segment |
| `menu`   | `0 8px 24px rgba(36, 33, 29, 0.14), 0 2px 6px rgba(36, 33, 29, 0.08)`   | `0 8px 24px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.35)`   | popup menus                   |
| `dialog` | `0 24px 48px rgba(36, 33, 29, 0.18), 0 4px 12px rgba(36, 33, 29, 0.08)` | `0 24px 48px rgba(0, 0, 0, 0.55), 0 4px 12px rgba(0, 0, 0, 0.4)` | dialogs                       |

CSS custom properties: `--elevation-raised`, `--elevation-menu`, `--elevation-dialog` (emitted in both theme blocks). The old single `shadow.menu` entry is removed.

### 2.3 Radius, spacing, motion

| Token            | Value                                 | Use                                                                                   |
| ---------------- | ------------------------------------- | ------------------------------------------------------------------------------------- |
| `radius.control` | 6 px                                  | buttons, menu items, tree hover, inputs                                               |
| `radius.panel`   | 10 px                                 | menus, dialogs, banners' inner icon well                                              |
| `radius.group`   | 12 px                                 | ribbon pill groups                                                                    |
| `radius.pill`    | 999 px                                | segmented tracks and segments, level bar, meters (legend swatches use a literal 3 px) |
| `space`          | `[0, 2, 4, 6, 8, 12, 16, 20, 24, 32]` | 4 px grid with 2/6 px half steps                                                      |
| `motion.fast`    | `120ms`                               | hover and pressed background transitions only                                         |
| `motion.ease`    | `cubic-bezier(.2, .8, .2, 1)`         | unchanged                                                                             |

CSS: `--r-control`, `--r-panel`, `--r-group`, `--r-pill`; Tailwind `rounded-control`, `rounded-panel`, `rounded-group`, `rounded-pill`.

### 2.4 Layout changes (everything else in `layout` is unchanged)

| Token            | Phase 3 | Strata | Why                                                                             |
| ---------------- | ------- | ------ | ------------------------------------------------------------------------------- |
| `ribbon-body`    | 88      | 92     | 4 px padding + 64 px pill + 2 px gap + 16 px caption + 4 px padding, rounded up |
| `ribbon-caption` | 18      | 16     | caption is 12/16                                                                |
| `treemap-legend` | (new)   | 28     | one legend row under the canvas                                                 |
| `treemap-header` | 18      | 18     | unchanged (the scanner's label strip)                                           |

### 2.5 Typography (system fonts only)

Families (unchanged plus one): `sans` = `'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif`; `display` = `'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif`; `small` (new) = `'Segoe UI Variable Small', 'Segoe UI', system-ui, sans-serif`; `mono` = `'Cascadia Mono', Consolas, ui-monospace, monospace`.

| Step      | Size / line | Weight                           | Family  | Use                                                                   |
| --------- | ----------- | -------------------------------- | ------- | --------------------------------------------------------------------- |
| `caption` | 12 / 16     | 400                              | small   | ribbon captions, status bar, legend, column sort hint, treemap labels |
| `label`   | 13 / 18     | 400 (500 for tabs, 600 selected) | text    | ribbon tabs, tree header, menu items, level bar, pane titles          |
| `body`    | 14 / 20     | 400 (600 for rows ≥ 10 %)        | text    | tree rows, banners, dialog body                                       |
| `title`   | 15 / 20     | 600                              | text    | treemap pane title strong part                                        |
| `heading` | 18 / 24     | 600                              | display | dialog titles                                                         |

Numbers: `font-variant-numeric: tabular-nums` on the tree grid, status bar, legend shares, level bar and every size label. Treemap canvas font: `12px "Segoe UI Variable Small", "Segoe UI", system-ui, sans-serif`; nested-block header labels use weight 600 (`600 12px …`).

## 3. File-type taxonomy

Shared, pure, order-stable. The category is decided by the extension: the text after the last `.` of the name, lower-cased; a name whose only dot is its first character (`.gitignore`) or with no dot has no extension and is `other`. Only the last extension counts (`backup.tar.gz` → `gz` → Archives).

| Index | Id           | Legend label       | Extensions                                                                                                                                                                       |
| ----- | ------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | `video`      | Video              | `mp4 m4v mkv mov avi wmv webm flv f4v mpg mpeg m2ts mts ts vob 3gp ogv`                                                                                                          |
| 1     | `image`      | Images             | `jpg jpeg jfif png gif bmp tif tiff webp heic heif avif svg ico psd raw cr2 cr3 nef arw dng orf rw2 raf`                                                                         |
| 2     | `audio`      | Audio              | `mp3 wav flac aac m4a ogg oga opus wma aif aiff alac mid midi`                                                                                                                   |
| 3     | `document`   | Documents          | `pdf doc docx docm xls xlsx xlsm xlsb ppt pptx odt ods odp rtf txt md csv tsv epub mobi one msg eml pst ost`                                                                     |
| 4     | `archive`    | Archives           | `zip 7z rar tar gz tgz bz2 tbz2 xz txz zst lz lzma cab`                                                                                                                          |
| 5     | `code`       | Code               | `js mjs cjs ts tsx jsx json py pyc ipynb java class jar c h cpp cc hpp cs go rs rb php html htm css scss less sql sh ps1 psm1 bat cmd yml yaml toml xml map lock o obj pdb wasm` |
| 6     | `app`        | Apps & installers  | `exe msi msp msix msixbundle appx appxbundle apk xapk appimage com scr`                                                                                                          |
| 7     | `system`     | System & libraries | `dll sys drv ocx mui cpl efi inf cat manifest lib a so dylib node etl evtx dmp mdmp log tmp temp pf`                                                                             |
| 8     | `disk-image` | Disk images        | `iso img vhd vhdx vmdk vdi qcow2 wim esd dmg ova`                                                                                                                                |
| 9     | `other`      | Other              | everything else, and names without an extension                                                                                                                                  |

`jar` is Code (a library more often than an app); `log`, `dmp` and `tmp` are System (machine-written). Each extension appears exactly once (a test enforces it).

## 4. Treemap colouring rules

- **File block** (`kind: 'file'`): its own category colour.
- **"[N files]" block** and **folder block that is drawn as a leaf** (not nested): the _dominant_ category of the bytes it holds, when that category has **at least 50 %** of its logical size; otherwise `treemap-folder` (a "mixed" folder). Dominant is by logical size in every Mode (File count and Allocated too), so a folder's colour does not change when the Mode changes.
- **Nested folder block** (`nested: true`): `treemap-folder` frame; its header strip label is semibold `ink`; its children paint over the rest.
- **Free space**: `treemap-free` with 1 px `treemap-free-hatch` lines at 45°, 6 px apart, clipped to the block, so it reads as "not data" without colour.
- **Gaps**: every block is drawn inset by 1 px on each side over a `treemap-edge` background, giving 2 px separators between neighbours (ui-ux-pro-max treemap guidance: 2–3 px separators).
- **Cushion**: blocks at least 12 × 12 px get one radial gradient over their fill, centre at (x + 0.3 w, y + 0.25 h), inner radius 0, outer radius 0.95 × max(w, h), stops `treemap-cushion-inner` → `treemap-cushion-outer`. Smaller blocks are flat. Nested folder frames and free space get no cushion.
- **Selection**: 2 px `accent` outline inside the block's edge, plus a 1 px `treemap-halo` ring just inside that.
- **prefers-contrast: more**: no cushion; the 2 px gaps are drawn in `ink` instead of `treemap-edge`; hatch kept.
- **forced-colors: active**: every fill is `Canvas`, the gaps and labels `CanvasText`, the selection `Highlight` 3 px; no cushion, no hatch (the legend's swatches are hidden; its text stays).

## 5. Component specs

All class names below are Tailwind utilities from the mapping in §2; "token X" means the utility for X (`bg-raised`, `text-ink-muted`, …).

### 5.1 Ribbon

- **Header** (`<header>`): `bg-app`, no bottom border; a 1 px `line` hairline sits under the ribbon body instead.
- **Tab strip** (28 px): tabs are `label` 13 px, weight 500, `text-ink-muted`, `px-3`, `min-h-6`, `rounded-control`; hover `bg-row-hover text-ink`. Selected: `text-ink`, weight 600, and a 2 px × (text width + 8 px) `accent` bar 2 px above the strip's bottom edge, rounded 1 px (draw with an `after:` pseudo-element; no background change). Focus: the global ring.
- **Body** (92 px): `bg-app`, `px-2 py-1`, groups in a row with `gap-2`. No vertical dividers.
- **Group**: a column. Top: the **pill** — `bg-raised`, 1 px `line` border, `rounded-group`, `shadow-raised`, `p-0.5`, children in a row with `gap-0.5`, height 64 px. Bottom: the caption, `caption` 12/16, `text-ink-muted`, centred, 2 px below the pill.
- **Command button** (`RIBBON_BUTTON_CLASS`): `min-h-15 min-w-14`, column, `gap-1`, `rounded-[9px]` (group radius minus the pill padding minus 1), `px-2 pt-1.5 pb-1`, label `caption` `text-ink`, icon `size-5.5` (22 px) stroke 1.75 in `text-ink-muted`. Hover: `bg-row-hover`, icon `text-ink`. Pressed toggle (`aria-pressed=true`): `bg-accent-subtle`, icon and label `text-accent`, label weight 600, inset 1 px `accent` ring. Disabled (`aria-disabled`): label and icon `text-ink-subtle`, no hover change. Transition: background-color `motion.fast`.
- **Small toggles** (Unit: Auto/GB/MB/KB; `RIBBON_SMALL_CLASS`): sit in a **segmented track** inside the pill — track `bg-sunken rounded-pill p-0.5` in a 2 × 2 grid; each segment `min-h-6 min-w-11 rounded-pill px-2.5 caption text-ink-muted`; hover `text-ink`; pressed `bg-raised shadow-raised text-ink` weight 600 with inset 1 px `accent` ring; disabled `text-ink-subtle`.
- **Menu button triggers** (Select ▾, Expand ▾): the command-button look plus a 12 px `ChevronDown` in `text-ink-muted` after the label; open state (`aria-expanded=true`) uses the hover background.

### 5.2 Popup menu (MenuButton)

`bg-raised`, 1 px `line` border, `rounded-panel`, `shadow-menu`, `p-1`, `min-w-56`. Items: `min-h-8 rounded-control px-2.5 gap-2`, `label` 13 px `text-ink`, 16 px icon `text-ink-muted`; hover and focus-visible `bg-row-hover`; disabled `text-ink-subtle`, no hover. Group headings: `caption` weight 600 `text-ink-muted` `px-2.5 pt-1.5 pb-0.5`. Separators: 1 px `line`, `my-1 mx-1.5`. Shortcut hints: `caption text-ink-subtle`.

### 5.3 Buttons

| Variant     | Rest                                                      | Hover                   | Busy (`aria-disabled`) |
| ----------- | --------------------------------------------------------- | ----------------------- | ---------------------- |
| primary     | `bg-accent text-on-accent`                                | `bg-accent-hover`       | opacity 60 %, no hover |
| secondary   | `bg-raised text-ink`, 1 px `line` border, `shadow-raised` | `bg-sunken`             | opacity 60 %, no hover |
| quiet (new) | transparent, `text-ink-muted`                             | `bg-row-hover text-ink` | opacity 60 %, no hover |

All: `h-8 px-3.5 rounded-control`, `label` 13 px weight 500, focus = global ring. The banner's Dismiss and the treemap pane's × use **quiet**.

### 5.4 Column tree (TreeGrid)

- **Header row** (32 px): `bg-panel`, 1 px `line` bottom border, no vertical column dividers except a 1 px `line` 12 px tall centred divider between header cells. Labels `label` 13 px weight 500 `text-ink-muted`; hover `bg-row-hover text-ink`. Sorted column: label `text-ink` weight 600 and its arrow glyph `text-accent`.
- **Rows** (30 px): `bg-panel`, **no** row borders. Hover `bg-row-hover`. Selected: `bg-selection` plus an inset 2 px `accent` left edge (`shadow-[inset_2px_0_0_var(--accent)]`). Rows at ≥ 10 % stay weight 600. Row icons 16 px `text-ink-muted`; the expand chevron 16 px `text-ink-muted`, hover `text-ink`.
- **Name-cell share bar**: `bg-bar`, `inset-y-[5px]`, `rounded-[3px]`; text sits on it (AA pairs `ink`/`ink-muted` on `bar`).
- **% of Parent column**: a 48 × 6 px meter, track `bg-bar-track rounded-pill`, fill `bg-bar-fill rounded-pill`, then the right-aligned percentage. In forced colors the fill is `Highlight`.
- **Numbers**: all numeric cells right-aligned, tabular.
- **Empty and loading text**: `text-ink-muted`.

### 5.5 Treemap pane

- **Section**: `bg-panel`, 1 px `line` top border.
- **Header** (28 px): `px-3`, title "Treemap of …" with "Treemap of" in `text-ink-muted` and the folder name `title` 15 px weight 600 `text-ink`, truncating; × is a quiet 24 × 24 button.
- **Canvas area**: background `treemap-edge`; drawing follows §4. Labels: `ink`, 12 px Small, 4 px from the block's left, vertically centred in the header strip for nested blocks and in the block (capped at the strip centre) otherwise; minimum label block 36 × 16 px (unchanged).
- **Legend** (28 px, new, under the canvas, above the level bar): `<ul aria-label="File types in this folder">`, one row, `gap-3 px-3`, `overflow-x-auto`, no wrap, `caption` 12 px. Each item: a 10 × 10 px swatch (`rounded-[3px]`, fill = category colour, 1 px `line-strong` border so it passes 3:1 on the panel), the label in `text-ink`, the share in `text-ink-muted` tabular (`formatShare`). Items ordered by share, largest first; categories with zero bytes are left out. When the free-space block is shown, a final "Free space" item uses a hatched swatch and shows its size (`formatBytes`) instead of a share. When any drawn block is a mixed folder, a "Mixed folders" item with a `treemap-folder` swatch and no number closes the list. Shares are of the treemap folder's logical size.
- **Empty / failed text**: centred `text-ink-muted`.

### 5.6 Level bar

36 px, `bg-panel`, 1 px `line` top border, `px-2 py-1`. The six buttons sit in one **segmented track**: `bg-sunken rounded-pill p-0.5 grid grid-cols-6 gap-0.5`. Segment: `rounded-pill label 13px text-ink-muted tabular-nums`, centred text; hover `text-ink bg-row-hover`; pressed `bg-raised shadow-raised text-ink` weight 600 with inset 1 px `accent` ring. Equal widths stay (measured structure).

### 5.7 Splitter

6 px tall hit area, `bg-app`. A 1 px `line` rule through the middle (`before:` pseudo) and a centred 32 × 4 px grip `rounded-pill bg-line-strong` (`after:` pseudo). Hover: rule `line-strong`. Focus-visible and while dragging: rule 2 px `accent`, grip `accent`; no visible outline in normal colours (the rule is the indicator, 3:1 against `surface-app`), but the element keeps a transparent outline (`outline-hidden`) and, under `forced-colors: active`, a 2 px `Highlight` focus outline, because forced colours strip the pseudo-element backgrounds and the focus cue must survive. Cursor `row-resize`.

### 5.8 Status bar

26 px, `bg-panel`, 1 px `line` top border, `px-3`, `caption` 12 px `text-ink-muted`, tabular. Items separated by `gap-3` and a 1 px × 12 px `line` divider between items. The free-space item starts with a 40 × 4 px meter (track `bar-track`, fill `bar-fill` = used share, `aria-hidden`). The "N excluded" button, when > 0 and not scanning, is quiet: a 14 px `TriangleAlert` in `text-warning`, the count in `text-ink` underlined with offset 2, hover `bg-row-hover`, `min-h-6 rounded-control px-1.5`. The version sits right in `text-ink-subtle`.

### 5.9 Banner

Full-width strip between the ribbon and the tree, `px-4 py-2`, 1 px bottom border, a 3 px left stripe in the tone colour, a 16 px Lucide icon in the tone colour, message `body` 14 px `text-ink`, actions right.

| Variant | Background       | Stripe and icon | Border | Icon            | Used for                                        |
| ------- | ---------------- | --------------- | ------ | --------------- | ----------------------------------------------- |
| info    | `info-subtle`    | `info`          | `line` | `Info`          | `tone: 'error'` (an action failed; recoverable) |
| danger  | `danger-subtle`  | `danger`        | `line` | `CircleAlert`   | `tone: 'crash'` (the scanner stopped; Retry)    |
| warning | `warning-subtle` | `warning`       | `line` | `TriangleAlert` | reserved                                        |
| success | `success-subtle` | `success`       | `line` | `CircleCheck`   | reserved                                        |

Actions: Retry is primary; Dismiss is quiet. Roles are unchanged (`role="alert"`).

### 5.10 Dialog

Native `<dialog>`: `bg-raised`, 1 px `line` border, `rounded-panel`, `shadow-dialog`, width `min(40rem, 90vw)`, `p-5`, `gap-3`; backdrop `backdrop` token. Title `heading` 18/24 Display weight 600 `text-ink`. Body `body` 14 `text-ink`, scrolls inside `max-h-[70vh]`. Footer right-aligned; Close is secondary.

### 5.11 Focus, selection, motion (global)

`:focus-visible` = 2 px `focus` outline, 2 px offset (inside pills and segments: offset 1 px so it is not clipped). Hover/pressed background transitions 120 ms ease; none under reduced motion. Forced colors: pressed toggles keep the existing `Highlight` outline; the selected tree row gets a 2 px `Highlight` inset outline.

## 6. What the owner will see

Light: a warm off-white window; the ribbon's commands sit in white rounded pills with soft shadows and small grey captions under them, the active tab underlined in deep teal. The tree is clean white with no grid lines, faint mint share bars and a teal edge on the selected row. Below, the treemap is a quilt of soft coral, amber, lavender, sky, olive, mint, periwinkle, slate and rose tiles, each gently lit from the top-left, separated by thin paper-coloured gaps, with a one-line legend of file types and percentages under it.

Dark: the same layout on blue-black ink slate; pills are a slightly lighter slate, text warm off-white, and the treemap tiles are deep, muted versions of the same hues that darken softly toward their edges.

## 7. Contrast

Checker: the design-system skill's `contrast.py` (standard-library Python, WCAG 2.2: text AA 4.5:1, `ui` 3:1), run on a draft token file holding exactly the values and pairs below. Result: **164 pairs, 0 failing AA.** Task 8c copies these blocks into `design/tokens.json` and regenerates `design/contrast-report.txt` (its first line stays `Contrast report for design/tokens.json (WCAG 2.2; ui = 3:1 for UI parts and focus rings).`).

### 7.1 `color` block for tokens.json (exact)

```json
{
  "light": {
    "surface-app": "#f5f3ef",
    "surface-panel": "#fcfbf9",
    "surface-raised": "#ffffff",
    "surface-sunken": "#ece8e1",
    "ink": "#24211d",
    "ink-muted": "#5c564e",
    "ink-subtle": "#6e685f",
    "line": "#e3ded5",
    "line-strong": "#8a8276",
    "accent": "#0d6b63",
    "accent-hover": "#0a5850",
    "on-accent": "#ffffff",
    "accent-subtle": "#dcebe6",
    "focus": "#0d6b63",
    "selection": "#d5e8e2",
    "row-hover": "#efebe4",
    "pressed": "#dcebe6",
    "danger": "#a3321f",
    "on-danger": "#ffffff",
    "danger-subtle": "#f7e3dd",
    "warning": "#835400",
    "on-warning": "#ffffff",
    "warning-subtle": "#f6ead0",
    "success": "#2f6b3c",
    "on-success": "#ffffff",
    "success-subtle": "#e0eedd",
    "info": "#245d84",
    "on-info": "#ffffff",
    "info-subtle": "#e0eaf2",
    "bar": "#d3e7e1",
    "bar-track": "#e9e4dc",
    "bar-fill": "#2f8076",
    "treemap-video": "#eba48c",
    "treemap-image": "#e9c46c",
    "treemap-audio": "#d2a8dc",
    "treemap-document": "#9dc3e8",
    "treemap-archive": "#c3d282",
    "treemap-code": "#8fd0bf",
    "treemap-app": "#b2b6ec",
    "treemap-system": "#b9c3ca",
    "treemap-disk-image": "#e8a8c0",
    "treemap-other": "#d8d2c8",
    "treemap-folder": "#e6e1d8",
    "treemap-free": "#f2ecdf",
    "treemap-edge": "#f5f3ef",
    "treemap-free-hatch": "#cfc6b4",
    "treemap-halo": "#ffffff",
    "treemap-cushion-inner": "rgba(255, 255, 255, 0.5)",
    "treemap-cushion-outer": "rgba(255, 255, 255, 0)",
    "backdrop": "rgba(36, 33, 29, 0.32)"
  },
  "dark": {
    "surface-app": "#151a21",
    "surface-panel": "#1a2029",
    "surface-raised": "#212833",
    "surface-sunken": "#10141a",
    "ink": "#ebe7df",
    "ink-muted": "#aaa59c",
    "ink-subtle": "#928e86",
    "line": "#2b333e",
    "line-strong": "#6e7a87",
    "accent": "#5cc3b5",
    "accent-hover": "#7ad1c5",
    "on-accent": "#06201c",
    "accent-subtle": "#1d3a38",
    "focus": "#5cc3b5",
    "selection": "#1f3d3a",
    "row-hover": "#1f2731",
    "pressed": "#1d3a38",
    "danger": "#f0a99a",
    "on-danger": "#2a0d07",
    "danger-subtle": "#3a2220",
    "warning": "#e6c27a",
    "on-warning": "#2a1d02",
    "warning-subtle": "#352c1a",
    "success": "#9dd0a5",
    "on-success": "#0c2412",
    "success-subtle": "#1e3124",
    "info": "#9cc6ea",
    "on-info": "#0a1d2c",
    "info-subtle": "#1c2d3d",
    "bar": "#1f3a37",
    "bar-track": "#262e38",
    "bar-fill": "#5cc3b5",
    "treemap-video": "#8c4b3b",
    "treemap-image": "#715820",
    "treemap-audio": "#6c4a7c",
    "treemap-document": "#2f5879",
    "treemap-archive": "#505e26",
    "treemap-code": "#26665b",
    "treemap-app": "#474d8a",
    "treemap-system": "#46525d",
    "treemap-disk-image": "#7d3e57",
    "treemap-other": "#4a4640",
    "treemap-folder": "#262e39",
    "treemap-free": "#2c2a22",
    "treemap-edge": "#151a21",
    "treemap-free-hatch": "#4a4535",
    "treemap-halo": "#10141a",
    "treemap-cushion-inner": "rgba(0, 0, 0, 0)",
    "treemap-cushion-outer": "rgba(0, 0, 0, 0.35)",
    "backdrop": "rgba(5, 7, 10, 0.6)"
  }
}
```

### 7.2 `pairs` block for tokens.json (exact; 82 per theme)

```json
[
  ["light-ink", "light-surface-app"],
  ["light-ink-muted", "light-surface-app"],
  ["light-ink", "light-surface-panel"],
  ["light-ink-muted", "light-surface-panel"],
  ["light-ink", "light-surface-raised"],
  ["light-ink-muted", "light-surface-raised"],
  ["light-ink", "light-surface-sunken"],
  ["light-ink-muted", "light-surface-sunken"],
  ["light-ink", "light-selection"],
  ["light-ink-muted", "light-selection"],
  ["light-ink", "light-row-hover"],
  ["light-ink-muted", "light-row-hover"],
  ["light-ink", "light-pressed"],
  ["light-ink-muted", "light-pressed"],
  ["light-ink", "light-bar"],
  ["light-ink-muted", "light-bar"],
  ["light-ink", "light-accent-subtle"],
  ["light-ink-muted", "light-accent-subtle"],
  ["light-ink-subtle", "light-surface-app"],
  ["light-ink-subtle", "light-surface-panel"],
  ["light-ink-subtle", "light-surface-raised"],
  ["light-ink-subtle", "light-surface-sunken"],
  ["light-on-accent", "light-accent"],
  ["light-on-accent", "light-accent-hover"],
  ["light-accent", "light-surface-app"],
  ["light-accent", "light-surface-panel"],
  ["light-accent", "light-surface-raised"],
  ["light-accent", "light-accent-subtle"],
  ["light-accent", "light-pressed"],
  ["light-on-danger", "light-danger"],
  ["light-ink", "light-danger-subtle"],
  ["light-ink-muted", "light-danger-subtle"],
  ["light-danger", "light-danger-subtle"],
  ["light-danger", "light-surface-panel"],
  ["light-on-warning", "light-warning"],
  ["light-ink", "light-warning-subtle"],
  ["light-ink-muted", "light-warning-subtle"],
  ["light-warning", "light-warning-subtle"],
  ["light-warning", "light-surface-panel"],
  ["light-on-success", "light-success"],
  ["light-ink", "light-success-subtle"],
  ["light-ink-muted", "light-success-subtle"],
  ["light-success", "light-success-subtle"],
  ["light-success", "light-surface-panel"],
  ["light-on-info", "light-info"],
  ["light-ink", "light-info-subtle"],
  ["light-ink-muted", "light-info-subtle"],
  ["light-info", "light-info-subtle"],
  ["light-info", "light-surface-panel"],
  ["light-ink", "light-treemap-video"],
  ["light-ink", "light-treemap-image"],
  ["light-ink", "light-treemap-audio"],
  ["light-ink", "light-treemap-document"],
  ["light-ink", "light-treemap-archive"],
  ["light-ink", "light-treemap-code"],
  ["light-ink", "light-treemap-app"],
  ["light-ink", "light-treemap-system"],
  ["light-ink", "light-treemap-disk-image"],
  ["light-ink", "light-treemap-other"],
  ["light-ink", "light-treemap-folder"],
  ["light-ink", "light-treemap-free"],
  ["light-ink", "light-treemap-free-hatch"],
  ["light-accent", "light-treemap-video", "ui"],
  ["light-accent", "light-treemap-image", "ui"],
  ["light-accent", "light-treemap-audio", "ui"],
  ["light-accent", "light-treemap-document", "ui"],
  ["light-accent", "light-treemap-archive", "ui"],
  ["light-accent", "light-treemap-code", "ui"],
  ["light-accent", "light-treemap-app", "ui"],
  ["light-accent", "light-treemap-system", "ui"],
  ["light-accent", "light-treemap-disk-image", "ui"],
  ["light-accent", "light-treemap-halo", "ui"],
  ["light-focus", "light-surface-app", "ui"],
  ["light-focus", "light-surface-panel", "ui"],
  ["light-focus", "light-surface-raised", "ui"],
  ["light-line-strong", "light-surface-app", "ui"],
  ["light-line-strong", "light-surface-panel", "ui"],
  ["light-line-strong", "light-surface-raised", "ui"],
  ["light-bar-fill", "light-bar-track", "ui"],
  ["light-bar-fill", "light-surface-panel", "ui"],
  ["light-accent", "light-selection", "ui"],
  ["light-accent", "light-surface-sunken", "ui"],
  ["dark-ink", "dark-surface-app"],
  ["dark-ink-muted", "dark-surface-app"],
  ["dark-ink", "dark-surface-panel"],
  ["dark-ink-muted", "dark-surface-panel"],
  ["dark-ink", "dark-surface-raised"],
  ["dark-ink-muted", "dark-surface-raised"],
  ["dark-ink", "dark-surface-sunken"],
  ["dark-ink-muted", "dark-surface-sunken"],
  ["dark-ink", "dark-selection"],
  ["dark-ink-muted", "dark-selection"],
  ["dark-ink", "dark-row-hover"],
  ["dark-ink-muted", "dark-row-hover"],
  ["dark-ink", "dark-pressed"],
  ["dark-ink-muted", "dark-pressed"],
  ["dark-ink", "dark-bar"],
  ["dark-ink-muted", "dark-bar"],
  ["dark-ink", "dark-accent-subtle"],
  ["dark-ink-muted", "dark-accent-subtle"],
  ["dark-ink-subtle", "dark-surface-app"],
  ["dark-ink-subtle", "dark-surface-panel"],
  ["dark-ink-subtle", "dark-surface-raised"],
  ["dark-ink-subtle", "dark-surface-sunken"],
  ["dark-on-accent", "dark-accent"],
  ["dark-on-accent", "dark-accent-hover"],
  ["dark-accent", "dark-surface-app"],
  ["dark-accent", "dark-surface-panel"],
  ["dark-accent", "dark-surface-raised"],
  ["dark-accent", "dark-accent-subtle"],
  ["dark-accent", "dark-pressed"],
  ["dark-on-danger", "dark-danger"],
  ["dark-ink", "dark-danger-subtle"],
  ["dark-ink-muted", "dark-danger-subtle"],
  ["dark-danger", "dark-danger-subtle"],
  ["dark-danger", "dark-surface-panel"],
  ["dark-on-warning", "dark-warning"],
  ["dark-ink", "dark-warning-subtle"],
  ["dark-ink-muted", "dark-warning-subtle"],
  ["dark-warning", "dark-warning-subtle"],
  ["dark-warning", "dark-surface-panel"],
  ["dark-on-success", "dark-success"],
  ["dark-ink", "dark-success-subtle"],
  ["dark-ink-muted", "dark-success-subtle"],
  ["dark-success", "dark-success-subtle"],
  ["dark-success", "dark-surface-panel"],
  ["dark-on-info", "dark-info"],
  ["dark-ink", "dark-info-subtle"],
  ["dark-ink-muted", "dark-info-subtle"],
  ["dark-info", "dark-info-subtle"],
  ["dark-info", "dark-surface-panel"],
  ["dark-ink", "dark-treemap-video"],
  ["dark-ink", "dark-treemap-image"],
  ["dark-ink", "dark-treemap-audio"],
  ["dark-ink", "dark-treemap-document"],
  ["dark-ink", "dark-treemap-archive"],
  ["dark-ink", "dark-treemap-code"],
  ["dark-ink", "dark-treemap-app"],
  ["dark-ink", "dark-treemap-system"],
  ["dark-ink", "dark-treemap-disk-image"],
  ["dark-ink", "dark-treemap-other"],
  ["dark-ink", "dark-treemap-folder"],
  ["dark-ink", "dark-treemap-free"],
  ["dark-ink", "dark-treemap-free-hatch"],
  ["dark-accent", "dark-treemap-video", "ui"],
  ["dark-accent", "dark-treemap-image", "ui"],
  ["dark-accent", "dark-treemap-audio", "ui"],
  ["dark-accent", "dark-treemap-document", "ui"],
  ["dark-accent", "dark-treemap-archive", "ui"],
  ["dark-accent", "dark-treemap-code", "ui"],
  ["dark-accent", "dark-treemap-app", "ui"],
  ["dark-accent", "dark-treemap-system", "ui"],
  ["dark-accent", "dark-treemap-disk-image", "ui"],
  ["dark-accent", "dark-treemap-halo", "ui"],
  ["dark-focus", "dark-surface-app", "ui"],
  ["dark-focus", "dark-surface-panel", "ui"],
  ["dark-focus", "dark-surface-raised", "ui"],
  ["dark-line-strong", "dark-surface-app", "ui"],
  ["dark-line-strong", "dark-surface-panel", "ui"],
  ["dark-line-strong", "dark-surface-raised", "ui"],
  ["dark-bar-fill", "dark-bar-track", "ui"],
  ["dark-bar-fill", "dark-surface-panel", "ui"],
  ["dark-accent", "dark-selection", "ui"],
  ["dark-accent", "dark-surface-sunken", "ui"]
]
```

### 7.3 Checker output on these values

```text
  AAA   14.46:1  light-ink                on light-surface-app
  AA     6.54:1  light-ink-muted          on light-surface-app
  AAA   15.50:1  light-ink                on light-surface-panel
  AAA    7.01:1  light-ink-muted          on light-surface-panel
  AAA   16.03:1  light-ink                on light-surface-raised
  AAA    7.25:1  light-ink-muted          on light-surface-raised
  AAA   13.12:1  light-ink                on light-surface-sunken
  AA     5.94:1  light-ink-muted          on light-surface-sunken
  AAA   12.57:1  light-ink                on light-selection
  AA     5.69:1  light-ink-muted          on light-selection
  AAA   13.49:1  light-ink                on light-row-hover
  AA     6.10:1  light-ink-muted          on light-row-hover
  AAA   13.03:1  light-ink                on light-pressed
  AA     5.89:1  light-ink-muted          on light-pressed
  AAA   12.43:1  light-ink                on light-bar
  AA     5.62:1  light-ink-muted          on light-bar
  AAA   13.03:1  light-ink                on light-accent-subtle
  AA     5.89:1  light-ink-muted          on light-accent-subtle
  AA     4.98:1  light-ink-subtle         on light-surface-app
  AA     5.33:1  light-ink-subtle         on light-surface-panel
  AA     5.51:1  light-ink-subtle         on light-surface-raised
  AA     4.52:1  light-ink-subtle         on light-surface-sunken
  AA     6.36:1  light-on-accent          on light-accent
  AAA    8.32:1  light-on-accent          on light-accent-hover
  AA     5.74:1  light-accent             on light-surface-app
  AA     6.15:1  light-accent             on light-surface-panel
  AA     6.36:1  light-accent             on light-surface-raised
  AA     5.17:1  light-accent             on light-accent-subtle
  AA     5.17:1  light-accent             on light-pressed
  AA     6.92:1  light-on-danger          on light-danger
  AAA   12.96:1  light-ink                on light-danger-subtle
  AA     5.87:1  light-ink-muted          on light-danger-subtle
  AA     5.60:1  light-danger             on light-danger-subtle
  AA     6.69:1  light-danger             on light-surface-panel
  AA     6.50:1  light-on-warning         on light-warning
  AAA   13.43:1  light-ink                on light-warning-subtle
  AA     6.08:1  light-ink-muted          on light-warning-subtle
  AA     5.44:1  light-warning            on light-warning-subtle
  AA     6.28:1  light-warning            on light-surface-panel
  AA     6.38:1  light-on-success         on light-success
  AAA   13.31:1  light-ink                on light-success-subtle
  AA     6.02:1  light-ink-muted          on light-success-subtle
  AA     5.30:1  light-success            on light-success-subtle
  AA     6.17:1  light-success            on light-surface-panel
  AAA    7.06:1  light-on-info            on light-info
  AAA   13.14:1  light-ink                on light-info-subtle
  AA     5.95:1  light-ink-muted          on light-info-subtle
  AA     5.79:1  light-info               on light-info-subtle
  AA     6.83:1  light-info               on light-surface-panel
  AAA    7.80:1  light-ink                on light-treemap-video
  AAA    9.60:1  light-ink                on light-treemap-image
  AAA    7.92:1  light-ink                on light-treemap-audio
  AAA    8.70:1  light-ink                on light-treemap-document
  AAA    9.82:1  light-ink                on light-treemap-archive
  AAA    9.11:1  light-ink                on light-treemap-code
  AAA    8.24:1  light-ink                on light-treemap-app
  AAA    8.95:1  light-ink                on light-treemap-system
  AAA    8.24:1  light-ink                on light-treemap-disk-image
  AAA   10.66:1  light-ink                on light-treemap-other
  AAA   12.31:1  light-ink                on light-treemap-folder
  AAA   13.61:1  light-ink                on light-treemap-free
  AAA    9.46:1  light-ink                on light-treemap-free-hatch
  PASS   3.10:1  light-accent             on light-treemap-video  ui
  PASS   3.81:1  light-accent             on light-treemap-image  ui
  PASS   3.14:1  light-accent             on light-treemap-audio  ui
  PASS   3.46:1  light-accent             on light-treemap-document ui
  PASS   3.90:1  light-accent             on light-treemap-archive ui
  PASS   3.62:1  light-accent             on light-treemap-code   ui
  PASS   3.27:1  light-accent             on light-treemap-app    ui
  PASS   3.55:1  light-accent             on light-treemap-system ui
  PASS   3.27:1  light-accent             on light-treemap-disk-image ui
  PASS   6.36:1  light-accent             on light-treemap-halo   ui
  PASS   5.74:1  light-focus              on light-surface-app    ui
  PASS   6.15:1  light-focus              on light-surface-panel  ui
  PASS   6.36:1  light-focus              on light-surface-raised ui
  PASS   3.42:1  light-line-strong        on light-surface-app    ui
  PASS   3.67:1  light-line-strong        on light-surface-panel  ui
  PASS   3.79:1  light-line-strong        on light-surface-raised ui
  PASS   3.71:1  light-bar-fill           on light-bar-track      ui
  PASS   4.54:1  light-bar-fill           on light-surface-panel  ui
  PASS   4.99:1  light-accent             on light-selection      ui
  PASS   5.21:1  light-accent             on light-surface-sunken ui
  AAA   14.17:1  dark-ink                 on dark-surface-app
  AAA    7.13:1  dark-ink-muted           on dark-surface-app
  AAA   13.28:1  dark-ink                 on dark-surface-panel
  AA     6.68:1  dark-ink-muted           on dark-surface-panel
  AAA   12.03:1  dark-ink                 on dark-surface-raised
  AA     6.05:1  dark-ink-muted           on dark-surface-raised
  AAA   14.98:1  dark-ink                 on dark-surface-sunken
  AAA    7.54:1  dark-ink-muted           on dark-surface-sunken
  AAA    9.53:1  dark-ink                 on dark-selection
  AA     4.80:1  dark-ink-muted           on dark-selection
  AAA   12.23:1  dark-ink                 on dark-row-hover
  AA     6.15:1  dark-ink-muted           on dark-row-hover
  AAA    9.93:1  dark-ink                 on dark-pressed
  AA     5.00:1  dark-ink-muted           on dark-pressed
  AAA    9.91:1  dark-ink                 on dark-bar
  AA     4.99:1  dark-ink-muted           on dark-bar
  AAA    9.93:1  dark-ink                 on dark-accent-subtle
  AA     5.00:1  dark-ink-muted           on dark-accent-subtle
  AA     5.36:1  dark-ink-subtle          on dark-surface-app
  AA     5.02:1  dark-ink-subtle          on dark-surface-panel
  AA     4.54:1  dark-ink-subtle          on dark-surface-raised
  AA     5.66:1  dark-ink-subtle          on dark-surface-sunken
  AAA    8.06:1  dark-on-accent           on dark-accent
  AAA    9.55:1  dark-on-accent           on dark-accent-hover
  AAA    8.26:1  dark-accent              on dark-surface-app
  AAA    7.74:1  dark-accent              on dark-surface-panel
  AAA    7.01:1  dark-accent              on dark-surface-raised
  AA     5.79:1  dark-accent              on dark-accent-subtle
  AA     5.79:1  dark-accent              on dark-pressed
  AAA    9.36:1  dark-on-danger           on dark-danger
  AAA   11.91:1  dark-ink                 on dark-danger-subtle
  AA     6.00:1  dark-ink-muted           on dark-danger-subtle
  AAA    7.59:1  dark-danger              on dark-danger-subtle
  AAA    8.46:1  dark-danger              on dark-surface-panel
  AAA    9.70:1  dark-on-warning          on dark-warning
  AAA   11.15:1  dark-ink                 on dark-warning-subtle
  AA     5.61:1  dark-ink-muted           on dark-warning-subtle
  AAA    8.10:1  dark-warning             on dark-warning-subtle
  AAA    9.64:1  dark-warning             on dark-surface-panel
  AAA    9.40:1  dark-on-success          on dark-success
  AAA   11.20:1  dark-ink                 on dark-success-subtle
  AA     5.64:1  dark-ink-muted           on dark-success-subtle
  AAA    7.89:1  dark-success             on dark-success-subtle
  AAA    9.36:1  dark-success             on dark-surface-panel
  AAA    9.53:1  dark-on-info             on dark-info
  AAA   11.41:1  dark-ink                 on dark-info-subtle
  AA     5.74:1  dark-ink-muted           on dark-info-subtle
  AAA    7.83:1  dark-info                on dark-info-subtle
  AAA    9.11:1  dark-info                on dark-surface-panel
  AA     5.35:1  dark-ink                 on dark-treemap-video
  AA     5.46:1  dark-ink                 on dark-treemap-image
  AA     5.86:1  dark-ink                 on dark-treemap-audio
  AA     6.10:1  dark-ink                 on dark-treemap-document
  AA     5.73:1  dark-ink                 on dark-treemap-archive
  AA     5.43:1  dark-ink                 on dark-treemap-code
  AA     6.32:1  dark-ink                 on dark-treemap-app
  AA     6.49:1  dark-ink                 on dark-treemap-system
  AA     6.31:1  dark-ink                 on dark-treemap-disk-image
  AAA    7.60:1  dark-ink                 on dark-treemap-other
  AAA   11.11:1  dark-ink                 on dark-treemap-folder
  AAA   11.65:1  dark-ink                 on dark-treemap-free
  AAA    7.76:1  dark-ink                 on dark-treemap-free-hatch
  PASS   3.12:1  dark-accent              on dark-treemap-video   ui
  PASS   3.18:1  dark-accent              on dark-treemap-image   ui
  PASS   3.41:1  dark-accent              on dark-treemap-audio   ui
  PASS   3.55:1  dark-accent              on dark-treemap-document ui
  PASS   3.34:1  dark-accent              on dark-treemap-archive ui
  PASS   3.17:1  dark-accent              on dark-treemap-code    ui
  PASS   3.68:1  dark-accent              on dark-treemap-app     ui
  PASS   3.78:1  dark-accent              on dark-treemap-system  ui
  PASS   3.68:1  dark-accent              on dark-treemap-disk-image ui
  PASS   8.73:1  dark-accent              on dark-treemap-halo    ui
  PASS   8.26:1  dark-focus               on dark-surface-app     ui
  PASS   7.74:1  dark-focus               on dark-surface-panel   ui
  PASS   7.01:1  dark-focus               on dark-surface-raised  ui
  PASS   3.99:1  dark-line-strong         on dark-surface-app     ui
  PASS   3.74:1  dark-line-strong         on dark-surface-panel   ui
  PASS   3.39:1  dark-line-strong         on dark-surface-raised  ui
  PASS   6.49:1  dark-bar-fill            on dark-bar-track       ui
  PASS   7.74:1  dark-bar-fill            on dark-surface-panel   ui
  PASS   5.56:1  dark-accent              on dark-selection       ui
  PASS   8.73:1  dark-accent              on dark-surface-sunken  ui

  164 pairs, 0 failing AA
```

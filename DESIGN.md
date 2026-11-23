# StorageIQ Design System

Mode: **Operate.** StorageIQ is a tool. Clarity, scannability and Windows-native expectations come before visual expression. Character shows in precise details: a calm teal accent, a warm palette, a file-type coloured treemap, tabular numbers and monospaced paths.

Since Phase 3 the window is an analyzer workspace: ribbon, column tree, treemap pane, level bar and status bar. Its structure (density, row height, column order and widths, pane sizes) is measured from the owner's reference screenshots; its name, icons, palette, fonts and copy are StorageIQ's own.

## Principles (Strata: warm and calm)

The full spec, with every value, is `docs/superpowers/specs/2026-11-23-strata-visual-design.md`.

1. One accent, used sparingly: deep teal marks state (selected tab, pressed toggles, the selected row's edge, the treemap selection, focus). Category colours belong to the treemap and its legend only.
2. Warm and calm, not grey: light surfaces are warm off-whites, dark surfaces blue-black slates; text is warm in both. No pure black or white text.
3. Colour by what the bytes are: the treemap is coloured by file type (ten hues in one lightness band per theme, soft cushion shading), with a legend of types and shares. Colour is never the only cue: tiles carry labels and the tree is the accessible equivalent.
4. Depth by surface, not by line: raised pills and menus on the warm background, hairline borders, no row lines.
5. Numbers are data: tabular figures everywhere, sizes right-aligned.
6. Calm about problems: recoverable messages are info (blue-grey, `Info` icon); only a scanner crash is danger, as a tinted strip with an icon.
7. Contrast is a gate: every text pair 4.5:1 and every UI pair 3:1, in both themes.
8. Respect the system: light/dark, `prefers-contrast: more` (no cushion, ink gaps), `forced-colors` (system colours, text-only legend), `prefers-reduced-motion`. Windows system fonts only; Lucide icons, decorative and `aria-hidden`.

## Tokens

Source of truth: `design/tokens.json`. `npm run tokens` writes `design/tokens.css` (CSS custom properties for light and dark, including the `--elevation-*` shadows); `src/renderer/src/styles/global.css` imports it and maps it into Tailwind (`bg-raised`, `text-ink-muted`, `bg-selection`, `shadow-raised`, …). Components never use raw hex. CI fails when `tokens.css` is stale (`node scripts/build-tokens.mjs --check`).

Contrast: `design/contrast-report.txt` lists every text/background and UI pair in both themes with its WCAG ratio (164 pairs, zero AA failures). Re-run the design-system contrast checker on `design/tokens.json` after any palette change.

| Group              | Tokens                                                                                               | Utilities                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Surfaces           | `surface-app` `-panel` `-raised` `-sunken` (light: `#f5f3ef` `#fcfbf9` `#ffffff` `#ece8e1`)          | `bg-app` `bg-panel` `bg-raised` `bg-sunken`      |
| Text               | `ink` `ink-muted` `ink-subtle` (all AA on every surface listed)                                      | `text-ink` `text-ink-muted` `text-ink-subtle`    |
| Lines              | `line` (hairline), `line-strong` (3:1 control borders)                                               | `border-line` `border-line-strong`               |
| Accent             | `accent` `accent-hover` `on-accent` `accent-subtle` `focus` `selection` `row-hover` `pressed`        | `bg-accent` `bg-selection` `bg-row-hover`        |
| Tones              | `danger` `warning` `success` `info`, each with `on-<tone>` and `<tone>-subtle`                       | `bg-info-subtle` `text-danger`                   |
| Bars               | `bar` `bar-track` `bar-fill`                                                                         | `bg-bar` `bg-bar-track` `bg-bar-fill`            |
| Treemap            | ten `treemap-<category>`, `-folder` `-free` `-edge` `-free-hatch` `-halo`, cushion stops, `backdrop` | CSS variables, read by the canvas                |
| Elevation / radius | `elevation.raised/menu/dialog`; radius control 6, panel 10, group 12, pill 999                       | `shadow-raised` `rounded-control` `rounded-pill` |

Layout tokens (`--size-*`): tab strip 28, ribbon body 92, ribbon caption 16, header row 32, tree row 30, indent 16, columns 280+/112/112/96/96/112/120, treemap 260 (min 120), treemap legend 28, level bar 36, status bar 26, splitter 6 (px).

Typography (system fonts): caption 12/16 Segoe UI Variable Small, label 13/18, body 14/20, title 15/20, heading 18/24 Display; paths `Cascadia Mono`.

## File-type treemap

The treemap colours each block by file type (`src/shared/file-category.ts`, ten categories decided by extension). A folder block takes its dominant type's colour when that type is at least half of its logical size, otherwise the neutral "mixed" colour; this is by logical size in every Mode. Nested folders are frames, free space is hatched. A one-row legend under the canvas names the colours with their shares of the treemap folder.

## Components

Specs with every state and keyboard behaviour: `design/components.md`. Summary:

- **Ribbon**: a tab list (File, Home, Scan, View) over one toolbar of labelled groups; toggles use `aria-pressed`, unavailable commands `aria-disabled` (still focusable). Arrow keys move inside the tab list and the toolbar (native `focusgroup`, with a script fallback).
- **Select menu**: a menu button with grouped items (Drives, Documents and cloud, Recently scanned, Directory).
- **Column tree**: a virtualized ARIA treegrid; Name cell shows the Mode value over a bar sized to the share of the parent; rows at 10 % or more are bold; one "[N files]" row per folder.
- **Explorer context menu**: the real Windows shell menu, with StorageIQ's items first.
- **Treemap pane**: a canvas image coloured by file type, with a header (title, × to hide), a legend, a level bar (Level 0–5) and a splitter above it.
- **Status bar**: free space, files found, excluded items (opens their list), bytes per cluster and file system.
- **Banner** (`role="alert"`; info or danger), **Dialog** (native `<dialog>`), **Button** (primary/secondary/quiet; busy = `aria-disabled` with no hover change).

## Guidance applied

- modern-web-guidance "menu": menu button opens with Enter/Space/click, ArrowDown enters, Escape returns focus, Tab and outside click close; script positioning because Electron 45's Chromium has no CSS anchor positioning.
- "toolbar" and "tabs": one tab stop, arrow keys, `aria-pressed` toggles, `aria-disabled` instead of `disabled`, selection follows focus in the tab list.
- Canvas: the treemap is `role="img"` with a label; the tree is the accessible equivalent (the experimental canvas-to-HTML route is not used).
- Target sizes: ribbon commands are at least 56 × 60 px; small toggles, menu items and the splitter at least 24 px tall (WCAG 2.2 SC 2.5.8).

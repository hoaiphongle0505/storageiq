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

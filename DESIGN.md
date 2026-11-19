# StorageIQ Design System

Mode: **Operate.** StorageIQ is a tool. Clarity, scannability and Windows-native expectations come before visual expression. Character shows in precise details: a calm teal accent, tabular numbers and monospaced paths.

## Principles

1. Feel at home on Windows 11: Segoe UI Variable, 4 px control radius, 8 px panel radius, native title bar.
2. Data first: numbers use tabular figures; paths use Cascadia Mono; nothing decorative competes with sizes.
3. One accent, used only for the primary action and focus.
4. Follow the system light/dark theme; no custom theme switcher in the MVP.
5. Respect `prefers-reduced-motion`; motion is never needed to understand state.

## Tokens (source: `src/renderer/src/styles/global.css`)

| Token               | Light     | Dark      | Utility                                                                   |
| ------------------- | --------- | --------- | ------------------------------------------------------------------------- |
| `--surface-app`     | `#f6f7f7` | `#161a1b` | `bg-app` (must equal `WINDOW_BACKGROUND` in `src/main/window-options.ts`) |
| `--surface-panel`   | `#ffffff` | `#1e2324` | `bg-panel`                                                                |
| `--surface-sunken`  | `#eef0f0` | `#121516` | `bg-sunken`                                                               |
| `--border`          | `#dde1e1` | `#2e3536` | `border-line`                                                             |
| `--text`            | `#1b2122` | `#e6eaea` | `text-ink`                                                                |
| `--text-muted`      | `#5b6667` | `#9aa5a6` | `text-ink-muted`                                                          |
| `--accent`          | `#0f7a73` | `#4fc1b6` | `bg-accent`                                                               |
| `--accent-hover`    | `#0c655f` | `#6fd0c6` | `hover:bg-accent-hover`                                                   |
| `--accent-contrast` | `#ffffff` | `#062421` | `text-on-accent`                                                          |
| `--danger`          | `#b3261e` | `#f2b8b5` | `text-danger`, `border-danger`                                            |

Typography: body 14 px / 1.43 `Segoe UI Variable Text`; headings `Segoe UI Variable Display`; status text 12 px; paths `Cascadia Mono` 13 px.

Text contrast meets WCAG 2.2 AA in both themes. Focus is a 2 px accent outline with a 2 px offset.

## Guidance changes applied to the baseline

- Inline error "Dismiss" button: added `py-0.5` so the target is at least 24 x 24 CSS px (WCAG 2.2 SC 2.5.8 Target Size, `modern-web-guidance` accessibility guide, "Target sizes"). Without it the button was about 20 px tall.
- Unreadable-folders disclosure `<summary>`: added `min-h-6 py-0.5` so the toggle meets the 24 x 24 CSS px minimum target (WCAG 2.2 SC 2.5.8; `accessibility` guide, "Target sizes"). Native `<details>` kept (`html`/`search-hidden-content` guides: searchable, accessible by default; no heading inside `<summary>`).
- Stat grids (`<dl>`) on the scanning and result screens: `grid-cols-2 sm:grid-cols-4` so four stats wrap at narrow widths instead of overflowing (reflow, WCAG 1.4.10; `form-factor-adaptation` guide).

Checked and already compliant, so unchanged: the error uses `role="alert"` (live-region guide, critical failures); focus uses `:focus-visible` with an outline and `outline-offset` (focus-indicator guide); the shell uses semantic `main`, `footer` and a labelled `section`; the craft floor's contrast, kicker/eyebrow, nested-card and side-border rules.

## Components (Phase 2a)

- **Button** (`src/renderer/src/components/Button.tsx`): `primary` (accent) for the one main action on a screen, `secondary` (panel with a border) for everything else. A busy button uses `aria-disabled="true"`, stays focusable, ignores clicks and keeps its resting colour on hover (`aria-disabled:hover:bg-accent` / `aria-disabled:hover:bg-panel`; roadmap carry-over 8).
- **Drive card**: the whole card is one button named by its text (`Local Disk (C:) 128 GB free of 512 GB`); removable drives carry a `USB` badge; the used-space bar is decorative (`aria-hidden`) because the text states the numbers.
- **Data bars** (drive cards, largest folders): neutral `bg-ink-muted` on a `bg-line` track. The accent stays reserved for the primary action and focus (principle 3).
- **Stats**: a `<dl>` of `Stat` items; values use tabular figures; the exact byte count sits in the `title`.
- **Progress announcements**: one visually hidden `aria-live="polite"` region, updated at most every 5 s (`useThrottledAnnouncement`).
- **Focus**: Cancel gets focus when a scan starts; the result heading (`tabIndex=-1`) gets focus when it ends; Retry gets focus on the crash screen.
- **Unreadable folders**: a native `<details>`/`<summary>` disclosure, closed by default.

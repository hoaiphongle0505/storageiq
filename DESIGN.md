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

Checked and already compliant, so unchanged: the error uses `role="alert"` (live-region guide, critical failures); focus uses `:focus-visible` with an outline and `outline-offset` (focus-indicator guide); the shell uses semantic `main`, `footer` and a labelled `section`; the craft floor's contrast, kicker/eyebrow, nested-card and side-border rules.

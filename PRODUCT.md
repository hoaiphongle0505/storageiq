# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Desktop app rendered by Electron's Chromium on Windows; the design language is web, tuned to Windows 11 conventions.)

## Stack

Electron + React + TypeScript + TailwindCSS + Zustand, built with electron-vite, packaged with electron-builder (NSIS, x64). SQLite is part of the target stack and is introduced in Phase 7 (History), not before.

## Users

General consumers on Windows 10 (1809+) and Windows 11 who notice that their disk is full and want to find out what is using the space, so they can free some up. They are not storage experts: they need plain language, obvious next steps, and no admin prompts or jargon.

## Product Purpose

StorageIQ scans a drive or folder and shows, clearly and quickly, where the space is going: which folders are biggest and which individual files are largest. Success means a user goes from "my disk is full" to "I know what to delete" in one sitting, without needing outside help.

## Positioning

"Shows where your disk space went, and explains it in plain words." This was confirmed on 2026-11-18 after research into user reviews; see internal research notes.

- **Explains:** plain-language labels say what well-known space hogs are and whether they are safe to clean up.
- **Honest totals:** online-only cloud files never count as space on disk, hardlinks are counted once, and the app shows how its total compares with the used space Windows reports.
- **Free and open source:** MIT licensed, no nags, no account. It includes features that paid disk analyzers keep in paid tiers.

No scan-speed claims beyond what was measured (about 100–130 s for 1.9 million files on the development machine), and marketing never names a competitor.

## Operating Context

- Runs locally on the user's PC; scans local fixed drives, removable drives and folders the user can read.
- Runs without elevation by default. Folders the user cannot access are reported, not silently hidden.
- The user often starts it from a "low disk space" moment, while other apps are running.

## Capabilities and Constraints

- Roadmap v3 (2026-11-19): Phase 3 analyzer workspace (ribbon, Select menu, column tree, file-type treemap with legend, status bar, Strata look); Phase 4 side views (top files, file types, file age); Phase 5 charts and export; Phase 6 actions (delete to Recycle Bin with confirmation, search) — MVP complete and first release; Phase 7+ honest totals, duplicates, history, explanations, AI.
- Read-only by default: StorageIQ's own commands never delete or move files until Phase 6. Since Phase 3 a right-click shows the Windows Explorer context menu for the item, so Explorer's own commands (Open, Send to, Delete to the Recycle Bin, Properties, …) are available exactly as in Explorer; StorageIQ adds only "New folder" and refreshes the folder after a command that may change it.
- Scans run in parallel and without elevation. The only measured figure is about 100–130 s for 1.9 million files on the development machine; no speed claim is made beyond that.
- The installer offers a per-user or an all-users install. Installed copies update themselves from GitHub Releases (see docs/RELEASING.md). Code signing through SignPath is pending, so builds are unsigned for now.
- Windows 10 1809+ and Windows 11, x64 only.
- License: MIT.
- Undecided: how AI insights will run (locally or through a cloud service).

## Evidence on Hand

None yet: no users, benchmarks, testimonials or brand assets exist. Future work must not invent scan-speed claims, user counts or comparisons.

## Product Principles

1. Plain language over jargon: "Largest files", not "Top-N file entries".
2. Never lose the user's trust: be read-only by default, show every inaccessible folder, and keep the user's data on their PC.
3. Responsive under load: scanning never freezes the UI, and the user can always cancel.
4. MVP first: each phase ships complete, tested behaviour before the next phase starts.

## Accessibility & Inclusion

Full keyboard operation and screen-reader labels for every control (WCAG 2.2 AA). Respect the Windows light/dark setting and reduced-motion preference.

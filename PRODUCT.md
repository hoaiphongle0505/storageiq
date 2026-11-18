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

A free, MIT-licensed, open-source alternative to paid disk analyzers. It offers the features those tools sell in paid tiers (largest files, treemap, export, history, duplicates) in a modern interface written for non-experts.

## Operating Context

- Runs locally on the user's PC; scans local fixed drives, removable drives and folders the user can read.
- Runs without elevation by default. Folders the user cannot access are reported, not silently hidden.
- The user often starts it from a "low disk space" moment, while other apps are running.

## Capabilities and Constraints

- MVP: drive scan, folder scan, recursive traversal, folder size, file count, folder count, tree view, largest files view, progress reporting, cancel scan.
- Later: treemap, CSV/Excel export, scan history, duplicate finder, AI insights.
- Windows 10 1809+ and Windows 11, x64 only.
- License: MIT.
- Undecided: whether StorageIQ will ever delete files itself (MVP shows data only), and how AI insights will run (locally or through a cloud service).

## Evidence on Hand

None yet: no users, benchmarks, testimonials or brand assets exist. Future work must not invent scan-speed claims, user counts or comparisons.

## Product Principles

1. Plain language over jargon: "Largest files", not "Top-N file entries".
2. Never lose the user's trust: be read-only by default, show every inaccessible folder, and keep the user's data on their PC.
3. Responsive under load: scanning never freezes the UI, and the user can always cancel.
4. MVP first: each phase ships complete, tested behaviour before the next phase starts.

## Accessibility & Inclusion

Full keyboard operation and screen-reader labels for every control (WCAG 2.2 AA). Respect the Windows light/dark setting and reduced-motion preference.

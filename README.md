# <img src="docs/assets/logo.svg" alt="" width="64" height="64" align="absmiddle"> StorageIQ

A free, open-source disk space analyzer for Windows. StorageIQ shows where your disk space went, and explains it in plain words. It scans a drive or folder and shows which folders and files use the most space, so you can decide what to clean up.

> **Status:** early development. Phase 3 (Analyzer Workspace) turns the scanner into a full workspace in the Strata look (light and dark): a ribbon with a Select menu (drives, Documents, OneDrive, recent scans, any folder), a virtualized column tree (size, allocated size, files, folders, share of the parent, last modified), a treemap pane with levels 0–5 that colours files by type and names the types in a legend, the Windows Explorer context menu on every row, and a status bar with free space and cluster size. Scans walk folders in parallel (about 100–130 s for 1.9 million files on the development machine). The installer offers a per-user or an all-users install, and installed copies update themselves from GitHub Releases ([how to release](docs/RELEASING.md)); code signing through SignPath is pending. Next: side views (top files, file types, file age). See the [roadmap](docs/ROADMAP.md).

## Requirements

- Windows 10 (1809 or later) or Windows 11, x64
- Node.js 22 or later (for development)

## Development

```bash
npm install
npm run dev          # start the app with hot reload
npm test             # unit tests (Vitest)
npm run test:e2e     # build, then run Electron end-to-end tests (Playwright)
npm run typecheck
npm run lint
npm run format:check
npm run build        # production build into out/
npm run dist         # build the Windows installer into release/<version>/
npm run test:packaged # run the packaged app's self-test (after npm run dist)
npm run tokens       # regenerate design/tokens.css from design/tokens.json
npm run test:perf    # 1M-file tree-store limits
npm run metrics      # print report-only metrics (bundle, installer, RAM, scan time)
```

Notes:

- If `npm run dev` or the app crashes immediately as plain Node, your shell has `ELECTRON_RUN_AS_NODE` set. Remove it (PowerShell: `Remove-Item Env:ELECTRON_RUN_AS_NODE`).
- `npm run test:e2e` opens a real window, so it needs an interactive desktop session (it is not headless).
- Run the unit tests from PowerShell or cmd, not Git Bash.

Installers are currently unsigned, so Windows SmartScreen will warn on first run. An all-users (per-machine) install shows a Windows administrator (UAC) prompt, also when an update installs at quit.

## Architecture

- `src/main`: Electron main process (window, security policy, IPC handlers, drive and volume details through koffi, the Explorer context menu through COM, Windows shell icons on a worker thread, auto-update)
- `src/worker`: the scanner utilityProcess (parallel directory walk, columnar tree store, tree pages, file-type categories, treemap layout, folder refresh)
- `src/preload`: the only bridge to the renderer (`window.storageiq`)
- `src/renderer`: React UI (Tailwind, Zustand, Fluent UI System Icons): ribbon, column tree, treemap with legend, status bar
- `src/shared`: types shared by every process, including the IPC contract
- `design`: design tokens (`tokens.json` → `tokens.css`), component specs and the contrast report

The installed app lists the licences of the open-source packages it ships in `THIRD_PARTY_NOTICES.txt` (next to the program; generated at build time by `scripts/build-notices.cjs`, also `npm run notices`).

Security baseline: context isolation, sandboxed renderer, no Node integration, strict CSP, blocked navigation and pop-ups, a sender check and argument validation on every IPC call, and shell actions only on paths from the current scan. Read [docs/ROADMAP.md](docs/ROADMAP.md) for the architecture decisions and [docs/RELEASING.md](docs/RELEASING.md) for releases and updates.

## Credits

Icons: Windows’ own shell icons, drawn by Windows at runtime and never redistributed; Fluent UI System Icons by Microsoft (MIT).

## License

[MIT](LICENSE)

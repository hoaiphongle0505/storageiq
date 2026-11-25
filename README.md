# <img src="docs/assets/logo.svg" alt="" width="64" height="64" align="absmiddle"> StorageIQ

A free, open-source disk space analyzer for Windows. StorageIQ shows where your disk space went, and explains it in plain words. It scans a drive or folder and shows which folders and files use the most space, so you can decide what to clean up.

> **Status:** early development. Phase 3 (Analyzer Workspace) turns the scanner into a full workspace in the Strata look (light and dark): a ribbon with a Select menu (drives, Documents, OneDrive, recent scans, any folder), a virtualized column tree (size, allocated size, files, folders, share of the parent, last modified), a treemap pane with levels 0–5 that colours files by type and names the types in a legend, the Windows Explorer context menu on every row, and a status bar with free space and cluster size. Scans walk folders in parallel (about 1.5 to 2.5 minutes for 1.9 million files on the developer's machine). The installer offers a per-user or an all-users install, and installed copies update themselves from GitHub Releases ([how to release](docs/RELEASING.md)); code signing through SignPath is pending. Next: side views (top files, file types, file age). See the [roadmap](docs/ROADMAP.md).

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

## Deleting

Select rows in the tree and press **Delete** to send them to the Recycle Bin, or **Shift+Delete** to delete them permanently, as in File Explorer (the ribbon's **Delete** button on the Home tab does the same, and its arrow offers **Delete permanently**). Windows shows its own confirmation and progress. Selecting a drive's `$RECYCLE.BIN` folder (or your own folder in it) and pressing Delete empties that Recycle Bin instead of deleting its items one by one.

## Windows integration (Options tab)

The installed app has an **Options** tab with two switches. Both show what Windows has set (they are read from the registry each time the tab opens, and StorageIQ keeps no copy). They are disabled in `npm run dev`, so a development run never writes to the registry.

- **Show StorageIQ in Explorer's context menu** adds “Scan with StorageIQ” when you right-click a folder, a drive or the empty space inside a folder. It writes three per-user keys under `HKEY_CURRENT_USER\Software\Classes` (no administrator approval needed) and starts the app with `--scan <folder>`; if StorageIQ is already open it comes forward and scans that folder, and if a scan is running it asks first. On Windows 11 the entry sits under **Show more options** (or Shift+F10): per-user registry entries do not appear in the new top-level menu, which needs a packaged shell extension (not built yet).
- **Always start StorageIQ as administrator** sets Windows' own “Run this program as an administrator” compatibility flag for StorageIQ (the same setting as the exe's Properties, Compatibility tab), so protected folders such as the Windows folder and other users' profiles can be read. Windows asks for approval each time StorageIQ starts. While StorageIQ runs as administrator, the commands in its Explorer right-click menu run as administrator too: Delete gets no permission prompt, and Open on a program runs it as administrator. The change takes effect the next time it starts. The scanner itself never asks for elevation, and nothing in StorageIQ elevates itself. If an administrator or a policy sets the flag for all users, the box is checked and disabled.

With **Always start StorageIQ as administrator** on, every launch of StorageIQ through the shell is elevated, Explorer's “Scan with StorageIQ” included: each click shows a Windows approval prompt, and then the scan starts in the open window (both copies are elevated, so Windows delivers the request). If StorageIQ was elevated some other way while the switch is off (for example right-click, Run as administrator), or you decline the prompt, a click on “Scan with StorageIQ” does nothing: Windows does not let a normal program send messages to an elevated window (Chromium's single-instance hand-off is blocked), and the second copy exits silently. Also, Windows does not let a non-elevated Explorer drop files onto an elevated window (StorageIQ accepts no dropped files today, so nothing is lost yet). Approve a StorageIQ approval prompt only for a launch you started yourself: an elevated program accepts the same extra Chromium command-line switches as a normal one, so a shortcut someone else made could carry switches that you would then be approving with administrator rights. Uninstalling removes both settings for the current user.

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

# StorageIQ

A free, open-source disk space analyzer for Windows. StorageIQ shows where your disk space went, and explains it in plain words. It scans a drive or folder and shows which folders and files use the most space, so you can decide what to clean up.

> **Status:** early development (Phase 1, Project Foundation, complete). Phase 2a (Core Scanner) is next. See the [roadmap](docs/ROADMAP.md).

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
npm run dist         # build the Windows installer into release/<version>/
```

Notes:

- If `npm run dev` or the app crashes immediately as plain Node, your shell has `ELECTRON_RUN_AS_NODE` set. Remove it (PowerShell: `Remove-Item Env:ELECTRON_RUN_AS_NODE`).
- Run the unit tests from PowerShell or cmd, not Git Bash.

Installers are currently unsigned, so Windows SmartScreen will warn on first run.

## Architecture

- `src/main`: Electron main process (window, security policy, IPC handlers)
- `src/preload`: the only bridge to the renderer (`window.storageiq`)
- `src/renderer`: React UI (Tailwind, Zustand)
- `src/shared`: types shared by every process, including the IPC contract

Security baseline: context isolation, sandboxed renderer, no Node integration, strict CSP, blocked navigation and pop-ups, and a sender check on every IPC call. Read [docs/ROADMAP.md](docs/ROADMAP.md) for the architecture decisions.

## License

[MIT](LICENSE)

# Phase 2a final-review fix report

All items fixed in one wave. Gates (PowerShell): `npm run format:check` clean, `npm run lint` clean, `npm run typecheck` clean, `npx vitest run` 32 files / 236 tests passed (was 225), `npm run test:e2e` 13 passed / 1 skipped (unchanged skip), `npm run dist` built, `npm run test:packaged` passed ("scan: 73 files, 19 folders").

1. Locked system files (owner decision). `WalkDirent.isDirectory()` carried from the listing; on `lstat` failure a non-directory is counted via `sink.file(handle, 0)` and reported with `kind: 'file'`; `ScanError.kind: 'file' | 'folder'` added (scan-types, tree, walk). Comment notes Phase 2b reads real sizes via koffi. UnreadableList: all folders keeps "N folders couldn’t be read"; any file gives "N items couldn’t be read" (singular "1 item"). Tests: walk.test.ts (EPERM file: +1 file, 0 bytes, kind 'file'; EPERM folder: not counted, kind 'folder'), scanner-host.test.ts (done payload), tree.test.ts, ResultScreen.test.tsx (both copy variants, singular). Bug caught by E2E: destructuring `isDirectory` off a real Dirent lost `this` and hung the scan; fixed to a method call, and the fake fs Dirent now depends on `this` so unit tests guard it.
2. `finishedTree = null` on start; `lastTree()` documented "null while a scan runs". Test in scanner-host.test.ts.
3. `webContents.send` wrapped in try/catch. Test in send-event.test.ts.
4. Crash path extracted to `reloadAfterRendererCrash` (stop scan, then dialog, then reload) in render-process-gone.ts, used by window.ts. Order test in render-process-gone.test.ts.
5. `--self-test` sets userData to `<temp>\StorageIQ-self-test` first. Covered by `npm run test:packaged` (no unit test: Electron-only branch).
6. `formatDuration` returns "under 0.1 s" below 100 ms. format.test.ts cases 0, 99, 100.
7. ROADMAP: "green locally; CI on GitHub not yet run", unchecked "CI run green on GitHub" and Phase 2b locked-file size item, "Phase 1 installer: 115.7 MB", tree glyph `└─` and alignment fixed.

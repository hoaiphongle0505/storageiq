# Phase 2a — Core Scanner: Design

**Status:** design sections approved by the product owner on 2026-11-19; written spec awaiting owner review
**Inputs:** [Roadmap v2 spec](2026-11-18-roadmap-v2-research-driven-design.md) §2 "Phase 2a", [docs/ROADMAP.md](../../ROADMAP.md) "Carry-over into the Phase 2a plan"
**Out of scope:** cloud-only and hardlink accounting, Windows reconciliation line, `FindFirstFileExW` (all Phase 2b); tree view (Phase 3); largest files, explanations, CSV (Phase 4).

## 1. User-visible outcome

A compact scan screen:

1. **Pick a location.** One card per drive (label, letter, used/free bar, "USB" badge for removable drives) plus a "Choose folder…" button.
2. **Scanning.** Files, folders and bytes found so far, elapsed time, current path (middle-truncated) and a live list of the largest folders. **Cancel** is always enabled and has focus. Screen-reader progress is announced at most every 5 s.
3. **Result.** Total size, file and folder counts, scan time, top 10 folders with % bars, and a collapsible "N folders couldn't be read" list with plain-language reasons. A canceled scan is labeled "Scan canceled — partial results". Actions: "Scan again", "Choose another location".
4. **Scanner crash.** "The scan stopped unexpectedly. You can try again." with a Retry button.

"Largest folders" in 2a means the **direct children of the scanned root**, sorted by size: the top 10 plus one "Everything else" row. Ranking all folders would always put ancestors first. This list is the tree's first level, which Phase 3 reuses.

Sizes in 2a are logical file sizes (`stat.size`). Online-only OneDrive files are still counted until Phase 2b, so 2a shows no "matches Windows" claim.

## 2. Architecture

```
renderer ──invoke──▶ main ──postMessage──▶ scanner (utilityProcess)
   ▲                  │                        │ opendir + lstat, ≤16 directories in flight
   └──sendEvent(scan:progress / scan:done / scan:failed)◀──┘ snapshot ≈250 ms
```

**Data model: approach A.** The scanner process holds the whole folder tree in memory: folders only, with file sizes and counts summed into their parent folder. After the scan the child stays alive holding the tree, so Phase 3 can ask it for "children of X" through main. The renderer never holds the whole tree. Phase 4 adds a bounded top-N file heap.

Rejected:

- **B — ship the whole tree to main when the scan ends.** Large IPC payloads and memory pressure in main.
- **C — write to SQLite during the scan.** SQLite is a Phase 7 decision, and disk writes would slow the scan.

### Units

| Unit                                                | Responsibility                                                                                                                                                                                     | Depends on                           |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `src/shared/scan-types.ts`                          | `DriveInfo`, `ScanProgress`, `FolderSummary`, `ScanError`, `ScanDone`, `ScanFailed`                                                                                                                | —                                    |
| `src/worker/scanner/walk.ts`                        | Concurrent directory walk: `opendir` + one `lstat` per entry. Never follows reparse points (symlinks and junctions are counted, not entered). Never opens file contents. Honours an `AbortSignal`. | injected `fs` subset                 |
| `src/worker/scanner/tree.ts`                        | Folder nodes; bubbles size and counts up to ancestors                                                                                                                                              | —                                    |
| `src/worker/scanner/top-folders.ts`                 | Top 10 direct children of the root plus an "Everything else" row                                                                                                                                   | `tree.ts`                            |
| `src/worker/scanner/entry.ts`                       | utilityProcess entry: handles start/cancel messages, sends a snapshot about every 250 ms and a done message at the end                                                                             | the three units above                |
| `src/main/drives/`                                  | koffi: `GetLogicalDrives`, `GetDriveTypeW` (keep `DRIVE_FIXED` and `DRIVE_REMOVABLE`, drop network, CD-ROM and RAM disks), `GetVolumeInformationW` (label), `fs.statfs` (total and free)           | koffi binding behind an interface    |
| `src/main/scan/scan-service.ts`                     | Forks the worker; one scan at a time (a new start cancels the old one); relays messages to the renderer; kills the child on quit; turns an unexpected exit into `scan:failed`                      | `utilityProcess` behind an interface |
| `src/renderer/src/stores/scan-store.ts` + 3 screens | Scan state machine: `idle → scanning → done \| canceled \| failed`                                                                                                                                 | `window.storageiq`                   |

The worker is a second electron-vite `main` build input. koffi is listed in `asarUnpack` in `electron-builder.yml`.

## 3. IPC contract

| Channel       | Args → result                                                                                 | `parseArgs` rule                                        |
| ------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `drives:list` | `[]` → `DriveInfo[]` (`{ root, label, kind: 'fixed' \| 'removable', totalBytes, freeBytes }`) | no args                                                 |
| `scan:start`  | `[path: string]` → `{ scanId: string }`                                                       | string; absolute; not UNC (`\\`); an existing directory |
| `scan:cancel` | `[scanId: string]` → `void`                                                                   | string; unknown or finished IDs are a no-op             |

| Event (main → renderer) | Payload                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `scan:progress`         | `{ scanId, files, folders, bytes, currentPath, elapsedMs, topFolders: FolderSummary[] }`                                                 |
| `scan:done`             | `{ scanId, status: 'complete' \| 'canceled', files, folders, bytes, elapsedMs, topFolders, errors: ScanError[] (max 1000), errorCount }` |
| `scan:failed`           | `{ scanId, message }`                                                                                                                    |

`ScanError` is `{ path, reason: 'access-denied' \| 'path-too-long' \| 'not-found' \| 'other', code }`.

The carry-over items fold in here:

- Handler factories return `Pick<IpcHandlerMap, …>`, and the full map uses `satisfies IpcHandlerMap`.
- Every channel has a typed `parseArgs`. Invalid arguments reject with an `Error`, and the handler never runs.
- `IpcEventContract` plus `sendEvent(channel, payload)` targets only the main window's `webContents` and skips it when the window is destroyed.
- The preload exposes `onScanProgress`, `onScanDone` and `onScanFailed`, each `(cb) => unsubscribe`. The callback never receives the `IpcRendererEvent`.
- utilityProcess messages are relayed through main, never through a raw `MessagePort` to the renderer.

## 4. Error handling

- Unreadable folders (`EACCES`, `EPERM` → access-denied; `ENAMETOOLONG` → path-too-long; `ENOENT` → not-found; others → other) are recorded, and the walk continues. The list is capped at 1000 entries; `errorCount` is always exact.
- An unreadable scan root itself ends the scan as `complete` with zero totals and one error.
- Worker crash or unexpected exit leads to `scan:failed` and the crash screen. App quit kills the worker, and no event is sent.
- **`render-process-gone` policy** (carry-over 5): ignore `clean-exit` and anything during quit. Before the first successful load, keep the Phase 1 fail-fast behaviour. After it, show an error dialog "StorageIQ stopped unexpectedly" and reload the window once.
- Cancel aborts within one directory batch (target: under 500 ms on SSD).

## 5. Testing

- **Unit (Vitest):**
  - The walk over temp-dir fixtures, including a real junction (`fs.symlink(…, 'junction')` needs no admin).
  - `EACCES` and `ENAMETOOLONG` through an injected `fs`.
  - Tree bubbling, top-folders, and cancellation mid-walk.
  - Every `parseArgs`.
  - `scan-service` with a fake child process: relay, supersede, crash leading to `scan:failed`, kill on quit.
  - Drives with a fake koffi binding: type filtering, label fallback.
  - `sendEvent` skips destroyed windows.
  - The scan store and the three screens.
  - The `loadAppInfo` retry test (carry-over 6).
- **E2E (Playwright):**
  - Carry-over 1 is the first task: console and `securitypolicyviolation` listeners are attached before the first page load.
  - Stub the folder dialog via `electronApp.evaluate`, scan a generated fixture folder, and assert the totals and the top-folders list.
  - Cancel path.
  - A drive card for the system drive is visible.
  - The packaged-app check verifies that koffi loads from `app.asar.unpacked`.
- **CI** (carry-over 7): an explicit build step. CI reports renderer bundle size, installer size, idle RAM, and scan time for a generated tree of about 20,000 files. These are reported as numbers only, never gating.
- **Cosmetic** (carry-over 8): the `aria-disabled` button has no hover colour change.

## 6. Acceptance criteria

1. The user can scan any fixed or removable drive, or a chosen folder, without elevation. Network and optical drives are not listed.
2. Progress updates about every 250 ms. The UI stays responsive, and Cancel stops the scan in under 500 ms on SSD.
3. Totals for the E2E fixture match the generated tree exactly. Junctions are not followed.
4. Every unreadable folder appears with a reason, and none are skipped silently.
5. A worker crash shows the crash screen. Quitting during a scan leaves no orphan process.
6. Every IPC channel with arguments validates them; malformed calls are rejected in unit tests.
7. Carry-over items 1–8 are done. Item 9 stays scheduled for Phase 4.
8. All gates are green: format, lint, typecheck, unit, E2E, package.

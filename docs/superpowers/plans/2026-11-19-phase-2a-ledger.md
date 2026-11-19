# SDD ledger — plan: docs/superpowers/plans/2026-11-19-phase-2a-core-scanner.md

Task 1: dispatched (BASE a13f87b, haiku implementer a3cdbb15729736aee)
Task 1: minor (deferred): app.spec.ts:62-66 console/CSP check only after load, not after folder pick (plan-mandated)
Task 1: minor (deferred): launch.ts:37-39 Electron process leaks if firstWindow() throws
Task 1: minor (deferred): capture-console.cjs:20-24 whenReady().then without .catch
Task 1: minor (deferred): sentinel string duplicated in capture-console.cjs:9 and csp-listener.cjs:6
Task 1: minor (deferred): app.spec.ts:70 addScriptTag .catch swallows all errors
Task 1: note: native-picker flake not reproduced (controller ran --repeat-each 10: 10/10 pass)
Task 1: complete (commits a13f87b..8ac4634, review clean)
Task 2: dispatched (BASE 8ac4634, haiku implementer af422a8f382648c3d)
Task 2: minor (deferred): register.ts loop cast `as unknown as UntypedChannelHandler` lacks comment
Task 2: minor (deferred): send-event.ts webContents.send may throw if frame disposed after isDestroyed check
Task 2: minor (deferred): preload/subscribe.ts payload cast unchecked (main is sender)
Task 2: minor (deferred): parse-args.test.ts it.each titles unreadable for nested arrays
Task 2: note: sender trust verified by controller (register.ts:45 + index.ts:69 isTrustedIpcSender)
Task 2: complete (commits 8ac4634..185b72d, review clean)
Task 3: dispatched (BASE 185b72d, haiku implementer a27ee8601b408681f)
Task 3: minor (deferred, plan-mandated): walk.ts:123-134 try/catch wraps in-loop inspect(); sink throw misreported via sink.error vs final-batch rejects; contradicts doc comment walk.ts:68
Task 3: minor (deferred, plan-mandated): no test for "rejects if sink throws"
Task 3: minor (deferred): walk.ts:105-107,144-148 in-flight listings keep calling sink after rejection
Task 3: note: lstat reparse coverage of cloud placeholders/app-exec links -> Phase 2b
Task 3: complete (commits 185b72d..32e0744, review clean)
Task 4: dispatched (BASE 32e0744, sonnet implementer a8fa97d1b407c7d80)
Task 4: review: spec pass; Important (plan-mandated) scanner-host finishedTree overwritten by superseded scan -> owner approved fix
Task 4: minor (deferred, plan-mandated): window.ts crash dialog shown before onRendererReload cancels scan (cancel first)
Task 4: minor (deferred): scan-service exit after user cancel but before done -> scan:failed, untested/undocumented
Task 4: minor (deferred): scanner-host walk rejection uncaught -> unhandled rejection, tree lost
Task 4: minor (deferred): index.ts dispose() in before-quit permanent; vetoed quit breaks later scan:start
Task 4: minor (deferred, known limit): mapped network drive letters pass UNC rule; junction root followed
Task 4: minor (deferred): window.ts crash handling untested beyond decision fn -> Task 7 E2E
Task 4: carry to Task 7: automate "no orphan process after quit mid-scan"; carry to Task 6: ignore events with unknown scanId
Task 4: fix round 1/5 dispatched (FIX_BASE 19bd664)
Task 4: fix round 1/5 (1 addressed, 0 open; commits 19bd664..ca47c83)
Task 4: complete (commits 32e0744..ca47c83, review clean after fix)
Task 5: dispatched (BASE ca47c83, sonnet implementer ad3ba0a66fde24a68)
Task 5: minor (deferred, plan-mandated): self-test may touch shared userData, no lock -> point userData at temp or reword
Task 5: minor (deferred, plan-mandated): self-test scanOnce no in-process timeout; unchecked ScanDone|ScanFailed cast
Task 5: minor (deferred, plan-mandated): list-drives no per-drive statfs timeout; sync label call on main thread (stalled USB could block list)
Task 5: minor (deferred, plan-mandated): self-test exit 12 nearly unreachable when packaged
Task 5: minor (deferred, plan-mandated): no test asserting real koffi label
Task 5: minor (deferred, documented): unpacked koffi.node outside ASAR integrity; covered by code signing (release checklist)
Task 5: note: fuse block verified intact by controller (electron-builder.yml:16-22)
Task 5: complete (commits ca47c83..8ba4e38, review clean)
Task 6: dispatched (BASE 8ba4e38, sonnet implementer ae8e1a4cc9179283c)
Task 6: review: spec pass; Important: skipped Step 1 guidance + impeccable detect + DESIGN.md entries (plan-mandated steps)
Task 6: minor (deferred, plan-mandated): PickLocationScreen empty drive list while loading/zero drives, no feedback
Task 6: minor (deferred, plan-mandated): Button.test asserts class strings not hover behaviour
Task 6: minor (deferred, plan-mandated): exact byte counts are mouse-only title tooltips (ResultScreen Stat, FolderBars)
Task 6: minor (deferred, plan-mandated): scan-store cancelScan swallows api failure silently
Task 6: note: theme tokens verified present in global.css by controller
Task 6: fix round 1/5 dispatched (FIX_BASE 2444d23; includes reflow grid-cols-4 minor)
Task 6: fix round 1/5 (2 addressed; detect gap closed by controller: impeccable detect --json src/renderer -> []; by-eye check -> controller screenshots after Task 7; commits 2444d23..f298c55)
Task 6: complete (commits 8ba4e38..f298c55, review clean after fix)
Task 7: dispatched (BASE f298c55, sonnet implementer a79e59c63a519c1a7)
Controller by-eye check (screenshots light/dark, pick + result of C:\StorageIQ\src): OK. minor (deferred): scan time shows '0.0 s' for sub-100 ms scans
Task 7: minor (deferred, plan-mandated): scan.spec.ts cancel 2 s gate includes Playwright overhead, CI flake risk
Task 7: minor (deferred): scan.spec.ts pid liveness polling could hit reused pid
Task 7: minor (deferred, partly plan-mandated): ROADMAP stale Phase 1 "Installer 115.7 MB"/"CI unverified" lines; Outcome omits open "CI green on GitHub"
Task 7: minor (deferred, plan-mandated): ROADMAP folder-tree last child uses ├─, indent misaligned
Task 7: minor (deferred): metrics.spec.ts cwd-relative metrics file could be stale locally
Task 7: complete (commits f298c55..918f17e, review clean)
Final review: ready to merge with fixes; 7 items (1 Important: system files EPERM reported as folders + dropped from totals -> owner chose count at 0 bytes + kind + "items" copy); 28 minors stay deferred per final-review.md triage
Final fix wave: dispatched (FIX_BASE 918f17e, sonnet a25e61d0211711ed5)
Final fix wave: re-review 7/7 addressed, no new Critical/Important (commits 918f17e..6325f83)
Final: parked — heading wording based on listed errors only (cap 1000) — ruling: >1000 unreadable with files beyond cap is edge case, Phase 2b reconciliation revisits
Final: parked — vanished file (ENOENT on lstat) counted as 0-byte file — ruling: harmless, file existed at listing time

## Final review triage

# Phase 2a — Core Scanner: final whole-branch review

**Range:** `a13f87b..918f17e` (9 commits), branch `phase-2a-core-scanner`
**Governing spec:** `docs/superpowers/specs/2026-11-19-phase-2a-core-scanner-design.md`
**Reviewer checks run locally (PowerShell):** `npm run typecheck` ✓, `npm run lint` ✓, `npm run format:check` ✓, `npx vitest run` ✓ (32 files, 225 tests). E2E and packaging were not re-run (ledger records them green in Task 7).
**Empirical probe:** `lstat` on every entry of `C:\` using Electron 45's own Node (24.22.3, libuv 1.52.1, `ELECTRON_RUN_AS_NODE=1`). The probe produced Finding 1.

## Strengths

- **Clean contract chain.** The chain runs `IpcContract` / `IpcEventContract` → `satisfies IpcHandlerMap` → `Pick<…>` factories → typed preload. The renderer store matches the shared types without casts, except at the one deliberate boundary (`subscribe.ts`).
- **Security baseline intact:**
  - `window-options.ts`, `security/*` and `index.html` are untouched (sandbox, contextIsolation and nodeIntegration are unchanged).
  - Every channel is wrapped by the trusted-sender check (`register.ts:45`), then `parseArgs`, then the handler.
  - `scan:start` rejects UNC paths, non-absolute paths and non-directories, and normalizes the path.
  - `sendEvent` targets only the main window.
  - The preload never forwards the `IpcRendererEvent`.
  - utilityProcess messages are relayed by value; `event.ports` is never touched.
  - The fuse block is unchanged. Only `asarUnpack` and `npmRebuild` were added.
- **Lifecycle design is sound:**
  - Scan IDs are checked at three layers: worker `latestScanId`, main `activeScanId`, renderer `scanId`. Events that arrive before the ID is known are buffered.
  - Supersede, crash and quit each have a single owner (`scan-service.ts`).
  - E2E covers the scanner crash, the absence of orphan processes after quit, cancel latency and exact totals, including a real junction.
- **Snapshot cost is small.** Each 250 ms tick does an O(1) totals read plus a sort of the root's direct children only. `[...errors]` is capped at 1000. Progress payloads are a few KB. The renderer never holds the tree.
- **UI copy matches spec §1.** "Choose folder…", "Scan canceled — partial results", "N folders couldn’t be read", "The scan stopped unexpectedly. You can try again." with Retry, "Scan again", "Choose another location". The USB badge is present and the announcement is throttled to 5 s.

## Findings to fix before merge

1. **Important — system paging files are reported as unreadable _folders_ on every system-drive scan, and their size is silently missing.**
   - **Where:** `src/worker/scanner/walk.ts:91-95`, `src/worker/scanner/tree.ts:96-101`, `src/renderer/src/components/UnreadableList.tsx:26-28`.
   - **Problem:** I verified this with Electron 45's Node. `lstat` returns `EPERM` for `C:\pagefile.sys`, `C:\hiberfil.sys`, `C:\swapfile.sys` and `C:\DumpStack.log.tmp`. As a result, every scan of `C:\`:
     - (a) shows "4 folders couldn’t be read — Windows didn’t give StorageIQ permission to open it." These are files, not folders, and the message alarms a non-expert about their own system files.
     - (b) leaves them out of the "Files" count. Their size (typically 4–40 GB) is also missing, with nothing to say so.

     This is the headline use case (scanning C:). Per-task E2E fixtures and the by-eye check (which scanned `C:\StorageIQ\src`) could not see it.

   - **Fix (2a scope, no `FindFirstFileExW`):**
     - Keep the entry type that `fs.opendir` already provides. Node's `Dirent.isDirectory()` comes from the directory listing, so no handle is opened. Add `isDirectory(): boolean` to `WalkDirent` and carry it into `inspect`.
     - When `lstat` fails on an entry that is **not** a directory, record the file with `sink.file(handle, 0)` so it is counted, and report the error with a kind: add `kind: 'folder' | 'file'` to `ScanError` in `scan-types.ts:29-34`.
     - In `UnreadableList`, title the disclosure from the kinds: "N folders couldn’t be read" when all are folders, otherwise "N items couldn’t be read". The second string is new copy and needs owner approval because Task 6 strings are frozen.
     - Add a walk unit test with a fake `fs` in which `lstat` rejects `EPERM` for a file entry.
     - Add a Phase 2b roadmap item: read sizes of locked system files from the directory listing (`FindFirstFileExW`) so totals include them.

2. **Minor (cheap; Phase 3 builds on it) — a rescan holds two full trees in the scanner.**
   - **Where:** `src/worker/scanner/scanner-host.ts:84-85`.
   - **Problem:** `finishedTree` keeps the previous scan's tree until the new scan finishes. On a drive with about 1M folders that is roughly 150–250 MB of `FolderNode`s, retained for no consumer during the whole rescan, which doubles peak memory. It also leaves Phase 3's `lastTree()` meaning ambiguous mid-scan.
   - **Fix:** set `finishedTree = null` next to `latestScanId = request.scanId` in `handle()`, and document `lastTree()` as "null while a scan runs". Add a one-line test to `scanner-host.test.ts`.

3. **Minor (cheap; protects the main process) — `sendEvent` can throw from inside the scanner message listener.**
   - **Where:** `src/main/ipc/send-event.ts:18-19` (ledger T2 minor).
   - **Problem:** `webContents.send` is called from `child.on('message')`. It can run while the renderer is crashed or reloading, which is exactly the `render-process-gone` → reload path. If it throws because the frame was disposed, the exception is uncaught in main and Electron shows its raw "A JavaScript error occurred in the main process" dialog.
   - **Fix:** wrap the call in `try { window.webContents.send(channel, payload) } catch { /* window going away: drop */ }`, and add a `send-event.test.ts` case where `send` throws.

4. **Minor (cheap; ordering is wrong) — the crash dialog is shown before the running scan is canceled.**
   - **Where:** `src/main/window.ts:69-72` (ledger T4 minor).
   - **Problem:** `dialog.showErrorBox` is synchronous and modal. While it is open, the scanner keeps walking the disk, yet the dialog already says "Any scan in progress was stopped."
   - **Fix:** call `config.onRendererReload?.()` before `dialog.showErrorBox(…)`.

5. **Minor (cheap) — the `--self-test` run shares the live app's userData without the single-instance lock.**
   - **Where:** `src/main/index.ts:102-104` (ledger T5 minor).
   - **Problem:** In a packaged build, `--self-test` skips `requestSingleInstanceLock` but still uses `%APPDATA%\StorageIQ`. Chromium initializes the default session there while a user instance may be running, and concurrent use of one userData directory is unsupported.
   - **Fix:** first line of the self-test branch: `app.setPath('userData', path.join(app.getPath('temp'), 'StorageIQ-self-test'))`.

6. **Minor (cheap; user-visible) — fast scans report "Scan time 0.0 s".**
   - **Where:** `src/renderer/src/lib/format.ts:20-21` (controller by-eye minor).
   - **Fix:** `if (ms < 100) return 'under 0.1 s'` (typographic punctuation is not needed), and add a case to `format.test.ts`.

7. **Minor (docs accuracy) — stale lines in `docs/ROADMAP.md`.**
   - **Where:** `docs/ROADMAP.md:159`, `:186`, `:92-94` (ledger T7 minors).
   - **Fix:**
     - Line 159: say "all automated gates are green locally; CI on GitHub not yet run (no remote)", and add an unchecked "CI run green on GitHub" item to the Phase 2a outcome.
     - Line 186: label "Installer: 115.7 MB" as the Phase 1 figure, or move it to the Phase 1 section.
     - Lines 92-94: fix the folder-tree glyphs so the last `main/` child uses `└─` and the columns align.

## Other observations (no action in 2a)

- **Plain renderer reloads don't cancel the scan.** A dev-only Ctrl+R, or any reload that is not after a crash, leaves the worker scanning to completion. Its events are dropped correctly because the renderer is idle. Packaged builds have no menu, so this cannot happen there.
- **"Everything else" can be the only row.** A folder that has only files shows a single "Everything else — 100%" row instead of "This location has no folders." The tree view in Phase 3 supersedes this list.
- **The status bar shows a stale location.** After "Choose another location" it still shows the last scanned target. This is harmless, and arguably useful.
- **Scanner memory scales with folder count.** At roughly 150–250 B per folder, a 1M-folder drive needs about 150–250 MB in the scanner process, well under V8's heap limit. Main and the renderer stay flat. Worth measuring in Phase 2b's metrics run with a 1M-folder synthetic tree.
- **Self-test exit 12 _is_ reachable.** Electron can load a `.node` from inside the asar by extracting it to a temp folder, so koffi would load and `listDrives` would succeed even without `asarUnpack`. The `fileExists` check is what catches a missing unpack.

## Triage of every deferred minor in the ledger

| #   | Ledger item                                                                    | Decision                         | Reason                                                                                                                                        |
| --- | ------------------------------------------------------------------------------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | T1 app.spec console/CSP check only after load, not after folder pick           | Defer                            | `scan.spec` asserts `consoleErrors` after a full scan, which covers the gap.                                                                  |
| 2   | T1 launch.ts Electron leaks if `firstWindow()` throws                          | Defer                            | Test infrastructure only; CI runners are ephemeral.                                                                                           |
| 3   | T1 capture-console.cjs `whenReady().then` without `.catch`                     | Defer                            | Test-only preload; `whenReady` does not reject in practice.                                                                                   |
| 4   | T1 sentinel string duplicated in two .cjs files                                | Defer                            | Cosmetic duplication in test support.                                                                                                         |
| 5   | T1 app.spec `addScriptTag` `.catch` swallows all errors                        | Defer                            | The assertion that follows (the CSP violation is recorded) still fails if the injection never happened.                                       |
| 6   | T2 register.ts cast lacks comment                                              | Defer                            | The cast is local and covered by `register.test.ts`; documentation only.                                                                      |
| 7   | T2 send-event `webContents.send` may throw after the `isDestroyed` check       | **Fix before merge** (Finding 3) | Cheap, and it fires on the renderer-crash path, where an uncaught throw shows a raw main-process error dialog.                                |
| 8   | T2 preload/subscribe payload cast unchecked                                    | Defer                            | Main is the only sender and is trusted; validating would duplicate the types.                                                                 |
| 9   | T2 parse-args.test `it.each` titles unreadable                                 | Defer                            | Test readability only.                                                                                                                        |
| 10  | T3 walk.ts in-loop try/catch misreports a sink throw                           | Defer                            | The real sink (`tree.ts`) cannot throw. Revisit when Phase 2b reworks the walk for `FindFirstFileExW`.                                        |
| 11  | T3 no test for "rejects if sink throws"                                        | Defer                            | Same as #10; unreachable with the real sink.                                                                                                  |
| 12  | T3 in-flight listings keep calling the sink after rejection                    | Defer                            | Same as #10.                                                                                                                                  |
| 13  | T4 crash dialog shown before `onRendererReload` cancels the scan               | **Fix before merge** (Finding 4) | A one-line swap; the dialog's "scan was stopped" copy is false while it is open.                                                              |
| 14  | T4 scan-service: exit after a user cancel but before done → `scan:failed`      | Defer                            | The process really died, so the crash screen is honest; add a test in 2b.                                                                     |
| 15  | T4 scanner-host walk rejection uncaught → unhandled rejection                  | Defer                            | Unreachable with the real sink. If it ever happens, the process exits and main turns that into `scan:failed`, which is a safe outcome.        |
| 16  | T4 `dispose()` in `before-quit` is permanent; a vetoed quit breaks later scans | Defer                            | 2a has no veto path: no `beforeunload` and no `will-quit` `preventDefault`. Revisit if one is added.                                          |
| 17  | T4 mapped network drive letters pass the UNC rule; a junction root is followed | Defer                            | Meets the spec rule (UNC refused; network drives not listed). A `GetDriveTypeW` check in `parseScanRoot` belongs with the 2b drive work.      |
| 18  | T4 window.ts crash handling untested beyond the decision function              | Defer                            | Task 7 added the scanner-crash E2E but not a renderer-crash one. Add `forcefullyCrashRenderer` E2E in 2b, together with Finding 4's ordering. |
| 19  | T5 self-test may touch the shared userData with no lock                        | **Fix before merge** (Finding 5) | One line, for a switch that ships in the product.                                                                                             |
| 20  | T5 self-test `scanOnce` has no in-process timeout; unchecked cast              | Defer                            | `check-packaged-app.mjs` has a 120 s `spawnSync` timeout; the cast is constrained by the event channel.                                       |
| 21  | T5 list-drives: no per-drive statfs timeout; sync label call on main thread    | Defer                            | A real but rare stall (a spun-down USB disk). Move drive queries off the main thread in 2b and record it there.                               |
| 22  | T5 self-test exit 12 nearly unreachable when packaged                          | Defer                            | It is reachable (Electron extracts `.node` files from the asar), so the check has value as is.                                                |
| 23  | T5 no test asserting the real koffi label                                      | Defer                            | The self-test proves koffi loads; asserting a label depends on the machine.                                                                   |
| 24  | T5 unpacked koffi.node outside ASAR integrity                                  | Defer                            | Documented; mitigated by code signing on the release checklist.                                                                               |
| 25  | T6 PickLocationScreen shows no feedback while drives load or when zero         | Defer                            | Loading normally takes under 100 ms; zero fixed drives cannot happen on a running Windows. Pair with #21 in 2b.                               |
| 26  | T6 Button.test asserts class strings, not hover behaviour                      | Defer                            | `scan.spec.ts` "busy button keeps its colour on hover" covers the behaviour end to end.                                                       |
| 27  | T6 exact byte counts are mouse-only `title` tooltips                           | Defer                            | The formatted size is accessible; exact bytes are a nicety, so revisit in Phase 3 with row details.                                           |
| 28  | T6 scan-store `cancelScan` swallows API failure silently                       | Defer                            | The scan continues and its done or failed event still resolves the UI; documented in code.                                                    |
| 29  | Controller: scan time shows "0.0 s" for sub-100 ms scans                       | **Fix before merge** (Finding 6) | One line; a consumer reads "0.0 s" as a bug.                                                                                                  |
| 30  | T7 cancel 2 s gate includes Playwright overhead (CI flake risk)                | Defer                            | The measured latency is 57 ms against a 2 s gate, which is ample margin.                                                                      |
| 31  | T7 pid liveness polling could hit a reused pid                                 | Defer                            | PID reuse within 5 s is very unlikely; at worst it causes a false failure, never a false pass.                                                |
| 32  | T7 ROADMAP stale Phase 1 lines; Outcome omits "CI green on GitHub"             | **Fix before merge** (Finding 7) | The roadmap is the project's source of truth, and "all gates green" overstates without CI.                                                    |
| 33  | T7 ROADMAP folder-tree glyph and indent misaligned                             | **Fix before merge** (Finding 7) | Same file and same edit as #32; costs nothing.                                                                                                |
| 34  | T7 metrics.spec cwd-relative metrics file could be stale locally               | Defer                            | Report-only; CI runs in a clean checkout.                                                                                                     |

**Counts:** 34 ledger minors. 6 marked fix before merge (#7, #13, #19, #29, #32, #33), mapping to Findings 3–7. 28 deferred. Findings 1 and 2 are new in this review.

## Acceptance criteria (spec §6)

| AC                                                                                              | Status                                                                                                                                   |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Scan fixed/removable drives or a folder, no elevation; network and optical drives not listed | Met (`list-drives.ts` filter; NSIS `allowElevation: false`; no manifest change). Finding 1 affects the quality of a system-drive result. |
| 2. Progress about every 250 ms; responsive; cancel < 500 ms on SSD                              | Met (independent 250 ms ticker; cancel is checked per entry; 57 ms measured).                                                            |
| 3. Exact E2E totals; junctions not followed                                                     | Met (`e2e/scan.spec.ts` with a real junction in the fixture).                                                                            |
| 4. Every unreadable folder listed with a reason                                                 | Met for folders. Finding 1: unreadable _files_ are also listed, but labelled as folders and left out of the counts.                      |
| 5. Crash screen; no orphan process after quit                                                   | Met (two E2E tests).                                                                                                                     |
| 6. Every argument-taking channel validated; malformed calls rejected in unit tests              | Met (`parse-args`, `scan-handlers`, `register` tests).                                                                                   |
| 7. Carry-overs 1–8 done; item 9 kept for Phase 4                                                | Met (ROADMAP records each one).                                                                                                          |
| 8. All gates green                                                                              | Met locally. CI on GitHub has not run (no remote); Finding 7 records that honestly.                                                      |

## Verdict

**Ready to merge: With fixes.** The architecture, contracts, security baseline and lifecycle handling are solid, and every acceptance criterion is met. Finding 1 is a real defect that every user scanning their system drive will see: system files listed as unreadable "folders", and missing from the counts. Fix its labelling and counting before merge (with owner approval of the "items" copy) and log the size gap for Phase 2b. Findings 2–7 are small, cheap fixes that can go into a single fix round.

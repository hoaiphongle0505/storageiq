# SDD ledger — plan: docs/superpowers/plans/2026-11-18-phase-1-project-foundation.md

Task 1: implementer done (commit 831638a); concern: vite ESM-as-CJS warning on vitest.config.ts
Task 1: review — spec ✅, quality changes requested (Important: vite ESM warning; Minor x3 trusted-url robustness; @types/node major). User approved plan amendment; commit d75927d
Task 1: fix round 1/5 (5 addressed, 0 open; commits d75927d..72cab5a)
Task 1: complete (commits f8c0af1..72cab5a, review clean; controller verified 10/10 + typecheck/lint/format in PowerShell)
Task 1: minor (deferred): vitest fails "failed to find current suite" when run from Git Bash cwd /c/StorageIQ (drive-path casing loads setup.ts twice); passes in PowerShell/cmd. Consider vitest root normalization.
Task 2: implementer done (commit 6fe6165), 20/20 tests
Task 2: review (opus) — spec ✅, changes requested: Important #1 hidden-process on load fail (plan-mandated); minors 2-9. User approved fixing all now except #5 (IPC arg validation → Phase 2).
Task 2: fix round 1/5 (8 addressed, 0 open; commits 0da7b45..6618bdd)
Task 2: complete (commits d7d23eb..6618bdd, review clean; controller verified 29/29 + gates)
Task 2: minor (deferred): render-process-gone treated fatal for any reason incl. clean-exit/killed during shutdown -> possible spurious dialog while quitting
Task 2: minor (deferred): initial load rejection with ERR_ABORTED triggers failStartup (load.catch does not filter -3)
Task 2: minor (deferred): IPC argument runtime validation -> Phase 2 (first channel with args)
Task 3: implementer done (commit 34f1241), 37/37
Task 3: complete (commits 6618bdd..34f1241, review clean)
Task 3: minor (deferred): no test for loadAppInfo retry after error (reject once then resolve -> ready, 2 calls)
Task 3: minor (deferred): no test that a new chooseFolder clears errorMessage
Task 3: minor (deferred): app-store-context binding untested; Zustand 5 selectors must return primitives or use useShallow
Task 3: minor (deferred): loadAppInfo second concurrent call returns before data arrives; consumers read state, not the promise
Task 4: implementer done (commit 8b18f4d), 40/40, detector clean
Task 4: complete (commits 34f1241..8b18f4d, review clean; controller verified 40/40 + gates + WINDOW_BACKGROUND match; manual visual check pending with user)
Task 4: minor (deferred): disabled Choose-folder button drops keyboard focus while picker open (consider aria-disabled)
Task 4: minor (deferred): App.test getAllByText(path) length 2 is brittle; scope with within(contentinfo)
Task 4: minor (deferred): focus after Dismiss falls to body; return focus to Choose folder
Task 4: minor (deferred): renderer bundle 572 kB; dev shells may have ELECTRON_RUN_AS_NODE=1 set (README note)
Task 5: implementer done (commit b831af2), e2e 3/3
Task 5: complete (commits 8b18f4d..b831af2, review clean)
Task 5: minor (deferred): e2e module-level app not reset; failed launch -> afterEach closes stale app (use app?.close + reset)
Task 5: minor (deferred): assert exact exposed keys of window.storageiq
Task 5: minor (deferred): getByText(StorageIQ version) substring match could become ambiguous
Task 6: implementer done (commit e5409f9); controller verified installer 115.7 MB + asar = out/ + package.json only
Task 6: complete (commits b831af2..e5409f9, review clean; manual install check pending with user)
Task 6: minor (deferred): uninstall keeps %APPDATA%\StorageIQ (deleteAppDataOnUninstall default false) — document or decide at release
Task 6: minor (deferred): installer 115.7 MB, unsigned, default icon — release checklist
Task 7: implementer done (commit 171c6ab), all 6 gates green
Task 7: minor (deferred): ROADMAP table has duplicated header row (introduced by controller roadmap-v2 edit)
Task 7: complete (commits e5409f9..171c6ab, review clean)
Task 7: minor (deferred): CI packaging step coupled to e2e build output (plan-mandated)
Task 7: minor (deferred): CI does not upload test-results traces; README omits format:check/build and headed-e2e note
Task 7: minor (deferred): ROADMAP vision names a competitor; Outcome omits CI Node22 vs Electron Node24
Final review (opus, f8c0af1..171c6ab): no Critical; Important I1 fuses, I2 harden-web-contents untested, I3 shared userData/lock dev vs installed. Verdict: not ready until fix wave + CI on GitHub + owner manual checks.
Final: parked — M2 clipboard permission -> Phase 4 (copy via main clipboard IPC)
Final: parked — M6 unused @renderer alias / AppInfo fields kept (Phase 2+ use, diagnostics)
Final: parked — M7 allowToChangeInstallationDirectory w/o elevation -> release checklist
Final: deferred -> Phase 2a plan: readiness a (handler factories Pick<>), b (typed per-channel parseArgs), c (IpcEventContract, sendEvent, preload onX unsubscribe, relay utilityProcess via main, kill child on quit, worker as 2nd main input); render-process-gone policy; loadAppInfo retry test; bundle size in CI; explicit CI build step
Final: dropped — Git Bash vitest casing (README documents); ERR_ABORTED filter (quitting is required behaviour); concurrent loadAppInfo; test-results upload; ROADMAP naming a competitor (internal)
Final fix wave: dispatched (findings file final-fix-findings.md), base 171c6ab
Final fix wave: implementer done (commits 99905e7..9f61766), 49 unit + 4 e2e, fuses verified
Final fix wave: re-review — all 20 addressed; residual parked — M3 e2e listeners attach after first load — ruling: real, not load-bearing, scheduled as Phase 2a task 1 (ROADMAP carry-over)
Phase 1 code complete at 2e9a39d; pending: CI on GitHub, owner manual checks

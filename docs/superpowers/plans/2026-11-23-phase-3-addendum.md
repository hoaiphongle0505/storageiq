# Phase 3 Addendum — Stale rows, fast walk, installer and auto-update

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. This addendum extends [the Phase 3 plan](2026-11-19-phase-3-workspace.md); its Global Constraints apply unchanged (strict TypeScript, no `any`, Prettier style, explicit `git add` paths, one commit per task, conventional-commit messages with **no** AI attribution trailer, no competitor named anywhere, run Vitest from PowerShell, unset `ELECTRON_RUN_AS_NODE` before launching Electron).

**State when this addendum starts:** branch `phase-3-workspace`, HEAD `a1df080`, Tasks 1–8 done. Task 9 (workspace E2E, CI perf gate, docs, checks by eye) runs **after** this addendum and absorbs the manual checks listed at the end of Task 10.

**Order:** 8a, 8b, 8c, 10, then 9. Tasks 8a and 8b touch different files and can be built in either order. Task 8b changes `scanner-host.ts` wiring and `entry.ts`; Task 8c is written separately (see its marker). Task 8d (parallel walkers) depends on 8b and runs right after it, before or after 8c.

**Tiers:** every task here is `standard` (Win32/koffi, timers, packaging). Specs below are prose with exact names, constants and test cases; the implementer writes the code and the tests from them. Short code appears only where a value is subtle.

**Gate that every task ends with** (PowerShell, from `C:\StorageIQ`):

```powershell
npm run format
npm run format:check
npm run lint
npm run typecheck
npx vitest run
```

Expected: all green. Task 8b additionally runs `npm run test:perf`. Tasks 8b and 10 additionally run `npm run dist` then `npm run test:packaged`.

---

### Task 8a: Stale rows after a shell delete

**Implementer tier:** standard

**Root cause (confirmed):** an Explorer delete can wait on the user’s confirmation dialog and then on the Recycle Bin move. `InvokeCommand` returns before that finishes. `refreshAfterShell` (`src/main/ipc/shell-handlers.ts`) rescans the folder at once and again after 1.5 s; both rescans run before the file is gone, so its row stays. The second `.catch(() => undefined)` hides any refresh failure. A second right-click on the stale row then fails with `SHParseDisplayName failed (0x80070002)` (file not found) because the shell cannot parse a path that no longer exists, and the user sees a raw error banner.

**Files:**

- Create: `src/main/ipc/item-watcher.ts`, `src/main/ipc/item-watcher.test.ts`
- Modify: `src/main/shell-menu/win-shell-menu.ts`, `src/main/ipc/shell-handlers.ts`, `src/main/ipc/shell-handlers.test.ts`, `src/shared/ipc-contract.ts`, `src/renderer/src/stores/workspace-store.ts`, `src/renderer/src/stores/workspace-store.test.ts`, `src/main/index.ts`

**Interfaces (all new names exact):**

- `src/main/shell-menu/win-shell-menu.ts` exports `class ShellMenuError extends Error { readonly hresult: number; readonly step: string }` (constructor `(step: string, hresult: number)`; `hresult` stored as an unsigned 32-bit number, so `0x80070002` is `2147942402`; message `${step} failed (0x<hex>)`, same text as today; `name = 'ShellMenuError'`). Also exports `SHELL_PATH_GONE_HRESULTS: readonly number[] = [0x80070002, 0x80070003]` (ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND as HRESULTs) and `isShellPathGone(error: unknown): boolean` (true for a `ShellMenuError` whose `hresult` is in that list).
- `src/main/ipc/item-watcher.ts` exports:
  - `ITEM_POLL_INTERVAL_MS = 500`, `ITEM_WATCH_TIMEOUT_MS = 15_000`
  - `interface ItemWatcherDeps { pathExists(target: string): Promise<boolean>; schedule(callback: () => void, ms: number): () => void  /* returns a cancel function */; now(): number }`
  - `interface ItemWatcher { watch(request: { key: string; itemPath: string; isCurrent(): boolean; onSettled(reason: 'gone' | 'timeout'): void }): void; cancelAll(): void; readonly active: number }`
  - `createItemWatcher(deps: ItemWatcherDeps): ItemWatcher`
- `ContextMenuOutcome` in `src/shared/ipc-contract.ts` gains the variant `{ kind: 'gone' }`.
- `ShellHandlerDeps` in `shell-handlers.ts` changes: remove `later`; add `pathExists(target: string): Promise<boolean>` (production: `fs.promises.lstat` resolves true, rejects with `ENOENT`/`ENOTDIR` resolves false, any other error resolves true so a permission problem never reports a live item as gone), `watcher: ItemWatcher`, and `warn(message: string, error: unknown): void` (production: `console.warn`). Keep `SECOND_REFRESH_DELAY_MS = 1500`, now used only for verbs that leave the item in place (rule 5).

**Behaviours:**

1. **Typed error.** Every `throw new Error(\`<step> failed (0x…)\`)`in`win-shell-menu.ts` `build()` that carries an HRESULT (`SHParseDisplayName`, `SHBindToParent`, `GetUIObjectOf`, `QueryContextMenu`, `InvokeCommand`) becomes `throw new ShellMenuError('<step>', hr >>> 0)`. Non-HRESULT failures (`CreatePopupMenu`, `AppendMenuW`, `SetWindowSubclass`) stay plain `Error`. The text shown for any other failure does not change.
2. **Gone pre-check.** In the `shell:context-menu` handler, after `resolveScanNode` and **before** `showShellMenu`, call `deps.pathExists(details.path)`. When it is false, run the gone path (rule 4) and return `{ kind: 'gone' }` without showing a menu.
3. **Gone from the shell.** Wrap the `showShellMenu` call: when it throws and `isShellPathGone(error)` is true, run the gone path and return `{ kind: 'gone' }`. Any other error is rethrown unchanged.
4. **Gone path.** Refresh the containing folder with `refreshFolder(scanId, target)` where `target` is computed exactly as `refreshAfterShell` computes it today (the folder row’s parent, or the file’s folder; the root target goes through the existing full-rescan path inside `refreshFolder`). A refresh failure is logged (rule 7) and does not change the outcome.
5. **After a file-changing verb** (`choice.kind === 'shell'` and `choice.changed`). The item-leaving verbs are `delete`, `cut`, `rename` and `null` (unknown). For them:
   1. Refresh the folder immediately (kept), except when `target` is the root: skip the immediate refresh (a root refresh is a full scan and a second one must never be queued); the watcher's single settled refresh covers it.
   2. Then `watcher.watch({ key: scanId + ':' + details.row.id, itemPath: details.path, isCurrent: () => scanService.currentScan()?.scanId === scanId, onSettled })`.
   3. `onSettled` refreshes the folder once (`'gone'` or `'timeout'` alike).

   For any other changing verb (`paste`, `link`, `newitem`, …) the item stays where it is, so keep today's behaviour: refresh now and once more after `SECOND_REFRESH_DELAY_MS` (skipped for the root target, as before). The delayed refresh goes through `watcher.later({ key, isCurrent, run, ms })`, a cancellable one-shot timer that `cancelAll()` also cancels and that does not run when `isCurrent()` is false. Add `later(request: { key: string; isCurrent(): boolean; run(): void; ms: number }): void` to `ItemWatcher`.

6. **Watcher rules** (`item-watcher.ts`): a `watch` starts with an immediate `pathExists` check, then re-checks every `ITEM_POLL_INTERVAL_MS`; it settles with `'gone'` the first time the item does not exist, or with `'timeout'` when `now()` minus the start time reaches `ITEM_WATCH_TIMEOUT_MS` while the item still exists. It settles exactly once and then removes itself. Before each poll it calls `isCurrent()`; when that is false (a new scan started) it cancels silently, without `onSettled`. A second `watch` with the same `key` replaces the first (the first is cancelled silently). `cancelAll()` cancels every timer and every `later`; after it, `active` is 0 and nothing fires. At most one timer exists per watch; there are no unbounded timers. A `pathExists` rejection counts as "exists".
7. **Logged failures.** Every `refreshFolder` call made by `shell-handlers.ts` that is not awaited by the caller (immediate, watcher-settled, delayed) ends with `.catch((error) => deps.warn('Refresh after shell command failed', error))`. No `.catch(() => undefined)` remains in the file.
8. **Wiring (`src/main/index.ts`).** Create one `createItemWatcher({ pathExists, schedule: (cb, ms) => { const t = setTimeout(cb, ms); return () => clearTimeout(t) }, now: Date.now })`, pass it to `createShellHandlers`, and call `watcher.cancelAll()` in the existing `before-quit` handler next to `scanService.dispose()`. Remove the old `later` wiring.
9. **Renderer.** In `workspace-store.ts` `handleOutcome`, add `kind === 'gone'` → `set({ selectedId: null, announcement: GONE_MESSAGE, banner: null })` where `GONE_MESSAGE = 'That item no longer exists. The list was refreshed.'` is exported. The existing `tree:changed` event (sent by the refresh) reloads the chunks; the store does nothing else. The message contains no error code. A failed action banner for any other error stays as today. (`announcement` is the aria-live region the store already uses for “Path copied”.)

**Tests (names are exact; fake timers and a fake `pathExists`, no real file system):**

`src/main/ipc/item-watcher.test.ts` (inject fake `schedule` that records and runs callbacks under `vi.useFakeTimers()`, or use the fake timers directly):

- `settles with gone the first time the item is missing` — `pathExists` returns true, true, false; after 0, 500, 1000 ms `onSettled` has been called once with `'gone'`, and `active` is 0.
- `settles with timeout when the item never goes away` — always true; advancing 15_000 ms calls `onSettled('timeout')` once; advancing a further 60_000 ms calls nothing more.
- `polls every 500 ms and no faster` — over 2_000 ms, `pathExists` was called 5 times (at 0, 500, 1000, 1500, 2000).
- `cancels silently when isCurrent turns false` — switch `isCurrent` to false after 1000 ms; no `onSettled`, no further `pathExists` calls, `active` 0.
- `replaces a watch with the same key` — the first watch never settles, the second settles once.
- `cancelAll stops every watch and every later callback` — two watches plus one `later`; after `cancelAll()` and 20_000 ms nothing was called and `active` is 0.
- `treats a failing pathExists as present` — rejects, then after 15_000 ms settles with `'timeout'`.
- `later runs once and honours isCurrent` — runs after `ms`; does not run when `isCurrent()` is false at that time.

`src/main/ipc/shell-handlers.test.ts` (extend `setup()` with `pathExists` (default true), a real `createItemWatcher` over fake timers, and `warn`; remove the old `later` expectations and rewrite them as below):

- `delete that completes late: the folder is refreshed after the item disappears` — verb `delete`, `changed: true`, a file row in folder `d1`; `refreshFolder` is called once at once; `pathExists` stays true for 3 polls (1500 ms), then false; after the next poll `refreshFolder` has been called a second time with the same folder id, and no timer remains (`watcher.active` 0).
- `delete that never finishes is refreshed once at the timeout` — `pathExists` always true; after 15_000 ms `refreshFolder` was called exactly twice in total (now, timeout).
- `root-level delete does not queue two full rescans` — the item’s folder is the root; no immediate refresh; exactly one `refreshFolder` call after the item is gone.
- `a verb that leaves the item in place still refreshes twice` — verb `paste`, `changed: true`; `refreshFolder` called now and again after `SECOND_REFRESH_DELAY_MS`, with `pathExists` never polled.
- `a second menu on a missing path refreshes and returns gone` — `pathExists` false; the result is `{ kind: 'gone' }`, `showShellMenu` was not called, `refreshFolder` was called once with the folder id.
- `a shell menu that reports file-not-found returns gone` — `showShellMenu` rejects with `new ShellMenuError('SHParseDisplayName', 0x80070002)`; result `{ kind: 'gone' }` and one refresh. Same for `0x80070003`.
- `any other menu error still rejects` — `new ShellMenuError('GetUIObjectOf', 0x80004005)` rejects with the same error; no refresh.
- `the watcher is cancelled when a new scan starts` — start a delete watch, then make `fake.service.currentScan()` return another scan id; advance 20_000 ms: no second refresh, `watcher.active` 0.
- `refresh failures are logged, not swallowed` — `refreshFolder` rejects; `warn` is called with `'Refresh after shell command failed'` and the error; the handler still returns its outcome.
- Keep the existing tests for open, copy, new folder and refreshed outcomes unchanged.

`src/main/shell-menu` (add one test file `win-shell-menu.errors.test.ts`, pure, no koffi): `ShellMenuError` carries `hresult` as unsigned (`new ShellMenuError('SHParseDisplayName', 0x80070002 | 0).hresult === 0x80070002` — pass the signed 32-bit form too), its message is `SHParseDisplayName failed (0x80070002)`, and `isShellPathGone` is true for the two codes, false for `0x80004005`, false for a plain `Error`, false for `undefined`.

`src/renderer/src/stores/workspace-store.test.ts`: `gone outcome clears the selection and announces it` — `showContextMenu` resolves `{ kind: 'gone' }`; afterwards `selectedId` is `null`, `announcement` equals `GONE_MESSAGE`, and `banner` is `null` (no error banner, no code in the text; assert the text does not match `/0x/`).

- [ ] **Step 1: Write the failing tests** above (watcher first, then handlers, errors, store).
- [ ] **Step 2: Run them** — `npx vitest run src/main/ipc/item-watcher.test.ts src/main/ipc/shell-handlers.test.ts src/main/shell-menu/win-shell-menu.errors.test.ts src/renderer/src/stores/workspace-store.test.ts`. Expected: FAIL (missing modules and symbols).
- [ ] **Step 3: Implement** `ShellMenuError` and `isShellPathGone`, `item-watcher.ts`, the `ContextMenuOutcome` variant, the handler changes and the store change, then the `index.ts` wiring.
- [ ] **Step 4: Run the same tests.** Expected: PASS.
- [ ] **Step 5: Gate** (the common gate above).
- [ ] **Step 6: Manual check (record in the report, Task 9 repeats it):** `npm run dev`, scan a temp folder, right-click a file, Delete in the Explorer menu, leave the confirmation open for 10 s, confirm. The row disappears within about 1 s of the confirmation. Right-click a stale row (restore the file, scan, delete the file in Explorer outside the app, right-click its row): the text “That item no longer exists. The list was refreshed.” appears and no HRESULT is shown.
- [ ] **Step 7: Commit**

```powershell
git add src/main/ipc/item-watcher.ts src/main/ipc/item-watcher.test.ts src/main/shell-menu/win-shell-menu.ts src/main/shell-menu/win-shell-menu.errors.test.ts src/main/ipc/shell-handlers.ts src/main/ipc/shell-handlers.test.ts src/shared/ipc-contract.ts src/renderer/src/stores/workspace-store.ts src/renderer/src/stores/workspace-store.test.ts src/main/index.ts
git commit -m "fix(shell): refresh after a late delete, treat vanished items as gone, log refresh failures"
```

---

### Task 8b: Fast walk with FindFirstFileExW

**Implementer tier:** standard

**Root cause (measured):** `walk.ts` calls `lstat()` on every entry. Each `lstat` opens the file, which triggers a real-time antivirus scan, so the repo’s walk runs at 1.3–13k files/s. A single-threaded koffi `FindFirstFileExW` walk, which reads size, attributes and modification time from the directory listing without opening any file, runs at 31–63k files/s. Overlapping directory opens gives about 2.4x more on folder-dense trees. For `lstat`, concurrency above 16 makes things worse (the repo’s cap of 16 stays valid only for the legacy path, which this task removes).

**Files:**

- Create: `src/worker/scanner/win-find.ts`, `src/worker/scanner/win-find.test.ts`, `scripts/bench-walk.mjs`
- Modify: `src/worker/scanner/walk.ts`, `src/worker/scanner/walk.test.ts`, `src/worker/scanner/test/fake-walk-fs.ts`, `src/worker/scanner/scanner-host.ts`, `src/worker/scanner/scanner-host.test.ts`, `src/worker/scanner/entry.ts`, `src/renderer/src/stores/workspace-store.ts`, `src/renderer/src/stores/workspace-store.test.ts`, `src/main/self-test.ts` (only if the scan check needs more, see rule 12), `package.json` (`"bench:walk"` script), `electron-builder.yml` (comment only if needed)

**Interfaces:**

`walk.ts` (public contract kept: `WalkSink<D>`, `WalkOptions`, `walk()`, `errorCode()`, `MAX_DIRECTORIES_IN_FLIGHT`; `WalkStats` and `WalkFs` are removed):

- `interface ListedEntry { name: string; isDirectory: boolean; /** symlink or junction: counted at 0 bytes, never entered */ isLink: boolean; size: number; modifiedMs: number }`
- `interface DirectoryListing { entries: ListedEntry[]; /** Node-style code when the listing failed (completely or part-way); null when complete */ errorCode: string | null }`
- `interface DirectoryLister { list(dirPath: string): Promise<DirectoryListing> }` — never rejects for file-system errors (they come back in `errorCode`); it may reject only for a programming error.
- `WalkOptions { lister: DirectoryLister; signal: AbortSignal; concurrency?: number }` (replaces `fs`). `MAX_DIRECTORIES_IN_FLIGHT = 8` (decision in rule 5; was 16). `errorCode(error)` stays exported and unchanged.
- `ScannerHostDeps.fs: WalkFs` becomes `lister: DirectoryLister`.

`win-find.ts` exports:

- `FILETIME_EPOCH_OFFSET_MS = 11_644_473_600_000`
- `filetimeToMs(low: number, high: number): number` — `((high * 2**32 + low) / 10_000) - FILETIME_EPOCH_OFFSET_MS`, floored, never below 0 (a zero FILETIME gives 0).
- `win32ErrorToCode(error: number): string` — see rule 6.
- `findPattern(dirPath: string): string` — rule 3.
- `createWinFindLister(): Promise<DirectoryLister>` — loads koffi lazily (`await import('koffi')`, like `koffi-drive-api.ts`).
- Constants: `FIND_EX_INFO_BASIC = 1`, `FIND_EX_SEARCH_NAME_MATCH = 0`, `FIND_FIRST_EX_LARGE_FETCH = 2`, `FILE_ATTRIBUTE_DIRECTORY = 0x10`, `FILE_ATTRIBUTE_REPARSE_POINT = 0x400`, `IO_REPARSE_TAG_SYMLINK = 0xa000000c`, `IO_REPARSE_TAG_MOUNT_POINT = 0xa0000003`, `ERROR_NO_MORE_FILES = 18`, `LONG_PATH_PREFIX_AT = 248`, `FIND_DATA_SIZE = 592`.

**Behaviours:**

1. **Bindings** (kernel32, koffi): `FindFirstFileExW(const char16_t *lpFileName, int fInfoLevelId, _Out_ SIQ_FIND_DATAW *lpFindFileData, int fSearchOp, void *lpSearchFilter, uint32_t dwAdditionalFlags)`, `FindNextFileW(intptr_t hFindFile, _Out_ SIQ_FIND_DATAW *lpFindFileData)`, `FindClose(intptr_t hFindFile)`, `GetLastError()`. Declare the handle as `intptr_t` (BigInt in koffi) so `INVALID_HANDLE_VALUE` is `-1n`; if koffi 3.3.8 rejects `intptr_t` as a return type, use `void *` and compare with `koffi.address(handle) === 0xffffffffffffffffn`. `GetLastError` must be read in the **same thread** as the failed call: for an async `FindFirstFileExW`, read the error by calling a second binding on the same thread is **not** possible, so bind the whole open step as one helper (rule 4) or use `koffi.errno()`-style last-error capture; verify on a protected folder (`C:\System Volume Information`) that the reported code is 5, not 0 or a value left over from another call. Record in the report how the error code is obtained.
2. **Struct** `SIQ_FIND_DATAW` (x64, Windows layout, in this order): `dwFileAttributes: uint32`, `ftCreationTime: {low:uint32, high:uint32}`, `ftLastAccessTime: {low, high}`, `ftLastWriteTime: {low, high}`, `nFileSizeHigh: uint32`, `nFileSizeLow: uint32`, `dwReserved0: uint32`, `dwReserved1: uint32`, `cFileName: char16[260]` (koffi array of `char16_t`, decode as string with the `'String'` array hint), `cAlternateFileName: char16[14]`. Do **not** add `dwFileType`, `dwCreatorType`, `wFinderFlags` (Mac-only). The first test asserts `koffi.sizeof(struct) === FIND_DATA_SIZE` (592: 4 + 24 + 16 + 520 + 28).
3. **Search pattern** is `<dir>\*`. If `dir` already ends with `\`, do not double it (a drive root `C:\` gives `C:\*`). When the resulting pattern is 248 characters or longer, prefix it with `\\?\` (never twice; a path that already starts with `\\?\` is left alone). UNC paths are not scanned (the scan start already refuses them), so no `\\?\UNC\` form is needed; a test documents that.
4. **Async and batching (decision, justify in the file’s doc comment):** `FindFirstFileExW` is the call that blocks on the directory open (and on the antivirus scan the open triggers), so it goes through `fn.async` and is the only per-directory call that leaves the JS thread. The `FindNextFileW` loop and `FindClose` for that directory then run **synchronously** in JS, because `FIND_FIRST_EX_LARGE_FETCH` makes the first call read a big buffer and the following calls are served from it in microseconds; an async call per entry would cost a thread-pool hop per file and lose the measured 31–63k files/s. One listing call therefore returns the whole directory in one array. The benchmark (rule 9) must also run a variant with the next-loop run in batches through `FindNextFileW.async` of 256 entries; if that variant is not clearly faster on both test trees, keep the synchronous loop and say so in the report.
5. **Concurrency:** `MAX_DIRECTORIES_IN_FLIGHT` is chosen from the perf measurement: run `scripts/bench-walk.mjs` on `C:\Program Files` with `--concurrency 4`, `8`, `16` (the script takes that flag); pick the smallest value within 5% of the best, default 8. Put the three numbers in the report and in the constant’s doc comment. Directories in flight overlap only their opens, so a higher value mostly adds memory.
6. **Error mapping** (`win32ErrorToCode`): 5 (ACCESS_DENIED) and 1 (not used, falls to other) → `'EACCES'`; 2 (FILE_NOT_FOUND) and 3 (PATH_NOT_FOUND) and 53 (BAD_NETPATH) → `'ENOENT'`; 206 (FILENAME_EXCED_RANGE) → `'ENAMETOOLONG'`; 32 (SHARING_VIOLATION) and 1920 (CANT_ACCESS_FILE, the code for some reparse points) → `` `WIN32_${n}` ``; 267 (DIRECTORY, “not a directory”) → `'ENOTDIR'`; anything else → `` `WIN32_${n}` ``. `scanErrorReason` in `tree-store.ts` then yields `access-denied`, `not-found`, `path-too-long` or `other` with no change to the store. When `FindNextFileW` fails with any code other than `ERROR_NO_MORE_FILES` (18), the listing returns the entries read so far plus that error code.
7. **Per entry:** skip `.` and `..`. `isDirectory = (attrs & 0x10) !== 0`. `isLink = (attrs & 0x400) !== 0 && (reserved0 === IO_REPARSE_TAG_SYMLINK || reserved0 === IO_REPARSE_TAG_MOUNT_POINT)`. A reparse point with any other tag (cloud placeholders, deduplicated or compressed files, app execution aliases) is **not** a link: it keeps its listed size and, if a directory, is entered, exactly as the old `lstat` walk treated it (Node reports only symlinks and junctions as symbolic links). `size = nFileSizeHigh * 2**32 + nFileSizeLow` for files, 0 for directories and links. `modifiedMs = filetimeToMs(ftLastWriteTime)`. The locked system files that `lstat` refused (`pagefile.sys`, `hiberfil.sys`, `swapfile.sys`) now report their real size from the listing.
8. **Walk changes** (`walk.ts`): replace `opendir`/`lstat`/batching with one `lister.list(dirPath)` per directory. Order inside a directory: report `listing.errorCode` first when non-null (`sink.error(dirPath, code, 'folder')`), then handle the entries that were read: a link → `sink.file(handle, 0, name, modifiedMs)`; a directory → `queue.push({ path: join(dirPath, name), handle: sink.folder(handle, name, modifiedMs) })`; otherwise `sink.file(handle, size, name, modifiedMs)`. Abort: check `signal.aborted` before each `list` call and between entries of a long listing in chunks of 4096 entries, so an abort during a million-entry folder returns promptly. `sink.visiting(dirPath)` is called before each `list`. Never descend into a link. The sink contract (`folder`, `file`, `error`, `visiting`) and the “rejects only if the sink throws” rule stay. `process.noAsar` in `entry.ts`: remove it, since the walk no longer uses Node’s file system and the listing sees `app.asar` as an ordinary file; keep the self-test check that `app.asar` is not entered.
9. **Benchmark** `scripts/bench-walk.mjs <dir> [--concurrency N] [--legacy]`: plain Node ESM, no build step. It cannot import the TypeScript walker, so it contains its own small copy of the two listers: the new koffi lister and the old `fs.promises.opendir` + `lstat` walk (flag `--legacy`, 16 in flight). It prints `files`, `folders`, `seconds` and `files/s` for one run, plus a one-line summary `new=<n>/s legacy=<n>/s ratio=<x>` when run without flags (both, new first, then legacy). Add `"bench:walk": "node scripts/bench-walk.mjs"` to `package.json`. It is **not** run in CI. A note at the top of the script says the first run on a folder warms the file cache, so run each twice and report the second figures.
10. **Packaging:** `electron-builder.yml` already unpacks `node_modules/koffi/**` and `node_modules/@koromix/koffi-win32-x64/**` (`asarUnpack`), and the scanner runs from `out/main/scanner.js` inside `app.asar`, so the `await import('koffi')` in the utility process resolves through the same redirect as in main. Verify this in the packaged self-test, do not assume it. If the scanner process cannot load koffi, fix it in this task (the likely causes: `process.noAsar` still set, or a bundler that inlines koffi) and say what you changed.
11. **Scanner wiring:** `entry.ts` creates the lister with `createWinFindLister()` before handling any request. If koffi fails to load, the scanner posts `scan failed` with a plain message instead of crashing silently: on the first `start` it sends `{ type: 'failed', payload: { scanId, message: 'The disk reader could not be loaded.' } }` using the existing failure message type of `scanner-protocol.ts` (read it and use the exact type). `createScannerHost` now takes `lister`. Non-Windows is not supported in production; the walk tests supply a fake lister.
12. **Self-test:** the packaged self-test already scans the app’s `resources` folder through the scanner process, which now uses the new walk; that is the check. Extend `SelfTestScan` handling only to require that the scan found more than 0 files **and** that the largest file’s size is non-zero: `rootChildren` already holds the scanned root’s direct children; assert at least one `file` or `files` row with `bytes > 0` (add the field check against the real `TreeRow` shape; read `tree-types.ts` first). New exit code `SELF_TEST_EXIT.walkEmpty = 22`; `self-test.test.ts` gets one test for it.
13. **Renderer throttle** (`workspace-store.ts`): export `REVISION_THROTTLE_MS = 1000`. While `phase === 'scanning'`, a `progress` event updates `totals` and `elapsedMs` immediately but bumps `revision` (which triggers chunk and treemap reloads) at most once per `REVISION_THROTTLE_MS`: leading edge (the first progress bumps at once), then at most one trailing bump scheduled with `setTimeout` for the remainder of the window when events arrive inside it. `done`, `failed`, `scan:restarted`, `tree:changed`, a sort change and starting a scan bump at once and clear any pending trailing timer. The store’s dispose function clears the timer. Use `Date.now()` for the window so `vi.useFakeTimers()` controls it.

**Tests:**

`win-find.test.ts` — pure tests run everywhere; native tests use `it.runIf(process.platform === 'win32')`:

- `filetimeToMs converts FILETIME ticks to epoch milliseconds` — (low 0xd53e8000, high 0x019db1de) is `0x019db1ded53e8000` ticks = 116444736000000000 → `0` (Unix epoch exactly); a ticks value for 2026-01-01T00:00:00Z (`134100000000000000`… compute in the test from `Date.UTC(2026,0,1)` as `(Date.UTC(2026,0,1) + 11644473600000) * 10000`, split into low/high) round-trips to `Date.UTC(2026,0,1)`; `(0,0)` returns 0 (never negative).
- `findPattern appends \* to a folder` — `C:\Data` → `C:\Data\*`; `C:\` → `C:\*`; `C:\Data\` → `C:\Data\*`.
- `findPattern adds the long-path prefix at 248 characters` — a path whose pattern length is 247 has no prefix; length 248 gets `\\?\`; a path already starting `\\?\` is not prefixed twice.
- `win32ErrorToCode maps the documented codes` — 5→`EACCES`, 2→`ENOENT`, 3→`ENOENT`, 206→`ENAMETOOLONG`, 267→`ENOTDIR`, 32→`WIN32_32`, 9999→`WIN32_9999`.
- (win32) `the WIN32_FIND_DATAW struct is 592 bytes`.
- (win32) `lists files with size and modification time from the listing` — temp dir with `a.txt` (5 bytes) and `b.bin` (0 bytes) and a nested folder `sub`; entries are exactly those three (no `.`/`..`), `a.txt` has `size 5`, `modifiedMs` within 5 s of the file’s `fs.statSync().mtimeMs`, `sub` has `isDirectory true`; `errorCode` null.
- (win32) `lists a folder deeper than 260 characters` — create a nested path over 260 characters with `\\?\`-prefixed `fs.mkdirSync(..., { recursive: true })` and a file inside; listing the deepest folder through the lister returns that file.
- (win32) `flags a junction as a link and does not report it as a folder to enter` — create a junction with `fs.symlinkSync(target, link, 'junction')` (no elevation needed); the entry has `isLink true`, `size 0`. If creation throws `EPERM`, `ctx.skip()` (document it). A file symlink (`'file'`) is attempted the same way and skipped when not permitted.
- (win32) `reports a missing folder as ENOENT and an empty listing` — nonexistent path → `{ entries: [], errorCode: 'ENOENT' }`.
- (win32) `reports access denied` — `C:\System Volume Information` (exists on every NTFS system drive) → `errorCode 'EACCES'`; skip when the folder does not exist or is readable (an elevated test run).
- (win32) `overlaps several listings` — 8 calls started together on a temp tree all resolve with the right entries (checks the async path returns the right data per call, no shared buffer).

`walk.test.ts` — keep every test that is about the walk’s own logic, rewritten on the fake lister (`createFakeWalkFs` now builds a `DirectoryLister`, plus `listCalls`, `maxListingAtOnce`, and the options `listErrors: Record<path, code>`, `partialErrors: Record<path, code>` (the first entry then the error), `beforeList`). Remove the tests that existed only for `lstat` (`records entries that cannot be inspected`, `counts a file whose lstat fails…`, `reports a folder whose lstat fails…`) and say so in the commit body. Keep and adapt: `reports every folder and file with its size`, `counts links as 0-byte entries and never lists them`, `records unreadable folders with their error code and keeps going`, `keeps what was read when a listing fails part-way` (the partial entries are counted and the error recorded), `reports an unreadable root as a single error`, `lists at most 8 directories at the same time` (the cap constant; was 16), `honours a lower concurrency`, `stops starting new directories as soon as the signal aborts`, `does nothing when the signal is already aborted`, `reads the Node.js error code`. Add:

- `an abort during a very large listing stops within one chunk` — a fake listing of 20_000 entries; abort from the sink after 100 files; the walk resolves having reported fewer than 4_200 files.
- `a link that is a directory is counted as a file and not entered` — `isDirectory true, isLink true`.
- `an entry sees its listed modification time and size` — sink receives `modifiedMs` and `size` exactly.
- The `walk on disk` tests become `it.runIf(process.platform === 'win32')` and use `createWinFindLister()`; they keep their assertions (real tree measured, junction not followed, missing root reported as not found).

`scanner-host.test.ts`: mechanical change `fs` → `lister`; all existing assertions stay.

`workspace-store.test.ts` (fake timers, fake api with `onScanProgress` captured):

- `progress events reload at most once per second while scanning` — emit 10 progress events 100 ms apart; `revision` increased by at most 2 after 1000 ms (leading plus one trailing), `totals` followed every event.
- `the first progress event bumps the revision at once`.
- `done bumps the revision immediately and cancels the trailing bump` — a progress inside the window, then `done`: `revision` increased by exactly 2 in total over the window and no extra bump fires when timers run out.
- `tree:changed bumps immediately` while a trailing timer is pending, and no extra bump follows.
- `dispose clears the pending timer` — after dispose, advancing 5_000 ms changes nothing.

- [ ] **Step 1: Write the failing tests** (`win-find.test.ts` pure parts and the new `walk.test.ts` and store tests first).
- [ ] **Step 2: Run them** — `npx vitest run src/worker/scanner src/renderer/src/stores/workspace-store.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `win-find.ts`, then `walk.ts`, `fake-walk-fs.ts`, `scanner-host.ts`, `entry.ts`, the store throttle, the self-test change.
- [ ] **Step 4: Run the same tests.** Expected: PASS; on Windows the native tests also pass.
- [ ] **Step 5: Add `scripts/bench-walk.mjs`**, then measure from PowerShell: `node scripts/bench-walk.mjs "C:\Program Files"` twice, then with `--concurrency 4`, `8`, `16`. Pick the constant. **Acceptance: the new walk is at least 3x the legacy walk on `C:\Program Files` (second runs).** Record all numbers in the report. If the ratio is below 3x, stop and report; do not commit.
- [ ] **Step 6: Perf and gates:** `npm run test:perf` (the 1M-file synthetic limits stay green; these tests use the tree store, not the walk), then the common gate, then `npm run dist; npm run test:packaged`. Expected: the self-test passes and logs the file count of the resources scan.
- [ ] **Step 7: Commit**

```powershell
git add src/worker/scanner/win-find.ts src/worker/scanner/win-find.test.ts src/worker/scanner/walk.ts src/worker/scanner/walk.test.ts src/worker/scanner/test/fake-walk-fs.ts src/worker/scanner/scanner-host.ts src/worker/scanner/scanner-host.test.ts src/worker/scanner/entry.ts src/renderer/src/stores/workspace-store.ts src/renderer/src/stores/workspace-store.test.ts src/main/self-test.ts src/main/self-test.test.ts scripts/bench-walk.mjs package.json
git commit -m "perf(scanner): list directories with FindFirstFileExW instead of lstat per entry"
```

---

### Task 8d: Parallel walkers

**Implementer tier:** standard (worker threads, koffi per thread, abort and packaging details; read the whole task before the first test)

**Why (owner decision):** after Task 8b a full `C:\` scan (1.9M files, 410k folders) takes 195.67 s (9.7k files/s; legacy `lstat` walk: 306.85 s). Everything runs on one JS thread of the scanner process. Measurements so far: a single-thread synchronous `FindFirstFileExW` walk reaches 31–63k files/s on file-dense trees, but folder-dense trees (`C:\Windows`, about 1 file per folder) are bound by the per-directory open cost (about 0.5 ms, mostly the antivirus scan the open triggers), and overlapping opens gave about 2.4x. Task 8b overlaps only the opens (koffi `.async`, at most 8 in flight) and still pays every `FindNextFileW` loop, every JS entry object and every `sink` call on one thread. Several worker threads, each doing fully synchronous listings, overlap the opens **and** the per-entry work, with no admin rights. The coordinator (the scanner host thread) stays the only writer of `TreeStore`, so the store and all its limits do not change.

**Expected result (an estimate, not a promise):** 410k opens x 0.5 ms / 7 walkers is about 30 s of open time, plus about 15–25 s of listing, decoding and tree inserts that cannot overlap with themselves (single writer). Expect roughly 50–80 s on the measured machine (3x to 4x), with the gain flattening beyond 4–6 walkers. **Acceptance is a measurement, not this estimate:** full `C:\` at least 1.8x faster than the Task 8b walk measured back to back on the same machine (rule 15). If it is not reached, stop with NEEDS_CONTEXT and the numbers; do not loosen the bar.

**Verified before writing (do not re-litigate):** koffi 3.3.8 loads and calls Win32 inside `worker_threads` (spike on Node 22: three workers each `require('koffi')`, `koffi.load('kernel32.dll')`, call `GetCurrentThreadId`, three different thread ids). Each worker thread gets its own koffi instance, so the struct type name (`SIQ_FIND_DATAW`) and the function bindings are declared once **per worker**, and `GetLastError` is valid right after a synchronous call on that worker thread (so the sync lister needs no retry trick, unlike the async lister). If this ever fails in the packaged app (rule 12), fall back to the Task 8b design with more `.async` opens in flight and report it; do not ship a half-working pool.

**Files:**

- Create: `src/worker/scanner/walker-batch.ts`, `src/worker/scanner/walker-batch.test.ts` (wire format), `src/worker/scanner/walker-job.ts`, `src/worker/scanner/walker-job.test.ts` (one job: the depth-first local walk, pure, takes a `SyncLister`), `src/worker/scanner/walker-pool.ts`, `src/worker/scanner/walker-pool.test.ts` (coordinator), `src/worker/scanner/walker-pool.win32.test.ts`, `src/worker/scanner/walker-worker.ts` (worker thread entry: wires the koffi sync lister and `runJob` to `parentPort`; no logic of its own), `src/worker/scanner/test/fake-walker-port.ts` (in-thread fake worker)
- Modify: `src/worker/scanner/win-find.ts` and `win-find.test.ts` (sync lister; share `toEntry` and the constants), `src/worker/scanner/walk.ts` (export `SyncLister`; nothing else changes), `src/worker/scanner/test/fake-walk-fs.ts` (a `syncLister` view of the same fake tree), `src/worker/scanner/scanner-host.ts` and `scanner-host.test.ts` (optional `walkParallel` dep, failure reporting), `src/worker/scanner/entry.ts`, `src/shared/scan-types.ts` (optional `walkers?: number` on `ScanDone`), `src/main/self-test.ts` and `self-test.test.ts`, `electron.vite.config.ts`, `electron-builder.yml`, `scripts/bench-walk.mjs`
- Unchanged on purpose: `tree-store.ts` (single writer), `WalkSink`, `WalkOptions`, the semantics of `walk()`.

**Interfaces:**

`walk.ts` adds only `interface SyncLister { listSync(dirPath: string): DirectoryListing }` (same contract as `DirectoryLister`: never throws for file-system errors, they come back in `errorCode`). `win-find.ts` adds `createWinFindSyncLister(): Promise<SyncLister>` (async only because koffi loads with `await import('koffi')`), built on the same struct, constants, `toEntry`, `findPattern` and `win32ErrorToCode` as the async lister; the open is a plain synchronous `FindFirstFileExW(... FIND_FIRST_EX_LARGE_FETCH)`; on failure `GetLastError()` is read immediately (same thread); `FindClose` is in a `finally`.

`walker-batch.ts` (the wire format, one result per job; names are exact):

```ts
export const KIND_FILE = 0 // files, links and every non-folder entry (links have size 0)
export const KIND_FOLDER = 1 // a real folder (not a link)
export interface ResultBatch {
  /** Local index 0 is the job's own directory (its handle was assigned by the coordinator). Folder records get local indexes 1, 2, 3 ... in record order. */
  count: number
  kinds: Uint8Array // length count
  parents: Uint32Array // length count: local index of the containing folder (0 = job root)
  sizes: Float64Array // length count: bytes (0 for folders and links); exact up to 2^53
  mtimes: Float64Array // length count: ms since epoch, 0 when unknown
  nameEnds: Uint32Array // length count: end offset (UTF-16 units) of each name inside `names`
  names: string // all names concatenated; a JS string, so lone surrogates of NTFS names survive structured clone
  errors: Array<{ path: string; code: string; kind: ScanErrorKind }> // directory listing failures, in order
  visited: string // the last directory listed in this job (feeds sink.visiting)
  pendingLocal: Uint32Array // local indexes of folder records NOT walked (budget hit or abort)
  pendingPaths: string[] // the same folders' full paths, parallel to pendingLocal
}
export class BatchBuilder {
  addFile(parentLocal, name, size, mtime): void
  addFolder(parentLocal, name, mtime): number /* new local index */
  addError(path, code, kind): void
  setVisited(path): void
  addPending(local, path): void
  finish(): ResultBatch
}
export function decodeBatch<D>(
  batch: ResultBatch,
  rootHandle: D,
  sink: WalkSink<D>,
): Array<{ handle: D; path: string }>
export function batchTransferList(batch: ResultBatch): ArrayBuffer[] // the typed-array buffers, passed to postMessage so they are moved, not copied
```

`decodeBatch` keeps a local `handles: D[]` (index 0 = `rootHandle`). It applies, in this order: every `errors` entry through `sink.error`; then the records in order (`folder` record: `handles.push(sink.folder(handles[parents[i]], name, mtimes[i]))`; `file` record: `sink.file(handles[parents[i]], sizes[i], name, mtimes[i])`); then `sink.visiting(visited)`; it returns the pending folders as `(handles[pendingLocal[k]], pendingPaths[k])`. A worker emits a folder record before any record that names it as parent, so one in-order pass is enough; no sorting.

`walker-job.ts`:

```ts
export const WALKER_BUDGET_ENTRIES = 2000 // stop starting new directories once this many records are in the batch
export const WALKER_BUDGET_DIRECTORIES = 64 // ... or once this many directories were listed
export const ABORT_CHECK_ENTRIES = 4096 // abort flag checked every this many entries inside one listing
export function runJob(
  dirPath: string,
  lister: SyncLister,
  shouldStop: () => boolean,
  budget?: { entries: number; directories: number },
): ResultBatch
```

`walker-pool.ts`:

```ts
export const MIN_WALKERS = 2
export const MAX_WALKERS = 8
export const ABORT_GRACE_MS = 2000
export function walkerCount(parallelism: number): number // clamp(parallelism - 1, MIN_WALKERS, MAX_WALKERS)
export function defaultWalkerCount(): number // walkerCount(os.availableParallelism())
export function walkerCountFromEnv(value: string | undefined, fallback: number): number // "1".."8" -> that number, anything else -> fallback
export class WalkerStartupError extends Error {}
export interface WalkerPort {
  // the subset of worker_threads.Worker the pool uses; the fake implements the same
  postMessage(message: PoolRequest, transfer?: ArrayBuffer[]): void
  on(event: 'message', fn: (message: PoolReply) => void): void
  on(event: 'error', fn: (error: Error) => void): void
  on(event: 'exit', fn: (code: number) => void): void
  terminate(): Promise<number>
}
export interface PoolDeps {
  createPort(index: number, abortFlag: SharedArrayBuffer): WalkerPort
  walkers: number
}
export function createWalkerPool(deps: PoolDeps): {
  walk<D>(
    rootPath: string,
    rootHandle: D,
    sink: WalkSink<D>,
    signal: AbortSignal,
  ): Promise<{ walkers: number }>
}
```

Messages (structured clone): `PoolRequest = { type: 'job'; jobId: number; dirPath: string } | { type: 'exit' }`; `PoolReply = { type: 'ready' } | { type: 'result'; jobId: number; batch: ResultBatch } | { type: 'aborted'; jobId: number } | { type: 'fatal'; message: string }`.

**Behaviours (rules):**

1. **Pool size.** `walkerCount(p) = Math.min(MAX_WALKERS, Math.max(MIN_WALKERS, p - 1))`, so one core stays for the coordinator and the UI: 1→2, 2→2, 3→2, 4→3, 8→7, 9→8, 64→8. At most 8 because past that the single-writer coordinator, not the opens, is the limit (the bench in rule 15 shows it). The env override `STORAGEIQ_WALKERS` (`1` forces the Task 8b single-thread async walk, `2`–`8` forces that count, anything else is ignored) exists for the bench, support and tests.
2. **Why worker threads inside the scanner process (not more utility processes):** the scanner process already owns the tree and the query path; extra processes would have to ship their batches through the main process. Worker threads share the process, move typed arrays without copying (`transfer`), and koffi works per thread (verified above). Tradeoff accepted: a worker stuck in a kernel open cannot be interrupted (rule 9).
3. **Work distribution.** The coordinator holds a LIFO stack `queue: Array<{ path: string; handle: D }>` seeded with the root. A free worker (it just reported `ready` or returned a result) gets the top entry as `{ type: 'job', jobId, dirPath }`. **One job per worker at a time**: a job is about 2,000 entries, so the message round trip is negligible next to it, and the bounded in-flight set bounds memory. LIFO keeps the stack small and directory locality high.
4. **One job (`runJob`).** A local stack starts with the job's directory (local index 0). Loop: pop a directory, `lister.listSync(path)`; if `errorCode !== null` add an error record (`kind: 'folder'`, that path); for each entry in listing order: a link → `addFile(parent, name, 0, mtime)`; a directory that is not a link → `local = addFolder(parent, name, mtime)` and push `{ local, path: path.join(dir, name) }` on the local stack; anything else → `addFile(parent, name, size, mtime)`. Reparse rules stay those of Task 8b (only symlink and mount-point tags give `isLink`; that is decided in the lister, `runJob` only reads `isLink`). A directory listing is **never split**: the budget is checked only **between** directories; when `count >= budget.entries` or the directories listed `>= budget.directories`, the loop stops and everything still on the local stack is returned as `pendingLocal`/`pendingPaths`. The coordinator turns those into new queue entries which idle workers take: this is the work stealing, and it is why a worker that landed in `C:\Windows\WinSxS` hands its unvisited subfolders back after at most 64 directories. Abort: `shouldStop()` is checked before each directory and every `ABORT_CHECK_ENTRIES` entries inside a listing; when true, the job returns the batch so far with the unwalked stack as pending (the coordinator ignores it, rule 9). `visited` is the last path listed. `runJob` never throws for file-system errors.
5. **Local folder ids and the mapping.** A worker never knows TreeStore ids. The coordinator already has the handle of a job's root (the scan root `0`, or the handle that an earlier `decodeBatch` returned for a pending folder). Folders created inside a job are numbered locally (1, 2, 3 ... in record order) and `decodeBatch` maps local index to handle as it inserts. A batch is self-contained (its only external reference is its own root handle) and a child job exists only after its parent batch was decoded, so batches from different workers may arrive in **any order** and the resulting tree is the same; there is no cross-batch ordering state.
6. **Single writer.** Only the coordinator calls `decodeBatch` (hence the sink), in the `message` handler on the scanner host thread, one batch at a time. `TreeStore` is never touched by workers and needs no locking.
7. **Wire cost.** One message per job: parallel typed arrays plus one `names` string; the typed-array buffers are transferred, not copied. No per-entry objects cross threads. Name decoding is `names.slice(prevEnd, nameEnds[i])`.
8. **Errors, caps, visiting.** Listing failures travel as `errors` records and are applied through `sink.error`, so `MAX_SCAN_ERRORS`, kinds and `errorCount` behave exactly as before (the store caps; workers do not). `sink.visiting` is called once per batch (the last directory of the job) instead of once per directory: `currentPath` in progress is coarser but still moves several times per second. Document this in `walker-pool.ts`.
9. **Abort.** The pool allocates one `SharedArrayBuffer(4)` abort flag, passed to every worker in `workerData`, read in workers with `Atomics.load` as `shouldStop`. When the `AbortSignal` aborts, the coordinator immediately sets a `stopped` flag (from then on: no `decodeBatch`, no sink call, no new job, even for messages already queued in the event loop), does `Atomics.store(flag, 0, 1)` and waits for each in-flight job's `result` or `aborted` reply. A worker inside a listing stops at its next check; its `finally` runs `FindClose`; then it replies. When every worker is idle the pool posts `{ type: 'exit' }`, awaits `terminate()` on all workers, and the walk resolves (like `walk()`, an abort is a normal resolve). **Grace limit:** if a worker has not replied `ABORT_GRACE_MS` (2000) after the abort (stuck in a blocked kernel open, for example on a dead network share), the pool calls `terminate()` on it without awaiting, logs one line and resolves anyway. `terminate` cannot interrupt a thread inside a native call, so in that rare case the thread ends when the call returns or when the process exits; say so in the pool's doc comment. The pool is created **per walk** and always torn down in a `finally`, so no worker outlives a scan (spawn plus koffi load costs about 100 ms per scan, measured in the bench, acceptable).
10. **Failure.** A worker `error` event, a non-zero `exit` while the pool is running, or a `fatal` reply makes the pool stop everything as in rule 9 and **reject** the walk with `new Error('The disk reader stopped unexpectedly: <message>')`. `scanner-host.ts` must turn any rejected walk into the existing failure message (`{ type: 'failed', payload: { scanId, message } }`; read `scanner-protocol.ts` for the exact shape) instead of an unhandled rejection (today `run()` has no catch; add one that posts `failed` and still clears `current`). **Startup fallback:** if **every** worker fails before any reported `ready` (koffi cannot load in a thread, the script is missing) and no job was dispatched, the pool rejects with `WalkerStartupError`; the host then runs the Task 8b single-thread `walk()` for that scan and reports `walkers: 1`. A failure after a job was dispatched is never retried silently.
11. **Host wiring.** `ScannerHostDeps` gains an optional `walkParallel?: (root: string, handle: number, sink: WalkSink<number>, signal: AbortSignal) => Promise<{ walkers: number }>`. When present, `run()` (a full scan) uses it; when absent (tests, `STORAGEIQ_WALKERS=1`) `run()` uses `walk()` and reports `walkers: 1`. **Refresh of one folder keeps using the single-thread async `walk()`**: refreshes are small subtrees, and spawning a pool would cost more than it saves. `ScanDone.walkers` (optional number) carries the count used; the renderer ignores it. `entry.ts` builds `walkParallel` with `createWalkerPool({ walkers: walkerCountFromEnv(process.env.STORAGEIQ_WALKERS, defaultWalkerCount()), createPort })` where `createPort` is `new Worker(walkerScriptPath(), { workerData: { abortFlag, index } })` and `walkerScriptPath()` is `path.join(__dirname, 'walker.js')` with `app.asar` replaced by `app.asar.unpacked` (rule 12). When the env value is `1`, `entry.ts` passes no `walkParallel`.
12. **Packaging.** `electron.vite.config.ts` main `input` gains `walker: resolve('src/worker/scanner/walker-worker.ts')`, giving `out/main/walker.js` (the build is CommonJS; `out/main/chunks/` already exists, so a shared chunk between `scanner.js` and `walker.js` is likely). Decision: **run the worker from the unpacked tree**, so neither the worker script nor its `require('koffi')` depends on Electron's asar patching inside worker threads (not verified, and a failure would be silent). `electron-builder.yml` `asarUnpack` gains `out/main/walker.js` and `out/main/chunks/**`; a worker loaded from `app.asar.unpacked/out/main` resolves `node_modules/koffi` from `app.asar.unpacked/node_modules`, which already holds koffi. After `npm run dist`, list `release/win-unpacked/resources/app.asar.unpacked/out/main` and confirm `walker.js` and every chunk it requires are there; add any chunk the unpack list missed. In dev the path is `out/main/walker.js` with no replacement. If a packaged worker still cannot start, the startup fallback (rule 10) keeps scans working, but the self-test (rule 13) fails: that is the intended alarm.
13. **Self-test.** The packaged self-test scan of the `resources` folder must run on the pool: require `done.walkers >= 2`, else the new exit code `SELF_TEST_EXIT.parallelWalkFailed = 23` (log `walk: only 1 walker (pool did not start)`). It is enforced only when `unpackedNativeModule !== null` (packaged), so unpackaged runs and e2e keep passing. `self-test.test.ts`: a finished packaged scan with `walkers: 1` returns 23; with `walkers: 4` returns ok; an unpackaged run with `walkers: 1` returns ok.
14. **Fake mode.** `runJob` and the coordinator are platform-independent: the coordinator only sees `WalkerPort`. `fake-walker-port.ts` implements `WalkerPort` **in the same thread**: on `job` it calls `runJob(..., fakeSyncLister, shouldStop)` on a timer tick and replies through the same path, simulating transfer with `structuredClone(batch, { transfer: batchTransferList(batch) })`. Options: `replyDelayMs(jobId)` (forces out-of-order arrival), `crashOnJob` (emits `error`), `neverReply`, `startupFails`, and counters `terminated`, `jobsSeen`. `walker-worker.ts` has no unit test of its own (it only wires `createWinFindSyncLister`, `runJob` and `parentPort`); the win32 integration test covers it.
15. **Benchmark and acceptance** (`scripts/bench-walk.mjs`, still plain Node ESM with its own copies, no build step): add `--pool N` (N worker threads via `isMainThread` and `new Worker(new URL(import.meta.url))`, the same batch idea in simplified form: workers return parallel arrays, the coordinator pushes every name into an array and bumps counters, which approximates the writer-side cost) and make the Task 8b async walk an explicit `--async`. With no flags the script prints one line per variant: `async`, `pool 1`, `pool 2`, `pool 4`, `pool 8`, each with files, folders, seconds and files/s, each run once. Procedure, PowerShell, nothing heavy running, same session, back to back: `node scripts/bench-walk.mjs "C:\Program Files"` and `"C:\Windows"` (second runs, cache warm); then **full `C:\`**: `--async` first (the Task 8b baseline, expect about 195 s), then `--pool 2`, `--pool 4`, `--pool 8`, and the default size. Record every number, `os.availableParallelism()` and the size `walkerCount` picks (7 on 8 logical cores). Then confirm end to end with the real scanner: `npm run dev`, scan `C:\`, read `elapsedMs` of the done event and report it next to the bench figure; they should agree within 15%, and a bigger gap must be explained (decode and tree-insert cost on the coordinator). **Acceptance: the default-size pool finishes full `C:\` in at most `async_seconds / 1.8`** (about 109 s against 195.67 s) in the same back-to-back session. Below that: stop with NEEDS_CONTEXT and the table; do not change the bar; do not commit. If `--pool 8` beats the default size by more than 15%, report it as a finding for the owner instead of raising the cap here.
16. **Perf limits stay green:** `npm run test:perf` is unchanged (the 1M-file synthetic tests use `TreeStore` directly and nothing here touches it). One extra timing test lives in `walker-batch.test.ts` (see below).

**Tests:**

`walker-batch.test.ts`:

- `a batch round-trips files, folders and nested folders` — root file; folder A (local 1) holding a file; folder B (local 2) inside A holding a file; decoded into a recording sink, the calls are `folder(root,'A')`, `file(handleA,...)`, `folder(handleA,'B')`, `file(handleB,...)` with exact names, sizes (including `2**40 + 7`), mtimes, in record order.
- `sizes above 4 GB and names with lone surrogates survive` — size `5_000_000_000`; name `'\ud800x'` comes back unchanged, also after `structuredClone`.
- `errors are applied first and visiting last` — recording sink order: every `error`, then the folder/file calls, then `visiting(visited)`.
- `pending folders come back with their mapped handles and paths` — two unwalked folders, one nested (local 2 inside local 1): the returned pairs hold the handles the sink returned for those records.
- `an empty batch decodes to nothing`.
- `batchTransferList lists the typed-array buffers and a transferred batch still decodes` (`structuredClone(batch, { transfer })`).
- `encode and decode of 200_000 records takes under 1500 ms` into a no-op sink (guards the wire format, generous for CI).

`walker-job.test.ts` (fake sync lister, no threads):

- `walks depth-first inside one job and numbers folders in record order`.
- `a link that is a directory is counted as a 0-byte file and never entered` (`isDirectory true, isLink true`).
- `stops starting directories after 64 directories and returns the rest as pending` — 200 sibling folders under the job root: the first job lists exactly 64 directories (the root plus 63), `pendingLocal` holds the remaining folders, every pending path is a real folder.
- `stops after 2000 records between directories and never splits a listing` — one directory with 5_000 files is returned whole (5_000 records in one batch) and its sibling folders come back pending.
- `a listing error becomes an error record and the job continues` — an `EACCES` folder; a partial listing with `ENOENT` keeps the entries read before the error.
- `shouldStop during a listing stops within ABORT_CHECK_ENTRIES` — 20_000-entry listing, `shouldStop` true from the second check: fewer than 4_200 records, unwalked directories pending.

`walker-pool.test.ts` (fake ports, in-thread):

- `walkerCount clamps to 2..8` — the table of rule 1; `walkerCountFromEnv` — `'1'`→1, `'4'`→4, `'0'`, `'9'`, `'abc'`, `undefined` → fallback.
- `a pool walk gives the same tree as the single-thread walk` — one fake tree (about 300 folders, 5_000 files, 8 levels deep, links, unreadable folders) walked with `walk()` and with the pool at 1, 3 and 8 fake ports into recording sinks: the sorted `(full path, kind, size, mtime)` lists, the error sets and the `files`/`folders`/`bytes` totals are equal. Full paths are rebuilt from the handles each sink returned, since ids differ.
- `batches arriving out of order map nested folders to the right parents` — three fake ports whose reply delays make the deepest job reply first; the tree equals the in-order run.
- `all workers are used and idle workers pick up pending folders` — 8 ports, one root with 500 subfolders: every port saw at least one job, and the first job returned pending folders.
- `a worker crash fails the walk and terminates every port` — `crashOnJob: 2`: the promise rejects with a message starting `The disk reader stopped unexpectedly`, no hang (test timeout 2 s), every port `terminated`.
- `startup failure on every port rejects with WalkerStartupError and dispatches nothing`.
- `an abort while workers are mid-batch stops all sink calls and exits all workers` — ports with reply delay, abort from the sink after 10 files; after the promise resolves the sink call count does not change while fake timers advance 100 ms, the abort flag word is 1, every port `terminated`, a result that was already queued is dropped.
- `an abort with a worker that never replies resolves after ABORT_GRACE_MS` — `neverReply` on one port, fake timers: resolves after advancing 2_000 ms, that port's `terminate` was called.
- `a rejecting sink rejects the walk and stops the workers`.
- `a signal that is already aborted starts no job` — resolves at once, zero jobs seen, ports terminated.

`scanner-host.test.ts` (additions):

- `a scan uses walkParallel when given and reports its walker count in done`.
- `a scan without walkParallel reports walkers 1`.
- `a rejected parallel walk posts a failed message and clears the running scan` (a following `start` works).
- `a WalkerStartupError falls back to the single-thread walk` (`done.walkers 1`, correct totals).
- `refresh uses the single-thread walk even when walkParallel is set` (the spy is not called).
- existing tests unchanged.

`win-find.test.ts` (additions; native ones `it.runIf(process.platform === 'win32')`):

- `the sync lister lists a temp folder like the async lister` — same entries, sizes, mtimes; `sub` is a directory; no `.`/`..`.
- `the sync lister reports ENOENT for a missing folder` (not `WIN32_0`: GetLastError is read on the same thread) and `EACCES` for `C:\System Volume Information` (skip when readable).
- `the sync lister flags a junction as a link` (skip on EPERM like the async test).

`walker-pool.win32.test.ts` (win32 only, real `worker_threads`; if running the TypeScript worker under vitest is impractical, build with `electron-vite build` in `beforeAll` and use `out/main/walker.js`, and say so in the report):

- `the real pool matches the single-thread walk on a temp tree` — 200 folders, 2_000 small files over 3 levels, a junction that must not be followed, an empty folder: the pool with 4 real workers and `walk()` with the real async lister give the same `files`, `folders`, `bytes` and the same sorted `(path, size)` list.
- `aborting a real pool walk leaves no worker running` — abort after the first batch; the pool's live-worker counter is 0 when the promise resolves and no further sink calls happen.

- [ ] **Step 1: Write the failing tests** (`walker-batch`, `walker-job`, `walker-pool` with the fake port, host additions, sync-lister pure parts, self-test).
- [ ] **Step 2: Run them** — `npx vitest run src/worker/scanner src/main/self-test.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `SyncLister` and `createWinFindSyncLister`, `walker-batch.ts`, `walker-job.ts`, `fake-walker-port.ts`, `walker-pool.ts`, `walker-worker.ts`, then the host wiring (`walkParallel`, failure message, `walkers`), `entry.ts`, `ScanDone.walkers`, the self-test change, `electron.vite.config.ts` and `electron-builder.yml`.
- [ ] **Step 4: Run the same tests.** Expected: PASS; on Windows the native and real-thread tests also pass.
- [ ] **Step 5: Extend `scripts/bench-walk.mjs`** and run the acceptance procedure of rule 15 (full `C:\`, back to back). Put the table in the report. If the 1.8x bar is not met: stop with NEEDS_CONTEXT, do not commit.
- [ ] **Step 6: Perf and gates**, each command separately so a failure points at the right config (PowerShell, from `C:\StorageIQ`):

```powershell
npm run format
npm run format:check
npm run lint
npm run typecheck:node
npm run typecheck:web
npx vitest run
npm run test:perf
npm run dist
npm run test:packaged
```

Expected: all green; the packaged self-test logs a scan with at least 2 walkers and the file count of the `resources` scan; `app.asar.unpacked/out/main` contains `walker.js` and its chunks.

- [ ] **Step 7: Manual check (record in the report):** `npm run dev`, scan `C:\`; the scan completes, Task Manager shows the scanner process using several cores, the totals move continuously, Cancel mid-scan returns to idle within about 2 s and the scanner process drops to idle CPU (no thread left working); a second scan started right after the cancel completes.
- [ ] **Step 8: Commit** (message has no Co-Authored-By line and no AI attribution)

```powershell
git add src/worker/scanner/walker-batch.ts src/worker/scanner/walker-batch.test.ts src/worker/scanner/walker-job.ts src/worker/scanner/walker-job.test.ts src/worker/scanner/walker-pool.ts src/worker/scanner/walker-pool.test.ts src/worker/scanner/walker-pool.win32.test.ts src/worker/scanner/walker-worker.ts src/worker/scanner/test/fake-walker-port.ts src/worker/scanner/win-find.ts src/worker/scanner/win-find.test.ts src/worker/scanner/walk.ts src/worker/scanner/test/fake-walk-fs.ts src/worker/scanner/scanner-host.ts src/worker/scanner/scanner-host.test.ts src/worker/scanner/entry.ts src/shared/scan-types.ts src/main/self-test.ts src/main/self-test.test.ts electron.vite.config.ts electron-builder.yml scripts/bench-walk.mjs
git commit -m "perf(scanner): walk with several worker threads, one writer, batched results"
```

---

### Task 8c: Strata visual design and file-type treemap

**Implementer tier:** standard

**Why:** the owner rejected the Phase 3 look (grey ribbon of loose icons, pale teal bars, flat grey treemap, alarming red banner). The approved direction is "Strata – warm & calm". Every value in this task comes from the design spec **`docs/superpowers/specs/2026-11-23-strata-visual-design.md`** (cited below as "spec §n"); read it fully before starting. Structure (row heights, column widths, pane order, level count) does not change except the three layout tokens in spec §2.4. Lucide icons only; no web fonts; no competitor named anywhere (code, comments, tests, commit).

**Files:**

- Create: `src/shared/file-category.ts`, `src/shared/file-category.test.ts`, `src/renderer/src/components/TreemapLegend.tsx`, `src/renderer/src/components/TreemapLegend.test.tsx`
- Modify (design): `design/tokens.json`, `design/tokens.css` (generated), `design/contrast-report.txt` (generated), `design/components.md`, `DESIGN.md`, `scripts/build-tokens.mjs`, `src/renderer/src/styles/global.css`, `src/main/window-options.ts`
- Modify (data): `src/shared/tree-types.ts`, `src/worker/scanner/tree-store.ts`, `src/worker/scanner/tree-store.test.ts`, `src/worker/scanner/treemap.ts`, `src/worker/scanner/treemap.test.ts`, `src/renderer/src/test/fake-api.ts`
- Modify (renderer): `src/renderer/src/lib/treemap-draw.ts`, `src/renderer/src/lib/treemap-draw.test.ts`, `src/renderer/src/components/Ribbon.tsx`, `RibbonButton.tsx`, `MenuButton.tsx`, `SelectMenu.tsx`, `Button.tsx`, `Button.test.tsx`, `TreeGrid.tsx`, `TreemapPane.tsx`, `TreemapPane.test.tsx`, `LevelBar.tsx`, `Splitter.tsx`, `StatusBar.tsx`, `Banner.tsx`, `Dialog.tsx`

Read each file before changing it: Tasks 8a and 8b land first and may have moved lines.

**Interfaces (names exact):**

`src/shared/tree-types.ts` (the contract):

- `export const FILE_CATEGORIES = ['video', 'image', 'audio', 'document', 'archive', 'code', 'app', 'system', 'disk-image', 'other'] as const` and `export type FileCategory = (typeof FILE_CATEGORIES)[number]`. The order is the index stored by the scanner; never reorder (append only).
- `TreemapRect` gains `category: FileCategory | null` — the block’s own category for a file; the dominant category (spec §4: at least 50 % of logical bytes) for a folder or "[N files]" block; `null` for free space and for a folder or group with no dominant category ("mixed") or no bytes.
- `export interface CategoryShare { category: FileCategory; bytes: number }`
- `TreemapLayout` gains `categories: CategoryShare[]` — the logical bytes per category of the laid-out node (`nodeId`), categories with 0 bytes left out, largest first, ties by `FILE_CATEGORIES` order.

`src/shared/file-category.ts` (pure, no Node imports, used by the worker and the renderer):

- `export const CATEGORY_COUNT = FILE_CATEGORIES.length` (10)
- `export const CATEGORY_LABELS: Record<FileCategory, string>` — exactly the legend labels of spec §3 (`'Video'`, `'Images'`, `'Audio'`, `'Documents'`, `'Archives'`, `'Code'`, `'Apps & installers'`, `'System & libraries'`, `'Disk images'`, `'Other'`).
- `export const CATEGORY_EXTENSIONS: Record<Exclude<FileCategory, 'other'>, readonly string[]>` — exactly the lists of spec §3, lower case, no dots.
- `export function fileExtension(name: string): string` — text after the last `.`, lower-cased; `''` when there is no dot, when the only dot is the first character, or when the name ends with a dot.
- `export function fileCategoryIndex(name: string): number` — index into `FILE_CATEGORIES`, through one module-level `Map<string, number>` built once from `CATEGORY_EXTENSIONS`; unknown or empty extension → index of `'other'` (9).
- `export function fileCategory(name: string): FileCategory` — `FILE_CATEGORIES[fileCategoryIndex(name)]`.
- `export function dominantCategory(bytes: ArrayLike<number>): FileCategory | null` — `bytes` has `CATEGORY_COUNT` entries; returns the category with the most bytes (ties → lower index) when it holds at least half of the sum; `null` when the sum is 0 or no category reaches half.
- `export function categoryShares(bytes: ArrayLike<number>): CategoryShare[]` — the `TreemapLayout.categories` rule above.

`src/worker/scanner/tree-store.ts`:

- New per-file column `pCategory: Uint8Array` (grown with the other file arrays) holding `fileCategoryIndex(name)`; read with the method `fileCategoryOf(index: number): number`.
- New per-folder columns `fCategoryBytes` and `fDirectCategoryBytes`, each a `Float64Array` of `folders × CATEGORY_COUNT` (grown with the folder arrays, by the same factor, copying the old contents). `file()` adds `bytes` to `fDirectCategoryBytes[parent * K + c]` and, inside the existing ancestor loop, to `fCategoryBytes[a * K + c]`. `resetFolder(index)` subtracts the folder’s `fCategoryBytes` vector from every ancestor, then zeroes the folder’s `fCategoryBytes` and `fDirectCategoryBytes`.
- Reads: `folderCategoryBytes(index: number): Float64Array` and `directCategoryBytes(index: number): Float64Array` return `subarray` views of length `CATEGORY_COUNT` (callers must not keep them across writes; say so in the doc comment).
- Update the class doc comment: 21 bytes per file plus its name, and 160 bytes per folder for the category totals.

`src/worker/scanner/treemap.ts`: `Item` gains `category: FileCategory | null`, filled in `itemsOf` (file → `fileCategoryOf`; folder → `dominantCategory(folderCategoryBytes)`; "[N files]" → `dominantCategory(directCategoryBytes)`), copied into every `TreemapRect`; the free-space rect gets `null`, the drive-root rect the root folder’s dominant category. `treemapLayout` fills `categories` from the laid-out node (folder → `folderCategoryBytes`; "[N files]" → `directCategoryBytes`; file → one share of its size).

`src/renderer/src/lib/treemap-draw.ts` (replaces the Phase 3 colour model):

- `export type TreemapContrast = 'normal' | 'more' | 'forced'`
- `export interface TreemapColors { categories: Record<FileCategory, string>; folder: string; free: string; freeHatch: string; edge: string; accent: string; halo: string; text: string; cushionInner: string; cushionOuter: string; contrast: TreemapContrast }`
- `readTreemapColors(element: Element): TreemapColors` reads `--treemap-<category>` for the ten categories, `--treemap-folder`, `--treemap-free`, `--treemap-free-hatch`, `--treemap-edge`, `--accent`, `--treemap-halo`, `--ink`, `--treemap-cushion-inner`, `--treemap-cushion-outer`, with the light values of spec §7.1 as fallbacks; `contrast` is `'forced'` when `matchMedia('(forced-colors: active)')` matches, else `'more'` when `matchMedia('(prefers-contrast: more)')` matches, else `'normal'` (guard `window.matchMedia` being absent → `'normal'`).
- `fillFor(rect, colors): string` — spec §4: `free` → `free`; `nested` → `folder`; `category === null` → `folder`; else `categories[category]`. In `'forced'`, always `'Canvas'`.
- `export const CUSHION_MIN_SIDE = 12`, `export const HATCH_SPACING = 6`, `export const TREEMAP_FONT = '12px "Segoe UI Variable Small", "Segoe UI", system-ui, sans-serif'`, `export const TREEMAP_HEADER_FONT = '600 ' + TREEMAP_FONT`.
- `rectLabel`, `hitTest` unchanged.
- `drawTreemap(ctx, layout, { colors, selectedId, mode, unit })` — same signature, new drawing (rules 7–9 below).

`src/renderer/src/components/TreemapLegend.tsx`: `export function TreemapLegend({ layout }: { layout: TreemapLayout | null })` and `export function legendItems(layout: TreemapLayout): LegendItem[]` with `type LegendItem = { kind: 'category'; category: FileCategory; label: string; share: number } | { kind: 'free'; label: 'Free space'; bytes: number } | { kind: 'mixed'; label: 'Mixed folders' }`.

`src/renderer/src/components/Button.tsx`: `ButtonVariant = 'primary' | 'secondary' | 'quiet'`. `src/renderer/src/components/Banner.tsx`: `export type BannerVariant = 'info' | 'danger' | 'warning' | 'success'`, `export const BANNER_VARIANT_CLASSES: Record<BannerVariant, string>` and `export const BANNER_ICONS: Record<BannerVariant, LucideIcon>` (`Info`, `CircleAlert`, `TriangleAlert`, `CircleCheck`), exported so Task 10’s `UpdateBanner` reuses them (it uses `info`).

**Rules:**

1. **Tokens.** Replace `color.light`, `color.dark` and `pairs` in `design/tokens.json` with the exact blocks of spec §7.1 and §7.2 (50 colours per theme, 164 pairs). Remove `shadow`; add `"elevation": { "light": {…}, "dark": {…} }` with `raised`, `menu`, `dialog` from spec §2.2. `radius` becomes `{ "control": 6, "panel": 10, "group": 12, "pill": 999 }`; `space` becomes `[0, 2, 4, 6, 8, 12, 16, 20, 24, 32]`; `motion.fast` `"120ms"`; `font` gains `"small": "'Segoe UI Variable Small', 'Segoe UI', system-ui, sans-serif"`; `type` becomes the five steps of spec §2.5 (`caption`, `label`, `body`, `title`, `heading`, each `{ size, line, weight }`). `layout`: `ribbon-body` 92, `ribbon-caption` 16, new `treemap-legend` 28. Update `_about` to mention the Strata spec.
2. **build-tokens.mjs:** emit `--elevation-<name>` for each `elevation.<theme>` entry inside the matching theme block (light in `:root`, dark in the `prefers-color-scheme: dark` block); emit `--family-small`, `--r-group`, `--r-pill`; drop `--elevation-menu` from the theme-less part. Keep the `--check` mode. Run `npm run tokens`.
3. **global.css mapping** (`@theme inline`): rename the sources (`--color-ink: var(--ink)`, `--color-ink-muted: var(--ink-muted)`, `--color-line: var(--line)`, `--color-line-strong: var(--line-strong)`); add `--color-raised`, `--color-ink-subtle`, `--color-accent-subtle`, `--color-focus`, `--color-bar-track`, and for each tone `--color-<tone>`, `--color-on-<tone>`, `--color-<tone>-subtle`; `--font-small`; `--radius-group`, `--radius-pill`; `--shadow-raised`, `--shadow-menu`, `--shadow-dialog`. (`--color-danger` keeps its name and now points at the new `danger`.) Base layer: `body` colour `var(--ink)`; `:focus-visible` outline `2px solid var(--focus)`. Add to the forced-colors block: `[role='row'][aria-selected='true'] { outline: 2px solid Highlight; outline-offset: -2px; }`. Keep `.popup-menu` as it is; add no other component CSS.
4. **window-options.ts:** `WINDOW_BACKGROUND = { light: '#f5f3ef', dark: '#151a21' }` (the existing test compares it to `surface-app`).
5. **Contrast report:** regenerate `design/contrast-report.txt` exactly as Task 1 did (header line, then the checker output); it must end with `164 pairs, 0 failing AA`. The checker is the design-system skill’s `contrast.py` (the first line of the Step 7 block finds it).
6. **Scanner categories** follow the Interfaces above. The treemap perf limit (`maxTreemapMs` 100) and memory limits (`maxBytesPerFile` 125) in `tree-store.perf.test.ts` must stay green unchanged; do not iterate a folder’s files to find its category (that is what `fDirectCategoryBytes` is for).
7. **Drawing order and geometry** (spec §4): clear; fill the whole canvas with `edge`; for each rect in order: if `w < 2` or `h < 2` skip it; the drawn box is the rect inset 1 px on every side (`x+1, y+1, w-2, h-2`); fill with `fillFor`; free space then gets the hatch (rule 8); then the cushion (rule 9); then the label exactly where Phase 3 put it (nested blocks use `TREEMAP_HEADER_FONT`, others `TREEMAP_FONT`; colour `text`; min 36 × 16 px; `fitText` unchanged; in `'forced'` the label colour is `'CanvasText'`). After all rects, the selection: `accent` 2 px stroke on the box inset 1 more px, then a 1 px `halo` stroke 2 px further in; in `'forced'`, a single 3 px `'Highlight'` stroke. In `'more'`: the gap fill uses `text` instead of `edge` (2 px ink separators) and there is no cushion. In `'forced'`: the gap fill is `'CanvasText'`, every box fill `'Canvas'`, no hatch, no cushion.
8. **Hatch:** clip to the box (`save`/`rect`/`clip`/`restore`), 1 px `freeHatch` lines at 45° (from bottom-left to top-right), every `HATCH_SPACING` px across the box.
9. **Cushion:** only for boxes with both sides ≥ `CUSHION_MIN_SIDE`, not nested, not free, contrast `'normal'`. `createRadialGradient(cx, cy, 0, cx, cy, r)` with `cx = x + 0.3w`, `cy = y + 0.25h`, `r = 0.95 × max(w, h)`, stops `0 → cushionInner`, `1 → cushionOuter`; fill the box with it. Light mode only lightens and dark mode only darkens (the token values do that); never add another stop.
10. **Theme and contrast redraws:** `TreemapPane` already redraws on `prefers-color-scheme` changes; add the same listener for `(prefers-contrast: more)` and `(forced-colors: active)`.
11. **Legend** (spec §5.5): `TreemapPane` renders `<TreemapLegend layout={shown?.layout ?? null} />` between the canvas wrapper and `LevelBar`, height `h-(--size-treemap-legend)`. `legendItems`: one `category` item per `layout.categories` entry with `share = bytes / sum(bytes)`; then a `free` item when a rect has `kind === 'free'` (bytes = that rect’s `value`); then a `mixed` item when any rect with `kind` `'folder'` or `'files'`, `nested === false`, has `category === null`. Markup: `<ul aria-label="File types in this folder">` with `<li>` items; the swatch is an `aria-hidden` `<span>` 10 × 10 px, `rounded-[3px]`, `border border-line-strong`, background `var(--treemap-<category>)` through an inline `style` (CSS variable only, never hex); the free swatch uses a `repeating-linear-gradient(45deg, var(--treemap-free-hatch) 0 1px, var(--treemap-free) 1px 4px)`; the mixed swatch `var(--treemap-folder)`. Text: label `text-ink`, share `text-ink-muted tabular-nums` via `formatShare`, free size via `formatBytes`. Nothing renders (the row stays, empty) when `layout` is null or has no items. Forced colors: swatches get `forced-colors:hidden`.
12. **Component restyle:** apply spec §5.1–§5.11 class by class. Keep every role, `aria-*`, focusgroup, keyboard behaviour, label text and test id exactly as it is; this task changes classes, the legend, the banner icon/variant and the drawing only. Specific points: `RIBBON_BUTTON_CLASS` and `RIBBON_SMALL_CLASS` keep their export names; the ribbon `Group` gets the pill + caption structure (the `role="group"` element wraps both, still named by the caption); the unit toggles get the segmented track wrapper (a plain `div`, no role); the Select and Expand menu triggers use `RIBBON_BUTTON_CLASS`; the selected tab’s accent bar is an `after:` pseudo-element; the tree drops `border-b border-line/60` from rows; the splitter’s rule and grip are `before:`/`after:` pseudo-elements; the status bar divider is an `aria-hidden` span; Banner maps `tone: 'error'` → `info` and `tone: 'crash'` → `danger`, shows `BANNER_ICONS[variant]` (`aria-hidden`), keeps `role="alert"`, Retry primary, Dismiss quiet; Dialog uses `shadow-dialog`, `bg-raised`, `backdrop:bg-(--backdrop)`.
13. **Docs:** `DESIGN.md` — replace the token table and the Principles with the Strata ones (short; link the spec), mention the file-type treemap and legend. `design/components.md` — update each component’s `states` and `tokens` lines to the new utilities and add a `Treemap legend` entry. No competitor names.

**Tests** (write first; names exact):

`src/shared/file-category.test.ts`:

- `has the ten categories in a fixed order` — `FILE_CATEGORIES` equals the list above; `CATEGORY_COUNT` is 10.
- `lists each extension once, in lower case, without a dot` — flatten `CATEGORY_EXTENSIONS`; no duplicates; every entry matches `/^[a-z0-9]+$/`.
- `reads the extension after the last dot` — `'Movie.MKV'` → `'mkv'`; `'backup.tar.gz'` → `'gz'`; `'.gitignore'` → `''`; `'README'` → `''`; `'trailing.'` → `''`.
- `maps names to categories` — one example per category from spec §3 (`'a.mp4'` video, `'b.HEIC'` image, `'c.flac'` audio, `'d.pdf'` document, `'e.7z'` archive, `'f.tsx'` code, `'setup.exe'` app, `'kernel32.dll'` system, `'win.iso'` disk-image, `'notes'` other, `'x.unknownext'` other).
- `finds the dominant category only above half` — `[60,40,0,…]` → `'video'`; `[50,50,0,…]` → `'video'` (exactly half, lower index wins); `[40,30,30,…]` → `null`; all zero → `null`.
- `orders category shares largest first and drops empty ones` — ties keep `FILE_CATEGORIES` order.

`src/worker/scanner/tree-store.test.ts` (add):

- `keeps logical bytes per file type for every folder` — root → `a/` with `x.mp4` (100) and `y.pdf` (50), root has `z.mp4` (10): `folderCategoryBytes(root)` video 110, document 50; `directCategoryBytes(root)` video 10 only; `fileCategoryOf` of `x.mp4` is 0.
- `removes a folder's file-type bytes from its ancestors on reset` — after `resetFolder(a)`, root’s video is 10 and document 0; `a`’s vectors are all 0.
- `grows the category columns with the folders` — add more than 1024 folders each with one `.mp3` file; root’s audio total equals the sum.

`src/worker/scanner/treemap.test.ts` (add):

- `colours files by type and folders by their dominant type` — a folder with 90 % video bytes gets `category 'video'`; a folder 40/30/30 gets `null`; a file `x.pdf` rect gets `'document'`; the "[N files]" rect gets the dominant of the direct files only.
- `reports the file-type bytes of the laid-out folder` — `categories` equals the expected sorted list and leaves out zero categories.
- `gives free space no category` — the free rect has `category: null`; the drive-root rect has the root’s dominant.

`src/renderer/src/lib/treemap-draw.test.ts` (rewrite the colour fixture for the new `TreemapColors`; keep the `rectLabel` and `hitTest` tests):

- `fills by category, frames nested and mixed folders, and marks free space` — `fillFor` cases for file/category, folder non-nested with category, folder nested (→ folder), category null (→ folder), free; and every fill is `'Canvas'` in `'forced'`.
- `draws blocks inset by 1 px over the gap colour` — a mock context records `fillRect` calls: first the full-canvas `edge`, then `(x+1, y+1, w-2, h-2)` for a rect.
- `adds the cushion only to large non-nested blocks in normal contrast` — `createRadialGradient` is called once for a 40 × 40 file block, not for a 10 × 40 block, not for a nested block, not in `'more'` or `'forced'`; its stops are `cushionInner` then `cushionOuter`.
- `hatches free space inside a clip` — `save`, `clip`, `restore` are called and `stroke` uses `freeHatch` for a free block; no hatch in `'forced'`.
- `outlines the selected block with the accent and a halo` — `strokeRect` with `accent` at line width 2, then `halo` at 1; `'Highlight'` at 3 in `'forced'`.
- `reads the contrast mode from the media queries` — stub `window.matchMedia` so forced-colors matches → `'forced'`; prefers-contrast more only → `'more'`; none → `'normal'`; no `matchMedia` → `'normal'`.

`src/renderer/src/components/TreemapLegend.test.tsx`:

- `lists file types by share with their percentages` — a layout with categories video 600, image 300, other 100 → items in that order with `60 %`, `30 %`, `10 %` (use `formatShare` for the expected text); the list is named "File types in this folder".
- `adds free space with its size and a mixed-folders key` — free rect value 2 GB → "Free space" with `formatBytes`; a non-nested folder rect with `category: null` → "Mixed folders" last.
- `renders an empty legend for no layout`.

`Button.test.tsx`: the secondary class now re-applies `aria-disabled:hover:bg-raised`; add `quiet keeps a transparent background when busy` (`aria-disabled:hover:bg-transparent`).

`TreemapPane.test.tsx`: add `shows the legend under the treemap` (the fake layout from `fake-api.ts`, which now carries `category` on both rects — `'video'` and `'image'` — and `categories: [{ category: 'video', bytes: 2 GB }, { category: 'image', bytes: 768 MB }]`).

Existing tests elsewhere must keep passing unchanged (roles, names, keyboard), except where they assert a removed class; update those to the new class and say which in the report.

- [ ] **Step 1: Tokens and contrast.** Edit `tokens.json` (rule 1), `build-tokens.mjs` (rule 2), run `npm run tokens`, regenerate the contrast report (rule 5). Expected: `164 pairs, 0 failing AA`; `node scripts/build-tokens.mjs --check` passes.
- [ ] **Step 2: Write the failing tests** above (shared, store, treemap, draw, legend, button, pane).
- [ ] **Step 3: Run them** — `npx vitest run src/shared src/worker/scanner src/renderer/src/lib/treemap-draw.test.ts src/renderer/src/components`. Expected: FAIL on the new tests.
- [ ] **Step 4: Implement the data path** — `tree-types.ts`, `file-category.ts`, `tree-store.ts`, `treemap.ts`, `fake-api.ts`. Run `npx vitest run src/shared src/worker/scanner` and `npm run test:perf`. Expected: PASS, perf limits unchanged.
- [ ] **Step 5: Implement the renderer** — `global.css`, `window-options.ts`, `treemap-draw.ts`, `TreemapLegend.tsx`, `TreemapPane.tsx`, then the component restyles (rule 12). Run the Step 3 command. Expected: PASS.
- [ ] **Step 6: Docs** — `DESIGN.md`, `design/components.md` (rule 13).
- [ ] **Step 7: Gates**

```powershell
npm run format
npm run format:check
node scripts/build-tokens.mjs --check
npm run lint
npm run typecheck
npx vitest run
npm run test:perf
# Then run the contrast checker on design/tokens.json, and the impeccable detect tool on src/renderer (JSON output).
```

Expected: all green; the checker prints `164 pairs, 0 failing AA`; impeccable prints `[]`.

- [ ] **Step 8: Check by eye** — `npm run dev` (after `Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue`), scan a folder with mixed media, and compare against spec §6 in light and dark (Windows Settings → Personalization → Colors). Also turn on a Windows contrast theme once: the treemap draws in system colours with a `Highlight` selection, the legend shows text only. Put two screenshots (light, dark) in the report — not in the repository.
- [ ] **Step 9: Commit**

```powershell
git add design/tokens.json design/tokens.css design/contrast-report.txt design/components.md DESIGN.md scripts/build-tokens.mjs src/renderer/src/styles/global.css src/main/window-options.ts src/shared/tree-types.ts src/shared/file-category.ts src/shared/file-category.test.ts src/worker/scanner/tree-store.ts src/worker/scanner/tree-store.test.ts src/worker/scanner/treemap.ts src/worker/scanner/treemap.test.ts src/renderer/src/test/fake-api.ts src/renderer/src/lib/treemap-draw.ts src/renderer/src/lib/treemap-draw.test.ts src/renderer/src/components/TreemapLegend.tsx src/renderer/src/components/TreemapLegend.test.tsx src/renderer/src/components/Ribbon.tsx src/renderer/src/components/RibbonButton.tsx src/renderer/src/components/MenuButton.tsx src/renderer/src/components/SelectMenu.tsx src/renderer/src/components/Button.tsx src/renderer/src/components/Button.test.tsx src/renderer/src/components/TreeGrid.tsx src/renderer/src/components/TreemapPane.tsx src/renderer/src/components/TreemapPane.test.tsx src/renderer/src/components/LevelBar.tsx src/renderer/src/components/Splitter.tsx src/renderer/src/components/StatusBar.tsx src/renderer/src/components/Banner.tsx src/renderer/src/components/Dialog.tsx
git commit -m "feat(design): Strata palette, pill ribbon and file-type treemap with legend and cushion shading"
```

Add any test file changed under "Existing tests" to the `git add` line. No AI attribution trailer.

**Open points for the owner (8c):** (1) a folder is coloured by its dominant type only at 50 % or more, otherwise it shows the neutral "mixed" frame — confirm, or choose plurality colouring; (2) folder colour and legend shares use logical size in every Mode, so they do not change when switching to File count or Allocated — confirm.

---

### Task 10: Install for all users and auto-update

**Implementer tier:** standard

**Decision (owner):** the installer offers “Only for me” or “Anyone who uses this computer” (the latter asks for elevation). The app updates itself from GitHub Releases; the owner publishes pre-releases first.

**Files:**

- Create: `src/main/updater/updater.ts`, `src/main/updater/updater.test.ts`, `src/renderer/src/components/UpdateBanner.tsx`, `src/renderer/src/components/UpdateBanner.test.tsx`, `.github/workflows/release.yml`, `docs/RELEASING.md`
- Modify: `electron-builder.yml`, `package.json` (and `package-lock.json`), `src/shared/ipc-contract.ts`, `src/main/ipc/parse-args.ts`, `src/main/ipc/app-handlers.ts` (+ `app-handlers.test.ts`), `src/main/index.ts`, `src/preload/index.ts` (+ `index.test.ts`), `src/renderer/src/stores/workspace-store.ts` (+ test), `src/renderer/src/App.tsx`, `src/main/self-test.ts` (flag check only, if needed)

**Dependency:** `npm install --save-exact electron-updater@6.8.12` (a runtime `dependency`, next to `koffi`: electron-vite keeps `dependencies` external and electron-builder packs them into `app.asar`; a dev dependency would be bundled into `out/main/index.js`, which electron-updater’s lazy `require` calls do not survive). Verified on npm on 2026-11-23: dist-tag `v26` = `6.8.12`, latest 6.x = 6.8.12 (the `latest` tag points at 6.8.11), built for electron-builder 26. Record the version used in the commit body. Do not upgrade electron-builder. If `npm install` reports a peer or engine conflict, stop and report; never use `--force`.

**Interfaces:**

- `ipc-contract.ts`: channel `'update:install': { args: []; result: void }`; event `'update:ready': UpdateReady` with `interface UpdateReady { version: string }` (exported); `StorageIQApi` gains `installUpdate(): Promise<void>` and `onUpdateReady(listener: (ready: UpdateReady) => void): Unsubscribe`.
- `parse-args.ts`: nothing new if `noArgs` is used for `update:install` (it is, via the existing helper); the handler lives in `app-handlers.ts` with `parseArgs: noArgs`.
- `src/main/updater/updater.ts` exports:
  - `UPDATE_FIRST_CHECK_DELAY_MS = 10_000`, `UPDATE_CHECK_INTERVAL_MS = 21_600_000` (6 h)
  - `interface UpdaterLike { autoDownload: boolean; allowPrerelease: boolean; autoInstallOnAppQuit: boolean; logger: unknown; on(event: 'update-downloaded', listener: (info: { version: string }) => void): unknown; on(event: 'error', listener: (error: Error) => void): unknown; checkForUpdates(): Promise<unknown>; quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void }`
  - `interface UpdaterDeps { autoUpdater: UpdaterLike; isPackaged: boolean; selfTest: boolean; version: string; send(event: 'update:ready', payload: UpdateReady): void; schedule(callback: () => void, ms: number): () => void  /* one-shot; returns cancel */; scheduleEvery(callback: () => void, ms: number): () => void; log(message: string, error?: unknown): void }`
  - `interface Updater { start(): void; install(): void; dispose(): void; readonly ready: UpdateReady | null }`
  - `hasPrereleaseTag(version: string): boolean` — true when the semver has a hyphen part (`0.2.0-beta.1`), false for `0.2.0`.
  - `createUpdater(deps: UpdaterDeps): Updater`
- Renderer: `UpdateBanner` component; store fields `updateReady: UpdateReady | null`, action `installUpdate(): Promise<void>`, and `dismissUpdate()`.

**Behaviours:**

1. **Installer** (`electron-builder.yml`, `nsis`): keep `oneClick: false`, `perMachine: false`, `allowToChangeInstallationDirectory: true`; set `allowElevation: true`. The installer then shows the “Only for me / Anyone who uses this computer” page; choosing the second triggers the UAC prompt. (Electron-builder: when `perMachine` is false and `allowElevation` is true, the page appears; verify this in the manual checks, and if the page does not appear, set `perMachine: false` with `oneClick: false` and read the electron-builder NSIS docs for the exact option before changing anything else.) The default per-user install directory stays `%LOCALAPPDATA%\Programs\StorageIQ`, per-machine uses `%ProgramFiles%\StorageIQ`.
2. **Publish block** in `electron-builder.yml`:

```yaml
publish:
  provider: github
  owner: hoaiphongle0505
  repo: storageiq
  releaseType: release
```

`npm run dist` keeps `--publish never`. electron-builder writes `latest.yml` next to the installer in `release/<version>/` and the `.blockmap` next to the `.exe`; electron-updater reads `app-update.yml`, which electron-builder generates into `resources/` from this block. 3. **Pre-release channel:** `allowPrerelease` follows the installed version’s channel: `autoUpdater.allowPrerelease = hasPrereleaseTag(version)`. A user on `0.2.0-beta.1` receives pre-releases and stable releases; a user on a stable version receives only stable releases. This matches how the owner publishes (pre-release first, stable after). Also set `autoUpdater.autoDownload = true` and `autoUpdater.autoInstallOnAppQuit = true` (an update that is downloaded installs at the next normal quit even if the banner is ignored). Document the choice in the file’s doc comment. 4. **`createUpdater` behaviour:**

1.  `start()` does nothing when `!isPackaged` or `selfTest` is true (and logs nothing, no timers, no listeners). Otherwise it configures `autoUpdater` as in rule 3, attaches the two listeners, schedules the first check `UPDATE_FIRST_CHECK_DELAY_MS` after `start()`, then repeats every `UPDATE_CHECK_INTERVAL_MS`.
2.  A check calls `autoUpdater.checkForUpdates()`; a rejection is logged with `log('Update check failed', error)` and never rethrown and never shown to the user. The `'error'` event is logged the same way.
3.  On `'update-downloaded'` with `info.version`, store `ready = { version }` and call `send('update:ready', ready)`; stop the periodic checks (nothing more to download).
4.  `install()` does nothing when `ready` is null; otherwise it calls `autoUpdater.quitAndInstall(false, true)` (not silent, run the app again after install).
5.  `dispose()` cancels both timers.
6.  **Main wiring** (`index.ts`): create the updater after the window exists: `createUpdater({ autoUpdater, isPackaged: app.isPackaged, selfTest: process.argv.includes(SELF_TEST_FLAG), version: app.getVersion(), send: sendEvent, schedule/scheduleEvery over setTimeout/setInterval returning cancel functions, log: (m, e) => console.warn(m, e) })`; `autoUpdater` comes from `import { autoUpdater } from 'electron-updater'` (CJS named export; use the form the package documents for ESM/CJS interop in an electron-vite main bundle, verify at build time). Call `updater.start()` once after `mainWindow` is created and `updater.dispose()` in `before-quit`. A renderer that loads after `update-downloaded` fired must still get the banner: when `mainWindow.webContents` emits `did-finish-load` and `updater.ready !== null`, send `update:ready` again. `app:get-info` is not changed.
7.  **IPC:** `update:install` handler in `app-handlers.ts` (`parseArgs: noArgs`, handler `() => deps.installUpdate()`), added to `AppHandlers`’s Pick and to `AppHandlerDeps` as `installUpdate(): void`. The existing registration pattern in `register.ts` applies the sender check; no handler bypasses it. Preload: `installUpdate: () => invoke('update:install')`, `onUpdateReady: (listener) => subscribe(ipcRenderer, 'update:ready', listener)`. The renderer never passes a version or a URL to main.
8.  **Renderer:** `UpdateBanner` renders nothing while `updateReady` is null. When set: a non-modal `role="status"` strip (not `role="alert"`, not a dialog, never takes focus) with the text `StorageIQ <version> is ready. Restart to update.`, a primary button `Restart` (calls `installUpdate()`), and a `Later` button (calls `dismissUpdate()`, hides the banner for the session). Place `<UpdateBanner />` next to `<Banner />` in `App.tsx`. The store subscribes to `api.onUpdateReady` with the other event subscriptions and unsubscribes in its dispose function. An `installUpdate` failure shows the existing error banner through `fail(error)`.
9.  **Errors:** the updater never opens a dialog and never throws into the main process; a failure is only a `console.warn` line.
10. **Release workflow** (`.github/workflows/release.yml`, tag-triggered; the owner pushes it, see rule 11): triggers on `push` of tags matching `v*`; permissions `contents: write`; runs on `windows-latest`; checkout, setup-node 24 with npm cache, `npm ci`, `npm run typecheck`, `npm test`, `npx electron-vite build`, `npx electron-builder --win --x64 --publish never`, `npm run test:packaged`; then creates or updates the GitHub release for the tag as a **pre-release** when the tag contains a hyphen and as a normal release otherwise (`gh release create "$TAG" --title "$TAG" --generate-notes [--prerelease]` guarded so a re-run uses `gh release upload --clobber`), and uploads exactly these three files from `release/<version>/`: `StorageIQ-Setup-<version>-x64.exe`, `StorageIQ-Setup-<version>-x64.exe.blockmap`, `latest.yml`. The workflow fails if any of the three is missing. The tag must equal `v` plus `package.json`’s version; the first step fails otherwise. Pre-release tags use `latest.yml` too: electron-updater picks the release’s own `latest.yml` per release.
11. **Docs** (`docs/RELEASING.md`): the release steps (bump `version` in `package.json`, commit, tag `vX.Y.Z` or `vX.Y.Z-beta.N`, push the tag, wait for the workflow, edit the release notes, publish pre-release, later promote), the channel rule of rule 3, what the three files are, how to test an update (rule 12), and a clearly marked section `## TODO: code signing (SignPath)` stating that the installer is **unsigned** today (Windows SmartScreen shows “unknown publisher”; electron-updater does not require a signature for GitHub-hosted updates, but a signed build is planned) and that SignPath signing is a later step. No such TODO appears in code or in `electron-builder.yml`.
12. **Workflow push permission:** the `gh` token in the owner’s environment lacks the `workflow` scope, so the agent cannot push `.github/workflows/release.yml`. The implementer commits the file locally; the **owner** pushes the branch through Git Credential Manager (a normal `git push` from a terminal where GCM is the credential helper). State this in the report. A release cannot be run until that push happens.
13. **Test release procedure** (for Task 9 and `docs/RELEASING.md`): build version N as `0.1.1-test.1`, install it; publish `0.1.1-test.2` as a pre-release by pushing its tag; start the installed app, wait about 10 s plus download time (the first check runs 10 s after start); the banner appears; Restart installs and relaunches the new version. No environment override or test hook may be added to the production update code; use the real timing.

**Tests (names exact):**

`src/main/updater/updater.test.ts` — fake `UpdaterLike` (records `on` listeners, `checkForUpdates` mock, `quitAndInstall` mock), fake timers:

- `does nothing when the app is not packaged` — `isPackaged: false`: `start()` registers no listener, schedules nothing, never calls `checkForUpdates`.
- `does nothing under --self-test` — `selfTest: true`, `isPackaged: true`: same.
- `configures auto download and the channel from the version` — `version '0.2.0-beta.1'` sets `allowPrerelease true`; `'0.2.0'` sets false; `autoDownload` true and `autoInstallOnAppQuit` true in both.
- `checks 10 seconds after start and then every 6 hours` — nothing at 9_999 ms; one call at 10_000; the second at 10_000 + 21_600_000; the third 6 h later.
- `a failed check is logged and not thrown` — `checkForUpdates` rejects; `log` receives `'Update check failed'` and the error; the next scheduled check still runs.
- `an updater error event is logged` — emit `'error'`; `log` called, `send` not called.
- `update-downloaded sends update:ready with the version` — `send` called once with `('update:ready', { version: '0.2.0' })`; `ready` equals that; later checks stop (advance 12 h: `checkForUpdates` not called again).
- `install quits and installs after an update is ready` — `quitAndInstall` called once with `(false, true)`.
- `install does nothing before an update is ready`.
- `dispose cancels the timers` — after `dispose()`, advancing 24 h calls nothing.
- `hasPrereleaseTag` cases: `0.1.0` false, `0.1.0-beta.1` true, `1.0.0-rc.1+build5` true, `1.0.0+build5` false.

`src/main/ipc/app-handlers.test.ts`: `update:install calls installUpdate`, and `rejects extra arguments` (`parseArgs(['x'])` throws `InvalidIpcArgumentsError`).

Contract tests: in the existing `src/main/ipc/register.test.ts` (or the file that already enumerates channels; read it) add `update:install` to the expectation that every channel has a handler and that an untrusted sender is refused for it. In `src/preload/index.test.ts`: `installUpdate invokes update:install with no arguments`, and `onUpdateReady subscribes to update:ready and returns an unsubscribe` (follow the neighbouring tests’ fake `ipcRenderer`).

`UpdateBanner.test.tsx` (Testing Library, `WorkspaceStoreProvider` as in other component tests):

- `renders nothing while no update is ready`.
- `shows the message with the version and a Restart button` — text `StorageIQ 0.2.0 is ready. Restart to update.`; the container has `role="status"`; it is not `role="alert"` and not `role="dialog"`.
- `Restart calls installUpdate`.
- `Later hides the banner` — after the click the banner is gone; the store’s `updateReady` is still set only until dismissed (dismiss sets a `updateDismissed` flag or clears the field; pick one and test it).
- `focus stays where it was when the banner appears` — focus an input, set `updateReady`; `document.activeElement` is unchanged.

`workspace-store.test.ts`: `update:ready sets updateReady`, `installUpdate calls the api`, `an install failure shows the error banner`.

- [ ] **Step 1: Write the failing tests** above.
- [ ] **Step 2: Run them** — `npx vitest run src/main/updater src/main/ipc src/preload src/renderer/src/components/UpdateBanner.test.tsx src/renderer/src/stores/workspace-store.test.ts`. Expected: FAIL.
- [ ] **Step 3: Install the dependency** (`npm install --save-exact electron-updater@6.8.12`), then implement contract, parse-args use, handler, updater, preload, store, banner, `App.tsx`, `index.ts` wiring.
- [ ] **Step 4: Update `electron-builder.yml`** (rules 1, 2) and write `release.yml` and `docs/RELEASING.md` (rules 9, 10).
- [ ] **Step 5: Run the same tests.** Expected: PASS.
- [ ] **Step 6: Gate** (common gate), then `npm run dist; npm run test:packaged`. Expected: both pass; `release/<version>/` contains the installer, its `.blockmap` and `latest.yml`, and `release/<version>/win-unpacked/resources/app-update.yml` names `hoaiphongle0505/storageiq`. Confirm `node_modules/electron-updater` is inside the packed app (`npx asar list release/<version>/win-unpacked/resources/app.asar | findstr electron-updater`).
- [ ] **Step 7: Commit** (with `release.yml` committed locally, not pushed)

```powershell
git add electron-builder.yml package.json package-lock.json src/shared/ipc-contract.ts src/main/ipc/app-handlers.ts src/main/ipc/app-handlers.test.ts src/main/ipc/register.test.ts src/main/updater/updater.ts src/main/updater/updater.test.ts src/main/index.ts src/preload/index.ts src/preload/index.test.ts src/renderer/src/stores/workspace-store.ts src/renderer/src/stores/workspace-store.test.ts src/renderer/src/components/UpdateBanner.tsx src/renderer/src/components/UpdateBanner.test.tsx src/renderer/src/App.tsx .github/workflows/release.yml docs/RELEASING.md
git commit -m "feat(release): all-users installer option and auto-update from GitHub Releases"
```

**Manual checks for Task 9 (add to its checks-by-eye list):**

1. **Per-machine install:** run the installer, pick “Anyone who uses this computer”; the UAC prompt appears; the app installs under `C:\Program Files\StorageIQ`; a second Windows user sees the Start-menu shortcut; uninstall from Settings → Apps works.
2. **Per-user install:** pick “Only for me”; no UAC prompt; installs under `%LOCALAPPDATA%\Programs\StorageIQ`.
3. **Update N to N+1:** with the test release procedure of rule 12 (`0.1.1-test.1` → `0.1.1-test.2`, both pre-releases): the banner “StorageIQ 0.1.1-test.2 is ready. Restart to update.” appears without a modal; Later hides it; Restart installs and relaunches on the new version; check this once for a per-user and once for a per-machine install (the per-machine update asks for UAC again).
4. **Dev and self-test:** `npm run dev` and `StorageIQ.exe --self-test` make no network request to GitHub (no updater timer starts).
5. **Offline:** with the network off, the app runs normally and shows no error.

---

### Task 11: Multi-select and non-blocking Explorer actions

**Implementer tier:** standard (Win32/koffi worker thread, COM, ARIA treegrid selection; build it in the order of the steps, native part last)

**Why (owner feedback from a preview build):** (1) “Cannot delete several items at the same time”: the tree selects one row only. (2) “Can’t do anything while this window is shown”: choosing Delete in the Explorer menu makes Windows show its “Preparing to recycle / Discovered N items” dialog and the whole app freezes until it ends, because `win-shell-menu.ts` calls `IContextMenu::InvokeCommand` synchronously on Electron’s main (UI) thread. Both are fixed here: many rows can be selected and acted on at once, and no shell operation runs on the UI thread any more.

**Spike evidence (Windows 11 Pro 10.0.26200, Node 22, koffi 3.3.8; log in `RESULTS.md` of the spike, summarised here so the task is self-contained).** Test item: a folder with 3000 small files, delete verb, Recycle Bin.

| Design                                                                                            | UI-thread timer max gap                    | Result                                                                                               |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| current: `InvokeCommand` on the UI thread                                                         | 4.4 s (frozen)                             | baseline                                                                                             |
| `CMIC_MASK_ASYNCOK` on the UI thread                                                              | 20 s (frozen)                              | **rejected**: the delete verb ignores it and runs the copy engine inside `InvokeCommand`             |
| menu build + track + invoke on a dedicated STA **worker thread** with its own hidden owner window | 57 ms steady, 195 ms on the first start-up | **chosen**; the shell still shows its progress dialog, items recycled                                |
| same, owner = the main window’s HWND                                                              | 57 ms                                      | works, but not chosen (an operation must never be able to disable or attach input to the app window) |
| `IFileOperation` (`FOF_ALLOWUNDO`, `FOFX_RECYCLEONDELETE`) on a worker                            | 53 ms                                      | works; used only as the fallback for mixed-folder selections when the shell menu cannot be built     |

Further spike facts the rules rely on: `TrackPopupMenuEx` works from the worker’s own hidden window (popup visible, UI thread kept ticking), koffi callbacks (`SetWindowSubclass` proc) fire on the worker thread, and `GetKeyState` is per-thread input state so the worker must use `GetAsyncKeyState`. Multi-item menus: for items in **one** folder, `IShellFolder::GetUIObjectOf` with all child ids gives the full menu (Open, Edit, Print, third-party verbs, Copy as path, Share, Send to, Cut, Copy, Create shortcut, Delete, Properties). For items in **different** folders: `IShellItemArray::BindToHandler(BHID_SFUIObject)` fails with `E_FAIL`; `SHCreateDefaultContextMenu` with `psf` = the desktop folder and `apidl` = absolute PIDLs works and its Delete recycled files in several folders (verified in the Recycle Bin records), but the menu is reduced (Open, third-party verbs, Cut, Copy, Create shortcut, Delete, Properties; no Send to, Copy as path, Share, Open with). Two hazards were found and are forbidden below: using the first item’s parent folder with PIDLs from other folders returns a menu without error but would act on wrong names, and `GetUIObjectOf` on the desktop folder with absolute PIDLs returns `S_OK` while its Delete silently does nothing.

**Decisions (owner can overrule, see Open questions):**

- Selection model: APG multi-select treegrid. The **active row** (focused row, what `aria-activedescendant` names, what the treemap highlights) is separate from the **selection** (a set that includes the active row when it is selected).
- The root row and “[N files]” group rows can be selected (highlighted, status-bar totals) but are never part of an action set when more than one row is selected, and the root is never a delete target even alone (rule 13).
- One native shell worker thread **per in-flight action**, at most 3 at once; a 4th request answers `{ kind: 'busy' }`. A second Explorer action while one runs is therefore allowed.
- Cap: an action takes at most 1,000 items (`MAX_ACTION_ITEMS`).
- Open in Explorer, New folder, Enter and Ctrl+N act on exactly one row; with several rows selected they are disabled or do nothing (with a short announcement). Copy path (menu item and Ctrl+C) copies all selected paths, one per line, in tree order.

**Files:**

- Create: `src/renderer/src/lib/selection.ts` (+ `selection.test.ts`), `src/main/shell-menu/shell-worker.ts` (the worker entry), `src/main/shell-menu/shell-worker-protocol.ts`, `src/main/shell-menu/shell-worker-pool.ts` (+ `shell-worker-pool.test.ts`), `src/main/shell-menu/win-shell-menu.native.test.ts` (win32-only)
- Modify: `src/shared/ipc-contract.ts`, `src/main/ipc/parse-args.ts` (+ test), `src/main/ipc/shell-handlers.ts` (+ `shell-handlers.test.ts`), `src/main/ipc/item-watcher.ts` (+ test), `src/main/shell-menu/context-menu.ts` (+ test), `src/main/shell-menu/win-shell-menu.ts`, `src/main/shell-menu/menu-commands.ts` (+ test), `src/main/index.ts`, `src/preload/index.ts` (+ test), `src/renderer/src/stores/workspace-store.ts` (+ test), `src/renderer/src/components/TreeGrid.tsx` (+ test), `src/renderer/src/components/StatusBar.tsx` (+ test), `src/renderer/src/components/Ribbon.tsx` (+ test), `src/renderer/src/test/fake-api.ts`, `electron.vite.config.ts`, `electron-builder.yml`, `scripts/check-packaged-app.mjs`, `e2e/workspace.spec.ts` (+ `e2e/support/fixture.ts` if a second folder is needed). Another change set may be open on some of these files: start from the current working tree and keep its edits.

**Interfaces:**

`ipc-contract.ts`

- `'shell:context-menu': { args: [scanId: string, nodeIds: NodeId[], x: number, y: number, extended: boolean]; result: ContextMenuOutcome }` (the single `nodeId` becomes a list; `StorageIQApi.showContextMenu(scanId, nodeIds, x, y, extended)` and the preload follow).
- `ContextMenuOutcome` gains `{ kind: 'busy' }` and `count: number` on `shell` and `copied`; `shell` also gains `running: boolean` (true when the command is still running in the worker at the time the outcome is returned). `refreshed`, `gone`, `opened`, `created`, `dismissed` are unchanged.
- No new channel or event. `shell:open-in-explorer`, `folder:create`, `clipboard:copy-path` keep a single node id.

`parse-args.ts`: `export const MAX_ACTION_ITEMS = 1000`; `nodeIdListArg(value: unknown, max: number): NodeId[]` (an array of 1..max valid node ids; otherwise `InvalidIpcArgumentsError('expected 1 to 1000 tree node ids')`); `contextMenuArgs` returns `[string, NodeId[], number, number, boolean]`. The parser does not dedupe.

`menu-commands.ts`: `StorageIQMenuItem` gains `'delete'` (id 5, label `Delete (move to Recycle Bin)`, only used by the fallback menu of rule 9); `STORAGEIQ_MENU_LABELS['copy-path']` becomes `&Copy path` for one item and `&Copy paths` for several (export `storageiqMenuLabels(count: number, sameFolder: boolean)` returning the items to show: one item = today’s four; several = Refresh, Copy paths only).

`shell-worker-protocol.ts` (the only contract between main and the worker; plain JSON-serialisable):

- to the worker: `{ type: 'show'; id: number; paths: string[]; x: number; y: number; extended: boolean; hideDestructive: boolean }` (x, y screen pixels, paths come from the scanner only);
- from the worker: `{ type: 'chosen'; id: number; choice: ShellMenuChoice }` (sent as soon as the menu closes, **before** the command runs), `{ type: 'finished'; id: number; ok: boolean; hresult?: number; step?: string }` (sent when `InvokeCommand` or `PerformOperations` returned; for `dismissed` and StorageIQ items it is sent right after `chosen` with `ok: true`), `{ type: 'failed'; id: number; hresult: number; step: string }` (the menu could not be built; maps back to `ShellMenuError`).

`context-menu.ts`: `ShellMenuNative` (sync `build`) is replaced by

```ts
export interface ShellMenuHost {
  /** One menu for `paths` (1..1000). `chosen` resolves when the menu closes; `finished` when the shell command returned. Neither blocks the UI thread. */
  show(request: ShellMenuRequest): {
    chosen: Promise<ShellMenuChoice>
    finished: Promise<ShellFinish>
  }
  dispose(): void
}
export type ShellFinish = { ok: true } | { ok: false; hresult: number; step: string }
```

`ShellMenuRequest` becomes `{ paths: string[]; x: number; y: number; extended: boolean; hideDestructive: boolean }` (no `hwnd`: the owner is the worker’s hidden window). `ShellMenuChoice` is unchanged. The `BuiltShellMenu` interface and the synchronous `showShellMenu` are deleted; the logic moves into the worker, where `build/track/verb/invoke/release` stay as internal steps of `win-shell-menu.ts` (still testable through the fake in tests of the worker’s orchestration function `runShellRequest(native, request, post)`).

`shell-worker-pool.ts`: `createShellWorkerPool(deps: { spawn(): WorkerLike; maxWorkers: number /* 3 */; idleMs: number /* 30_000 */; schedule(cb, ms): () => void }): ShellMenuHost`, with `WorkerLike { postMessage(m): void; on('message'|'error'|'exit', cb): void; terminate(): Promise<number> }`. One worker serves one request at a time; an idle worker is reused; a new one is spawned while fewer than `maxWorkers` are busy; otherwise `show` rejects with `ShellBusyError` (a class exported from the file; the handler turns it into `{ kind: 'busy' }`). A worker that errors or exits while serving a request rejects that request’s `chosen` (or resolves `finished` with `{ ok: false, hresult: 0x80004005, step: 'worker' }` if it was already chosen) and is discarded; the pool never throws into the main process.

`item-watcher.ts`: `watchMany(request: { key: string; itemPaths: readonly string[]; isCurrent(): boolean; onSettled(reason: 'gone' | 'timeout', remaining: readonly string[]): void }): void`: at most 1,000 paths (more throws `RangeError`); each tick checks the paths still present with at most 16 `pathExists` calls in flight; settles `'gone'` when none remain, `'timeout'` after `ITEM_WATCH_TIMEOUT_MS`; same `key`/`isCurrent`/`cancelAll` semantics as `watch`. `watch` stays and is implemented on top of `watchMany`.

`shell-handlers.ts` deps: `showShellMenu(request: ShellMenuRequest): ReturnType<ShellMenuHost['show']>` replaces the old `showShellMenu` dep (the handler converts nothing: `index.ts` converts window CSS pixels to screen pixels before calling the host).

Renderer `selection.ts` (pure, no React): `interface Selection { ids: ReadonlySet<NodeId>; activeId: NodeId | null; anchorId: NodeId | null }`; `single(id)`, `toggle(sel, id)`, `rangeTo(sel, visibleIds: readonly NodeId[], toId, additive: boolean)`, `selectAll(visibleIds)`, `extendBy(sel, visibleIds, delta)`, `orderedIds(sel, visibleIds)`; `dropDescendants(ids, parentOf: (id) => NodeId | null)`; `selectionTotal(ids, rowOf: (id) => TreeRow | null): { count: number; bytes: number; unknown: number }`.

Store: `selectedIds: ReadonlySet<NodeId>`, `anchorId: NodeId | null` added; `selectedId` stays and **is the active row** (every existing consumer, the treemap and the Ribbon keep working unchanged); invariant: `selectedId` is in `selectedIds` or `selectedIds` is empty (after “Ctrl+click off” the active row may be outside the set). New actions: `setSelection(sel: Selection): void` (also sets `treemapRootId` like `select`), `showContextMenu(ids: NodeId[], x, y, extended)`, `copyPaths(ids)`. `select(id)` = `setSelection(single(id))`.

**Rules:**

_Renderer: selection (TreeGrid)_

1. The treegrid has `aria-multiselectable="true"` and **every** data row has `aria-selected` `"true"` or `"false"` (never omitted). The loading rows and header keep none. `aria-activedescendant` names the active row.
2. The active row is visually distinct from selected rows: selected = `bg-selection` plus the inset accent bar (as today); active = an additional 2 px inset focus ring (`outline-offset: -2px`, token `--accent`) shown while the grid has focus, and under `forced-colors` the ring uses `Highlight`/`CanvasText` so it survives. A row that is active and selected shows both; a row that is active and unselected shows only the ring. Contrast of selected text stays on the existing tokens (no new colour; run `impeccable detect --json src/renderer`, expected `[]`).
3. Mouse: a plain click selects only that row (`single`), sets the anchor. Ctrl+click toggles the row in the set and moves the active row to it, anchor = that row. Shift+click selects the range from the anchor to the clicked row in **visible order** (loading rows are skipped; collapsed descendants are not visible and are not included), replacing the set; Ctrl+Shift+click adds the range to the existing set. Shift/Ctrl clicks never toggle expansion, and the chevron click still only toggles expansion. Double-click still expands/collapses.
4. Keyboard (the grid has focus; rows never take focus): Arrow Up/Down, Home, End, PageUp/PageDown move the active row and select only it. **Shift+** those keys extend the range from the anchor to the new active row. **Ctrl+Arrow Up/Down** (and Ctrl+Home/End, Ctrl+PageUp/PageDown) move the active row without changing the set. **Space** toggles the active row; **Ctrl+Space** is the same. **Ctrl+A** selects every visible row (loaded, non-loading); **Ctrl+Shift+Home/End** extends the selection to the first/last visible row. **Escape** with more than one row selected reduces the selection to the active row. Arrow Right/Left keep expanding/collapsing the active row (Shift+Arrow Right/Left do nothing). Enter and Ctrl+N and Ctrl+C: see rule 14. Shift+F10 and the Menu key open the menu for the selection (rule 8).
5. `aria-selected`/set membership of rows that are scrolled out of the virtual window is kept in the set, so scrolling never loses selection. The DOM keeps its virtualisation; membership is a `Set` lookup per rendered row (no per-row store subscription).
6. Right-click: if the clicked row is in the selection, the menu acts on the whole selection and the active row becomes the clicked row (the set is not changed); otherwise the selection becomes that row alone first (as Explorer does), then the menu opens. The menu always opens only on an explicit right-click, Shift+F10 or the Menu key (unchanged security rule).
7. Selection lifetime: the set is cleared to the root row on a new scan, rescan or Select. It survives chunk reloads and `revision` bumps (it holds ids, not rows). On `tree:changed` the store prunes it: for at most 200 selected ids it calls `api.getNode(scanId, id, …)` with at most 8 in flight and removes ids that return `null` (rows that vanished); with more than 200 ids it keeps only the active row. Pruning ignores a result if `scanId` or the revision changed meanwhile. If the active row vanishes, the active row becomes the first remaining selected row, or null. After a shell command whose `choice.verb` is `delete` the set is reduced to the active row at once (the rows leave when the refresh lands). **Known limitation, accepted:** ids of rows inside a refreshed folder may be renumbered by the scanner; pruning with `getNode` therefore may drop selected rows of that folder; it never keeps a stale id because every use re-resolves ids in main.
8. Actions use the selection in **tree order** (the order of the visible model, rows not currently visible placed after the visible ones in id order). `Shift+F10`/Menu key: `showContextMenu(orderedIds, x, y, extended)` where x, y are the active row’s bottom-left (as today). If the set is empty the active row is used. A set over 1,000 ids after `dropDescendants` shows the announcement `Too many items selected (the limit is 1,000).` and does nothing.
9. Treemap: highlights the **active row only** (decision: a selection can span unrelated folders; the treemap is a navigation aid, not a selection view). Its click still selects one row (`single`), double-click still drills. `treemapRootId` follows the active row as today.
10. Group rows `[N files]` and the root: selectable and counted in the status bar. In an action set of more than one row they are dropped in main (rule 12) and a one-line announcement says `Skipped 2 rows that cannot be acted on.` (renderer-side, from the outcome `count` being smaller than the number sent: `Skipped N rows that cannot be acted on.`).
11. Status bar: when the set has more than one row it shows `N items selected, total size X` (X by `formatSize(bytes, unit)` over the **Size** column bytes, not the Mode value; descendants of selected folders are not added twice, using `dropDescendants` over the loaded parent chain); rows whose data is not loaded count in `N` and are summed as soon as they load; if any row is unknown the text is `N items selected, total size at least X`. The text is in the polite live region used by `announcement` throttled like the scan progress (one update per 500 ms at most, never while the user drags a range). For one selected row nothing is added.

_Main: IPC and orchestration_

12. `shell:context-menu` handler: (a) parse (rule above); (b) check the current scan once; (c) dedupe ids, resolve each with `resolveScanNode`, at most 8 in flight; a node that no longer resolves is dropped, and if none resolve the outcome is `gone`; (d) when more than one row remains drop root and `files` rows and every row that has a selected ancestor (`details.ancestorIds` contains another selected id); with exactly one row requested keep today’s behaviour for it (root and group rows included); (e) check existence of each path with `pathExists` (at most 16 in flight); vanished items are dropped and their folders refreshed quietly; none left → `gone`; (f) the paths handed to the host are the scanner’s `details.path` values only, in the order of the request. The renderer never sends a path.
13. `hideDestructive: true` is sent when the single requested row is the root (or a drive root): the worker removes the `delete`, `cut` and `rename` items of the shell menu with `DeleteMenu(…, MF_BYCOMMAND)` after `QueryContextMenu`, so the root cannot be deleted from StorageIQ’s menu.
14. Other actions with several rows: `open` and `new-folder` items are not offered (rule 9’s item set); `copy-path` writes every path joined with `\r\n`, outcome `{ kind: 'copied', count }`; `refresh` refreshes each distinct containing folder (rule 17) and returns `{ kind: 'refreshed', nodeId }` for the first. Enter and Ctrl+N act only when exactly one row is selected; with several rows they announce `Select a single item first.` Ctrl+C works with any number of rows: it copies the paths of the selection (one path for one row) through `copyPaths`. `shell:open-in-explorer` is never sent for several rows; the Ribbon’s Open in Explorer and New folder buttons are disabled while more than one row is selected.
15. Outcome timing: `host.show` returns `{ chosen, finished }`. The handler awaits `chosen` only. For a shell verb it returns `{ kind: 'shell', verb, changed, count, running: true }` **immediately** and continues in the background (rule 16–17); the renderer announces `Windows is working on N items…`. The IPC call therefore never waits for a long operation, and a second right-click is possible while the first operation runs.
16. Background continuation, per verb class (existing constants kept): **delete** (`verb === 'delete'`): wait for `finished`; on `{ ok: true }` or a failure with `hresult` of a cancelled or partial operation (`0x80270000` family, `ERROR_CANCELLED`, or any error) run the refresh of rule 17 once anyway (items may be partly gone), then a second refresh after `SECOND_REFRESH_DELAY_MS`; failures are logged with `deps.warn`, never thrown. **cut, rename and unknown (`null`)**: do not wait for `finished`; start `watcher.watchMany` on all item paths immediately, settle on all gone or the 15 s timeout, then rule 17 once (a timeout at the root skips the refresh, as in 8a). **Other changing verbs** (`paste`, `newitem`, `link`, third-party): immediate refresh plus one delayed (rule 17), as today. Read-only verbs: nothing. All timers and watches use a key `${scanId}:${actionSeq}` (a counter in the handler) so they cannot collide, and a new scan cancels them (existing `isCurrent`).
17. Refresh set: `parents` = the distinct `containingFolder(details)` of the items. If there are more than 50, replace them by their deepest common ancestor (longest common prefix of the `ancestorIds` chains). A parent equal to the root means a **rescan** of the root path (existing `refreshFolder` behaviour): it runs once per action, and only if at least one root-level item no longer exists. Other parents are refreshed **one at a time** through a small FIFO inside the handler (a rescan of the same folder is never started twice concurrently; a folder already queued is not queued again), each failure logged. The scanner stays responsive because `refreshFolder` is already asynchronous; the renderer receives one `tree:changed` per parent.
18. Concurrent actions: the pool allows 3 at once. While a delete is running, a new menu on any row is allowed. If the same item is still being deleted, the later `pathExists` check may still say it exists; Windows then shows its own error, nothing in StorageIQ breaks. A `ShellBusyError` returns `{ kind: 'busy' }`; the store announces `Windows is still working on earlier actions. Try again in a moment.`

_Native (worker thread)_

19. `electron.vite.config.ts` builds `src/main/shell-menu/shell-worker.ts` as its own self-contained CJS bundle `out/main/shell-worker.js`, the same way `walkerBundle` builds `walker.js` (generalise the plugin to a list of worker entries); `electron-builder.yml` adds `out/main/shell-worker.js` to `asarUnpack` (a worker thread loads a real file); `scripts/check-packaged-app.mjs` expects exactly `shell-worker.js` and `walker.js` unpacked (`unpackedFiles.join()` equals `shell-worker.js,walker.js`) and `--self-test` additionally starts the pool, builds (not shows) a menu for `os.tmpdir()` and checks the labels, so a missing bundle fails the packaged check. `index.ts` creates the pool lazily with `spawn: () => new Worker(shellWorkerPath)` and calls `dispose()` (terminate all) in `before-quit`.
20. Worker thread: `CoInitializeEx(COINIT_APARTMENTTHREADED)`, creates one hidden top-level window (built-in `STATIC` class, never shown, never parented to the app window) used as owner for `GetUIObjectOf`, `TrackPopupMenuEx`, the menu-message subclass and `CMINVOKECOMMANDINFOEX.hwnd`. It handles one request, then waits for the next message. The window subclass and `koffi.register` callback live exactly as long as `TrackPopupMenuEx` (as today). Modifier keys are read with `GetAsyncKeyState` right after `TrackPopupMenuEx` returns (not `GetKeyState`). All COM objects (menu, `IContextMenu` 2/3, PIDLs, folder) are released after `InvokeCommand` has returned, on the same thread, in `finally`. Nothing outlives the call: no `ASYNCOK`.
21. Menu source by selection (all in the worker, decided from `path.win32.dirname` of the paths, case-insensitive): **one path**: today’s code unchanged. **Several paths with the same parent**: `SHBindToParent` of the first, `GetUIObjectOf(parent, n child ids)` (full menu). **Several paths with different parents**: `SHCreateDefaultContextMenu` with `DEFCONTEXTMENU { hwnd: owner, psf: desktop folder from SHGetDesktopFolder, cidl: n, apidl: absolute PIDLs from SHParseDisplayName }`, `IID_IContextMenu`. It is forbidden to (a) call the first item’s parent `GetUIObjectOf` with PIDLs of other folders, (b) call the desktop folder’s `GetUIObjectOf` with absolute PIDLs, and (c) rely on `IShellItemArray`+`BHID_SFUIObject` for several folders (all three were shown unsafe or failing in the spike); a comment at the code states this and cites `RESULTS.md`’s findings in one line.
22. Fallback: if `SHCreateDefaultContextMenu` fails with a failing `HRESULT` the worker builds a StorageIQ-only popup: submenu `StorageIQ` (Refresh, Copy paths) plus `Delete (move to Recycle Bin)` (id `STORAGEIQ_COMMAND_IDS.delete`). Choosing Delete runs `IFileOperation` (`CoCreateInstance(CLSID_FileOperation)`, `SetOperationFlags(FOF_ALLOWUNDO | FOFX_ADDUNDORECORD | FOFX_RECYCLEONDELETE)`, `SetOwnerWindow(owner)`, `DeleteItems(IShellItemArray from SHCreateShellItemArrayFromIDLists)`, `PerformOperations`, `GetAnyOperationsAborted`) on the worker; `choice` is `{ kind: 'shell', verb: 'delete', changed: true }`, `finished` follows `PerformOperations`. The Recycle Bin flag is always set; there is never a permanent-delete path in StorageIQ.
23. `SHELL_PATH_GONE_HRESULTS` mapping stays: a build failure with `0x80070002/3` returns `{ type: 'failed' }` and the handler treats it as `gone` for that request (all items if several fail the same way; for several items, `QueryContextMenu` failures are not per item: the handler then re-checks existence of each path and, if some are gone, retries once with the remaining paths).
24. Foreground: the worker calls `SetForegroundWindow(owner)` before `TrackPopupMenuEx` as today; main does not call `window.focus()`. If the menu does not close on an outside click (symptom of a refused foreground switch) the implementer reports it (manual check 4); nothing else is changed.
25. Crash note (state it in the file’s doc comment): a worker thread isolates blocking but not native crashes: a faulty shell extension that crashes would still take the process down. A `utilityProcess` host would isolate it too but needs `AllowSetForegroundWindow` plumbing; not done here (Open question 3).

**Tests (names exact, grouped by file):**

`src/renderer/src/lib/selection.test.ts` (pure):

- `single replaces the set and sets the anchor`
- `toggle adds and removes a row and moves the active row`
- `toggle off the active row leaves the active row on it`
- `rangeTo selects anchor to target in visible order, both directions`
- `rangeTo skips ids that are not visible`
- `rangeTo with additive keeps the existing set`
- `selectAll takes every visible id and keeps the active row`
- `extendBy moves the active row and extends from the anchor`
- `extendBy clamps at the first and last row`
- `orderedIds returns tree order and appends ids that are not visible`
- `dropDescendants removes rows whose ancestor is selected`
- `selectionTotal sums sizes, counts unknown rows and does not double count children`

`TreeGrid.test.tsx` (Testing Library, fake store, like the existing tests; rows come from the existing fixture lists):

- `the grid is multiselectable and every row has aria-selected`
- `click selects one row and clears the others`
- `ctrl click toggles a row without clearing the others`
- `shift click selects a range in visible order`
- `shift click ignores collapsed descendants`
- `ctrl shift click adds a range`
- `ctrl A selects all visible rows`
- `shift arrow down extends the selection by one row`
- `ctrl arrow moves the active row without changing the selection`
- `space toggles the active row and ctrl space does too`
- `escape reduces a multi selection to the active row`
- `the active row has a focus ring that differs from the selected style` (class/attribute assertion: `data-active` present only on the active row)
- `the selection survives a chunk reload`
- `right click inside the selection opens the menu for all selected rows` (the store’s `showContextMenu` receives the ordered ids)
- `right click outside the selection selects that row and opens the menu for it`
- `shift F10 opens the menu for the whole selection at the active row`
- `selecting more than 1000 rows announces the limit and opens no menu`
- `enter with several rows announces select a single item first`

`StatusBar.test.tsx`: `shows N items selected and the total size for several rows`, `shows total size at least X when a selected row is not loaded`, `shows nothing extra for one row`, `does not double count a child of a selected folder`.

`workspace-store.test.ts`: `setSelection keeps selectedId as the active row`, `select resets the set to one row`, `a new scan clears the selection to the root`, `tree:changed prunes selected ids that no longer resolve` (fake `getNode` returns null for one id), `more than 200 selected ids collapse to the active row on tree:changed`, `a result that arrives after a new scan is ignored`, `showContextMenu sends all ids in order`, `a busy outcome announces the busy message`, `a shell outcome announces that Windows is working on N items`, `a delete outcome reduces the selection to the active row`, `copyPaths announces the count`.

`Ribbon.test.tsx`: `Open in Explorer and New folder are disabled while several rows are selected`.

`parse-args.test.ts`: `contextMenuArgs accepts 1 id and 1000 ids`, `contextMenuArgs rejects an empty list`, `contextMenuArgs rejects 1001 ids`, `contextMenuArgs rejects a non-array, a non-string id and an id with a bad pattern`, `contextMenuArgs rejects the old single-id form`, `contextMenuArgs still validates x, y and extended`.

`shell-handlers.test.ts` (fake host whose `chosen`/`finished` are controllable promises, fake scan service, fake watcher, fake `refreshFolder` recording calls):

- `resolves every id through the scan and passes only scanner paths to the host`
- `dedupes ids and drops descendants of a selected ancestor`
- `drops the root and group rows when several rows are requested`
- `keeps a single root request and sends hideDestructive`
- `drops ids that no longer resolve and returns gone when none do`
- `drops vanished paths, refreshes their folder and continues with the rest`
- `returns the shell outcome as soon as the menu closes while the command is still running`
- `delete: refreshes each affected parent once after finished, then once more after the delay`
- `delete: a failed finished still refreshes and logs the error`
- `delete with items in 60 folders refreshes their common ancestor instead`
- `delete with an item at the root refreshes the root once and only when an item is gone`
- `refreshes a parent that appears twice only once`
- `a refresh for the same folder is never started while another is in flight`
- `cut and rename start a watchMany on all paths and refresh on settle`
- `other changing verbs refresh now and once more after the delay`
- `a new scan cancels the pending refreshes`
- `a second request is served while the first is still running`
- `a ShellBusyError returns the busy outcome`
- `copy-path with several rows writes all paths joined by CRLF in request order and returns the count`
- `open-in-explorer and new-folder are not offered for several rows` (the host receives the item set from `storageiqMenuLabels(n, …)`)
- `refresh with several rows refreshes each distinct containing folder`
- `a request of 1001 items never reaches the handler` (parser)

`item-watcher.test.ts`: `watchMany settles gone when every path is gone`, `watchMany reports the remaining paths on timeout`, `watchMany checks at most 16 paths at a time`, `watchMany refuses more than 1000 paths`, `watch still behaves as before` (the existing cases keep passing).

`menu-commands.test.ts`: `storageiqMenuLabels offers four items for one row and Refresh plus Copy paths for several`, `delete is classified as a StorageIQ command with id 5`.

`context-menu.test.ts` and `shell-worker-pool.test.ts` (fake `WorkerLike`, fake timers):

- `a request is posted to an idle worker and resolves chosen then finished`
- `chosen resolves before finished`
- `a second request while the first runs spawns a second worker`
- `the fourth concurrent request rejects with ShellBusyError`
- `an idle worker is terminated after the idle time and a later request spawns a new one`
- `a worker that exits mid-request rejects chosen with a plain Error`
- `a worker that exits after chosen resolves finished with ok false`
- `a failed message becomes a ShellMenuError with the hresult`
- `dispose terminates every worker and rejects pending requests`

`shell-worker.test.ts` (`runShellRequest` with a fake native that records calls): `one path uses the single item route`, `paths in one folder use one parent with all child ids`, `paths in several folders use the default menu route`, `a failed default menu falls back to the StorageIQ menu with Delete`, `hideDestructive removes delete, cut and rename`, `chosen is posted before the command runs`, `finished carries the hresult of a failed command`, `everything is released when the command throws`.

`win-shell-menu.native.test.ts` (**win32 only**: `describe.skipIf(process.platform !== 'win32')`; creates files only under `os.tmpdir()/storageiq-t11-<random>` and deletes only those; uses the real worker thread through `createShellWorkerPool`; the Explorer menu is **not** shown (no cursor interaction): the test drives the native layer through a test-only entry `invokeVerbForTest(paths, verb)` exported by `win-shell-menu.ts`, which builds the menu with the same routing as rule 21 and invokes the named verb, so no UI is needed). Tests:

- `delete on one temp file recycles it` (file gone; its original path is found in the user’s Recycle Bin `$I` records under `C:\$RECYCLE.BIN\<sid>` when the temp dir is on a fixed drive; the test removes nothing from the bin and says so in a comment; skip the bin assertion when the drive has no bin)
- `delete on three temp files in one folder recycles all three`
- `delete on files in two folders recycles all and leaves a sibling file untouched`
- `delete on a folder and a file in different parents recycles both`
- `the menu for files in different folders lists Delete and Properties`
- `does not block the event loop: a 20 ms timer on the main thread never has a gap over 250 ms while 3000 temp files are deleted in a worker` (3000 tiny files in one temp folder; assert `finished` resolved, files gone, `maxGap <= 250`; the old synchronous call produced a 4400 ms gap in the spike)
- `a second delete can be started while the first runs` (two folders of 1500 files each; both finish; the second `show` is posted before the first `finished` resolves)
- `the fallback IFileOperation delete recycles items in two folders` (calls the fallback function directly)
- `the root of a drive hides delete, cut and rename` (`hideDestructive` on `C:\`: labels from the built menu contain no `Delete`; the test never invokes anything on `C:\`)

e2e (`e2e/workspace.spec.ts`, Playwright, existing fixture app): `selecting several rows with ctrl click shows the item count and total size in the status bar`, `shift click selects a range and shift arrow extends it`, `ctrl A selects all visible rows`, `the treemap highlights only the active row`, `escape reduces the selection to the active row`. The native Explorer menu is not exercised by e2e (it opens a native popup); the e2e uses the existing probe hook only to check that `showContextMenu` receives all selected ids (extend the probe to record the ids; no production hook).

**Steps:**

- [ ] **Step 1: Write the failing tests** above, in this order: `selection.test.ts`, `parse-args.test.ts`, `item-watcher.test.ts`, `menu-commands.test.ts`, `shell-worker-pool.test.ts`, `shell-worker.test.ts`, `shell-handlers.test.ts`, store, `TreeGrid`, `StatusBar`, `Ribbon`. Write `win-shell-menu.native.test.ts` last (needs Step 5).
- [ ] **Step 2: Run them.** `npx vitest run src/renderer src/main/ipc src/main/shell-menu src/preload`. Expected: FAIL.
- [ ] **Step 3: Renderer.** `selection.ts`, store changes (rule 7, `showContextMenu(ids, …)`, `copyPaths`), `TreeGrid` (rules 1–6, 8, 10, 14), `StatusBar` (rule 11), `Ribbon`, `fake-api.ts`, preload and contract (`shell:context-menu` list form). Run the renderer tests; expected PASS.
- [ ] **Step 4: Main orchestration.** `parse-args`, `item-watcher.watchMany`, `menu-commands`, `shell-handlers` (rules 12–18) with the fake host, `context-menu.ts` types, `shell-worker-pool.ts`. Run `npx vitest run src/main`; expected PASS.
- [ ] **Step 5: Native.** `shell-worker-protocol.ts`, `shell-worker.ts`, `win-shell-menu.ts` (rules 20–23, `invokeVerbForTest`), `index.ts` wiring (screen-pixel conversion stays in `index.ts`; `before-quit` disposes the pool), `electron.vite.config.ts`, `electron-builder.yml`, `check-packaged-app.mjs` (rule 19). Run the native test file from PowerShell; expected PASS, and report the measured max timer gap and the 3000-file duration in the commit body.
- [ ] **Step 6: Gate** (common gate), then `npm run test:e2e` (unset `ELECTRON_RUN_AS_NODE` first; needs the interactive desktop), then `npm run dist; npm run test:packaged`. Expected: all pass; `release/<version>/win-unpacked/resources/app.asar.unpacked/out/main/` contains exactly `shell-worker.js` and `walker.js`; the packaged `--self-test` builds a menu through the worker.
- [ ] **Step 7: Commit**

```powershell
git add electron.vite.config.ts electron-builder.yml scripts/check-packaged-app.mjs e2e/workspace.spec.ts e2e/support/fixture.ts src/shared/ipc-contract.ts src/preload/index.ts src/preload/index.test.ts src/main/index.ts src/main/ipc/parse-args.ts src/main/ipc/parse-args.test.ts src/main/ipc/shell-handlers.ts src/main/ipc/shell-handlers.test.ts src/main/ipc/item-watcher.ts src/main/ipc/item-watcher.test.ts src/main/shell-menu/context-menu.ts src/main/shell-menu/context-menu.test.ts src/main/shell-menu/menu-commands.ts src/main/shell-menu/menu-commands.test.ts src/main/shell-menu/win-shell-menu.ts src/main/shell-menu/win-shell-menu.native.test.ts src/main/shell-menu/shell-worker.ts src/main/shell-menu/shell-worker.test.ts src/main/shell-menu/shell-worker-protocol.ts src/main/shell-menu/shell-worker-pool.ts src/main/shell-menu/shell-worker-pool.test.ts src/renderer/src/lib/selection.ts src/renderer/src/lib/selection.test.ts src/renderer/src/stores/workspace-store.ts src/renderer/src/stores/workspace-store.test.ts src/renderer/src/components/TreeGrid.tsx src/renderer/src/components/TreeGrid.test.tsx src/renderer/src/components/StatusBar.tsx src/renderer/src/components/StatusBar.test.tsx src/renderer/src/components/Ribbon.tsx src/renderer/src/components/Ribbon.test.tsx src/renderer/src/test/fake-api.ts
git commit -m "feat(workspace): multi-select rows and run Explorer actions on a worker thread"
```

Add any other test file the change touched to the `git add` line. No AI attribution trailer.

**Manual checks for the owner (add to Task 9’s checks-by-eye list):**

1. **Several rows, mouse:** click a row, Ctrl+click two others, Shift+click a far row: the highlighted rows and the status bar text `N items selected, total size X` match; X equals the sum of the Size column of the selected rows.
2. **Several rows, keyboard:** Shift+Down, Ctrl+Down (moves the ring only), Space, Ctrl+A, Esc behave as in rule 4; the focus ring is visible on the active row and differs from the selection colour, in light, dark and Windows high-contrast.
3. **Delete many, same folder:** select 5 files in one folder, right-click one of them: the full Explorer menu appears (Send to, Copy as path, …); choose Delete: Windows’ “Preparing to recycle” dialog appears and **the StorageIQ window stays usable** (scroll the tree, resize the splitter, switch the Mode, expand folders) while it runs. When it ends the rows disappear and the folder totals drop without pressing Refresh.
4. **Delete many, different folders:** select files in two or three folders (Ctrl+click across expanded folders), right-click: a **reduced** menu appears (Open, Cut, Copy, Create shortcut, Delete, Properties plus StorageIQ items). Delete recycles all (check the Recycle Bin); every affected folder updates. Check that a click outside the menu closes it (foreground rule 24) and the app window is not left disabled or greyed while Windows’ dialog is shown.
5. **Big delete:** delete a folder with tens of thousands of files: the dialog shows “Discovered N items”, the app stays fully responsive, you can start a second action (for instance Copy path on another row) while it runs; a fourth simultaneous action shows the busy message.
6. **Cancel:** press Cancel in Windows’ dialog half way: the items already moved are gone from the tree after the refresh, the rest remain.
7. **Protected root:** right-click the root row: no Delete, Cut or Rename in the menu. Ctrl+A then right-click: the root is not part of the action (the announcement says rows were skipped).
8. **Limits:** select all (Ctrl+A) in a folder with more than 1,000 visible rows and open the menu: the limit message appears and no menu opens.
9. **Single row:** everything that worked before still works (right-click, Shift+F10, Open in Explorer, New folder, Ctrl+C).

**Open questions for the controller / owner (Task 11):**

1. **Reduced menu for mixed folders.** Selections spanning several folders get Windows’ default multi-item menu without Send to, Copy as path, Share, Open with, Edit and Print. Acceptable, or should StorageIQ refuse the menu for mixed selections and offer only its own Delete / Copy paths (rule 22’s fallback as the primary)?
2. **Treemap shows the active row only.** Alternative: outline every selected row that is visible in the current treemap. Say if wanted.
3. **Crash isolation.** A worker thread does not isolate a native crash in a third-party shell extension; a separate `utilityProcess` would, at the cost of foreground-window plumbing and an IPC hop. Revisit if crashes are reported.
4. **Foreground and menu dismissal from the worker’s hidden owner window** could not be fully proven without a person (the spike’s Esc key did not reach the menu because the test console was not the foreground process). Manual check 4 decides; fallback is to make the app window the owner of the menu only (not of the operation).
5. **Stale rows during a long delete.** The rows leave the tree when the operation ends (rule 16), not while Windows moves them. A periodic mid-operation refresh is possible; not done to avoid rescans of a folder that is changing under the scanner.
6. **Pruning by `getNode`** (rule 7) is bounded at 200 ids; a batched `tree:exists` channel would be cleaner. Say if the owner wants it.
7. **Ctrl+C with several rows** copies all paths (Explorer copies files instead; StorageIQ keeps the path semantics it already has for one row).
8. **Recycle Bin only.** There is no Shift+Delete or permanent-delete path in StorageIQ; the shell’s own menu still offers Shift+Delete through the extended verbs (`Shift` at right-click), unchanged.
9. **The spike left about ten small test items in the user’s Recycle Bin** (files named `a.txt`, `b.txt`, `c.txt`, `d1.txt`, `f00xxxx.txt`, folders `tmp-*`); they can be emptied with the bin.

---

## Self-review

**Coverage against the brief.** 8a: typed `ShellMenuError` with HRESULT, gone pre-check plus HRESULT mapping, `{ kind: 'gone' }` outcome and message, 500 ms / 15 s watcher with cancel on new scan and quit, logged refresh failures, handler and store tests. 8b: `win-find.ts` with the constants and the 592-byte struct, `fn.async` for the open with the synchronous next-loop (justified, benchmarked against a batched variant), 8 directories in flight (to be confirmed by measurement), injectable lister, removal of the lstat path, packaging check, 1000 ms renderer throttle, bench script, 3x acceptance on `C:\Program Files`, tests. 10: all-users installer, electron-updater 6.8.12, publish block, channel rule, updater module and IPC, banner, release workflow, docs with the signing TODO, tests and manual checks. Task 8c is written separately and is not covered here.

**Placeholder scan.** The one deliberate open item is the constant `MAX_DIRECTORIES_IN_FLIGHT` (8 is the default; Task 8b Step 5 confirms it).

**Open questions for the controller / owner:**

1. **Reparse points.** The brief says never descend into a reparse point. A raw attribute check would also skip OneDrive placeholder folders, deduplicated and compressed files and app aliases, which the current `lstat` walk counts and enters (Node reports only symlinks and junctions as links). This addendum treats only symlink (`0xA000000C`) and mount point (`0xA0000003`) tags as links, so scan results do not change. Confirm; if the owner wants all reparse points skipped, OneDrive folders will show as 0 bytes.
2. **Verbs that leave the item in place** (`paste`, `newitem`, `link`): the delete-style watcher cannot see them finish. Rule 5 keeps today’s immediate plus 1.5 s refresh for them, so a very slow paste can still show stale totals until the next manual refresh. Acceptable?
3. **Obtaining `GetLastError` after an async `FindFirstFileExW`.** Last-error is thread-local and the async call runs on a pool thread. Rule 1 requires the implementer to verify the access-denied code on `C:\System Volume Information` and report how the code is obtained; if koffi gives no reliable value, fall back to running the open synchronously (losing part of the 2.4x overlap) and say so.
4. **`process.noAsar` removal** in `entry.ts` assumes nothing else in the scanner process uses Node’s file system on scanned paths. The packaged self-test’s `app.asar` check guards it.
5. **Release tag vs. version.** The workflow requires the tag to equal `v` + `package.json` version, which means a version bump commit before every release (including pre-releases such as `0.1.1-test.1`). Say if the owner prefers the tag to drive the version.
6. **Unsigned installer:** per-machine installs show a Windows “unknown publisher” UAC dialog until SignPath signing is added (documented, not in code).
7. **`workflow` scope:** `release.yml` cannot be pushed with the current `gh` token; the owner pushes through GCM (Task 10 rule 11).

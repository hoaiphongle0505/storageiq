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

### Task 12: Explorer-native icons

**Implementer tier:** standard (Win32/koffi worker thread, GDI, IPC bounds, a dependency swap; build it in the order of the steps, native part before the renderer swap)

**Why (owner feedback):** the app must look like Windows File Explorer, not “AI-made”. Two owner-approved changes: (1) tree rows show the **real Windows shell icons** (the ones Explorer shows for the same file type, folder or drive); (2) the ribbon, banners, menus and status bar use **Fluent UI System Icons** (MIT) instead of Lucide, and `lucide-react` leaves the project. This task **supersedes** the Global Constraints line “The only new dependency is `lucide-react`” (its replacement is the one new dependency below) and the trade-dress line’s “Lucide icons” (now: Windows’ own icons at runtime plus MIT Fluent icons; no other app’s artwork is copied, no competitor is named).

**Out of scope:** the logo and the application icon. The owner is still choosing; they are **Task 12b**, written after the pick (window icon, installer icon, tray, About dialog, `build/icon.ico`).

**Decisions (owner approved; the numbers are this plan’s):**

- **Where the native calls run: one dedicated icon worker thread, not the shell worker pool.** `SHGetFileInfoW` is a shell call: for `.exe`, `.lnk`, `.url`, `.ico` it opens the file and can load shell extensions, and on a slow or offline mapped drive it can block for seconds. It must never run on Electron’s UI thread or main event loop. The Task 11 pool is the wrong host: its workers are held for the whole life of a menu or a recycle operation (minutes for a big delete), it is capped at 3 with a `busy` rejection, and a stuck icon call would eat one of the three slots the user needs for Delete. A separate, single, lazily started STA worker (`out/main/icon-worker.js`) keeps the two failure domains apart; it can be terminated and restarted without touching any running Explorer action. It reuses the Task 11 patterns (worker bundle, `CoInitializeEx(COINIT_APARTMENTTHREADED)`, protocol file, pool-like dispose at quit, injectable `WorkerLike` for tests).
- **asar rules:** the packaged app unpacks exactly three files besides koffi: `walker.js`, `shell-worker.js` and the new `icon-worker.js` (a worker thread loads a real file; built self-contained like the other two). This is the same rule as Task 11 rule 19 with one more entry, not a new exception. Nothing else leaves the asar; never add `out/main/chunks`.
- **Fluent package:** `@fluentui/react-icons` **2.0.345**, published 2026-10-30 (24 days before this plan; 2.0.346 is 10 days old and 2.0.347 five, so both are too new), license MIT, pinned exactly as a **dev dependency** (Vite bundles it into the renderer, like `react`). Checked in the published package: it ships React components per icon and size (`Alert24Color`, `ArrowSync20Color`, `Cloud24Color`, …) and only **about 80 icons have a `…Color` variant** (for example Alert, ArrowSync, Calendar, CheckmarkCircle, Clock, Cloud, DataPie, Database, Document, DocumentText, ErrorCircle, Globe, Home, Image, Link, Lock, Edit, DismissCircle). **There is no colour variant of `Folder`, `FolderOpen`, `FolderAdd`, `Info`, `HardDrive`, `Dismiss`, `Chevron*` or `Copy`.** Rule 14 below says what to do about that.

**Files:**

- Create (main): `src/main/icons/icon-keys.ts` (+ test), `src/main/icons/png.ts` (+ test), `src/main/icons/icon-cache.ts` (+ test), `src/main/icons/icon-service.ts` (+ test), `src/main/icons/icon-worker-protocol.ts`, `src/main/icons/icon-worker.ts` (+ test), `src/main/icons/win-icons.ts`, `src/main/icons/win-icons.native.test.ts` (win32 only), `src/main/ipc/icon-handlers.ts` (+ test)
- Create (renderer): `src/renderer/src/lib/icons.ts` (the one module that imports `@fluentui/react-icons`), `src/renderer/src/lib/icon-cache.ts` (+ test), `src/renderer/src/components/FileIcon.tsx` (+ test), `src/renderer/src/no-lucide.test.ts`
- Modify: `package.json`, `package-lock.json`, `src/shared/ipc-contract.ts`, `src/main/ipc/parse-args.ts` (+ test), `src/main/ipc/register.ts` (+ test, if channels are listed there), `src/main/index.ts`, `src/preload/index.ts` (+ test), `src/renderer/src/test/fake-api.ts`, `src/renderer/src/components/TreeGrid.tsx` (+ test), `Ribbon.tsx`, `RibbonButton.tsx`, `MenuButton.tsx`, `SelectMenu.tsx`, `Banner.tsx`, `StatusBar.tsx`, `TreemapPane.tsx` (each + test where one exists), `electron.vite.config.ts`, `electron-builder.yml`, `scripts/check-packaged-app.mjs`, `scripts/build-notices.cjs`, `e2e/workspace.spec.ts`, `README.md`, `design/components.md`, `docs/ROADMAP.md`. Another change set may be open on some of these files: start from the current working tree and keep its edits.

**Interfaces:**

`ipc-contract.ts` (two new request channels, no new event):

```ts
export interface IconImage {
  /** `data:image/png;base64,…` of the small icon (the system small-icon size, 16 px at 100 %). */
  small: string
  /** The large icon (the system large-icon size, 32 px at 100 %), used when devicePixelRatio ≥ 1.25. */
  large: string
}
export interface IconBatch {
  /** nodeId → icon key. A node that no longer resolves is absent. */
  keys: Record<NodeId, string>
  /** icon key → images. Contains every key named in `keys` that could be produced. */
  images: Record<string, IconImage>
  /** Per-file ids that were answered with their type’s icon only (time budget); ask again. */
  pending: NodeId[]
}
'icons:for-nodes': { args: [scanId: string, nodeIds: NodeId[]]; result: IconBatch }
'icons:for-types': { args: [typeKeys: string[]]; result: Record<string, IconImage> }
```

`StorageIQApi.getIcons(scanId, nodeIds)` and `getTypeIcons(typeKeys)` (preload and fake follow). A key absent from `images` means “keep the placeholder”; neither call ever rejects for a native failure (it answers empty), only for invalid arguments.

`parse-args.ts`: `export const MAX_ICON_ITEMS = 64`; `iconNodesArgs(args): [string, NodeId[]]` (scan id, then `nodeIdListArg(value, MAX_ICON_ITEMS)`; message `expected 1 to 64 tree node ids`); `ICON_TYPE_KEY_PATTERN = /^(dir|drive|file|ext:[a-z0-9_$~-]{1,16})$/`; `iconTypesArgs(args): [string[]]` (an array of 1..64 strings, each matching the pattern, otherwise `InvalidIpcArgumentsError`). The renderer can name **no path, no drive letter, no extension containing a dot or a separator**.

`icon-keys.ts` (pure): `PER_FILE_EXTENSIONS = new Set(['.exe', '.lnk', '.ico', '.url', '.scr', '.cpl', '.msi'])`; `typeKeyOf(row: { kind; name }, isDriveRoot: boolean): string` returns `drive`, `dir`, `ext:<lower-case extension without the dot>` or `file` (no extension); `iconKeyFor(typeKey, path | null): string` returns `typeKey` for type icons and `f:<first 12 hex of sha1(path.toLowerCase())>` for per-file icons (so a key leaks no path), and `drive:<letter>` for a drive root (drives differ: fixed, USB, network); `parseTypeKey(key): NativeTarget` where `NativeTarget = { kind: 'dir' } | { kind: 'file'; ext: string } | { kind: 'path'; path: string }`.

`icon-worker-protocol.ts` (plain JSON): to the worker `{ type: 'get'; id: number; items: Array<{ key: string; target: NativeTarget }> }` (`path` targets are scanner paths only); from the worker `{ type: 'icons'; id: number; results: Array<{ key: string; image: IconImage | null; size: { small: number; large: number } | null }>; ms: number }` and `{ type: 'failed'; id: number; hresult: number; step: string }`. The worker answers in input order and checks a deadline (rule 6) between items.

`win-icons.ts`: `createWinIcons(): { fetch(target: NativeTarget): { small: RgbaBitmap; large: RgbaBitmap } | null; dispose(): void }`, `RgbaBitmap = { width: number; height: number; data: Uint8Array /* RGBA, top-down, straight alpha */ }`; `png.ts`: `encodeRgbaPng(bitmap): Uint8Array` (a small hand-written encoder: 8-bit RGBA, filter 0, `zlib.deflateSync`, `zlib.crc32`; no dependency).

**Rules:**

_Native (icon worker thread)_

1. **API.** `SHGetFileInfoW(path, attrs, &SHFILEINFOW, sizeof, flags)` through koffi, struct `SHFILEINFOW { HICON hIcon; int iIcon; DWORD dwAttributes; WCHAR szDisplayName[260]; WCHAR szTypeName[80]; }`. Small: `SHGFI_ICON | SHGFI_SMALLICON`; large: `SHGFI_ICON | SHGFI_LARGEICON`; add `SHGFI_USEFILEATTRIBUTES` for every **type** lookup (`ext`, `dir`, `file`): the path is a made-up name (`"x.txt"`, `"folder"`) with `FILE_ATTRIBUTE_NORMAL` (0x80) or `FILE_ATTRIBUTE_DIRECTORY` (0x10), so no disk access happens. **Per-file** lookups (rule 4) and **drive** lookups (`C:\`) do not set it. Constants are named, with the SDK values in a comment.
2. **Sizes are measured, not assumed.** `SMALLICON`/`LARGEICON` follow the system metrics (`SM_CXSMICON`/`SM_CXICON`), which at 150 % scaling are 24/48 px, not 16/32. The worker returns the real bitmap size of each image (`size.small`, `size.large`); the renderer draws every image at 16 CSS px (rule 12). Never resample in main.
3. **HICON → RGBA → PNG.** `GetIconInfo` (`ICONINFO { fIcon, xHotspot, yHotspot, hbmMask, hbmColor }`), `GetObjectW` for the size, `CreateCompatibleDC(NULL)` + `GetDIBits(hdc, hbmColor, 0, h, buffer, &BITMAPINFO{ biSize 40, biWidth w, biHeight −h (top-down), biPlanes 1, biBitCount 32, biCompression BI_RGB }, DIB_RGB_COLORS)`, then swap B and R. **Alpha:** modern icons carry real alpha; if every alpha byte of the colour bitmap is 0, derive alpha from `hbmMask` (a second `GetDIBits`, mask pixel black = opaque); a monochrome icon (`hbmColor == NULL`) is not expected from the shell and answers `null`. Premultiplied or straight: the shell’s 32-bpp DIB is straight alpha; the test in rule 17 checks a known opaque pixel.
4. **Which files get their own icon.** `PER_FILE_EXTENSIONS` (rule keys above) use a real lookup of the actual path, because their icons differ per file (an `.exe` carries its own icon resource, a `.lnk` its target’s plus the arrow overlay). Everything else is cached by extension. **A cloud placeholder must not be hydrated:** before a per-file lookup the worker calls `GetFileAttributesW`; if any of `FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS` (0x00400000), `FILE_ATTRIBUTE_RECALL_ON_OPEN` (0x00040000) or `FILE_ATTRIBUTE_OFFLINE` (0x1000) is set, or the call fails, the worker uses the by-extension lookup instead (the key stays the per-file key, so the result is not shared). The scanner’s “never opens file contents” rule is unchanged (this is the renderer’s icon service, runs after the scan, only for rows that are on screen, and skips offline files). A drive root and `dir` rows never open file contents.
5. **Handles.** `DestroyIcon` on every `hIcon`, `DeleteObject` on `hbmColor`/`hbmMask` returned by `GetIconInfo`, `DeleteDC` on the DC, all in `finally`, on every path including the failure of a later step. The native test counts GDI objects (rule 17) to prove there is no leak.
6. **Time budget.** One `get` request is answered within 2,500 ms (`ICON_REQUEST_BUDGET_MS`): after the budget the worker answers the items it has finished and marks the rest `image: null` (the service turns those per-file items into `pending`). The main-side client has its own timer, `ICON_WORKER_TIMEOUT_MS = 6000`; if the worker does not reply it is `terminate()`d, a new one is started for the next request, and the stuck request answers `images: {}` (placeholders stay). At most one `get` is in flight per worker and the queue is FIFO with at most 8 waiting requests (`ICON_QUEUE_MAX`, an older queued request is dropped with an empty answer).
7. **COM.** `CoInitializeEx(NULL, COINIT_APARTMENTTHREADED)` once on the worker, `CoUninitialize` at exit; no window, no menu, no foreground change.

_Main: service, cache, IPC_

8. **Handler `icons:for-nodes`:** (a) parse (rule above, `MAX_ICON_ITEMS`); (b) sender check exactly as the other handlers do (`register.ts`); (c) the current scan must equal `scanId`, otherwise answer `{ keys: {}, images: {}, pending: [] }` (a stale request is not an error); (d) dedupe the ids, resolve each with `resolveScanNode`-style lookup (at most 8 in flight, `mapLimit`), a node that no longer resolves is dropped; (e) classify with `typeKeyOf` (the root row of a drive path `^[A-Za-z]:\\$` is a drive, any other root is `dir`; `files` group rows are not asked for by the renderer and, if sent, are dropped); (f) the native target for a per-file row is the scanner’s `details.path`; the renderer never sends a path (project rule), and a type key never carries one. `icons:for-types` takes only keys (for example the file-type legend), maps them to `NativeTarget` through `parseTypeKey` (`drive` as a bare key means the system drive’s icon, resolved from `process.env.SystemDrive`), and answers `images` only.
9. **Service `createIconService(deps)`** (`deps: { spawn(): WorkerLike; schedule; now; maxEntries: 512; maxPathKeys: 4096 }`): `request(targets: Array<{ key; target }>): Promise<{ images: Record<string, IconImage>; missing: string[] }>`. **Dedupe:** keys already cached are answered without the worker; keys already in flight share one native lookup (a second request for the same key awaits the first promise); one worker message carries every missing key of the call, at most 64 items. **Negative cache:** a key whose lookup returned `null` is remembered for 60 s (`NEGATIVE_TTL_MS`) so a bad file is not retried on every scroll.
10. **LRU:** `createIconCache(maxEntries)`: `get` refreshes recency, `set` evicts the least recently used past the cap. Main keeps at most **512** images (type keys never expire in practice; per-file keys are the ones that churn). A second small map `path → key` is not stored (the key is a hash of the path, computed per request). The cache is cleared on a new scan only for `f:` keys (per-file icons can change after a rescan); type and drive keys live until quit. A Windows setting change (icon theme, high contrast) is not tracked; a restart refreshes (said in the doc comment).
11. **Worker lifecycle:** lazily spawned by `index.ts` on the first request (`spawn: () => new Worker(iconWorkerPath, { workerData: ICON_WORKER_DATA })`), idle for 60 s then terminated, respawned on the next request, disposed in `before-quit` with the pool. A worker that errors or exits rejects nothing into the main process: the in-flight request answers empty, the worker is discarded.

_Renderer_

12. **No layout shift.** Every row icon sits in a fixed `size-4` (16 × 16 CSS px) box that exists before and after loading. `FileIcon` renders a Fluent placeholder (`Document16Regular` for a file, `Folder16Filled` tinted by the folder token, `HardDrive`-style glyph for a drive, Fluent `DocumentMultiple16Regular` for `[N files]` rows: no IPC for those) in that box, and replaces it with `<img src={dataUrl} width={16} height={16} alt="" aria-hidden="true" draggable={false} data-icon={key} className="size-4 shrink-0 object-contain">` when the image arrives. `small` is used when `window.devicePixelRatio < 1.25`, otherwise `large` (the browser scales the larger bitmap down: sharp at 150 %/200 %). `decoding="async"`. The `alt` is empty and the image is `aria-hidden`: the row’s accessible name is the file name, as today.
13. **Batching (`lib/icon-cache.ts`, a plain module used through a small hook):** TreeGrid reports the ids of the rendered window of rows (the virtual window plus 10 rows of overscan). The cache keeps `nodeId → key` for the current scan and `key → IconImage` (renderer cap **400** images, LRU). Ids not yet resolved are collected for **40 ms** (`ICON_BATCH_DELAY_MS`) and sent as one `getIcons(scanId, ids)` of at most 64 ids (more are split and sent in sequence, one in flight at a time); an id already requested and not `pending` is never requested twice; `pending` ids are asked again after 500 ms, at most 3 times. A result that arrives after the scan id changed is ignored. The cache is cleared on a new scan. Scrolling fast never queues more than one batch behind the in-flight one (later batches replace earlier unsent ones: only the latest visible set matters).
14. **Fluent icons (ribbon, banners, menus, status bar).** `lib/icons.ts` is the only file that imports `@fluentui/react-icons` and exports every icon the UI uses under a StorageIQ name (for example `IconRefresh`, `IconOpenFolder`, `IconNewFolder`), so one grep shows the set and a rename is one line. Choose per icon: the `…Color` variant where the package has one (Alert for warnings, ErrorCircle, CheckmarkCircle, ArrowSync for Refresh, Cloud for OneDrive, Clock for Recent, DataPie, Document, Database, Edit); for glyphs that **have no colour variant** (folder-like, Info, HardDrive, Dismiss, chevrons, Copy) use the `Filled` variant for folder-like actions tinted with the design token `--icon-folder` (a warm yellow close to Windows’ folder yellow; add it to `design/tokens.json`, regenerate `tokens.css`, contrast not required for decorative icons beside text but the icon must remain visible at 3:1 against its background, per WCAG 1.4.11, and the run of `scripts/build-tokens.mjs` must report 0 failures), and the `Regular` variant in `currentColor` for the rest (chevrons, dismiss, info). This is honest about what Fluent ships: “in colour” means colour where the set has colour, not a recoloured set. Sizes: `16` in rows, banners and status bar, `20` in ribbon small buttons and menus, `24` in ribbon large buttons (amended after Task 12 review: several chosen glyphs have no 32 px variant and a 32 px glyph plus label does not fit the 60 px ribbon button; 24 px also matches the scale the owner approved; every chosen glyph must exist at its size; `lib/icons.ts` imports the size-specific component, never scales one). Under `forced-colors` the SVGs keep their fills (`forced-color-adjust: none` only on colour icons, `currentColor` icons follow the system), so the ribbon stays legible in high contrast.
15. **Accessibility.** Keep every accessible name (buttons keep `aria-label`/visible text; the `title` tooltips stay). An icon beside visible text, and every tree-row icon, is `aria-hidden="true"` and `focusable={false}`. An icon-only button (`TreemapPane` close, banner dismiss) keeps its `aria-label` on the button. The Fluent components render an `<svg>` with `aria-hidden` when no title is given; assert it in the renderer tests.
16. **Lucide is removed entirely:** `npm uninstall lucide-react`; no `lucide` string remains in `package.json`, `package-lock.json`, `src`, `scripts`, `e2e`, `electron.vite.config.ts` or `design/`; `TreeGrid.test.tsx`’s `svg.lucide-chevron-right` selector becomes `[data-chevron]` (the chevron gets that attribute). `scripts/build-notices.cjs` `BUNDLED_DEV_DEPENDENCIES` swaps `'lucide-react'` for `'@fluentui/react-icons'`; the generator walks each package’s own `dependencies` (the Fluent package depends on `@griffel/react` and `tslib`), so their licences appear too; Step 9 verifies the generated file names `@fluentui/react-icons`, `@griffel/react` and the MIT text, and that `lucide-react` is absent. README credits it in a “Credits” paragraph: “Icons: Windows’ own shell icons, drawn by Windows at runtime and never redistributed; Fluent UI System Icons by Microsoft (MIT).” `design/components.md` and `docs/ROADMAP.md` replace their Lucide mentions. Old plan files are history and are not edited.
17. **Security and privacy.** The renderer asks by `(scanId, nodeIds)` or by type key only; main resolves paths itself from the current scan, checks the sender, bounds every argument (64 ids, 64 type keys, key regex), and never logs a path at info level. The renderer’s CSP already allows `img-src 'self' data:`; do not loosen anything. The data URLs are produced by main from bytes it encoded itself (no file content is read by StorageIQ; Windows extracts the icon).

**Tests (names exact, grouped by file):**

`png.test.ts`: `encodes an RGBA bitmap as a PNG that Node’s zlib can inflate back to the same pixels`, `writes the PNG signature and an IHDR with the bitmap’s width, height and colour type 6`, `rejects a buffer whose length is not width times height times four`.

`icon-keys.test.ts`: `typeKeyOf maps folders, drive roots, extensions and extensionless files`, `extensions are lower-cased and only [a-z0-9_$~-] up to 16 characters are accepted`, `exe, lnk, ico and url use per-file keys that differ per path and carry no path text`, `per-file keys are stable for the same path in any letter case`, `parseTypeKey rejects anything that is not dir, drive, file or ext:<safe>`.

`icon-cache.test.ts`: `get returns what set stored`, `the least recently used entry is evicted past the cap`, `get refreshes recency`, `clearPrefix removes only per-file keys`, `a negative entry expires after the TTL and not before`.

`icon-service.test.ts` (fake `WorkerLike`, fake clock):

- `a cached key is answered without the worker`
- `two concurrent requests for the same key send one native lookup`
- `one worker message carries every missing key of a call and at most 64 items`
- `a null result is cached negatively and retried after 60 seconds`
- `a worker that never replies is terminated after 6 seconds, the request answers empty and the next request spawns a new worker`
- `a worker that exits mid-request answers empty and never throws`
- `an idle worker is terminated after 60 seconds and respawned on demand`
- `the queue holds at most 8 requests and drops the oldest with an empty answer`
- `a new scan clears the per-file keys and keeps the type keys`
- `dispose terminates the worker and answers pending requests empty`

`icon-worker.test.ts` (orchestration with a fake native): `answers in input order`, `stops at the budget and marks the rest null`, `a per-file target whose attributes say cloud placeholder falls back to the by-extension lookup`, `releases every handle when a later step throws`.

`icon-handlers.test.ts` (fake scan service, fake service): `resolves every id through the scan and passes only scanner paths to the service`, `dedupes ids`, `drops ids that no longer resolve`, `answers empty for a scan id that is not current`, `classifies a drive root, a folder, a file and a per-file extension`, `files group rows are dropped`, `an icons call never rejects when the service fails`, `icons:for-types maps keys to targets and never receives a path`.

`parse-args.test.ts`: `iconNodesArgs accepts 1 id and 64 ids`, `iconNodesArgs rejects an empty list, 65 ids, a non-array, a non-string id and a bad pattern`, `iconNodesArgs rejects a missing or malformed scan id`, `iconTypesArgs accepts dir, drive, file and ext keys`, `iconTypesArgs rejects a path, a drive letter, a dotted extension, a separator and an uppercase key`, `iconTypesArgs rejects 65 keys and an empty list`. A `register.test.ts` case: `icons channels reject a sender that is not the main window`.

`win-icons.native.test.ts` (**win32 only**: `describe.skipIf(process.platform !== 'win32')`; uses the real worker through the service, creates nothing on disk except under `os.tmpdir()/storageiq-t12-<random>`):

- `fetches the icon for .txt by extension without the file existing` (small and large; `width === height`; small width in 16–24, large in 32–48; the PNG’s IHDR agrees with the reported size; at least one pixel has alpha above 0 and at least one has alpha 255)
- `fetches the folder icon` (`dir`; same checks; differs from the .txt icon, compared by PNG bytes)
- `fetches the drive icon for the system drive`
- `fetches a real .exe icon per file` (`process.execPath`; same checks; the key starts with `f:`)
- `two .exe files with different icons yield different images` (`process.execPath` against `C:\Windows\System32\notepad.exe`, skipped if the latter is missing)
- `a .lnk created in the temp folder gets its own icon` (create it with PowerShell `WScript.Shell` pointing at notepad, delete it afterwards)
- `a missing per-file path falls back to the extension icon` (a `.exe` path that does not exist)
- `does not leak GDI objects` (`GetGuiResources(GetCurrentProcess(), GR_GDIOBJECTS = 0)` before and after 300 lookups of mixed types, difference at most 5)
- `does not block the event loop` (a 20 ms timer on the main thread, 300 lookups, `maxGap <= 250`; the worker is the reason it holds)

Renderer: `icon-cache.test.ts`: `collects ids for 40 ms and sends one batch`, `splits more than 64 ids into sequential calls`, `never requests an id twice`, `a later visible set replaces an unsent earlier one`, `pending ids are asked again after 500 ms, at most 3 times`, `a result for an old scan id is ignored`, `the image cache evicts the least recently used past 400`. `FileIcon.test.tsx`: `renders the placeholder in a 16 px box first and swaps to an img when the image arrives`, `the box keeps its size across the swap` (the same element has `size-4` before and after, no `width` change), `uses the large bitmap when devicePixelRatio is 1.5` and `the small one at 1`, `the img is aria-hidden with empty alt`, `a missing image keeps the placeholder`, `group rows use the placeholder and never request an icon`. `TreeGrid.test.tsx` additions: `rows request icons for the rendered window only`, `a row shows its img after the fake api answers` (keeps all earlier tests passing; selector updated for the chevron). Ribbon, Banner, StatusBar, SelectMenu, MenuButton, TreemapPane keep their existing tests and add `its icons are aria-hidden svgs and its accessible name is unchanged` to the three that had icon-only controls (`Banner` dismiss, `TreemapPane` close, `Ribbon`). `no-lucide.test.ts`: `package.json lists no lucide package`, `package-lock.json has no lucide-react entry`, `no source, script, e2e or design file mentions lucide`, `lib/icons.ts is the only file that imports @fluentui/react-icons` (walks `src/renderer/src`, skips tests), and `every icon exported by lib/icons.ts is a React component` (import it and check `typeof`).

e2e (`e2e/workspace.spec.ts`, existing fixture app): `tree rows render a native icon image` (after the scan, at least one `[role="row"] img[data-icon]` is visible and its `naturalWidth` is greater than 0; the box around it keeps the same bounding box before and after: record the first row icon’s box when the placeholder is shown and compare), `the ribbon shows svg icons and no lucide class` (`page.locator('.lucide')` count is 0).

Packaged: `scripts/check-packaged-app.mjs` expects exactly `icon-worker.js,shell-worker.js,walker.js` unpacked, and `--self-test` additionally asks the icon service for `ext:txt` and checks a PNG signature in the reply, so a missing bundle fails the packaged check.

**Steps:**

- [ ] **Step 1: Dependency.** `npm uninstall lucide-react`, then `npm install --save-exact --save-dev @fluentui/react-icons@2.0.345` (never `--force` or `--legacy-peer-deps`; react 19 satisfies the peer range; if npm reports a peer conflict, stop and report). Confirm in the lockfile that the version is 2.0.345 and the license is MIT. Do not edit imports yet; `typecheck` is expected to fail until Step 8.
- [ ] **Step 2: Write the failing tests** in this order: `parse-args.test.ts`, `png.test.ts`, `icon-keys.test.ts`, `icon-cache.test.ts`, `icon-service.test.ts`, `icon-worker.test.ts`, `icon-handlers.test.ts`, renderer `icon-cache.test.ts`, `FileIcon.test.tsx`, `TreeGrid.test.tsx` additions, `no-lucide.test.ts`. Write `win-icons.native.test.ts` last (needs Step 5).
- [ ] **Step 3: Run them.** `npx vitest run src/main/icons src/main/ipc src/renderer`. Expected: FAIL.
- [ ] **Step 4: Main logic without native code.** `parse-args`, `icon-keys`, `png`, `icon-cache`, `icon-service`, `icon-worker-protocol`, `icon-handlers`, contract, preload, `fake-api`. Run `npx vitest run src/main src/preload`; expected PASS except the native file.
- [ ] **Step 5: Native.** `win-icons.ts` (rules 1–5, 7), `icon-worker.ts` (rule 6), `index.ts` wiring (lazy spawn, idle, dispose in `before-quit`, handler registration), `electron.vite.config.ts` (add `src/main/icons/icon-worker.ts` to the worker-entries list that builds `walker.js` and `shell-worker.js`), `electron-builder.yml` (`asarUnpack` gains `out/main/icon-worker.js`, comment updated), `check-packaged-app.mjs`. Run the native test file from PowerShell; expected PASS. Report the measured small and large sizes at the machine’s scaling, the time for 300 lookups, the max timer gap and the GDI delta in the commit body.
- [ ] **Step 6: Renderer icons for rows.** `lib/icon-cache.ts`, `FileIcon.tsx`, `TreeGrid.tsx` (use it in `RowIcon`; report the rendered window; keep the `data-chevron` attribute). Run `npx vitest run src/renderer`.
- [ ] **Step 7: Fluent set.** `lib/icons.ts` (check every name exists at its size by importing it; the test in `no-lucide.test.ts` does), `design/tokens.json` + `scripts/build-tokens.mjs` (`--icon-folder`), then replace the Lucide imports in `Ribbon`, `RibbonButton`, `MenuButton`, `SelectMenu`, `Banner`, `StatusBar`, `TreemapPane` (types: `LucideIcon` becomes the `FluentIcon` type exported by `@fluentui/react-icons`, re-exported from `lib/icons.ts`). No component imports the package directly.
- [ ] **Step 8: Notices and docs.** `scripts/build-notices.cjs` list, `README.md` Credits, `design/components.md`, `docs/ROADMAP.md`. Run `npm run notices` and check `out/THIRD_PARTY_NOTICES.txt`: it names `@fluentui/react-icons` (MIT) and `@griffel/react`, and does not contain `lucide`.
- [ ] **Step 9: Gate** (common gate), then `impeccable detect --json src/renderer` (expected `[]`), `npm run test:e2e` (unset `ELECTRON_RUN_AS_NODE` first; interactive desktop), then `npm run dist; npm run test:packaged`. Expected: all pass; `app.asar.unpacked/out/main/` contains exactly `icon-worker.js`, `shell-worker.js`, `walker.js`; the renderer bundle size change is reported in the commit body (`out/renderer/assets/*.js`, before and after; the tree-shaken Fluent set should not exceed the Lucide one by more than a few tens of kB).
- [ ] **Step 10: Commit**

```powershell
git add package.json package-lock.json electron.vite.config.ts electron-builder.yml scripts/check-packaged-app.mjs scripts/build-notices.cjs scripts/build-tokens.mjs design/tokens.json design/tokens.css design/components.md README.md docs/ROADMAP.md e2e/workspace.spec.ts src/shared/ipc-contract.ts src/preload/index.ts src/preload/index.test.ts src/main/index.ts src/main/ipc/parse-args.ts src/main/ipc/parse-args.test.ts src/main/ipc/register.ts src/main/ipc/register.test.ts src/main/ipc/icon-handlers.ts src/main/ipc/icon-handlers.test.ts src/main/icons/icon-keys.ts src/main/icons/icon-keys.test.ts src/main/icons/png.ts src/main/icons/png.test.ts src/main/icons/icon-cache.ts src/main/icons/icon-cache.test.ts src/main/icons/icon-service.ts src/main/icons/icon-service.test.ts src/main/icons/icon-worker-protocol.ts src/main/icons/icon-worker.ts src/main/icons/icon-worker.test.ts src/main/icons/win-icons.ts src/main/icons/win-icons.native.test.ts src/renderer/src/lib/icons.ts src/renderer/src/lib/icon-cache.ts src/renderer/src/lib/icon-cache.test.ts src/renderer/src/components/FileIcon.tsx src/renderer/src/components/FileIcon.test.tsx src/renderer/src/components/TreeGrid.tsx src/renderer/src/components/TreeGrid.test.tsx src/renderer/src/components/Ribbon.tsx src/renderer/src/components/Ribbon.test.tsx src/renderer/src/components/RibbonButton.tsx src/renderer/src/components/MenuButton.tsx src/renderer/src/components/SelectMenu.tsx src/renderer/src/components/Banner.tsx src/renderer/src/components/StatusBar.tsx src/renderer/src/components/TreemapPane.tsx src/renderer/src/no-lucide.test.ts src/renderer/src/test/fake-api.ts
git commit -m "feat(ui): show Windows shell icons in the tree and Fluent icons in the ribbon"
```

Add any other test file the change touched (and `design/tokens.css` only if it is tracked) to the `git add` line. No AI attribution trailer.

**Manual checks for the owner (add to Task 9’s checks-by-eye list):**

1. **Match Explorer at 100 %:** scan a folder that contains `.txt`, `.pdf`, `.docx`, `.png`, `.zip`, `.exe`, a `.lnk` and a few folders; open the same folder in Explorer beside the app. Each row’s icon is the same picture as Explorer’s (same app-specific icons if an app is installed, same folder and drive icons).
2. **150 % and 200 % scaling** (Settings, Display, Scale; sign out and in if Windows asks): icons stay crisp (no blur, no double edge), keep the same 16 px footprint, and row height does not change as icons load. Repeat on a second monitor with a different scale if available.
3. **Loading:** scroll fast through a folder with thousands of rows: placeholders appear first, icons fill in within a moment, rows never jump, the window never stalls, the status bar and Stop button stay responsive.
4. **Dark theme and Windows high contrast** (Settings, Accessibility, Contrast themes): shell icons remain visible (they are fixed bitmaps), the Fluent ribbon icons stay legible (colour icons keep their colours, `currentColor` icons take the system colours), selected rows keep their contrast.
5. **OneDrive:** with a cloud-only `.exe` in a OneDrive folder, scrolling over it does not start a download (no “downloading” badge appears, no network activity from StorageIQ).
6. **Per-file icons:** two different `.exe` files show their own icons; a `.lnk` shows its target’s icon with the arrow.
7. **Ribbon, banners, menus, status bar:** every control still has its tooltip and name; icons sit beside text and read as one consistent Fluent set; the Refresh, warning, error and success icons are in colour where Fluent provides it.
8. **Notices:** `THIRD_PARTY_NOTICES.txt` next to the installed executable mentions Fluent UI System Icons (MIT).

**Open questions for the controller / owner (Task 12):**

1. **“Colour” coverage of Fluent.** Only about 80 Fluent icons have colour variants, and not the folder-like, Info, drive or chevron glyphs. Rule 14 uses colour where it exists, a yellow-tinted Filled folder (token) for folder actions and `currentColor` Regular elsewhere. Alternative: all-monochrome Fluent, or hand-picked colour per glyph (more design work). Say if wanted.
2. **Folders use the generic folder icon.** Special folders (Documents, Pictures, Downloads) have their own Explorer icons but need a per-folder disk lookup with path knowledge of known folders; not done. A real lookup of every folder is possible (cost: one shell call per folder, cached by path hash).
3. **Windows icon theme or high-contrast change while running** is not observed; a restart refreshes (rule 10). A `WM_SETTINGCHANGE` hook is possible later.
4. **Per-file extension list** (`.exe .lnk .ico .url .scr .cpl .msi`) is deliberate; `.dll` is not included (generic DLL icon in Explorer) and neither are `.bat`/`.cmd` (one icon per type). Say if Explorer shows something different on the owner’s machine.
5. **Icon size on the system DPI.** The sizes follow the process’s DPI awareness (system metrics), so a window dragged between monitors with different scales keeps the bitmaps chosen at response time until rows are re-requested. The 16 CSS px box hides this; a re-request on `devicePixelRatio` change is possible if the owner sees softness.
6. **The logo and app icon are Task 12b**, written after the owner’s pick.

---

### Task 12b: The StorageIQ logo and app icon

**Implementer tier:** standard (SVG pixel-fitting, a rasterising script, ICO packing, packaging config).

**Owner pick (2026-11-25):** concept **R6 "Dark tile"**: a white segmented S on a near-black rounded tile, with a crimson middle block. It is original to StorageIQ. Today the app ships Electron's default icon: there is no `build/` folder and no `icon` key in `electron-builder.yml`.

**Master artwork (64 × 64 viewBox, exact values):**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect x="2" y="2" width="60" height="60" rx="14" fill="#1b1b1b"/>
  <g transform="translate(32 32) scale(.68) translate(-32 -32)">
    <path d="M51 12H22a10 10 0 0 0 0 20" fill="none" stroke="#ffffff" stroke-width="12" stroke-linecap="round"/>
    <path d="M25.5 32h13" stroke="#c8102e" stroke-width="12"/>
    <path d="M42 32a10 10 0 0 1 0 20H13" fill="none" stroke="#ffffff" stroke-width="12" stroke-linecap="round"/>
  </g>
</svg>
```

The owner approved this rendering as it is: the white round caps overlap the red, so a short red block shows between the two white ends. Keep that look. You may flatten the transform into absolute coordinates; the result must be visually identical at 256 px.

**Files:**

- Create `build/icon.svg`: the master above, flattened, with no transform.
- Create `build/icon-16.svg` and `build/icon-24.svg`: hand-tuned small sizes.
  - Snap the tile, the S strokes and the red block to whole pixels.
  - At 16 px: tile corner radius 3 px, S stroke 2 px, red block at least 2 × 2 px and centred.
  - At 24 px: corner radius 5 px, S stroke 3 px, red block 3 × 3 px.
  - The S must stay readable and symmetric, and nothing may blur across half pixels.
- Create `scripts/build-icon.mjs`, which regenerates `build/icon.ico` and `build/icon.png` (256 px).
  - Rasterise each SVG at 16, 20, 24, 32, 40, 48, 64, 128 and 256 px. Use icon-16.svg for 16 and 20, icon-24.svg for 24, and icon.svg for the rest.
  - Do the rasterising with Electron's offscreen rendering (`BrowserWindow({ show: false, webPreferences: { offscreen: true } })` + `capturePage`) or the Playwright Chromium already in devDependencies. Transparent background. No new dependency.
  - Pack the ICO by hand: ICONDIR + ICONDIRENTRY, with PNG-compressed entries for every size (Windows Vista and later accept PNG entries at all sizes).
  - The script is deterministic: running it twice produces byte-identical files. Commit the generated `build/icon.ico` and `build/icon.png`.
  - Add `"icon": "node scripts/build-icon.mjs"` (or the Electron launch equivalent) to package.json scripts.
- Modify `electron-builder.yml`:
  - `win.icon: build/icon.ico`;
  - `nsis.installerIcon`, `nsis.uninstallerIcon` and `nsis.installerHeaderIcon` all set to `build/icon.ico`.
  - Keep every other key unchanged, especially the asar unpack list.
- Modify `src/main/index.ts`: in unpackaged runs, pass `icon` to the main `BrowserWindow` so dev windows show the logo. Packaged builds use the exe's embedded icon.
  - Resolve the path without touching the asar unpack rules: `build/` is not inside `out/`, so do it only when `!app.isPackaged`.
- README: show the logo at the top. Use `docs/assets/logo.svg`, a copy of the master, at 64 px next to the title.

**Tests:**

- `scripts/build-icon.test.mjs` or a vitest test. It parses `build/icon.ico` and asserts:
  - 9 entries with sizes 16, 20, 24, 32, 40, 48, 64, 128 and 256;
  - each entry is a valid PNG whose IHDR size matches its entry;
  - the 256 px PNG's centre-left pixel is white and its corner pixel is transparent.
- Extend `check-packaged-app.mjs`: the packaged `StorageIQ.exe` has an icon resource that is not Electron's default. Compare the size or a hash of the extracted group icon, or read it through `app.getFileIcon` in the self-test.

**Owner manual checks:**

- The logo is crisp at 100 %, 125 % and 150 % scaling in the taskbar, the Start menu, the title bar, the installer and Apps & features.
- It shows on light and on dark taskbars.

**Gate:**

- `npm run format`, `npm run format:check`, `npm run lint`;
- `npm run typecheck:node` and `npm run typecheck:web`;
- `npx vitest run`;
- the package build, then `npm run test:packaged`.

**Commit:** `feat(brand): add the StorageIQ logo and Windows app icon`, with explicit paths and no AI attribution.

### Task 13: Help tab, About, update checks and What's new

**Implementer tier:** standard (state machine in main, IPC surface, a ribbon tab, two dialogs, a bundled changelog). Do the steps in order; the renderer comes last.

**Why (owner request, 2026-11-25):** the About box is a placeholder (a version line and one sentence). The owner wants (1) an About section with an update button, (2) a notification when a new version is released, (3) a click to update, and (4) after the update, details of what is new or changed. Task 10's updater downloads silently and only announces `update:ready` after the download; the user cannot choose, cannot check by hand and never sees what changed. Task 14 (separate: Explorer context-menu integration and “always run as administrator”) will add an Options tab; this task adds **no** Options tab.

**Start state (read these first, extend, do not duplicate):** `src/main/updater/updater.ts` (`createUpdater`, `UpdaterLike`, `hasPrereleaseTag`, `UPDATE_FIRST_CHECK_DELAY_MS` 10 s, `UPDATE_CHECK_INTERVAL_MS` 6 h, nothing runs unpackaged or under `--self-test`); `src/main/index.ts` (creates the updater after the window, `installUpdate: () => updater?.install()`, re-sends `update:ready` on `did-finish-load`); `src/main/ipc/app-handlers.ts` (`app:get-info`, `update:install`); `src/shared/ipc-contract.ts` (`AppInfo` with `electronVersion`, `UpdateReady`, `'update:ready'`, `onUpdateReady`); `components/UpdateBanner.tsx` (store field `updateReady`, `installUpdate`, `dismissUpdate`). **An About screen already exists and is reused, not duplicated:** `App.tsx` holds local `aboutOpen` and an inline `<Dialog title="About StorageIQ">` (version line plus one sentence), opened by the **About** `RibbonButton` in the **File** tab (`Ribbon.tsx`, group “App”, prop `onAbout`). This task turns that inline dialog into `AboutDialog` and moves the About button to the new Help tab. Also read `components/Dialog.tsx` (native modal `<dialog>`, Esc closes, focus returns to the opener, Close button autofocused), `Ribbon.tsx` (`RibbonTab = 'file' | 'home' | 'scan' | 'view'`, `TABS`, `panels`, `Group`), `RibbonButton.tsx`, `scripts/build-notices.cjs` and `electron-builder.yml` (`extraResources` already ships `THIRD_PARTY_NOTICES.txt` to `resources/`), and `docs/RELEASING.md`. Task 12b creates `build/icon.svg` and edits `electron-builder.yml` (icon keys) and `package.json` scripts: do not start the logo step before `build/icon.svg` exists, and start from the working tree of those files.

**Decisions (owner can overrule, see Open questions):**

- `autoDownload = false`: the user chooses. A found update is announced; **Update** downloads it; **Restart to update** installs. `autoInstallOnAppQuit` stays `true`, so a downloaded update still installs at the next normal quit.
- The state machine lives in main and the renderer only reads it (pull once, then push).
- What's new has three sources: the bundled `CHANGELOG.md` (installed versions), electron-updater's release notes converted to plain text (a version not yet installed), and a link to the release page as the fallback. Nothing is ever rendered as HTML or Markdown.
- The renderer never sends a URL or a path: it sends fixed keys, main owns the targets.
- Entry points live in a new **Help** ribbon tab (rule 17). The File tab keeps only Exit.
- This task does **not** bump `package.json` (stays `0.1.0`); the owner bumps to `0.2.0-beta.1` when releasing (docs/RELEASING.md).

**Files:**

- Create: `CHANGELOG.md`; `src/shared/semver.ts` (+ `semver.test.ts`); `src/main/about/parse-changelog.ts` (+ test); `src/main/about/release-notes.ts` (+ test); `src/main/about/whats-new-store.ts` (+ test); `src/main/ipc/update-handlers.ts` (+ test); `src/main/ipc/about-handlers.ts` (+ test); `src/renderer/src/components/AppLogo.tsx` (+ `AppLogo.test.tsx`); `AboutDialog.tsx` (+ test); `WhatsNewDialog.tsx` (+ test); `e2e/about.spec.ts`.
- Modify: `src/main/updater/updater.ts` (+ `updater.test.ts`); `src/shared/ipc-contract.ts`; `src/main/ipc/parse-args.ts` (+ test); `src/main/ipc/register.test.ts`; `src/main/ipc/app-handlers.ts` (+ test, `AppInfo` extras only); `src/main/index.ts`; `src/preload/index.ts` (+ test); `src/renderer/src/stores/workspace-store.ts` (+ test); `src/renderer/src/test/fake-api.ts`; `components/UpdateBanner.tsx` (+ test); `components/Ribbon.tsx`, `components/RibbonButton.tsx` (+ tests); `src/renderer/src/App.tsx` (+ `App.test.tsx`); `electron-builder.yml` (one `extraResources` entry only); `scripts/check-packaged-app.mjs`; `docs/RELEASING.md`. Another change set (Task 12b) may be open on `electron-builder.yml` and `package.json`: keep its edits.

**Interfaces:**

`ipc-contract.ts` (types, then channels):

```ts
export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'unavailable'; message: string } // unpackaged or self-test run
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; version: string; percent: number } // integer 0..100
  | { kind: 'ready'; version: string }
  | { kind: 'error'; message: string }
export interface ChangelogSection {
  title: string
  items: string[]
}
export interface ChangelogEntry {
  version: string
  date: string | null
  sections: ChangelogSection[]
}
export type AboutLink = 'repo' | 'license' | 'releases' | 'help' | 'issues'
export type ReleaseNotes = { version: string; text: string | null }
```

- `AppInfo` gains `chromeVersion: string` and `channel: 'Beta' | 'Stable'` (`electronVersion` already exists; `app:get-info` stays the About data source, no new About channel).
- New channels: `'update:get-state': { args: []; result: UpdateState }`, `'update:check': { args: []; result: UpdateState }`, `'update:download': { args: []; result: void }`, `'update:get-release-notes': { args: []; result: ReleaseNotes | null }`, `'app:get-changelog': { args: []; result: ChangelogEntry[] }`, `'app:open-notices': { args: []; result: { opened: boolean } }`, `'app:open-link': { args: [link: AboutLink]; result: void }`, `'app:get-whats-new-due': { args: []; result: ChangelogEntry | null }`, `'app:mark-whats-new-seen': { args: []; result: void }`. `'update:install'` stays.
- Event: `'update:state': UpdateState` **replaces** `'update:ready'`. `UpdateReady`, `onUpdateReady` and the store's `updateReady` are deleted.
- `StorageIQApi`: `getUpdateState()`, `checkForUpdates()`, `downloadUpdate()`, `installUpdate()` (exists), `getReleaseNotes()`, `onUpdateState(listener)`, `getChangelog()`, `openNotices()`, `openLink(link)`, `getWhatsNewDue()`, `markWhatsNewSeen()`.

`semver.ts`: `parseVersion(v: string): ParsedVersion | null`, `compareVersions(a: string, b: string): -1 | 0 | 1 | null` (null when either is invalid).

`updater.ts`: `UpdaterLike` gains `downloadUpdate(): Promise<unknown>` and the events `'checking-for-update'`, `'update-available'` (`info: { version: string; releaseNotes?: unknown }`), `'update-not-available'`, `'download-progress'` (`{ percent: number }`) beside the existing two. `UpdaterDeps.send` is `(event: 'update:state', payload: UpdateState) => void`. `Updater` becomes `{ start(); checkNow(): UpdateState; download(): void; install(): void; dispose(); readonly state: UpdateState; readonly releaseNotes: ReleaseNotes | null }`. New constant `UPDATE_CHECK_TIMEOUT_MS = 60_000`.

`whats-new-store.ts`: `createWhatsNewStore(deps: { filePath: string; readFile; writeFile; rename; log })` returning `{ read(): Promise<string | null>; write(version: string): Promise<void> }`; the file is `<userData>/whats-new.json`, `{ "lastSeenVersion": "<semver>" }`.

**Rules:**

_Semver and changelog (pure, tested first)_

1. `parseVersion` accepts `MAJOR.MINOR.PATCH`, optional `-prerelease` (dot-separated `[0-9A-Za-z-]+` identifiers) and optional `+build`, at most 64 characters, numeric parts at most 9 digits, no leading `v`, no leading zeros in numeric parts; anything else is `null`. `compareVersions` follows semver 2.0 precedence: build metadata ignored; a version with a prerelease is lower than the same version without; prerelease identifiers compare left to right, numeric ones numerically, numeric lower than alphanumeric, a shorter set lower when all earlier identifiers are equal (`0.2.0-beta.2` < `0.2.0-beta.10` < `0.2.0` < `0.10.0`).
2. `parseChangelog(text: string): ChangelogEntry[]` never throws. Heading `^##\s+\[([^\]\s]+)\]\s*(?:-\s*(\d{4}-\d{2}-\d{2}))?\s*$` starts an entry; an invalid version (including `Unreleased`) skips that entry and everything under it. `^###\s+(.+?)\s*$` starts a section; a bullet `^[-*]\s+(.+)$` is an item; a following non-blank line indented by two or more spaces is appended to the item with a single space; bullets before any `###` go to a section titled `Changes`; empty sections and entries with no items are dropped. Limits: input longer than 262,144 characters is cut there; at most 50 entries, 12 sections per entry, 40 items per section; an item is cut at 400 characters; titles at 60. Order is file order (newest first by convention). CRLF is accepted. Text is kept verbatim (no Markdown processing, no tag stripping: the renderer only ever shows text nodes).
3. `htmlToPlainText(notes: unknown): string | null` for electron-updater's `releaseNotes` (a string, an array of `{ version, note }`, or null): a string is converted, an array is joined by blank lines (each item's `note` only), anything else is `null`. Conversion: `<li>` becomes `- `, `</p>`, `<br>`, `</h1>` to `</h6>`, `</li>`, `</ul>` become a newline, every other tag is removed with `/<[^>]*>/g`, then the entities `&amp; &lt; &gt; &quot; &#39; &nbsp;` are decoded once, runs of three or more newlines collapse to two, the result is trimmed and cut at 20,000 characters. An empty result is `null`.

_Updater state machine (main)_

4. States and transitions (the list is the spec; every transition emits `update:state` only when the state actually changed, compared with `JSON.stringify`):
   - start: `idle`.
   - `checkNow()` unpackaged or under `--self-test`: state `{ kind: 'unavailable', message: 'Updates are available in the installed app.' }`, no listener registered, no network call, never throws.
   - `checkNow()` while `checking`, `downloading`, `available` or `ready`: no-op, returns the current state.
   - `checkNow()` otherwise: `checking`, calls `checkForUpdates()` (a synchronous throw or a rejection is handled like the `error` event) and arms a one-shot `UPDATE_CHECK_TIMEOUT_MS` guard.
   - `update-available` becomes `available` (version from `info.version`; its release notes are kept as plain text for `releaseNotes`); `update-not-available` becomes `up-to-date`.
   - `download()` only from `available`: state `downloading` at 0, calls `downloadUpdate()` (a rejection is handled like an error). `download-progress` sets `percent = clamp(round(percent), 0, 100)`. `update-downloaded` becomes `ready` and cancels the timers. Any other state: no-op.
   - `install()` only from `ready`: `quitAndInstall(false, true)` (unchanged from Task 10).
   - Errors: the raw error is logged with `deps.log`; the state carries only a fixed message: during a check `Could not check for updates. Check your connection and try again.`, during a download `Could not download the update. Try again.`. A background check (started by the timers) that fails or times out returns to `idle` quietly; a manual check or a download shows `error`. The timeout guard turns a stuck `checking` into the same outcome.
   - `error` and `up-to-date` allow a new `checkNow()`.
5. Background schedule is Task 10's (first check 10 s after start, then every 6 h) with one change: a timer tick starts a background check only in `idle`, `up-to-date` or `error`. `start()` sets `autoDownload = false`, `autoInstallOnAppQuit = true`, `allowPrerelease = hasPrereleaseTag(version)` (channel rule unchanged: see docs/RELEASING.md “Update channel”). A found update therefore stops the schedule (state is `available`); the timers are cancelled in `update-downloaded` and in `dispose`.
6. `Updater.state` and `releaseNotes` are read-only getters. `releaseNotes` is `{ version, text }` for the state's version when `available`, `downloading` or `ready`, else `null`.

_What's new bookkeeping and About actions (main)_

7. `app:get-whats-new-due` returns the changelog entry for the running version at most once per install of that version:
   - no file, an unreadable or corrupt file, or a `lastSeenVersion` that does not parse: write the current version, return `null` (a first install shows nothing);
   - current version lower than `lastSeenVersion` (a downgrade): write the current version, return `null`;
   - current version higher than `lastSeenVersion` and `CHANGELOG.md` has an entry with exactly that version: return the entry **without writing**;
   - current higher but no entry: write the current version, return `null`;
   - equal: `null`.
     `app:mark-whats-new-seen` writes the running version. The renderer sends no version in either call. The write is atomic (write `whats-new.json.tmp`, then `rename` over the file; reuse an existing atomic-write helper if `src/main` has one, search for `rename(` first); a failed write is logged and never thrown.
8. `app:get-changelog` reads the bundled file and returns `parseChangelog`'s entries, at most 10; an unreadable file returns `[]`. Path: `path.join(process.resourcesPath, 'CHANGELOG.md')` when `app.isPackaged`, else `path.join(app.getAppPath(), 'CHANGELOG.md')`. The file is read at most 256 KiB and cached in memory for the session.
9. `app:open-notices` opens `THIRD_PARTY_NOTICES.txt` with `shell.openPath`: `path.join(process.resourcesPath, 'THIRD_PARTY_NOTICES.txt')` packaged, `path.join(app.getAppPath(), 'out', 'THIRD_PARTY_NOTICES.txt')` unpackaged. A missing file or a non-empty `openPath` result returns `{ opened: false }`; the renderer sends no path.
10. `app:open-link` takes exactly one argument that must be one of `'repo'`, `'license'`, `'releases'`, `'help'`, `'issues'` (`InvalidIpcArgumentsError('expected a known link')` otherwise) and calls `shell.openExternal` with the fixed URL: `https://github.com/hoaiphongle0505/storageiq`, `https://github.com/hoaiphongle0505/storageiq/blob/main/LICENSE`, `https://github.com/hoaiphongle0505/storageiq/releases`, `https://github.com/hoaiphongle0505/storageiq#readme`, `https://github.com/hoaiphongle0505/storageiq/issues/new/choose`. A rejected `openExternal` is logged, not thrown.
11. IPC hygiene: every new channel is registered through the existing `register.ts` registry, so the sender check (trusted renderer URL, Task 4) and `InvalidIpcArgumentsError` apply with no new code; the zero-argument channels use `noArgs`; `update:download`, `update:install` and `update:check` ignore a state that does not allow them (rule 4) instead of throwing. `index.ts` passes `getUpdateState: () => updater?.state ?? { kind: 'idle' }`, `checkForUpdates: () => updater?.checkNow() ?? { kind: 'idle' }`, `downloadUpdate: () => updater?.download()`, and keeps `installUpdate`. The `did-finish-load` re-send becomes `sendEvent('update:state', updater.state)` when the state is not `idle`.
12. `AppInfo.channel` is `'Beta'` when `hasPrereleaseTag(version)`, else `'Stable'`; `chromeVersion` is `process.versions.chrome`.

_Packaging_

13. `CHANGELOG.md` ships outside the asar: `electron-builder.yml` `extraResources` gains `- from: CHANGELOG.md` / `to: CHANGELOG.md` next to the notices entry. `files`, `asarUnpack` and every other key stay as they are. `scripts/check-packaged-app.mjs` also fails when `resources/CHANGELOG.md` is missing, with the same message style as the notices check.
14. A repository test (in `parse-changelog.test.ts`) reads the real `CHANGELOG.md` and `package.json`: the real file parses to at least one entry, and the newest entry is not older than `package.json`'s version (so a release bump without a changelog entry fails the gate).

_Renderer: store, banner, Help tab_

15. Store: `updateState: UpdateState` (initial `{ kind: 'idle' }`), `dismissedUpdateVersion: string | null`, `whatsNew: WhatsNewTarget | null` where `type WhatsNewTarget = { kind: 'history' } | { kind: 'installed'; version: string } | { kind: 'update'; version: string }`. Actions: `checkForUpdates()`, `downloadUpdate()`, `installUpdate()` (exists), `dismissUpdate()` (sets `dismissedUpdateVersion` to the current `available`/`ready` version; session memory only), `openWhatsNew(target)`, `closeWhatsNew()`. `updateReady` and `onUpdateReady` are removed. A failing API call goes through the existing error/announcement pattern, never an unhandled rejection. On store start, in this order: subscribe `api.onUpdateState` (stores the payload), call `api.getUpdateState()` and store it (the pull reply and later pushes share one ordered channel, so a late reply cannot overwrite a newer push), then once per session call `api.getWhatsNewDue()`; when it returns an entry the store calls `api.markWhatsNewSeen()` **immediately** and opens `{ kind: 'installed', version: entry.version }` (marking at open time keeps “once” true even if the app is closed with the dialog open). A `whatsNewChecked` flag stops a store re-init from reopening it.
16. `UpdateBanner` (same slot in `App.tsx`, `role="status"`, never takes focus) shows by state:

- `available` (and `dismissedUpdateVersion !== version`): text `StorageIQ {version} is available.`, buttons `Update` (primary, `downloadUpdate`), `What's new` (`openWhatsNew({ kind: 'update', version })`), `Later` (`dismissUpdate`);
- `downloading`: text `Downloading StorageIQ {version}… {percent}%` and a `<progress>` with `aria-label="Update download"`, `value`, `max=100`; no buttons;
- `ready` (not dismissed): text `StorageIQ {version} is ready. Restart to update.`, buttons `Restart to update`, `What's new`, `Later`;
- any other state, or dismissed: renders nothing. A manual-check `error` is shown in About only, never in the banner.
  A dismissed version comes back for a **different** version (a newer release) because the key is the version string. The polite live text changes at most once per 10 percent (`Math.floor(percent / 10)`), so a screen reader is not flooded.

17. **Help tab.** `RibbonTab` becomes `'file' | 'home' | 'scan' | 'view' | 'help'`; `TABS` gets `{ id: 'help', label: 'Help' }` as the last tab; the `panels` record gets a `help` panel with two groups, using the existing `Group` and `RibbonButton` (Fluent icons from `lib/icons`; reuse `IconAbout`; for the others pick the closest existing glyphs and add missing ones in the same style, 24 px as in Task 12; no new icon library):

- Group **Help**: `Help` (`openLink('help')`, title `Open the StorageIQ guide in your browser`) and `Report a problem` (`openLink('issues')`, title `Open the issue form in your browser`);
- Group **Version**: `About` (opens `AboutDialog`, the existing `onAbout`), `Check for updates` (calls `checkForUpdates()` and opens `AboutDialog`, whose status region shows the result), `What's new` (`openWhatsNew({ kind: 'history' })`).
  The File tab keeps only the Exit button (group “App”); About moves to the Help tab, and the existing tab-order, arrow-key and `aria-selected` tests are updated for the extra tab. The renderer sends only the keys of rule 10.

18. **Notification dot.** `RibbonButton` gains `badge?: boolean`: an 8 px `aria-hidden` dot in `--accent` at the icon's top right, and the button's accessible name gets `, update available` appended (`aria-label`), visible label and `title` unchanged. The tab label button gets the same dot through the tab rendering in `Ribbon.tsx` (`aria-label` `Help, update available`). While `updateState.kind` is `available`, `downloading` or `ready` the dot shows on the **Help tab** and on the **Check for updates** button, regardless of the banner being dismissed. Under `forced-colors` the dot uses `Highlight`. No animation, no count.

_Renderer: dialogs_

19. `AppLogo({ size })`: the master artwork of `build/icon.svg` (Task 12b) as a React SVG component, `aria-hidden="true"`, `viewBox="0 0 64 64"`, `width`/`height` = size (About uses 64), with the file's `rect` and `path` attributes copied verbatim. It needs no asset loading, so the CSP (`img-src 'self' data:`) is untouched. `AppLogo.test.tsx` reads `build/icon.svg` with `fs` and asserts that the sorted multiset of `d`, `fill`, `stroke`, `stroke-width`, `rx` values of the file equals the one in the rendered markup, so the logo cannot drift from the master. If `build/icon.svg` does not exist, stop and report (Task 12b not merged).
20. `AboutDialog` replaces the inline About in `App.tsx` and keeps using the existing `Dialog` (modal, focus trap by `showModal`, Esc closes, labelled by its title, Close button autofocused, focus returns to the opener). Content, top to bottom:

- `AppLogo` (64), the name `StorageIQ`, `Version {version}` with a pill `{channel}` (`Beta` or `Stable`), the muted line `Electron {electronVersion}, Chromium {chromeVersion}`;
- the sentence already there (`Shows where your disk space went. Free and open source under the MIT license.`);
- the update block, a polite `role="status"` region whose text and buttons follow the state: `idle` shows `Check for updates`; `checking` shows `Checking for updates…` with `Check for updates` as `aria-disabled`; `up-to-date` shows `You have the latest version.` and `Check for updates`; `unavailable` shows its message and `Check for updates`; `available` shows `StorageIQ {version} is available.` with `Update` and `What's new`; `downloading` shows `Downloading StorageIQ {version}… {percent}%` plus the same `<progress>` as the banner and no buttons; `ready` shows `StorageIQ {version} is ready.` with `Restart to update`; `error` shows its message and `Check for updates`;
- a button row (all `Button variant="quiet"`, real `<button>`s): `What's new` (`openWhatsNew({ kind: 'history' })`), `GitHub repository` (`openLink('repo')`), `MIT licence` (`openLink('license')`), `Third-party notices` (`api.openNotices()`; on `{ opened: false }` the status region shows `The notices file was not found.`).
  Opening What's new from About closes About first (`onClose()` then `openWhatsNew`), so only one modal is open at a time. Progress text follows rule 16's 10 percent step.

21. `WhatsNewDialog` (uses `Dialog`; title `What's new`) renders by target:

- `history`: the first 10 entries of `api.getChangelog()`, newest first; each entry is a `<section>` with an `<h3>` `Version {version}` plus ` ({date})` when a date exists, each section an `<h4>` title and a `<ul>` of items;
- `installed`: only the entry whose version equals `target.version`, same markup (when absent: `No release notes are bundled with this version.` and a `View release page` button, `openLink('releases')`);
- `update`: `api.getReleaseNotes()` text in a `<div className="whitespace-pre-wrap">` (a text node, never HTML); when `text` is `null` or the call fails: `Release notes are on the release page.` and the `View release page` button.
  While loading it shows `Loading…` in a polite status. All text goes through React text nodes; the files contain no `dangerouslySetInnerHTML`.

22. `App.tsx`: `aboutOpen` stays local; `whatsNew` comes from the store and renders `WhatsNewDialog` when non-null. The F5 guard (`dialog[open]`) already covers both dialogs. F1 is not added.

**Open questions (owner):**

1. **Behaviour change:** Task 10 downloaded updates silently and installed them on the next quit with no action. Now a user who never clicks **Update** is never updated. Say if a setting “download updates automatically” is wanted later (it fits Task 14's Options tab; not built here).
2. **`unavailable` is a state beyond the owner's list**, used for the unpackaged message so it is not styled as an error.
3. **What's new for a stable release after beta:** a beta user updating to `0.2.0` sees notes only if `CHANGELOG.md` has a `0.2.0` entry (rule 7); rule 14 makes the gate enforce an entry at release time.
4. **About moves from File to Help.** Say if it should also stay on the File tab.

**Initial `CHANGELOG.md` (include exactly this text):**

```markdown
# Changelog

All notable changes to StorageIQ are listed here, newest first. The format follows Keep a Changelog and the versions follow Semantic Versioning.

## [0.2.0-beta.1] - 2026-11-25

### Added

- A workspace with a folder tree and a treemap side by side. The treemap colours each kind of file, and a legend explains the colours.
- The Strata look: a refreshed design for the ribbon, the tree and the treemap.
- Windows shell icons for files and folders in the tree, and Fluent icons in the ribbon.
- Explorer's own right-click menu on every row, with Open, Properties, Send to and the rest.
- Select several rows at once and act on them together.
- A new StorageIQ logo and app icon.
- An installer that can install StorageIQ for you only or for everyone who uses the computer.
- Automatic update checks. When a new version is out, StorageIQ tells you and you choose when to update.
- A Help tab with Help, Report a problem, About, Check for updates and What's new.
- An About window with the version, the licence, third-party notices and a Check for updates button.
- What's new: the changes of a version open once after an update, and from the Help tab at any time.

### Changed

- Scanning is much faster because several folders are read at the same time. About 1.5 minutes for 1.9 million files on the developer's machine.
- Deleting many items no longer freezes the window. Windows shows its own progress while StorageIQ stays usable.

### Fixed

- Rows no longer stay in the tree after the item was deleted in Explorer or from the menu, and folder totals update.
```

**Tests (names exact, by file):**

`src/shared/semver.test.ts`:

- `parseVersion accepts release, prerelease and build versions`
- `parseVersion rejects leading v, leading zeros, extra parts and long input`
- `compareVersions orders prerelease below release`
- `compareVersions compares numeric prerelease identifiers numerically`
- `compareVersions ignores build metadata`
- `compareVersions returns null for an invalid version`

`src/main/about/parse-changelog.test.ts`:

- `parses entries, dates and sections in file order`
- `joins wrapped bullet lines`
- `puts bullets without a section under Changes`
- `skips Unreleased and invalid versions`
- `drops empty sections and entries`
- `accepts CRLF line endings`
- `returns an empty list for empty, binary or malformed input without throwing`
- `applies the entry, section, item and length limits`
- `keeps HTML and Markdown characters as plain text`
- `the real CHANGELOG parses and is not older than package.json`

`src/main/about/release-notes.test.ts`:

- `converts list items and paragraphs to plain lines`
- `removes every tag including script and style tags` (no `<` survives; script text stays inert text)
- `decodes the common entities once`
- `joins an array of notes and ignores versions`
- `returns null for null, numbers and empty results`
- `cuts the text at 20000 characters`

`src/main/about/whats-new-store.test.ts` (fake fs):

- `a missing file reads as null`
- `a corrupt file reads as null`
- `write goes through a temp file and a rename`
- `a failed write is logged and not thrown`

`src/main/ipc/about-handlers.test.ts`:

- `get-whats-new-due returns null and records the version on a first install`
- `get-whats-new-due returns the entry after an upgrade and does not write`
- `get-whats-new-due compares prerelease versions (beta.1 to beta.2, beta to stable)`
- `get-whats-new-due returns null and records the version on a downgrade`
- `get-whats-new-due returns null and records the version when the changelog has no entry`
- `mark-whats-new-seen writes the running version`
- `get-changelog returns at most 10 entries and an empty list when the file is missing`
- `open-notices returns opened false when the file is missing or openPath fails`
- `open-link opens only the five fixed URLs`
- `open-link rejects an unknown key, a URL, a missing argument and extra arguments`
- `zero-argument channels reject any argument`

`src/main/ipc/update-handlers.test.ts`:

- `update:get-state, update:check, update:download and update:get-release-notes call the updater`
- `update:check and update:download reject any argument`
- `the handlers answer idle when there is no updater`

`src/main/ipc/register.test.ts` (extend):

- `refuses an untrusted sender on every update and about channel` (`it.each` over the nine new channels)

`src/main/updater/updater.test.ts` (fake `autoUpdater` extended with an event emitter and `downloadUpdate`):

- `start sets autoDownload false, autoInstallOnAppQuit true and the channel`
- `an unpackaged or self-test checkNow reports unavailable and never calls the updater`
- `checkNow moves idle to checking to up-to-date`
- `update-available moves to available and keeps plain-text release notes`
- `checkNow is a no-op while checking, available, downloading or ready`
- `download only runs from available and moves to downloading`
- `download-progress rounds and clamps the percent`
- `update-downloaded moves to ready and cancels the timers`
- `install quits and installs only from ready`
- `a manual check error shows the fixed message and logs the raw error`
- `a background check error returns to idle and shows nothing`
- `a download error shows the fixed download message`
- `a stuck check times out after UPDATE_CHECK_TIMEOUT_MS`
- `the first background check runs after 10 s and the interval skips available, downloading and ready`
- `a state is only sent when it changed`

`src/preload/index.test.ts` (extend; remove the `onUpdateReady` test):

- `each new method invokes its channel with the documented arguments` (`openLink` passes its one key)
- `onUpdateState subscribes to update:state and returns an unsubscribe`

`src/renderer/src/stores/workspace-store.test.ts` (extend; replace the `update:ready` tests):

- `update:state events set updateState`
- `startup pulls the state and subscribes`
- `dismissUpdate remembers the version and a newer version shows again`
- `checkForUpdates, downloadUpdate and installUpdate call the api`
- `a failing update call does not throw`
- `a due What's new entry opens once, marks it seen at once and is not opened twice`
- `no due entry opens nothing`

`src/renderer/src/components/UpdateBanner.test.tsx`:

- `available shows the message with Update, What's new and Later`
- `Update calls downloadUpdate`
- `What's new opens the update target`
- `Later hides the banner until a different version is available`
- `downloading shows a labelled progress bar and no buttons`
- `ready shows Restart to update, which calls installUpdate`
- `idle, checking, up-to-date and error render nothing`
- `the progress text changes once per ten percent`

`AboutDialog.test.tsx`:

- `shows the logo, name, version, channel and engine versions`
- `labels the channel Beta for a prerelease version and Stable otherwise`
- `idle offers Check for updates and clicking it calls checkForUpdates`
- `checking is announced and the button is aria-disabled`
- `up-to-date, unavailable and error show their text`
- `available offers Update and What's new`
- `downloading shows progress and hides the buttons`
- `ready offers Restart to update`
- `What's new closes About and opens the history target`
- `links call openLink with repo and license`
- `Third-party notices calls openNotices and reports a missing file`
- `is a labelled modal dialog and Escape closes it`

`WhatsNewDialog.test.tsx`:

- `history lists entries newest first with date and sections`
- `installed shows only the matching entry`
- `installed without an entry shows the message and the release page button`
- `update shows the release notes as plain text and does not parse HTML` (an `<img onerror>` string appears as text and no `img` exists)
- `update with null text falls back to the release page button`
- `a failing getReleaseNotes falls back to the release page button`
- `Escape closes it`

`AppLogo.test.tsx`: `matches build/icon.svg`, `is hidden from assistive technology`.

`Ribbon.test.tsx` (extend):

- `the Help tab is last and shows the Help and Version groups`
- `the File tab keeps Exit and no longer has About`
- `Help and Report a problem call openLink with help and issues`
- `About opens the About dialog`
- `Check for updates calls checkForUpdates and opens the About dialog`
- `What's new opens the history target`
- `the Help tab and the Check for updates button show a dot while an update is available, downloading or ready`
- `no dot when idle, checking, up-to-date or error`

`RibbonButton.test.tsx` (extend): `badge adds a hidden dot and update available to the accessible name`.

`App.test.tsx` (extend): `About opens from the Help tab`, `the What's new dialog opens from the banner`.

`e2e/about.spec.ts` (launches the built, unpackaged app with `launchApp`):

- `About opens from the Help tab, shows the version and the logo, and closes with Escape`
- `Check for updates in an unpackaged app shows “Updates are available in the installed app.” and makes no network request`
- `What's new lists the CHANGELOG entry 0.2.0-beta.1 with its sections`
- `the Help tab has Help, Report a problem, About, Check for updates and What's new buttons` (nothing is clicked that opens a browser)
- `no console or CSP errors while About and What's new are open` (use `consoleErrors`)

**Steps:**

- [ ] **Step 1: Prerequisites.** Confirm `build/icon.svg` exists (Task 12b). Read the files in “Start state”. Run `npx vitest run` and note the baseline.
- [ ] **Step 2: Pure modules, tests first.** `semver.ts`, `parse-changelog.ts`, `release-notes.ts`, `whats-new-store.ts` with their tests (red, then green). Create `CHANGELOG.md` from the block above.
- [ ] **Step 3: Contract and parsers.** `ipc-contract.ts` (types, channels, event, API), `parse-args.ts` (`aboutLinkArg`), `AppInfo` extras in `app-handlers.ts`.
- [ ] **Step 4: Updater state machine.** Rewrite `updater.ts` per rules 4 to 6 with the extended fake; delete the `update:ready` tests and keep the schedule tests that still apply.
- [ ] **Step 5: Handlers and wiring.** `update-handlers.ts`, `about-handlers.ts`, register them, extend `register.test.ts`, wire `index.ts` (including the `did-finish-load` re-send), `src/preload/index.ts` and its test, `fake-api.ts` (`emitUpdateState`, new fakes).
- [ ] **Step 6: Packaging and docs.** `extraResources` entry for `CHANGELOG.md`, `check-packaged-app.mjs` check, `docs/RELEASING.md`: replace the “An update downloads in the background…” paragraph with the new flow (banner and Help tab, **Update**, **Restart to update**, installs at quit when downloaded, What's new once after the update), add a release step “add the `## [X.Y.Z]` entry to `CHANGELOG.md` before bumping the version”, and update “Testing an update” to click **Update** then **Restart to update**.
- [ ] **Step 7: Store, banner, Help tab and dot.** Rules 15 to 18 with their tests.
- [ ] **Step 8: Dialogs.** `AppLogo`, `AboutDialog`, `WhatsNewDialog`, `App.tsx` (rules 19 to 22) with their tests. Run `impeccable detect --json src/renderer` (expected `[]`).
- [ ] **Step 9: e2e.** `e2e/about.spec.ts`.
- [ ] **Step 10: Gate** (below).
- [ ] **Step 11: Commit** with explicit paths:

```bash
git add CHANGELOG.md docs/RELEASING.md electron-builder.yml scripts/check-packaged-app.mjs e2e/about.spec.ts src/shared/semver.ts src/shared/semver.test.ts src/shared/ipc-contract.ts src/main/about src/main/ipc src/main/updater src/main/index.ts src/preload/index.ts src/preload/index.test.ts src/renderer/src/stores/workspace-store.ts src/renderer/src/stores/workspace-store.test.ts src/renderer/src/test/fake-api.ts src/renderer/src/lib/icons.ts src/renderer/src/App.tsx src/renderer/src/App.test.tsx src/renderer/src/components/AppLogo.tsx src/renderer/src/components/AppLogo.test.tsx src/renderer/src/components/AboutDialog.tsx src/renderer/src/components/AboutDialog.test.tsx src/renderer/src/components/WhatsNewDialog.tsx src/renderer/src/components/WhatsNewDialog.test.tsx src/renderer/src/components/UpdateBanner.tsx src/renderer/src/components/UpdateBanner.test.tsx src/renderer/src/components/Ribbon.tsx src/renderer/src/components/Ribbon.test.tsx src/renderer/src/components/RibbonButton.tsx src/renderer/src/components/RibbonButton.test.tsx
git status --short   # nothing unrelated staged (drop src/renderer/src/lib/icons.ts if no glyph was added)
```

**Owner manual checks** (need two published versions; use docs/RELEASING.md “Testing an update” with `0.1.1-test.N`, and add a `CHANGELOG.md` entry for the newer one):

1. Open the Help tab: Help and Report a problem open the README and the issue form in the browser; About shows logo, version, `Beta` or `Stable`, Electron and Chromium versions; its links open in the default browser; Third-party notices opens the file; Esc closes and focus returns to the button; the dialog is readable with Narrator.
2. Install version N, publish N+1, start N: within about 10 seconds the banner `StorageIQ N+1 is available.` shows with **Update**, **What's new**, **Later**; the Help tab and the Check for updates button show the dot. **What's new** shows the release notes as plain text. **Later** hides the banner for the session; the dot stays.
3. Click **Update**: progress shows in the banner and in About; then **Restart to update** installs and relaunches (per-machine installs ask for administrator approval).
4. After the restart, What's new opens once with the changelog of N+1; relaunch: it does not open again; Help → **What's new** still lists it.
5. First install of N on a clean profile: no What's new dialog.
6. Help → **Check for updates** on the newest version says `You have the latest version.`; offline it shows the connection message, no raw error text.

**Gate:**

- `npm run format`, `npm run format:check`, `npm run lint`;
- `npm run typecheck:node` and `npm run typecheck:web`;
- `npx vitest run`;
- `npm run test:e2e`;
- the package build, then `npm run test:packaged` (it must report `CHANGELOG.md` and `THIRD_PARTY_NOTICES.txt` in `resources`, and the unpacked list unchanged).

**Commit:** `feat(update): add the Help tab, About, update checks, update notification and What's new`, with explicit paths and no AI attribution.

### Task 14: Options tab — Explorer integration and run as administrator

**Implementer tier:** standard (Win32 registry through koffi, a launch-argument path that crosses process and integrity levels, NSIS cleanup, IPC bounds; build in the order of the steps, the spike and the pure logic before the native code and the renderer).

**Why (owner request):** two Windows-integration options in a new ribbon tab: (1) "Scan with StorageIQ" in Explorer’s right-click menu for folders, drives and the folder background; (2) an "Always start StorageIQ as administrator" switch, so protected folders (for example `C:\Windows`, other users’ profiles) are readable. Both reflect what Windows actually has (the registry), never a copy kept in app settings.

**Global Constraints interaction (state it in the commit body):** the line “the scanner never asks for elevation” stays true: the scanner is unchanged and never prompts. The _app_ can be started elevated by the owner’s explicit choice through the Windows compatibility flag below; nothing in StorageIQ elevates itself at runtime. No new dependency (koffi is already installed). No competitor is named anywhere.

**Decisions (this plan’s; owner approved the requirements, the choices below are the plan’s):**

1. **Registry API: koffi + `advapi32.dll`, not `reg.exe`.** koffi is already loaded in main (drive API) and in the shell and icon workers, so this adds no dependency and no process. `reg.exe` would work through `execFile` with an argument array (no shell), but it spawns a process per call, its output is localised and has to be parsed, and `reg add` re-parses the data string (quotes inside `"<exe>",0`). The direct calls take UTF-16 strings and need no quoting at all. Registry calls are microsecond-scale, so they run synchronously in main (no worker), behind an injectable `RegistryAdapter` so every rule is unit-testable with a fake.
2. **`%V` for all three keys.** `%1` is the clicked item’s path for `Directory` and `Drive`, but a `Directory\Background` verb has no clicked item: `%1` is not substituted there. `%V` is the folder path in every one of the three cases (the folder, the drive root, the folder being viewed), so one command string serves all three keys.
3. **The trailing-backslash trap.** `%V` expands to `C:\` for a drive and for the background of a drive root. In `"C:\"` the sequence `\"` is an escaped quote under Windows command-line rules, so Chromium’s argv would hold `C:"` (and swallow later arguments). The registered command stays the conventional `"<exe>" --scan "%V"` and the **parser** repairs the case (rule 9). The unit tests pin this.
4. **Launch hand-off goes through the renderer’s existing scan-start flow.** Main parses and validates the launch path, then tells the renderer _“scan this validated path”_ (event `launch:request`, or the pull `launch:take-request` on first launch). The renderer calls the existing `startScan(path)` → `scan:start`, which already takes a path from the renderer and re-validates it in `parseScanRoot`; so no new “renderer sends a raw path” channel exists and the store shows the scan exactly as if the owner had picked the folder. Main does not start scans behind the renderer’s back.
5. **A scan already running: ask, do not silently discard.** If `phase === 'scanning'` the renderer shows the existing `Dialog` component: title “Scan another folder?”, body “StorageIQ is still scanning {current target}. Stop it and scan {new path} instead?”, buttons “Scan {leaf}” and “Keep current scan”. When not scanning, or when the window is empty or showing a finished scan, the scan starts immediately (a finished tree is replaced, as with “Select”).
6. **Run as administrator uses the per-user compatibility-layer flag**, not a manifest change and not a scheduled task: `HKCU\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers`, value name = the exe’s full path, data `~ RUNASADMIN`. It needs no admin to set, it is what Explorer’s Properties → Compatibility → “Run this program as an administrator” writes, and Windows shows UAC on the next launch (including launches from the Explorer menu).
7. **Reality over settings:** `options:get-state` reads the registry every time the Options tab is shown; no app setting is stored.
8. **Dev and unpackaged runs** (`!app.isPackaged`): both checkboxes disabled with the text “Available in the installed app”, because `process.execPath` would be `electron.exe` and registering it would point Explorer at a development binary.
9. **Windows 11 note (owner-facing):** classic registry verbs appear under “Show more options” (or Shift+F10) in the Windows 11 menu. This is by design of the platform for per-user registry verbs; the README says so.

**Out of scope:** the new Windows 11 top-level menu (needs a packaged COM `IExplorerCommand` handler), file-type associations, tray, the elevated-drag-drop workaround (the app accepts no dropped files today), a Windows service or scheduled task for elevation.

**Files:**

- Create: `src/main/registry/registry-adapter.ts` (interface and constants), `src/main/registry/win-registry.ts` (koffi implementation), `src/main/registry/win-registry.native.test.ts`
- Create: `src/main/options/layers-flags.ts` (+ test), `explorer-menu.ts` (+ test), `run-as-admin.ts` (+ test), `options-service.ts` (+ test)
- Create: `src/main/launch/launch-args.ts` (+ test), `launch-coordinator.ts` (+ test)
- Create: `src/main/ipc/options-handlers.ts` (+ test), `src/main/ipc/launch-handlers.ts` (+ test)
- Create: `src/renderer/src/components/OptionsGroup.tsx` (+ test)
- Create: `build/installer.nsh`
- Modify: `src/main/ipc/parse-args.ts` (+ test; `oneBoolean`), `src/main/ipc/scan-handlers.ts` (export the shared validation used by launch-args, behaviour unchanged), `src/shared/ipc-contract.ts`, `src/preload/index.ts` (+ test), `src/main/index.ts`, `src/renderer/src/components/Ribbon.tsx` (+ test), `src/renderer/src/stores/workspace-store.ts` (+ test), `src/renderer/src/App.tsx` (+ test), `src/renderer/src/test/fake-api.ts`, `electron-builder.yml` (comment only if needed; `build/installer.nsh` is picked up from `buildResources`, verify in Step 9), `scripts/check-packaged-app.mjs` (optional self-test probe), `e2e/workspace.spec.ts`, `README.md`, `docs/RELEASING.md`, `docs/ROADMAP.md`

**Interfaces (exact names):**

```ts
// src/main/registry/registry-adapter.ts   (every key path is relative to the hive root)
export type RegistryHive = 'HKCU' | 'HKLM'
export interface RegistryAdapter {
  /** REG_SZ value; `name === ''` is the key’s (Default). null when the key or value is absent. */
  getString(hive: RegistryHive, key: string, name: string): string | null
  /** Creates the key (and parents) if needed, then writes a REG_SZ. HKCU only. */
  setString(key: string, name: string, value: string): void
  /** Deletes one value; a missing key or value is not an error. HKCU only. */
  deleteValue(key: string, name: string): void
  /** Deletes the key and everything below it; a missing key is not an error. HKCU only. */
  deleteTree(key: string): void
}
```

```ts
// src/shared/ipc-contract.ts additions
export interface OptionsState {
  /** false when unpackaged (or not Windows): both switches are shown disabled. */
  available: boolean
  /** All three Explorer verbs exist with a command for the current exe. */
  explorerMenu: boolean
  /** HKCU or HKLM carries RUNASADMIN for the current exe. */
  runAsAdmin: boolean
  /** RUNASADMIN comes from HKLM (policy or an administrator): it cannot be turned off here. */
  runAsAdminLocked: boolean
}
export interface OptionsChangeResult {
  state: OptionsState
  /** Calm one-line message when Windows refused the change; null on success. */
  error: string | null
}
export type LaunchRequest =
  | { kind: 'scan'; path: string }
  | { kind: 'invalid'; message: string }
// IpcContract
'options:get-state': { args: []; result: OptionsState }
'options:set-explorer-menu': { args: [enabled: boolean]; result: OptionsChangeResult }
'options:set-run-as-admin': { args: [enabled: boolean]; result: OptionsChangeResult }
'launch:take-request': { args: []; result: LaunchRequest | null }
// IpcEventContract
'launch:request': LaunchRequest
// StorageIQApi
getOptionsState(): Promise<OptionsState>
setExplorerMenu(enabled: boolean): Promise<OptionsChangeResult>
setRunAsAdmin(enabled: boolean): Promise<OptionsChangeResult>
takeLaunchRequest(): Promise<LaunchRequest | null>
onLaunchRequest(listener: (request: LaunchRequest) => void): Unsubscribe
```

```ts
// src/main/launch/launch-args.ts
export const SCAN_FLAG = '--scan'
export const MAX_LAUNCH_PATH_CHARS = 1024
/** The raw value after `--scan` (or `--scan=value`), repaired per rule 9; null when the flag is absent. */
export function findScanArgument(argv: readonly string[]): string | null
export function resolveLaunchRequest(
  argv: readonly string[],
  stat: (path: string) => Promise<{ isDirectory(): boolean }>,
): Promise<LaunchRequest | null> // null: no --scan flag at all

// src/main/launch/launch-coordinator.ts
export interface LaunchCoordinator {
  /** First launch and second-instance both call this with the process’s full argv. */
  handleArgv(argv: readonly string[]): Promise<void>
  /** `launch:take-request`: returns and clears the pending request; marks the renderer ready. */
  take(): LaunchRequest | null
  /** Renderer reloaded or navigated: pending requests wait again. */
  rendererGone(): void
}
export function createLaunchCoordinator(deps: {
  stat: LaunchStat
  send(request: LaunchRequest): void // main → renderer event
  focus(): void
}): LaunchCoordinator

// src/main/options/options-service.ts
export interface OptionsService {
  getState(): OptionsState
  setExplorerMenu(enabled: boolean): OptionsChangeResult
  setRunAsAdmin(enabled: boolean): OptionsChangeResult
  /** Startup: when the menu is on but a key is missing or points at another exe, rewrite all three. Never throws. */
  repairExplorerMenu(): void
}
export function createOptionsService(deps: {
  registry: RegistryAdapter
  exePath: string // process.execPath
  isPackaged: boolean
  warn(message: string, error: unknown): void
}): OptionsService
```

**Rules:**

1. **Explorer keys (exact).** Under `HKCU`, `KEY_ROOTS = ['Software\\Classes\\Directory\\shell\\StorageIQ', 'Software\\Classes\\Drive\\shell\\StorageIQ', 'Software\\Classes\\Directory\\Background\\shell\\StorageIQ']`. For each root `K`: `K` `(Default)` = `Scan with StorageIQ`; `K` `MUIVerb` = `Scan with StorageIQ`; `K` `Icon` = `"<exe>",0` (the exe path in double quotes, then `,0`); `K\command` `(Default)` = `"<exe>" --scan "%V"`. `<exe>` is `process.execPath` as given (no 8.3 or case rewriting). Exported constants `EXPLORER_MENU_LABEL`, `EXPLORER_KEY_ROOTS`, `explorerCommand(exe)`, `explorerIcon(exe)`. HKCU is used so no administrator approval is needed; a key under `Software\Classes` is merged into the system view for this user only.
2. **State of the menu.** `explorerMenu` is true only when all three `command` values equal `explorerCommand(exePath)` (case-insensitive compare of the whole string). A key that exists with another exe path or only some keys present: `explorerMenu` is `false` for the checkbox’s purpose (so it shows what is really wired) **but** `repairExplorerMenu()` treats “any of the three `K` keys exists” as “the owner enabled it” and rewrites all three for the current exe. Turning the menu off calls `deleteTree` on all three roots regardless of which exe they pointed at. Both operations are idempotent: calling `setExplorerMenu(true)` twice writes the same values; `setExplorerMenu(false)` on absent keys succeeds.
3. **Startup repair.** Packaged builds call `options.repairExplorerMenu()` once after `app.whenReady()`, inside try/catch (a failure only `console.warn`s). This covers the install folder changing between versions or the owner moving the app.
4. **Run as administrator (exact).** Key `Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers`, value name = `process.execPath`, data a space-separated token list whose first token is `~` and which contains `RUNASADMIN`. `layers-flags.ts` exports `addRunAsAdmin(existing: string | null): string` and `removeRunAsAdmin(existing: string | null): string | null` (null = delete the value). Rules: tokens are split on runs of whitespace and compared case-insensitively; adding to `null` gives `~ RUNASADMIN`; adding to `~ WIN7RTM` gives `~ WIN7RTM RUNASADMIN`; adding to a value that already has the flag returns it unchanged (idempotent, original token order and casing kept); a value without a leading `~` keeps its tokens and gets `RUNASADMIN` appended (never rewrite other flags); removing keeps all other tokens (`~ WIN7RTM RUNASADMIN` → `~ WIN7RTM`); removing the only flag (`~ RUNASADMIN`, or `RUNASADMIN`) returns `null` and the value is deleted; a value with a flag list that contains only `~` after removal also returns `null`; the empty or null input to remove returns `null`.
5. **State of run-as-admin.** `runAsAdmin` is true when the HKCU value contains the flag **or** the HKLM value (same key path, same name) does. `runAsAdminLocked` is true when the flag is present in HKLM (the app can edit HKCU only; the checkbox shows checked and disabled with the title “Set for all users by your administrator”). Disabling only changes HKCU.
6. **Takes effect next launch.** Turning the switch on or off does not elevate or de-elevate the running process. After a successful change the renderer shows, under the checkbox, the line “Takes effect the next time StorageIQ starts”. The line is shown for the rest of the session after a change in that session (not derived from the registry).
7. **Packaged guard.** When `!isPackaged` or `process.platform !== 'win32'`, `getState()` returns `{ available: false, explorerMenu: false, runAsAdmin: false, runAsAdminLocked: false }` without reading the registry, and both setters return `{ state, error: 'Available in the installed app' }` without writing. A development run therefore never writes a registry key.
8. **Errors are calm.** A registry failure (access denied by policy, koffi load failure) is caught in `options-service`: `console.warn` with the technical error, and the setter returns the freshly read state plus `error: 'Windows did not allow that change. Your settings are unchanged.'` (no HRESULT in the UI). The IPC handlers never throw for registry failures.
9. **Argv parsing (exact).** `findScanArgument(argv)` scans the **whole** array (no fixed offsets: packaged is `[exe, …]`, dev is `[electron, '.', …]`, and Chromium may add its own switches before or after). It takes the first element that equals `--scan` (value = the next element) or starts with `--scan=` (value = the rest); an exact `--scan` as the last element returns `''` (so the launch is reported invalid, not ignored). The element must not itself look like another switch only when it is exactly `--` + letters and the next element would be consumed; a value beginning with `--` is treated as missing (`''`). **Trailing-backslash repair:** if the value contains a double quote, everything from the first `"` onward is dropped and one `\` is appended (`C:" --extra` → `C:\`; this is how `"C:\"` arrives). Leading and trailing whitespace is trimmed. `findScanArgument` never reads `--scan` that appears after a lone `--` element (end-of-options) and ignores `--self-test` handling (the self-test branch runs before any launch handling).
10. **Launch validation (exact).** `resolveLaunchRequest` returns `{ kind: 'scan', path }` only when: the value is a string of 3 to `MAX_LAUNCH_PATH_CHARS` (1,024) characters; contains no NUL or control characters; does not start with `\\` or `//` (UNC and `\\?\` forms are refused, like `parseScanRoot`); matches a drive-absolute path (`^[A-Za-z]:[\\/]`, so a drive root is `C:\`, and the drive-relative `C:` is refused); `stat` succeeds and `isDirectory()` is true (drive roots count: `stat('C:\\')` is a directory). The path is returned `path.win32.normalize`d. Each failure returns `{ kind: 'invalid', message }` with exactly one of: `That path is too long or not a valid location.` (length, control characters, missing value), `StorageIQ scans local folders and drives. Network paths are not supported.` (UNC), `Choose a full path such as C:\Folder.` (not absolute), `That folder could not be found.` (stat failed or not a directory). The messages never include the path. Validation shares `parseScanRoot`’s regex and UNC test through one exported helper in `scan-handlers.ts` so the two can never drift.
11. **Coordinator.** `handleArgv(argv)`: no `--scan` → do nothing (a plain second launch still just focuses, via the `second-instance` handler’s `focus()`). With a flag: resolve the request; if the renderer is ready (`take()` has been called since the last load) `send(request)` and `focus()`; otherwise keep it as `pending` (the latest request replaces an older pending one). `take()` returns `pending`, clears it and marks the renderer ready. `rendererGone()` marks it not ready (called on the window’s `did-start-loading`). `focus()` is the existing `focusMainWindow` (restore if minimised, show, focus).
12. **Main wiring.** `launch.handleArgv(process.argv)` is called once after the window is created (first launch); `app.on('second-instance', (_event, argv) => { focusMainWindow(); void launch.handleArgv(argv) })` replaces the current bare `focusMainWindow` listener. Neither runs in the `--self-test` branch.
13. **Renderer flow.** In `App` (mount effect): subscribe with `api.onLaunchRequest(handle)` **first**, then `api.takeLaunchRequest().then(r => r && handle(r))`; unsubscribe on unmount. `handle` is the store action `receiveLaunchRequest(request)`: `invalid` sets the existing banner `{ tone: 'error', message }`; `scan` starts at once unless `phase === 'scanning'` (rule decision 5: store `pendingLaunchScan: string | null` and render the `Dialog`; “Scan {leaf}” calls `startScan(path)`, “Keep current scan” clears it). A second `launch:request` while the dialog is open replaces its path.
14. **IPC.** `oneBoolean(args)` in `parse-args.ts`: exactly one argument and `typeof === 'boolean'`, otherwise `InvalidIpcArgumentsError` (so `1`, `'true'`, `null`, `undefined`, objects and extra arguments are refused). `options:get-state`, `launch:take-request`: `noArgs`. All five channels use the existing sender check (`isTrustedIpcSender`) through `registerIpcHandlers`; none returns a path except `launch:take-request`, whose path was validated in main. Preload exposes exactly the five functions in the interface; the event is subscribed only through `onLaunchRequest`.
15. **Options tab UI.** `RibbonTab` gains `'options'`; `TABS` order is File, Home, Scan, View, **Options**. `OptionsGroup` renders `<Group label="Application">` with two native `<input type="checkbox">` controls inside labels (so keyboard, screen readers and high contrast behave natively; styled with the existing tokens, 16 px box):
    - label “Show StorageIQ in Explorer’s context menu”, title “Adds “Scan with StorageIQ” when you right-click a folder, a drive or the empty space in a folder”;
    - label “Always start StorageIQ as administrator”, title “Windows asks for approval each time StorageIQ starts, so it can read protected folders”;
    - state is loaded with `api.getOptionsState()` each time the tab becomes visible (not cached across tab switches); both boxes are disabled while loading, while a change is in flight, and when `available` is false; when `available` is false a caption “Available in the installed app” sits under the boxes and is referenced by `aria-describedby`;
    - a change calls the setter, then applies the returned `state`; if `error` is non-null the box returns to the real state and the message shows in a `role="status"` line in the group (no banner, no modal);
    - the “Takes effect the next time StorageIQ starts” line (rule 6) appears under the administrator box after a successful change;
    - when `runAsAdminLocked`, that box is checked and disabled with the title from rule 5.
16. **Uninstall cleanup (NSIS).** `build/installer.nsh` (electron-builder includes it automatically from `buildResources`; Step 9 verifies by building and by reading the generated `.nsi`) defines `!macro customUnInstall` that, **only when the uninstall is not part of an update** (`${ifNot} ${isUpdated}`; electron-builder runs the old uninstaller silently during an update and the keys must survive it), runs `DeleteRegKey HKCU "Software\Classes\Directory\shell\StorageIQ"`, the same for `Drive\shell\StorageIQ` and `Directory\Background\shell\StorageIQ`, and `DeleteRegValue HKCU "Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"`. Per-machine limitation (state it in `docs/RELEASING.md`): an all-users uninstaller runs elevated, and `HKCU` is then the _elevating_ account’s hive, which is the installing user for “Run as administrator” prompts by the same account but another account’s hive when a different administrator approves the prompt; and it never touches other users’ hives. Chosen behaviour: clean the current hive only, accept that other users of a per-machine install keep a stale “Scan with StorageIQ” entry (it does nothing harmful: choosing it shows Windows’ “file not found” message) until they remove it by hand or reinstall and turn the option off. Walking loaded `HKU\<sid>` hives is listed as an open question, not built.
17. **Auto-update interaction (document in `docs/RELEASING.md`).** The updater replaces the exe at the same install path, so the Explorer keys and the compatibility flag keep working across updates (the uninstall macro skips cleanup during an update, rule 16). An elevated StorageIQ that installs a per-user update runs the new installer elevated: it installs into the same per-user folder and relaunches elevated (the flag is still set). If the elevating account differs from the installing account, the per-user install folder is not the elevating account’s; this combination is unsupported and is listed in the docs. A per-machine install already asks for approval at update time; with the flag set the owner sees one prompt for the app and one for the installer.
18. **Elevation limits (document in the README and in the tab’s title text where short).** An elevated process cannot receive drag-and-drop from a non-elevated Explorer (UIPI); StorageIQ accepts no dropped files, so nothing is lost today, and the README names the limit for the future. “Open in Explorer” and the shell menu from an elevated StorageIQ work; Explorer itself stays non-elevated.
19. **Single-instance forwarding across integrity levels (verify, do not assume).** Electron’s `second-instance` is Chromium’s `ProcessSingleton`, which on Windows finds the first instance’s message window and sends the command line with `WM_COPYDATA`. Windows’ UI Privilege Isolation can block messages from a lower-integrity sender to a higher-integrity window, so a non-elevated Explorer launch may not reach an elevated running instance. Step 1 is a spike that settles it on the owner’s machine. **If it works:** nothing more; the spike result is recorded in the commit body. **If it is blocked:** implement the fallback exactly: the second process (the one that loses the lock, or whichever detects no delivery) writes `{ "path": "<raw --scan value>", "at": <epoch ms> }` to `<userData>\launch-request.json` before quitting; the first instance watches that file (`fs.watch` on the folder, 150 ms debounce), reads it, deletes it, ignores files older than 10 s, and passes the argv `['--scan', value]` through `handleArgv`. The path is still validated by `resolveLaunchRequest`. If both fail, the elevated instance simply does not scan, and the README states “when StorageIQ runs as administrator, start it from its own icon first; Explorer’s menu works when it is closed”. Do not hide the limitation.
20. **Never touch real keys in tests.** Unit tests use `createFakeRegistry()` (in-memory map keyed by lower-cased `hive\key\name`). The native test writes only under `HKCU\Software\StorageIQ-Test\<random uuid>` and removes it in `finally`; it asserts its own key path starts with `Software\StorageIQ-Test\` before any write. No test constructs the real keys through the real adapter.

**Win32 details for `win-registry.ts` (koffi, advapi32.dll, `fn` synchronous):**

- `HKEY_CURRENT_USER = 0x80000001`, `HKEY_LOCAL_MACHINE = 0x80000002` passed as `uintptr_t`; `KEY_QUERY_VALUE = 0x1`, `KEY_SET_VALUE = 0x2`, `KEY_CREATE_SUB_KEY = 0x4`, `REG_SZ = 1`, `ERROR_SUCCESS = 0`, `ERROR_FILE_NOT_FOUND = 2`.
- Functions: `RegCreateKeyExW(uintptr_t hKey, str16 lpSubKey, uint32 Reserved, void* lpClass, uint32 dwOptions, uint32 samDesired, void* lpSecurityAttributes, _Out_ void** phkResult, _Out_ uint32* lpdwDisposition)`, `RegOpenKeyExW(...)` for reads, `RegSetValueExW(void* hKey, str16 lpValueName, uint32 Reserved, uint32 dwType, const void* lpData, uint32 cbData)` (UTF-16LE bytes including the terminating NUL; `cbData` counts the NUL), `RegQueryValueExW` (size query first, then read; non-`REG_SZ` or `REG_EXPAND_SZ` types read as absent), `RegDeleteValueW`, `RegDeleteTreeW(void* hKey, str16 lpSubKey)`, `RegCloseKey(void* hKey)` in `finally`. The empty name `''` means `(Default)` (pass a NULL pointer, not an empty string, for `lpValueName` on write and read). A non-zero status other than `ERROR_FILE_NOT_FOUND` throws `RegistryError` (status in `message` and as `.status`). `RegDeleteTreeW` of an absent key returns `ERROR_FILE_NOT_FOUND`, treated as success. Names and data lengths are checked before the call (`value.length <= 32,767`, no NUL inside).
- koffi is loaded lazily on the first call (`require('koffi')` as in `cancelMenuWindow`), so unit tests that import the module on a non-Windows runner do not load it.

**Tests (names exact, grouped by file):**

- `src/main/options/layers-flags.test.ts`: `adds RUNASADMIN to a missing value`, `adds RUNASADMIN after other flags and keeps them`, `is idempotent when the flag is already set`, `matches the flag case-insensitively`, `keeps a value without a leading tilde and appends the flag`, `removes only RUNASADMIN and keeps other flags`, `returns null when RUNASADMIN was the only flag`, `returns null for null or empty input`, `collapses repeated whitespace only when it changes the value`.
- `src/main/options/explorer-menu.test.ts`: `writes all three keys with label, MUIVerb, icon and command`, `uses %V in every command`, `quotes the exe path and the icon path`, `handles an exe path with spaces and non-ASCII letters`, `is idempotent when registered twice`, `removing deletes all three trees and is idempotent`, `state is off when a command points at another exe`, `state is on only when all three commands match`.
- `src/main/options/run-as-admin.test.ts`: `writes the flag under the AppCompatFlags Layers key named by the exe path`, `preserves other flags when enabling`, `removes only the flag and keeps the others`, `deletes the value when nothing else remains`, `reads HKLM and reports locked`, `never writes HKLM`, `a disable of an absent value succeeds`.
- `src/main/options/options-service.test.ts`: `unpackaged returns available false and writes nothing`, `non-Windows returns available false`, `re-registers all three keys when the exe path changed`, `repair does nothing when no key exists`, `repair rewrites a partial set`, `repair never throws when the registry fails`, `a registry failure returns the real state and a calm error`, `setters return the refreshed state`.
- `src/main/launch/launch-args.test.ts`: `finds --scan in a packaged argv`, `finds --scan in a dev argv with the app folder`, `finds --scan=value`, `ignores Chromium switches before and after`, `ignores a --scan after a lone --`, `repairs a drive root that arrives as C:"`, `repairs a quoted drive root followed by more arguments`, `keeps a path with spaces`, `returns an empty string for --scan without a value`, `returns null without the flag`, `accepts a drive root`, `rejects a UNC path`, `rejects a relative path`, `rejects C: without a separator`, `rejects a path over 1024 characters`, `rejects control characters`, `rejects a file`, `rejects a missing folder`, `messages never include the path`, `normalizes forward slashes`.
- `src/main/launch/launch-coordinator.test.ts`: `holds a first-launch request until the renderer takes it`, `take clears the pending request`, `sends a second-instance request immediately once ready and focuses`, `holds it again after rendererGone`, `the latest pending request wins`, `an argv without --scan does nothing`, `an invalid request is delivered as invalid`, `a stat failure becomes a not-found message`.
- `src/main/ipc/parse-args.test.ts` additions: `oneBoolean accepts true and false`, `oneBoolean rejects 1, 'true', null, undefined, objects`, `oneBoolean rejects zero or two arguments`.
- `src/main/ipc/options-handlers.test.ts`: `get-state takes no arguments`, `set-explorer-menu parses a strict boolean`, `set-run-as-admin parses a strict boolean`, `rejects a non-boolean before the service runs`, `returns the service result unchanged`, `an untrusted sender is refused (through registerIpcHandlers)`.
- `src/main/ipc/launch-handlers.test.ts`: `take-request takes no arguments and returns the coordinator’s request`.
- `src/preload/index.test.ts` additions: `exposes the five option and launch functions`, `onLaunchRequest returns an unsubscribe`.
- `src/renderer/src/components/OptionsGroup.test.tsx`: `renders the Application group with two checkboxes`, `both are disabled with “Available in the installed app” when unavailable`, `reflects the system state (checked and unchecked)`, `loads state again when the tab is shown again`, `toggling calls the setter with a boolean and applies the returned state`, `shows the restart line after changing the administrator option`, `does not show the restart line before a change`, `shows the calm error and keeps the real state when the change fails`, `disables both boxes while a change is in flight`, `shows the administrator box checked and disabled when locked`, `every checkbox has an accessible name`.
- `src/renderer/src/components/Ribbon.test.tsx` additions: `has the tabs File, Home, Scan, View and Options in that order`, `the Options tab shows the Application group`, `arrow keys reach the Options tab` (existing tablist pattern).
- `src/renderer/src/stores/workspace-store.test.ts` additions: `receiveLaunchRequest starts a scan at once when idle`, `receiveLaunchRequest asks first while scanning`, `confirming the launch dialog scans the new path`, `declining keeps the current scan`, `an invalid request sets the error banner`, `a second request replaces the dialog’s path`.
- `src/renderer/src/App.test.tsx` additions: `subscribes before it takes the pending launch request`, `unsubscribes on unmount`, `shows the confirmation dialog while scanning`.
- `src/main/registry/win-registry.native.test.ts` (win32 only, `describe.skipIf(process.platform !== 'win32')`): `writes, reads and overwrites a string under a throwaway HKCU key`, `writes and reads the (Default) value`, `handles non-ASCII text`, `deleteValue removes one value and leaves the rest`, `deleteTree removes nested keys`, `deleting something absent is not an error`, `reads HKLM without throwing`, `the throwaway key is gone at the end`.
- `e2e/workspace.spec.ts` additions: `the Options tab renders its Application group`, `both Options checkboxes are disabled in an unpackaged run with the explanation`, `launching with --scan <fixture folder> starts a scan of it` (Playwright `args: ['.', '--scan', fixture]`, as the existing scan e2e builds its fixture), `launching with --scan <missing folder> shows the calm message and no scan`.
- Optional, `scripts/check-packaged-app.mjs` / self-test: a packaged self-test line `registry round trip` that writes, reads and deletes a value under `HKCU\Software\StorageIQ-Test\self-test` through the real adapter (proves koffi’s `advapi32` binding in the installed build; never touches the real keys).

**Steps:**

- [ ] **Step 1: Spike, integrity levels.** On a packaged build (`npm run dist`, install it), set “Run as administrator” by hand in the exe’s Properties, start StorageIQ (accept UAC), then from a normal command prompt run `"<exe>" --scan "C:\Windows"`. Observe whether the running window comes forward and receives the `second-instance` event (add a temporary `console.log` or watch the log). Record the result (works / blocked) for the commit body, then remove the temporary log. If blocked, rule 19’s fallback is part of this task (add `launch-request-file.ts` + test `writes, reads, deletes and ignores stale files` and wire it in `index.ts`).
- [ ] **Step 2: Write the failing tests** in this order: `layers-flags.test.ts`, `launch-args.test.ts`, `explorer-menu.test.ts`, `run-as-admin.test.ts`, `options-service.test.ts`, `launch-coordinator.test.ts`, `parse-args.test.ts`, `options-handlers.test.ts`, `launch-handlers.test.ts`, preload test, `OptionsGroup.test.tsx`, Ribbon, store and App additions. Write `win-registry.native.test.ts` last (needs Step 4).
- [ ] **Step 3: Run them.** `npx vitest run src/main/options src/main/launch src/main/ipc src/preload src/renderer`. Expected: FAIL.
- [ ] **Step 4: Main logic.** `registry-adapter.ts`, `layers-flags.ts`, `explorer-menu.ts`, `run-as-admin.ts`, `options-service.ts`, `launch-args.ts`, `launch-coordinator.ts`, the shared validation export in `scan-handlers.ts`, `oneBoolean`, the two handler files, contract, preload, `fake-api`. Then `win-registry.ts`. Run `npx vitest run src/main src/preload`; expected PASS, the native file included (from PowerShell).
- [ ] **Step 5: Main wiring.** `index.ts`: options service (packaged `process.execPath`), handlers, `launch:request` sender via `sendEvent`, the coordinator, the new `second-instance` listener, `handleArgv(process.argv)` after window creation, `rendererGone` on `did-start-loading`, `repairExplorerMenu()` after ready (packaged only). Confirm nothing runs under `--self-test`.
- [ ] **Step 6: Renderer.** Store actions and `pendingLaunchScan`, `OptionsGroup.tsx`, `Ribbon.tsx` tab, `App.tsx` effect and dialog. Run `npx vitest run src/renderer`.
- [ ] **Step 7: Installer.** `build/installer.nsh` (rule 16). Read `node_modules/app-builder-lib/templates/nsis/` to confirm the name `customUnInstall`, the `isUpdated` macro and `APP_EXECUTABLE_FILENAME`; if any differ in 26.18.0 use the installed names and say so in the commit body.
- [ ] **Step 8: Docs.** `README.md` (the two options, the Windows 11 “Show more options” note, the UIPI note), `docs/RELEASING.md` (rules 16 and 17, the per-machine stale entry), `docs/ROADMAP.md`.
- [ ] **Step 9: Gate** (common gate), then `npm run test:e2e` (unset `ELECTRON_RUN_AS_NODE`; interactive desktop), then `npm run dist; npm run test:packaged`. Inspect the generated installer script (under `release/<version>/` or the builder’s temp `.nsi`) for the `customUnInstall` body. Run the owner’s manual checks below on the built installer yourself first.
- [ ] **Step 10: Commit**

```powershell
git add src/main/registry/registry-adapter.ts src/main/registry/win-registry.ts src/main/registry/win-registry.native.test.ts src/main/options/layers-flags.ts src/main/options/layers-flags.test.ts src/main/options/explorer-menu.ts src/main/options/explorer-menu.test.ts src/main/options/run-as-admin.ts src/main/options/run-as-admin.test.ts src/main/options/options-service.ts src/main/options/options-service.test.ts src/main/launch/launch-args.ts src/main/launch/launch-args.test.ts src/main/launch/launch-coordinator.ts src/main/launch/launch-coordinator.test.ts src/main/ipc/options-handlers.ts src/main/ipc/options-handlers.test.ts src/main/ipc/launch-handlers.ts src/main/ipc/launch-handlers.test.ts src/main/ipc/parse-args.ts src/main/ipc/parse-args.test.ts src/main/ipc/scan-handlers.ts src/main/ipc/scan-handlers.test.ts src/shared/ipc-contract.ts src/preload/index.ts src/preload/index.test.ts src/main/index.ts src/renderer/src/components/OptionsGroup.tsx src/renderer/src/components/OptionsGroup.test.tsx src/renderer/src/components/Ribbon.tsx src/renderer/src/components/Ribbon.test.tsx src/renderer/src/stores/workspace-store.ts src/renderer/src/stores/workspace-store.test.ts src/renderer/src/App.tsx src/renderer/src/App.test.tsx src/renderer/src/test/fake-api.ts build/installer.nsh e2e/workspace.spec.ts scripts/check-packaged-app.mjs README.md docs/RELEASING.md docs/ROADMAP.md
git commit -m "feat(options): add Explorer context menu and run-as-administrator options"
```

Add any other file the change touched (for example `launch-request-file.ts` and its test if the spike required the fallback, `electron-builder.yml` if it changed). Never `git add -A`, `.` or `commit -a`. No AI attribution trailer. Put the spike result in the commit body.

**Manual checks for the owner (add to Task 9’s checks-by-eye list), on the installed build:**

1. **Folder:** Options tab, tick “Show StorageIQ in Explorer’s context menu”; in Explorer right-click a folder (on Windows 11 choose “Show more options”): “Scan with StorageIQ” appears with the StorageIQ logo; click it with StorageIQ **closed**: the app starts and scans that folder.
2. **Open app:** repeat with StorageIQ **open** and idle: the window comes forward and scans the new folder; with a scan **running**: the “Scan another folder?” dialog appears and both buttons do what they say.
3. **Drive and background:** right-click a drive in This PC and also the empty space inside a folder (and inside a drive’s root, `D:\`): each scans the right location (the drive root `D:\` must scan the whole drive, not fail).
4. **Odd paths:** a folder with spaces and with non-English letters scans correctly; a network folder shows “StorageIQ scans local folders and drives. Network paths are not supported.”
5. **Reality:** delete one of the three keys by hand in `regedit` (`HKCU\Software\Classes\Directory\shell\StorageIQ`), restart StorageIQ: the entry is back (repair). Move or reinstall to another folder with the option on: the menu still works after the next start.
6. **Untick** the box: the menu entry disappears from folders, drives and backgrounds immediately.
7. **Administrator:** tick “Always start StorageIQ as administrator”; it says “Takes effect the next time StorageIQ starts”; close and start: UAC appears; scan `C:\Windows\System32\config` (readable now). Right-click a folder, choose “Scan with StorageIQ” while the elevated copy is running: record whether it scans (rule 19); untick: the next start shows no UAC.
8. **Uninstall (per-user):** uninstall; the three Explorer entries are gone and `AppCompatFlags\Layers` has no StorageIQ value; **update** to a newer build first and confirm the entries survive the update.
9. **Per-machine install:** install for all users, enable the menu, uninstall; note which entries remain (rule 16) and confirm the README/RELEASING note matches.
10. **Dev run:** `npm run dev` shows both boxes disabled with “Available in the installed app” and writes nothing under `HKCU\Software\Classes`.

**Gate:**

- `npm run format`, `npm run format:check`, `npm run lint`;
- `npm run typecheck:node` and `npm run typecheck:web`;
- `npx vitest run` (the native registry test runs on Windows only);
- `npx vitest run src/renderer` with `impeccable detect --json src/renderer` printing `[]`;
- `npm run test:e2e`;
- `npm run dist` then `npm run test:packaged`;
- `git status`: no registry or `release/` artefacts staged.

**Commit:** `feat(options): add Explorer context menu and run-as-administrator options`, with explicit paths and no AI attribution.

**Open questions for the controller / owner (Task 14):**

1. **Integrity-level forwarding (rule 19)** is settled by the Step 1 spike, not by this plan. If blocked, the file hand-off fallback is in scope; if that is unwanted, the documented limitation stands.
2. **Per-machine uninstall** cleans only the elevating account’s hive. Walking loaded `HKU\<sid>` hives in the macro would clean more but is untested territory; not built unless the owner wants it.
3. **Windows 11 top-level menu** needs a packaged shell extension; today the entry sits under “Show more options”. Later task if wanted.
4. **A scan running when a launch arrives** asks first (decision 5). Say if “replace silently” is preferred.
5. **Elevated by a different administrator account** (standard user approves with another admin’s credentials): the compatibility flag lives in the _current_ user’s hive and `userData` differs for the elevated process. Documented as unsupported.

**Controller rulings (2026-11-25):** (1) the file hand-off fallback is in scope if the spike shows forwarding is blocked; (2) no `HKU\<sid>` walking — the per-machine limitation is documented; (3) the Windows 11 top-level menu is a later task; (4) ask before replacing a running scan; (5) elevation by a different admin account is documented as unsupported.

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

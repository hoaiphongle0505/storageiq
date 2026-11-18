# Roadmap v2: Research-Driven Scope and Ordering

**Status:** approved by the product owner on 2026-11-18
**Inputs:** internal research notes (kept outside the repo)
**Applies to:** Phase 2 onward. Phase 1 is unchanged.

## 1. Positioning

The core promise is: **"Shows where your disk space went, and explains it in plain words."** It is supported by:

- honest totals that match what Windows reports, or explain the difference;
- being free and open source, with no nags and no account.

We make no claims about scan speed, and our marketing never names a competitor.

**Why:** the most common complaint in public reviews is speed, and the fastest technique, reading the NTFS MFT, needs admin rights, which we ruled out. The clearest unmet consumer need is "what is this folder, and is it safe to delete?"

## 2. MVP changes (Phases 2–4)

### Phase 2a — Core Scanner

- The scanner runs in an Electron `utilityProcess`. It walks folders with `fs.promises.opendir` and calls `fs.promises.lstat` once per entry. It does not follow reparse points (junctions or symlinks), and it never opens file contents, so it never downloads OneDrive placeholders.
- The drive list includes fixed drives and removable drives, including USB flash drives.
- About every 250 ms the scanner sends a progress update: files, folders and bytes found so far, the current path, and elapsed time.
- **Partial results stream during the scan.** Each progress tick carries a snapshot of the largest folders found so far, so Phase 3 can draw the tree while it grows. The scanner sends snapshots, not a stream of individual changes.
- The user can cancel at any time. Cancellation goes through an `AbortSignal` in the scanner process.
- Every folder the scanner could not read is listed with its reason (access denied, path too long, and so on). None are skipped silently.
- Runtime validation of IPC arguments arrives with the first channel that takes arguments (deferred from the Phase 1 Task 2 review).
- CI tracks the installer size and the app's idle memory (RAM) as numbers it reports.

### Phase 2b — Honest Totals

- **Cloud-only files.** koffi, a prebuilt FFI library, calls `GetFileAttributesW`. A file that has `FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS` (0x400000), `FILE_ATTRIBUTE_RECALL_ON_OPEN` (0x40000) or `FILE_ATTRIBUTE_OFFLINE` (0x1000) is counted under "online-only" and is **excluded from the on-disk size**. Attributes are queried only inside folders that are cloud-sync roots or contain reparse points, so the cost of FFI calls stays small.
- **Hardlinks are counted once.** A file whose `lstat` reports `nlink > 1` is keyed by `dev:ino`. Its size counts once per scan, in the first folder where it is found.
- **Reconciliation line.** The used space Windows reports (`fs.statfs`), the total StorageIQ found, and the gap, split into "couldn't be read" and "system or reserved".
- **Measurement gate.** Measure a koffi `FindFirstFileExW` (`FIND_FIRST_EX_LARGE_FETCH`) traversal against the 2a traversal on the same tree. Adopt it only if it is at least 30% faster and passes the same tests.

### Phase 3 — Tree View

- The tree draws during the scan and updates from 2a's snapshots.
- It shows one size column, labeled "Size". The on-disk size and the online-only size are explained in a tooltip, not offered as a toggle.
- "Open in Explorer" is available on folders and files.
- The other requirements are unchanged: virtualization, keyboard navigation, % of parent, and counts.

### Phase 4 — Largest Files & Explanations (MVP complete)

- The largest-files list, as planned.
- **Explanations:** a fixed, versioned dictionary of about 30 well-known space hogs. Examples: Recycle Bin, WinSxS, `hiberfil.sys`, `pagefile.sys`, `Windows.old`, the Windows Search index, browser and app caches, Downloads, and antivirus quarantine. Each entry gives a plain-language "what is this" and "is it safe to clean up". The labels appear in both the tree and the largest-files list. The feature is read-only: there is no delete action and no AI.
- A "Copy as CSV" button for the visible list.

## 3. Post-MVP order

| #   | Phase            | Notes                                                                                                                |
| --- | ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| 5   | Treemap          | A secondary view. The size-bar tree stays the main view.                                                             |
| 6   | Duplicate Finder | Moved up from 8. Size → partial hash → full hash; cancelable; never deduplicates hardlinks.                          |
| 7   | History (light)  | Remembers the last scan of each drive and shows "+X GB since last time". SQLite (better-sqlite3) is introduced here. |
| 8   | Export           | Moved down from 6. Full CSV and XLSX export.                                                                         |
| 9   | AI               | Covers only files the fixed dictionary doesn't. The local-vs-cloud decision is recorded at the start of the phase.   |

## 4. Release items (decided before the first public build, at the end of Phase 4)

- **Code signing:** apply to the SignPath Foundation, which signs open-source projects for free. If the application is declined, use Azure Trusted Signing.
- **Official distribution:** a winget package under the StorageIQ name.
- **Custom app icon:** `build/icon.ico`.

## 5. Approaches considered and rejected

- **Do the whole scan with koffi `FindFirstFileExW` in 2a.** It may be faster, but it would put FFI risk on the core path before we have measured anything. Phase 2b measures it instead.
- **A native C++ addon** for file attributes. It would require Visual Studio build tools for every contributor and in CI. koffi ships prebuilt binaries instead.
- **Keep the original order (Export → History → Duplicates).** In the research sample, Duplicates had 4 requests, Export 1 and History 0. The sample is small and mostly technical users, so this ordering should be revisited if Reddit or G2 evidence becomes available.

## 6. Evidence limits

76 comments from 5 sources, mostly technical Hacker News users. Reddit, G2 and Capterra could not be read. Every decision above is reversible at a phase boundary.

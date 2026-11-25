# Releasing StorageIQ

StorageIQ updates itself from GitHub Releases (`hoaiphongle0505/storageiq`). Pushing a version tag builds the installer in GitHub Actions and attaches it to a release; installed copies find it on their next check.

## Steps

1. Add the `## [X.Y.Z] - YYYY-MM-DD` entry to `CHANGELOG.md` (sections `### Added`, `### Changed`, `### Fixed`; plain text bullets). Then bump `version` in `package.json` (for example `0.2.0` or `0.2.0-beta.1`) and commit both. A test fails when the newest changelog entry is older than the package version, and the entry is what the What's new window shows after the update.
2. Tag the commit `vX.Y.Z` (stable) or `vX.Y.Z-beta.N` (pre-release). The tag must equal `v` plus the `package.json` version; the workflow fails otherwise.
3. Push the commit and the tag: `git push` and `git push origin vX.Y.Z`.
4. Wait for the **Release** workflow (`.github/workflows/release.yml`). Its `build` job (read-only access) type-checks, runs the tests, builds the installer, runs the packaged-app check and uploads the three release files. Its `publish` job (write access, runs none of the repository's code) creates the release as a draft, attaches the files and then publishes it, so nobody sees a release without `latest.yml`. The release is marked as a pre-release when the tag contains a hyphen. A re-run uploads the files again over the existing release.
5. Edit the release notes on GitHub (they start as generated notes) if they need it.
6. Publish pre-releases first. When a pre-release has proven itself, release the same code as a stable version with a new version bump and tag.

## Update channel

The installed version decides what it is offered:

- A stable install (`0.2.0`) receives stable releases only.
- A pre-release install (`0.2.0-beta.1`) receives pre-releases and stable releases.

A pre-release must be tagged `vX.Y.Z-beta.N` with the matching `package.json` version. Marking a stable version (`0.2.0`) as a pre-release by hand on GitHub does not work: it is never offered to stable installs, and beta installs fall back to `latest.yml` (the stable feed).

When a new version is out, a banner says “StorageIQ X is available.” (with **Update**, **What's new** and **Later**) and a dot shows on the Help tab and on **Check for updates**. Nothing downloads until the user clicks **Update**; progress shows in the banner and in About, then **Restart to update** installs and relaunches. A downloaded update that is not restarted installs the next time the app is closed normally (`autoInstallOnAppQuit`); each per-machine (all-users) install shows a Windows administrator (UAC) prompt then. After the update, the What's new window opens once with that version's `CHANGELOG.md` entry; Help, **What's new** shows it again. Help, **Check for updates** (and About) checks by hand. The first automatic check runs about 10 seconds after the app starts, then every 6 hours. Nothing runs in `npm run dev` or under `--self-test`.

## The three release files

Each release carries exactly these files, from `release/<version>/`:

- `StorageIQ-Setup-<version>-x64.exe`: the installer. It offers “Only for me” or “Anyone who uses this computer” (the second asks for administrator approval).
- `StorageIQ-Setup-<version>-x64.exe.blockmap`: lets an update download only the changed parts.
- `latest.yml`: names the newest version, its file and its hash. The app reads this file from the release to decide whether there is an update.

## Testing an update

1. Set `version` to `0.1.1-test.1`, tag and push `v0.1.1-test.1`, and install the resulting `.exe` from the release.
2. Set `version` to `0.1.1-test.2`, tag and push `v0.1.1-test.2`; the workflow publishes it as a pre-release.
3. Start the installed app and wait about 10 seconds. The banner “StorageIQ 0.1.1-test.2 is available.” appears. Click **Update**, wait for the download, then click **Restart to update**; the new version launches and What's new opens once (add a `0.1.1-test.2` entry to `CHANGELOG.md` first).

Use the real timing; there is no test override in the update code. Repeat once for a per-user and once for a per-machine install (the per-machine update asks for administrator approval again).

## Explorer menu and run as administrator (Options tab)

The Options tab writes two things for the current user, both removed by the uninstaller (`build/installer.nsh`, macro `customUnInstall`):

- Three Explorer verbs, `Software\Classes\Directory\shell\StorageIQ`, `Drive\shell\StorageIQ` and `Directory\Background\shell\StorageIQ` under `HKEY_CURRENT_USER`, whose command is `"<install folder>\StorageIQ.exe" --scan "%V"`.
- The compatibility flag `~ RUNASADMIN` as a value named after the exe's full path in `HKEY_CURRENT_USER\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers`.

**Updates.** The updater replaces the exe at the same install path, so both entries keep working across updates. electron-builder runs the old uninstaller silently with `--updated` during an update, and the macro skips the cleanup then (`${ifNot} ${isUpdated}`), so the entries survive. On every start of an installed build, StorageIQ also rewrites the three Explorer verbs when any of them exists but a key is missing or points at another exe (the install folder changed). An elevated StorageIQ that installs a per-user update runs the new installer elevated: it installs into the same per-user folder and starts the new version elevated (the flag is still set). If the account that approves the elevation prompt differs from the account that installed, the per-user folder is not the elevating account's and the combination is unsupported (the flag lives in the current user's hive and `userData` differs for the elevated process). A per-machine install already asks for approval at update time; with the flag set the owner sees one prompt for the app and one for the installer.

**Per-machine uninstall.** An all-users uninstaller runs elevated, so `HKEY_CURRENT_USER` is then the elevating account's hive: that is the installing user's when the same account approves the prompt, and another account's when a different administrator does. It never touches other users' hives. Chosen behaviour: clean the current hive only. Other users of a per-machine install keep a stale “Scan with StorageIQ” entry until they remove it by hand or reinstall and turn the option off; choosing it only shows Windows' “file not found” message. Walking loaded `HKEY_USERS\<sid>` hives is an open question and is not built.

**Run as administrator and the Explorer menu.** Electron's `second-instance` event reaches the running copy through a window message. Windows' UI Privilege Isolation can refuse a message from a lower-integrity (non-elevated) sender to a higher-integrity (elevated) window, so a “Scan with StorageIQ” click may not reach a StorageIQ that is already running as administrator. The Step 1 spike for Task 14 could not settle this: the development machine's account is a standard user, so an elevated copy needs another account's credentials at a secure-desktop prompt that cannot be answered unattended (see the Task 14 report). It stays an owner check (item 7 of the manual list). Until it is measured the README says: when StorageIQ runs as administrator, start it from its own icon first; Explorer's menu works when it is closed. If it turns out to be blocked, the planned fallback is a file hand-off in `userData` (`launch-request.json`, watched by the running copy), which is not built.

## TODO: code signing (SignPath)

The installer is **unsigned** today. Windows SmartScreen shows “unknown publisher”, and the per-machine install’s administrator prompt shows the same. electron-updater does not require a signature for updates hosted on GitHub today, but a signed build is planned: signing with SignPath is a later step and is not set up yet (the application is pending).

Once builds are signed, verify that electron-updater checks the publisher signature on updates: the installed `app-update.yml` must carry the publisher name (`publisherName`, from the `win.signtoolOptions.publisherName` setting in `electron-builder.yml`), and an update signed by anyone else must be refused. This only applies after builds are signed; until then updates are checked by the `latest.yml` hash only.

Unpacked files are outside the asar integrity check: only `out/main/walker.js` and koffi are unpacked (see the `asarUnpack` comment in `electron-builder.yml`), and code signing is what covers them.

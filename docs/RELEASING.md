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

## TODO: code signing (SignPath)

The installer is **unsigned** today. Windows SmartScreen shows “unknown publisher”, and the per-machine install’s administrator prompt shows the same. electron-updater does not require a signature for updates hosted on GitHub today, but a signed build is planned: signing with SignPath is a later step and is not set up yet (the application is pending).

Once builds are signed, verify that electron-updater checks the publisher signature on updates: the installed `app-update.yml` must carry the publisher name (`publisherName`, from the `win.signtoolOptions.publisherName` setting in `electron-builder.yml`), and an update signed by anyone else must be refused. This only applies after builds are signed; until then updates are checked by the `latest.yml` hash only.

Unpacked files are outside the asar integrity check: only `out/main/walker.js` and koffi are unpacked (see the `asarUnpack` comment in `electron-builder.yml`), and code signing is what covers them.

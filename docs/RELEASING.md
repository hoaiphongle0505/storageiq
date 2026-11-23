# Releasing StorageIQ

StorageIQ updates itself from GitHub Releases (`hoaiphongle0505/storageiq`). Pushing a version tag builds the installer in GitHub Actions and attaches it to a release; installed copies find it on their next check.

## Steps

1. Bump `version` in `package.json` (for example `0.2.0` or `0.2.0-beta.1`) and commit it.
2. Tag the commit `vX.Y.Z` (stable) or `vX.Y.Z-beta.N` (pre-release). The tag must equal `v` plus the `package.json` version; the workflow fails otherwise.
3. Push the commit and the tag: `git push` and `git push origin vX.Y.Z`.
4. Wait for the **Release** workflow (`.github/workflows/release.yml`). It type-checks, runs the tests, builds the installer, runs the packaged-app check, and creates the release (marked as a pre-release when the tag contains a hyphen). A re-run uploads the files again over the existing release.
5. Edit the release notes on GitHub (they start as generated notes) and publish.
6. Publish pre-releases first. When a pre-release has proven itself, release the same code as a stable version with a new version bump and tag.

## Update channel

The installed version decides what it is offered:

- A stable install (`0.2.0`) receives stable releases only.
- A pre-release install (`0.2.0-beta.1`) receives pre-releases and stable releases.

An update downloads in the background. A banner offers **Restart**; if it is ignored, the update installs the next time the app is closed normally. The first check runs about 10 seconds after the app starts, then every 6 hours. Nothing runs in `npm run dev` or under `--self-test`.

## The three release files

Each release carries exactly these files, from `release/<version>/`:

- `StorageIQ-Setup-<version>-x64.exe`: the installer. It offers “Only for me” or “Anyone who uses this computer” (the second asks for administrator approval).
- `StorageIQ-Setup-<version>-x64.exe.blockmap`: lets an update download only the changed parts.
- `latest.yml`: names the newest version, its file and its hash. The app reads this file from the release to decide whether there is an update.

## Testing an update

1. Set `version` to `0.1.1-test.1`, tag and push `v0.1.1-test.1`, and install the resulting `.exe` from the release.
2. Set `version` to `0.1.1-test.2`, tag and push `v0.1.1-test.2`; the workflow publishes it as a pre-release.
3. Start the installed app and wait about 10 seconds plus the download time. The banner “StorageIQ 0.1.1-test.2 is ready. Restart to update.” appears. **Restart** installs and relaunches the new version.

Use the real timing; there is no test override in the update code. Repeat once for a per-user and once for a per-machine install (the per-machine update asks for administrator approval again).

## TODO: code signing (SignPath)

The installer is **unsigned** today. Windows SmartScreen shows “unknown publisher”, and the per-machine install’s administrator prompt shows the same. electron-updater does not require a signature for updates hosted on GitHub, but a signed build is planned: signing with SignPath is a later step and is not set up yet.

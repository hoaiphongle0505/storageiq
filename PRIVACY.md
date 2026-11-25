# StorageIQ privacy policy

StorageIQ does not collect personal data. It has no telemetry, no analytics and no crash reporting, and it never uploads the results of a scan.

## What stays on your computer

- **Scan results** (folder names, sizes, counts) are kept in memory while the app runs. They are never sent anywhere.
- **A few app files** are stored in the app's own folder under `%APPDATA%\StorageIQ`:
  - the folders you scanned recently, for the Select menu;
  - which version's "What's new" you have already seen;
  - the "Check for updates automatically" setting;
  - the ordinary cache and settings files of the Electron runtime that draws the window.
- **Two options on the Options tab** are stored in your user part of the Windows registry: "Scan with StorageIQ" in Explorer's context menu, and "Always start StorageIQ as administrator". The uninstaller removes them.

## Network connections

StorageIQ connects to the internet only in these cases:

- **Update checks.** StorageIQ asks GitHub (`github.com`) whether a newer release of StorageIQ exists, and a new version is downloaded from GitHub's release file servers (`*.githubusercontent.com`).
  - By default it checks shortly after it starts and then every few hours, and also whenever you choose **Help → Check for updates**.
  - You can turn the automatic check off on the **Options** tab ("Check for updates automatically"). Then StorageIQ checks only when you choose **Help → Check for updates**.
  - The request contains only what any web request contains: your IP address, and a user agent with the StorageIQ version.
  - A new version is downloaded only after you choose **Update**.
  - GitHub's handling of these requests is covered by the [GitHub Privacy Statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).
- **Links you click.** Help, Report a problem and the links in the About window open in your web browser.

Apart from these, StorageIQ does not transfer any information to other networked systems unless you specifically ask it to.

## Contact

Questions about privacy: open an issue at https://github.com/hoaiphongle0505/storageiq/issues.

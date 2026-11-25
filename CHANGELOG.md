# Changelog

All notable changes to StorageIQ are listed here, newest first. The format follows Keep a Changelog and the versions follow Semantic Versioning.

## [0.2.0-beta.2] - 2026-11-25

### Added

- Press Delete on the selected rows to send them to the Recycle Bin, or Shift+Delete to delete them permanently, as in File Explorer. Windows shows its own confirmation and progress.
- A Delete button in the ribbon's Folder group, next to New folder, with a "Delete permanently" choice in its menu.

### Fixed

- Pressing Delete (or using the ribbon's Delete button) on a drive's Recycle Bin folder, or on your own folder inside it, now empties that Recycle Bin with Windows' own command instead of going through every item in it. Delete in the right-click Explorer menu is unchanged.
- The developer tests no longer leave their temporary files in the Recycle Bin.

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
- An Options tab with two switches. "Show StorageIQ in Explorer's context menu" adds "Scan with StorageIQ" when you right-click a folder, a drive or the empty space in a folder (on Windows 11 it sits under "Show more options"). "Always start StorageIQ as administrator" lets StorageIQ read protected folders; Windows asks for approval each time it starts, and while it runs as administrator, Explorer menu commands such as Delete and Open also run as administrator.
- Uninstalling StorageIQ removes the Explorer menu entry and the administrator setting.

### Changed

- Scanning is about twice as fast as before, because several folders are read at the same time: about 1.5 to 2.5 minutes for 1.9 million files on the developer's machine, down from about 5 minutes.
- Deleting many items no longer freezes the window. Windows shows its own progress while StorageIQ stays usable.

### Fixed

- Rows no longer stay in the tree after the item was deleted in Explorer or from the menu, and folder totals update.

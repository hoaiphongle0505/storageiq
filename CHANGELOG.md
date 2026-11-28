# Changelog

All notable changes to StorageIQ are listed here, newest first. The format follows Keep a Changelog and the versions follow Semantic Versioning.

## [Unreleased]

### Added

- Types now shows a donut chart of the space used by each kind of file, in the same colours as the treemap, with a legend beside it. Age shows bars for the space in each age group. A Chart button in the header hides or shows the chart; the table next to it still has every number.
- Export to CSV… and Export to Excel… on the File tab save every folder and file below the folder shown in the pane, biggest first, with sizes in bytes, dates, and each item's share of its folder. The Excel file also has Top files, Types and Age sheets. A message tells you how many rows were saved, with a Show in folder button.
- A CSV file has no row limit. An Excel sheet holds about a million rows; if the tree is bigger, the file says so and the rest is left out, so use CSV for those.

### Fixed

- Top files, Types and Age no longer say "That item no longer exists" when the list simply could not be loaded; they say so and offer Try again.
- Top files no longer keeps a row selected after you choose another folder or scan again.
- File names that begin with =, +, - or @ are saved with a leading ' in CSV files (Copy as CSV too), so a spreadsheet does not read them as formulas.

## [0.3.0-beta.1] - 2026-11-28

### Added

- The pane under the folder tree now has four tabs: Treemap, Top files, Types and Age. Each describes the folder selected in the tree (or the folder of the selected file).
- Top files lists the largest files below that folder (up to 1,000), ranked by size, or by space on disk in Allocated mode. Right-click for Explorer's menu, or double-click a file to find it in the tree.
- Types shows how much space each file extension uses, with Windows' icon and the treemap colour of its file type.
- Age shows how much space is used by files changed in the last 30 days, 1–3 months, 3–6 months, 6–12 months, 1–2 years, 2–5 years, more than 5 years ago, or with an unknown date.
- Copy as CSV in each list puts the whole list on the clipboard, ready for a spreadsheet.
- A Pane group on the View tab shows or hides each of the four views.

```

## [0.2.0-beta.2] - 2026-11-25

### Added

- Press Delete on the selected rows to send them to the Recycle Bin, or Shift+Delete to delete them permanently, as in File Explorer. Windows shows its own confirmation and progress.
- A Delete button in the ribbon's Folder group, next to New folder, with a "Delete permanently" choice in its menu.
- A "Check for updates automatically" checkbox on the Options tab, on by default. When it is off, StorageIQ checks for a new version only when you choose Check for updates.
- A privacy policy (PRIVACY.md) and a code signing policy section in the README.

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
```

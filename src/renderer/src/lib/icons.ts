import {
  ArrowSync24Color,
  CheckmarkCircle16Color,
  ChevronDown12Regular,
  ChevronRight16Regular,
  Clock20Color,
  Cloud20Color,
  DataBarVertical24Regular,
  DataPie24Color,
  DataTreemap24Regular,
  Dismiss16Regular,
  Document16Regular,
  DocumentMultiple16Regular,
  DocumentMultiple24Regular,
  DocumentText20Color,
  ErrorCircle16Color,
  type FluentIcon,
  type FluentIconsProps,
  Folder16Filled,
  FolderAdd24Filled,
  FolderOpen24Filled,
  FolderSearch20Filled,
  FolderSearch24Filled,
  HardDrive16Regular,
  HardDrive20Regular,
  HardDrive24Regular,
  Info16Regular,
  Info24Regular,
  SignOut24Regular,
  Stop24Regular,
  TextBulletListTree24Regular,
  Usb20Regular,
  Warning16Color,
} from '@fluentui/react-icons'
import { createElement } from 'react'

/**
 * The one module that imports `@fluentui/react-icons`: every icon the UI draws is exported here
 * under a StorageIQ name, so one grep shows the set and a rename is one line. Fluent System Icons
 * (Microsoft, MIT). Each glyph is the size-specific component and is never scaled: 16 in rows,
 * banners and the status bar, 20 in menus, 24 in the ribbon's large buttons (the ribbon body is a
 * fixed 92 px, so a 60 px button cannot hold a 32 px glyph, and ArrowSync, FolderSearch and
 * TextBulletListTree have no 32 px variant).
 *
 * Colour: the `…Color` variant where Fluent ships one (ErrorCircle, CheckmarkCircle,
 * ArrowSync, Cloud, Clock, DataPie, Document). Folder-like glyphs have no colour variant, so they
 * use the `Filled` variant tinted with the `--icon-folder` token. Everything else (chevrons,
 * dismiss, info, drives) is the `Regular` variant in `currentColor`. Under `forced-colors` the
 * colour glyphs keep their fills (`svg[data-color-icon]` in global.css); the others follow the
 * system.
 */
export type { FluentIcon }

/** The tint of folder-like glyphs (a warm yellow; contrast-checked in design/tokens.json). */
const FOLDER_FILL = 'var(--icon-folder)'

/** A glyph that keeps Fluent's own colours (marked so high contrast leaves it alone). */
function colour(Icon: FluentIcon): FluentIcon {
  const Coloured: FluentIcon = (props) =>
    createElement(Icon, {
      ...props,
      'data-color-icon': '',
      // Inline, because Griffel's own unlayered `forced-color-adjust: auto` beats any layered
      // stylesheet rule: in high contrast the colour glyphs must keep their fills.
      style: { forcedColorAdjust: 'none', ...props.style },
    } as FluentIconsProps)
  return Coloured
}

/** A `Filled` glyph tinted with the folder yellow. */
function folderTint(Icon: FluentIcon): FluentIcon {
  const Tinted: FluentIcon = (props) =>
    createElement(Icon, { primaryFill: FOLDER_FILL, ...props } as FluentIconsProps)
  return Tinted
}

// Ribbon, large buttons (24)
export const IconSelect = folderTint(FolderSearch24Filled)
export const IconStop = Stop24Regular
export const IconRefresh = colour(ArrowSync24Color)
export const IconModeSize = DataBarVertical24Regular
export const IconModeAllocated = HardDrive24Regular
export const IconModeFiles = DocumentMultiple24Regular
export const IconModePercent = colour(DataPie24Color)
export const IconExpand = TextBulletListTree24Regular
export const IconOpenFolder = folderTint(FolderOpen24Filled)
export const IconNewFolder = folderTint(FolderAdd24Filled)
export const IconAbout = Info24Regular
export const IconExit = SignOut24Regular
export const IconTreemap = DataTreemap24Regular

// Menus (20)
export const IconDrive = HardDrive20Regular
export const IconUsbDrive = Usb20Regular
export const IconDocuments = colour(DocumentText20Color)
export const IconCloud = colour(Cloud20Color)
export const IconRecent = colour(Clock20Color)
export const IconChooseFolder = folderTint(FolderSearch20Filled)

// Banners, status bar, small controls (16, chevron 12)
export const IconInfo = Info16Regular
export const IconError = colour(ErrorCircle16Color)
export const IconWarning = colour(Warning16Color)
export const IconSuccess = colour(CheckmarkCircle16Color)
export const IconDismiss = Dismiss16Regular
export const IconChevronDown = ChevronDown12Regular
export const IconChevronRight = ChevronRight16Regular

// Tree row placeholders, shown until Windows' own icon arrives (16)
export const IconRowFile = Document16Regular
export const IconRowFolder = folderTint(Folder16Filled)
export const IconRowDrive = HardDrive16Regular
export const IconRowFiles = DocumentMultiple16Regular

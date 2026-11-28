import { type ReactNode, useId, useRef, useState } from 'react'
import type { SizeMode } from '@shared/tree-types'
import { SIZE_UNITS, type SizeUnit } from '../lib/format'
import {
  type FluentIcon,
  IconAbout,
  IconAge,
  IconCheckUpdates,
  IconChevronDown,
  IconDelete,
  IconExit,
  IconExportCsv,
  IconExportExcel,
  IconExpand,
  IconHelp,
  IconModeAllocated,
  IconModeFiles,
  IconModePercent,
  IconModeSize,
  IconNewFolder,
  IconOpenFolder,
  IconRefresh,
  IconReportProblem,
  IconStop,
  IconTopFiles,
  IconTreemap,
  IconTypes,
  IconWhatsNew,
} from '../lib/icons'
import { useFocusgroupFallback } from '../lib/use-focusgroup'
import { EXPAND_ALL_LEVELS, type PaneTab } from '../stores/workspace-store'
import { useWorkspace } from '../stores/workspace-store-context'
import { MenuButton } from './MenuButton'
import { OptionsGroup } from './OptionsGroup'
import {
  NotificationDot,
  RIBBON_BUTTON_CLASS,
  RIBBON_SMALL_CLASS,
  RibbonButton,
} from './RibbonButton'
import { Group } from './RibbonGroup'
import { SelectMenu } from './SelectMenu'

export type RibbonTab = 'file' | 'home' | 'scan' | 'view' | 'options' | 'help'

const TABS: Array<{ id: RibbonTab; label: string }> = [
  { id: 'file', label: 'File' },
  { id: 'home', label: 'Home' },
  { id: 'scan', label: 'Scan' },
  { id: 'view', label: 'View' },
  { id: 'options', label: 'Options' },
  { id: 'help', label: 'Help' },
]

const MODES: Array<{ mode: SizeMode; label: string; icon: FluentIcon; title: string }> = [
  { mode: 'size', label: 'Size', icon: IconModeSize, title: 'Rank and draw by file size' },
  {
    mode: 'allocated',
    label: 'Allocated',
    icon: IconModeAllocated,
    title: 'Rank and draw by space taken on disk (whole clusters)',
  },
  {
    mode: 'files',
    label: 'File count',
    icon: IconModeFiles,
    title: 'Rank and draw by number of files',
  },
  {
    mode: 'percent',
    label: 'Percent',
    icon: IconModePercent,
    title: 'Show each item’s share of its folder',
  },
]

const PANE_BUTTONS: Array<{ tab: PaneTab; label: string; icon: FluentIcon; title: string }> = [
  { tab: 'treemap', label: 'Treemap', icon: IconTreemap, title: 'Show or hide the treemap' },
  {
    tab: 'top',
    label: 'Top files',
    icon: IconTopFiles,
    title: 'Show or hide the largest files in the selected folder',
  },
  {
    tab: 'types',
    label: 'Types',
    icon: IconTypes,
    title: 'Show or hide the space each file type uses in the selected folder',
  },
  {
    tab: 'age',
    label: 'Age',
    icon: IconAge,
    title: 'Show or hide the space used by files of each age in the selected folder',
  },
]

const UNIT_LABELS: Record<SizeUnit, string> = { auto: 'Auto', gb: 'GB', mb: 'MB', kb: 'KB' }

/** The window's command ribbon: tabs File, Home, Scan, View, Options and Help over a toolbar of groups. */
export function Ribbon({ onAbout }: { onAbout(): void }) {
  const [tab, setTab] = useState<RibbonTab>('home')
  const tablistRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const baseId = useId()
  useFocusgroupFallback(tablistRef, 'tablist', tab)
  useFocusgroupFallback(toolbarRef, 'toolbar', tab)

  const phase = useWorkspace((s) => s.phase)
  const target = useWorkspace((s) => s.target)
  const selectedId = useWorkspace((s) => s.selectedId)
  const severalSelected = useWorkspace((s) => s.selectedIds.size > 1)
  const mode = useWorkspace((s) => s.mode)
  const unit = useWorkspace((s) => s.unit)
  const treemapVisible = useWorkspace((s) => s.treemapVisible)
  const paneTab = useWorkspace((s) => s.paneTab)
  const exporting = useWorkspace((s) => s.exporting)
  const exportTree = useWorkspace((s) => s.exportTree)
  const stopScan = useWorkspace((s) => s.stopScan)
  const rescan = useWorkspace((s) => s.rescan)
  const setMode = useWorkspace((s) => s.setMode)
  const setUnit = useWorkspace((s) => s.setUnit)
  const expandLevels = useWorkspace((s) => s.expandLevels)
  const openInExplorer = useWorkspace((s) => s.openInExplorer)
  const createFolder = useWorkspace((s) => s.createFolder)
  const deleteSelection = useWorkspace((s) => s.deleteSelection)
  const togglePane = useWorkspace((s) => s.togglePane)
  const quit = useWorkspace((s) => s.quit)
  const checkForUpdates = useWorkspace((s) => s.checkForUpdates)
  const openLink = useWorkspace((s) => s.openLink)
  const openWhatsNew = useWorkspace((s) => s.openWhatsNew)
  const updateState = useWorkspace((s) => s.updateState)
  const updatePending =
    updateState.kind === 'available' ||
    updateState.kind === 'downloading' ||
    updateState.kind === 'ready' ||
    (updateState.kind === 'error' && updateState.during === 'download')

  const scanning = phase === 'scanning'
  const hasTree = phase !== 'empty' && phase !== 'failed'
  const cannotDelete = !hasTree || scanning || selectedId === null
  const cannotExport = phase !== 'done' || exporting !== null

  const scanGroup = (
    <Group label="Scan">
      <SelectMenu />
      <RibbonButton
        label="Stop"
        icon={IconStop}
        disabled={!scanning}
        title="Stop the running scan"
        onClick={() => void stopScan()}
      />
      <RibbonButton
        label="Refresh"
        icon={IconRefresh}
        disabled={scanning || target === null}
        title="Scan the same location again (F5)"
        onClick={() => void rescan()}
      />
    </Group>
  )

  const expandMenu = (
    <MenuButton
      menuLabel="Expand the tree"
      disabled={!hasTree}
      className={RIBBON_BUTTON_CLASS}
      title="Show more levels of the folder tree"
      sections={[
        {
          id: 'levels',
          entries: [
            ...[1, 2, 3, 4, 5].map((levels) => ({
              id: `level-${levels}`,
              label: levels === 1 ? '1 level' : `${levels} levels`,
              onSelect: () => void expandLevels(levels),
            })),
            {
              id: 'all',
              label: 'All levels',
              onSelect: () => void expandLevels(EXPAND_ALL_LEVELS),
            },
          ],
        },
      ]}
    >
      <IconExpand aria-hidden="true" focusable={false} />
      <span className="flex items-center gap-0.5">
        Expand
        <IconChevronDown aria-hidden="true" focusable={false} />
      </span>
    </MenuButton>
  )

  const modeGroup = (
    <Group label="Mode">
      {MODES.map((entry) => (
        <RibbonButton
          key={entry.mode}
          label={entry.label}
          icon={entry.icon}
          title={entry.title}
          pressed={mode === entry.mode}
          onClick={() => setMode(entry.mode)}
        />
      ))}
    </Group>
  )

  const unitGroup = (
    <Group label="Unit">
      <div className="grid grid-cols-2 gap-0.5 self-center rounded-pill bg-sunken p-0.5">
        {SIZE_UNITS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={unit === value}
            title={
              value === 'auto' ? 'Pick a unit for each size' : `Show sizes in ${UNIT_LABELS[value]}`
            }
            onClick={() => setUnit(value)}
            className={RIBBON_SMALL_CLASS}
          >
            {UNIT_LABELS[value]}
          </button>
        ))}
      </div>
    </Group>
  )

  const folderGroup = (
    <Group label="Folder">
      {expandMenu}
      <RibbonButton
        label="Open in Explorer"
        icon={IconOpenFolder}
        disabled={!hasTree || selectedId === null || severalSelected}
        title="Open the selected item in File Explorer (Enter)"
        onClick={() => {
          if (selectedId !== null) void openInExplorer(selectedId)
        }}
      />
      <RibbonButton
        label="New folder"
        icon={IconNewFolder}
        disabled={!hasTree || scanning || selectedId === null || severalSelected}
        title="Create a folder in the selected folder (Ctrl+N)"
        onClick={() => {
          if (selectedId !== null) void createFolder(selectedId)
        }}
      />
      <div className="flex items-stretch">
        <RibbonButton
          label="Delete"
          icon={IconDelete}
          disabled={cannotDelete}
          title="Send the selected items to the Recycle Bin (Delete)"
          onClick={() => void deleteSelection(false)}
        />
        <MenuButton
          menuLabel="Delete options"
          triggerLabel="More delete options"
          disabled={cannotDelete}
          className="flex min-w-5 items-start justify-center rounded-[9px] px-1 pt-2 text-ink-muted transition-colors duration-[120ms] hover:bg-row-hover hover:text-ink aria-expanded:bg-row-hover aria-disabled:cursor-default aria-disabled:text-ink-subtle aria-disabled:opacity-40 aria-disabled:hover:bg-transparent"
          title="More delete options"
          sections={[
            {
              id: 'delete',
              entries: [
                {
                  id: 'permanent',
                  label: 'Delete permanently',
                  onSelect: () => void deleteSelection(true),
                },
              ],
            },
          ]}
        >
          <IconChevronDown aria-hidden="true" focusable={false} />
        </MenuButton>
      </div>
    </Group>
  )

  const helpPanel = (
    <>
      <Group label="Help">
        <RibbonButton
          label="Help"
          icon={IconHelp}
          title="Open the StorageIQ guide in your browser"
          onClick={() => void openLink('help')}
        />
        <RibbonButton
          label="Report a problem"
          icon={IconReportProblem}
          title="Open the issue form in your browser"
          onClick={() => void openLink('issues')}
        />
      </Group>
      <Group label="Version">
        <RibbonButton label="About" icon={IconAbout} title="About StorageIQ" onClick={onAbout} />
        <RibbonButton
          label="Check for updates"
          icon={IconCheckUpdates}
          title="Check whether a newer StorageIQ is available"
          badge={updatePending}
          onClick={() => {
            void checkForUpdates()
            onAbout()
          }}
        />
        <RibbonButton
          label="What's new"
          icon={IconWhatsNew}
          title="See what changed in each version"
          onClick={() => openWhatsNew({ kind: 'history' })}
        />
      </Group>
    </>
  )

  const panels: Record<RibbonTab, ReactNode> = {
    file: (
      <>
        <Group label="Export">
          <RibbonButton
            label="Export to CSV…"
            icon={IconExportCsv}
            disabled={cannotExport}
            title="Save every folder and file below the folder shown in the pane as a CSV file"
            onClick={() => void exportTree('csv')}
          />
          <RibbonButton
            label="Export to Excel…"
            icon={IconExportExcel}
            disabled={cannotExport}
            title="Save the same list, with the top files, types and ages, as an Excel workbook"
            onClick={() => void exportTree('xlsx')}
          />
        </Group>
        <Group label="App">
          <RibbonButton
            label="Exit"
            icon={IconExit}
            title="Close StorageIQ"
            onClick={() => void quit()}
          />
        </Group>
      </>
    ),
    home: (
      <>
        {scanGroup}
        {modeGroup}
        {unitGroup}
        {folderGroup}
      </>
    ),
    scan: (
      <>
        {scanGroup}
        <Group label="Tree">{expandMenu}</Group>
      </>
    ),
    view: (
      <>
        {modeGroup}
        {unitGroup}
        <Group label="Pane">
          {PANE_BUTTONS.map((entry) => (
            <RibbonButton
              key={entry.tab}
              label={entry.label}
              icon={entry.icon}
              pressed={treemapVisible && paneTab === entry.tab}
              title={entry.title}
              onClick={() => togglePane(entry.tab)}
            />
          ))}
        </Group>
      </>
    ),
    options: <OptionsGroup />,
    help: helpPanel,
  }

  const active = TABS.find((entry) => entry.id === tab) ?? { id: 'home', label: 'Home' }

  return (
    <header className="border-b border-line bg-app">
      <div
        ref={tablistRef}
        role="tablist"
        aria-label="Ribbon"
        focusgroup="tablist nomemory"
        className="flex h-(--size-tab-strip) items-end gap-0.5 px-1"
      >
        {TABS.map((entry) => (
          <button
            key={entry.id}
            id={`${baseId}-${entry.id}`}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            aria-label={entry.id === 'help' && updatePending ? 'Help, update available' : undefined}
            onClick={() => setTab(entry.id)}
            onFocus={() => setTab(entry.id)}
            className="relative min-h-6 rounded-control px-3 text-[13px] leading-[18px] font-medium text-ink-muted transition-colors duration-[120ms] after:absolute after:inset-x-2 after:bottom-0.5 after:h-0.5 after:rounded-[1px] after:bg-accent after:opacity-0 hover:bg-row-hover hover:text-ink aria-selected:font-semibold aria-selected:text-ink aria-selected:after:opacity-100 forced-colors:aria-selected:underline forced-colors:aria-selected:decoration-2 forced-colors:aria-selected:decoration-[Highlight] forced-colors:aria-selected:underline-offset-4"
          >
            {entry.label}
            {entry.id === 'help' && updatePending && (
              <NotificationDot className="top-0.5 right-0.5" />
            )}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        aria-labelledby={`${baseId}-${active.id}`}
        className="h-(--size-ribbon-body) bg-app px-2 py-1"
      >
        <div
          ref={toolbarRef}
          role="toolbar"
          aria-label={`${active.label} commands`}
          focusgroup="toolbar wrap"
          className="flex h-full items-start gap-2"
        >
          {panels[tab]}
        </div>
      </div>
    </header>
  )
}

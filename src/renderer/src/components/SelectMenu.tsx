import {
  IconChevronDown,
  IconChooseFolder,
  IconCloud,
  IconDocuments,
  IconDrive,
  IconRecent,
  IconSelect,
  IconUsbDrive,
} from '../lib/icons'
import { useWorkspace } from '../stores/workspace-store-context'
import { MenuButton, type MenuSection } from './MenuButton'
import { RIBBON_BUTTON_CLASS } from './RibbonButton'

/** Ribbon "Select" button: drives, Documents and cloud, recently scanned, choose a folder. */
export function SelectMenu() {
  const drives = useWorkspace((s) => s.drives)
  const places = useWorkspace((s) => s.places)
  const loadMenuData = useWorkspace((s) => s.loadMenuData)
  const startScan = useWorkspace((s) => s.startScan)
  const chooseFolder = useWorkspace((s) => s.chooseFolder)
  const folderPickerOpen = useWorkspace((s) => s.folderPickerOpen)

  const sections: MenuSection[] = [
    {
      id: 'drives',
      label: 'Drives',
      emptyText: '(none)',
      entries: drives.map((drive) => ({
        id: drive.root,
        label: `${drive.label} (${drive.root.slice(0, 2)})`,
        icon: drive.kind === 'removable' ? IconUsbDrive : IconDrive,
        onSelect: () => void startScan(drive.root),
      })),
    },
    {
      id: 'places',
      label: 'Documents and cloud',
      emptyText: '(none)',
      entries: places.places.map((place) => ({
        id: place.path,
        label: place.label,
        icon: place.kind === 'documents' ? IconDocuments : IconCloud,
        onSelect: () => void startScan(place.path),
      })),
    },
    {
      id: 'recent',
      label: 'Recently scanned',
      emptyText: '(none)',
      entries: places.recent.map((path) => ({
        id: `recent:${path}`,
        label: path,
        icon: IconRecent,
        onSelect: () => void startScan(path),
      })),
    },
    {
      id: 'directory',
      label: 'Directory',
      entries: [
        {
          id: 'choose',
          label: 'Choose a folder…',
          icon: IconChooseFolder,
          disabled: folderPickerOpen,
          onSelect: () => void chooseFolder(),
        },
      ],
    },
  ]

  return (
    <MenuButton
      menuLabel="Select a drive or folder"
      sections={sections}
      onOpen={() => void loadMenuData()}
      className={RIBBON_BUTTON_CLASS}
      title="Choose a drive or folder to scan"
    >
      <IconSelect aria-hidden="true" focusable={false} />
      <span className="flex items-center gap-0.5">
        Select
        <IconChevronDown aria-hidden="true" focusable={false} />
      </span>
    </MenuButton>
  )
}

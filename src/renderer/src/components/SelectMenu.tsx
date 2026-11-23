import { ChevronDown, Clock, Cloud, FileText, FolderSearch, HardDrive, Usb } from 'lucide-react'
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
        icon: drive.kind === 'removable' ? Usb : HardDrive,
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
        icon: place.kind === 'documents' ? FileText : Cloud,
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
        icon: Clock,
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
          icon: FolderSearch,
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
      <FolderSearch aria-hidden="true" className="size-5.5" strokeWidth={1.75} />
      <span className="flex items-center gap-0.5">
        Select
        <ChevronDown aria-hidden="true" className="size-3" />
      </span>
    </MenuButton>
  )
}

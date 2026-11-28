import { useWorkspace } from '../stores/workspace-store-context'
import { AgeView } from './AgeView'
import { TopFilesView } from './TopFilesView'
import { TreemapPane } from './TreemapPane'
import { TypesView } from './TypesView'

/** The view the bottom pane shows: the treemap or one of the side views. */
export function PaneView({ height }: { height: number }) {
  const paneTab = useWorkspace((s) => s.paneTab)
  switch (paneTab) {
    case 'top':
      return <TopFilesView height={height} />
    case 'types':
      return <TypesView height={height} />
    case 'age':
      return <AgeView height={height} />
    case 'treemap':
    default:
      return <TreemapPane height={height} />
  }
}

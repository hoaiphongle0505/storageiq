import path from 'node:path'
import { MAX_RECENT_SCANS, type Place, type Places } from '@shared/scan-types'

export const RECENT_SCANS_FILE = 'recent-scans.json'

export interface PlacesDeps {
  /** `app.getPath('documents')`; null when Windows has no Documents folder for this user. */
  documentsPath(): string | null
  env: Readonly<Record<string, string | undefined>>
  isDirectory(target: string): Promise<boolean>
  recent: RecentScans
}

/** `C:\…` only: the Select menu never offers network or relative paths. */
const LOCAL_ABSOLUTE = /^[A-Za-z]:\\/

/**
 * OneDrive folders from the environment variables the OneDrive client sets:
 * `OneDriveConsumer` (personal), `OneDriveCommercial` (work or school) and `OneDrive` (the
 * default one, usually equal to one of the others). The personal folder is labelled
 * "OneDrive"; a work folder keeps its own name, for example "OneDrive - Contoso".
 */
export function oneDriveFolders(env: Readonly<Record<string, string | undefined>>): Place[] {
  const found: Place[] = []
  const seen = new Set<string>()
  const add = (value: string | undefined, label: (folder: string) => string) => {
    if (value === undefined || !LOCAL_ABSOLUTE.test(value)) return
    const folder = path.win32.normalize(value)
    const key = folder.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    found.push({ kind: 'onedrive', label: label(folder), path: folder })
  }
  add(env['OneDriveConsumer'], () => 'OneDrive')
  add(env['OneDriveCommercial'], (folder) => path.win32.basename(folder))
  add(env['OneDrive'], (folder) => path.win32.basename(folder))
  return found
}

export async function listPlaces(deps: PlacesDeps): Promise<Places> {
  const candidates: Place[] = []
  const documents = deps.documentsPath()
  if (documents !== null && LOCAL_ABSOLUTE.test(documents)) {
    candidates.push({ kind: 'documents', label: 'Documents', path: documents })
  }
  candidates.push(...oneDriveFolders(deps.env))
  const exists = await Promise.all(candidates.map((place) => deps.isDirectory(place.path)))
  return {
    places: candidates.filter((_place, index) => exists[index] === true),
    recent: await deps.recent.list(),
  }
}

export interface RecentScansDeps {
  /** Full path of `recent-scans.json` in userData. */
  file: string
  readFile(file: string): Promise<string>
  writeFile(file: string, text: string): Promise<void>
}

export interface RecentScans {
  list(): Promise<string[]>
  /** Puts `target` first, removes an older copy (any letter case) and keeps the newest five. */
  add(target: string): Promise<void>
}

export function parseRecent(text: string): string[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  return data
    .filter((entry): entry is string => typeof entry === 'string' && LOCAL_ABSOLUTE.test(entry))
    .slice(0, MAX_RECENT_SCANS)
}

export function createRecentScans(deps: RecentScansDeps): RecentScans {
  /** Writes happen one at a time, in call order. */
  let queue: Promise<void> = Promise.resolve()
  const read = async () => parseRecent(await deps.readFile(deps.file).catch(() => '[]'))
  return {
    list: async () => {
      await queue
      return read()
    },
    add(target) {
      queue = queue.then(async () => {
        const current = await read()
        const key = target.toLowerCase()
        const next = [target, ...current.filter((entry) => entry.toLowerCase() !== key)].slice(
          0,
          MAX_RECENT_SCANS,
        )
        await deps.writeFile(deps.file, JSON.stringify(next)).catch(() => undefined)
      })
      return queue
    },
  }
}

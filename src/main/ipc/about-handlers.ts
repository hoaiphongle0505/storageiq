import type { AboutLink, ChangelogEntry } from '@shared/ipc-contract'
import { compareVersions } from '@shared/semver'
import { parseChangelog } from '../about/parse-changelog'
import type { WhatsNewStore } from '../about/whats-new-store'
import { aboutLinkArg, noArgs } from './parse-args'
import type { IpcHandlerMap } from './register'

const REPO = 'https://github.com/hoaiphongle0505/storageiq'

/** The only URLs the renderer can make main open; it names one by key. */
export const ABOUT_LINK_URLS: Record<AboutLink, string> = {
  repo: REPO,
  license: `${REPO}/blob/main/LICENSE`,
  releases: `${REPO}/releases`,
  help: `${REPO}#readme`,
  issues: `${REPO}/issues/new/choose`,
}

/** Most changelog entries `app:get-changelog` returns. */
export const MAX_CHANGELOG_RESULT = 10

export interface AboutHandlerDeps {
  /** The running app version. */
  version: string
  /** The bundled CHANGELOG.md text (already size-bounded); rejects when unreadable. */
  readChangelog(): Promise<string>
  store: WhatsNewStore
  /** Absolute path of THIRD_PARTY_NOTICES.txt. */
  noticesPath: string
  fileExists(file: string): Promise<boolean>
  /** `shell.openPath`: resolves to an empty string on success. */
  openPath(file: string): Promise<string>
  openExternal(url: string): Promise<void>
  log(message: string, error?: unknown): void
}

export type AboutHandlers = Pick<
  IpcHandlerMap,
  | 'app:get-changelog'
  | 'app:open-notices'
  | 'app:open-link'
  | 'app:get-whats-new-due'
  | 'app:mark-whats-new-seen'
>

export function createAboutHandlers(deps: AboutHandlerDeps): AboutHandlers {
  let cached: ChangelogEntry[] | null = null

  const changelog = async (): Promise<ChangelogEntry[]> => {
    if (cached !== null) return cached
    try {
      cached = parseChangelog(await deps.readChangelog())
      return cached
    } catch (error) {
      deps.log('Could not read CHANGELOG.md', error)
      return []
    }
  }

  return {
    'app:get-changelog': {
      parseArgs: noArgs,
      handle: async () => (await changelog()).slice(0, MAX_CHANGELOG_RESULT),
    },

    'app:open-notices': {
      parseArgs: noArgs,
      handle: async () => {
        try {
          if (!(await deps.fileExists(deps.noticesPath))) return { opened: false }
          return { opened: (await deps.openPath(deps.noticesPath)) === '' }
        } catch (error) {
          deps.log('Could not open the third-party notices', error)
          return { opened: false }
        }
      },
    },

    'app:open-link': {
      parseArgs: aboutLinkArg,
      handle: async (_event, link) => {
        try {
          await deps.openExternal(ABOUT_LINK_URLS[link])
        } catch (error) {
          deps.log('Could not open a link', error)
        }
      },
    },

    'app:get-whats-new-due': {
      parseArgs: noArgs,
      handle: async () => {
        const last = await deps.store.read()
        const order = last === null ? null : compareVersions(deps.version, last)
        if (order !== 1) {
          // First install, corrupt file, downgrade or same version: record, show nothing.
          if (order !== 0) await deps.store.write(deps.version)
          return null
        }
        const entry = (await changelog()).find((e) => e.version === deps.version)
        if (entry !== undefined) return entry // recorded when the dialog opens (mark-seen)
        await deps.store.write(deps.version)
        return null
      },
    },

    'app:mark-whats-new-seen': {
      parseArgs: noArgs,
      handle: async () => {
        await deps.store.write(deps.version)
      },
    },
  }
}

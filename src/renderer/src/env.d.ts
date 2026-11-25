/// <reference types="vite/client" />
import type { StorageIQApi } from '@shared/ipc-contract'

declare global {
  interface Window {
    storageiq: StorageIQApi
  }
}

// The HTML `focusgroup` attribute (arrow-key navigation for toolbars, tab lists and menus).
// Chromium 150+ supports it; React passes unknown lower-case attributes through.
declare module 'react' {
  // `T` must match React's own declaration for the interfaces to merge.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface HTMLAttributes<T> {
    focusgroup?: string
  }
}

export {}

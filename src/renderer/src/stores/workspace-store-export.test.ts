import { describe, expect, it, vi } from 'vitest'
import type { ExportResult } from '@shared/ipc-contract'
import { createFakeApi, TEST_EXPORT_PATH } from '../test/fake-api'
import { makeDone } from '../test/scan-fixtures'
import {
  createWorkspaceStore,
  EXPORT_CUT_MESSAGE,
  EXPORTING_MESSAGE,
  exportedMessage,
} from './workspace-store'

async function finished(api = createFakeApi()) {
  const store = createWorkspaceStore(api)
  await store.getState().startScan('D:\\')
  api.emitScanDone(makeDone())
  return { api, store }
}

describe('exportedMessage', () => {
  it('names the number of rows and the file, not its folder', () => {
    expect(
      exportedMessage({
        status: 'done',
        rows: 12_345,
        truncated: false,
        filePath: TEST_EXPORT_PATH,
      }),
    ).toBe('Exported 12,345 rows to D - StorageIQ.csv.')
    expect(
      exportedMessage({ status: 'done', rows: 1, truncated: false, filePath: 'E:/x/Data.xlsx' }),
    ).toBe('Exported 1 row to Data.xlsx.')
  })

  it('says when the Excel sheet was cut', () => {
    expect(
      exportedMessage({ status: 'done', rows: 1_048_575, truncated: true, filePath: 'C:\\a.xlsx' }),
    ).toBe(`Exported 1,048,575 rows to a.xlsx. ${EXPORT_CUT_MESSAGE}`)
  })
})

describe('exportTree', () => {
  it('exports the treemap folder of the finished scan and ends with a calm banner', async () => {
    const { api, store } = await finished()
    store.getState().select('d1')
    await store.getState().exportTree('xlsx')
    expect(api.exportTree).toHaveBeenCalledWith('scan-1', 'd1', 'xlsx')
    expect(store.getState()).toMatchObject({
      exporting: null,
      banner: {
        tone: 'success',
        message: 'Exported 3 rows to D - StorageIQ.csv.',
        showExport: true,
      },
      announcement: 'Exported 3 rows to D - StorageIQ.csv.',
    })
  })

  it('shows "Exporting…" and refuses a second export while one runs', async () => {
    let release: (result: ExportResult) => void = () => undefined
    const exportTree = vi.fn(
      () =>
        new Promise<ExportResult>((resolve) => {
          release = resolve
        }),
    )
    const { store } = await finished(createFakeApi({ exportTree }))
    const first = store.getState().exportTree('csv')
    expect(store.getState()).toMatchObject({ exporting: 'csv', announcement: EXPORTING_MESSAGE })
    await store.getState().exportTree('xlsx')
    expect(exportTree).toHaveBeenCalledTimes(1)
    release({ status: 'cancelled' })
    await first
    expect(store.getState()).toMatchObject({ exporting: null, announcement: '', banner: null })
  })

  it('does nothing before a scan has finished, or while one runs', async () => {
    const api = createFakeApi()
    const store = createWorkspaceStore(api)
    await store.getState().exportTree('csv')
    await store.getState().startScan('D:\\')
    await store.getState().exportTree('csv') // still scanning
    expect(api.exportTree).not.toHaveBeenCalled()
  })

  it('shows the message of a failed export in an error banner', async () => {
    const { store } = await finished(
      createFakeApi({
        exportTree: vi.fn(async () => ({
          status: 'failed' as const,
          message: 'The file is open in another program.',
        })),
      }),
    )
    await store.getState().exportTree('csv')
    expect(store.getState().banner).toEqual({
      tone: 'error',
      message: 'Couldn’t export the tree. The file is open in another program.',
    })
    expect(store.getState().exporting).toBeNull()
  })

  it('shows an error banner when the call itself fails', async () => {
    const { store } = await finished(
      createFakeApi({
        exportTree: vi.fn(async () => {
          throw new Error('bridge down')
        }),
      }),
    )
    await store.getState().exportTree('csv')
    expect(store.getState().banner?.tone).toBe('error')
    expect(store.getState().exporting).toBeNull()
  })
})

describe('showExport', () => {
  it('asks main to show the last export', async () => {
    const { api, store } = await finished()
    await store.getState().showExport()
    expect(api.showExport).toHaveBeenCalledTimes(1)
  })
})

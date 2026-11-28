import path from 'node:path'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { ScannerQuery } from '@shared/scanner-protocol'
import {
  createExportHandlers,
  EXPORT_RUNNING_MESSAGE,
  exportFileName,
  type ExportHandlerDeps,
} from './export-handlers'
import { InvalidIpcArgumentsError } from './parse-args'
import { fakeTreeService, SCAN } from './test/fake-tree-service'
import { NOT_IN_SCAN_MESSAGE, SCAN_RUNNING_MESSAGE } from './tree-handlers'

const event = {} as IpcMainInvokeEvent
const window = {} as BrowserWindow

function setup(
  options: {
    scanning?: boolean
    chosen?: { canceled: boolean; filePath: string }
    summary?: { rows: number; truncated: boolean } | null | Error
    window?: BrowserWindow | null
  } = {},
) {
  const fake = fakeTreeService({ scanning: options.scanning })
  const exportQueries: ScannerQuery[] = []
  const query = fake.service.query
  fake.service.query = vi.fn(async (q: ScannerQuery) => {
    if (q.kind !== 'export') return query(q as never)
    exportQueries.push(q)
    const summary = options.summary === undefined ? { rows: 42, truncated: false } : options.summary
    if (summary instanceof Error) throw summary
    return summary
  }) as typeof fake.service.query
  const showSaveDialog = vi.fn<ExportHandlerDeps['dialog']['showSaveDialog']>(
    async () => options.chosen ?? { canceled: false, filePath: 'C:\\Out\\Photos - StorageIQ.csv' },
  )
  const showItemInFolder = vi.fn<(target: string) => void>()
  const handlers = createExportHandlers({
    scanService: fake.service,
    dialog: { showSaveDialog },
    getMainWindow: () => (options.window === undefined ? window : options.window),
    defaultFolder: () => 'C:\\Users\\Ana\\Documents',
    showItemInFolder,
  })
  return { handlers, exportQueries, showSaveDialog, showItemInFolder }
}

describe('exportFileName', () => {
  it('is the folder name and "StorageIQ", without characters Windows refuses', () => {
    expect(exportFileName('Photos', 'csv')).toBe('Photos - StorageIQ.csv')
    expect(exportFileName('Reports 2026', 'xlsx')).toBe('Reports 2026 - StorageIQ.xlsx')
    expect(exportFileName('D:\\', 'csv')).toBe('D - StorageIQ.csv')
    expect(exportFileName('a/b:c*d?', 'csv')).toBe('abcd - StorageIQ.csv')
    expect(exportFileName('', 'xlsx')).toBe('Export - StorageIQ.xlsx')
  })
})

describe('export:run', () => {
  it('validates its arguments before anything happens', () => {
    const { handlers, showSaveDialog } = setup()
    expect(() => handlers['export:run'].parseArgs([SCAN, 'd1', 'pdf'])).toThrow(
      InvalidIpcArgumentsError,
    )
    expect(() => handlers['export:run'].parseArgs([SCAN, 'd1', 'csv', 'C:\\x.csv'])).toThrow(
      InvalidIpcArgumentsError,
    )
    expect(showSaveDialog).not.toHaveBeenCalled()
  })

  it('asks where to save, then has the scanner write exactly that file', async () => {
    const { handlers, exportQueries, showSaveDialog } = setup()
    const result = await handlers['export:run'].handle(event, SCAN, 'd1', 'csv')
    expect(result).toEqual({
      status: 'done',
      filePath: 'C:\\Out\\Photos - StorageIQ.csv',
      rows: 42,
      truncated: false,
    })
    expect(showSaveDialog).toHaveBeenCalledWith(window, {
      title: 'Export to CSV',
      defaultPath: path.join('C:\\Users\\Ana\\Documents', 'Photos - StorageIQ.csv'),
      filters: [{ name: 'CSV file', extensions: ['csv'] }],
    })
    expect(exportQueries).toEqual([
      {
        kind: 'export',
        scanId: SCAN,
        nodeId: 'd1',
        format: 'csv',
        filePath: 'C:\\Out\\Photos - StorageIQ.csv',
      },
    ])
  })

  it('offers an Excel filter and name for xlsx', async () => {
    const { handlers, showSaveDialog } = setup()
    await handlers['export:run'].handle(event, SCAN, 'd1', 'xlsx')
    expect(showSaveDialog).toHaveBeenCalledWith(
      window,
      expect.objectContaining({
        title: 'Export to Excel',
        defaultPath: path.join('C:\\Users\\Ana\\Documents', 'Photos - StorageIQ.xlsx'),
        filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
      }),
    )
  })

  it('passes on that the Excel sheet was cut', async () => {
    const { handlers } = setup({ summary: { rows: 1_048_575, truncated: true } })
    expect(await handlers['export:run'].handle(event, SCAN, 'd1', 'xlsx')).toMatchObject({
      status: 'done',
      truncated: true,
    })
  })

  it('writes nothing when the save dialog is cancelled', async () => {
    const { handlers, exportQueries } = setup({ chosen: { canceled: true, filePath: '' } })
    expect(await handlers['export:run'].handle(event, SCAN, 'd1', 'csv')).toEqual({
      status: 'cancelled',
    })
    expect(exportQueries).toEqual([])
  })

  it('reports a write error with its message', async () => {
    const { handlers } = setup({ summary: new Error('The file is open in another program.') })
    expect(await handlers['export:run'].handle(event, SCAN, 'd1', 'csv')).toEqual({
      status: 'failed',
      message: 'The file is open in another program.',
    })
  })

  it('refuses during a scan, for another scan, and for a node that is gone', async () => {
    const scanning = setup({ scanning: true })
    expect(await scanning.handlers['export:run'].handle(event, SCAN, 'd1', 'csv')).toEqual({
      status: 'failed',
      message: SCAN_RUNNING_MESSAGE,
    })
    const idle = setup()
    expect(await idle.handlers['export:run'].handle(event, 'f0f0', 'd1', 'csv')).toEqual({
      status: 'failed',
      message: NOT_IN_SCAN_MESSAGE,
    })
    expect(await idle.handlers['export:run'].handle(event, SCAN, 'd99', 'csv')).toEqual({
      status: 'failed',
      message: NOT_IN_SCAN_MESSAGE,
    })
    expect(idle.showSaveDialog).not.toHaveBeenCalled()
  })

  it('runs one export at a time', async () => {
    const { handlers, showSaveDialog } = setup()
    let release: (value: { canceled: boolean; filePath: string }) => void = () => undefined
    showSaveDialog.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const first = handlers['export:run'].handle(event, SCAN, 'd1', 'csv')
    await vi.waitFor(() => expect(showSaveDialog).toHaveBeenCalledTimes(1))
    expect(await handlers['export:run'].handle(event, SCAN, 'd1', 'csv')).toEqual({
      status: 'failed',
      message: EXPORT_RUNNING_MESSAGE,
    })
    release({ canceled: true, filePath: '' })
    expect(await first).toEqual({ status: 'cancelled' })
    // The next export is allowed again.
    expect(await handlers['export:run'].handle(event, SCAN, 'd1', 'csv')).toMatchObject({
      status: 'done',
    })
  })
})

describe('shell:show-export', () => {
  it('takes no arguments and does nothing before an export', async () => {
    const { handlers, showItemInFolder } = setup()
    expect(() => handlers['shell:show-export'].parseArgs(['C:\\Windows'])).toThrow(
      InvalidIpcArgumentsError,
    )
    await handlers['shell:show-export'].handle(event)
    expect(showItemInFolder).not.toHaveBeenCalled()
  })

  it('shows the file of the last successful export only', async () => {
    const { handlers, showItemInFolder } = setup()
    await handlers['export:run'].handle(event, SCAN, 'd1', 'csv')
    await handlers['shell:show-export'].handle(event)
    expect(showItemInFolder).toHaveBeenCalledWith('C:\\Out\\Photos - StorageIQ.csv')
  })
})

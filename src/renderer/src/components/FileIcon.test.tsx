// @vitest-environment jsdom
import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IconBatch } from '@shared/ipc-contract'
import type { TreeRow } from '@shared/tree-types'
import { createFakeApi } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { FileIcon } from './FileIcon'

const SMALL = 'data:image/png;base64,SMALL'
const LARGE = 'data:image/png;base64,LARGE'

const row = (fields: Partial<TreeRow> & Pick<TreeRow, 'id'>): TreeRow => ({
  parentId: 'd0',
  kind: 'file',
  name: 'notes.txt',
  size: 1,
  allocated: 1,
  files: 1,
  folders: 0,
  modifiedMs: 0,
  childCount: 0,
  ...fields,
})

function iconsApi(batch: IconBatch | null = null) {
  return createFakeApi({
    getIcons: vi.fn(
      async (_scan: string, ids: string[]): Promise<IconBatch> =>
        batch ?? {
          keys: Object.fromEntries(ids.map((id) => [id, 'ext:txt'])),
          images: { 'ext:txt': { small: SMALL, large: LARGE } },
          pending: [],
        },
    ),
  })
}

const box = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-file-icon]') as HTMLElement

function setPixelRatio(value: number) {
  Object.defineProperty(window, 'devicePixelRatio', { value, configurable: true })
}

afterEach(() => {
  setPixelRatio(1)
})

describe('<FileIcon />', () => {
  it('renders the placeholder in a 16 px box first and swaps to an img when the image arrives', async () => {
    const { container, icons } = renderWithStores(
      <FileIcon row={row({ id: 'f1' })} root={false} />,
      iconsApi(),
    )
    expect(box(container)).toHaveClass('size-4')
    expect(box(container).querySelector('svg')).not.toBeNull()
    expect(container.querySelector('img')).toBeNull()
    act(() => icons.request('scan-1', ['f1']))
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull())
    expect(box(container).querySelector('svg')).toBeNull()
    const image = container.querySelector('img') as HTMLImageElement
    expect(image).toHaveAttribute('src', SMALL)
    expect(image).toHaveAttribute('data-icon', 'ext:txt')
    expect(image).toHaveAttribute('width', '16')
    expect(image).toHaveAttribute('height', '16')
    expect(image).toHaveClass('size-4', 'shrink-0', 'object-contain')
  })

  it('the box keeps its size across the swap', async () => {
    const { container, icons } = renderWithStores(
      <FileIcon row={row({ id: 'f1' })} root={false} />,
      iconsApi(),
    )
    const before = box(container)
    const classBefore = before.className
    act(() => icons.request('scan-1', ['f1']))
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull())
    const after = box(container)
    expect(after).toBe(before) // the same element, not a new one
    expect(after.className).toBe(classBefore)
    expect(after).toHaveClass('size-4')
    expect(after).not.toHaveAttribute('width')
    expect(after.getAttribute('style')).toBeNull()
  })

  it('uses the large bitmap when devicePixelRatio is 1.5 and the small one at 1', async () => {
    setPixelRatio(1.5)
    const high = renderWithStores(<FileIcon row={row({ id: 'f1' })} root={false} />, iconsApi())
    act(() => high.icons.request('scan-1', ['f1']))
    await waitFor(() => expect(high.container.querySelector('img')).toHaveAttribute('src', LARGE))
    high.unmount()

    setPixelRatio(1)
    const low = renderWithStores(<FileIcon row={row({ id: 'f1' })} root={false} />, iconsApi())
    act(() => low.icons.request('scan-1', ['f1']))
    await waitFor(() => expect(low.container.querySelector('img')).toHaveAttribute('src', SMALL))
  })

  it('the img is aria-hidden with empty alt', async () => {
    const { container, icons } = renderWithStores(
      <FileIcon row={row({ id: 'f1' })} root={false} />,
      iconsApi(),
    )
    act(() => icons.request('scan-1', ['f1']))
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull())
    const image = container.querySelector('img') as HTMLImageElement
    expect(image).toHaveAttribute('alt', '')
    expect(image).toHaveAttribute('aria-hidden', 'true')
    expect(image).toHaveAttribute('draggable', 'false')
    expect(image).toHaveAttribute('decoding', 'async')
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('placeholders are aria-hidden, not focusable svgs', () => {
    const { container } = renderWithStores(
      <>
        <FileIcon row={row({ id: 'f1' })} root={false} />
        <FileIcon row={row({ id: 'd1', kind: 'folder', name: 'Docs' })} root={false} />
        <FileIcon row={row({ id: 'd0', kind: 'folder', name: 'D:\\', parentId: null })} root />
      </>,
    )
    const svgs = container.querySelectorAll('svg')
    expect(svgs).toHaveLength(3)
    for (const svg of svgs) {
      expect(svg).toHaveAttribute('aria-hidden', 'true')
      expect(svg).toHaveAttribute('focusable', 'false')
    }
  })

  it('a missing image keeps the placeholder', async () => {
    const api = iconsApi({ keys: { f1: 'f:0123456789ab' }, images: {}, pending: [] })
    const { container, icons } = renderWithStores(
      <FileIcon row={row({ id: 'f1' })} root={false} />,
      api,
    )
    act(() => icons.request('scan-1', ['f1']))
    await waitFor(() => expect(api.getIcons).toHaveBeenCalled())
    await act(async () => {
      await Promise.resolve()
    })
    expect(container.querySelector('img')).toBeNull()
    expect(box(container).querySelector('svg')).not.toBeNull()
  })

  it('group rows use the placeholder and never request an icon', async () => {
    const api = iconsApi()
    const { container } = renderWithStores(
      <FileIcon row={row({ id: 'g1', kind: 'files', name: '' })} root={false} />,
      api,
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120))
    })
    expect(api.getIcons).not.toHaveBeenCalled()
    expect(container.querySelector('img')).toBeNull()
    expect(box(container).querySelector('svg')).not.toBeNull()
  })

  it('a group row stays a placeholder even if the cache knows its id', async () => {
    const api = iconsApi()
    const { container, icons } = renderWithStores(
      <FileIcon row={row({ id: 'g1', kind: 'files', name: '' })} root={false} />,
      api,
    )
    act(() => icons.request('scan-1', ['g1']))
    await waitFor(() => expect(api.getIcons).toHaveBeenCalled())
    await act(async () => {
      await Promise.resolve()
    })
    expect(container.querySelector('img')).toBeNull()
  })
})

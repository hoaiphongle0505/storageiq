// @vitest-environment jsdom
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderWithStores } from '../test/render'
import { Banner } from './Banner'

describe('<Banner />', () => {
  it('renders nothing without a message', () => {
    const { container } = renderWithStores(<Banner />)
    expect(container).toBeEmptyDOMElement()
  })

  it('its icons are aria-hidden svgs and its accessible name is unchanged', () => {
    const { workspace } = renderWithStores(<Banner />)
    act(() => workspace.setState({ banner: { tone: 'error', message: 'That did not work.' } }))
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('That did not work.')
    const svgs = alert.querySelectorAll('svg')
    expect(svgs).toHaveLength(1)
    expect(svgs[0]).toHaveAttribute('aria-hidden', 'true')
    expect(svgs[0]).toHaveAttribute('focusable', 'false')
    expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveAccessibleName('Dismiss')
  })

  it('a finished export is a calm status, with a Show in folder button', async () => {
    const user = userEvent.setup()
    const { api, workspace } = renderWithStores(<Banner />)
    act(() =>
      workspace.setState({
        banner: { tone: 'success', message: 'Exported 3 rows to a.csv.', showExport: true },
      }),
    )
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Exported 3 rows to a.csv.')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show in folder' }))
    expect(api.showExport).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('an error has no Show in folder button', () => {
    const { workspace } = renderWithStores(<Banner />)
    act(() => workspace.setState({ banner: { tone: 'error', message: 'No.' } }))
    expect(screen.queryByRole('button', { name: 'Show in folder' })).not.toBeInTheDocument()
  })

  it('a scanner crash shows the colour error icon and a Retry button', () => {
    const { workspace } = renderWithStores(<Banner />)
    act(() => workspace.setState({ banner: { tone: 'crash', message: 'The scanner stopped.' } }))
    expect(screen.getByRole('alert').querySelector('svg')).toHaveAttribute('data-color-icon')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import { CELL_H, CELL_W, makeFrame } from './pixels'
import { registerHtml } from './html'

const PANE = 'imgspike'
const TICK_MS = 100
const ALT = 'Image spike: a checkered floor with an orange block walking left to right'
const frame = atom({ plugin: 'imgspike', key: 'frame' } as const, 0)
const size = atom({ plugin: 'imgspike', key: 'size' } as const, { columns: 0, rows: 0 })
const ticking = atom({ plugin: 'imgspike', key: 'ticking' } as const, false)

const sourceFor = (columns: number, rows: number, n: number) => ({
  rgba: makeFrame(columns, rows, n).toBase64(),
  width: columns * CELL_W,
  height: rows * CELL_H,
})

export const register: Register = (on, options) => {
  registerHtml(on, options)
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'imgspike', description: 'Open the image spike pane' })
    await $.command.register({ name: 'htmlspike', description: 'Open the HTML spike pane' })
    return next(e)
  })

  on('command.run', { command: 'imgspike' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Image spike' })
    if (!(await read($, ticking))) {
      await update($, ticking, () => true)
      $.clock.every(TICK_MS, async () => {
        const { columns, rows } = await read($, size)
        if (columns === 0 || rows === 0) return
        const n = await update($, frame, f => f + 1)
        const result = await $.ui.blit({
          requestId: PANE,
          key: 'view',
          source: sourceFor(columns, rows, n),
        })
        if (result.deny !== undefined) $.ui.log(`imgspike: blit denied: ${result.deny}`, { to: 'debug' })
      })
    }
    return { text: 'Image spike pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    // Image is the terminal surface's element; elsewhere the pane says so in text.
    if (!('Image' in elements)) {
      return <elements.Box><elements.Text dimColor>{ALT}</elements.Text></elements.Box>
    }
    const { Box, Image } = elements
    const columns = e.props.bodyColumns
    const rows = e.props.scroll.bodyRows
    // A state write inside a render hook is denied by the host; a 0 ms timer closure runs after the render.
    $.clock.after(0, () => {
      read($, size)
        .then(last =>
          last.columns === columns && last.rows === rows ? last : update($, size, () => ({ columns, rows })),
        )
        .catch(error => $.ui.log(`imgspike: size write threw ${String(error)}`, { to: 'debug' }))
    })
    // Frame 0 only: reading the frame atom here would redraw the pane on every tick, which blit avoids.
    return (
      <Box flexDirection="column">
        <Image key="view" source={sourceFor(columns, rows, 0)} columns={columns} rows={rows} alt={ALT} />
      </Box>
    )
  })
}

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import { parseFrameLine, splitLines } from './frames'
import { boxFor, pixelsFor } from './box'

const PANE = 'htmlspike'
const ALT = 'HTML spike: a headless Chromium page with three walking characters'
const WIDTH = 608
const HEIGHT = 368
// Rows asked of the first open; the inline pane then follows the Image rows (about 60% of the terminal).
const OPEN_ROWS = 24
// Consecutive denies are tolerated this long (the Image mounts a moment after the first draw).
const DENY_GRACE_MS = 5000
const status = atom({ plugin: 'imgspike', key: 'htmlStatus' } as const, 'starting Chromium...')
const box = atom({ plugin: 'imgspike', key: 'htmlBox' } as const, { columns: 0, rows: 0 })
const running = atom({ plugin: 'imgspike', key: 'htmlRunning' } as const, false)

export const registerHtml: Register = on => {
  on('command.run', { command: 'htmlspike' }, async $ => {
    await $.ui.open({ id: PANE, title: 'HTML spike', rows: OPEN_ROWS })
    if (await read($, running)) return { text: 'HTML spike pane already running.' }
    await update($, running, () => true)
    await update($, status, () => 'starting Chromium...')
    const script = `${$.plugin.root}/renderer/render.mjs`
    void (async () => {
      let carry = ''
      let stderrText = ''
      let firstDenyAt = 0
      let ending = ''
      let framesSeen = 0
      // Leaving this loop kills the child.
      const child = $.process.spawn({ argv: ['node', script, String(WIDTH), String(HEIGHT)] })
      const it = child[Symbol.asyncIterator]()
      try {
        for (;;) {
          const step = await it.next()
          if (step.done === true) {
            const code = step.value.code
            ending = `renderer exited (code ${String(code)}, signal ${String(step.value.signal)}) after ${framesSeen} frames. stderr: ${stderrText.slice(-300) || '(none)'}`
            break
          }
          const piece = step.value
          if (piece.stream === 'stderr') {
            stderrText += piece.text
            $.ui.log(`htmlspike: ${piece.text}`, { to: 'debug' })
            continue
          }
          const split = splitLines(carry, piece.text)
          carry = split.carry
          // Only the newest frame in a piece matters: older ones are already overwritten on disk.
          const frames = split.lines.map(parseFrameLine).filter(f => f !== undefined)
          const latest = frames[frames.length - 1]
          if (latest === undefined) continue
          framesSeen += 1
          const result = await $.ui.blit({
            requestId: PANE,
            key: 'view',
            source: { file: latest.path, format: 'png', generation: latest.n },
          })
          if (result.deny === undefined) {
            firstDenyAt = 0
            continue
          }
          $.ui.log(`htmlspike: blit denied: ${result.deny}`, { to: 'debug' })
          const now = await $.clock.now()
          if (firstDenyAt === 0) firstDenyAt = now
          if (now - firstDenyAt >= DENY_GRACE_MS) {
            ending = `blit denied for ${DENY_GRACE_MS} ms, gave up: ${result.deny}`
            break
          }
        }
      } catch (error) {
        ending = `renderer failed to run: ${String(error)}. stderr: ${stderrText.slice(-300) || '(none)'}`
        $.ui.log(`htmlspike: ${ending}`, { to: 'debug' })
      }
      if (ending !== '') await update($, status, () => ending)
      await update($, running, () => false)
    })()
    return { text: 'HTML spike pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    if (!('Image' in elements)) {
      return <elements.Box><elements.Text dimColor>{ALT}</elements.Text></elements.Box>
    }
    const { Box, Text, Image } = elements
    const text = await read($, status)
    const size = boxFor(e.props.placement, e.props.bodyColumns, e.props.scroll.bodyRows, e.viewport?.rows)
    // A render hook cannot write state; a 0 ms timer closure runs after the render.
    $.clock.after(0, () => {
      void (async () => {
        const last = await read($, box)
        if (last.columns === size.columns && last.rows === size.rows) return
        await update($, box, () => size)
        const statePath = `${$.plugin.root}/renderer/state.json`
        const prior: { label?: string } = await $.fs
          .read(statePath)
          .then(t => JSON.parse(typeof t === 'string' ? t : '{}') as { label?: string })
          .catch(() => ({}))
        await $.fs.write(statePath, JSON.stringify({ ...prior, ...pixelsFor(size) }))
      })().catch(error => $.ui.log(`htmlspike: size write threw ${String(error)}`, { to: 'debug' }))
    })
    // Mounted from the first draw so blits have a target; the placeholder shows until the first frame.
    return (
      <Box flexDirection="column">
        <Image
          key="view"
          source={{ file: `${$.plugin.root}/renderer/placeholder.png`, format: 'png', generation: 0 }}
          columns={size.columns}
          rows={size.rows}
          alt={`${ALT} (${text})`}
        />
        {text === 'starting Chromium...' ? null : <Text dimColor>{text}</Text>}
      </Box>
    )
  })
}

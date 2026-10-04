import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import { packSpikeFrame, TICK_MS } from './loop'
import { DEFAULT_COLOR, packCells } from './raster'
import type { Cell } from './raster'

const PANE = 'office'
const opened = atom({ plugin: 'agents-office', key: 'opened' } as const, false)
const viewport = atom(
  { plugin: 'agents-office', key: 'viewport' } as const,
  { columns: 0, rows: 0 },
)
const tickCount = atom({ plugin: 'agents-office', key: 'tick' } as const, 0)
const agents = atom(
  { plugin: 'agents-office', key: 'agents' } as const,
  {} as Record<string, { id: string }>,
)

// Runs a hook body; a failure is logged to the debug log and never thrown.
const guard = async <T,>(
  $: EngineInterface,
  name: string,
  fallback: T,
  body: () => Promise<T> | T,
): Promise<T> => {
  try {
    return await body()
  } catch (error) {
    $.ui.log(`${name} failed: ${String(error)}`, { to: 'debug' })
    return fallback
  }
}

const tick = async ($: EngineInterface): Promise<void> => {
  const size = await read($, viewport)
  if (size.columns < 1 || size.rows < 1) return
  const n = await update($, tickCount, count => count + 1)
  const cells = packSpikeFrame(size.columns, size.rows, n)
  $.ui
    .blit({ requestId: PANE, key: 'office', cells })
    .catch(error => $.ui.log(`agents-office: blit threw ${String(error)}`, { to: 'debug' }))
}

// One frame loop per session.start; a hot reload drops the old environment's timers.
const startLoop = ($: EngineInterface): void => {
  $.clock.every(TICK_MS, () => {
    tick($).catch(error =>
      $.ui.log(`agents-office: tick threw ${String(error)}`, { to: 'debug' }),
    )
  })
}

const openOffice = async ($: EngineInterface): Promise<void> => {
  await $.ui.open({ id: PANE, title: 'Office' })
  await update($, opened, () => true)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await guard($, 'session.start', undefined, async () => {
      await $.command.register({
        name: 'office',
        description: 'Show the agents office pane',
      })
      startLoop($)
      // No unasked open: session.start input has only cwd, surface and
      // isInteractive, no fullscreen field (isFullscreen is on command.run
      // presentation and on the ui.render viewport only).
    })

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    await guard($, 'agent.spawn', undefined, async () => {
      const agentId = result.agentId
      if (agentId === undefined) return
      await update($, agents, current => ({ ...current, [agentId]: { id: agentId } }))
    })

    return result
  })

  on('command.run', { command: 'office' }, async $ =>
    guard($, 'command.run', { text: 'Office pane failed to open.' }, async () => {
      const wasOpened = await read($, opened)
      await openOffice($)

      return { text: wasOpened ? 'Office pane reopened.' : 'Office pane opened.' }
    }),
  )

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    if (e.surface !== 'terminal') {
      return (
        <Box flexDirection="column">
          <Text>Office needs the terminal surface.</Text>
        </Box>
      )
    }

    const { Raster } = $.ui.resolve(e)
    const columns = Math.max(1, e.props.bodyColumns)
    const rows = Math.max(1, e.props.scroll.bodyRows)
    // Drawing is pure: a state write inside the hook is denied. A timer closure
    // runs in its own dispatch, where the write is allowed (TODO.md D20).
    $.clock.after(0, () => {
      update($, viewport, current =>
        current.columns === columns && current.rows === rows ? current : { columns, rows },
      ).catch(error =>
        $.ui.log(`agents-office: viewport write threw ${String(error)}`, { to: 'debug' }),
      )
    })
    const floor: Cell = { ch: 0x2588, fg: 0x203040, bg: DEFAULT_COLOR }
    const cells = packCells(
      Array.from({ length: rows }, () => Array.from({ length: columns }, () => floor)),
    )

    return (
      <Box flexDirection="column">
        <Raster key="office" columns={columns} rows={rows} cells={cells} />
      </Box>
    )
  })
}

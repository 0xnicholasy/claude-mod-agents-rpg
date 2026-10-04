import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import { expire, onComplete, onSpawn, seedMain, syncList } from './agents'
import type { Roster } from './agents'
import { packSpikeFrame } from './loop'
import { DEFAULT_COLOR, packCells } from './raster'
import type { Cell } from './raster'
import { LIST_MS, TICK_MS } from './timing'

const PANE = 'office'
const opened = atom({ plugin: 'agents-office', key: 'opened' } as const, false)
const viewport = atom(
  { plugin: 'agents-office', key: 'viewport' } as const,
  { columns: 0, rows: 0 },
)
const tickCount = atom({ plugin: 'agents-office', key: 'tick' } as const, 0)
const agents = atom(
  { plugin: 'agents-office', key: 'agents' } as const,
  {} as Roster,
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

// Log de-dup cache for blit refusals, not drawn state: each distinct reason is logged once.
const loggedBlitDenies = new Set<string>()

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

// Drops expired agents; writes only when the roster changed.
const expireRoster = async ($: EngineInterface, now: number): Promise<void> => {
  const current = await read($, agents)
  if (expire(current, now) === current) return
  await update($, agents, roster => expire(roster, now))
}

// Adds agents $.agent.list() knows and the roster does not; writes only on change.
const refreshRoster = async ($: EngineInterface): Promise<void> => {
  const infos = await $.agent.list()
  const current = await read($, agents)
  if (syncList(current, infos) === current) return
  await update($, agents, roster => syncList(roster, infos))
}

const tick = async ($: EngineInterface): Promise<void> => {
  await expireRoster($, await $.clock.now())
  const size = await read($, viewport)
  if (size.columns < 1 || size.rows < 1) return
  const n = await update($, tickCount, count => count + 1)
  const cells = packSpikeFrame(size.columns, size.rows, n)
  $.ui
    .blit({ requestId: PANE, key: 'office', cells })
    .then(result => {
      if (result.deny === undefined) return
      // A refusal naming an unmounted pane means the pane is gone: stop ticking
      // until the next render writes the viewport again.
      if (/mounted/i.test(result.deny)) {
        update($, viewport, () => ({ columns: 0, rows: 0 })).catch(error =>
          $.ui.log(`agents-office: viewport reset threw ${String(error)}`, { to: 'debug' }),
        )
      }
      if (loggedBlitDenies.has(result.deny)) return
      loggedBlitDenies.add(result.deny)
      $.ui.log(`agents-office: blit refused ${result.deny}`, { to: 'debug' })
    })
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

const startRefresh = ($: EngineInterface): void => {
  $.clock.every(LIST_MS, () => {
    refreshRoster($).catch(error =>
      $.ui.log(`agents-office: agent.list refresh threw ${String(error)}`, { to: 'debug' }),
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
    // Separate guard: a failing agent.list must not stop the frame loop above.
    await guard($, 'session.start roster', undefined, async () => {
      await update($, agents, seedMain)
      await refreshRoster($)
      startRefresh($)
    })

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    await guard($, 'agent.spawn', undefined, async () => {
      if (result.agentId === undefined) return
      await update($, agents, roster => onSpawn(roster, e, result))
    })

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const agentId = e.agentId
    if (agentId !== undefined) {
      await guard($, 'turn.complete', undefined, async () => {
        const now = await $.clock.now()
        const current = await read($, agents)
        if (onComplete(current, agentId, now) === current) return
        await update($, agents, roster => onComplete(roster, agentId, now))
      })
    }

    return result
  })

  // The pane closed (plugin, person or unload-with-hooks): stop blitting until a render.
  on('ui.close', async ($, e, next) => {
    const result = await next(e)
    if (e.id === PANE) {
      await guard($, 'ui.close', undefined, async () => {
        await update($, viewport, () => ({ columns: 0, rows: 0 }))
      })
    }

    return result
  })

  on('command.run', { command: 'office' }, async $ =>
    guard($, 'command.run', { text: 'Office pane failed to open.' }, async () => {
      const wasOpened = await read($, opened)
      await openOffice($)

      return { text: wasOpened ? 'Office pane reopened.' : 'Office pane opened.' }
    }),
  )

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) =>
    guard(
      $,
      'ui.render',
      (() => {
        const { Text } = $.ui.resolve(e)
        return <Text>Office failed to draw.</Text>
      })(),
      async () => {
        const { Box, Text } = $.ui.resolve(e)
        if (e.surface !== 'terminal') {
          return (
            <Box flexDirection="column">
              <Text>Office needs the terminal surface.</Text>
            </Box>
          )
        }

        const { Raster } = $.ui.resolve(e)
        const columns = clamp(e.props.bodyColumns, 1, 512)
        const rows = clamp(e.props.scroll.bodyRows, 1, 256)
        // Drawing is pure: a state write inside the hook is denied. A timer closure
        // runs in its own dispatch, where the write is allowed (TODO.md D20).
        $.clock.after(0, () => {
          read($, viewport)
            .then(current =>
              current.columns === columns && current.rows === rows
                ? current
                : update($, viewport, () => ({ columns, rows })),
            )
            .catch(error =>
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
      },
    ),
  )
}

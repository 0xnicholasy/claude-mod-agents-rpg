import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import { expire, onComplete, onSpawn, seedMain, syncList } from './agents'
import type { Roster } from './agents'
import { buildFrame, placeMotion } from './frame'
import type { Bubble, Motion } from './frame'
import { mapFor, rasterSize } from './loop'
import { DEFAULT_COLOR, packCells } from './raster'
import type { Cell } from './raster'
import { LIST_MS, TICK_MS } from './timing'

const PANE = 'office'
const opened = atom({ plugin: 'agents-office', key: 'opened' } as const, false)
const viewport = atom(
  { plugin: 'agents-office', key: 'viewport' } as const,
  { columns: 0, rows: 0 },
)
const EMPTY_ROSTER: Roster = {}
const agents = atom({ plugin: 'agents-office', key: 'agents' } as const, EMPTY_ROSTER)
const EMPTY_MOTION: Motion = {}
const motion = atom({ plugin: 'agents-office', key: 'motion' } as const, EMPTY_MOTION)
const EMPTY_BUBBLES: Bubble[] = []
const bubbles = atom({ plugin: 'agents-office', key: 'bubbles' } as const, EMPTY_BUBBLES)

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

// Cache of the last packed frame handed to blit, not drawn state (D11): a tick
// whose frame equals it blits nothing. A reload or a new session resets it and
// costs one extra blit.
let lastFrameCells: string | null = null

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

// Seats agents that have no motion entry at their room's first free anchor, using
// the map of the mounted size; does nothing while no pane has reported a size.
const placeRoster = async ($: EngineInterface): Promise<void> => {
  const size = await read($, viewport)
  const map = mapFor(size.columns, size.rows)
  if (map === undefined) return
  const roster = await read($, agents)
  const current = await read($, motion)
  if (placeMotion(map, roster, current) === current) return
  await update($, motion, existing => placeMotion(map, roster, existing))
}

const tick = async ($: EngineInterface): Promise<void> => {
  const now = await $.clock.now()
  // Own guards: a failing expiry or placement must not stop the blit below.
  await guard($, 'expire', undefined, async () => expireRoster($, now))
  await guard($, 'place', undefined, async () => placeRoster($))
  const size = await read($, viewport)
  const map = mapFor(size.columns, size.rows)
  if (map === undefined) return
  const frame = buildFrame({
    map,
    agents: await read($, agents),
    motion: await read($, motion),
    bubbles: await read($, bubbles),
    now,
  })
  const cells = packCells(frame)
  if (cells === lastFrameCells) return
  lastFrameCells = cells
  $.ui
    .blit({ requestId: PANE, key: 'office', cells })
    .then(result => {
      if (result.deny === undefined) return
      // The frame did not land: repaint it on the next tick.
      lastFrameCells = null
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
    .catch(error => {
      lastFrameCells = null
      $.ui.log(`agents-office: blit threw ${String(error)}`, { to: 'debug' })
    })
}

type Timer = ReturnType<EngineInterface['clock']['every']>

// Timer handles, not drawn state: a repeated session.start in one environment
// cancels the previous timer so cadences never stack. A hot reload drops the
// old environment's timers on its own.
let loopTimer: Timer | undefined
let refreshTimer: Timer | undefined

const startLoop = ($: EngineInterface): void => {
  loopTimer?.cancel()
  lastFrameCells = null
  loopTimer = $.clock.every(TICK_MS, () => {
    tick($).catch(error =>
      $.ui.log(`agents-office: tick threw ${String(error)}`, { to: 'debug' }),
    )
  })
}

const startRefresh = ($: EngineInterface): void => {
  refreshTimer?.cancel()
  refreshTimer = $.clock.every(LIST_MS, () => {
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
    // Own guards: neither a failing first agent.list nor a failing seed may stop
    // the frame loop above or the 10 s refresh.
    await guard($, 'session.start refresh timer', undefined, async () => {
      startRefresh($)
    })
    await guard($, 'session.start roster', undefined, async () => {
      await update($, agents, seedMain)
      await refreshRoster($)
    })

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    await guard($, 'agent.spawn', undefined, async () => {
      if (result.agentId === undefined) return
      await update($, agents, roster => onSpawn(roster, e, result))
      await placeRoster($)
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
        const { columns, rows } = rasterSize(e.props.bodyColumns, e.props.scroll.bodyRows)
        // Drawing is pure: a state write inside the hook is denied. A timer closure
        // runs in its own dispatch, where the write is allowed (TODO.md D20).
        $.clock.after(0, () => {
          read($, viewport)
            .then(current => {
              if (current.columns === columns && current.rows === rows) return current
              lastFrameCells = null
              return update($, viewport, () => ({ columns, rows }))
            })
            .catch(error =>
              $.ui.log(`agents-office: viewport write threw ${String(error)}`, { to: 'debug' }),
            )
        })
        // Below the 60x18 map minimum there is nothing to lay out: a blank floor
        // keeps the Raster mounted (T11 replaces it with the widen line).
        const map = mapFor(columns, rows)
        const grid =
          map === undefined
            ? Array.from({ length: rows }, () =>
                Array.from({ length: columns }, (): Cell => ({ ch: 0x20, fg: DEFAULT_COLOR, bg: DEFAULT_COLOR })),
              )
            : buildFrame({
                map,
                agents: await read($, agents),
                motion: await read($, motion),
                bubbles: await read($, bubbles),
                now: await $.clock.now(),
              })
        const cells = packCells(grid)

        return (
          <Box flexDirection="column">
            <Raster key="office" columns={columns} rows={rows} cells={cells} />
          </Box>
        )
      },
    ),
  )
}

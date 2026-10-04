import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import { activityFor } from './activity'
import { expire, onActivity, onSpawn, seedMain, syncList } from './agents'
import type { Roster } from './agents'
import { advanceScripts, expireBubbles, startMeet, startReport } from './choreo'
import type { ChoreoState } from './choreo'
import { buildFrame, placeMotion } from './frame'
import type { Bubble, Motion } from './frame'
import { arrived, pushLog, reported, told } from './log'
import { mapFor, rasterSize } from './loop'
import { roomAt } from './map'
import type { OfficeMap } from './map'
import { assignTarget, enterAtDoor, step } from './motion'
import { packCells } from './raster'
import { LIST_MS, STRIP_ROWS, TICK_MS } from './timing'

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
const EMPTY_LOG: string[] = []
const log = atom({ plugin: 'agents-office', key: 'log' } as const, EMPTY_LOG)

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
const refreshRoster = async ($: EngineInterface): Promise<void> => {
  const infos = await $.agent.list()
  const current = await read($, agents)
  if (syncList(current, infos) === current) return
  await update($, agents, roster => syncList(roster, infos))
}

// Seats the given roster on the current map. The caller passes the roster it
// computed locally, so no atom just written is read back (same-dispatch
// snapshot). `entering` is a just-spawned agent that appears at the Lobby door
// and walks to its room (D34); `advance` moves every walker one tile (the tick).
// One write at most. Returns the motion it computed, or undefined with no map.
// Applies a roster reducer to the current atom value inside the updater (so concurrent
// hooks cannot drop each other's changes) and returns the value it produced. A reducer
// that returns the same reference writes nothing.
const applyRoster = async (
  $: EngineInterface,
  reduce: (roster: Roster) => Roster,
): Promise<Roster> => {
  const stored = await read($, agents)
  if (reduce(stored) === stored) return stored
  let next = stored
  await update($, agents, cur => {
    next = reduce(cur)
    return next
  })

  return next
}

// Writes the atoms a choreography step changed (D40). `base` is the triple the caller
// read (or computed locally, D31); `compute` runs exactly once on it (transitions are
// not idempotent, so it is never re-run after a partial commit). Each changed atom is
// then written with its computed value. Accepted v1 risk: last writer wins between
// dispatches; the 100 ms tick recomputes from current state, so a lost hook write
// loses only that one event's choreography. The three writes are not atomic.
const commitChoreo = async (
  $: EngineInterface,
  base: ChoreoState,
  compute: (state: ChoreoState) => ChoreoState,
): Promise<ChoreoState> => {
  const next = compute(base)
  if (next.agents !== base.agents) await update($, agents, () => next.agents)
  if (next.motion !== base.motion) await update($, motion, () => next.motion)
  if (next.bubbles !== base.bubbles) await update($, bubbles, () => next.bubbles)

  return next
}

// Appends lines to the strip log. The updater folds onto the current value, so lines
// written by concurrent dispatches are all kept (appends commute).
const pushLines = async ($: EngineInterface, lines: string[]): Promise<void> => {
  if (lines.length === 0) return
  await update($, log, cur => lines.reduce(pushLog, cur))
}

// Ids of agents whose walk ended in this step: one tile left in `cur`, none in `next`, standing
// on that tile. A reseat or a retarget is not an arrival (D45).
const arrivedIds = (cur: Motion, next: Motion): string[] =>
  Object.keys(next).filter(id => {
    const was = cur[id]
    const now = next[id]
    const last = was?.path[0]
    if (was === undefined || now === undefined || last === undefined) return false

    return was.path.length === 1 && now.path.length === 0 && now.x === last.x && now.y === last.y
  })

// Work walks only (D46): an agent under a script (meeting, report, Break Room) logs nothing.
const arrivalLines = (map: OfficeMap, roster: Roster, motions: Motion, ids: string[]): string[] =>
  ids.flatMap(id => {
    const agent = roster[id]
    const now = motions[id]
    if (agent === undefined || now === undefined || agent.script !== undefined) return []
    const name = map.rooms.find(room => room.id === roomAt(map, now.x, now.y))?.name

    return [arrived(agent.label, name ?? 'office')]
  })

// SendMessage: both agents walk to the Meeting Room (D38). `to` is `unknown` because
// the SendMessage input types it `unknown & unknown`; startMeet narrows it.
const meet = async ($: EngineInterface, from: string, to: unknown, text: string): Promise<void> => {
  const now = await $.clock.now()
  const size = await read($, viewport)
  const base: ChoreoState = {
    map: mapFor(size.columns, size.rows),
    agents: await read($, agents),
    motion: await read($, motion),
    bubbles: await read($, bubbles),
  }
  await commitChoreo($, base, state => startMeet(state, from, to, text, now))
  // `to` is narrowed like startMeet does; an unknown speaker or non-string target logs nothing.
  const speaker = base.agents[from]
  if (speaker === undefined || typeof to !== 'string') return
  const peer = base.agents[to] ?? Object.values(base.agents).find(a => a.label === to)
  if (peer?.id === speaker.id || to === from) return
  await pushLines($, [told(speaker.label, peer?.label ?? to, text)])
}

type SeatOptions = { entering?: string; advance?: boolean }
type SeatResult = { motion: Motion; arrived: string[] }

const seat = async (
  $: EngineInterface,
  roster: Roster,
  { entering, advance = false }: SeatOptions = {},
): Promise<SeatResult | undefined> => {
  const size = await read($, viewport)
  const map = mapFor(size.columns, size.rows)
  if (map === undefined) return undefined
  const arriving = entering === undefined ? undefined : roster[entering]
  const compute = (cur: Motion): Motion => {
    const entered = arriving === undefined ? cur : enterAtDoor(cur, map, arriving.id, arriving.room)
    const placed = placeMotion(map, roster, entered)

    return advance ? step(placed) : placed
  }
  // The read only gates the write; the written value is computed from the
  // updater's own current value, so concurrent tick and spawn dispatches
  // cannot drop each other's entries.
  const current = await read($, motion)
  let next = compute(current)
  if (next === current) return { motion: next, arrived: [] }
  // Arrivals come from the updater's own cur/next pair (A3), so a concurrent write cannot
  // make a walk's last step be missed or counted twice.
  let arrived: string[] = []
  await update($, motion, cur => {
    next = compute(cur)
    arrived = advance ? arrivedIds(cur, next) : []
    return next
  })

  return { motion: next, arrived }
}

const tick = async ($: EngineInterface): Promise<void> => {
  const now = await $.clock.now()
  const viewSize = await read($, viewport)
  const viewMap = mapFor(viewSize.columns, viewSize.rows)
  const roster = await guard($, 'expire', await read($, agents), async () => {
    // A finished agent leaves only from the Break Room (D15); motion is read once for it.
    const where = await read($, motion)
    return applyRoster($, cur => expire(cur, now, where, viewMap))
  })
  const seated = await guard($, 'place', undefined, async () => seat($, roster, { advance: true }))
  const placed = seated?.motion
  const size = await read($, viewport)
  const map = mapFor(size.columns, size.rows)
  if (map === undefined) {
    // No pane drawn: scripts cannot advance, but a shown bubble still expires.
    await guard($, 'bubbles', undefined, async () => {
      if (expireBubbles(await read($, bubbles), now) === (await read($, bubbles))) return
      await update($, bubbles, cur => expireBubbles(cur, now))
    })

    return
  }
  if (seated !== undefined) {
    const lines = arrivalLines(map, roster, seated.motion, seated.arrived)
    await guard($, 'log', undefined, async () => pushLines($, lines))
  }
  const before: ChoreoState = {
    map,
    agents: roster,
    motion: placed ?? (await read($, motion)),
    bubbles: await read($, bubbles),
  }
  const after = await guard($, 'choreo', before, async () =>
    commitChoreo($, before, state => advanceScripts(state, now)),
  )
  const frame = buildFrame({ map, agents: after.agents, motion: after.motion, bubbles: after.bubbles, now })
  const cells = packCells(frame)
  if (cells === lastFrameCells) return
  lastFrameCells = cells
  $.ui
    .blit({ requestId: PANE, key: 'office', cells })
    .then(async result => {
      if (result.deny === undefined) return
      lastFrameCells = null
      // The d.ts deny text lists several reasons without a stable code, so the
      // size captured at tick start decides: a changed viewport is a stale
      // frame (only lastFrameCells resets); the same size with a "mounted"
      // deny means nothing is mounted, so the viewport is zeroed.
      const latest = await read($, viewport)
      const sameSize = latest.columns === size.columns && latest.rows === size.rows
      if (sameSize && /mounted/i.test(result.deny)) {
        await update($, viewport, () => ({ columns: 0, rows: 0 }))
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
      const roster = await applyRoster($, cur => onSpawn(cur, e, result))
      await seat($, roster, { entering: result.agentId })
    })

    return result
  })

  // The activity is applied before next(e); nothing awaits after it, and a
  // failure in the pre-work is logged and never blocks the tool (D37).
  on('tool.call', async ($, e, next) => {
    await guard($, 'tool.call', undefined, async () => {
      const id = e.agentId ?? 'main'
      // SendMessage starts a meeting instead of the lobby talk activity (D38).
      if (e.tool === 'SendMessage') {
        await meet($, id, e.to, typeof e.message === 'string' ? e.message : '')
        return
      }
      const activity = activityFor(e.tool)
      const roster = await applyRoster($, cur => onActivity(cur, id, activity))
      const room = roster[id]?.room
      const size = await read($, viewport)
      const map = mapFor(size.columns, size.rows)
      if (room === undefined || map === undefined) return
      const current = await read($, motion)
      if (assignTarget(current, map, id, room) === current) return
      await update($, motion, cur => assignTarget(cur, map, id, room))
    })

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const agentId = e.agentId
    if (agentId !== undefined) {
      await guard($, 'turn.complete', undefined, async () => {
        // A subagent reports in the Lobby and leaves via the Break Room (T09); a teammate
        // only turns idle (D26). All computed locally and committed like meet() (D40).
        const now = await $.clock.now()
        const size = await read($, viewport)
        const base: ChoreoState = {
          map: mapFor(size.columns, size.rows),
          agents: await read($, agents),
          motion: await read($, motion),
          bubbles: await read($, bubbles),
        }
        const after = await commitChoreo($, base, state => startReport(state, agentId, now, e.reason))
        const started = after.agents[agentId]
        if (started?.script?.kind === 'report' && base.agents[agentId]?.script?.kind !== 'report') {
          await pushLines($, [reported(started.label, e.reason)])
        }
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
        if (map === undefined) {
          return (
            <Box flexDirection="column">
              <Text>Widen the pane for the office</Text>
            </Box>
          )
        }
        const grid = buildFrame({
          map,
          agents: await read($, agents),
          motion: await read($, motion),
          bubbles: await read($, bubbles),
          now: await $.clock.now(),
        })
        const cells = packCells(grid)
        // Newest five lines under the Raster; empty rows keep the height stable.
        const lines = await read($, log)
        const strip = Array.from({ length: STRIP_ROWS }, (_, i) => lines[i] ?? ' ')

        return (
          <Box flexDirection="column">
            <Raster key="office" columns={columns} rows={rows} cells={cells} />
            {strip.map((line, i) => (
              <Text key={`log-${i}`} dimColor wrap="truncate-end">
                {line}
              </Text>
            ))}
          </Box>
        )
      },
    ),
  )
}

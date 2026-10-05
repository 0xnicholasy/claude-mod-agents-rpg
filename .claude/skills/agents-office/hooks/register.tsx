import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import { activityFor } from './activity'
import { expire, markTool, migrateRoster, onActivity, onSpawn, seedMain, syncList } from './agents'
import type { Roster } from './agents'
import { advanceScripts, expireBubbles, startMeet, startReport } from './choreo'
import type { ChoreoState } from './choreo'
import { buildFrame, placeMotion } from './frame'
import type { Bubble, Motion } from './frame'
import { arrived, clean, pushLog, reported, told } from './log'
import { bodyRowsFor, INLINE_MAX_ROWS, mapFor, rasterSize } from './loop'
import { MIN_COLUMNS, MIN_ROWS, roomAt } from './map'
import type { OfficeMap, RoomId, TeamSpec } from './map'
import { assignTarget, enterAtDoor, step } from './motion'
import { inspectText, lastTextOf, nearest } from './inspect'
import { INITIAL_PAD, onPadInput } from './pad'
import type { PadState } from './pad'
import { settleEmote, spawnPlayer, startJump, stepPlayer } from './player'
import type { Player } from './player'
import { packCells } from './raster'
import { baseName, branchOf, teamLabel } from './team'
import { INSPECT_MS, LIST_MS, PAD_FOCUS_MS, TICK_MS } from './timing'

const PANE = 'office'
const PAD_KEY = 'pad-input'
const opened = atom({ plugin: 'agents-office', key: 'opened' } as const, false)
const viewport = atom(
  { plugin: 'agents-office', key: 'viewport' } as const,
  // `strip` is the number of log rows under the map; the tick needs it to place the inspect text (D39).
  { columns: 0, rows: 0 } as { columns: number; rows: number; strip?: number },
)
const EMPTY_ROSTER: Roster = {}
const agents = atom({ plugin: 'agents-office', key: 'agents' } as const, EMPTY_ROSTER)
const EMPTY_MOTION: Motion = {}
const motion = atom({ plugin: 'agents-office', key: 'motion' } as const, EMPTY_MOTION)
const EMPTY_BUBBLES: Bubble[] = []
const bubbles = atom({ plugin: 'agents-office', key: 'bubbles' } as const, EMPTY_BUBBLES)
const EMPTY_LOG: string[] = []
const log = atom({ plugin: 'agents-office', key: 'log' } as const, EMPTY_LOG)
// The own team (D12): its room is `id`. Null until session.start (or the first tick after a hot reload) writes it.
type Team = { id: `team:${string}`; label: string; branch: string; startedAt: number }
const NO_TEAM = null as Team | null
const team = atom({ plugin: 'agents-office', key: 'team' } as const, NO_TEAM)
// The pad Input's bookkeeping (D13): the value last handled, the value drawn, the newest movement intent.
const pad = atom({ plugin: 'agents-office', key: 'pad' } as const, INITIAL_PAD as PadState)

// The player avatar (D14); null until the first tick that has a map and a team.
const player = atom({ plugin: 'agents-office', key: 'player' } as const, null as Player | null)

// The inspect line (D39): which agent, the text and when it stops showing; null when nothing is inspected.
type Inspect = { agentId: string; text: string; until: number }
const inspect = atom({ plugin: 'agents-office', key: 'inspect' } as const, null as Inspect | null)

// Log de-dup cache for guard failures, not drawn state (D49): a hook that fails the same
// way every tick logs once per distinct name + message.
const loggedFailures = new Set<string>()

// Runs a hook body; a failure is logged to the debug log as `agents-office: <name> threw`
// (the line to grep the debug log for) and never thrown. The fallback may be a
// thunk so its work (e.g. $.ui.resolve) also runs inside the guard.
const guard = async <T,>(
  $: EngineInterface,
  name: string,
  fallback: T | (() => T),
  body: () => Promise<T> | T,
): Promise<T> => {
  try {
    return await body()
  } catch (error) {
    const message = String(error)
    const key = `${name}\u0000${message}`
    if (!loggedFailures.has(key)) {
      loggedFailures.add(key)
      try {
        $.ui.log(`agents-office: ${name} threw ${message}`, { to: 'debug' })
      } catch {
        // Logging must never throw out of a hook.
      }
    }
    return typeof fallback === 'function' ? (fallback as () => T)() : fallback
  }
}

// Logs `<name> <message>` to the debug log once per distinct pair; never throws.
const logOnce = ($: EngineInterface, name: string, message: string): void => {
  const key = `${name}\u0000${message}`
  if (loggedFailures.has(key)) return
  loggedFailures.add(key)
  try {
    $.ui.log(`agents-office: ${name} ${message}`, { to: 'debug' })
  } catch {
    // Logging must never throw out of a hook.
  }
}

// Log de-dup cache for blit refusals, not drawn state: each distinct reason is logged once.
const loggedBlitDenies = new Set<string>()

// Cache of the last packed frame handed to blit, not drawn state (D11): a tick
// whose frame equals it blits nothing. A reload or a new session resets it and
// costs one extra blit.
let lastFrameCells: string | null = null

// The own team's room: where every agent works. Before a team exists nothing can be seated at a desk,
// so Reception stands in until the first tick writes the team.
const homeRoom = async ($: EngineInterface): Promise<RoomId> => (await read($, team))?.id ?? 'reception'

// The teams `mapFor` lays out (only the own team until presence arrives) and the own team id.
const teamsOf = async ($: EngineInterface): Promise<{ teams: TeamSpec[]; ownId: string }> => {
  const own = await read($, team)

  return own === null ? { teams: [], ownId: '' } : { teams: [{ id: own.id, label: own.label }], ownId: own.id }
}

const mapAt = async ($: EngineInterface, columns: number, rows: number): Promise<OfficeMap | undefined> => {
  const { teams, ownId } = await teamsOf($)

  return mapFor(columns, rows, teams, ownId)
}

// Writes the own team from the session id and cwd (D12). Without `force` an existing team is kept, so
// the tick only fills it after a hot reload; session.start forces it because the session id is new.
const ensureTeam = async ($: EngineInterface, cwd: string | undefined, force: boolean): Promise<void> => {
  if (!force && (await read($, team)) !== null) return
  const sessionId = await $.session.id()
  const dir = cwd ?? (await $.session.cwd())
  const label = clean(baseName(dir))
  const startedAt = await $.clock.now()
  const next: Team = { id: `team:${sessionId}`, label, branch: '', startedAt }
  // Without `force` a team written meanwhile (session.start racing the tick) wins.
  await update($, team, cur => (force ? next : (cur ?? next)))
}

const GIT_TIMEOUT_MS = 3000

// Reads the branch (D12) and relabels the own team `basename (branch)`. A failed run keeps the basename.
const labelTeam = async ($: EngineInterface, cwd: string): Promise<void> => {
  const { exitCode, stdout } = await $.process.run(['git', '-C', cwd, 'branch', '--show-current'], { timeoutMs: GIT_TIMEOUT_MS })
  const ok = exitCode === 0
  const label = teamLabel(cwd, stdout, ok)
  const branch = branchOf(stdout, ok)
  await update($, team, cur => (cur === null ? cur : { ...cur, label, branch }))
}

// Drops expired agents; writes only when the roster changed.
const refreshRoster = async ($: EngineInterface): Promise<void> => {
  const infos = await $.agent.list()
  const home = await homeRoom($)
  const current = await read($, agents)
  if (syncList(current, infos, home) === current) return
  await update($, agents, roster => syncList(roster, infos, home))
}

// Seats the given roster on the current map. The caller passes the roster it
// computed locally, so no atom just written is read back (same-dispatch
// snapshot). `entering` is a just-spawned agent that appears at the Reception door
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

// Work walks only (D46): an agent under a script (meeting, report, Kitchen) logs nothing.
const arrivalLines = (map: OfficeMap, roster: Roster, motions: Motion, ids: string[]): string[] =>
  ids.flatMap(id => {
    const agent = roster[id]
    const now = motions[id]
    if (agent === undefined || now === undefined || agent.script !== undefined) return []
    const name = map.rooms.find(room => room.id === roomAt(map, now.x, now.y))?.name

    return [arrived(agent.label, name ?? 'office')]
  })

// SendMessage: both agents walk to the Conference Room (D38). `to` is `unknown` because
// the SendMessage input types it `unknown & unknown`; startMeet narrows it.
const meet = async ($: EngineInterface, from: string, to: unknown, text: string): Promise<void> => {
  const now = await $.clock.now()
  const size = await read($, viewport)
  const base: ChoreoState = {
    map: await mapAt($, size.columns, size.rows),
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
  const map = await mapAt($, size.columns, size.rows)
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

// Spawns the player once the own team exists, then steps it one tile for the pending tap (D13). The tick
// writes the `player` and `pad` atoms; render never does. Returns the player to draw.
const stepPlayerTick = async ($: EngineInterface, map: OfficeMap, now: number): Promise<Player | null> => {
  const own = await read($, team)
  const current = await read($, player)
  if (own === null) return current
  const padNow = await read($, pad)
  const intent = padNow.intent
  // A pending room jump sets the path first, so its first tile is walked this tick.
  const jumping = padNow.jump !== undefined && current !== null ? startJump(current, map, padNow.jump.dir) : current
  const out =
    jumping === null
      ? { player: spawnPlayer(map, own.id), intent }
      : stepPlayer(jumping, map, intent, now, own.id)
  const next = out.player === undefined ? undefined : settleEmote(out.player, padNow.emote, now)
  if (next !== undefined && next !== current) await update($, player, () => next)
  if (padNow.emote !== undefined && next !== undefined) {
    // Only the emote that was applied is cleared; a newer press stays for the next tick.
    const applied = padNow.emote
    await update($, pad, cur => (cur.emote?.at === applied.at && cur.emote.glyph === applied.glyph ? { ...cur, emote: undefined } : cur))
  }
  if (padNow.jump !== undefined && current !== null) {
    const applied = padNow.jump
    await update($, pad, cur => (cur.jump?.at === applied.at && cur.jump.dir === applied.dir ? { ...cur, jump: undefined } : cur))
  }
  if (out.intent !== undefined && intent !== undefined && out.intent !== intent) {
    // Only the taps this step consumed are removed, so a press that landed since the read is kept.
    const used = intent.taps - out.intent.taps
    const refreshed = out.intent.at
    await update($, pad, cur =>
      cur.intent === undefined || cur.intent.key !== intent.key || cur.epoch !== padNow.epoch
        ? cur
        : { ...cur, intent: { ...cur.intent, taps: Math.max(0, cur.intent.taps - used), at: Math.max(cur.intent.at, refreshed) } },
    )
  }

  return next ?? current
}

// `e` (D16, D39): finds the nearest agent within 2 tiles of the player and writes the `inspect` atom for
// INSPECT_MS; an expired line is cleared. Every roster agent belongs to this session until presence arrives
// (T16), so each one gets the tail of its last text; a messages deny or throw keeps the base text. Returns the
// line to show, or undefined.
// An `e` press older than this when the tick reaches it is dropped.
const INSPECT_PRESS_MS = 1000

const inspectTick = async ($: EngineInterface, map: OfficeMap, now: number, at: Player | null | undefined): Promise<string | undefined> => {
  const padNow = await read($, pad)
  const pending = padNow.inspect
  if (pending !== undefined && at !== null && at !== undefined) {
    await update($, pad, cur => (cur.inspect?.at === pending.at ? { ...cur, inspect: undefined } : cur))
    // A press that waited (no player or map yet) is stale, not a phantom inspect later.
    if (now - pending.at > INSPECT_PRESS_MS) return undefined
    const roster = await read($, agents)
    const target = nearest(roster, await read($, motion), at)
    let text = 'Nobody within 2 tiles.'
    if (target !== undefined) {
      let lastText: string | undefined
      try {
        const rows = target.id === 'main' ? await $.session.messages() : await $.session.messages({ agentId: target.id })
        if (Array.isArray(rows)) lastText = lastTextOf(rows)
      } catch (error) {
        $.ui.log(`agents-office: inspect messages threw ${String(error)}`, { to: 'debug' })
      }
      const roomName = map.rooms.find(room => room.id === target.room)?.name ?? target.room
      text = inspectText(target, roomName, now, { own: true, lastText })
    }
    await update($, inspect, () => ({ agentId: target?.id ?? '', text: clean(text), until: now + INSPECT_MS }))
  }
  const shown = await read($, inspect)
  if (shown === null) return undefined
  if (shown.until <= now) {
    await update($, inspect, () => null)

    return undefined
  }

  return shown.text
}

const tick = async ($: EngineInterface): Promise<void> => {
  const now = await $.clock.now()
  await guard($, 'team', undefined, async () => ensureTeam($, undefined, false))
  await guard($, 'migrate', undefined, async () => {
    const own = await read($, team)
    if (own === null) return
    const before = await read($, agents)
    const after = migrateRoster(before, own.id)
    if (after === before) return
    // A v1 agent stands where the v1 map had it; dropping its motion reseats it at its new desk.
    const moved = Object.keys(after).filter(id => after[id] !== before[id])
    await update($, agents, cur => migrateRoster(cur, own.id))
    await update($, motion, cur => Object.fromEntries(Object.entries(cur).filter(([id]) => !moved.includes(id))))
  })
  const viewSize = await read($, viewport)
  const viewMap = await mapAt($, viewSize.columns, viewSize.rows)
  const roster = await guard($, 'expire', await read($, agents), async () => {
    // A finished agent leaves only from the Kitchen (D15); motion is read once for it.
    const where = await read($, motion)
    return applyRoster($, cur => expire(cur, now, where, viewMap))
  })
  const seated = await guard($, 'place', undefined, async () => seat($, roster, { advance: true }))
  const placed = seated?.motion
  const size = await read($, viewport)
  const map = await mapAt($, size.columns, size.rows)
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
  const walker = await guard($, 'player', await read($, player), async () => stepPlayerTick($, map, now))
  const shown = await guard($, 'inspect', undefined, async () => inspectTick($, map, now, walker))
  const noStrip = (await read($, viewport)).strip === 0
  const frame = buildFrame({
    map,
    agents: after.agents,
    motion: after.motion,
    bubbles: after.bubbles,
    now,
    player: walker,
    overlay: noStrip ? shown : undefined,
  })
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
  // Without rows an inline pane opens a third of the terminal tall. The inline height
  // follows the tree, so this caps it; the render sizes itself from the viewport (D50).
  await $.ui.open({ id: PANE, title: 'Office', rows: INLINE_MAX_ROWS, columns: MIN_COLUMNS, focus: true })
  await update($, opened, () => true)
  // The Input is drawn only after the pane mounts, and a focus request before then is waited for only
  // briefly, so the pad takes focus after PAD_FOCUS_MS (spike S1b). A deny is logged once.
  $.clock.after(PAD_FOCUS_MS, () => {
    $.ui
      .focus({ requestId: PANE, key: PAD_KEY })
      .then(result => {
        if (result.deny !== undefined) logOnce($, 'pad focus', `denied: ${result.deny}`)
      })
      .catch(error => logOnce($, 'pad focus', String(error)))
  })
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
    await guard($, 'session.start team', undefined, async () => ensureTeam($, e.cwd, true))
    await guard($, 'session.start branch', undefined, async () => labelTeam($, e.cwd))
    await guard($, 'session.start refresh timer', undefined, async () => {
      startRefresh($)
    })
    await guard($, 'session.start roster', undefined, async () => {
      const home = await homeRoom($)
      await update($, agents, cur => seedMain(cur, home))
      await refreshRoster($)
    })

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    await guard($, 'agent.spawn', undefined, async () => {
      if (result.agentId === undefined) return
      const home = await homeRoom($)
      const roster = await applyRoster($, cur => onSpawn(cur, e, result, home))
      await seat($, roster, { entering: result.agentId })
    })

    return result
  })

  // The activity is applied before next(e); nothing awaits after it, and a
  // failure in the pre-work is logged and never blocks the tool (D37).
  on('tool.call', async ($, e, next) => {
    await guard($, 'tool.call', undefined, async () => {
      const id = e.agentId ?? 'main'
      // SendMessage starts a meeting instead of the Reception talk activity (D38).
      if (e.tool === 'SendMessage') {
        await meet($, id, e.to, typeof e.message === 'string' ? e.message : '')
        return
      }
      const activity = activityFor(e.tool)
      const seenAt = await $.clock.now()
      await applyRoster($, cur => markTool(cur, id, e.tool, seenAt))
      const roster = await applyRoster($, cur => onActivity(cur, id, activity))
      const room = roster[id]?.room
      const size = await read($, viewport)
      const map = await mapAt($, size.columns, size.rows)
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
        // A subagent reports in Reception and leaves via the Kitchen (T09); a teammate
        // only turns idle (D26). All computed locally and committed like meet() (D40).
        const now = await $.clock.now()
        const size = await read($, viewport)
        const base: ChoreoState = {
          map: await mapAt($, size.columns, size.rows),
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

  // Not a render, so it may write state (D20). Bursts are coalesced: onPadInput diffs the value.
  on('ui.input', { element: PAD_KEY }, async ($, e, next) => {
    await guard($, 'ui.input', undefined, async () => {
      if (e.kind !== 'change') return
      const now = await $.clock.now()
      await update($, pad, cur => onPadInput(cur, e.value, now))
    })

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) =>
    guard(
      $,
      'ui.render',
      () => {
        const { Text } = $.ui.resolve(e)
        return <Text>Office failed to draw.</Text>
      },
      async () => {
        const { Box, Text } = $.ui.resolve(e)
        if (e.surface !== 'terminal') {
          // Nothing is mounted off terminal, so zero the viewport (D48); a write
          // inside the hook is denied, so it runs in a timer closure (D20).
          $.clock.after(0, () => {
            read($, viewport)
              .then(current => {
                if (current.columns === 0 && current.rows === 0) return current
                return update($, viewport, () => ({ columns: 0, rows: 0 }))
              })
              .catch(error =>
                $.ui.log(`agents-office: viewport write threw ${String(error)}`, { to: 'debug' }),
              )
          })
          return (
            <Box flexDirection="column">
              <Text>Office needs the terminal surface.</Text>
            </Box>
          )
        }

        const { Raster, Input } = $.ui.resolve(e)
        const bodyRows = bodyRowsFor(e.props.placement, e.props.scroll.bodyRows, e.viewport?.rows)
        const { columns, rows, strip: stripCount } = rasterSize(e.props.bodyColumns, bodyRows)
        // Drawing is pure: a state write inside the hook is denied. A timer closure
        // runs in its own dispatch, where the write is allowed (TODO.md D20).
        $.clock.after(0, () => {
          read($, viewport)
            .then(current => {
              if (current.columns === columns && current.rows === rows && current.strip === stripCount) return current
              lastFrameCells = null
              return update($, viewport, () => ({ columns, rows, strip: stripCount }))
            })
            .catch(error =>
              $.ui.log(`agents-office: viewport write threw ${String(error)}`, { to: 'debug' }),
            )
        })
        // Below the minimum size draw only the size line (D48).
        const map = await mapAt($, columns, rows)
        if (map === undefined) {
          return (
            <Box flexDirection="column">
              <Text>
                {`Office needs a ${MIN_COLUMNS}x${MIN_ROWS} pane, this one is ${e.props.bodyColumns}x${bodyRows}. Widen or heighten the terminal.`}
              </Text>
            </Box>
          )
        }
        const inspected = await read($, inspect)
        const inspectLine = inspected !== null && inspected.until > (await $.clock.now()) ? inspected.text : undefined
        const grid = buildFrame({
          map,
          agents: await read($, agents),
          motion: await read($, motion),
          bubbles: await read($, bubbles),
          now: await $.clock.now(),
          player: await read($, player),
          overlay: stripCount === 0 ? inspectLine : undefined,
        })
        const cells = packCells(grid)
        // The newest `stripCount` lines under the Raster, oldest of them first (the log is
        // stored oldest first); empty rows keep the height stable.
        const lines = await read($, log)
        const newest = stripCount > 0 ? lines.slice(-stripCount) : []
        const strip = Array.from({ length: stripCount }, (_, i) => newest[i] ?? ' ')
        // The inspect line takes the newest strip row while it shows (D16).
        if (stripCount > 0 && inspectLine !== undefined) strip[stripCount - 1] = inspectLine

        const padState = await read($, pad)

        return (
          <Box flexDirection="column">
            {/* The pad (D13): a one-row Input over the bottom-left cell of the map. Its value alternates
                between '' and ' ' so the field is cleared after every event. The wrapper makes the map
                the Input's parent, so `bottom={0}` is the map's last row and never a strip line. */}
            <Box>
              <Raster key="office" columns={columns} rows={rows} cells={cells} />
              <Box position="absolute" bottom={0} left={0} width={2}>
                <Input key={PAD_KEY} value={padState.clear} submitLabel="" onSubmit={() => undefined} />
              </Box>
            </Box>
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

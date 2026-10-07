import { atom, read, update } from 'claude-code'
import type { EngineInterface, ProcessSpawnResult, Register } from 'claude-code'
import { activityFor } from './activity'
import { expire, markTool, migrateRoster, onActivity, onSpawn, seedMain, syncList } from './agents'
import type { Roster } from './agents'
import { advanceScripts, expireBubbles, startMeet, startReport } from './choreo'
import type { ChoreoState } from './choreo'
import { spawnCat, stepCat } from './cat'
import type { Cat } from './cat'
import { cropFrame, focusOf, overlaySpan, viewFor } from './camera'
import { buildFrame, hourOf, placeMotion } from './frame'
import type { Bubble, Motion } from './frame'
import { clampCells, newestFrame, parseLine, pixelsFor, shouldWrite, splitLines, stateText } from './bridge'
import type { WriteMark } from './bridge'
import { arrived, clean, interrupted, interruptFailed, nudged, nudgeFailed, pushLog, reported, told } from './log'
import { bodyRowsFor, INLINE_MAX_ROWS, mapFor, rasterSize } from './loop'
import { canStand, MID_FOOT, MIN_COLUMNS, MIN_ROWS, roomAt } from './map'
import type { Footprint, OfficeMap, RoomId, TeamSpec } from './map'
import { assignTarget, enterAtDoor, step } from './motion'
import { inspectText, lastTextOf, nearest, peekLines } from './inspect'
import { chatLine, CONFIRM_OPTIONS, INITIAL_PAD, isYes, NUDGE_TEXT, onPadInput, onPadSubmit } from './pad'
import {
  asScene,
  asShare,
  DEFAULT_SCENE,
  DEFAULT_SHARE,
  envValue,
  mergeRemote,
  orderedTeams,
  parseOfficeArgs,
  parseRecord,
  planReads,
  presenceDir,
  presencePath,
  PRESENCE_DIR_SUFFIX,
  remoteRoster,
  remotePlayersOf,
  routeRemote,
  SCENE_USAGE,
  SHARE_USAGE,
  signature,
  toPresencePlayer,
  toRecord,
  toTombstone,
  writeDue,
} from './presence'
import type { Parsed, Remote, SceneMode, ShareMode } from './presence'
import type { PadState } from './pad'
import { padRectAt, settleChat, settleEmote, spawnPlayer, startJump, stepPlayer } from './player'
import type { Player } from './player'
import { packCells } from './raster'
import { effectiveScene, initialLife, next as nextLife } from './rendererLife'
import type { Life, LifeEvent, Probe } from './rendererLife'
import { sceneKey, sceneOf } from './scene'
import { baseName, branchOf, teamLabel } from './team'
import { hashKey } from './sprites'
import { INSPECT_MS, LIST_MS, PAD_FOCUS_MS, PRESENCE_MS, TICK_MS } from './timing'

const PANE = 'office'
const PAD_KEY = 'pad-input'
const PEEK_PANE = 'office-peek'
// The Image's key inside the office pane (D6): the renderer's frames are blitted to it.
const SCENE_KEY = 'scene'
// Body rows the peek pane asks for: up to 10 message lines and a little room (D25).
const PEEK_ROWS = 12
const opened = atom({ plugin: 'agents-office', key: 'opened' } as const, false)
const viewport = atom(
  { plugin: 'agents-office', key: 'viewport' } as const,
  // `strip` is the number of log rows under the map; the tick needs it to place the inspect text (D39). `foot` is the
  // footprint the render drew (D57); a viewport written before it existed has none and counts as mid.
  { columns: 0, rows: 0 } as { columns: number; rows: number; strip?: number; foot?: Footprint },
)
// The footprint the motion, the player and the cat were last seated for; a change reseats them (D57). Null reads as mid.
const seatFoot = atom({ plugin: 'agents-office', key: 'seatFoot' } as const, null as Footprint | null)
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

// The office cat (D24): local to this pane, never published; null until the first tick that has a map.
const cat = atom({ plugin: 'agents-office', key: 'cat' } as const, null as Cat | null)

// The inspect line (D39): which agent, the text and when it stops showing; null when nothing is inspected.
type Inspect = { agentId: string; text: string; until: number }
const inspect = atom({ plugin: 'agents-office', key: 'inspect' } as const, null as Inspect | null)

// The peek pane's content (D25): the nearest own agent's last text messages, or one `Nothing to show` line.
type Peek = { agentId: string; label: string; lines: string[] }
const peek = atom({ plugin: 'agents-office', key: 'peek' } as const, null as Peek | null)

// The id of the main turn that is running (`turn.start`), null between turns; `x` aborts it after a Yes (D25).
const turnRef = atom({ plugin: 'agents-office', key: 'turn' } as const, null as string | null)

// True while a confirm dialog of `m` or `x` is open, so a second press cannot stack another one.
const asking = atom({ plugin: 'agents-office', key: 'asking' } as const, false)

// This session's presence identity (D17): the session id, its start time and the resolved presence dir.
// `dir` stays undefined until `printenv` resolves, or when both variables are empty; then nothing reads or writes.
type Identity = { sessionId: string; startedAt: number; dir?: string }
const identity = atom({ plugin: 'agents-office', key: 'identity' } as const, null as Identity | null)

// The share preference (D19), mirrored from `$.store` key `share`.
const share = atom({ plugin: 'agents-office', key: 'share' } as const, DEFAULT_SHARE as ShareMode)

// The scene preference and what the pane draws (D10), `want` mirrored from `$.store` key `scene`. `effective` is
// decided by `effectiveScene`: `probe` while `auto` waits for the placeholder blit (D11), then `image` or `text`.
type SceneState = { want: SceneMode; effective: 'probe' | 'image' | 'text'; reason?: string }
const scene = atom({ plugin: 'agents-office', key: 'scene' } as const, { want: DEFAULT_SCENE, effective: 'text' } as SceneState)

// The renderer child's life (D12), driven by the pure `rendererLife` machine.
const renderer = atom({ plugin: 'agents-office', key: 'renderer' } as const, initialLife as Life)

// The publisher's bookkeeping (D18): the record text last written (without its heartbeat), when, and whether
// the tombstone is out. No file paths or other text live here.
// `mtimes` is the reader's: the mtime of each foreign file when it was last read (T15).
type PresenceState = { lastText?: string; lastWriteAt: number; ended: boolean; mtimes?: Record<string, number> }
const presence = atom({ plugin: 'agents-office', key: 'presence' } as const, { lastWriteAt: 0, ended: false } as PresenceState)

// Other sessions' records keyed by sessionId (D20).
const remote = atom({ plugin: 'agents-office', key: 'remote' } as const, {} as Remote)

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
  if (own === null) return { teams: [], ownId: '' }

  // The published `startedAt` is the identity's, so every pane orders this session the same way.
  const started = (await read($, identity))?.startedAt ?? own.startedAt

  return { teams: orderedTeams({ ...own, startedAt: started }, await read($, remote)), ownId: own.id }
}

// The other sessions' agents as roster entries keyed `sessionId:agentId` (D20); never part of the own roster, so
// they are never expired or choreographed locally.
const remoteAgentsOf = async ($: EngineInterface): Promise<Roster> => remoteRoster(await read($, remote))

const mapAt = async ($: EngineInterface, columns: number, rows: number): Promise<OfficeMap | undefined> => {
  const { teams } = await teamsOf($)

  return mapFor(columns, rows, teams)
}

// The footprint of the map the pane draws, for the hook calls that have no map of their own (D67): the render's own
// record, mid before one exists.
const footOf = async ($: EngineInterface): Promise<Footprint> => (await read($, viewport)).foot ?? MID_FOOT

// A footprint change (only a pre-D72 stored 3x2 footprint after a reload still differs) drops every motion entry so `seat` places the agents at the new
// layout's desks, clears the player's path (or respawns a player who no longer stands) and respawns the cat (D57).
const reseatOnFootChange = async ($: EngineInterface, map: OfficeMap): Promise<void> => {
  const last = (await read($, seatFoot)) ?? MID_FOOT
  if (last.w === map.foot.w && last.h === map.foot.h) return
  await update($, motion, () => ({}))
  await update($, cat, () => null)
  await update($, player, cur => (cur === null || !canStand(map, cur.x, cur.y) ? null : { ...cur, path: [] }))
  // Last, so a denied write above is retried by the next tick.
  await update($, seatFoot, () => map.foot)
}

// A render that awaits (a bigger frame takes longer) can still be dispatching when the 0 ms timer fires, and the host
// denies a state write made then. A denied write is retried after VIEWPORT_RETRY_MS, up to VIEWPORT_RETRIES times;
// without it the viewport stayed unwritten at 120x40, the tick saw no pane and the office drew empty (F08 LIVE, D69).
const VIEWPORT_RETRY_MS = 50
const VIEWPORT_RETRIES = 6
// The newest request's number: a retry of an older request drops itself (a pure cache, like lastFrameCells).
let viewportRequest = 0
const writeViewport = ($: EngineInterface, next: { columns: number; rows: number; strip: number; foot: Footprint }, attempt = 0, request = ++viewportRequest): void => {
  $.clock.after(attempt === 0 ? 0 : VIEWPORT_RETRY_MS, () => {
    if (request !== viewportRequest) return
    read($, viewport)
      .then(current => {
        if (request !== viewportRequest) return current
        if (current.columns === next.columns && current.rows === next.rows && current.strip === next.strip && current.foot?.w === next.foot.w && current.foot.h === next.foot.h) return current
        lastFrameCells = null
        return update($, viewport, () => next)
      })
      .catch(error => {
        if (attempt < VIEWPORT_RETRIES) {
          writeViewport($, next, attempt + 1, request)
          return
        }
        $.ui.log(`agents-office: viewport write threw ${String(error)}`, { to: 'debug' })
      })
  })
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

// Runs `printenv <name>`; a failed run or an unset variable gives ''.
const envOf = async ($: EngineInterface, name: string): Promise<string> => {
  const { exitCode, stdout } = await $.process.run(['printenv', name], { timeoutMs: GIT_TIMEOUT_MS })

  return envValue(stdout, exitCode === 0)
}

// Fills the identity atom (D17): session id, start time and the presence dir from CLAUDE_CONFIG_DIR / HOME.
const resolveIdentity = async ($: EngineInterface): Promise<void> => {
  const sessionId = await $.session.id()
  const startedAt = await $.clock.now()
  const config = await envOf($, 'CLAUDE_CONFIG_DIR')
  const home = await envOf($, 'HOME')
  const dir = presenceDir(config, home)
  await update($, identity, () => ({ sessionId, startedAt, ...(dir === undefined ? {} : { dir }) }))
}

// Loads the stored share preference into the atom (D19).
const loadShare = async ($: EngineInterface): Promise<void> => {
  const stored = await $.store.get('share')
  await update($, share, () => asShare(stored))
}

// Loads the stored scene preference into the atom (D10). Nothing stored is `auto`: the render probes (D11).
const loadScene = async ($: EngineInterface): Promise<void> => {
  const want = asScene(await $.store.get('scene'))
  const life = await read($, renderer)
  await update($, scene, () => sceneFor(want, life))
}

// Writes the tombstone once (D18); a no-op without a presence file path or when it is already out.
const writeTombstone = async ($: EngineInterface): Promise<void> => {
  const id = await read($, identity)
  const path = id?.dir === undefined ? undefined : presencePath(id.dir, id.sessionId)
  if (id === null || path === undefined) return
  if ((await read($, presence)).ended) return
  const now = await $.clock.now()
  await $.fs.write(path, JSON.stringify(toTombstone(id.sessionId, now)))
  await update($, presence, cur => ({ ...cur, lastWriteAt: now, ended: true }))
}

// The publishing half of the 1 s presence step (D18): writes the record when it changed or 3000 ms after
// the last write. Nothing is written before the dir resolves.
const publishTick = async ($: EngineInterface): Promise<void> => {
  const id = await read($, identity)
  const path = id?.dir === undefined ? undefined : presencePath(id.dir, id.sessionId)
  if (id === null || path === undefined) return
  const mode = await read($, share)
  if (mode === 'off') return
  const own = await read($, team)
  if (own === null) return
  const now = await $.clock.now()
  const size = await read($, viewport)
  const map = await mapAt($, size.columns, size.rows)
  const mine = await read($, player)
  const record = toRecord({
    player: map === undefined || mine === null ? null : toPresencePlayer(map, mine, now),
    sessionId: id.sessionId,
    startedAt: id.startedAt,
    now,
    share: mode,
    team: { label: own.label, branch: own.branch },
    roster: await read($, agents),
  })
  const text = signature(record)
  const state = await read($, presence)
  if (!writeDue(state.lastText, state.lastWriteAt, text, now)) return
  // A tick that was running when session.end cancelled the timer must not write after the tombstone.
  if (presenceTimer === undefined) return
  await $.fs.write(path, JSON.stringify(record))
  await update($, presence, cur => ({ ...cur, lastText: text, lastWriteAt: now, ended: false }))
}

// The reading half (T15): lists the dir, reads only the files whose mtime changed and folds them into the
// `remote` atom. A file that cannot be read or parsed keeps the last good snapshot. With share `off` nothing is
// read and the snapshot is cleared.
const readTick = async ($: EngineInterface): Promise<void> => {
  const id = await read($, identity)
  if (id?.dir === undefined) return
  const state = await read($, presence)
  const known = state.mtimes ?? {}
  if ((await read($, share)) === 'off') {
    if (Object.keys(known).length > 0) await update($, presence, cur => ({ ...cur, mtimes: {} }))
    if (Object.keys(await read($, remote)).length > 0) await update($, remote, () => ({}))
    return
  }
  const now = await $.clock.now()
  const plan = planReads(await $.fs.list(id.dir), id.sessionId, known, now)
  const parsed: Record<string, Parsed | null> = {}
  const mtimes: Record<string, number> = {}
  for (const file of plan.listed) {
    const old = known[file]
    if (old !== undefined) mtimes[file] = old
  }
  for (const file of plan.toRead) {
    try {
      parsed[file.sessionId] = parseRecord(await $.fs.read(`${id.dir}/${file.name}`)) ?? null
    } catch {
      // A file that vanished or is unreadable keeps the snapshot and is retried on the next tick.
      continue
    }
    mtimes[file.sessionId] = file.mtimeMs
  }
  // Sharing may have been turned off while the files were read.
  if ((await read($, share)) === 'off') return
  const prev = await read($, remote)
  const next = mergeRemote(prev, parsed, now, plan.listed)
  if (next !== prev) await update($, remote, () => next)
  if (JSON.stringify(mtimes) !== JSON.stringify(known)) await update($, presence, cur => ({ ...cur, mtimes }))
}

// The 1 s presence step: `off` writes one tombstone and reads nothing; otherwise publish, then read. Each half
// has its own guard so a failing write cannot stop the reader.
const presenceTick = async ($: EngineInterface): Promise<void> => {
  if ((await read($, share)) === 'off') {
    await guard($, 'presence tombstone', undefined, async () => writeTombstone($))
    await guard($, 'presence read', undefined, async () => readTick($))
    return
  }
  await guard($, 'presence write', undefined, async () => publishTick($))
  await guard($, 'presence read', undefined, async () => readTick($))
}

// Removes presence files untouched for a day (D18). Only inside a dir named `.../agents-office/presence`,
// and never while sharing is off (an off session neither reads nor writes). A missing dir just exits non-zero.
const cleanPresence = async ($: EngineInterface): Promise<void> => {
  const id = await read($, identity)
  if (id?.dir === undefined || !id.dir.endsWith(PRESENCE_DIR_SUFFIX)) return
  if ((await read($, share)) === 'off') return
  await $.process.run(['find', id.dir, '-maxdepth', '1', '-type', 'f', '-name', '*.json', '-mmin', '+1440', '-delete'], { timeoutMs: GIT_TIMEOUT_MS })
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
  const remoteAgents = await remoteAgentsOf($)
  const everyone: Roster = { ...roster, ...remoteAgents }
  const compute = (cur: Motion): Motion => {
    const entered = arriving === undefined ? cur : enterAtDoor(cur, map, arriving.id, arriving.room)
    const placed = routeRemote(placeMotion(map, everyone, entered), map, remoteAgents)

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
const stepPlayerTick = async ($: EngineInterface, map: OfficeMap, now: number, pane: { columns: number; rows: number }): Promise<Player | null> => {
  const own = await read($, team)
  const current = await read($, player)
  if (own === null) return current
  const padNow = await read($, pad)
  const intent = padNow.intent
  // The pad's Input sits at the bottom-left of the view, so its cells are the view's, not the map's (D63).
  const padCells = padRectAt(viewFor(map.columns, map.rows, pane.columns, pane.rows, focusOf(map, current, own.id)))
  // A pending room jump sets the path first, so its first tile is walked this tick.
  const jumping = padNow.jump !== undefined && current !== null ? startJump(current, map, padNow.jump.dir, padCells) : current
  const out =
    jumping === null
      ? { player: spawnPlayer(map, own.id, padCells), intent }
      : stepPlayer(jumping, map, intent, now, own.id, padCells)
  const next = out.player === undefined ? undefined : settleChat(settleEmote(out.player, padNow.emote, now), padNow.chat, now)
  if (next !== undefined && next !== current) await update($, player, () => next)
  if (padNow.emote !== undefined && next !== undefined) {
    // Only the emote that was applied is cleared; a newer press stays for the next tick.
    const applied = padNow.emote
    await update($, pad, cur => (cur.emote?.at === applied.at && cur.emote.glyph === applied.glyph ? { ...cur, emote: undefined } : cur))
  }
  if (padNow.chat !== undefined && next !== undefined) {
    const sent = padNow.chat
    await update($, pad, cur => (cur.chat?.at === sent.at && cur.chat.text === sent.text ? { ...cur, chat: undefined } : cur))
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
    const target = nearest(roster, await read($, motion), at, undefined, map.foot)
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

// Seats the cat on a shared-room spot (seeded from the own team id), then steps it one tile (D24). The tick writes
// the `cat` atom only when the cat changed. Returns the cat to draw.
const catTick = async ($: EngineInterface, map: OfficeMap, now: number): Promise<Cat | null> => {
  const current = await read($, cat)
  const seed = hashKey((await read($, team))?.id ?? 'office')
  const next = current === null ? spawnCat(map, seed, now) : stepCat(current, map, now)
  if (next === undefined) return current
  if (next !== current) await update($, cat, () => next)

  return next
}

// `E` (D25), called from the ui.input hook: finds the nearest agent within 2 tiles among this session's own roster (a remote agent is never in
// it), writes the `peek` atom and opens `office-peek` without focus, so the pad keeps the keys. A messages deny or
// throw, or no text, shows `Nothing to show for <label>.`. Nobody in range shows the inspect line instead.
const peekTick = async ($: EngineInterface, now: number, at: Player | null | undefined, foot: Footprint): Promise<void> => {
  const pending = (await read($, pad)).peek
  if (pending === undefined || at === null || at === undefined) return
  await update($, pad, cur => (cur.peek?.at === pending.at ? { ...cur, peek: undefined } : cur))
  if (now - pending.at > INSPECT_PRESS_MS) return
  const target = nearest(await read($, agents), await read($, motion), at, undefined, foot)
  if (target === undefined) {
    await update($, inspect, () => ({ agentId: '', text: 'Nobody within 2 tiles.', until: now + INSPECT_MS }))
    return
  }
  const label = clean(target.label)
  let lines: string[] = []
  try {
    const rows = target.id === 'main' ? await $.session.messages() : await $.session.messages({ agentId: target.id })
    if (Array.isArray(rows)) lines = peekLines(rows)
  } catch (error) {
    $.ui.log(`agents-office: peek messages threw ${String(error)}`, { to: 'debug' })
  }
  if (lines.length === 0) lines = [`Nothing to show for ${label}.`]
  await update($, peek, () => ({ agentId: target.id, label, lines }))
  const opened = await $.ui.open({ id: PEEK_PANE, title: `Peek: ${label}`, rows: PEEK_ROWS })
  if ('reason' in opened && opened.reason !== undefined) logOnce($, 'peek open', String(opened.reason))
}

// Asks `question` with No first; `act` runs only when the answer is exactly Yes. A dismissed dialog rejects and a
// throw from `act` is logged to the strip by `failed`; neither reaches the session. One dialog at a time.
const confirmThen = async (
  $: EngineInterface,
  question: string,
  act: () => Promise<string>,
  failed: string,
): Promise<void> => {
  // One update claims the flag, so two presses cannot both see it free.
  let wasAsking = false
  await update($, asking, cur => {
    wasAsking = cur

    return true
  })
  if (wasAsking) return
  try {
    let answer = 'No'
    try {
      answer = await $.ui.ask(question, CONFIRM_OPTIONS)
    } catch (error) {
      $.ui.log(`agents-office: confirm dismissed ${String(error)}`, { to: 'debug' })
    }
    if (!isYes(answer)) return
    try {
      await pushLines($, [await act()])
    } catch (error) {
      $.ui.log(`agents-office: confirmed action threw ${String(error)}`, { to: 'debug' })
      await pushLines($, [failed])
    }
  } finally {
    await update($, asking, () => false)
  }
}

// `m` and `x` (D25), called from the ui.input hook like the peek. `m` nudges the nearest own non-main agent within 2
// tiles (a remote agent is never in the roster), `x` interrupts main; each only after a confirm dialog answers Yes.
// The dialog is not awaited by the hook, so the pad keeps working while it is open.
const confirmTick = async ($: EngineInterface, now: number, at: Player | null | undefined, foot: Footprint): Promise<void> => {
  const { nudge, interrupt } = await read($, pad)
  if (nudge === undefined && interrupt === undefined) return
  // Clear only the presses read here, so one that landed meanwhile is kept.
  await update($, pad, cur => ({
    ...cur,
    nudge: cur.nudge?.at === nudge?.at ? undefined : cur.nudge,
    interrupt: cur.interrupt?.at === interrupt?.at ? undefined : cur.interrupt,
  }))
  // Both keys in one burst is ambiguous, and a press that waited too long is stale: ask nothing.
  if (nudge !== undefined && interrupt !== undefined) return
  if (interrupt !== undefined) {
    if (now - interrupt.at > INSPECT_PRESS_MS) return
    // The turn running at the press is the one to abort; a turn that began or ended during the dialog is not.
    const pressed = await read($, turnRef)
    void confirmThen(
      $,
      'Interrupt main?',
      async () => {
        if (pressed === null) return 'Interrupt skipped: no turn is running'
        await $.turn.abort({ turnId: pressed })

        return interrupted()
      },
      interruptFailed(),
    )
    return
  }
  if (nudge === undefined || now - nudge.at > INSPECT_PRESS_MS) return
  if (at === null || at === undefined) return
  // Main and finished agents are never nudged (a finished subagent would be resumed), and are skipped before the
  // nearest search so a subagent beside main is still found.
  const roster = Object.fromEntries(
    Object.entries(await read($, agents)).filter(([id, agent]) => id !== 'main' && (agent.status === 'working' || agent.status === 'idle')),
  )
  const target = nearest(roster, await read($, motion), at, undefined, foot)
  if (target === undefined) return
  const label = clean(target.label)
  void confirmThen(
    $,
    `Nudge ${label}?`,
    async () => {
      const sent = await $.session.send({ to: { agentId: target.id }, text: NUDGE_TEXT })
      if ('isDelivered' in sent && !sent.isDelivered) return nudgeFailed(label)

      return nudged(label)
    },
    nudgeFailed(label),
  )
}

// ---- The renderer child (T12, D5, D6, D12) ---------------------------------------------------------
type ChildStream = ReturnType<EngineInterface['process']['spawn']>

// The running renderer's handle and the writer's bookkeeping, not drawn state (D12): one per session, like the
// timer handles. `child` is the stream whose `return()` ends the node process; `stateDir` is the private dir this
// loop made and removes; `seq` and `mark` pace the `state.json` writes (D7). `whenClosed` settles when a stop is
// asked, so the read loop never waits on an idle child to notice it (a queued `return()` would wait too).
type RendererLoop = {
  closed: boolean
  child?: ChildStream
  stateDir?: string
  seq: number
  mark?: WriteMark
  whenClosed: Promise<undefined>
  close: () => void
}
let rendererLoop: RendererLoop | undefined

const OUTPUT_TAIL = 4000
const STATE_DIR_TEMPLATE = 'agents-office-state.XXXXXX'
const STATE_DIR_MARK = 'agents-office-state.'
const STATE_FILE = 'state.json'

// One debug line per renderer event that ends or stops a loop, so a stop always has a reason in the log.
const rendererLog = ($: EngineInterface, message: string): void => {
  try {
    $.ui.log(`agents-office: renderer ${message}`, { to: 'debug' })
  } catch {
    // Logging must never throw out of a hook.
  }
}

// Ends the child: `$.ui.close` alone does not stop it, only `return()` on its stream does (D12). Safe to call twice.
// `return()` is not awaited: behind a pending `next()` of an idle child it may not settle until the child writes, and
// the loop must still reach its cleanup (the renderer's own watchdog ends a child that return() never reached).
const endChild = ($: EngineInterface, loop: RendererLoop): void => {
  const child = loop.child
  if (child === undefined) return
  loop.child = undefined
  const ended: ProcessSpawnResult = { code: null, signal: null }
  child.return(ended).catch(error => rendererLog($, `return threw ${String(error)}`))
}

// Asks the running loop to end (the pane closed, or the scene changed); the loop ends the child and logs its exit.
const stopRenderer = ($: EngineInterface, why: string): void => {
  const loop = rendererLoop
  if (loop === undefined) return
  rendererLog($, `stop requested by ${why}`)
  loop.close()
}

// Runs a command by `$.process.spawn` until it ends and returns its stdout and exit code.
const spawnOut = async ($: EngineInterface, argv: readonly string[]): Promise<{ stdout: string; code: number | null }> => {
  let stdout = ''
  const stream = $.process.spawn({ argv })
  for (;;) {
    const step = await stream.next()
    if (step.done === true) return { stdout, code: step.value.code }
    if (step.value.stream === 'stdout') stdout += step.value.text
  }
}

// Feeds one event to the `renderer` atom and returns the life it produced.
const lifeEvent = async ($: EngineInterface, event: LifeEvent): Promise<Life> => {
  const now = await $.clock.now()
  let after: Life = initialLife
  await update($, renderer, cur => {
    after = nextLife(cur, event, now)

    return after
  })

  return after
}

// The scene state for a wish before any probe ran: `auto` waits at `probe`, `image` draws, `text` is v2.
const sceneFor = (want: SceneMode, life: Life): SceneState => {
  const { effective, reason } = effectiveScene(want, { kind: 'pending' }, life)

  return { want, effective, ...(reason === undefined ? {} : { reason }) }
}

const REASON_MS = 8000

// Says why the pane fell back to text, once: a log line, and the overlay line for 8 s (D17).
const announceReason = async ($: EngineInterface, reason: string): Promise<void> => {
  const now = await $.clock.now()
  await pushLines($, [clean(reason)])
  await update($, inspect, () => ({ agentId: '', text: clean(reason), until: now + REASON_MS }))
}

// Decides the scene again from a probe result and the renderer life. Only a pane still drawing a scene is touched, so
// a stale probe or loop never undoes `/office scene text`. A switch to text with a reason announces it once.
const settleScene = async ($: EngineInterface, probe: Probe): Promise<void> => {
  const life = await read($, renderer)
  let announce: string | undefined
  await update($, scene, (cur): SceneState => {
    // `update` may run this again after a lost race; only the last run decides whether to announce.
    announce = undefined
    if (cur.effective === 'text') return cur
    const { effective, reason } = effectiveScene(cur.want, probe, life)
    if (effective === cur.effective && reason === cur.reason) return cur
    if (effective === 'text') announce = reason

    return { want: cur.want, effective, ...(reason === undefined ? {} : { reason }) }
  })
  if (announce !== undefined) await announceReason($, announce)
}

// The fallback reason for a command reply: empty unless the text office is showing because the image scene was wanted.
const reasonSuffix = async ($: EngineInterface): Promise<string> => {
  const cur = await read($, scene)

  return cur.want !== 'text' && cur.effective === 'text' && cur.reason !== undefined ? ` ${cur.reason}` : ''
}

// Switches the pane to the v2 text office after a failure (a failed life or a refused blit), with the reason.
const fallToText = async ($: EngineInterface, probe: Probe): Promise<void> => settleScene($, probe)

// The probe (D11): a blit of the placeholder as a file source onto the mounted `scene` Image. Accepted means the
// terminal can draw pictures; any other deny (the alt case, a file it cannot read) means text, and nothing is spawned.
// A deny that only says nothing is mounted yet, or a changed pane size, is tried again a few times. Runs in a timer
// closure because a render cannot write state (D20); one at a time.
const PROBE_TRIES = 5
const PROBE_RETRY_MS = 200
let probing = false

const runProbe = async ($: EngineInterface): Promise<void> => {
  for (let attempt = 0; attempt < PROBE_TRIES; attempt++) {
    if ((await read($, scene)).effective !== 'probe') return
    const sized = await read($, viewport)
    let deny: string | undefined
    let threw = false
    try {
      const result = await $.ui.blit({
        requestId: PANE,
        key: SCENE_KEY,
        source: { file: `${$.plugin.root}/renderer/placeholder.png`, format: 'png', generation: 0 },
      })
      deny = result.deny
    } catch (error) {
      // An exception is not a deny (D11): the engine may be closing, so it retries like "not mounted".
      deny = String(error)
      threw = true
    }
    if (deny === undefined) {
      await settleScene($, { kind: 'ok' })
      return
    }
    if (!threw && (await isFinalDeny($, deny, sized))) {
      await settleScene($, { kind: 'denied', reason: deny })
      return
    }
    // "No Image of its own is mounted" and a changed size are never a verdict: the scene stays at `probe`, and the
    // next render probes again if the retries below ran out.
    logOnce($, 'probe', `blit refused, trying again (${deny})`)
    await new Promise<void>(resolve => {
      $.clock.after(PROBE_RETRY_MS, () => resolve())
    })
  }
}

// When every try was refused as "not mounted" the scene stays at `probe`; a later round (1 s on, at most 5) tries again,
// and a render starts a fresh set of rounds.
const PROBE_ROUNDS = 5
const startProbe = ($: EngineInterface, delay: number, round: number): void => {
  probing = true
  $.clock.after(delay, () => {
    runProbe($)
      .catch(error => logOnce($, 'probe', `threw ${String(error)}`))
      .then(() => read($, scene))
      .then(cur => {
        if (cur.effective === 'probe' && round < PROBE_ROUNDS) startProbe($, 1000, round + 1)
        else probing = false
      })
      .catch(() => {
        probing = false
      })
  })
}

const scheduleProbe = ($: EngineInterface): void => {
  if (probing) return
  startProbe($, 0, 1)
}

// A scene change from the render itself (no Image element on this terminal): written in a timer closure (D20).
const denyFromRender = ($: EngineInterface, reason: string): void => {
  $.clock.after(0, () => {
    settleScene($, { kind: 'denied', reason }).catch(error => logOnce($, 'scene', `settle threw ${String(error)}`))
  })
}

// The same refusal handling as the v2 Raster blit: a changed viewport is a stale frame and a "mounted" deny means
// nothing is drawn yet, so both only log and the next frame retries; the same size with any other deny is final.
const isFinalDeny = async ($: EngineInterface, deny: string, size: { columns: number; rows: number }): Promise<boolean> => {
  const latest = await read($, viewport)
  const sameSize = latest.columns === size.columns && latest.rows === size.rows

  return sameSize && !/mounted/i.test(deny)
}

// One renderer from start to end: makes the private state dir, spawns node, turns its stdout into Image blits and
// life events, and always ends the child and removes the dir it made. Leaving the read loop by any path runs `return()`
// and logs why the loop ended.
const runRenderer = async ($: EngineInterface, loop: RendererLoop): Promise<void> => {
  const script = `${$.plugin.root}/renderer/render.mjs`
  let stdout = ''
  let stderr = ''
  let denied: string | undefined
  let outcome: LifeEvent = { kind: 'closed' }
  let ending = 'ended'
  let nodeAsked = false
  try {
    const current = await read($, renderer)
    if (current.status !== 'backoff') await lifeEvent($, { kind: 'closed' })
    const started = await lifeEvent($, current.status === 'backoff' ? { kind: 'retry-due' } : { kind: 'want-start' })
    if (started.status !== 'starting') {
      ending = `not started (life ${started.status})`
      return
    }
    const made = await spawnOut($, ['mktemp', '-d', '-t', STATE_DIR_TEMPLATE])
    const dir = made.stdout.trim()
    if (made.code !== 0 || !dir.startsWith('/')) throw new Error(`mktemp failed with code ${String(made.code)}`)
    loop.stateDir = dir
    // The renderer names its temp dir after the session; keep only characters safe in a path.
    const session = (await $.session.id()).replace(/[^A-Za-z0-9-]/g, '')
    if (loop.closed) {
      ending = 'closed before spawn'
      return
    }
    nodeAsked = true
    const child = $.process.spawn({ argv: ['node', script, `--session=${session}`, `--state=${dir}/${STATE_FILE}`] })
    loop.child = child
    if (loop.closed) {
      ending = 'closed at spawn'
      endChild($, loop)
      return
    }
    let carry = ''
    let rendererDir: string | undefined
    for (;;) {
      const step = await Promise.race([child.next(), loop.whenClosed])
      if (step === undefined || loop.closed) {
        ending = 'closed while reading'
        break
      }
      if (step.done === true) {
        ending = `child ended (code ${String(step.value.code)}, signal ${String(step.value.signal)})`
        outcome = { kind: 'exit', code: step.value.code, signal: step.value.signal, stderr, stdout }
        break
      }
      const piece = step.value
      if (piece.stream === 'stderr') {
        stderr = (stderr + piece.text).slice(-OUTPUT_TAIL)
        continue
      }
      stdout = (stdout + piece.text).slice(-OUTPUT_TAIL)
      const split = splitLines(carry, piece.text)
      carry = split.carry
      const lines = split.lines.flatMap(text => {
        const parsed = parseLine(text)

        return parsed === undefined ? [] : [parsed]
      })
      for (const line of lines) {
        if (line.kind === 'dir') {
          rendererDir = line.path
          logOnce($, 'renderer', `dir ${line.path}`)
        } else if (line.kind === 'ready') {
          await lifeEvent($, { kind: 'ready', ...(rendererDir === undefined ? {} : { dir: rendererDir }) })
          rendererLog($, 'ready')
        }
      }
      // Only the newest frame of a piece is blitted; the older ones are already overwritten on disk (D6).
      const latest = newestFrame(lines)
      if (latest === undefined) continue
      const sized = await read($, viewport)
      let deny: string | undefined
      try {
        const result = await $.ui.blit({ requestId: PANE, key: SCENE_KEY, source: { file: latest.path, format: 'png', generation: latest.n } })
        deny = result.deny
      } catch (error) {
        deny = String(error)
      }
      if (deny === undefined) continue
      if (await isFinalDeny($, deny, sized)) {
        denied = deny
        ending = `blit denied (${deny})`
        break
      }
      logOnce($, 'renderer', `blit refused, retrying on the next frame (${deny})`)
    }
  } catch (error) {
    ending = `threw ${String(error)}`
    outcome = { kind: 'spawn-failed', error: String(error), noOutput: nodeAsked && stdout === '' }
  } finally {
    endChild($, loop)
    const dir = loop.stateDir
    loop.stateDir = undefined
    if (dir !== undefined && dir.startsWith('/') && baseName(dir).startsWith(STATE_DIR_MARK)) {
      await spawnOut($, ['rm', '-rf', '--', dir]).catch(error => rendererLog($, `cleanup threw ${String(error)}`))
    }
    rendererLog($, `loop ended: ${ending}`)
  }
  const life = await lifeEvent($, outcome)
  // A loop stopped from outside is stale: the scene it served is already decided elsewhere, so it never falls to text.
  if (loop.closed) return
  if (denied !== undefined) await fallToText($, { kind: 'denied', reason: denied })
  else if (life.status === 'failed') await fallToText($, { kind: 'ok' })
}

// Starts the one renderer of this session when none runs.
const startRenderer = ($: EngineInterface): void => {
  if (rendererLoop !== undefined) return
  let settle: (value: undefined) => void = () => undefined
  const whenClosed = new Promise<undefined>(resolve => {
    settle = resolve
  })
  const loop: RendererLoop = {
    closed: false,
    seq: 0,
    whenClosed,
    close: () => {
      loop.closed = true
      settle(undefined)
    },
  }
  rendererLoop = loop
  runRenderer($, loop)
    .catch(error => logOnce($, 'renderer', `loop threw ${String(error)}`))
    .finally(() => {
      if (rendererLoop === loop) rendererLoop = undefined
    })
}

// Starts the renderer when the image scene is wanted and the pane is drawn (the tick only gets here with a map).
// A failed life shows the text office; a backoff waits for its retry time.
const ensureRenderer = async ($: EngineInterface, now: number): Promise<void> => {
  // One renderer per session (D12): a running loop is never doubled, and a tick that was in flight when
  // session.end cancelled the timer must not start a new one.
  if (rendererLoop !== undefined || loopTimer === undefined) return
  const life = await read($, renderer)
  if (life.status === 'failed') {
    await fallToText($, { kind: 'ok' })
    return
  }
  if (life.status === 'backoff' && (life.retryAt ?? 0) > now) return
  // session.end may have run while the read above was pending.
  if (rendererLoop !== undefined || loopTimer === undefined) return
  startRenderer($)
}

// The image-mode half of the tick: builds the scene model and writes `state.json` when it changed or the heartbeat
// is due (D7). The Raster blit is skipped.
const imageTick = async (
  $: EngineInterface,
  input: Parameters<typeof sceneOf>[0],
  size: { columns: number; rows: number },
): Promise<void> => {
  await ensureRenderer($, input.now)
  const loop = rendererLoop
  if (loop === undefined || loop.closed || loop.stateDir === undefined) return
  const model = sceneOf(input)
  const key = sceneKey(model)
  if (!shouldWrite(loop.mark, key, input.now)) return
  loop.seq += 1
  loop.mark = { key, at: input.now }
  try {
    await $.fs.write(`${loop.stateDir}/${STATE_FILE}`, stateText({ seq: loop.seq, heartbeatAt: input.now, size: pixelsFor(size), scene: model }))
  } catch (error) {
    loop.mark = undefined
    throw error
  }
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
  await guard($, 'pad focus', undefined, async () => askPadFocusAfterLoad($))
  const viewSize = await read($, viewport)
  const viewMap = await mapAt($, viewSize.columns, viewSize.rows)
  if (viewMap !== undefined) await guard($, 'reseat', undefined, async () => reseatOnFootChange($, viewMap))
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
  const walker = await guard($, 'player', await read($, player), async () => stepPlayerTick($, map, now, size))
  const kitty = await guard($, 'cat', await read($, cat), async () => catTick($, map, now))
  const inspected = await guard($, 'inspect', undefined, async () => inspectTick($, map, now, walker))
  // The message being typed takes the inspect line (D47).
  const shown = chatLine(await read($, pad)) ?? inspected
  const noStrip = (await read($, viewport)).strip === 0
  const ownId = (await read($, team))?.id ?? ''
  const focus = focusOf(map, walker, ownId)
  const drawing = (await read($, scene)).effective
  if (drawing === 'probe') {
    // The render's Image is being probed: the Raster has no mounted key yet, so nothing is blitted.
    lastFrameCells = null

    return
  }
  if (drawing === 'image') {
    // The image scene is fed to the renderer instead of the Raster; a later switch back to text blits afresh.
    lastFrameCells = null
    const typed = chatLine(await read($, pad))
    await guard($, 'scene', undefined, async () =>
      imageTick(
        $,
        {
          map,
          paneColumns: size.columns,
          paneRows: size.rows,
          player: walker,
          ownId,
          now,
          agents: after.agents,
          remoteAgents: await remoteAgentsOf($),
          motion: after.motion,
          bubbles: after.bubbles,
          others: remotePlayersOf(await read($, remote), map),
          cat: kitty,
          inspect: await read($, inspect),
          chatLine: typed,
        },
        size,
      ),
    )

    return
  }
  const span = overlaySpan(map, size.columns, size.rows, focus)
  const frame = buildFrame({
    map,
    agents: { ...after.agents, ...(await remoteAgentsOf($)) },
    motion: after.motion,
    bubbles: after.bubbles,
    now,
    player: walker,
    others: remotePlayersOf(await read($, remote), map),
    cat: kitty,
    hour: hourOf(now),
    overlay: noStrip ? shown : undefined,
    overlayFrom: span.from,
    overlayWidth: span.width,
    overlayRow: span.row,
    pad: padRectAt(viewFor(map.columns, map.rows, size.columns, size.rows, focus)),
  })
  const cells = packCells(cropFrame(frame, map, size.columns, size.rows, focus))
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
let presenceTimer: Timer | undefined
// True while a presence tick runs, so a slow read cannot overlap the next tick and overwrite newer state.
let presenceBusy = false
// True once this module load has asked for the pad's keyboard focus (`openOffice` or the first tick over a drawn pane).
let padFocusAsked = false

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

const startPresence = ($: EngineInterface): void => {
  presenceTimer?.cancel()
  presenceTimer = $.clock.every(PRESENCE_MS, () => {
    if (presenceBusy) return
    presenceBusy = true
    presenceTick($)
      .catch(error => logOnce($, 'presence', String(error)))
      .finally(() => {
        presenceBusy = false
      })
  })
}

const openOffice = async ($: EngineInterface): Promise<void> => {
  // Without rows an inline pane opens a third of the terminal tall. The inline height
  // follows the tree, so this caps it; the render sizes itself from the viewport (D50).
  // Set before the first await: the tick must not open a second time while this open is in flight.
  padFocusAsked = true
  await $.ui.open({ id: PANE, title: 'Office', rows: INLINE_MAX_ROWS, columns: MIN_COLUMNS, focus: true })
  await update($, opened, () => true)
  // The Input is drawn only after the pane mounts, and a focus request before then is waited for only
  // briefly, so the pad takes focus after PAD_FOCUS_MS (spike S1b). A deny is logged once.
  $.clock.after(PAD_FOCUS_MS, () => requestPadFocus($))
}

const requestPadFocus = ($: EngineInterface): void => {
  $.ui
    .focus({ requestId: PANE, key: PAD_KEY })
    .then(result => {
      if (result.deny !== undefined) logOnce($, 'pad focus', `denied: ${result.deny}`)
    })
    .catch(error => logOnce($, 'pad focus', String(error)))
}

// A module loaded while the pane is already drawn (a hot reload, /reload-plugins after an edit) never ran
// `openOffice`, so nobody asked for the keys and WASD typed into the prompt (D73). The tick re-opens the pane with
// `focus` once per load when it sees a drawn pane: `$.ui.focus` alone is denied once Escape has handed the keys
// back ("that site does not hold the keyboard"), while an open's focus request is granted over an empty composer.
// Not on every tick: Escape stays the person's way back to the prompt.
const askPadFocusAfterLoad = async ($: EngineInterface): Promise<void> => {
  if (padFocusAsked) return
  const view = await read($, viewport)
  if (view.columns === 0 && view.rows === 0) return
  await openOffice($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await guard($, 'session.start', undefined, async () => {
      await $.command.register({
        name: 'office',
        description: 'Show the agents office pane',
      })
      await update($, asking, () => false)
      startLoop($)
      // No unasked open: session.start input has only cwd, surface and
      // isInteractive, no fullscreen field (isFullscreen is on command.run
      // presentation and on the ui.render viewport only).
    })
    // Own guards: neither a failing first agent.list nor a failing seed may stop
    // the frame loop above or the 10 s refresh.
    await guard($, 'session.start team', undefined, async () => ensureTeam($, e.cwd, true))
    await guard($, 'session.start branch', undefined, async () => labelTeam($, e.cwd))
    // The share mode loads before the dir resolves, so a publisher that waits for `dir` never sees the default.
    await guard($, 'session.start share', undefined, async () => loadShare($))
    await guard($, 'session.start scene', undefined, async () => loadScene($))
    await guard($, 'session.start presence', undefined, async () => resolveIdentity($))
    await guard($, 'session.start presence cleanup', undefined, async () => cleanPresence($))
    await guard($, 'session.start presence timer', undefined, async () => {
      startPresence($)
    })
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

  on('session.end', async ($, e, next) => {
    presenceTimer?.cancel()
    presenceTimer = undefined
    // The tick is the only thing that starts a renderer, so ending it first keeps the loop from coming back (D12).
    loopTimer?.cancel()
    loopTimer = undefined
    stopRenderer($, 'session.end')
    await guard($, 'session.end', undefined, async () => writeTombstone($))

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

  // The running main turn's id, kept for `x` (D25). A subagent's run raises no turn.start.
  on('turn.start', async ($, e, next) => {
    await guard($, 'turn.start', undefined, async () => {
      await update($, turnRef, () => e.turnId)
    })

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const agentId = e.agentId
    if (agentId === undefined) {
      await guard($, 'turn.complete main', undefined, async () => {
        await update($, turnRef, cur => (cur === e.turnId ? null : cur))
      })
    }
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
      // Closing the pane does not stop the child: the loop must end and call `return()` on its stream (D12).
      stopRenderer($, 'ui.close')
      await guard($, 'ui.close', undefined, async () => {
        await update($, viewport, () => ({ columns: 0, rows: 0 }))
      })
    }

    return result
  })

  on('command.run', { command: 'office' }, async ($, e) =>
    guard($, 'command.run', { text: 'Office pane failed to open.' }, async () => {
      const parsed = parseOfficeArgs(e.args)
      if (parsed.kind === 'usage') return { text: parsed.topic === 'scene' ? SCENE_USAGE : SHARE_USAGE }
      if (parsed.kind === 'share') {
        await $.store.set('share', parsed.mode)
        await update($, share, () => parsed.mode)

        return { text: `Office sharing: ${parsed.mode}` }
      }
      if (parsed.kind === 'scene') {
        await $.store.set('scene', parsed.mode)
        // A new request clears an earlier crash count, then `auto` probes again and `image` draws (D10).
        const cleared = await update($, renderer, cur => (cur.status === 'failed' ? initialLife : cur))
        await update($, scene, () => sceneFor(parsed.mode, cleared))
        if (parsed.mode !== 'image') stopRenderer($, `/office scene ${parsed.mode}`)

        return { text: `Office scene: ${parsed.mode}${await reasonSuffix($)}` }
      }
      const wasOpened = await read($, opened)
      await openOffice($)

      return { text: `${wasOpened ? 'Office pane reopened.' : 'Office pane opened.'}${await reasonSuffix($)}` }
    }),
  )

  // Not a render, so it may write state (D20). Bursts are coalesced: onPadInput diffs the value.
  on('ui.input', { element: PAD_KEY }, async ($, e, next) => {
    await guard($, 'ui.input', undefined, async () => {
      const now = await $.clock.now()
      if (e.kind === 'submit') await update($, pad, cur => onPadSubmit(cur, now))
      else await update($, pad, cur => onPadInput(cur, e.value, now))
      // The peek pane opens here, not in the tick: an open the plugin makes on its own waits undrawn below 144
      // columns, while one answering a key press is placed at any width (d.ts PaneOpenArgs).
      if ((await read($, pad)).peek !== undefined) await peekTick($, now, await read($, player), await footOf($))
    })
    await guard($, 'ui.input confirm', undefined, async () => {
      await confirmTick($, await $.clock.now(), await read($, player), await footOf($))
    })

    return next(e)
  })

  // The peek pane (D25): the lines the tick stored, one truncating Text each. Drawing writes nothing.
  on('ui.render', { component: 'Pane', requestId: PEEK_PANE }, async ($, e) =>
    guard(
      $,
      'ui.render peek',
      () => {
        const { Text } = $.ui.resolve(e)
        return <Text>Peek failed to draw.</Text>
      },
      async () => {
        const { Box, Text } = $.ui.resolve(e)
        const shown = await read($, peek)
        const lines = shown?.lines ?? ['Nothing to show.']

        return (
          <Box flexDirection="column">
            {lines.map((line, i) => (
              <Text key={`peek-${i}`} wrap="truncate-end">
                {line}
              </Text>
            ))}
          </Box>
        )
      },
    ),
  )

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

        const elements = $.ui.resolve(e)
        const { Raster, Input, Image } = elements
        const bodyRows = bodyRowsFor(e.props.placement, e.props.scroll.bodyRows, e.viewport?.rows)
        const { columns, rows, strip: stripCount, foot } = rasterSize(e.props.bodyColumns, bodyRows)
        // Drawing is pure: a state write inside the hook is denied. A timer closure
        // runs in its own dispatch, where the write is allowed (TODO.md D20).
        writeViewport($, { columns, rows, strip: stripCount, foot })
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
        const shownScene = (await read($, scene)).effective
        // `Image` in the table is not proof the terminal draws it (tmux has it): the probe blit is the signal (D11).
        const hasImage = 'Image' in elements && Image !== undefined
        if (shownScene !== 'text' && !hasImage) denyFromRender($, 'this surface has no Image element.')
        if (shownScene === 'probe' && hasImage) scheduleProbe($)
        if (shownScene !== 'text' && hasImage) {
          // The image scene (T12, D18): the Image is mounted from the first render, with the placeholder until the
          // first frame is blitted to its key; the pad Input sits over its bottom-left cell like over the Raster.
          const drawn = await read($, scene)
          const rowsOfLog = await read($, log)
          const recent = stripCount > 0 ? rowsOfLog.slice(-stripCount) : []
          const imageStrip = Array.from({ length: stripCount }, (_, i) => recent[i] ?? ' ')
          const imagePad = await read($, pad)

          return (
            <Box flexDirection="column">
              <Box>
                <Image
                  key={SCENE_KEY}
                  source={{ file: `${$.plugin.root}/renderer/placeholder.png`, format: 'png', generation: 0 }}
                  columns={clampCells(columns)}
                  rows={clampCells(rows)}
                  alt={`Agents Office image scene (mode: ${drawn.want})`}
                />
                <Box position="absolute" bottom={0} left={0} width={2}>
                  <Input key={PAD_KEY} value={imagePad.clear} submitLabel="" onSubmit={() => undefined} />
                </Box>
              </Box>
              {imageStrip.map((line, i) => (
                <Text key={`log-${i}`} dimColor wrap="truncate-end">
                  {line}
                </Text>
              ))}
            </Box>
          )
        }
        const inspected = await read($, inspect)
        const inspectLine = chatLine(await read($, pad)) ?? (inspected !== null && inspected.until > (await $.clock.now()) ? inspected.text : undefined)
        const drawnPlayer = await read($, player)
        const ownTeamId = (await read($, team))?.id ?? ''
        const focus = focusOf(map, drawnPlayer, ownTeamId)
        const span = overlaySpan(map, columns, rows, focus)
        const grid = buildFrame({
          map,
          agents: { ...(await read($, agents)), ...(await remoteAgentsOf($)) },
          motion: await read($, motion),
          bubbles: await read($, bubbles),
          now: await $.clock.now(),
          player: drawnPlayer,
          others: remotePlayersOf(await read($, remote), map),
          cat: await read($, cat),
          hour: hourOf(await $.clock.now()),
          overlay: stripCount === 0 ? inspectLine : undefined,
          overlayFrom: span.from,
          overlayWidth: span.width,
          overlayRow: span.row,
          pad: padRectAt(viewFor(map.columns, map.rows, columns, rows, focus)),
        })
        const cells = packCells(cropFrame(grid, map, columns, rows, focus))
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

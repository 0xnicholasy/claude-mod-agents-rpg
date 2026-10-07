// Presence directory, share preference and the published record (D17-D19, D22). Pure: register.tsx runs every `$` call.
import type { OfficeAgent, AgentStatus, Roster, Tier } from './agents'
import { clean } from './log'
import { canStand, cut, roomAt } from './map'
import type { OfficeMap, Point, RoomId, TeamSpec } from './map'
import { assignTarget } from './motion'
import type { Motion, RemotePlayer } from './frame'
import type { Facing, Pose, Role } from './sprites'
import { CHAT_MAX, CHAT_MS, EMOTE_MS, HEARTBEAT_MS, STALE_MS } from './timing'

export type ShareMode = 'all' | 'anon' | 'off'

const SHARE_MODES: readonly ShareMode[] = ['all', 'anon', 'off']
export const DEFAULT_SHARE: ShareMode = 'all'
export const SHARE_USAGE = 'Usage: /office share all|anon|off'

// The scene preference (D10), kept in `$.store` key `scene`: `text` is the v2 office, `image` the image scene,
// `auto` probes. Until T13 only `image` draws the image scene; `auto` is stored and behaves as `text`.
export type SceneMode = 'auto' | 'image' | 'text'

const SCENE_MODES: readonly SceneMode[] = ['auto', 'image', 'text']
export const DEFAULT_SCENE: SceneMode = 'text'
export const SCENE_USAGE = 'Usage: /office scene auto|image|text'

// `<CLAUDE_CONFIG_DIR>/agents-office/presence`, else `<HOME>/.claude/agents-office/presence`; undefined when both are empty.
export const presenceDir = (config: string, home: string): string | undefined => {
  const base = config.trim()
  const fallback = home.trim()
  if (base !== '') return `${base}/agents-office/presence`
  if (fallback !== '') return `${fallback}/.claude/agents-office/presence`

  return undefined
}

// The value `printenv` printed; empty when the run failed (a variable that is unset exits 1).
export const envValue = (stdout: string, ok: boolean): string => (ok ? stdout.replace(/[\r\n]+$/, '').trim() : '')

// A stored value back to a mode. `unknown` because `$.store.get` returns `unknown` (D19).
export const asShare = (value: unknown): ShareMode => SHARE_MODES.find(mode => mode === value) ?? DEFAULT_SHARE

// A stored value back to a scene mode. `unknown` because `$.store.get` returns `unknown` (D19).
export const asScene = (value: unknown): SceneMode => SCENE_MODES.find(mode => mode === value) ?? DEFAULT_SCENE

export type OfficeArgs =
  | { kind: 'open' }
  | { kind: 'share'; mode: ShareMode }
  | { kind: 'scene'; mode: SceneMode }
  | { kind: 'usage'; topic?: 'scene' }

// Splits the `/office` arguments: none opens the pane, `share <mode>` and `scene <mode>` set a preference, anything else is usage.
export const parseOfficeArgs = (args: string | undefined): OfficeArgs => {
  const words = (args ?? '').trim().toLowerCase().split(/\s+/).filter(word => word !== '')
  if (words.length === 0) return { kind: 'open' }
  const mode = SHARE_MODES.find(candidate => candidate === words[1])
  if (words[0] === 'share' && words.length === 2 && mode !== undefined) return { kind: 'share', mode }
  if (words[0] === 'scene') {
    const scene = SCENE_MODES.find(candidate => candidate === words[1])
    return words.length === 2 && scene !== undefined ? { kind: 'scene', mode: scene } : { kind: 'usage', topic: 'scene' }
  }

  return { kind: 'usage' }
}

// ---- The published record (T14) ----------------------------------------------------------------------
// Privacy (binding): a record carries only the fields below. Never a prompt, tool name or argument, file
// path, SendMessage text or transcript text; `toRecord` copies fields one by one and never spreads an agent.

export const PRESENCE_VERSION = 1
export const MAX_RECORD_AGENTS = 32
export const MAX_RECORD_BYTES = 8192
export const LABEL_MAX = 16
// D42: the team label and branch have their own cap, so a real repo name is not cut to an agent label's 16.
export const TEAM_TEXT_MAX = 40
export const MAX_REMOTE_SESSIONS = 16

export type PresenceAgent = {
  id: string
  label: string
  tier: Tier
  role: Role
  room: RoomId
  pose: Pose
  status: AgentStatus
  parentId?: string
}

// The own player (T19, D29): the room and the position inside it, so each pane can map it into its own layout.
export type PresencePlayer = {
  room: RoomId
  rx: number
  ry: number
  facing: Facing
  emote?: string
  emoteUntil?: number
  chat?: string
  chatUntil?: number
}

export type PresenceRecord = {
  v: number
  sessionId: string
  startedAt: number
  heartbeatAt: number
  share: 'all' | 'anon'
  team: { label: string; branch: string }
  agents: PresenceAgent[]
  player: PresencePlayer | null
}

export type Tombstone = { v: number; sessionId: string; heartbeatAt: number; gone: true }

export type RecordInput = {
  sessionId: string
  startedAt: number
  now: number
  // 'off' publishes nothing, so the builder takes only the two modes that do.
  share: 'all' | 'anon'
  team: { label: string; branch: string }
  roster: Roster
  // The own player in room-relative form (T19); absent or null publishes null.
  player?: PresencePlayer | null
}

const labelOf = (text: string): string => cut(clean(text), LABEL_MAX)
const teamText = (text: string): string => cut(clean(text), TEAM_TEXT_MAX)

const agentOf = (agent: OfficeAgent, share: 'all' | 'anon'): PresenceAgent => {
  const role: Role = agent.role ?? 'dev'
  const base: PresenceAgent = {
    id: cut(clean(agent.id), 64),
    // Anon (D22): the label is the role. So is a label taken from a task description, and an empty one.
    label: share === 'anon' || agent.described === true ? role : labelOf(agent.label) || role,
    tier: agent.tier,
    role,
    room: agent.room,
    pose: agent.pose,
    status: agent.status,
  }

  return agent.parentId === undefined ? base : { ...base, parentId: cut(clean(agent.parentId), 64) }
}

const bytesOf = (text: string): number => new TextEncoder().encode(text).length

// Builds the record: main first, then the newest agents (roster order, newest last), at most 32, and
// agents dropped from the end until the JSON is at most 8192 bytes.
export const toRecord = (input: RecordInput): PresenceRecord => {
  const all = Object.values(input.roster)
  const main = all.filter(agent => agent.id === 'main')
  const rest = all.filter(agent => agent.id !== 'main').reverse()
  const agents = [...main, ...rest].slice(0, MAX_RECORD_AGENTS).map(agent => agentOf(agent, input.share))
  const anon = input.share === 'anon'
  const record: PresenceRecord = {
    v: PRESENCE_VERSION,
    sessionId: input.sessionId,
    startedAt: input.startedAt,
    heartbeatAt: input.now,
    share: input.share,
    team: anon ? { label: '', branch: '' } : { label: teamText(input.team.label), branch: teamText(input.team.branch) },
    agents,
    player: input.player ?? null,
  }
  while (record.agents.length > 0 && bytesOf(JSON.stringify(record)) > MAX_RECORD_BYTES) record.agents.pop()

  return record
}

export const toTombstone = (sessionId: string, now: number): Tombstone => ({ v: PRESENCE_VERSION, sessionId, heartbeatAt: now, gone: true })

// The text that decides "changed": the record without its heartbeat.
export const signature = (record: PresenceRecord): string => JSON.stringify({ ...record, heartbeatAt: 0 })

// True for a first write, a changed record, or a heartbeat that is due (D18).
export const writeDue = (lastText: string | undefined, lastWriteAt: number, text: string, now: number): boolean =>
  lastText === undefined || lastText !== text || now - lastWriteAt >= HEARTBEAT_MS

// `<dir>/<sessionId>.json`; undefined when the session id could escape the directory.
export const presencePath = (dir: string, sessionId: string): string | undefined =>
  /^[A-Za-z0-9._-]+$/.test(sessionId) && sessionId !== '.' && sessionId !== '..' ? `${dir}/${sessionId}.json` : undefined

export const PRESENCE_DIR_SUFFIX = '/agents-office/presence'

// ---- Reader (T15, D18, D20). Every field of a foreign record is untrusted.

export type Remote = Record<string, PresenceRecord>

export type Parsed = { kind: 'record'; record: PresenceRecord } | { kind: 'gone'; sessionId: string }

const TIERS: readonly Tier[] = ['haiku', 'sonnet', 'opus', 'fable', 'grey']
const ROLES: readonly Role[] = ['lead', 'dev', 'research', 'review']
const POSES: readonly Pose[] = ['idle', 'walk', 'read', 'type', 'run', 'call', 'talk']
const STATUSES: readonly AgentStatus[] = ['working', 'idle', 'done', 'leaving']
const FACINGS: readonly Facing[] = ['down', 'up', 'left', 'right']
const SHARED_ROOMS: readonly RoomId[] = ['reception', 'conference', 'kitchen', 'lab', 'booths']
const ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/
const COORD_MAX = 200

// Parsed JSON has no known shape; this is the one place it is narrowed, field by field.
type Raw = Record<string, unknown> // JSON.parse yields unknown data; every field is checked before use.

const isRaw = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
const pick = <T extends string>(list: readonly T[], value: unknown): T | undefined => list.find(item => item === value)
const validId = (value: unknown): string | undefined => {
  const text = str(value)

  // Names that exist on Object.prototype (constructor, __proto__, ...) would collide with plain-object maps keyed by id.
  return text !== undefined && ID_PATTERN.test(text) && text !== '.' && text !== '..' && !(text in Object.prototype) ? text : undefined
}

const roomOf = (value: unknown): RoomId | undefined => {
  const text = str(value)
  if (text === undefined) return undefined
  const shared = SHARED_ROOMS.find(room => room === text)
  if (shared !== undefined) return shared

  return text.startsWith('team:') && ID_PATTERN.test(text.slice(5)) ? (text as RoomId) : undefined
}

const agentFrom = (value: unknown): PresenceAgent | undefined => {
  if (!isRaw(value)) return undefined
  const id = cut(clean(str(value.id) ?? ''), 64)
  const tier = pick(TIERS, value.tier)
  const role = pick(ROLES, value.role)
  const room = roomOf(value.room)
  const pose = pick(POSES, value.pose)
  const status = pick(STATUSES, value.status)
  // An unknown tier, role, room, pose or status drops the agent rather than throwing.
  if (id === '' || tier === undefined || role === undefined || room === undefined || pose === undefined || status === undefined) return undefined
  const label = labelOf(str(value.label) ?? '') || role
  const parent = cut(clean(str(value.parentId) ?? ''), 64)
  const base: PresenceAgent = { id, label, tier, role, room, pose, status }

  return parent === '' ? base : { ...base, parentId: parent }
}

const playerFrom = (value: unknown): PresencePlayer | null => {
  if (!isRaw(value)) return null
  const room = roomOf(value.room)
  const rx = num(value.rx)
  const ry = num(value.ry)
  const facing = pick(FACINGS, value.facing)
  if (room === undefined || rx === undefined || ry === undefined || facing === undefined) return null
  const base: PresencePlayer = {
    room,
    rx: Math.min(COORD_MAX, Math.max(0, Math.round(rx))),
    ry: Math.min(COORD_MAX, Math.max(0, Math.round(ry))),
    facing,
  }
  const emote = str(value.emote)
  const chat = str(value.chat)
  const emoteUntil = num(value.emoteUntil)
  const chatUntil = num(value.chatUntil)

  return {
    ...base,
    ...(emote === undefined ? {} : { emote: cut(clean(emote), 2) }),
    ...(emoteUntil === undefined ? {} : { emoteUntil }),
    ...(chat === undefined ? {} : { chat: cut(clean(chat), CHAT_MAX) }),
    ...(chatUntil === undefined ? {} : { chatUntil }),
  }
}

// Narrows a presence file's text. Undefined means unusable (not JSON, oversize, wrong version or wrong
// types), and the caller keeps its last good snapshot.
export const parseRecord = (text: string): Parsed | undefined => {
  if (text.length > MAX_RECORD_BYTES * 2 || bytesOf(text) > MAX_RECORD_BYTES) return undefined
  let value: unknown // JSON.parse yields unknown data; narrowed below.
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isRaw(value) || value.v !== PRESENCE_VERSION) return undefined
  const sessionId = validId(value.sessionId)
  const heartbeatAt = num(value.heartbeatAt)
  if (sessionId === undefined || heartbeatAt === undefined) return undefined
  if (value.gone === true) return { kind: 'gone', sessionId }
  const startedAt = num(value.startedAt)
  const share = pick(['all', 'anon'] as const, value.share)
  if (startedAt === undefined || share === undefined || !isRaw(value.team) || !Array.isArray(value.agents)) return undefined
  const label = str(value.team.label)
  const branch = str(value.team.branch)
  if (label === undefined || branch === undefined) return undefined
  const seen = new Set<string>()
  const agents: PresenceAgent[] = []
  for (const item of value.agents.slice(0, MAX_RECORD_AGENTS)) {
    const agent = agentFrom(item)
    if (agent === undefined || seen.has(agent.id)) continue
    seen.add(agent.id)
    agents.push(agent)
  }

  return {
    kind: 'record',
    record: {
      v: PRESENCE_VERSION,
      sessionId,
      startedAt,
      heartbeatAt,
      share,
      team: { label: teamText(label), branch: teamText(branch) },
      agents,
      player: playerFrom(value.player),
    },
  }
}

// A heartbeat more than STALE_MS away from now (either side) is stale; the future side stops a forged
// heartbeat from keeping a session alive.
export const isStale = (heartbeatAt: number, now: number): boolean => Math.abs(now - heartbeatAt) > STALE_MS

export type FileEntry = { name: string; kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number }
export type ReadPlan = { listed: string[]; toRead: Array<{ sessionId: string; name: string; mtimeMs: number }> }

// Which files of a listing to read: `<id>.json` regular files that are not the own file, were touched within
// STALE_MS and whose mtime differs from the last read. At most MAX_REMOTE_SESSIONS, newest first.
export const planReads = (entries: readonly FileEntry[], ownId: string, mtimes: Readonly<Record<string, number>>, now: number): ReadPlan => {
  const fresh = entries
    .flatMap(entry => {
      if (entry.kind !== 'file' || entry.size > MAX_RECORD_BYTES || !entry.name.endsWith('.json')) return []
      const sessionId = validId(entry.name.slice(0, -5))
      if (sessionId === undefined || sessionId === ownId || isStale(entry.mtimeMs, now)) return []

      return [{ sessionId, name: entry.name, mtimeMs: entry.mtimeMs }]
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.sessionId.localeCompare(b.sessionId))
    .slice(0, MAX_REMOTE_SESSIONS)

  return { listed: fresh.map(file => file.sessionId), toRead: fresh.filter(file => mtimes[file.sessionId] !== file.mtimeMs) }
}

// Folds freshly read files into the snapshot. `parsed[id]` is a record or tombstone, or null for a file that
// could not be read or parsed (the last snapshot is kept). A session leaves when its file is no longer
// listed, it is tombstoned, its record's id differs from its file name or its heartbeat is stale. Returns
// `prev` itself when nothing changed.
export const mergeRemote = (prev: Remote, parsed: Readonly<Record<string, Parsed | null>>, now: number, listed: readonly string[]): Remote => {
  const next: Remote = {}
  for (const id of listed) {
    const fresh = parsed[id]
    const kept = fresh === undefined || fresh === null ? prev[id] : fresh.kind === 'record' && fresh.record.sessionId === id ? fresh.record : undefined
    if (kept !== undefined && !isStale(kept.heartbeatAt, now)) next[id] = kept
  }
  const same = Object.keys(next).length === Object.keys(prev).length && Object.keys(next).every(id => next[id] === prev[id])

  return same ? prev : next
}

// ---- Drawing other sessions (T16, D4, D12, D20).

export const remoteKey = (sessionId: string, agentId: string): string => `${sessionId}:${agentId}`

// Every remote agent as a roster entry keyed `sessionId:agentId`; its published room and pose are drawn as they are.
export const remoteRoster = (remote: Remote): Roster => {
  const roster: Roster = {}
  for (const record of Object.values(remote)) {
    for (const agent of record.agents) {
      const id = remoteKey(record.sessionId, agent.id)
      const entry: OfficeAgent = {
        id,
        label: agent.label,
        tier: agent.tier,
        role: agent.role,
        status: agent.status,
        room: agent.room,
        pose: agent.pose,
        home: agent.room,
        teammate: false,
      }
      roster[id] = agent.parentId === undefined ? entry : { ...entry, parentId: remoteKey(record.sessionId, agent.parentId) }
    }
  }

  return roster
}

export type OwnTeam = { id: `team:${string}`; label: string; startedAt: number }

// Teams in room order, so every pane agrees: `startedAt`, then id (D4). A label already taken by an earlier
// room gets " 2", " 3" (D12). An anonymous record has no label, so its room reads `Session N`, where N is the
// 1-based room order (D22, D44). The own team always shows its own label.
export const orderedTeams = (own: OwnTeam | null, remote: Remote): TeamSpec[] => {
  const all = [
    // The own label is cut like a published one, so a same-worktree twin gets its " 2" in every pane (D44).
    ...(own === null ? [] : [{ id: own.id, label: teamText(own.label), startedAt: own.startedAt }]),
    ...Object.values(remote).map(record => ({ id: `team:${record.sessionId}` as const, label: record.team.label, startedAt: record.startedAt })),
  ].sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const seen = new Map<string, number>()

  return all.map((team, i) => {
    const label = team.label === '' ? `Session ${i + 1}` : team.label
    const count = (seen.get(label) ?? 0) + 1
    seen.set(label, count)

    return { id: team.id, label: count === 1 ? label : `${label} ${count}` }
  })
}

// Sends each remote agent that already has a motion entry toward its published room, one tile per step.
// Returns the same reference when nobody needs a new route.
export const routeRemote = (motion: Motion, map: OfficeMap, remoteAgents: Roster): Motion => {
  let next = motion
  for (const agent of Object.values(remoteAgents)) {
    if (next[agent.id] === undefined) continue
    next = assignTarget(next, map, agent.id, agent.room)
  }

  return next
}

// ---- Players (T19, D29, D46) --------------------------------------------------------------------------

export type OwnPlayer = { x: number; y: number; facing: Facing; emote?: string; emoteUntil?: number; chat?: string; chatUntil?: number }

// The own player as published: the room holding its origin (else the room with the nearest door, for a player in
// the corridor) and the offset from that room's top-left interior cell, never below 0. An emote and a chat line
// are published only while they are still showing, each with its own expiry. A chat line is text the user typed
// on purpose to share (D23); nothing else from a prompt is ever published.
export const toPresencePlayer = (map: OfficeMap, player: OwnPlayer, now: number): PresencePlayer | null => {
  const here = roomAt(map, player.x, player.y)
  const room =
    map.rooms.find(candidate => candidate.id === here) ??
    [...map.rooms].sort(
      (a, b) =>
        Math.abs(a.doorStand.x - player.x) + Math.abs(a.doorStand.y - player.y) -
        (Math.abs(b.doorStand.x - player.x) + Math.abs(b.doorStand.y - player.y)),
    )[0]
  if (room === undefined) return null
  const base: PresencePlayer = {
    room: room.id,
    rx: Math.max(0, player.x - room.bounds.x),
    ry: Math.max(0, player.y - room.bounds.y),
    facing: player.facing,
  }
  const emoting = player.emote !== undefined && player.emoteUntil !== undefined && player.emoteUntil > now
  const chatting = player.chat !== undefined && player.chatUntil !== undefined && player.chatUntil > now
  const text = player.chat === undefined ? '' : cut(clean(player.chat), CHAT_MAX)

  return {
    ...base,
    ...(emoting ? { emote: cut(clean(player.emote ?? ''), 2), emoteUntil: player.emoteUntil } : {}),
    ...(chatting && text !== '' ? { chat: text, chatUntil: player.chatUntil } : {}),
  }
}

// Where a published player stands in this pane's layout (D29): the room-relative offset, clamped into the room
// so a narrower room still holds it, then the nearest tile of the room a figure can stand on, else the room's
// first free anchor or its doorStand. Undefined when the room is not on this map.
export const placeRemotePlayer = (map: OfficeMap, player: PresencePlayer): Point | undefined => {
  const room = map.rooms.find(candidate => candidate.id === player.room)
  if (room === undefined) return undefined
  const { x: bx, y: by, w, h } = room.bounds
  const wanted: Point = {
    x: bx + Math.min(Math.max(0, player.rx), Math.max(0, w - map.foot.w)),
    y: by + Math.min(Math.max(0, player.ry), Math.max(0, h - map.foot.h)),
  }
  if (canStand(map, wanted.x, wanted.y)) return wanted
  let best: Point | undefined
  let bestDist = Infinity
  for (let y = by; y + map.foot.h <= by + h; y++) {
    for (let x = bx; x + map.foot.w <= bx + w; x++) {
      const dist = Math.abs(x - wanted.x) + Math.abs(y - wanted.y)
      if (dist < bestDist && canStand(map, x, y)) {
        best = { x, y }
        bestDist = dist
      }
    }
  }

  return best ?? room.anchors.find(p => canStand(map, p.x, p.y)) ?? room.doorStand
}

// The other sessions' players to draw: each at its clamped spot, plated with its session's team label (`Session N`
// when anonymous). An expiry is capped (EMOTE_MS, CHAT_MS) from the record's own heartbeat, so a forged far-future value is cut
// down and does not drift with each frame; a stale record is dropped by the reader anyway.
export const remotePlayersOf = (remote: Remote, map: OfficeMap): RemotePlayer[] =>
  Object.values(remote).flatMap(record => {
    const published = record.player
    if (published === null) return []
    const at = placeRemotePlayer(map, published)
    if (at === undefined) return []
    const name = map.rooms.find(room => room.id === `team:${record.sessionId}`)?.name ?? ''
    const base: RemotePlayer = { id: record.sessionId, x: at.x, y: at.y, facing: published.facing, label: name === '' ? 'guest' : name }

    return {
      ...base,
      ...(published.emote === undefined || published.emoteUntil === undefined
        ? {}
        : { emote: published.emote, emoteUntil: Math.min(published.emoteUntil, record.heartbeatAt + EMOTE_MS) }),
      ...(published.chat === undefined || published.chatUntil === undefined
        ? {}
        : { chat: published.chat, chatUntil: Math.min(published.chatUntil, record.heartbeatAt + CHAT_MS) }),
    }
  })

// Presence directory, share preference and the published record (D17-D19, D22). Pure: register.tsx runs every `$` call.
import type { OfficeAgent, AgentStatus, Roster, Tier } from './agents'
import { clean } from './log'
import { cut } from './map'
import type { RoomId } from './map'
import type { Facing, Pose, Role } from './sprites'
import { HEARTBEAT_MS } from './timing'

export type ShareMode = 'all' | 'anon' | 'off'

const SHARE_MODES: readonly ShareMode[] = ['all', 'anon', 'off']
export const DEFAULT_SHARE: ShareMode = 'all'
export const SHARE_USAGE = 'Usage: /office share all|anon|off'

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

export type OfficeArgs = { kind: 'open' } | { kind: 'share'; mode: ShareMode } | { kind: 'usage' }

// Splits the `/office` arguments: none opens the pane, `share <mode>` sets the preference, anything else is usage.
export const parseOfficeArgs = (args: string | undefined): OfficeArgs => {
  const words = (args ?? '').trim().toLowerCase().split(/\s+/).filter(word => word !== '')
  if (words.length === 0) return { kind: 'open' }
  const mode = SHARE_MODES.find(candidate => candidate === words[1])
  if (words[0] === 'share' && words.length === 2 && mode !== undefined) return { kind: 'share', mode }

  return { kind: 'usage' }
}

// ---- The published record (T14) ----------------------------------------------------------------------
// Privacy (binding): a record carries only the fields below. Never a prompt, tool name or argument, file
// path, SendMessage text or transcript text; `toRecord` copies fields one by one and never spreads an agent.

export const PRESENCE_VERSION = 1
export const MAX_RECORD_AGENTS = 32
export const MAX_RECORD_BYTES = 8192
export const LABEL_MAX = 16

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

// The own player, published from T19 on; T14 always publishes null.
export type PresencePlayer = {
  room: RoomId
  rx: number
  ry: number
  facing: Facing
  emote?: string
  chat?: string
  until?: number
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
}

const labelOf = (text: string): string => cut(clean(text), LABEL_MAX)

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
    team: anon ? { label: '', branch: '' } : { label: labelOf(input.team.label), branch: cut(clean(input.team.branch), 64) },
    agents,
    player: null,
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

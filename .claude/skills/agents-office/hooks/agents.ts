import type { AgentInfo, AgentSpawnInput } from 'claude-code'
import type { Activity } from './activity'
import type { OfficeMap, RoomId } from './map'
import type { Motion } from './frame'
import type { Pose, Role } from './sprites'
import { DESPAWN_MS } from './timing'

// A meeting walk (D38). `text` is the speaker's bubble, shown on arrival; `until` is
// set once both stand in the Conference Room.
export type MeetScript = {
  kind: 'meet'
  peer: string
  phase: 'going' | 'talking' | 'returning'
  returnRoom: RoomId
  returnPose: Pose
  // The tile the agent left (its desk), so it sits back on its own anchor (D38).
  returnAt: { x: number; y: number }
  until?: number
  text?: string
}

// A completion walk (T09): Reception, bubbles for BUBBLE_MS (`until`), then the Kitchen.
// `stopped` is true when the turn did not end with an answer.
export type ReportScript = {
  kind: 'report'
  phase: 'toReception' | 'reporting' | 'toKitchen'
  stopped: boolean
  until?: number
}

export type Script = MeetScript | ReportScript

export type Tier = 'haiku' | 'sonnet' | 'opus' | 'fable' | 'grey'
export type AgentStatus = 'working' | 'idle' | 'done' | 'leaving'

export type OfficeAgent = {
  id: string
  label: string
  tier: Tier
  // Pants color. A roster entry from before roles existed has none and draws as dev (D6).
  role?: Role
  parentId?: string
  status: AgentStatus
  room: RoomId
  pose: Pose
  // The room holding the agent's own desk; activity 'desk' resolves to it (D37).
  home: RoomId
  // A teammate has several turns: turn.complete makes it idle, never done (D26).
  teammate: boolean
  completedAt?: number
  // The last tool this agent called, and when that tool began (D39); undefined before its first tool.
  tool?: string
  seenAt?: number
  // A running choreography (T08); tool activity is ignored while one runs.
  script?: Script
}

export type Roster = Record<string, OfficeAgent>

export type SpawnInput = Pick<
  AgentSpawnInput,
  'name' | 'subagentType' | 'description' | 'model' | 'parentAgentId' | 'isTeammate'
>
// The slice of AgentSpawnResult the reducer reads; a deny carries no agentId.
export type SpawnResult = { model?: string; agentId?: string }

const TIERS = ['haiku', 'sonnet', 'opus', 'fable'] as const

const tierOf = (text: string | undefined): Tier | undefined => {
  if (text === undefined) return undefined
  const lower = text.toLowerCase()
  return TIERS.find(tier => lower.includes(tier))
}

// Pants color by agent type (D6): review, then research (explore/research/search), else dev.
export const roleOf = (type: string): Role => {
  const lower = type.toLowerCase()
  if (lower.includes('review')) return 'review'
  if (['explore', 'research', 'search'].some(word => lower.includes(word))) return 'research'

  return 'dev'
}

const labelOf = (name: string | undefined, type: string, description: string): string =>
  name || type || description.slice(0, 12)

// A live status carries no completedAt, so expire never drops the agent.
const withStatus = (agent: OfficeAgent, status: 'working' | 'idle'): OfficeAgent => {
  const next: OfficeAgent = { ...agent, status }
  delete next.completedAt

  return next
}

// Records the tool an agent just called; `seenAt` restarts only when the tool changes (D39).
export const markTool = (roster: Roster, agentId: string, tool: string, now: number): Roster => {
  const agent = roster[agentId]
  if (agent === undefined || agent.tool === tool) return roster

  return { ...roster, [agentId]: { ...agent, tool, seenAt: now } }
}

// `home` is the own team room (D12): every agent works from its desk there.
export const seedMain = (roster: Roster, home: RoomId): Roster =>
  roster.main !== undefined
    ? roster
    : {
        ...roster,
        main: { id: 'main', label: 'main', tier: 'grey', role: 'lead', status: 'working', room: home, pose: 'idle', home, teammate: false },
      }

export const onSpawn = (roster: Roster, input: SpawnInput, result: SpawnResult, home: RoomId): Roster => {
  const id = result.agentId
  if (id === undefined) return roster
  const agent: OfficeAgent = {
    id,
    label: labelOf(input.name, input.subagentType, input.description),
    tier: tierOf(input.model) ?? tierOf(result.model) ?? 'grey',
    role: roleOf(input.subagentType),
    status: 'working',
    room: home,
    pose: 'idle',
    home,
    teammate: input.isTeammate === true,
  }
  if (input.parentAgentId !== undefined) agent.parentId = input.parentAgentId

  return { ...roster, [id]: agent }
}

const V1_ROOMS: Record<string, RoomId | 'home'> = {
  lobby: 'reception',
  meeting: 'conference',
  break: 'kitchen',
  server: 'lab',
  phone: 'booths',
  devbay: 'home',
  library: 'home',
}
const V1_PHASES: Record<string, ReportScript['phase']> = { toLobby: 'toReception', toBreak: 'toKitchen' }

// A roster written by v1 (hot reload) holds the old room ids and report phases; this maps them to
// the D10 rooms (D11). Dev Bay and Library work moves to the own team room, as does any other team id
// (a new session id) and any Reception home. Returns the same reference
// when nothing is v1, so a v2 roster is never rewritten.
export const migrateRoster = (roster: Roster, home: RoomId): Roster => {
  // Stored values predate the RoomId union, so they are matched as plain strings.
  const room = (id: string): RoomId => {
    // The roster holds only own agents, so a team room in it is the own team's, even a stale id.
    if (id.startsWith('team:')) return home
    const mapped = V1_ROOMS[id]
    // A string index returns undefined for an id that is already v2.
    if (mapped === undefined) return id as RoomId
    return mapped === 'home' ? home : mapped
  }
  let changed = false
  const out: Roster = {}
  for (const [key, agent] of Object.entries(roster)) {
    const nextRoom = room(agent.room)
    // No agent works from a shared room: a Reception home is v1's main in the Lobby, or an agent made before the team existed.
    const mappedHome = room(agent.home)
    const nextHome = mappedHome === 'reception' ? home : mappedHome
    let script = agent.script
    if (script?.kind === 'meet' && room(script.returnRoom) !== script.returnRoom) script = { ...script, returnRoom: room(script.returnRoom) }
    if (script?.kind === 'report' && V1_PHASES[script.phase] !== undefined) script = { ...script, phase: V1_PHASES[script.phase] ?? script.phase }
    if (nextRoom === agent.room && nextHome === agent.home && script === agent.script) {
      out[key] = agent
      continue
    }
    changed = true
    out[key] = script === undefined ? { ...agent, room: nextRoom, home: nextHome } : { ...agent, room: nextRoom, home: nextHome, script }
  }

  return changed ? out : roster
}

export const onComplete = (roster: Roster, agentId: string, now: number): Roster => {
  const agent = roster[agentId]
  if (agent === undefined || agent.status === 'done' || agent.status === 'leaving') return roster
  if (agent.teammate) {
    if (agent.status === 'idle') return roster

    return { ...roster, [agentId]: withStatus(agent, 'idle') }
  }

  return { ...roster, [agentId]: { ...agent, status: 'done', completedAt: now } }
}

// Records what a tool call makes the agent do; 'desk' resolves to its home (D37).
// Returns the same reference when the agent is unknown, done, leaving or or nothing changes. Under a script only `script.returnRoom`/`returnPose` change, so the agent finishes the meeting and then goes there.
export const onActivity = (roster: Roster, agentId: string, activity: Activity): Roster => {
  const agent = roster[agentId]
  if (agent === undefined || agent.status === 'done' || agent.status === 'leaving') return roster
  const room = activity.room === 'desk' ? agent.home : activity.room
  // A working or idle agent cannot still be reporting (the roster list revived it, or the report
  // started with no pane): the stale report script is dropped and the activity applies normally.
  if (agent.script?.kind === 'report') {
    const bare = { ...agent }
    delete bare.script
    return onActivity({ ...roster, [agentId]: bare }, agentId, activity)
  }
  if (agent.script !== undefined) {
    // Mid-meeting: the agent stays put; the activity is where it goes back to.
    const { script } = agent
    if (script.returnRoom === room && script.returnPose === activity.pose) return roster

    const moved = { ...script, returnRoom: room, returnPose: activity.pose }
    // Already walking back: the new activity is where it is heading now.
    if (script.phase === 'returning') return { ...roster, [agentId]: { ...agent, room, pose: activity.pose, script: moved } }

    return { ...roster, [agentId]: { ...agent, script: moved } }
  }
  if (agent.room === room && agent.pose === activity.pose) return roster

  return { ...roster, [agentId]: { ...agent, room, pose: activity.pose } }
}

// Adds listed agents the roster does not know yet and revives a done agent the list
// reports running (a new turn); never removes one.
export const syncList = (roster: Roster, infos: readonly AgentInfo[], home: RoomId): Roster => {
  let next = roster
  for (const info of infos) {
    const known = next[info.id]
    if (known !== undefined) {
      if (known.status === 'done' && info.status === 'running') {
        next = { ...next, [info.id]: withStatus(known, 'working') }
      }
      continue
    }
    if (info.status !== 'running' && info.status !== 'idle' && info.status !== 'waiting') continue
    const agent: OfficeAgent = {
      id: info.id,
      label: labelOf(info.name, info.type, info.description),
      tier: 'grey',
      role: roleOf(info.type),
      status: info.status === 'idle' ? 'idle' : 'working',
      room: home,
      pose: 'idle',
      home,
      teammate: true,
    }
    if (info.parentId !== undefined) agent.parentId = info.parentId
    next = { ...next, [info.id]: agent }
  }

  return next
}

const inKitchen = (map: OfficeMap, at: Motion[string]): boolean => {
  const room = map.rooms.find(r => r.id === 'kitchen')
  if (room === undefined) return false
  const { x, y, w, h } = room.bounds

  return at.path.length === 0 && at.x >= x && at.x < x + w && at.y >= y && at.y < y + h
}

// Removes a finished agent (D15) only once it stands in the Kitchen with an empty path
// AND DESPAWN_MS have passed since its turn completed. With no map (no pane drawn) or no
// motion entry nothing is on screen, so the time alone decides. Drops no motion entry
// itself: the tick's placeMotion drops the entries of agents no longer in the roster.
export const expire = (roster: Roster, now: number, motion: Motion, map: OfficeMap | undefined): Roster => {
  const kept = Object.values(roster).filter(agent => {
    if ((agent.status !== 'done' && agent.status !== 'leaving') || agent.completedAt === undefined) return true
    if (now - agent.completedAt < DESPAWN_MS) return true
    const at = motion[agent.id]
    if (map === undefined || at === undefined) return false

    return !inKitchen(map, at)
  })
  if (kept.length === Object.keys(roster).length) return roster

  return Object.fromEntries(kept.map(agent => [agent.id, agent]))
}

import type { AgentInfo, AgentSpawnInput } from 'claude-code'
import type { Activity } from './activity'
import type { RoomId } from './map'
import type { Pose } from './sprites'
import { DESPAWN_MS } from './timing'

// A meeting walk (D38). `text` is the speaker's bubble, shown on arrival; `until` is
// set once both stand in the Meeting Room.
export type Script = {
  kind: 'meet'
  peer: string
  phase: 'going' | 'talking' | 'returning'
  returnRoom: RoomId
  returnPose: Pose
  until?: number
  text?: string
}

export type Tier = 'haiku' | 'sonnet' | 'opus' | 'fable' | 'grey'
export type AgentStatus = 'working' | 'idle' | 'done' | 'leaving'

export type OfficeAgent = {
  id: string
  label: string
  tier: Tier
  parentId?: string
  status: AgentStatus
  room: RoomId
  pose: Pose
  // The room holding the agent's own desk; activity 'desk' resolves to it (D37).
  home: RoomId
  // A teammate has several turns: turn.complete makes it idle, never done (D26).
  teammate: boolean
  completedAt?: number
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

// An Explore-type agent works from the Library, every other spawned agent from the Dev Bay (D37).
const homeOf = (type: string): RoomId => (type.toLowerCase().includes('explore') ? 'library' : 'devbay')

const labelOf = (name: string | undefined, type: string, description: string): string =>
  name || type || description.slice(0, 12)

// A live status carries no completedAt, so expire never drops the agent.
const withStatus = (agent: OfficeAgent, status: 'working' | 'idle'): OfficeAgent => {
  const next: OfficeAgent = { ...agent, status }
  delete next.completedAt

  return next
}

export const seedMain = (roster: Roster): Roster =>
  roster.main !== undefined
    ? roster
    : {
        ...roster,
        main: { id: 'main', label: 'main', tier: 'grey', status: 'working', room: 'lobby', pose: 'idle', home: 'lobby', teammate: false },
      }

export const onSpawn = (roster: Roster, input: SpawnInput, result: SpawnResult): Roster => {
  const id = result.agentId
  if (id === undefined) return roster
  const home = homeOf(input.subagentType)
  const agent: OfficeAgent = {
    id,
    label: labelOf(input.name, input.subagentType, input.description),
    tier: tierOf(input.model) ?? tierOf(result.model) ?? 'grey',
    status: 'working',
    room: home,
    pose: 'idle',
    home,
    teammate: input.isTeammate === true,
  }
  if (input.parentAgentId !== undefined) agent.parentId = input.parentAgentId

  return { ...roster, [id]: agent }
}

export const onComplete = (roster: Roster, agentId: string, now: number): Roster => {
  const agent = roster[agentId]
  if (agent === undefined || agent.status === 'done') return roster
  if (agent.teammate) {
    if (agent.status === 'idle') return roster

    return { ...roster, [agentId]: withStatus(agent, 'idle') }
  }

  return { ...roster, [agentId]: { ...agent, status: 'done', completedAt: now } }
}

// Records what a tool call makes the agent do; 'desk' resolves to its home (D37).
// Returns the same reference when the agent is unknown, done, leaving or running a script, or nothing changes.
export const onActivity = (roster: Roster, agentId: string, activity: Activity): Roster => {
  const agent = roster[agentId]
  if (agent === undefined || agent.status === 'done' || agent.status === 'leaving') return roster
  if (agent.script !== undefined) return roster
  const room = activity.room === 'desk' ? agent.home : activity.room
  if (agent.room === room && agent.pose === activity.pose) return roster

  return { ...roster, [agentId]: { ...agent, room, pose: activity.pose } }
}

// Adds listed agents the roster does not know yet and revives a done agent the list
// reports running (a new turn); never removes one.
export const syncList = (roster: Roster, infos: readonly AgentInfo[]): Roster => {
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
    const home = homeOf(info.type)
    const agent: OfficeAgent = {
      id: info.id,
      label: labelOf(info.name, info.type, info.description),
      tier: 'grey',
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

// Plain removal of done agents once DESPAWN_MS have passed; T09 replaces the rule.
export const expire = (roster: Roster, now: number): Roster => {
  const kept = Object.values(roster).filter(
    agent => agent.status !== 'done' || agent.completedAt === undefined || now - agent.completedAt < DESPAWN_MS,
  )
  if (kept.length === Object.keys(roster).length) return roster

  return Object.fromEntries(kept.map(agent => [agent.id, agent]))
}

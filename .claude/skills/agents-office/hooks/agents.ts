import type { AgentInfo, AgentSpawnInput } from 'claude-code'
import { DESPAWN_MS } from './timing'

export type Tier = 'haiku' | 'sonnet' | 'opus' | 'fable' | 'grey'
export type AgentStatus = 'working' | 'idle' | 'done' | 'leaving'

// `room` and `pose` are plain strings for now: map.ts (T03) and sprites.ts (T04)
// narrow them to their own unions later.
export type OfficeAgent = {
  id: string
  label: string
  tier: Tier
  parentId?: string
  status: AgentStatus
  room: string
  pose: string
  completedAt?: number
}

export type Roster = Record<string, OfficeAgent>

export type SpawnInput = Pick<
  AgentSpawnInput,
  'name' | 'subagentType' | 'description' | 'model' | 'parentAgentId'
>
// The slice of AgentSpawnResult the reducer reads; a deny carries no agentId.
export type SpawnResult = { model?: string; agentId?: string }

const TIERS = ['haiku', 'sonnet', 'opus', 'fable'] as const

const tierOf = (text: string | undefined): Tier | undefined => {
  if (text === undefined) return undefined
  const lower = text.toLowerCase()
  return TIERS.find(tier => lower.includes(tier))
}

const labelOf = (name: string | undefined, type: string, description: string): string =>
  name || type || description.slice(0, 12)

export const seedMain = (roster: Roster): Roster =>
  roster.main !== undefined
    ? roster
    : {
        ...roster,
        main: { id: 'main', label: 'main', tier: 'grey', status: 'working', room: 'lobby', pose: 'idle' },
      }

export const onSpawn = (roster: Roster, input: SpawnInput, result: SpawnResult): Roster => {
  const id = result.agentId
  if (id === undefined) return roster
  const agent: OfficeAgent = {
    id,
    label: labelOf(input.name, input.subagentType, input.description),
    tier: tierOf(input.model) ?? tierOf(result.model) ?? 'grey',
    status: 'working',
    room: 'lobby',
    pose: 'idle',
  }
  if (input.parentAgentId !== undefined) agent.parentId = input.parentAgentId

  return { ...roster, [id]: agent }
}

export const onComplete = (roster: Roster, agentId: string, now: number): Roster => {
  const agent = roster[agentId]
  if (agent === undefined || agent.status === 'done') return roster

  return { ...roster, [agentId]: { ...agent, status: 'done', completedAt: now } }
}

// Adds listed agents the roster does not know yet; never removes or edits one.
export const syncList = (roster: Roster, infos: readonly AgentInfo[]): Roster => {
  let next = roster
  for (const info of infos) {
    if (next[info.id] !== undefined) continue
    if (info.status !== 'running' && info.status !== 'idle' && info.status !== 'waiting') continue
    const agent: OfficeAgent = {
      id: info.id,
      label: labelOf(info.name, info.type, info.description),
      tier: 'grey',
      status: info.status === 'idle' ? 'idle' : 'working',
      room: 'lobby',
      pose: 'idle',
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

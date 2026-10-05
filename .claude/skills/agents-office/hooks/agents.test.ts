import { expect, test } from 'claude-code/testing'
import { expire, onActivity, onComplete, onSpawn, roleOf, seedMain, syncList } from './agents'
import type { Roster, SpawnInput } from './agents'
import { buildMap } from './map'

const input = (over: Partial<SpawnInput> = {}): SpawnInput => ({
  subagentType: 'general-purpose',
  description: 'Investigate the flaky tests',
  ...over,
})

test('spawn labels an agent by name, then type, then description', async () => {
  const label = (spawn: SpawnInput): string | undefined =>
    onSpawn({}, spawn, { agentId: 'a1' }).a1?.label

  expect(label(input({ name: 'scout' }))).toBe('scout')
  expect(label(input())).toBe('general-purpose')
  expect(label(input({ subagentType: '' }))).toBe('Investigate ')
})

test('tier comes from the alias, then the resolved model, else grey', async () => {
  const tier = (model: string | undefined, resolved: string): string | undefined =>
    onSpawn({}, input(model === undefined ? {} : { model }), { agentId: 'a1', model: resolved }).a1?.tier

  expect(tier('haiku', 'claude-opus-5-5')).toBe('haiku')
  expect(tier(undefined, 'claude-sonnet-5-5')).toBe('sonnet')
  expect(tier('inherit', 'claude-opus-5-5')).toBe('opus')
  expect(tier(undefined, 'some-other-model')).toBe('grey')
})

test('syncList adds a teammate and never removes a known agent', async () => {
  const known: Roster = onSpawn(seedMain({}), input(), { agentId: 'a1' })
  const teammate = { id: 'bot', description: 'watch ci', type: 'teammate', status: 'idle', name: 'bot' } as const
  const finished = { id: 'old', description: 'done long ago', type: 'Explore', status: 'completed' } as const
  const next = syncList(known, [teammate, finished])

  expect(next.bot).toMatchObject({ label: 'bot', tier: 'grey', status: 'idle' })
  expect(next.old).toBeUndefined()
  expect(Object.keys(next)).toEqual(expect.arrayContaining(['main', 'a1', 'bot']))
  expect(syncList(next, [])).toBe(next)
})

const map = buildMap(60, 18)
const breakAnchor = map.rooms.find(r => r.id === 'break')?.anchors[0] ?? { x: 0, y: 0 }
const lobbyAnchor = map.rooms.find(r => r.id === 'lobby')?.anchors[0] ?? { x: 0, y: 0 }

test('expire keeps a done agent until it is in the Break Room and 5000 ms have passed', async () => {
  const done = onComplete(onSpawn({}, input(), { agentId: 'a1' }), 'a1', 1000)
  const leaving: Roster = { a1: { ...done.a1!, status: 'leaving' } }
  const at = (p: { x: number; y: number }, path: Array<{ x: number; y: number }> = []) => ({ a1: { x: p.x, y: p.y, path, frame: 0 } })

  expect(done.a1).toMatchObject({ status: 'done', completedAt: 1000 })
  // In the Break Room: still kept before 5000 ms, gone at exactly 5000 ms.
  expect(expire(leaving, 5999, at(breakAnchor), map).a1).toBeDefined()
  expect(expire(leaving, 6000, at(breakAnchor), map).a1).toBeUndefined()
  // Long past 5000 ms but elsewhere, or still walking in the Break Room: kept.
  expect(expire(done, 99999, at(lobbyAnchor), map)).toBe(done)
  expect(expire(leaving, 99999, at(breakAnchor, [lobbyAnchor]), map).a1).toBeDefined()
  // Nothing drawn (no map or no motion entry): the time alone decides.
  expect(expire(done, 5999, {}, map).a1).toBeDefined()
  expect(expire(done, 6000, {}, map).a1).toBeUndefined()
  expect(expire(done, 6000, at(lobbyAnchor), undefined).a1).toBeUndefined()
})

test("a teammate's turn.complete makes it idle, not done", async () => {
  const spawned = onSpawn({}, input({ isTeammate: true }), { agentId: 't1' })
  const idle = onComplete(spawned, 't1', 1000)

  expect(idle.t1).toMatchObject({ status: 'idle', teammate: true })
  expect(idle.t1?.completedAt).toBeUndefined()
  expect(onComplete(idle, 't1', 2000)).toBe(idle)
  expect(expire(idle, 1_000_000, {}, map).t1).toBeDefined()
})

test('syncList revives a done agent the list reports running', async () => {
  const done = onComplete(onSpawn({}, input(), { agentId: 'a1' }), 'a1', 1000)
  const info = (status: 'running' | 'idle') => ({ id: 'a1', description: 'd', type: 'x', status })

  expect(syncList(done, [info('idle')])).toBe(done)
  const revived = syncList(done, [info('running')])
  expect(revived.a1).toMatchObject({ status: 'working' })
  expect(revived.a1?.completedAt).toBeUndefined()
})

test("onActivity resolves 'desk' to home and ignores unknown, repeated and done agents", async () => {
  const desk = { room: 'desk', pose: 'type' } as const
  const roster = onSpawn(onSpawn({}, input(), { agentId: 'a1' }), input({ subagentType: 'Explore' }), { agentId: 'a2' })

  const typed = onActivity(roster, 'a1', desk)
  expect(typed.a1).toMatchObject({ room: 'devbay', pose: 'type' })
  expect(onActivity(roster, 'a2', desk).a2).toMatchObject({ room: 'library', pose: 'type' })
  expect(onActivity(typed, 'a1', desk)).toBe(typed)
  expect(onActivity(roster, 'nobody', desk)).toBe(roster)
  const done = onComplete(roster, 'a1', 1000)
  expect(onActivity(done, 'a1', { room: 'server', pose: 'run' })).toBe(done)
})

test('a second turn.complete on a leaving agent returns the same roster', () => {
  const roster: Roster = onSpawn(seedMain({}), input(), { agentId: 'a1' })
  const done = onComplete(roster, 'a1', 100)
  const base = done.a1
  if (base === undefined) throw new Error('a1 missing')
  const leaving: Roster = { ...done, a1: { ...base, status: 'leaving' } }

  expect(onComplete(leaving, 'a1', 999)).toBe(leaving)
})

test('role comes from the agent type: main leads, review, research, else dev', () => {
  expect(seedMain({}).main?.role).toBe('lead')
  expect(roleOf('code-reviewer')).toBe('review')
  expect(roleOf('Explore')).toBe('research')
  expect(roleOf('deep-researcher')).toBe('research')
  expect(roleOf('quick-search')).toBe('research')
  expect(roleOf('general-purpose')).toBe('dev')
  expect(onSpawn({}, input({ subagentType: 'code-reviewer' }), { agentId: 'a1' }).a1?.role).toBe('review')
  const listed = syncList({}, [{ id: 'x', description: 'd', type: 'Explore', status: 'running' }])
  expect(listed.x?.role).toBe('research')
})

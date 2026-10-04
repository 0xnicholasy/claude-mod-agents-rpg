import { expect, test } from 'claude-code/testing'
import { expire, onComplete, onSpawn, seedMain, syncList } from './agents'
import type { Roster, SpawnInput } from './agents'

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

test('expire drops a done agent only after 5000 ms', async () => {
  const done = onComplete(onSpawn({}, input(), { agentId: 'a1' }), 'a1', 1000)

  expect(done.a1).toMatchObject({ status: 'done', completedAt: 1000 })
  expect(expire(done, 5999).a1).toBeDefined()
  expect(expire(done, 6000).a1).toBeUndefined()
})

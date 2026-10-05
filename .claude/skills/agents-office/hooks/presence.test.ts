import { expect, test } from 'claude-code/testing'
import type { OfficeAgent, Roster } from './agents'
import { asShare, envValue, MAX_RECORD_BYTES, parseOfficeArgs, presenceDir, presencePath, signature, toRecord, toTombstone, writeDue } from './presence'

test('presence dir prefers CLAUDE_CONFIG_DIR', () => {
  expect(presenceDir('/c', '/h')).toBe('/c/agents-office/presence')
  expect(presenceDir('', '/h')).toBe('/h/.claude/agents-office/presence')
  expect(presenceDir('', '')).toBeUndefined()
})

test('a failed printenv gives an empty value', () => {
  expect(envValue('/c\n', true)).toBe('/c')
  expect(envValue('', false)).toBe('')
  expect(envValue('/c\n', false)).toBe('')
})

test('the share mode falls back to all', () => {
  expect(asShare('off')).toBe('off')
  expect(asShare('bogus')).toBe('all')
  expect(asShare(undefined)).toBe('all')
})

test('office arguments split into open, share and usage', () => {
  expect(parseOfficeArgs('')).toEqual({ kind: 'open' })
  expect(parseOfficeArgs(undefined)).toEqual({ kind: 'open' })
  expect(parseOfficeArgs(' share ANON ')).toEqual({ kind: 'share', mode: 'anon' })
  expect(parseOfficeArgs('share bogus')).toEqual({ kind: 'usage' })
  expect(parseOfficeArgs('share')).toEqual({ kind: 'usage' })
  expect(parseOfficeArgs('hello')).toEqual({ kind: 'usage' })
})

const agentAt = (id: string, over: Partial<OfficeAgent> = {}): OfficeAgent => ({
  id,
  label: id,
  tier: 'sonnet',
  role: 'dev',
  status: 'working',
  room: 'team:s1',
  pose: 'type',
  home: 'team:s1',
  teammate: false,
  ...over,
})

const input = (roster: Roster, share: 'all' | 'anon' = 'all') => ({
  sessionId: 's1',
  startedAt: 10,
  now: 20,
  share,
  team: { label: 'proj (main)', branch: 'main' },
  roster,
})

test('a record never carries paths or message text', () => {
  const roster: Roster = {
    main: agentAt('main', { role: 'lead', tool: 'Read', seenAt: 5 }),
    a1: agentAt('a1', {
      tool: 'Edit /Users/x/secret.ts',
      script: { kind: 'meet', peer: 'main', phase: 'talking', returnRoom: 'team:s1', returnPose: 'type', returnAt: { x: 1, y: 1 }, text: 'hunter2' },
    }),
  }
  const text = JSON.stringify(toRecord(input(roster)))

  expect(text).not.toContain('/Users/x/secret.ts')
  expect(text).not.toContain('hunter2')
  expect(text).not.toContain('Read')
  expect(text).not.toContain('tool')
  expect(Object.keys(JSON.parse(text)).sort()).toEqual(['agents', 'heartbeatAt', 'player', 'sessionId', 'share', 'startedAt', 'team', 'v'])
})

test('records cap at 32 agents and 8 KB', () => {
  const many: Roster = {}
  for (let i = 0; i < 40; i += 1) many[`a${i}`] = agentAt(`a${i}`)
  many.main = agentAt('main', { role: 'lead' })
  const record = toRecord(input(many))
  expect(record.agents).toHaveLength(32)
  expect(record.agents[0]?.id).toBe('main')
  expect(record.agents[1]?.id).toBe('a39')

  const long: Roster = {}
  for (let i = 0; i < 32; i += 1) long[`${'x'.repeat(60)}${i}`] = agentAt(`${'x'.repeat(60)}${i}`, { label: 'y'.repeat(200), parentId: 'p'.repeat(200) })
  const big = toRecord(input(long))
  expect(new TextEncoder().encode(JSON.stringify(big)).length).toBeLessThanOrEqual(MAX_RECORD_BYTES)
  expect(big.agents.every(a => Array.from(a.label).length <= 16)).toBe(true)
})

test('anon strips the team and names agents by role', () => {
  const record = toRecord(input({ main: agentAt('main', { role: 'lead', label: 'secret-name' }), a1: agentAt('a1', { label: 'reviewer' }) }, 'anon'))

  expect(record.team).toEqual({ label: '', branch: '' })
  expect(record.agents.map(a => a.label)).toEqual(['lead', 'dev'])
  expect(record.share).toBe('anon')
})

test('a label taken from a task description is published as the role', () => {
  const record = toRecord(input({ a1: agentAt('a1', { label: 'fix /Users/x', described: true }) }))

  expect(record.agents[0]?.label).toBe('dev')
})

test('control characters in a label are cleaned', () => {
  const record = toRecord(input({ main: agentAt('main', { label: 'a\u001b[31mb' }) }))

  expect(record.agents[0]?.label).toBe('a [31mb')
})

test('a write is due on change or 3000 ms after the last write', () => {
  const text = signature(toRecord(input({ main: agentAt('main') })))
  expect(writeDue(undefined, 0, text, 1000)).toBe(true)
  expect(writeDue(text, 1000, text, 2000)).toBe(false)
  expect(writeDue(text, 1000, text, 4000)).toBe(true)
  expect(writeDue(text, 1000, `${text} `, 2000)).toBe(true)
})

test('the signature ignores the heartbeat and a tombstone is marked gone', () => {
  const a = toRecord(input({ main: agentAt('main') }))
  expect(signature(a)).toBe(signature({ ...a, heartbeatAt: 999 }))
  expect(toTombstone('s1', 5)).toEqual({ v: 1, sessionId: 's1', heartbeatAt: 5, gone: true })
})

test('the presence path refuses a session id that could leave the dir', () => {
  expect(presencePath('/d', 'abc-123')).toBe('/d/abc-123.json')
  expect(presencePath('/d', '../x')).toBeUndefined()
  expect(presencePath('/d', '..')).toBeUndefined()
  expect(presencePath('/d', '')).toBeUndefined()
})

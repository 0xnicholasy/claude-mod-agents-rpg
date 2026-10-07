import { expect, test } from 'claude-code/testing'
import type { OfficeAgent, Roster } from './agents'
import { asScene, asShare, placeRemotePlayer, remotePlayersOf, toPresencePlayer, envValue, MAX_RECORD_BYTES, mergeRemote, parseOfficeArgs, parseRecord, planReads, presenceDir, presencePath, signature, toRecord, toTombstone, writeDue } from './presence'
import { buildOffice, canStand as canStandAt, MID_FOOT } from './map'
import type { OfficeMap } from './map'
import type { Parsed, PresenceRecord } from './presence'

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

test('the scene mode falls back to text', () => {
  expect(asScene('image')).toBe('image')
  expect(asScene('bogus')).toBe('text')
  expect(asScene(undefined)).toBe('text')
})

test('/office scene takes auto, image or text and anything else is the scene usage', () => {
  expect(parseOfficeArgs('scene image')).toEqual({ kind: 'scene', mode: 'image' })
  expect(parseOfficeArgs(' Scene AUTO ')).toEqual({ kind: 'scene', mode: 'auto' })
  expect(parseOfficeArgs('scene text')).toEqual({ kind: 'scene', mode: 'text' })
  expect(parseOfficeArgs('scene bogus')).toEqual({ kind: 'usage', topic: 'scene' })
  expect(parseOfficeArgs('scene')).toEqual({ kind: 'usage', topic: 'scene' })
  expect(parseOfficeArgs('scene image extra')).toEqual({ kind: 'usage', topic: 'scene' })
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

test('the team label and branch keep 40 characters while agent labels keep 16', () => {
  const label = 'claude-mod-agents-rpg (feat/agents-office-v2-extra-long)'
  const record = toRecord({ ...input({ main: agentAt('main', { label: 'x'.repeat(30) }) }), team: { label, branch: 'b'.repeat(80) } })

  expect(record.team.label).toBe(label.slice(0, 40))
  expect(record.team.branch).toBe('b'.repeat(40))
  expect(record.agents[0]?.label).toBe('x'.repeat(16))
  expect(toRecord({ ...input({}), team: { label: 'claude-mod-agents-rpg', branch: 'main' } }).team.label).toBe('claude-mod-agents-rpg')
})

const recordText = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ ...toRecord(input({ main: agentAt('main', { role: 'lead' }), a1: agentAt('a1') })), ...over })

const recordOf = (text: string): PresenceRecord => {
  const parsed = parseRecord(text)
  if (parsed?.kind !== 'record') throw new Error('expected a record')

  return parsed.record
}

test('parseRecord accepts a valid record', () => {
  const record = recordOf(recordText())

  expect(record.sessionId).toBe('s1')
  expect(record.agents.map(a => a.id)).toEqual(['main', 'a1'])
  expect(parseRecord(JSON.stringify(toTombstone('s1', 5)))).toEqual({ kind: 'gone', sessionId: 's1' })
})

test('parseRecord rejects a wrong version, wrong types, oversize and non-JSON input', () => {
  expect(parseRecord(recordText({ v: 2 }))).toBeUndefined()
  expect(parseRecord(recordText({ heartbeatAt: '20' }))).toBeUndefined()
  expect(parseRecord(recordText({ sessionId: '../x' }))).toBeUndefined()
  expect(parseRecord(recordText({ share: 'off' }))).toBeUndefined()
  expect(parseRecord(recordText({ team: 'x' }))).toBeUndefined()
  expect(parseRecord(recordText({ agents: {} }))).toBeUndefined()
  expect(parseRecord(`${recordText().slice(0, 30)}`)).toBeUndefined()
  expect(parseRecord('[]')).toBeUndefined()
  expect(parseRecord(recordText({ pad: 'x'.repeat(MAX_RECORD_BYTES) }))).toBeUndefined()
})

test('parseRecord clamps lengths and counts and drops unknown tiers and rooms', () => {
  const agent = (i: number, over: Record<string, unknown> = {}) => ({ id: `a${i}`, label: 'l'.repeat(40), tier: 'opus', role: 'dev', room: 'lab', pose: 'run', status: 'working', ...over })
  const agents = Array.from({ length: 40 }, (_, i) => agent(i))
  agents[1] = agent(1, { tier: 'gpt' })
  agents[2] = agent(2, { room: 'team:' })
  agents[3] = agent(3, { room: 'nowhere' })
  agents[4] = agent(4, { id: 'a0' })
  const record = recordOf(recordText({ agents, team: { label: 'L'.repeat(90), branch: 'B'.repeat(90) } }))

  expect(record.agents).toHaveLength(32 - 4)
  expect(record.agents.some(a => a.id === 'a1' || a.id === 'a2' || a.id === 'a3')).toBe(false)
  expect(record.agents[0]?.label).toBe('l'.repeat(16))
  expect(record.team).toEqual({ label: 'L'.repeat(40), branch: 'B'.repeat(40) })
})

test('a published chat line is cleaned and cut to 40, and the expiries are kept apart', () => {
  const parsed = recordOf(recordText({ player: { room: 'team:s1', rx: 1, ry: 1, facing: 'down', chat: `a\u0007${'c'.repeat(60)}`, chatUntil: 7, emote: '!', emoteUntil: 3 } })).player

  expect(parsed?.chat).toBe(`a ${'c'.repeat(38)}`)
  expect(parsed).toMatchObject({ chatUntil: 7, emoteUntil: 3 })
})

test('parseRecord validates the published player', () => {
  const player = { room: 'team:s1', rx: 9999, ry: -4, facing: 'left', chat: 'c'.repeat(90) }

  expect(recordOf(recordText({ player })).player).toEqual({ room: 'team:s1', rx: 200, ry: 0, facing: 'left', chat: 'c'.repeat(40) })
  expect(recordOf(recordText({ player: { ...player, facing: 'up-left' } })).player).toBeNull()
})

const NOW = 100000
const rec = (id: string, heartbeatAt: number): PresenceRecord => recordOf(JSON.stringify({ ...toRecord({ ...input({ main: agentAt('main') }), sessionId: id }), heartbeatAt }))
const entry = (name: string, mtimeMs: number, size = 100) => ({ name, kind: 'file' as const, size, mtimeMs })

test('planReads skips the own file, stale files, odd names and unchanged mtimes', () => {
  const entries = [entry('me.json', NOW), entry('a.json', NOW - 1000), entry('b.json', NOW - 20000), entry('c.txt', NOW), entry('d.json', NOW), { name: 'sub', kind: 'dir' as const, size: 0, mtimeMs: 0 }, entry('..json', NOW), entry('constructor.json', NOW), entry('__proto__.json', NOW), entry('big.json', NOW, 9000)]
  const plan = planReads(entries, 'me', { d: NOW }, NOW)

  expect(plan.listed.sort()).toEqual(['a', 'd'])
  expect(plan.toRead.map(f => f.sessionId)).toEqual(['a'])
})

test('a stale or tombstoned session is dropped', () => {
  const prev = { a: rec('a', NOW - 1000), b: rec('b', NOW - 1000), c: rec('c', NOW - 1000), d: rec('d', NOW - 1000) }
  const parsed: Record<string, Parsed | null> = {
    a: { kind: 'record', record: rec('a', NOW - 10001) },
    b: { kind: 'gone', sessionId: 'b' },
    c: { kind: 'record', record: rec('c', NOW - 500) },
  }
  const next = mergeRemote(prev, parsed, NOW, ['a', 'b', 'c', 'd'])

  expect(Object.keys(next).sort()).toEqual(['c', 'd'])
  expect(next.d).toBe(prev.d)
  expect(mergeRemote(prev, {}, NOW + 20000, ['a'])).toEqual({})
  expect(mergeRemote(prev, { a: { kind: 'record', record: rec('x', NOW) } }, NOW, ['a'])).toEqual({})
})

test('a partial file keeps the last snapshot', () => {
  const prev = { a: rec('a', NOW - 2000) }

  expect(mergeRemote(prev, { a: null }, NOW, ['a'])).toBe(prev)
  expect(mergeRemote(prev, {}, NOW, ['a'])).toBe(prev)
  expect(mergeRemote(prev, {}, NOW, [])).toEqual({})
})

const teamMap = (columns: number) => buildOffice(columns, 18, [{ id: 'team:s1', label: 'proj' }])

test('a remote player round-trips in a same-size room', () => {
  const map = teamMap(80)
  const room = map.rooms.find(r => r.id === 'team:s1')
  const spot = room?.anchors[1] ?? { x: 0, y: 0 }
  const published = toPresencePlayer(map, { x: spot.x, y: spot.y, facing: 'left' }, 0)

  expect(published).toEqual({ room: 'team:s1', rx: spot.x - (room?.bounds.x ?? 0), ry: spot.y - (room?.bounds.y ?? 0), facing: 'left' })
  expect(published === null ? undefined : placeRemotePlayer(map, published)).toEqual(spot)
  // It survives the file: published, serialized and parsed again.
  const parsed = recordOf(JSON.stringify({ ...toRecord({ ...input({}), player: published }), heartbeatAt: 20 }))
  expect(parsed.player).toEqual(published)
})

test('a remote player is clamped into a narrower room', () => {
  const wide = teamMap(120)
  const narrow = teamMap(60)
  const wideRoom = wide.rooms.find(r => r.id === 'team:s1')
  const narrowRoom = narrow.rooms.find(r => r.id === 'team:s1')
  if (wideRoom === undefined || narrowRoom === undefined) throw new Error('no team room')
  const published = { room: 'team:s1' as const, rx: wideRoom.bounds.w - 3, ry: 0, facing: 'down' as const }
  const at = placeRemotePlayer(narrow, published)

  expect(narrowRoom.bounds.w).toBeLessThan(wideRoom.bounds.w)
  expect(at).toBeDefined()
  expect(at !== undefined && at.x + 3 <= narrowRoom.bounds.x + narrowRoom.bounds.w && at.x >= narrowRoom.bounds.x).toBe(true)
  expect(at !== undefined && canStandAt(narrow, at.x, at.y)).toBe(true)
  // A room that is not on the map draws nothing.
  expect(placeRemotePlayer(narrow, { ...published, room: 'team:gone' })).toBeUndefined()
})

test('a published emote lasts only until it expires and a player in the corridor lands in a room', () => {
  const map = teamMap(80)
  const base = { x: map.corridor.x + 2, y: map.corridor.y, facing: 'down' as const }

  expect(toPresencePlayer(map, { ...base, emote: '!', emoteUntil: 500 }, 400)?.emote).toBe('!')
  expect(toPresencePlayer(map, { ...base, emote: '!', emoteUntil: 500 }, 500)?.emote).toBeUndefined()
  const room = toPresencePlayer(map, base, 0)?.room
  expect(map.rooms.some(r => r.id === room)).toBe(true)
  const remote = { s2: { ...rec('s2', 20), player: { room: 'team:s1' as const, rx: 0, ry: 0, facing: 'up' as const } } }
  expect(remotePlayersOf(remote, map)).toHaveLength(1)
  expect(remotePlayersOf({ s2: rec('s2', 20) }, map)).toHaveLength(0)
})

test('a published player carries only its documented keys and a forged expiry is capped', () => {
  const map = teamMap(80)
  const published = toPresencePlayer(map, { x: 20, y: 3, facing: 'up', emote: '!', emoteUntil: 900, chat: 'hello', chatUntil: 1200 }, 0)
  expect(Object.keys(published ?? {}).sort()).toEqual(['chat', 'chatUntil', 'emote', 'emoteUntil', 'facing', 'room', 'rx', 'ry'])
  const forged = { s2: { ...rec('s2', 20), player: { room: 'team:s1' as const, rx: 0, ry: 0, facing: 'up' as const, emote: '!', emoteUntil: 9e15, chat: 'hi', chatUntil: 9e15 } } }

  expect(remotePlayersOf(forged, map)[0]).toMatchObject({ emoteUntil: 3020, chatUntil: 5020 })
  // A chat that has run out is not published, and the emote keeps its own expiry.
  expect(toPresencePlayer(map, { x: 20, y: 3, facing: 'up', emote: '!', emoteUntil: 2000, chat: 'hello', chatUntil: 1000 }, 1500)).toMatchObject({ emote: '!', emoteUntil: 2000 })
})

test('a remote player moves between figure sizes', () => {
  const teams = [1, 2, 3, 4, 5].map(n => ({ id: `team:s${n}` as const, label: `p${n}` }))
  const small = buildOffice(60, 18, teams)
  const mid = buildOffice(100, 23, teams.slice(0, 2), MID_FOOT)
  const roomOf = (map: OfficeMap) => {
    const room = map.rooms.find(r => r.id === 'team:s1')
    if (room === undefined) throw new Error('no team room')
    return room
  }
  const smallRoom = roomOf(small)
  const midRoom = roomOf(mid)
  const inside = (map: OfficeMap, at: { x: number; y: number } | undefined, room: ReturnType<typeof roomOf>): boolean =>
    at !== undefined &&
    canStandAt(map, at.x, at.y) &&
    at.x >= room.bounds.x && at.x + map.foot.w <= room.bounds.x + room.bounds.w &&
    at.y >= room.bounds.y && at.y + map.foot.h <= room.bounds.y + room.bounds.h
  expect(smallRoom.bounds.w).toBeLessThan(17)
  expect(midRoom.bounds.w).toBeGreaterThanOrEqual(17)
  // The far corner of a small room (a 3x2 figure) lands on a standable tile of the mid room.
  const fromSmall = { room: 'team:s1' as const, rx: smallRoom.bounds.w - 3, ry: smallRoom.bounds.h - 2, facing: 'down' as const }
  expect(inside(mid, placeRemotePlayer(mid, fromSmall), midRoom)).toBe(true)
  // The far corner of a mid room (a 5x5 figure) lands on a standable tile of the small room.
  const fromMid = { room: 'team:s1' as const, rx: midRoom.bounds.w - 5, ry: midRoom.bounds.h - 5, facing: 'up' as const }
  expect(inside(small, placeRemotePlayer(small, fromMid), smallRoom)).toBe(true)
  // A figure beside the left wall of the mid room stays at the left edge of the small one.
  expect(placeRemotePlayer(small, { ...fromMid, rx: 0, ry: 0 })).toMatchObject({ x: smallRoom.bounds.x })
})

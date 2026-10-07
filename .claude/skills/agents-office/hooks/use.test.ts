import { expect, test } from 'claude-code/testing'
import type { OfficeAgent, Roster } from './agents'
import type { Cat } from './cat'
import type { Motion } from './frame'
import { ITEMS } from './items'
import type { Item, ItemKind } from './items'
import { MID_FOOT, SMALL_FOOT } from './map'
import { boardLines, COOLER_LINES, deskOwner, hintOf, MUG_MS, nodesOfTodos, NO_PLAN, outcomeOf, rackLines, rectGap, settleAct, targetOf } from './use'
import type { Act, AgentListItem, BoardNode, Target, TargetInput, UseCtx } from './use'
import { PEEK_MAX, PEEK_WIDTH } from './inspect'

const agent = (id: string, label = id): OfficeAgent => ({
  id,
  label,
  tier: 'sonnet',
  status: 'working',
  room: 'team:s0',
  pose: 'idle',
  home: 'team:s0',
  teammate: false,
})
const at = (x: number, y: number, path: Motion[string]['path'] = []): Motion[string] => ({ x, y, path, frame: 0 })
const item = (kind: ItemKind, x: number, y: number, over: Partial<Item> = {}): Item => ({
  id: `${kind}:r:${x}`,
  kind,
  label: ITEMS[kind].label,
  rect: { x, y, w: 3, h: 2 },
  ...over,
})
const catAt = (x: number, y: number): Cat => ({ x, y, facing: 'left', frame: 0, path: [], restUntil: 0, seed: 1 })
const base = (over: Partial<TargetInput> = {}): TargetInput => ({
  player: { x: 10, y: 10 },
  foot: SMALL_FOOT,
  agents: {},
  motion: {},
  items: [],
  ...over,
})

test('rectGap is 0 when rects touch and adds both axes', () => {
  expect(rectGap({ x: 0, y: 0, w: 3, h: 2 }, { x: 3, y: 0, w: 3, h: 2 })).toBe(0)
  expect(rectGap({ x: 0, y: 0, w: 3, h: 2 }, { x: 4, y: 0, w: 3, h: 2 })).toBe(1)
  expect(rectGap({ x: 0, y: 0, w: 3, h: 2 }, { x: 5, y: 3, w: 3, h: 2 })).toBe(3)
  expect(rectGap({ x: 5, y: 3, w: 3, h: 2 }, { x: 0, y: 0, w: 3, h: 2 })).toBe(3)
})

test('an agent at gap 2 loses to an item at gap 1', () => {
  const roster: Roster = { a: agent('a') }
  const target = targetOf(base({ agents: roster, motion: { a: at(12, 10) }, items: [item('coffee', 14, 10)] }))
  expect(target?.kind).toBe('item')
  expect(target?.gap).toBe(1)
  // Alone, the same agent is the target at gap 2.
  expect(targetOf(base({ agents: roster, motion: { a: at(12, 10) } }))).toEqual({ kind: 'agent', id: 'a', gap: 2 })
})

test('an agent past the v2 inspect range is not a target, at small and mid footprints', () => {
  const roster: Roster = { a: agent('a') }
  expect(targetOf(base({ agents: roster, motion: { a: at(13, 10) } }))).toBeUndefined()
  // Mid body ends at x=15: an agent at x=18 is a footprint gap of 3.
  expect(targetOf(base({ foot: MID_FOOT, agents: roster, motion: { a: at(18, 10) } }))).toBeUndefined()
})

test('the cat keeps its small footprint on a mid map', () => {
  const mid = { foot: MID_FOOT }
  expect(targetOf(base({ ...mid, cat: catAt(16, 10) }))).toEqual({ kind: 'cat', gap: 1 })
  expect(targetOf(base({ ...mid, cat: catAt(17, 10) }))).toBeUndefined()
})

test('equal gap: agent beats cat beats item', () => {
  const roster: Roster = { a: agent('a') }
  const all = base({ agents: roster, motion: { a: at(11, 10) }, cat: catAt(14, 10), items: [item('coffee', 14, 10)] })
  expect(targetOf(all)).toEqual({ kind: 'agent', id: 'a', gap: 1 })
  expect(targetOf({ ...all, agents: {}, motion: {} })).toEqual({ kind: 'cat', gap: 1 })
  expect(targetOf({ ...all, agents: {}, motion: {}, cat: undefined })?.kind).toBe('item')
})

test('a nearer item beats a farther agent, cat or item', () => {
  const roster: Roster = { a: agent('a') }
  const target = targetOf(base({ agents: roster, motion: { a: at(11, 10) }, cat: catAt(14, 10), items: [item('sofa', 13, 10)] }))
  expect(target?.kind).toBe('item')
  expect(target?.gap).toBe(0)
})

test('an item at gap 2 and a cat at gap 2 are out of range', () => {
  expect(targetOf(base({ items: [item('rack', 15, 10)] }))).toBeUndefined()
  expect(targetOf(base({ cat: catAt(15, 10) }))).toBeUndefined()
  expect(targetOf(base({ items: [item('rack', 14, 10)] }))?.kind).toBe('item')
  // Far vertically too.
  expect(targetOf(base({ items: [item('rack', 10, 14)] }))).toBeUndefined()
  expect(targetOf(base({ items: [item('rack', 10, 13)] }))?.kind).toBe('item')
})

test('mid footprint widens the reach to the player body and keeps the agent range', () => {
  const mid = { player: { x: 10, y: 10 }, foot: MID_FOOT }
  // The 5x5 body ends at x=15: an item at x=16 is gap 1, one at x=17 is gap 2.
  expect(targetOf(base({ ...mid, items: [item('coffee', 16, 10)] }))?.gap).toBe(1)
  expect(targetOf(base({ ...mid, items: [item('coffee', 17, 10)] }))).toBeUndefined()
  // A mid agent 6 cells right is a footprint gap of 1 (v2 `nearest` with a mid foot).
  expect(targetOf(base({ ...mid, agents: { a: agent('a') }, motion: { a: at(16, 10) } }))).toEqual({ kind: 'agent', id: 'a', gap: 1 })
})

test('equal gap between items goes by table order, then lower x', () => {
  const player = { x: 10, y: 10 }
  const board = item('whiteboard', 13, 10)
  const coffee = item('coffee', 13, 10)
  expect(targetOf(base({ player, items: [coffee, board] }))).toMatchObject({ kind: 'item', item: { kind: 'whiteboard' } })
  const left = item('cooler', 7, 10)
  const right = item('cooler', 13, 10)
  // Same kind, same x: the lower id.
  const twin = item('cooler', 13, 10, { id: 'cooler:a:0' })
  expect(targetOf(base({ player, items: [right, twin] }))).toMatchObject({ item: { id: 'cooler:a:0' } })
  expect(targetOf(base({ player, items: [right, left] }))).toMatchObject({ item: { rect: { x: 7 } } })
})

test('deskOwner finds the agent resting at the anchor or walking to it', () => {
  const desk = item('desk', 20, 4, { anchor: { x: 20, y: 4 } })
  const roster: Roster = { a: agent('a'), b: agent('b'), c: agent('c') }
  const motion: Motion = { a: at(30, 8), b: at(20, 4), c: at(25, 9, [{ x: 22, y: 9 }, { x: 20, y: 4 }]) }
  expect(deskOwner(desk, motion, roster)?.id).toBe('b')
  expect(deskOwner(desk, { a: motion.a ?? at(0, 0), c: motion.c ?? at(0, 0) }, roster)?.id).toBe('c')
  expect(deskOwner(desk, { a: at(30, 8) }, roster)).toBeUndefined()
  // A resting agent that still has a path is not at the anchor yet.
  expect(deskOwner(desk, { b: at(20, 4, [{ x: 1, y: 1 }]) }, roster)).toBeUndefined()
  // The anchor's row counts: the same column one row down is not the desk.
  expect(deskOwner(desk, { b: at(20, 5) }, roster)).toBeUndefined()
  expect(deskOwner(desk, { c: at(25, 9, [{ x: 20, y: 5 }]) }, roster)).toBeUndefined()
  // Two agents resting at the anchor: the lower id owns it.
  expect(deskOwner(desk, { b: at(20, 4), a: at(20, 4) }, roster)?.id).toBe('a')
  // A non-desk item has no owner.
  expect(deskOwner(item('sofa', 20, 4), motion, roster)).toBeUndefined()
})

test('hints: item label, inspect label, cat, none', () => {
  const roster: Roster = { a: agent('a', 'main') }
  expect(hintOf({ kind: 'item', item: item('coffee', 1, 1), gap: 0 }, roster)).toBe('e: coffee machine')
  expect(hintOf({ kind: 'item', item: item('rack', 1, 1), gap: 0 }, roster)).toBe('e: server rack')
  expect(hintOf({ kind: 'agent', id: 'a', gap: 1 }, roster)).toBe('e: inspect main')
  expect(hintOf({ kind: 'cat', gap: 1 }, roster)).toBe('e: pet the cat')
  expect(hintOf({ kind: 'agent', id: 'gone', gap: 1 }, roster)).toBeUndefined()
  expect(hintOf(undefined, roster)).toBeUndefined()
})

const ctxOf = (over: Partial<UseCtx> = {}): UseCtx => ({
  ownId: 'team:s0',
  roster: {},
  motion: {},
  roomNames: { 'team:s0': 'mine', 'team:s1': 'Session 2' },
  ...over,
})
const itemTarget = (kind: ItemKind, over: Partial<Item> = {}): Target => ({ kind: 'item', item: item(kind, 5, 5, over), gap: 0 })

test('each target kind has its outcome', () => {
  const ctx = ctxOf()
  expect(outcomeOf({ kind: 'agent', id: 'a', gap: 1 }, ctx, 1000, 0)).toEqual({ kind: 'inspect', id: 'a' })
  expect(outcomeOf({ kind: 'cat', gap: 1 }, ctx, 1000, 0)).toEqual({ kind: 'pet' })
  expect(outcomeOf(itemTarget('whiteboard'), ctx, 1000, 0)).toEqual({ kind: 'board' })
  expect(outcomeOf(itemTarget('rack'), ctx, 1000, 0)).toEqual({ kind: 'rack' })
  expect(outcomeOf(itemTarget('coffee'), ctx, 1000, 0)).toEqual({ kind: 'act', act: { kind: 'mug', until: 1000 + MUG_MS } })
  expect(outcomeOf(itemTarget('sofa'), ctx, 1000, 0)).toEqual({ kind: 'act', act: { kind: 'sit' } })
  expect(MUG_MS).toBe(8000)
})

test('the water cooler says one of 8 fixed lines picked by the seed', () => {
  expect(COOLER_LINES).toHaveLength(8)
  expect(new Set(COOLER_LINES).size).toBe(8)
  const say = (seed: number): string => {
    const out = outcomeOf(itemTarget('cooler'), ctxOf(), 0, seed)

    return out.kind === 'say' ? out.text : ''
  }
  for (let seed = 0; seed < 8; seed++) expect(say(seed)).toBe(COOLER_LINES[seed])
  expect(say(8)).toBe(COOLER_LINES[0])
  expect(say(-3)).toBe(COOLER_LINES[3])
  expect(say(1.9)).toBe(COOLER_LINES[1])
})

test('a desk peeks its own owner, says empty, or names a remote session without a peek', () => {
  const desk = (room: string): Target => itemTarget('desk', { room: room as Item['room'], anchor: { x: 20, y: 4 } })
  const roster: Roster = { a: agent('a', 'main') }
  const motion: Motion = { a: at(20, 4) }
  expect(outcomeOf(desk('team:s0'), ctxOf({ roster, motion }), 0, 0)).toEqual({ kind: 'peek', agentId: 'a', label: 'main' })
  expect(outcomeOf(desk('team:s0'), ctxOf(), 0, 0)).toEqual({ kind: 'line', text: 'Empty desk.' })
  // A remote desk never peeks, even with someone sitting at it.
  expect(outcomeOf(desk('team:s1'), ctxOf({ roster, motion }), 0, 0)).toEqual({ kind: 'line', text: "Session 2's desk" })
})

test('boardLines draws the plan tree with markers and indent', () => {
  const nodes: BoardNode[] = [
    { id: 'p', parentId: null, title: 'Ship it', status: 'in_progress' },
    { id: 'a', parentId: 'p', title: 'Write', status: 'completed' },
    { id: 'a1', parentId: 'a', title: 'Tests', status: 'completed' },
    { id: 'b', parentId: 'p', title: 'Review', status: 'pending' },
    { id: 'q', parentId: null, title: 'Later', status: 'blocked' },
  ]
  expect(boardLines(nodes)).toEqual(['[>] Ship it', '  [x] Write', '    [x] Tests', '  [ ] Review', '[ ] Later'])
  // Tree order, not array order: a child listed before its parent still sits under it, in its own array order.
  expect(boardLines([nodes[3] as BoardNode, ...nodes.filter(n => n.id !== 'b')])).toEqual(['[>] Ship it', '  [ ] Review', '  [x] Write', '    [x] Tests', '[ ] Later'])
  // An orphan counts as a root.
  expect(boardLines([{ id: 'o', parentId: 'gone', title: 'Orphan', status: 'pending' }])).toEqual(['[ ] Orphan'])
})

test('boardLines caps at PEEK_MAX, says No plan yet, and survives a parent cycle', () => {
  const many: BoardNode[] = Array.from({ length: 14 }, (_, i) => ({ id: `n${i}`, parentId: null, title: `step ${i}`, status: 'pending' }))
  expect(PEEK_MAX).toBe(10)
  expect(boardLines(many)).toHaveLength(10)
  expect(boardLines(many)[9]).toBe('[ ] step 9')
  expect(boardLines(undefined)).toEqual([NO_PLAN])
  expect(boardLines([])).toEqual(['No plan yet.'])
  // A parent cycle still shows, each node once; a cycle beside a valid root does not hide either.
  const loop: BoardNode[] = [{ id: 'a', parentId: 'b', title: 'a', status: 'pending' }, { id: 'b', parentId: 'a', title: 'b', status: 'pending' }]
  expect(boardLines(loop)).toEqual(['[ ] a', '  [ ] b'])
  expect(boardLines([{ id: 'r', parentId: null, title: 'root', status: 'pending' }, ...loop])).toEqual(['[ ] root', '[ ] a', '  [ ] b'])
  // A duplicate id never repeats a line.
  expect(boardLines([{ id: 'd', parentId: null, title: 'd', status: 'pending' }, { id: 'd', parentId: 'd', title: 'd', status: 'pending' }])).toHaveLength(2)
  // A flat TodoWrite list becomes root nodes in order.
  expect(boardLines(nodesOfTodos([{ content: 'one', status: 'completed' }, { content: 'two', status: 'in_progress' }, { content: 'three', status: 'pending' }]))).toEqual(['[x] one', '[>] two', '[ ] three'])
})

test('rackLines shows own tools and counts, never anything from the agent list but its status', () => {
  const roster: Roster = { a: { ...agent('a', 'main'), tool: 'Read' }, b: agent('b', 'helper') }
  // An agent list entry may carry prompt text; only `id` and `status` are read.
  const leaky = { id: 'x', status: 'running', description: 'secret prompt text', tool: 'Bash --hidden-arg' }
  const list: AgentListItem[] = [{ id: 'a', status: 'running' }, { id: 'b', status: 'idle' }, { id: 'c', status: 'completed' }, leaky]
  const lines = rackLines({ roster, agentList: list, usage: { percent: 7.6, usd: 0.4395 } })
  expect(lines).toEqual(['context: 8%', 'cost: $0.44', 'agents: 2 running, 1 idle', 'main: Read', 'helper: -'])
  expect(lines.join('\n')).not.toContain('secret')
  expect(lines.join('\n')).not.toContain('hidden-arg')
})

test('rackLines leaves out remote agents, caps its lines and prints a dash for a non-number', () => {
  const roster: Roster = { 's2:x': { ...agent('s2:x', 'remote-dev'), tool: 'Bash' }, ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`a${i}`, { ...agent(`a${i}`, `own${i}`), tool: 'Read' }])) }
  const lines = rackLines({ roster, agentList: [] })
  expect(lines.join('\n')).not.toContain('remote-dev')
  expect(lines).toHaveLength(PEEK_MAX)
  expect(lines[9]).toBe('+3 more')
  expect(lines[8]).toBe('own5: Read')
  expect(rackLines({ roster: {}, agentList: [], usage: { percent: Number.NaN, usd: Number.POSITIVE_INFINITY } }).slice(0, 2)).toEqual(['context: -', 'cost: -'])
})

test('control characters and long text never reach the board or rack', () => {
  const dirty = 'a\u001b[31mx\ny'
  const board = boardLines([{ id: 'a', parentId: null, title: dirty, status: 'pending' }, { id: 'b', parentId: null, title: 'z'.repeat(300), status: 'pending' }])
  expect(board[0]).toBe('[ ] a [31mx y')
  expect(Array.from(board[1] ?? '').length).toBe(PEEK_WIDTH)
  const rack = rackLines({ roster: { a: { ...agent('a', dirty), tool: dirty } }, agentList: [] })
  expect(rack[3]).toBe('a [31mx y: a [31mx y')
})

test('rackLines prints a dash for a missing percent or cost', () => {
  expect(rackLines({ roster: {}, agentList: [] })).toEqual(['context: -', 'cost: -', 'agents: 0 running, 0 idle'])
  expect(rackLines({ roster: {}, agentList: [], usage: { usd: 0 } })).toEqual(['context: -', 'cost: $0.00', 'agents: 0 running, 0 idle'])
  expect(rackLines({ roster: {}, agentList: [], usage: { percent: 0 } })[0]).toBe('context: 0%')
})

test('settleAct: the mug ends at until, a move clears sit and nothing else', () => {
  const holder = (act?: Act): { x: number; act?: Act } => (act === undefined ? { x: 1 } : { x: 1, act })
  const mug = holder({ kind: 'mug', until: 9000 })
  expect(settleAct(mug, 8999, false).act).toEqual({ kind: 'mug', until: 9000 })
  expect(settleAct(mug, 9000, false).act).toBeUndefined()
  expect(settleAct(mug, 9500, true).act).toBeUndefined()
  // Walking with the mug keeps it until it runs out.
  expect(settleAct(mug, 8000, true).act).toEqual({ kind: 'mug', until: 9000 })
  const sit = holder({ kind: 'sit' })
  expect(settleAct(sit, 99999, false).act).toEqual({ kind: 'sit' })
  expect(settleAct(sit, 0, true).act).toBeUndefined()
  expect(settleAct(sit, 0, true).x).toBe(1)
  const none = holder()
  expect(settleAct(none, 0, true)).toBe(none)
})

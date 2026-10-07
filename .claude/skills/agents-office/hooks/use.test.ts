import { expect, test } from 'claude-code/testing'
import type { OfficeAgent, Roster } from './agents'
import type { Cat } from './cat'
import type { Motion } from './frame'
import { ITEMS } from './items'
import type { Item, ItemKind } from './items'
import { MID_FOOT, SMALL_FOOT } from './map'
import { deskOwner, hintOf, rectGap, targetOf } from './use'
import type { TargetInput } from './use'

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

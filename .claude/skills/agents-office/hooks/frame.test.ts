import { expect, test } from 'claude-code/testing'
import { buildFrame, FLOOR_BG, OFFICE_PALETTE, placeMotion, SIGN_BG, SIGN_FG, BUBBLE_BG, BUBBLE_FG } from './frame'
import type { Bubble, Motion } from './frame'
import type { OfficeAgent, Roster, Tier } from './agents'
import { buildMap } from './map'
import { DEFAULT_COLOR } from './raster'
import { nameplate, POSES, SPRITE_PALETTE, sprite } from './sprites'

const map = buildMap(60, 18)

const agent = (id: string, over: Partial<OfficeAgent> = {}): OfficeAgent => ({
  id,
  label: id,
  tier: 'opus',
  status: 'working',
  room: 'devbay',
  pose: 'idle',
  teammate: false,
  ...over,
})

const at = (x: number, y: number, frame = 0): Motion[string] => ({ x, y, path: [], frame })

const devbay = map.rooms.find(r => r.id === 'devbay')
const anchor = devbay?.anchors[0] ?? { x: 0, y: 0 }

test('frame draws every room sign at its anchor', () => {
  const grid = buildFrame({ map, agents: {}, motion: {}, bubbles: [], now: 0 })

  expect(grid).toHaveLength(18)
  expect(grid.every(row => row.length === 60)).toBe(true)
  expect(map.rooms).toHaveLength(7)
  for (const room of map.rooms) {
    const drawn = room.sign.cells.map(p => grid[p.y]?.[p.x])
    expect(String.fromCodePoint(...drawn.map(c => c?.ch ?? 0x3f))).toBe(room.sign.text)
    expect(drawn.every(c => c?.fg === SIGN_FG && c.bg === SIGN_BG)).toBe(true)
  }
})

test("an agent's sprite and nameplate sit at its motion tile", () => {
  const roster: Roster = { a1: agent('a1', { label: 'quick', pose: 'type' }) }
  // A resting work pose animates from the clock (D34): now = 300 ms is work frame 1.
  const grid = buildFrame({ map, agents: roster, motion: { a1: at(anchor.x, anchor.y) }, bubbles: [], now: 300 })
  const art = sprite('type', 1, 'opus')

  // Face cell: opaque, own skin bg. Body cells keep the floor bg (D28).
  expect(grid[anchor.y]?.[anchor.x + 1]).toEqual(art[0]?.[1])
  expect(grid[anchor.y + 1]?.[anchor.x + 1]).toEqual({ ...art[1]?.[1], bg: FLOOR_BG })
  expect(grid[anchor.y]?.[anchor.x + 2]).toEqual({ ...art[0]?.[2], bg: FLOOR_BG })
  // A TRANSPARENT sprite cell leaves the floor cell untouched.
  expect(grid[anchor.y]?.[anchor.x]).toEqual({ ch: 0x20, fg: FLOOR_BG, bg: FLOOR_BG })
  // Nameplate: 5 cells centred on the sprite, one row above.
  const plate = nameplate('quick')
  const left = anchor.x + 1 - Math.floor(plate.length / 2)
  plate.forEach((cell, i) => expect(grid[anchor.y - 1]?.[left + i]).toEqual(cell))
})

test('neighbouring nameplates split the cells they both want', () => {
  const roster: Roster = {
    a: agent('a', { label: 'aaaaaaaaaaaa' }),
    b: agent('b', { label: 'bbbbbbbbbbbb' }),
  }
  const [first, second] = devbay?.anchors ?? []
  if (first === undefined || second === undefined) throw new Error('devbay needs two anchors')
  const grid = buildFrame({
    map,
    agents: roster,
    motion: { a: at(first.x, first.y), b: at(second.x, second.y) },
    bubbles: [],
    now: 0,
  })
  const row = grid[first.y - 1] ?? []
  const text = (from: number, to: number): string =>
    String.fromCodePoint(...row.slice(from, to).map(c => c.ch))

  // Sprite centres are 4 apart: a keeps cells up to its centre + 2 (a tie goes left), b the rest.
  expect(text(first.x + 2, first.x + 3)).toBe('a')
  expect(text(first.x + 3, first.x + 4)).toBe('a')
  expect(text(first.x + 4, first.x + 5)).toBe('b')
  expect(text(second.x + 1, second.x + 3)).toBe('bb')
})

test('a bubble is drawn above the speaker and clipped to the grid', () => {
  const roster: Roster = { a1: agent('a1', { label: 'q' }) }
  const bubble: Bubble = { agentId: 'a1', text: 'hello there friend', until: 1000 }
  // Speaker near the right edge and the top: the bubble row is y - 2 = 0.
  const grid = buildFrame({ map, agents: roster, motion: { a1: at(56, 2) }, bubbles: [bubble], now: 999 })
  const row = grid[0] ?? []
  const start = 56 + 1 - Math.floor('hello there friend'.length / 2)

  expect(row).toHaveLength(60)
  expect(String.fromCodePoint(...row.slice(start, 60).map(c => c.ch))).toBe('hello there friend'.slice(0, 60 - start))
  expect(row[start]).toMatchObject({ fg: BUBBLE_FG, bg: BUBBLE_BG })
  expect(row[start - 1]?.bg).not.toBe(BUBBLE_BG)

  // Speaker at the top row: the bubble row is off the grid and nothing throws.
  const clipped = buildFrame({ map, agents: roster, motion: { a1: at(10, 1) }, bubbles: [bubble], now: 999 })
  expect(clipped).toHaveLength(18)
  // An expired bubble is not drawn.
  const expired = buildFrame({ map, agents: roster, motion: { a1: at(56, 2) }, bubbles: [bubble], now: 1000 })
  expect(expired[0]?.some(c => c.bg === BUBBLE_BG)).toBe(false)
})

test('office and sprite colors stay inside the 32-color budget', () => {
  const tiers: Tier[] = ['haiku', 'sonnet', 'opus', 'fable', 'grey']
  const roster: Roster = {}
  const motion: Motion = {}
  const bubbles: Bubble[] = []
  POSES.forEach((pose, i) => {
    const id = `p${i}`
    roster[id] = agent(id, { pose, tier: tiers[i % tiers.length] ?? 'grey' })
    motion[id] = at(2 + 4 * i, 2, i)
    bubbles.push({ agentId: id, text: 'hi', until: 10 })
  })
  const grid = buildFrame({ map, agents: roster, motion, bubbles, now: 0 })
  const colors = new Set<number>()
  const pairs = new Set<string>()
  for (const cell of grid.flat()) {
    colors.add(cell.fg)
    colors.add(cell.bg)
    pairs.add(`${cell.fg}/${cell.bg}`)
  }
  colors.delete(DEFAULT_COLOR)
  const allowed = new Set([...OFFICE_PALETTE, ...SPRITE_PALETTE])

  expect([...colors].every(c => allowed.has(c))).toBe(true)
  expect(allowed.size).toBeLessThan(32)
  expect(pairs.size).toBeLessThan(1024)
})

test('placeMotion seats a new agent at its first free anchor and drops departed ones', () => {
  const roster: Roster = { a: agent('a'), b: agent('b') }
  const first = placeMotion(map, roster, {})

  expect(first.a).toMatchObject({ x: anchor.x, y: anchor.y })
  expect(first.b).not.toMatchObject({ x: anchor.x, y: anchor.y })
  expect(placeMotion(map, roster, first)).toBe(first)
  expect(placeMotion(map, { a: agent('a') }, first)).toEqual({ a: first.a })
})

test('placeMotion reseats a resting entry that is off the map and keeps a valid one by reference', () => {
  const roster: Roster = { a: agent('a') }
  const valid = placeMotion(map, roster, {})
  const off: Motion = { a: at(100, anchor.y) }
  const reseated = placeMotion(map, roster, off)

  expect(reseated.a).toMatchObject({ x: anchor.x, y: anchor.y })
  expect(reseated).not.toBe(off)
  expect(placeMotion(map, roster, valid)).toBe(valid)
  expect(placeMotion(map, roster, valid).a).toBe(valid.a)
})

test('a bubble centred left of the grid writes nothing outside it', () => {
  const roster: Roster = { a1: agent('a1', { label: 'q' }) }
  const text = 'hello there friend'
  const bubble: Bubble = { agentId: 'a1', text, until: 1000 }
  const grid = buildFrame({ map, agents: roster, motion: { a1: at(0, 2) }, bubbles: [bubble], now: 999 })
  const row = grid[0] ?? []
  const left = 0 + 1 - Math.floor(text.length / 2)
  const drawn = row.filter(c => c.bg === BUBBLE_BG).length

  expect(grid).toHaveLength(18)
  expect(grid.every(r => r.length === 60)).toBe(true)
  expect(drawn).toBe(text.length + left)
  expect(row[0]).toMatchObject({ fg: BUBBLE_FG, bg: BUBBLE_BG, ch: text.codePointAt(-left) })
})

test('a bubble at the right edge draws up to the edge and nothing past it', () => {
  const roster: Roster = { a1: agent('a1', { label: 'q' }) }
  const text = 'hello there friend'
  const bubble: Bubble = { agentId: 'a1', text, until: 1000 }
  const grid = buildFrame({ map, agents: roster, motion: { a1: at(56, 2) }, bubbles: [bubble], now: 999 })
  const row = grid[0] ?? []
  const start = 56 + 1 - Math.floor(text.length / 2)

  expect(row).toHaveLength(60)
  expect(row.filter(c => c.bg === BUBBLE_BG)).toHaveLength(60 - start)
  expect(row[59]).toMatchObject({ bg: BUBBLE_BG })
})

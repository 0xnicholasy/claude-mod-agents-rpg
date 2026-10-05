import { expect, test } from 'claude-code/testing'
import { buildFrame, DOOR_BG, FLOOR_BG, OFFICE_PALETTE, placeMotion, ROOM_FLOORS, SIGN_BG, SIGN_FG, BUBBLE_BG, BUBBLE_FG } from './frame'
import type { Bubble, Motion } from './frame'
import type { OfficeAgent, Roster, Tier } from './agents'
import { buildOffice } from './map'
import { DEFAULT_COLOR } from './raster'
import type { Cell } from './raster'
import { enterAtDoor } from './motion'
import type { Player } from './player'
import { countPairs, PAIR_BUDGET } from './pixels'
import { FACINGS, figure, nameplate, POSES, ROLE_COLORS, SPRITE_PALETTE } from './sprites'
import type { Facing, Pose, Role } from './sprites'
import type { OfficeMap } from './map'
const buildMap = (columns: number, rows: number): OfficeMap => buildOffice(columns, rows, [{ id: 'team:t1', label: 'proj' }], 'team:t1')

const map = buildMap(60, 18)

const agent = (id: string, over: Partial<OfficeAgent> = {}): OfficeAgent => ({
  id,
  label: id,
  tier: 'opus',
  status: 'working',
  room: 'team:t1',
  home: 'team:t1',
  pose: 'idle',
  teammate: false,
  ...over,
})

const at = (x: number, y: number, frame = 0): Motion[string] => ({ x, y, path: [], frame })

const devbay = map.rooms.find(r => r.id === 'team:t1')
const anchor = devbay?.anchors[0] ?? { x: 0, y: 0 }

test('frame draws every room sign at its anchor', () => {
  const grid = buildFrame({ map, agents: {}, motion: {}, bubbles: [], now: 0 })

  expect(grid).toHaveLength(18)
  expect(grid.every(row => row.length === 60)).toBe(true)
  expect(map.rooms).toHaveLength(6)
  for (const room of map.rooms) {
    const drawn = room.sign.cells.map(p => grid[p.y]?.[p.x])
    expect(String.fromCodePoint(...drawn.map(c => c?.ch ?? 0x3f))).toBe(room.sign.text)
    expect(drawn.every(c => c?.fg === SIGN_FG && c.bg === SIGN_BG)).toBe(true)
  }
})

test("an agent's figure and nameplate sit at its motion tile", () => {
  const roster: Roster = { a1: agent('a1', { label: 'quick', pose: 'type' }) }
  // A resting work pose animates from the clock (D34): now = 300 ms is work frame 1.
  const grid = buildFrame({ map, agents: roster, motion: { a1: at(anchor.x, anchor.y) }, bubbles: [], now: 300 })
  // No role on the roster entry draws as dev; the key is the agent id; `.` pixels take the floor.
  const art = figure({ pose: 'type', facing: 'down', frame: 1, shirt: 'opus', role: 'dev', key: 'a1', floor: FLOOR_BG })

  art.forEach((row, dy) =>
    row.forEach((cell, dx) => expect(grid[anchor.y + dy]?.[anchor.x + dx]).toEqual(cell)),
  )
  // Every figure cell is a half-block.
  expect(grid[anchor.y]?.[anchor.x]?.ch).toBe(0x2580)
  // Nameplate: 5 cells one row above. Centred on the sprite it would start at x=0, a wall,
  // so it shifts onto the floor and starts at x=1.
  const plate = nameplate('quick')
  const left = 1
  expect(grid[anchor.y - 1]?.[0]?.ch).toBe(0x2588)
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

test('office and figure colors stay inside the palettes and the pair budget', () => {
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
  for (const cell of grid.flat()) {
    colors.add(cell.fg)
    colors.add(cell.bg)
  }
  colors.delete(DEFAULT_COLOR)
  const allowed = new Set([...OFFICE_PALETTE, ...SPRITE_PALETTE])

  expect([...colors].every(c => allowed.has(c))).toBe(true)
  expect(countPairs(grid)).toBeLessThan(PAIR_BUDGET)
})

test('a sign with astral characters draws one valid glyph per cell', () => {
  const map = buildOffice(60, 18, [{ id: 'team:a', label: 'a\u{1F600}b' }], 'team:a')
  const grid = buildFrame({ map, agents: {}, motion: {}, bubbles: [], now: 0 })
  const team = map.rooms[0]
  const drawn = (team?.sign.cells ?? []).map(p => String.fromCodePoint(grid[p.y]?.[p.x]?.ch ?? 0))
  expect(drawn.slice(0, 3)).toEqual(['a', '?', 'b'])
})

test('each room kind has its own floor color and no sign names a v1 room', () => {
  const grid = buildFrame({ map, agents: {}, motion: {}, bubbles: [], now: 0 })
  expect(new Set(Object.values(ROOM_FLOORS)).size).toBe(6)
  for (const room of map.rooms) {
    const { x, y, w, h } = room.bounds
    expect(grid[y + h - 1]?.[x + w - 1]?.bg).toBe(ROOM_FLOORS[room.kind])
    expect(room.sign.text).not.toMatch(/Library|Dev Bay|Lobby|Break|Meeting|Server|Phone Booth/)
  }
  // The corridor keeps the base floor.
  expect(grid[map.corridor.y]?.[map.corridor.x]?.bg).toBe(FLOOR_BG)
})

test('a crowd of 32 figures stays under 256 color pairs', () => {
  const tiers: Tier[] = ['haiku', 'sonnet', 'opus', 'fable', 'grey']
  const roles = Object.keys(ROLE_COLORS) as Role[]
  // The floor tile and the door tile; `.` pixels take whichever is under the figure.
  const floors = [FLOOR_BG, DOOR_BG]
  const crowd: Cell[][] = []
  for (let i = 0; i < 32; i++) {
    const pose: Pose = POSES[i % POSES.length] ?? 'idle'
    const facing: Facing = FACINGS[i % FACINGS.length] ?? 'down'
    const art = figure({
      pose,
      facing,
      frame: i % 4,
      shirt: tiers[i % tiers.length] ?? 'grey',
      role: roles[i % roles.length] ?? 'dev',
      key: `agent-${i}`,
      floor: floors[i % floors.length] ?? FLOOR_BG,
    })
    crowd.push(...art)
  }

  expect(crowd).toHaveLength(64)
  expect(countPairs(crowd)).toBeLessThan(PAIR_BUDGET)

  // The same crowd standing in the real frame, spread over every room's anchors.
  const roster: Roster = {}
  const motion: Motion = {}
  const spots = map.rooms.flatMap(r => r.anchors)
  for (let i = 0; i < 32; i++) {
    const spot = spots[i % spots.length] ?? anchor
    roster[`c${i}`] = agent(`c${i}`, {
      pose: POSES[i % POSES.length] ?? 'idle',
      tier: tiers[i % tiers.length] ?? 'grey',
      role: roles[i % roles.length] ?? 'dev',
    })
    motion[`c${i}`] = { ...at(spot.x, spot.y, i), path: i % 3 === 0 ? [{ x: spot.x + 1, y: spot.y }] : [] }
  }
  const frame = buildFrame({ map, agents: roster, motion, bubbles: [], now: 0 })
  expect(countPairs(frame)).toBeLessThan(PAIR_BUDGET)
})

test('a walking figure faces its next step', () => {
  const roster: Roster = { a1: agent('a1') }
  const faceOf = (path: { x: number; y: number }[]): string => {
    const grid = buildFrame({ map, agents: roster, motion: { a1: { x: anchor.x, y: anchor.y, path, frame: 0 } }, bubbles: [], now: 0 })
    return JSON.stringify([grid[anchor.y], grid[anchor.y + 1]].map(row => row?.slice(anchor.x, anchor.x + 3)))
  }
  const draw = (facing: Facing): string =>
    JSON.stringify(figure({ pose: 'walk', facing, frame: 0, shirt: 'opus', role: 'dev', key: 'a1', floor: FLOOR_BG }))

  expect(faceOf([{ x: anchor.x + 1, y: anchor.y }])).toBe(draw('right'))
  expect(faceOf([{ x: anchor.x - 1, y: anchor.y }])).toBe(draw('left'))
  expect(faceOf([{ x: anchor.x, y: anchor.y + 1 }])).toBe(draw('down'))
  expect(faceOf([{ x: anchor.x, y: anchor.y - 1 }])).toBe(draw('up'))
  expect(draw('right')).not.toBe(draw('left'))
})

test('a typing agent shows the desk color under the figure', () => {
  const roster: Roster = { a1: agent('a1', { pose: 'type' }) }
  const grid = buildFrame({ map, agents: roster, motion: { a1: at(anchor.x, anchor.y) }, bubbles: [], now: 0 })
  const bottom = grid[anchor.y + 1]?.slice(anchor.x, anchor.x + 3) ?? []

  expect(bottom).toHaveLength(3)
  for (const cell of bottom) expect(cell.bg).toBe(0x8d6e63)
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

test('placeMotion treats the end of a walker path as held', () => {
  const walking = enterAtDoor({}, map, 'a', 'team:t1')
  const first = devbay?.anchors[0]
  const second = devbay?.anchors[1]
  const placed = placeMotion(map, { a: agent('a'), b: agent('b') }, walking)

  expect(walking.a?.path.at(-1)).toEqual(first)
  expect(placed.b).toMatchObject({ x: second?.x, y: second?.y, path: [] })
})

test('placeMotion reseats a walker whose path has an unstandable tile at an anchor with no path', () => {
  const roster: Roster = { a: agent('a') }
  const broken: Motion = { a: { x: anchor.x, y: anchor.y, path: [{ x: 0, y: 0 }], frame: 1 } }
  const reseated = placeMotion(map, roster, broken)

  expect(reseated.a).toMatchObject({ x: anchor.x, y: anchor.y, path: [] })
})

const WALL_CH = 0x2588
const textAt = (grid: ReturnType<typeof buildFrame>, y: number, x: number, n: number): string =>
  String.fromCodePoint(...Array.from({ length: n }, (_, i) => grid[y]?.[x + i]?.ch ?? 0x3f))

test('a nameplate at a left-wall desk shifts onto the floor', () => {
  const wide = buildMap(76, 11)
  const desk = wide.rooms.find(r => r.id === 'reception')?.anchors[0] ?? { x: 0, y: 0 }
  const roster: Roster = { m: agent('m', { label: 'main', room: 'reception', home: 'reception' }) }
  const grid = buildFrame({ map: wide, agents: roster, motion: { m: at(desk.x, desk.y) }, bubbles: [], now: 0 })
  expect(grid[desk.y - 1]?.[0]?.ch).toBe(WALL_CH)
  expect(textAt(grid, desk.y - 1, 1, 4)).toBe('main')
  expect(grid[desk.y - 1]?.[5]?.ch).toBe(0x20)
})

test("a nameplate wider than its room is cut at the room's walls", () => {
  const phone = map.rooms.find(r => r.id === 'booths')
  const desk = phone?.anchors[0] ?? { x: 0, y: 0 }
  const bounds = phone?.bounds ?? { x: 0, y: 0, w: 0, h: 0 }
  const roster: Roster = { p: agent('p', { label: 'abcdefghijkl', room: 'booths', home: 'booths' }) }
  const grid = buildFrame({ map, agents: roster, motion: { p: at(desk.x, desk.y) }, bubbles: [], now: 0 })
  const y = desk.y - 1
  expect(textAt(grid, y, bounds.x, bounds.w)).toBe('abcdefghijkl'.slice(0, bounds.w))
  expect(grid[y]?.[bounds.x - 1]?.ch).toBe(WALL_CH)
  expect(grid[y]?.[bounds.x + bounds.w]?.ch).toBe(WALL_CH)
})

test('no nameplate is drawn when the row above is a door or wall', () => {
  const wide = buildMap(76, 11)
  const stand = wide.rooms.find(r => r.id === 'reception')?.doorStand ?? { x: 0, y: 0 }
  const roster: Roster = { m: agent('m', { label: 'main', room: 'reception', home: 'reception' }) }
  const bare = buildFrame({ map: wide, agents: {}, motion: {}, bubbles: [], now: 0 })
  const grid = buildFrame({ map: wide, agents: roster, motion: { m: at(stand.x, stand.y) }, bubbles: [], now: 0 })
  expect(grid[stand.y - 1]).toEqual(bare[stand.y - 1])
})

test('an overlapping figure takes its floor from the map, not from the figure drawn before it', () => {
  const roster: Roster = { a: agent('a'), b: agent('b') }
  const grid = buildFrame({ map, agents: roster, motion: { a: at(anchor.x, anchor.y), b: at(anchor.x + 1, anchor.y) }, bubbles: [], now: 0 })
  const alone = buildFrame({ map, agents: { b: agent('b') }, motion: { b: at(anchor.x + 1, anchor.y) }, bubbles: [], now: 0 })

  // b is drawn over a; b's own cells must match b drawn alone on the empty floor.
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 3; dx++) {
      expect(grid[anchor.y + dy]?.[anchor.x + 1 + dx]).toEqual(alone[anchor.y + dy]?.[anchor.x + 1 + dx])
    }
  }
})

test('main draws with lead pants, other roster entries without a role draw as dev', () => {
  const roster: Roster = { main: agent('main'), a1: agent('a1') }
  const spots = devbay?.anchors ?? []
  const first = spots[0] ?? anchor
  const second = spots[1] ?? { x: anchor.x + 8, y: anchor.y }
  const grid = buildFrame({ map, agents: roster, motion: { main: at(first.x, first.y), a1: at(second.x, second.y) }, bubbles: [], now: 0 })

  expect(grid[first.y + 1]?.[first.x]?.bg).toBe(ROLE_COLORS.lead)
  expect(grid[second.y + 1]?.[second.x]?.bg).toBe(ROLE_COLORS.dev)
})

test('the player draws over agents in a white shirt with the plate you', () => {
  const player = { x: 10, y: 4, facing: 'right' as const, frame: 0, path: [] }
  const grid = buildFrame({ map, agents: {}, motion: {}, bubbles: [], now: 0, player })
  const top = grid[4]?.slice(10, 13) ?? []

  expect(top.every(c => c.ch === 0x2580)).toBe(true)
  // The shirt is the third pixel row: the foreground of the bottom cell row.
  expect((grid[5] ?? []).slice(10, 13).some(c => c.fg === 0xf5f5f5)).toBe(true)
  const plate = (grid[3] ?? []).map(c => String.fromCodePoint(c.ch)).join('')
  expect(plate).toContain('you')
  // No player, nothing extra: the same frame without it has no plate.
  const without = buildFrame({ map, agents: {}, motion: {}, bubbles: [], now: 0 })
  expect((without[3] ?? []).map(c => String.fromCodePoint(c.ch)).join('')).not.toContain('you')
})

test('an emote shows above the player for 3 s', () => {
  const base = { x: 10, y: 5, facing: 'down' as const, frame: 0, path: [] }
  const player = { ...base, emote: '\u25c6', until: 3000 }
  const glyphAt = (now: number, p: Player = player): number | undefined =>
    buildFrame({ map, agents: {}, motion: {}, bubbles: [], now, player: p })[3]?.[11]?.ch

  // The bubble row is two rows above the figure (the plate sits between), centred on it.
  expect(glyphAt(0)).toBe(0x25c6)
  expect(glyphAt(2999)).toBe(0x25c6)
  expect(glyphAt(3000)).not.toBe(0x25c6)
  expect(glyphAt(0, base)).not.toBe(0x25c6)
})

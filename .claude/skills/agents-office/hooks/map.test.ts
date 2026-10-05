import { expect, test } from 'claude-code/testing'
import { buildOffice, canStand, fitSign, FOOTPRINT_H, FOOTPRINT_W, OfficeTooSmall, roomAt, tileAt } from './map'
import type { OfficeMap, Point, Rect, TeamSpec } from './map'
import { findPath } from './path'

const at = <T>(items: T[], i: number): T => {
  const item = items[i]
  if (item === undefined) throw new Error(`no item at ${i}`)
  return item
}

const inside = (r: Rect, p: Point): boolean => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h
const overlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const SIZES: Array<[number, number]> = [[60, 18], [61, 19], [77, 23], [100, 30], [120, 36], [60, 11], [76, 11], [60, 12], [76, 12], [76, 14], [60, 17]]
const STEPS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const BOTTOM_IDS = ['reception', 'conference', 'kitchen', 'lab', 'booths']

const teamsOf = (n: number): TeamSpec[] => Array.from({ length: n }, (_, i) => ({ id: `team:s${i}` as const, label: `project-${i} (branch-${i})` }))
const layout = (columns: number, rows: number, n = 2): OfficeMap => buildOffice(columns, rows, teamsOf(n), 'team:s0')

// Footprint positions reachable from a start by one-cell steps over canStand.
const reachable = (map: OfficeMap, start: Point): Set<string> => {
  const seen = new Set<string>([`${start.x},${start.y}`])
  const queue = [start]
  for (let p = queue.shift(); p; p = queue.shift()) {
    for (const [dx, dy] of STEPS) {
      const n = { x: p.x + dx, y: p.y + dy }
      const key = `${n.x},${n.y}`
      if (!seen.has(key) && canStand(map, n.x, n.y)) {
        seen.add(key)
        queue.push(n)
      }
    }
  }
  return seen
}

test('every room has a sign inside its bounds and at least one floor anchor', () => {
  for (const [columns, rows] of SIZES) {
    const map = layout(columns, rows)
    expect(map.rooms.length).toBe(2 + BOTTOM_IDS.length)
    for (const room of map.rooms) {
      expect(room.sign.cells.length).toBe(room.sign.text.length)
      for (const cell of room.sign.cells) {
        // A 3-row room keeps its sign on the wall row above the interior.
        expect(cell.y).toBe(room.bounds.h >= 4 ? room.bounds.y : room.bounds.y - 1)
        expect(cell.x >= room.bounds.x && cell.x < room.bounds.x + room.bounds.w).toBe(true)
        expect(tileAt(map, cell.x, cell.y)).toBe('sign')
      }
      expect(room.anchors.length).toBeGreaterThanOrEqual(1)
      for (const a of room.anchors) {
        expect(inside(room.bounds, a)).toBe(true)
        expect(inside(room.bounds, { x: a.x + FOOTPRINT_W - 1, y: a.y + FOOTPRINT_H - 1 })).toBe(true)
        expect(a.y - 1).toBeGreaterThan(at(room.sign.cells, 0).y)
        // No bottom-room desk footprint overlaps the room's doorStand footprint (top rooms
        // centre their stand among the desks by design).
        const apart = Math.abs(a.x - room.doorStand.x) >= FOOTPRINT_W || Math.abs(a.y - room.doorStand.y) >= FOOTPRINT_H
        if (room.kind !== 'team') expect(apart).toBe(true)
      }
    }
  }
})

test('rooms never overlap and every door touches a corridor floor tile', () => {
  for (const [columns, rows] of SIZES) {
    const map = layout(columns, rows)
    for (const [i, a] of map.rooms.entries()) {
      for (const b of map.rooms.slice(i + 1)) expect(overlap(a.bounds, b.bounds)).toBe(false)
      expect(a.door.length).toBe(3)
      for (const d of a.door) {
        expect(tileAt(map, d.x, d.y)).toBe('door')
        const touches = [d.y - 1, d.y + 1].some(y => inside(map.corridor, { x: d.x, y }) && tileAt(map, d.x, y) === 'floor')
        expect(touches).toBe(true)
      }
    }
  }
})

test('the 120x36 map keeps one-cell walls around every room', () => {
  const map = layout(120, 36)
  expect(map.columns).toBe(120)
  expect(map.rows).toBe(36)
  for (let x = 0; x < 120; x++) {
    expect(tileAt(map, x, 0)).toBe('wall')
    expect(tileAt(map, x, 35)).toBe('wall')
  }
  for (const room of map.rooms) {
    const { x, y, w, h } = room.bounds
    expect(tileAt(map, x - 1, y)).toBe('wall')
    expect(tileAt(map, x + w, y)).toBe('wall')
    expect(tileAt(map, x - 1, y + h - 1)).toBe('wall')
    expect(roomAt(map, x, y)).toBe(room.id)
  }
  expect(roomAt(map, 0, 0)).toBe(undefined)
  expect(roomAt(map, map.corridor.x, map.corridor.y)).toBe(undefined)
})

test('tile rows span the full width and rooms in a row fill it with one-cell walls', () => {
  for (const [columns, rows] of SIZES) {
    const map = layout(columns, rows)
    expect(map.tiles.length).toBe(rows)
    for (const row of map.tiles) expect(row.length).toBe(columns)
    const ys = [...new Set(map.rooms.map(r => r.bounds.y))]
    expect(ys.length).toBe(2)
    for (const y of ys) {
      const row = map.rooms.filter(r => r.bounds.y === y).sort((a, b) => a.bounds.x - b.bounds.x)
      const first = at(row, 0).bounds
      const last = at(row, row.length - 1).bounds
      expect(first.x).toBe(1)
      expect(last.x + last.w - 1).toBe(columns - 2)
      for (let i = 1; i < row.length; i++) {
        const prev = at(row, i - 1).bounds
        const next = at(row, i).bounds
        expect(next.x - (prev.x + prev.w)).toBe(1)
        expect(tileAt(map, prev.x + prev.w, y)).toBe('wall')
      }
    }
  }
})

test('buildOffice throws OfficeTooSmall at 59x11', () => {
  expect(() => layout(59, 11)).toThrow(OfficeTooSmall)
  expect(() => layout(60, 10)).toThrow(OfficeTooSmall)
  expect(layout(60, 11).rows).toBe(11)
})

test('heights 11 to 18 grow one interior row per step', () => {
  let prev: number[] | undefined
  for (let rows = 11; rows <= 18; rows++) {
    const map = layout(60, rows)
    const top = at(map.rooms, 0).bounds.h
    const bottom = at(map.rooms.filter(r => r.id === 'reception'), 0).bounds.h
    const bands = [top, map.corridor.h, bottom]
    expect(top + map.corridor.h + bottom).toBe(rows - (rows === 11 ? 3 : 4))
    if (prev) bands.forEach((h, i) => expect(h).toBeGreaterThanOrEqual(prev?.[i] ?? 0))
    prev = bands
  }
  const map = layout(60, 18)
  const team = at(map.rooms, 0)
  const reception = at(map.rooms.filter(r => r.id === 'reception'), 0)
  expect([team.bounds.y, team.bounds.h]).toEqual([1, 5])
  expect([map.corridor.y, map.corridor.h]).toEqual([7, 3])
  expect([reception.bounds.y, reception.bounds.h]).toEqual([11, 6])
})

test('every anchor and doorStand is a standable footprint and a footprint fits through every door', () => {
  for (const [columns, rows] of SIZES) {
    const map = layout(columns, rows)
    const reach = reachable(map, { x: map.corridor.x, y: map.corridor.y })
    for (const room of map.rooms) {
      expect(canStand(map, at(room.door, 0).x, at(room.door, 0).y)).toBe(true)
      expect(canStand(map, room.doorStand.x, room.doorStand.y)).toBe(true)
      expect(reach.has(`${room.doorStand.x},${room.doorStand.y}`)).toBe(true)
      for (const a of room.anchors) {
        expect(canStand(map, a.x, a.y)).toBe(true)
        expect(reach.has(`${a.x},${a.y}`)).toBe(true)
      }
    }
  }
  expect(canStand(layout(60, 18), 0, 0)).toBe(false)
})

const OFFICE_SIZES: Array<[number, number]> = [[60, 11], [60, 18], [100, 30]]
const TEAM_COUNTS = [1, 2, 4, 6]

test('four team rooms fit at 60 columns', () => {
  for (const rows of [11, 18]) {
    const office = buildOffice(60, rows, teamsOf(6), 'team:s5')
    const teamRooms = office.rooms.filter(r => r.kind === 'team')
    expect(teamRooms.length).toBe(4)
    expect(office.hidden).toBe(2)
    // The own team is kept even though it is last in room order.
    expect(teamRooms.map(r => r.id)).toEqual(['team:s0', 'team:s1', 'team:s2', 'team:s5'])
    for (const r of teamRooms) expect(r.bounds.w).toBeGreaterThanOrEqual(11)
    expect(office.rooms.filter(r => r.kind !== 'team').map(r => r.id)).toEqual(BOTTOM_IDS)
  }
  const four = buildOffice(60, 18, teamsOf(4), 'team:s0')
  expect(four.hidden).toBe(0)
  expect(four.rooms.filter(r => r.kind === 'team').length).toBe(4)
  // Bottom-band interiors are 12/12/10/10/10 at 60 columns.
  expect(four.rooms.filter(r => r.kind !== 'team').map(r => r.bounds.w)).toEqual([12, 12, 10, 10, 10])
})

test('team desks are 5 apart', () => {
  for (const [columns, rows] of OFFICE_SIZES) {
    for (const n of TEAM_COUNTS) {
      const office = buildOffice(columns, rows, teamsOf(n), 'team:s0')
      for (const room of office.rooms.filter(r => r.kind === 'team')) {
        expect(room.anchors.length).toBeGreaterThanOrEqual(2)
        for (let i = 1; i < room.anchors.length; i++) expect(at(room.anchors, i).x - at(room.anchors, i - 1).x).toBe(5)
        for (const a of room.anchors) expect(inside(room.bounds, { x: a.x + FOOTPRINT_W - 1, y: a.y + FOOTPRINT_H - 1 })).toBe(true)
      }
    }
  }
})

test('every room is reachable from Reception', () => {
  for (const [columns, rows] of OFFICE_SIZES) {
    for (const n of TEAM_COUNTS) {
      const office = buildOffice(columns, rows, teamsOf(n), 'team:s0')
      const reception = at(office.rooms.filter(r => r.id === 'reception'), 0)
      for (const [i, a] of office.rooms.entries()) {
        for (const b of office.rooms.slice(i + 1)) expect(overlap(a.bounds, b.bounds)).toBe(false)
      }
      for (const room of office.rooms) {
        expect(room.anchors.length).toBeGreaterThanOrEqual(1)
        expect(canStand(office, room.doorStand.x, room.doorStand.y)).toBe(true)
        for (const a of room.anchors) {
          expect(canStand(office, a.x, a.y)).toBe(true)
          const same = a.x === reception.doorStand.x && a.y === reception.doorStand.y
          expect(same || findPath(office, reception.doorStand, a).length > 0).toBe(true)
        }
      }
    }
  }
})

test('a team sign is cut by code point, never inside a surrogate pair', () => {
  const label = '\u{1F600}'.repeat(80)
  const office = buildOffice(60, 18, [{ id: 'team:a', label }], 'team:a')
  const team = at(office.rooms, 0)
  expect(Array.from(team.sign.text)).toHaveLength(team.bounds.w)
  expect(team.sign.text).toBe('\u{1F600}'.repeat(team.bounds.w))
})

test('office signs are cut to the interior width and rooms tile the bands', () => {
  const label = 'a-very-long-project-name (a-very-long-branch-name)'.repeat(2)
  const long = [{ id: 'team:a', label }] as const
  const office = buildOffice(60, 18, [...long], 'team:a')
  const team = at(office.rooms, 0)
  expect(team.sign.text).toBe(label.slice(0, team.bounds.w))
  expect(team.sign.cells.length).toBe(team.bounds.w)
  for (const room of office.rooms) {
    expect(room.sign.cells.length).toBe(room.sign.text.length)
    for (const c of room.sign.cells) expect(tileAt(office, c.x, c.y)).toBe('sign')
  }
  const wide = buildOffice(100, 30, teamsOf(1), 'team:s0')
  expect(wide.rooms.filter(r => r.kind !== 'team').map(r => r.sign.text)).toEqual(['Reception', 'Conference', 'Kitchen', 'Test Lab', 'Booths'])
  // At 60 columns the bottom signs share their row with the door or doorStand, so they stop short of it.
  const compact = buildOffice(60, 11, teamsOf(1), 'team:s0')
  expect(compact.rooms.filter(r => r.kind !== 'team').map(r => r.sign.text)).toEqual(['Reception', 'Conferenc', 'Kitchen', 'Test La', 'Booths'])
  for (const room of compact.rooms) for (const d of room.door) expect(tileAt(compact, d.x, d.y)).toBe('door')
  expect(() => buildOffice(59, 11, teamsOf(1), 'team:s0')).toThrow(OfficeTooSmall)
})

test('same-label teams in a narrow room keep distinguishable signs', () => {
  const label = 'agents-office-v2-t16 (feat/agents-office-v2)'
  const teams: TeamSpec[] = [
    { id: 'team:a', label },
    { id: 'team:b', label: `${label} 2` },
  ]
  const map = buildOffice(60, 18, teams, 'team:a')
  const signs = map.rooms.filter(r => r.kind === 'team').map(r => r.sign.text)

  expect(signs).toHaveLength(2)
  expect(signs[0]).not.toBe(signs[1])
  expect(at(signs, 1).endsWith(' 2')).toBe(true)
  for (const room of map.rooms.filter(r => r.kind === 'team')) expect(Array.from(room.sign.text).length).toBeLessThanOrEqual(room.bounds.w)
  // A label that fits is left alone, and a number is never the only thing left of a tiny room.
  expect(fitSign('proj 2', 10)).toBe('proj 2')
  expect(fitSign('project-long 12', 6)).toBe('pro 12')
  expect(fitSign('project-long 12', 3)).toBe('pro')
})

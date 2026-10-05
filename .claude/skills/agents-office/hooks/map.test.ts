import { expect, test } from 'claude-code/testing'
import { buildMap, canStand, FOOTPRINT_H, FOOTPRINT_W, OfficeTooSmall, roomAt, tileAt } from './map'
import type { OfficeMap, Point, Rect } from './map'

const SIGNS: Record<string, string> = {
  devbay: 'Dev Bay',
  library: 'Library',
  server: 'Server Room',
  phone: 'Phone',
  meeting: 'Meeting Room',
  break: 'Break Room',
  lobby: 'Lobby',
}

const at = <T>(items: T[], i: number): T => {
  const item = items[i]
  if (item === undefined) throw new Error(`no item at ${i}`)
  return item
}

const inside = (r: Rect, p: Point): boolean => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h
const overlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const SIZES: Array<[number, number]> = [[60, 18], [61, 19], [77, 23], [100, 30], [120, 36], [60, 11], [76, 11], [60, 12], [76, 12], [76, 14], [60, 17]]

const STEPS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]]

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

test('every room has a sign inside its bounds and at least two floor anchors', () => {
  for (const [columns, rows] of SIZES) {
  const map = buildMap(columns, rows)
  expect(map.rooms.length).toBe(7)
  for (const room of map.rooms) {
    expect(room.sign.text).toBe(SIGNS[room.id])
    expect(room.sign.cells.length).toBe(room.sign.text.length)
    for (const cell of room.sign.cells) {
      // A 3-row room keeps its sign on the wall row above the interior.
      expect(cell.y).toBe(room.bounds.h >= 4 ? room.bounds.y : room.bounds.y - 1)
      expect(cell.x >= room.bounds.x && cell.x < room.bounds.x + room.bounds.w).toBe(true)
      expect(tileAt(map, cell.x, cell.y)).toBe('sign')
    }
    expect(room.anchors.length).toBeGreaterThanOrEqual(room.id === 'devbay' ? 6 : 2)
    for (const a of room.anchors) {
      // Footprint and its nameplate row sit inside the room, clear of the sign row.
      expect(inside(room.bounds, a)).toBe(true)
      expect(inside(room.bounds, { x: a.x + FOOTPRINT_W - 1, y: a.y + FOOTPRINT_H - 1 })).toBe(true)
      expect(a.y - 1).toBeGreaterThan(at(room.sign.cells, 0).y)
    }
    for (let i = 1; i < room.anchors.length; i++) {
      expect(at(room.anchors, i).x - at(room.anchors, i - 1).x).toBeGreaterThanOrEqual(FOOTPRINT_W + 1)
    }
  }
  }
})

test('rooms never overlap and every door touches a corridor floor tile', () => {
  for (const [columns, rows] of SIZES) {
  const map = buildMap(columns, rows)
  for (const [i, a] of map.rooms.entries()) {
    for (const b of map.rooms.slice(i + 1)) expect(overlap(a.bounds, b.bounds)).toBe(false)
    expect(a.door.length).toBe(3)
    for (const d of a.door) {
      expect(tileAt(map, d.x, d.y)).toBe('door')
      const above = d.y - 1
      const below = d.y + 1
      const touches = [above, below].some(y => inside(map.corridor, { x: d.x, y }) && tileAt(map, d.x, y) === 'floor')
      expect(touches).toBe(true)
    }
  }
  }
})

test('map scales to 120x36 keeping seven rooms and one-cell walls', () => {
  const map = buildMap(120, 36)
  expect(map.columns).toBe(120)
  expect(map.rows).toBe(36)
  expect(map.rooms.length).toBe(7)
  expect(map.rooms.find(r => r.id === 'devbay')?.anchors.length).toBeGreaterThanOrEqual(6)
  // Outer frame is wall; each room is enclosed by exactly one wall cell on its left and right.
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
    const map = buildMap(columns, rows)
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

test('buildMap throws OfficeTooSmall at 59x11', () => {
  expect(() => buildMap(59, 11)).toThrow(OfficeTooSmall)
  expect(() => buildMap(60, 10)).toThrow(OfficeTooSmall)
  expect(buildMap(60, 11).rows).toBe(11)
})

test('heights 11 to 18 grow one interior row per step into the unchanged 60x18 layout', () => {
  let prev: number[] | undefined
  for (let rows = 11; rows <= 18; rows++) {
    const map = buildMap(60, rows)
    const top = at(map.rooms, 0).bounds.h
    const bottom = at(map.rooms.filter(r => r.id === 'lobby'), 0).bounds.h
    // At 11 rows the corridor is one row; the map exposes it as a 2-row walkable band.
    const corridor = rows === 11 ? 1 : map.corridor.h
    const bands = [top, corridor, bottom]
    expect(top + corridor + bottom).toBe(rows - 4)
    if (prev) bands.forEach((h, i) => expect(h).toBeGreaterThanOrEqual(prev?.[i] ?? 0))
    prev = bands
  }
  const map = buildMap(60, 18)
  const dev = at(map.rooms.filter(r => r.id === 'devbay'), 0)
  const lobby = at(map.rooms.filter(r => r.id === 'lobby'), 0)
  expect([dev.bounds.y, dev.bounds.h]).toEqual([1, 5])
  expect([map.corridor.y, map.corridor.h]).toEqual([7, 3])
  expect([lobby.bounds.y, lobby.bounds.h]).toEqual([11, 6])
  expect(at(dev.anchors, 0).y).toBe(3)
  expect(at(lobby.anchors, 0).y).toBe(13)
})

test('every anchor and doorStand is a standable footprint and a footprint fits through every door', () => {
  for (const [columns, rows] of SIZES) {
    const map = buildMap(columns, rows)
    const corridorStart = { x: map.corridor.x, y: map.corridor.y }
    expect(canStand(map, corridorStart.x, corridorStart.y)).toBe(true)
    const reach = reachable(map, corridorStart)
    for (const room of map.rooms) {
      // A 3-wide footprint stands on the door row directly over the door cells.
      expect(canStand(map, at(room.door, 0).x, at(room.door, 0).y)).toBe(true)
      expect(canStand(map, room.doorStand.x, room.doorStand.y)).toBe(true)
      expect(reach.has(`${room.doorStand.x},${room.doorStand.y}`)).toBe(true)
      for (const a of room.anchors) {
        expect(canStand(map, a.x, a.y)).toBe(true)
        expect(reach.has(`${a.x},${a.y}`)).toBe(true)
      }
    }
  }
  expect(canStand(buildMap(60, 18), 0, 0)).toBe(false)
  expect(canStand(buildMap(60, 18), 58, 8)).toBe(false)
})

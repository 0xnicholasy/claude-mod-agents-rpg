import { expect, test } from 'claude-code/testing'
import { buildMap, canStand, FOOTPRINT_H, FOOTPRINT_W, tileAt } from './map'
import type { OfficeMap, Point, Room } from './map'
import { findPath } from './path'

const at = <T>(items: T[], i: number): T => {
  const item = items[i]
  if (item === undefined) throw new Error(`no item at ${i}`)
  return item
}

const room = (rooms: Room[], id: string): Room => {
  const found = rooms.find(r => r.id === id)
  if (!found) throw new Error(`no room ${id}`)
  return found
}

const dist = (a: Point, b: Point): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

// Asserts a path is a valid walk: first step adjacent to `from`, consecutive steps adjacent,
// every footprint cell floor or door, last step equals `to`.
const assertValidPath = (map: OfficeMap, from: Point, to: Point, path: Point[]): void => {
  expect(path.length > 0).toBe(true)
  expect(dist(from, at(path, 0))).toBe(1)
  expect(at(path, path.length - 1)).toEqual(to)
  for (const [i, p] of path.entries()) {
    if (i > 0) expect(dist(at(path, i - 1), p)).toBe(1)
    for (let dy = 0; dy < FOOTPRINT_H; dy++) {
      for (let dx = 0; dx < FOOTPRINT_W; dx++) {
        const kind = tileAt(map, p.x + dx, p.y + dy)
        expect(kind === 'floor' || kind === 'door').toBe(true)
      }
    }
  }
}

test('path from Lobby to Library crosses only floor and door tiles and every pair of consecutive tiles is adjacent', () => {
  const map = buildMap(60, 18)
  const from = at(room(map.rooms, 'lobby').anchors, 0)
  const to = at(room(map.rooms, 'library').anchors, 0)
  const path = findPath(map, from, to)
  assertValidPath(map, from, to, path)
  expect(path.length).toBe(42)
})

test('every room is reachable from every other room on the 60x18, 120x36, 76x12, 60x11 and 76x11 maps', () => {
  for (const [columns, rows] of [[60, 18], [120, 36], [76, 12], [60, 11], [76, 11]] as const) {
    const map = buildMap(columns, rows)
    for (const a of map.rooms) {
      for (const b of map.rooms) {
        if (a.id === b.id) continue
        const from = at(a.anchors, 0)
        const to = at(b.anchors, 0)
        assertValidPath(map, from, to, findPath(map, from, to))
      }
    }
  }
})

test('an unreachable target returns an empty path', () => {
  const map = buildMap(60, 18)
  const from = at(room(map.rooms, 'lobby').anchors, 0)
  expect(findPath(map, from, { x: 0, y: 0 })).toEqual([])
  expect(findPath(map, from, { x: map.columns - 1, y: map.rows - 1 })).toEqual([])
  expect(findPath(map, { x: 0, y: 0 }, from)).toEqual([])
  expect(findPath(map, from, from)).toEqual([])
  expect(findPath(map, from, { x: -1, y: -1 })).toEqual([])
  expect(findPath(map, { x: -3, y: 5 }, from)).toEqual([])
  expect(findPath(map, from, { x: from.x + 0.5, y: from.y })).toEqual([])
  expect(findPath(map, from, { x: from.x, y: from.y + 0.5 })).toEqual([])
})

test('a standable target in a walled-off room returns an empty path', () => {
  const base = buildMap(60, 18)
  const lobby = room(base.rooms, 'lobby')
  const tiles = base.tiles.map(row => [...row])
  for (const d of lobby.door) {
    const row = tiles[d.y]
    if (row) row[d.x] = 'wall'
  }
  const map: OfficeMap = { ...base, tiles }
  const inside = at(lobby.anchors, 0)
  const outside = at(room(map.rooms, 'library').anchors, 0)
  expect(canStand(map, inside.x, inside.y)).toBe(true)
  expect(canStand(map, outside.x, outside.y)).toBe(true)
  expect(findPath(map, inside, outside)).toEqual([])
  expect(findPath(map, outside, inside)).toEqual([])
})

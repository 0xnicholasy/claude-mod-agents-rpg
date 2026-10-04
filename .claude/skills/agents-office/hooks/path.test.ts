import { expect, test } from 'claude-code/testing'
import { buildMap, FOOTPRINT_H, FOOTPRINT_W, tileAt } from './map'
import type { Point, Room } from './map'
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

test('path from Lobby to Library crosses only floor and door tiles and every pair of consecutive tiles is adjacent', () => {
  const map = buildMap(60, 18)
  const from = at(room(map.rooms, 'lobby').anchors, 0)
  const to = at(room(map.rooms, 'library').anchors, 0)
  const path = findPath(map, from, to)
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
})

test('every room is reachable from every other room on the 60x18 and 120x36 maps', () => {
  for (const [columns, rows] of [[60, 18], [120, 36]] as const) {
    const map = buildMap(columns, rows)
    for (const a of map.rooms) {
      for (const b of map.rooms) {
        if (a.id === b.id) continue
        const path = findPath(map, at(a.anchors, 0), at(b.anchors, 0))
        expect(path.length > 0).toBe(true)
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
})

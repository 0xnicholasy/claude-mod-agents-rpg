import { canStand } from './map'
import type { OfficeMap, Point } from './map'

// Neighbour order is fixed (right, left, down, up) so equal-length paths are stable across runs.
const STEPS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]

/**
 * Shortest path for a 3x2 footprint, by BFS over `canStand` positions (top-left cell, D27) with 4-neighbour moves.
 * Returns the positions after `from` up to and including `to`, so its length is the number of steps and the
 * first entry is adjacent to `from`. Empty when `from === to`, or when `from` or `to` cannot stand, or when
 * `to` is not reachable.
 */
export const findPath = (map: OfficeMap, from: Point, to: Point): Point[] => {
  if (!canStand(map, from.x, from.y) || !canStand(map, to.x, to.y)) return []
  if (from.x === to.x && from.y === to.y) return []
  const size = map.columns * map.rows
  const idx = (p: Point): number => p.y * map.columns + p.x
  const parent = new Int32Array(size).fill(-1)
  const seen = new Uint8Array(size)
  seen[idx(from)] = 1
  const queue: Point[] = [from]
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head]
    if (!p) break
    for (const [dx, dy] of STEPS) {
      const n = { x: p.x + dx, y: p.y + dy }
      if (n.x < 0 || n.y < 0 || n.x >= map.columns || n.y >= map.rows) continue
      const key = idx(n)
      if (seen[key] || !canStand(map, n.x, n.y)) continue
      seen[key] = 1
      parent[key] = idx(p)
      if (n.x === to.x && n.y === to.y) {
        const path: Point[] = []
        for (let c = key; c !== idx(from); c = parent[c] ?? -1) path.push({ x: c % map.columns, y: Math.floor(c / map.columns) })
        return path.reverse()
      }
      queue.push(n)
    }
  }
  return []
}

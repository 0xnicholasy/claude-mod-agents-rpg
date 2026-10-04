import { canStand } from './map'
import type { OfficeMap, Point } from './map'

// Neighbour order is fixed (right, left, down, up) so equal-length paths are stable across runs.
const STEPS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]

const keyOf = (p: Point): string => `${p.x},${p.y}`

/**
 * Shortest path for a 3x2 footprint, by BFS over `canStand` positions (top-left cell, D27) with 4-neighbour moves.
 * Returns the positions after `from` up to and including `to`, so its length is the number of steps and the
 * first entry is adjacent to `from`. Empty when `from === to`, or when `from` or `to` cannot stand, or when
 * `to` is not reachable.
 */
export const findPath = (map: OfficeMap, from: Point, to: Point): Point[] => {
  if (!canStand(map, from.x, from.y) || !canStand(map, to.x, to.y)) return []
  if (from.x === to.x && from.y === to.y) return []
  const parent = new Map<string, Point>()
  const seen = new Set<string>([keyOf(from)])
  const queue: Point[] = [from]
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head]
    if (!p) break
    for (const [dx, dy] of STEPS) {
      const n = { x: p.x + dx, y: p.y + dy }
      const key = keyOf(n)
      if (seen.has(key) || !canStand(map, n.x, n.y)) continue
      seen.add(key)
      parent.set(key, p)
      if (n.x === to.x && n.y === to.y) {
        const path: Point[] = []
        for (let c: Point | undefined = n; c && !(c.x === from.x && c.y === from.y); c = parent.get(keyOf(c))) path.unshift(c)
        return path
      }
      queue.push(n)
    }
  }
  return []
}

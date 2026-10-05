// The office cat (D24). Pure: register.tsx keeps the `cat` atom and passes plain data in. It lives in this pane only
// and is never published. It wanders the shared rooms on a seeded pseudo-random walk, one tile per tick, and rests
// between walks.
import { CAT_FOOT, canStand } from './map'
import type { OfficeMap, Point } from './map'
import { findPath } from './path'
import { compose } from './pixels'
import type { Px } from './pixels'
import type { Cell } from './raster'
import { CAT_REST_MAX_MS, CAT_REST_MIN_MS } from './timing'

export type CatFacing = 'left' | 'right'

export type Cat = {
  // Footprint top-left, like an agent's.
  x: number
  y: number
  facing: CatFacing
  // Walk frame, 0-1, advanced by every tile moved.
  frame: number
  path: Point[]
  // A resting cat picks its next target once the clock reaches this.
  restUntil: number
  // State of the seeded generator.
  seed: number
}

export const CAT_FUR = 0xd9822b
export const CAT_DARK = 0x8a4b1f
export const CAT_PALETTE: readonly number[] = Object.freeze([CAT_FUR, CAT_DARK])

// Mulberry32: one draw in [0, 1) and the next seed. A local seeded generator keeps the walk reproducible.
const draw = (seed: number): { value: number; seed: number } => {
  const s = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(s ^ (s >>> 15), 1 | s)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, seed: s }
}

// The map as the cat sees it: the same tiles, but it stands on a CAT_FOOT, not the people's footprint, so a mid
// map's 5x5 collision never applies to it (D61).
const asCat = (map: OfficeMap): OfficeMap => (map.foot.w === CAT_FOOT.w && map.foot.h === CAT_FOOT.h ? map : { ...map, foot: CAT_FOOT })

// Where in a person's spot the cat stands: beside the person's feet on a map with a bigger footprint (spot + (1,
// foot.h - 2)), the spot itself on the small map.
const catOffset = (map: OfficeMap): Point =>
  map.foot.w > CAT_FOOT.w && map.foot.h > CAT_FOOT.h ? { x: 1, y: map.foot.h - CAT_FOOT.h } : { x: 0, y: 0 }

// Where the cat may rest: every shared room's door spot and desk spots it can stand on.
const spotsOf = (map: OfficeMap): Point[] => {
  const offset = catOffset(map)
  const catMap = asCat(map)

  return map.rooms
    .filter(room => room.kind !== 'team')
    .flatMap(room => [room.doorStand, ...room.anchors])
    .map(p => ({ x: p.x + offset.x, y: p.y + offset.y }))
    .filter(p => canStand(catMap, p.x, p.y))
}

const restFor = (seed: number): { ms: number; seed: number } => {
  const { value, seed: next } = draw(seed)

  return { ms: CAT_REST_MIN_MS + Math.floor(value * (CAT_REST_MAX_MS - CAT_REST_MIN_MS)), seed: next }
}

// Seats the cat at a seeded shared-room spot, resting. Undefined when the map has no such spot.
export const spawnCat = (map: OfficeMap, seed: number, now: number): Cat | undefined => {
  const spots = spotsOf(map)
  if (spots.length === 0) return undefined
  const { value, seed: afterPick } = draw(seed)
  const spot = spots[Math.floor(value * spots.length)] ?? spots[0]
  if (spot === undefined) return undefined
  const rest = restFor(afterPick)

  return { x: spot.x, y: spot.y, facing: 'right', frame: 0, path: [], restUntil: now + rest.ms, seed: rest.seed }
}

// One tick: at most one tile along the path. A resting cat whose time is up picks a seeded spot and a BFS path to
// it. A cat that can no longer stand (a resize) is reseated. Returns the same object when nothing changes.
export const stepCat = (cat: Cat, fullMap: OfficeMap, now: number): Cat => {
  const map = asCat(fullMap)
  if (!canStand(map, cat.x, cat.y)) return spawnCat(fullMap, cat.seed, now) ?? cat
  const [head, ...rest] = cat.path
  if (head !== undefined) {
    // A path from an older map may not start next to the cat any more; it is dropped, never jumped.
    if (!canStand(map, head.x, head.y) || Math.abs(head.x - cat.x) + Math.abs(head.y - cat.y) !== 1) {
      return { ...cat, path: [], restUntil: now }
    }
    const moved: Cat = {
      ...cat,
      x: head.x,
      y: head.y,
      facing: head.x < cat.x ? 'left' : head.x > cat.x ? 'right' : cat.facing,
      frame: (cat.frame + 1) % 2,
      path: rest,
    }
    if (rest.length > 0) return moved
    const resting = restFor(cat.seed)

    return { ...moved, restUntil: now + resting.ms, seed: resting.seed }
  }
  if (now < cat.restUntil) return cat
  const spots = spotsOf(fullMap).filter(p => p.x !== cat.x || p.y !== cat.y)
  const picked = draw(cat.seed)
  const target = spots[Math.floor(picked.value * spots.length)]
  const path = target === undefined ? [] : findPath(map, cat, target)
  if (path.length > 0) return { ...cat, path, seed: picked.seed }
  const resting = restFor(picked.seed)

  return { ...cat, restUntil: now + resting.ms, seed: resting.seed }
}

// The cat in the 3x2 footprint: 3x4 pixels, ears and head at the facing end, tail at the other. A walking cat
// alternates its legs; a resting cat sits with all legs down. `.` pixels take the floor color.
export const catArt = (cat: Cat, floor: number): Cell[][] => {
  const walking = cat.path.length > 0
  const legs: Px[] = walking ? (cat.frame % 2 === 0 ? [CAT_FUR, '.', CAT_FUR] : ['.', CAT_FUR, '.']) : [CAT_FUR, CAT_FUR, CAT_FUR]
  const art: Px[][] = [
    ['.', '.', '.'],
    ['.', '.', CAT_DARK],
    [CAT_DARK, CAT_FUR, CAT_FUR],
    legs,
  ]
  if (cat.facing === 'left') for (const row of art) row.reverse()

  return compose(art, floor)
}

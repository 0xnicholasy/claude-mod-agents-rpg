import { expect, test } from 'claude-code/testing'
import { CAT_DARK, CAT_FUR, catArt, spawnCat, stepCat } from './cat'
import type { Cat } from './cat'
import { buildOffice, canStand, roomAt } from './map'
import { CAT_REST_MAX_MS, CAT_REST_MIN_MS, TICK_MS } from './timing'

const map = buildOffice(80, 11, [{ id: 'team:t1', label: 'proj' }, { id: 'team:t2', label: 'two' }])
const kindOf = (x: number, y: number): string | undefined => map.rooms.find(room => room.id === roomAt(map, x, y))?.kind

const walk = (ticks: number, seed = 7): Cat[] => {
  let cat = spawnCat(map, seed, 0) ?? ({} as Cat)
  const seen: Cat[] = [cat]
  for (let i = 1; i <= ticks; i++) {
    cat = stepCat(cat, map, i * TICK_MS)
    seen.push(cat)
  }

  return seen
}

test('the cat spawns resting on a shared-room spot', () => {
  const cat = spawnCat(map, 1, 1000)

  expect(cat).toBeDefined()
  expect(canStand(map, cat?.x ?? -1, cat?.y ?? -1)).toBe(true)
  expect(kindOf(cat?.x ?? -1, cat?.y ?? -1)).not.toBe('team')
  expect(cat?.path).toEqual([])
  expect((cat?.restUntil ?? 0) - 1000).toBeGreaterThanOrEqual(CAT_REST_MIN_MS)
  expect((cat?.restUntil ?? 0) - 1000).toBeLessThan(CAT_REST_MAX_MS)
})

test('the cat walks tile by tile', () => {
  // 3 minutes of ticks: long enough for several rests and walks.
  const seen = walk(1800)
  let walked = 0
  seen.forEach((cat, i) => {
    expect(canStand(map, cat.x, cat.y)).toBe(true)
    const prev = seen[i - 1]
    if (prev === undefined) return
    const dist = Math.abs(cat.x - prev.x) + Math.abs(cat.y - prev.y)
    expect(dist).toBeLessThanOrEqual(1)
    walked += dist
    // Each stop is on a shared-room spot, never in a team room.
    if (cat.path.length === 0) expect(kindOf(cat.x, cat.y)).not.toBe('team')
  })
  expect(walked).toBeGreaterThan(10)
  expect(new Set(seen.map(cat => `${cat.x},${cat.y}`)).size).toBeGreaterThan(5)
})

test('the cat rests 5 to 15 seconds and the walk is the same for the same seed', () => {
  const seen = walk(600)
  const first = seen.findIndex((cat, i) => i > 0 && cat.path.length === 0 && (seen[i - 1]?.path.length ?? 0) === 1)
  const rest = (seen[first]?.restUntil ?? 0) - first * TICK_MS
  expect(rest).toBeGreaterThanOrEqual(CAT_REST_MIN_MS)
  expect(rest).toBeLessThan(CAT_REST_MAX_MS)

  expect(walk(600)).toEqual(seen)
  expect(walk(600, 8)).not.toEqual(seen)
})

test('a cat that can no longer stand is reseated and a stale path is dropped', () => {
  const cat = spawnCat(map, 3, 0) ?? ({} as Cat)
  const lost = stepCat({ ...cat, x: 0, y: 0 }, map, 100)
  expect(canStand(map, lost.x, lost.y)).toBe(true)

  const stale = stepCat({ ...cat, path: [{ x: cat.x + 9, y: cat.y }] }, map, 100)
  expect(stale.path).toEqual([])
  expect({ x: stale.x, y: stale.y }).toEqual({ x: cat.x, y: cat.y })
})

test('the cat draws as a 3x2 sprite that faces and walks', () => {
  const floor = 0x2b303b
  const sit: Cat = { x: 0, y: 0, facing: 'right', frame: 0, path: [], restUntil: 0, seed: 1 }
  const art = catArt(sit, floor)

  expect(art).toHaveLength(2)
  expect(art.every(row => row.length === 3)).toBe(true)
  const colors = new Set(art.flat().flatMap(c => [c.fg, c.bg]))
  expect([...colors].every(c => c === floor || c === CAT_FUR || c === CAT_DARK)).toBe(true)
  // Facing left mirrors the sprite; a walking cat lifts a leg.
  expect(catArt({ ...sit, facing: 'left' }, floor)[0]).toEqual([...(art[0] ?? [])].reverse())
  const stride = (frame: number): Cat => ({ ...sit, frame, path: [{ x: 1, y: 0 }] })
  expect(catArt(stride(0), floor)).not.toEqual(catArt(stride(1), floor))
  expect(catArt(stride(0), floor)).not.toEqual(art)
})

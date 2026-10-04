import { expect, test } from 'claude-code/testing'
import type { Tier } from './agents'
import { DEFAULT_COLOR, isValidGlyph, packCells, type Cell } from './raster'
import { frameCount, isTransparent, nameplate, POSES, SPRITE_PALETTE, sprite, TIER_COLORS, type Pose } from './sprites'

const TIERS: Tier[] = ['haiku', 'sonnet', 'opus', 'fable', 'grey']
const key = (grid: Cell[][]): string => JSON.stringify(grid)

test('every pose and frame is 3x2 of width-1 BMP glyphs the raster accepts', () => {
  for (const pose of POSES) {
    for (let frame = 0; frame < frameCount(pose); frame++) {
      const grid = sprite(pose, frame, 'opus')
      expect(grid.length).toBe(2)
      for (const row of grid) {
        expect(row.length).toBe(3)
        for (const c of row) {
          expect(c.ch).toBeLessThan(0x10000)
          expect(isValidGlyph(c.ch)).toBe(true)
        }
      }
      expect(packCells(grid).length).toBeGreaterThan(0)
    }
  }
})

test('walk and work poses have two distinct frames, idle has one', () => {
  expect(frameCount('idle')).toBe(1)
  const moving: Pose[] = ['walk', 'read', 'type', 'run', 'call', 'talk']
  for (const pose of moving) {
    expect(frameCount(pose)).toBe(2)
    expect(key(sprite(pose, 0, 'sonnet'))).not.toBe(key(sprite(pose, 1, 'sonnet')))
  }
})

test('tier colors are distinct and an unknown tier maps to grey', () => {
  const colors = TIERS.map((t) => TIER_COLORS[t])
  expect(new Set(colors).size).toBe(TIERS.length)
  // Deliberate invalid input: exercises the runtime fallback for a tier the type forbids.
  const unknown = sprite('idle', 0, 'mystery' as Tier)
  expect(key(unknown)).toBe(key(sprite('idle', 0, 'grey')))
})

test('nameplate trims to its width and the palette stays under 32 colors', () => {
  expect(nameplate('a-very-long-agent-description').length).toBe(12)
  expect(nameplate('abc', 2).map((c) => c.ch)).toEqual([0x61, 0x62])
  expect(nameplate('short').length).toBe(5)
  expect(nameplate('x', 0).length).toBe(0)
  expect(SPRITE_PALETTE.length).toBeLessThan(32)
  expect(new Set(SPRITE_PALETTE).size).toBe(SPRITE_PALETTE.length)
  const used = new Set<number>()
  for (const tier of TIERS) {
    for (const pose of POSES) {
      for (let frame = 0; frame < frameCount(pose); frame++) {
        for (const row of sprite(pose, frame, tier)) for (const c of row) { used.add(c.fg); used.add(c.bg) }
      }
    }
  }
  for (const c of nameplate('abc')) { used.add(c.fg); used.add(c.bg) }
  used.delete(DEFAULT_COLOR)
  expect([...used].sort((a, b) => a - b)).toEqual([...SPRITE_PALETTE].sort((a, b) => a - b))
})

test('out-of-range and negative frames wrap, idle ignores the index', () => {
  for (const pose of POSES) {
    if (pose === 'idle') {
      for (const f of [0, 1, 2, -1, 99, NaN]) expect(key(sprite(pose, f, 'opus'))).toBe(key(sprite(pose, 0, 'opus')))
      continue
    }
    expect(key(sprite(pose, 2, 'opus'))).toBe(key(sprite(pose, 0, 'opus')))
    expect(key(sprite(pose, -1, 'opus'))).toBe(key(sprite(pose, 1, 'opus')))
    expect(key(sprite(pose, NaN, 'opus'))).toBe(key(sprite(pose, 0, 'opus')))
  }
})

test('sprite returns fresh cells, so mutating one does not leak into the next call', () => {
  for (const pose of POSES) {
    const first = sprite(pose, 0, 'opus')
    const before = key(first)
    for (const row of first) for (const c of row) { c.ch = 0x58; c.fg = 0x123456; c.bg = 0x654321 }
    expect(key(sprite(pose, 0, 'opus'))).toBe(before)
  }
})

test('transparency convention: only the face has a non-default bg and every space cell is TRANSPARENT', () => {
  for (const tier of TIERS) {
    for (const pose of POSES) {
      for (let frame = 0; frame < frameCount(pose); frame++) {
        const nonDefault: Cell[] = []
        for (const row of sprite(pose, frame, tier)) {
          for (const c of row) {
            if (c.bg !== DEFAULT_COLOR) nonDefault.push(c)
            if (c.ch === 0x20) expect(isTransparent(c)).toBe(true)
          }
        }
        expect(nonDefault.length).toBe(1)
        expect(nonDefault[0]?.ch).toBe(0x2580)
      }
    }
  }
})

test('nameplate replaces non-BMP and control characters with ? and never emits an invalid glyph', () => {
  expect(nameplate('a\u{1F600}b', 2).map((c) => c.ch)).toEqual([0x61, 0x3f])
  expect(nameplate('a\nb').map((c) => c.ch)).toEqual([0x61, 0x3f, 0x62])
  for (const c of nameplate('a\u{1F600}\nb\tc')) expect(isValidGlyph(c.ch)).toBe(true)
  expect(nameplate('abc', -3).length).toBe(0)
})

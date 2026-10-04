import { expect, test } from 'claude-code/testing'
import type { Tier } from './agents'
import { isValidGlyph, packCells, type Cell } from './raster'
import { frameCount, nameplate, POSES, SPRITE_PALETTE, sprite, TIER_COLORS, type Pose } from './sprites'

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
  used.delete(0x01000000)
  for (const color of used) expect(SPRITE_PALETTE).toContain(color)
})

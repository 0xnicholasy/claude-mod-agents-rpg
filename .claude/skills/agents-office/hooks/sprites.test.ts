import { expect, test } from 'claude-code/testing'
import type { Tier } from './agents'
import { isValidGlyph, packCells, type Cell } from './raster'
import {
  FACINGS, figure, FIGURE_PALETTE, frameCount, HAIR_TONES, nameplate, POSES, ROLE_COLORS,
  SKIN_TONES, SPRITE_PALETTE, TIER_COLORS, type Facing, type Pose, type Role,
} from './sprites'

const TIERS: Tier[] = ['haiku', 'sonnet', 'opus', 'fable', 'grey']
const key = (grid: Cell[][]): string => JSON.stringify(grid)

test('tier colors are distinct', () => {
  const colors = TIERS.map((t) => TIER_COLORS[t])
  expect(new Set(colors).size).toBe(TIERS.length)
})

test('nameplate trims to its width and stays inside the sprite palette', () => {
  expect(nameplate('a-very-long-agent-description').length).toBe(12)
  expect(nameplate('abc', 2).map((c) => c.ch)).toEqual([0x61, 0x62])
  expect(nameplate('short').length).toBe(5)
  expect(nameplate('x', 0).length).toBe(0)
  expect(SPRITE_PALETTE.length).toBeLessThan(32)
  expect(new Set(SPRITE_PALETTE).size).toBe(SPRITE_PALETTE.length)
  for (const c of nameplate('abc')) {
    expect(SPRITE_PALETTE).toContain(c.fg)
    expect(SPRITE_PALETTE).toContain(c.bg)
  }
})

test('nameplate replaces non-BMP and control characters with ? and never emits an invalid glyph', () => {
  expect(nameplate('a\u{1F600}b', 2).map((c) => c.ch)).toEqual([0x61, 0x3f])
  expect(nameplate('a\nb').map((c) => c.ch)).toEqual([0x61, 0x3f, 0x62])
  for (const c of nameplate('a\u{1F600}\nb\tc')) expect(isValidGlyph(c.ch)).toBe(true)
  expect(nameplate('abc', -3).length).toBe(0)
})

const FLOOR = 0x123456
const DESK = 0x8d6e63
const fig = (pose: Pose, facing: Facing, frame = 0, key = 'k1', shirt: Tier | 'player' = 'opus', role: Role = 'dev'): Cell[][] =>
  figure({ pose, facing, frame, shirt, role, key, floor: FLOOR })

test('every pose and facing draws 3x2 valid cells', () => {
  for (const pose of POSES) {
    for (const facing of FACINGS) {
      for (let frame = 0; frame < frameCount(pose); frame++) {
        const grid = fig(pose, facing, frame)
        expect(grid.length).toBe(2)
        for (const row of grid) {
          expect(row.length).toBe(3)
          for (const c of row) {
            expect(c.ch).toBe(0x2580)
            expect(isValidGlyph(c.ch)).toBe(true)
          }
        }
        expect(packCells(grid).length).toBeGreaterThan(0)
      }
    }
  }
})

test('a standing figure reads as a person: hair over face, shirt torso, two legs', () => {
  const grid = fig('idle', 'down', 0, 'person', 'sonnet', 'lead')
  const [head, body] = grid
  const hairTone = head![1]!.fg
  expect(HAIR_TONES).toContain(hairTone)
  // Face row: skin sits below the hair in the middle column.
  expect(SKIN_TONES).toContain(head![1]!.bg)
  // Torso is the tier color across the top of the lower cell row, legs the role color below it.
  for (const c of body!) expect(c.fg).toBe(TIER_COLORS.sonnet)
  expect(body![0]!.bg).toBe(ROLE_COLORS.lead)
  expect(body![2]!.bg).toBe(ROLE_COLORS.lead)
  // The gap between the legs shows the floor.
  expect(body![1]!.bg).toBe(FLOOR)
})

test('facing is visible: down shows eyes, up shows hair only, sides put the face on one side', () => {
  const eyeCols = (g: Cell[][]): number[] => g[0]!.flatMap((c, x) => (FIGURE_PALETTE.includes(c.bg) && c.bg === 0x1a1a1a ? [x] : []))
  expect(eyeCols(fig('idle', 'down'))).toEqual([0, 2])
  expect(eyeCols(fig('idle', 'up'))).toEqual([])
  expect(eyeCols(fig('idle', 'left'))).toEqual([0])
  expect(eyeCols(fig('idle', 'right'))).toEqual([2])
  const keys = FACINGS.map((f) => key(fig('idle', f)))
  expect(new Set(keys).size).toBe(4)
})

test('walk frames differ', () => {
  expect(frameCount('walk')).toBe(4)
  for (const facing of FACINGS) {
    const keys = [0, 1, 2, 3].map((f) => key(fig('walk', facing, f)))
    expect(new Set(keys).size).toBe(4)
  }
})

test('seated hides the legs behind the desk', () => {
  for (const pose of ['read', 'type'] as const) {
    for (const facing of FACINGS) {
      for (let frame = 0; frame < 2; frame++) {
        const body = fig(pose, facing, frame)[1]!
        for (const c of body) expect(c.bg).toBe(DESK)
        expect(body.some((c) => c.bg === ROLE_COLORS.dev)).toBe(false)
      }
    }
  }
})

test('shirt is the tier color and pants are the role color', () => {
  for (const t of TIERS) expect(fig('idle', 'down', 0, 'k', t)[1]![1]!.fg).toBe(TIER_COLORS[t])
  expect(fig('idle', 'down', 0, 'k', 'player')[1]![1]!.fg).toBe(0xf5f5f5)
  for (const r of Object.keys(ROLE_COLORS) as Role[]) expect(fig('idle', 'down', 0, 'k', 'opus', r)[1]![0]!.bg).toBe(ROLE_COLORS[r])
})

test('hair and skin are stable per key', () => {
  expect(key(fig('idle', 'down', 0, 'agent-7'))).toBe(key(fig('idle', 'down', 0, 'agent-7')))
  const hair = new Set<number>()
  const skin = new Set<number>()
  for (let i = 0; i < 50; i++) {
    const head = fig('idle', 'down', 0, `agent-${i}`)[0]!
    hair.add(head[1]!.fg)
    skin.add(head[1]!.bg)
  }
  expect(hair.size).toBeGreaterThanOrEqual(3)
  expect(skin.size).toBeGreaterThanOrEqual(3)
})

test('every figure color is in the palette or is the floor', () => {
  const allowed = new Set<number>([...FIGURE_PALETTE, FLOOR])
  for (const pose of POSES) {
    for (const facing of FACINGS) {
      for (let frame = 0; frame < frameCount(pose); frame++) {
        for (const c of fig(pose, facing, frame, 'pal', 'player', 'review').flat()) {
          expect(allowed.has(c.fg)).toBe(true)
          expect(allowed.has(c.bg)).toBe(true)
        }
      }
    }
  }
})

test('seated figures have a monitor on the facing side and frames that differ', () => {
  const screens = [0x81d4fa, 0x4fa3c7]
  for (const pose of ['read', 'type'] as const) {
    const right = fig(pose, 'down', 0)
    expect(screens).toContain(right[0]![2]!.bg === FLOOR ? -1 : right[0]![2]!.bg)
    const left = fig(pose, 'left', 0)
    expect(screens).toContain(left[0]![0]!.bg === FLOOR ? -1 : left[0]![0]!.bg)
    expect(key(fig(pose, 'right', 0))).not.toBe(key(fig(pose, 'right', 1)))
    expect(key(fig(pose, 'left', 0))).not.toBe(key(fig(pose, 'right', 0)))
  }
})

test('run, call and talk carry a prop that never erases the face', () => {
  const props: Record<string, number> = { run: 0x00e676, call: 0x90a4ae, talk: 0xfff176 }
  for (const pose of ['run', 'call', 'talk'] as const) {
    for (const facing of FACINGS) {
      const f0 = fig(pose, facing, 0)
      const f1 = fig(pose, facing, 1)
      expect(f0[0]![2]!.fg).toBe(props[pose])
      expect(key(f0)).not.toBe(key(f1))
      // Face row (the bg of the top cells) matches the idle figure's face.
      const idle = fig('idle', facing, 0)
      expect(f0[0]!.map((c) => c.bg)).toEqual(idle[0]!.map((c) => c.bg))
      expect(f1[0]!.map((c) => c.bg)).toEqual(idle[0]!.map((c) => c.bg))
    }
  }
  expect(fig('idle', 'down')[0]![2]!.fg).not.toBe(props.run)
})

test('figure frames wrap and unknown shirt or role fall back', () => {
  expect(key(fig('walk', 'down', -1))).toBe(key(fig('walk', 'down', 3)))
  expect(key(fig('walk', 'down', 5))).toBe(key(fig('walk', 'down', 1)))
  expect(key(fig('walk', 'down', Number.NaN))).toBe(key(fig('walk', 'down', 0)))
  expect(key(fig('idle', 'down', 7))).toBe(key(fig('idle', 'down', 0)))
  // Deliberate invalid input: exercises the runtime fallbacks for values the types forbid.
  expect(key(fig('idle', 'down', 0, 'k', 'mystery' as Tier, 'boss' as Role))).toBe(key(fig('idle', 'down', 0, 'k', 'grey', 'dev')))
})

test('the figure palette is unique and small', () => {
  expect(new Set(FIGURE_PALETTE).size).toBe(FIGURE_PALETTE.length)
  expect(FIGURE_PALETTE.length).toBeLessThan(32)
})

test('every role color stays visibly away from the floor color', () => {
  const channels = (c: number): number[] => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff]
  const far = (a: number, b: number): boolean => channels(a).some((v, i) => Math.abs(v - (channels(b)[i] ?? 0)) >= 24)
  for (const color of Object.values(ROLE_COLORS)) {
    expect(far(color, 0x2b303b)).toBe(true)
  }
})

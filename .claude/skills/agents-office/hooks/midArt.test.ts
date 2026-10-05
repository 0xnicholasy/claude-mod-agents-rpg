import { expect, test } from 'claude-code/testing'
import { MID_IDLE, MID_SEAT_H, MID_SEAT_READ, MID_SEAT_TYPE, MID_SEAT_W, MID_STAND_H, MID_STAND_W, MID_WALK, SLOTS, type Grid } from './midArt'
import { FACINGS } from './sprites'

const standing = (): Grid[] => FACINGS.flatMap(f => [MID_IDLE[f], ...MID_WALK[f]])
const seated = (): Grid[] => [MID_SEAT_READ, ...MID_SEAT_TYPE]
const has = (g: Grid, ch: string): boolean => g.some(row => row.includes(ch))

test('grids use only slot letters', () => {
  expect(standing().length).toBe(20)
  for (const g of standing()) {
    expect(g.length).toBe(MID_STAND_H)
    for (const row of g) {
      expect(row.length).toBe(MID_STAND_W)
      for (const ch of row) expect(SLOTS).toContain(ch)
    }
  }
  for (const g of seated()) {
    expect(g.length).toBe(MID_SEAT_H)
    for (const row of g) {
      expect(row.length).toBe(MID_SEAT_W)
      for (const ch of row) expect(SLOTS).toContain(ch)
    }
  }
})

test('the front view has eyes and a tie', () => {
  const down = MID_IDLE.down
  const eyes = down.join('').split('E').length - 1
  expect(eyes).toBe(2)
  expect(has(down, 'M')).toBe(true)
  expect(has(down, 'K')).toBe(true)
  expect(down.filter(row => row.includes('S')).length).toBeGreaterThan(2)
  // Two legs ending in two shoes on the bottom row.
  expect(down[MID_STAND_H - 1]).toBe('.F.F.')
  expect(has(MID_IDLE.up, 'E')).toBe(false)
  for (const f of ['down', 'left', 'right'] as const) expect(has(MID_IDLE[f], 'E')).toBe(true)
  for (const g of [...standing(), ...seated()]) expect(g.join('').includes('S')).toBe(true)
})

test('walk frames differ pairwise per facing and mirror between left and right', () => {
  for (const f of FACINGS) {
    expect(new Set(MID_WALK[f].map(g => g.join('/'))).size).toBe(4)
    expect(MID_WALK[f].map(g => g.join('/'))).not.toContain(MID_IDLE[f].join('/'))
  }
  const mirror = (g: Grid): string => g.map(row => [...row].reverse().join('')).join('/')
  MID_WALK.right.forEach((g, i) => expect(mirror(g)).toBe(MID_WALK.left[i]!.join('/')))
})

test('seated grids show the desk, the monitor and a moving hand', () => {
  for (const g of seated()) {
    expect(g[7]!.includes('D')).toBe(true)
    expect(has(g, 'C')).toBe(true)
    expect(has(g, 'P')).toBe(false)
  }
  expect(MID_SEAT_TYPE[0]!.join('/')).not.toBe(MID_SEAT_TYPE[1]!.join('/'))
  expect(MID_SEAT_READ[7]).toBe('DDDDDDDD')
})

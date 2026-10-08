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

test('the front view has a face of two eyes, a mouth and a tie', () => {
  const down = MID_IDLE.down
  expect(down.join('').split('E').length - 1).toBe(2)
  expect(has(down, 'M')).toBe(true)
  expect(has(down, 'K')).toBe(true)
  // The face is the biggest feature: more skin pixels in the head (rows 0-4) than the 5 of the old grids.
  expect(down.slice(0, 5).join('').split('S').length - 1).toBeGreaterThan(5)
  // Two legs ending in two shoes on the bottom row.
  expect(down[MID_STAND_H - 1]).toBe('.F.F.')
  expect(has(MID_IDLE.up, 'E')).toBe(false)
  expect(has(MID_IDLE.up, 'M')).toBe(false)
  for (const f of ['down', 'left', 'right'] as const) {
    expect(has(MID_IDLE[f], 'E')).toBe(true)
    expect(has(MID_IDLE[f], 'M')).toBe(true)
  }
  for (const g of [...standing(), ...seated()]) expect(g.join('').includes('S')).toBe(true)
})

test('walk frames keep the head still, swing the legs and mirror between left and right', () => {
  for (const f of FACINGS) {
    const frames = MID_WALK[f]
    expect(frames.length).toBe(4)
    for (const g of frames) expect(g.slice(0, 8)).toEqual(MID_IDLE[f].slice(0, 8))
    // Frames 1 and 3 swing the legs in different directions; frames 2 and 4 are the idle legs.
    expect(frames[0]!.slice(8).join('/')).not.toBe(frames[2]!.slice(8).join('/'))
    expect(frames[1]).toEqual(MID_IDLE[f])
    expect(frames[3]).toEqual(MID_IDLE[f])
    expect(frames[0]).not.toEqual(MID_IDLE[f])
    expect(frames[2]).not.toEqual(MID_IDLE[f])
  }
  const mirror = (g: Grid): string => g.map(row => [...row].reverse().join('')).join('/')
  expect(mirror(MID_IDLE.right)).toBe(MID_IDLE.left.join('/'))
  MID_WALK.right.forEach((g, i) => expect(mirror(g)).toBe(MID_WALK.left[i]!.join('/')))
})

test('seated grids show the desk, the monitor and a moving hand', () => {
  for (const g of seated()) {
    // The person is the down head and torso.
    expect(g.slice(0, 7).map(r => r.slice(0, 5))).toEqual(MID_IDLE.down.slice(0, 7))
    expect(g[7]!.includes('D')).toBe(true)
    expect(has(g, 'C')).toBe(true)
    expect(has(g, 'P')).toBe(false)
  }
  expect(MID_SEAT_TYPE[0]!.join('/')).not.toBe(MID_SEAT_TYPE[1]!.join('/'))
  expect(MID_SEAT_READ[7]).toBe('DDDDDDDD')
})

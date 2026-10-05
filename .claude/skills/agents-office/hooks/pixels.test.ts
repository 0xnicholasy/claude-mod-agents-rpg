import { expect, test } from 'claude-code/testing'
import { compose, countPairs, PAIR_BUDGET } from './pixels'
import type { Cell } from './raster'

const FLOOR = 0x303030

test('a 3x4 figure composes to 3x2 upper-half cells', () => {
  const art = [
    [0xff0000, 0x00ff00, 0x0000ff],
    [0x111111, 0x222222, 0x333333],
    [0x444444, 0x555555, 0x666666],
    [0x777777, 0x888888, 0x999999],
  ]
  const grid = compose(art, FLOOR)
  expect(grid.length).toBe(2)
  for (const row of grid) {
    expect(row.length).toBe(3)
    for (const c of row) expect(c.ch).toBe(0x2580)
  }
  expect(grid[0]?.[0]).toEqual({ ch: 0x2580, fg: 0xff0000, bg: 0x111111 })
  expect(grid[0]?.[2]).toEqual({ ch: 0x2580, fg: 0x0000ff, bg: 0x333333 })
  expect(grid[1]?.[1]).toEqual({ ch: 0x2580, fg: 0x555555, bg: 0x888888 })
})

test('a dot pixel takes the floor color', () => {
  const grid = compose([['.', 0xaa0000, '.'], ['.', '.', 0xbb0000]], FLOOR)
  expect(grid[0]?.[0]).toEqual({ ch: 0x2580, fg: FLOOR, bg: FLOOR })
  expect(grid[0]?.[1]).toEqual({ ch: 0x2580, fg: 0xaa0000, bg: FLOOR })
  expect(grid[0]?.[2]).toEqual({ ch: 0x2580, fg: FLOOR, bg: 0xbb0000 })
})

test('an odd row count throws', () => {
  expect(() => compose([[0x111111], [0x222222], [0x333333]], FLOOR)).toThrow()
})

test('rows of different widths throw', () => {
  expect(() => compose([[0x111111, 0x222222], [0x333333]], FLOOR)).toThrow()
})

test('countPairs counts distinct fg/bg pairs', () => {
  const grid: Cell[][] = [
    [{ ch: 0x41, fg: 1, bg: 2 }, { ch: 0x42, fg: 1, bg: 2 }],
    [{ ch: 0x2580, fg: 2, bg: 1 }, { ch: 0x2580, fg: 3, bg: 3 }],
  ]
  expect(countPairs(grid)).toBe(3)
  expect(PAIR_BUDGET).toBe(256)
})

import { expect, test } from 'claude-code/testing'
import { rasterSize, stripRows } from './loop'

test('stripRows follows the table and neither map nor strip shrinks as the body grows', () => {
  const table: Array<[number, number, number]> = [
    [12, 0, 12],
    [13, 1, 12],
    [14, 2, 12],
    [15, 2, 13],
    [20, 2, 18],
    [21, 3, 18],
    [22, 4, 18],
    [23, 5, 18],
    [30, 5, 25],
  ]
  for (const [body, strip, map] of table) {
    expect(stripRows(body)).toBe(strip)
    expect(rasterSize(60, body).rows).toBe(map)
  }
  expect(stripRows(11)).toBe(0)
  for (let body = 12; body < 40; body++) {
    expect(stripRows(body + 1)).toBeGreaterThanOrEqual(stripRows(body))
    expect(body + 1 - stripRows(body + 1)).toBeGreaterThanOrEqual(body - stripRows(body))
  }
})

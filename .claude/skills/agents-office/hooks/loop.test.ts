import { expect, test } from 'claude-code/testing'
import { bodyRowsFor, rasterSize, stripRows } from './loop'

test('stripRows follows the table and neither map nor strip shrinks as the body grows', () => {
  const table: Array<[number, number, number]> = [
    [11, 0, 11],
    [12, 1, 11],
    [13, 2, 11],
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
  expect(stripRows(10)).toBe(0)
  for (let body = 11; body < 40; body++) {
    expect(stripRows(body + 1)).toBeGreaterThanOrEqual(stripRows(body))
    expect(body + 1 - stripRows(body + 1)).toBeGreaterThanOrEqual(body - stripRows(body))
  }
})

test('bodyRowsFor sizes an inline pane from the viewport and leaves other cases to bodyRows', () => {
  // [viewport rows, expected body rows] with 13 chrome rows and a cap of 23.
  const inline: Array<[number, number]> = [
    [0, 7],
    [13, 1],
    [14, 1],
    [24, 11],
    [36, 23],
    [37, 23],
    [50, 23],
  ]
  for (const [viewportRows, body] of inline) {
    // A viewport of 0 rows counts as unmeasured, so bodyRows (7) is used.
    expect(bodyRowsFor('inline', 7, viewportRows)).toBe(body)
  }
  expect(bodyRowsFor('inline', 7, undefined)).toBe(7)
  expect(bodyRowsFor('dock', 7, 50)).toBe(7)
})

import { expect, test } from 'claude-code/testing'
import { bodyRowsFor, footFor, INLINE_MAX_ROWS, mapFor, rasterSize, stripRows } from './loop'
import { MID_FOOT, MID_MIN_ROWS, SMALL_FOOT } from './map'

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

test('mid starts at 72 columns', () => {
  expect(footFor(76, 11)).toEqual(MID_FOOT)
  expect(footFor(72, 11)).toEqual(MID_FOOT)
  expect(footFor(71, 11)).toEqual(SMALL_FOOT)
  expect(footFor(70, 11)).toEqual(SMALL_FOOT)
  // Below the 11-row minimum there is no office at all, and the small footprint stands in.
  expect(footFor(120, 10)).toEqual(SMALL_FOOT)
  expect(rasterSize(76, 11).foot).toEqual(MID_FOOT)
  expect(rasterSize(70, 11).foot).toEqual(SMALL_FOOT)
  expect(mapFor(76, 11, [{ id: 'team:a', label: 'a' }])?.foot).toEqual(MID_FOOT)
  expect(mapFor(70, 11, [{ id: 'team:a', label: 'a' }])?.foot).toEqual(SMALL_FOOT)
  // The cache never hands a small map to a mid size or the reverse.
  expect(mapFor(76, 11, [{ id: 'team:a', label: 'a' }])?.foot).toEqual(MID_FOOT)
})

test('an inline body of 23 rows gives a 23-row mid raster with no strip', () => {
  expect(INLINE_MAX_ROWS).toBe(MID_MIN_ROWS)
  expect(rasterSize(116, INLINE_MAX_ROWS)).toEqual({ columns: 116, rows: 23, strip: 0, foot: MID_FOOT })
  // The small layout keeps its 18 + 5 split at the same rows.
  expect(rasterSize(70, INLINE_MAX_ROWS)).toEqual({ columns: 70, rows: 18, strip: 5, foot: SMALL_FOOT })
  // A mid body of 11 to 23 rows is all map; strip rows appear only past 23 (D59).
  for (let body = 11; body <= 23; body++) expect(stripRows(body, MID_FOOT)).toBe(0)
  expect(stripRows(24, MID_FOOT)).toBe(1)
  expect(stripRows(40, MID_FOOT)).toBe(5)
  expect(mapFor(116, 23, [{ id: 'team:a', label: 'a' }])?.rows).toBe(23)
})

import { expect, test } from 'claude-code/testing'
import { bodyRowsFor, footFor, INLINE_MAX_ROWS, mapFor, rasterSize, stripRows } from './loop'
import { MID_FOOT, MID_MIN_ROWS } from './map'

test('stripRows follows the mid table and neither map nor strip shrinks as the body grows', () => {
  // [body rows, strip rows, map rows]: the strip appears only past MID_MIN_ROWS (23) body rows.
  const table: Array<[number, number, number]> = [
    [11, 0, 11],
    [12, 0, 12],
    [20, 0, 20],
    [23, 0, 23],
    [24, 1, 23],
    [25, 2, 23],
    [27, 4, 23],
    [28, 5, 23],
    [30, 5, 25],
  ]
  for (const [body, strip, map] of table) {
    expect(stripRows(body, MID_FOOT)).toBe(strip)
    expect(rasterSize(60, body).strip).toBe(strip)
    expect(rasterSize(60, body).rows).toBe(map)
  }
  expect(stripRows(10, MID_FOOT)).toBe(0)
  for (let body = 11; body < 40; body++) {
    expect(stripRows(body + 1, MID_FOOT)).toBeGreaterThanOrEqual(stripRows(body, MID_FOOT))
    expect(body + 1 - stripRows(body + 1, MID_FOOT)).toBeGreaterThanOrEqual(body - stripRows(body, MID_FOOT))
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

test('every office size draws the mid footprint, narrow panes included (D72)', () => {
  expect(footFor()).toEqual(MID_FOOT)
  expect(rasterSize(60, 11).foot).toEqual(MID_FOOT)
  expect(rasterSize(68, 30).foot).toEqual(MID_FOOT)
  expect(rasterSize(71, 11).foot).toEqual(MID_FOOT)
  expect(mapFor(64, 30, [{ id: 'team:a', label: 'a' }])?.foot).toEqual(MID_FOOT)
  // A 60-column pane is narrower than the mid map, which the camera crops.
  const narrow = mapFor(60, 23, [{ id: 'team:a', label: 'a' }])
  expect(narrow?.columns).toBeGreaterThan(60)
  // Below the minimum there is no office at all.
  expect(mapFor(59, 23, [{ id: 'team:a', label: 'a' }])).toBeUndefined()
  expect(mapFor(120, 10, [{ id: 'team:a', label: 'a' }])).toBeUndefined()
})

test('an inline body of 23 rows gives a 23-row mid raster with no strip', () => {
  expect(INLINE_MAX_ROWS).toBe(MID_MIN_ROWS)
  expect(rasterSize(116, INLINE_MAX_ROWS)).toEqual({ columns: 116, rows: 23, strip: 0, foot: MID_FOOT })
  expect(rasterSize(70, INLINE_MAX_ROWS)).toEqual({ columns: 70, rows: 23, strip: 0, foot: MID_FOOT })
  // A mid body of 11 to 23 rows is all map; strip rows appear only past 23 (D59).
  for (let body = 11; body <= 23; body++) expect(stripRows(body, MID_FOOT)).toBe(0)
  expect(stripRows(24, MID_FOOT)).toBe(1)
  expect(stripRows(40, MID_FOOT)).toBe(5)
  expect(mapFor(116, 23, [{ id: 'team:a', label: 'a' }])?.rows).toBe(23)
})

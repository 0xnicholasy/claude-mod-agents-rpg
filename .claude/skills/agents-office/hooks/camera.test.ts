import { expect, test } from 'claude-code/testing'
import { cropFrame, focusOf, overlaySpan, viewFor } from './camera'
import { buildFrame } from './frame'
import { buildOffice, MID_FOOT } from './map'
import type { TeamSpec } from './map'
import type { Cell } from './raster'

const teams = (n: number): TeamSpec[] => Array.from({ length: n }, (_, i) => ({ id: `team:s${i}` as const, label: `project-${i}` }))
const rowText = (grid: Cell[][], y: number): string => String.fromCodePoint(...(grid[y] ?? []).map(c => c.ch))
const frameOf = (map: ReturnType<typeof buildOffice>): Cell[][] => buildFrame({ map, agents: {}, motion: {}, bubbles: [], now: 0 })

test('the window follows the player', () => {
  const office = buildOffice(60, 18, teams(6))
  expect(office.columns).toBeGreaterThanOrEqual(73)
  const grid = buildFrame({ map: office, agents: {}, motion: {}, bubbles: [], now: 0 })
  const y = office.corridor.y

  // Player at the far right: the window sits at the right edge, ◀ shows and ▶ does not.
  const right = cropFrame(grid, office, 60, 18, focusOf(office, { x: office.columns - 4, y: 2 }, 'team:s0'))
  expect(right.every(row => row.length === 60)).toBe(true)
  expect(rowText(right, y).startsWith('◀')).toBe(true)
  expect(rowText(right, y).includes('▶')).toBe(false)
  expect(viewFor(office.columns, office.rows, 60, 18, { x: office.columns - 2, y: 2 }).x).toBe(office.columns - 60)

  // Player at the far left: the opposite.
  const left = cropFrame(grid, office, 60, 18, focusOf(office, { x: 1, y: 2 }, 'team:s0'))
  expect(rowText(left, y).endsWith('▶')).toBe(true)
  expect(rowText(left, y).includes('◀')).toBe(false)

  // In the middle both edges hide content, and the window moves with the player.
  const mid = cropFrame(grid, office, 60, 18, focusOf(office, { x: 36, y: 2 }, 'team:s0'))
  expect(rowText(mid, y).startsWith('◀')).toBe(true)
  expect(rowText(mid, y).endsWith('▶')).toBe(true)
  expect(viewFor(office.columns, office.rows, 60, 18, { x: 40, y: 2 }).x).toBeGreaterThan(viewFor(office.columns, office.rows, 60, 18, { x: 20, y: 2 }).x)
})

test('edge marks show hidden rooms', () => {
  // A map that fits the pane is not cropped and draws no marks.
  const fits = buildOffice(60, 18, teams(2))
  const full = buildFrame({ map: fits, agents: {}, motion: {}, bubbles: [], now: 0 })
  expect(cropFrame(full, fits, 60, 18, { x: 30, y: 9 })).toBe(full)

  // With no player the camera centres on the own team room: the last team puts the window at the right edge.
  const wide = buildOffice(60, 18, teams(6))
  const grid = buildFrame({ map: wide, agents: {}, motion: {}, bubbles: [], now: 0 })
  expect(focusOf(wide, null, 'team:s5').x).toBeGreaterThan(focusOf(wide, null, 'team:s0').x)
  const view = cropFrame(grid, wide, 60, 18, focusOf(wide, null, 'team:s5'))
  expect(rowText(view, wide.corridor.y).startsWith('◀')).toBe(true)
  // Rows other than the corridor's first row carry no mark.
  expect(rowText(view, wide.corridor.y + 1).includes('◀')).toBe(false)
})

test('the view follows the player vertically', () => {
  const office = buildOffice(76, 11, teams(1), MID_FOOT)
  expect(office.rows).toBe(23)
  const grid = frameOf(office)
  const mid = Math.floor(76 / 2)

  // No player, own room in the top band: rows 0-10 show with ▼ and no ▲.
  const top = cropFrame(grid, office, 76, 11, focusOf(office, null, 'team:s0'))
  expect(top).toHaveLength(11)
  expect(top.every(row => row.length === 76)).toBe(true)
  expect(viewFor(office.columns, office.rows, 76, 11, focusOf(office, null, 'team:s0')).y).toBe(0)
  expect(top[10]?.[mid]?.ch).toBe(0x25bc)
  expect(top.some(row => row.some(c => c.ch === 0x25b2))).toBe(false)

  // A player in the bottom band: the view moves down and ▲ shows, with no ▼ at the map's end.
  const reception = office.rooms.find(r => r.id === 'reception')
  const stand = reception?.doorStand ?? { x: 1, y: 1 }
  const bottom = cropFrame(grid, office, 76, 11, focusOf(office, stand, 'team:s0'))
  expect(viewFor(office.columns, office.rows, 76, 11, focusOf(office, stand, 'team:s0')).y).toBe(23 - 11)
  expect(bottom[0]?.[mid]?.ch).toBe(0x25b2)
  expect(bottom.some(row => row.some(c => c.ch === 0x25bc))).toBe(false)

  // A player between the bands moves the view in steps with the player.
  const ys = [2, 8, 14, 20].map(y => viewFor(office.columns, office.rows, 76, 11, focusOf(office, { x: 5, y }, 'team:s0')).y)
  expect(ys).toEqual([...ys].sort((a, b) => a - b))
  expect(ys[3]).toBeGreaterThan(ys[0] ?? 0)
})

test('edge marks stay inside the view', () => {
  const office = buildOffice(76, 11, teams(8), MID_FOOT)
  expect(office.columns).toBeGreaterThan(76)
  const grid = frameOf(office)
  for (const player of [{ x: 40, y: 2 }, { x: 40, y: 10 }, { x: 40, y: 18 }, { x: 100, y: 18 }]) {
    const focus = focusOf(office, player, 'team:s0')
    const view = viewFor(office.columns, office.rows, 76, 11, focus)
    const cropped = cropFrame(grid, office, 76, 11, focus)
    expect(cropped).toHaveLength(11)
    expect(cropped.every(row => row.length === 76)).toBe(true)
    // ◀ and ▶ draw on the first visible corridor row, which is inside the view.
    const { row } = overlaySpan(office, 76, 11, focus)
    expect(row).toBeGreaterThanOrEqual(view.y)
    expect(row).toBeLessThan(view.y + view.height)
    const text = rowText(cropped, row - view.y)
    expect(text.startsWith('◀')).toBe(view.x > 0)
    expect(text.endsWith('▶')).toBe(view.x + view.width < office.columns)
  }
  // With the corridor scrolled out of view the overlay falls back to the view's top row, one row in under the ▲.
  const focus = { x: 10, y: 22 }
  const view = viewFor(office.columns, office.rows, 76, 6, focus)
  expect(view.y).toBeGreaterThan(office.corridor.y + office.corridor.h - 1)
  expect(overlaySpan(office, 76, 6, focus).row).toBe(view.y + 1)
  // The overlay lands on the row it is given.
  const lined = buildFrame({ map: office, agents: {}, motion: {}, bubbles: [], now: 0, overlay: 'hi', overlayFrom: 3, overlayWidth: 10, overlayRow: 12 })
  expect(rowText(lined, 12).slice(3, 5)).toBe('hi')
})

test('the vertical marks never cover the inspect line', () => {
  const office = buildOffice(76, 11, teams(1), MID_FOOT)
  const mid = Math.floor(76 / 2)
  // Every view height the player can produce: the overlay row is inside the view and its text survives the marks.
  for (let y = 0; y <= office.rows - MID_FOOT.h; y++) {
    const focus = focusOf(office, { x: 5, y }, 'team:s0')
    const span = overlaySpan(office, 76, 11, focus)
    const view = viewFor(office.columns, office.rows, 76, 11, focus)
    const text = 'inspect text over the corridor row'
    const grid = buildFrame({ map: office, agents: {}, motion: {}, bubbles: [], now: 0, overlay: text, overlayFrom: span.from, overlayWidth: span.width, overlayRow: span.row })
    const cropped = cropFrame(grid, office, 76, 11, focus)
    const shown = rowText(cropped, span.row - view.y)
    expect(shown.includes(text)).toBe(true)
    expect(span.row === view.y && view.y > 0).toBe(false)
    expect(cropped[10]?.[mid]?.ch === 0x25bc).toBe(view.y + 11 < office.rows)
    expect(cropped[0]?.[mid]?.ch === 0x25b2).toBe(view.y > 0)
  }
})

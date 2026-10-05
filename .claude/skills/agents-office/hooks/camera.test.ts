import { expect, test } from 'claude-code/testing'
import { cropFrame, focusOf, viewFor } from './camera'
import { buildFrame } from './frame'
import { buildOffice } from './map'
import type { TeamSpec } from './map'
import type { Cell } from './raster'

const teams = (n: number): TeamSpec[] => Array.from({ length: n }, (_, i) => ({ id: `team:s${i}` as const, label: `project-${i}` }))
const rowText = (grid: Cell[][], y: number): string => String.fromCodePoint(...(grid[y] ?? []).map(c => c.ch))

test('the window follows the player', () => {
  const office = buildOffice(60, 18, teams(6))
  expect(office.columns).toBeGreaterThanOrEqual(73)
  const grid = buildFrame({ map: office, agents: {}, motion: {}, bubbles: [], now: 0 })
  const y = office.corridor.y

  // Player at the far right: the window sits at the right edge, ◀ shows and ▶ does not.
  const right = cropFrame(grid, office, 60, focusOf(office, { x: office.columns - 4 }, 'team:s0'))
  expect(right.every(row => row.length === 60)).toBe(true)
  expect(rowText(right, y).startsWith('◀')).toBe(true)
  expect(rowText(right, y).includes('▶')).toBe(false)
  expect(viewFor(office.columns, 60, office.columns - 2).left).toBe(office.columns - 60)

  // Player at the far left: the opposite.
  const left = cropFrame(grid, office, 60, focusOf(office, { x: 1 }, 'team:s0'))
  expect(rowText(left, y).endsWith('▶')).toBe(true)
  expect(rowText(left, y).includes('◀')).toBe(false)

  // In the middle both edges hide content, and the window moves with the player.
  const mid = cropFrame(grid, office, 60, focusOf(office, { x: 36 }, 'team:s0'))
  expect(rowText(mid, y).startsWith('◀')).toBe(true)
  expect(rowText(mid, y).endsWith('▶')).toBe(true)
  expect(viewFor(office.columns, 60, 40).left).toBeGreaterThan(viewFor(office.columns, 60, 20).left)
})

test('edge marks show hidden rooms', () => {
  // A map that fits the pane is not cropped and draws no marks.
  const fits = buildOffice(60, 18, teams(2))
  const full = buildFrame({ map: fits, agents: {}, motion: {}, bubbles: [], now: 0 })
  expect(cropFrame(full, fits, 60, 30)).toBe(full)

  // With no player the camera centres on the own team room: the last team puts the window at the right edge.
  const wide = buildOffice(60, 18, teams(6))
  const grid = buildFrame({ map: wide, agents: {}, motion: {}, bubbles: [], now: 0 })
  expect(focusOf(wide, null, 'team:s5')).toBeGreaterThan(focusOf(wide, null, 'team:s0'))
  const view = cropFrame(grid, wide, 60, focusOf(wide, null, 'team:s5'))
  expect(rowText(view, wide.corridor.y).startsWith('◀')).toBe(true)
  // Rows other than the corridor's first row carry no mark.
  expect(rowText(view, wide.corridor.y + 1).includes('◀')).toBe(false)
})

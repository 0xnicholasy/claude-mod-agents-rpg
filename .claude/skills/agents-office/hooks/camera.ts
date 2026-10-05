// Camera (D45): the office can be wider than the pane when many sessions run. Pure functions crop the
// full-width frame to a pane-wide window and mark the edges that hide content. No `$`.
import { SIGN_BG, SIGN_FG } from './frame'
import type { OfficeMap } from './map'
import { isValidGlyph } from './raster'
import type { Cell } from './raster'

export type View = { left: number; width: number }

const LEFT_MARK = 0x25c0
const RIGHT_MARK = 0x25b6

// A pane-wide window centred on `focusX`, clamped to the map's edges.
export const viewFor = (mapColumns: number, paneColumns: number, focusX: number): View => {
  const width = Math.min(mapColumns, paneColumns)
  const left = Math.min(Math.max(0, Math.round(focusX - width / 2)), mapColumns - width)

  return { left, width }
}

// The column the camera follows: the player's centre, else the own team room's centre, else the map's centre.
export const focusOf = (map: OfficeMap, player: { x: number } | null | undefined, ownId: string): number => {
  if (player !== undefined && player !== null) return player.x + 1
  const room = map.rooms.find(r => r.id === ownId)

  return room === undefined ? map.columns / 2 : room.bounds.x + room.bounds.w / 2
}

const mark = (glyph: number, fallback: string): Cell => ({
  ch: isValidGlyph(glyph) ? glyph : fallback.charCodeAt(0),
  fg: SIGN_FG,
  bg: SIGN_BG,
})

// Crops `grid` (as wide as `map`) to the view and draws ◀ / ▶ in the corridor's first row on each edge that
// hides content. Returns `grid` itself when the map fits the pane.
export const cropFrame = (grid: Cell[][], map: OfficeMap, paneColumns: number, focusX: number): Cell[][] => {
  if (map.columns <= paneColumns) return grid
  const { left, width } = viewFor(map.columns, paneColumns, focusX)
  const cropped = grid.map(row => row.slice(left, left + width))
  const row = cropped[map.corridor.y]
  if (row === undefined) return cropped
  if (left > 0) row[0] = mark(LEFT_MARK, '<')
  if (left + width < map.columns) row[width - 1] = mark(RIGHT_MARK, '>')

  return cropped
}

// Where the inspect line (D39) goes on the virtual frame so it lands inside the visible window, between the edge marks.
export const overlaySpan = (map: OfficeMap, paneColumns: number, focusX: number): { from: number; width: number } => {
  const { left, width } = viewFor(map.columns, paneColumns, focusX)

  return { from: left + 1, width: Math.max(0, width - 2) }
}

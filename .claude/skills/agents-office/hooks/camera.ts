// Camera (D45, D58): the office can be wider or taller than the pane (many sessions, or the mid layout's
// 23 rows in a short pane). Pure functions crop the full frame to a pane-sized window and mark the edges
// that hide content. No `$`.
import { SIGN_BG, SIGN_FG } from './frame'
import type { OfficeMap, Point } from './map'
import { isValidGlyph } from './raster'
import type { Cell } from './raster'

// The window over the map: its top-left corner and its size.
export type View = { x: number; y: number; width: number; height: number }

const LEFT_MARK = 0x25c0
const RIGHT_MARK = 0x25b6
const UP_MARK = 0x25b2
const DOWN_MARK = 0x25bc

const clampedStart = (focus: number, size: number, mapSize: number): number =>
  Math.min(Math.max(0, Math.round(focus - size / 2)), mapSize - size)

// A pane-sized window centred on `focus`, clamped to the map's edges. A map that fits an axis fills it.
export const viewFor = (mapColumns: number, mapRows: number, paneColumns: number, paneRows: number, focus: Point): View => {
  const width = Math.min(mapColumns, paneColumns)
  const height = Math.min(mapRows, paneRows)

  return { x: clampedStart(focus.x, width, mapColumns), y: clampedStart(focus.y, height, mapRows), width, height }
}

// The point the camera follows: the player's centre, else the own team room's centre, else the map's centre.
export const focusOf = (map: OfficeMap, player: Point | null | undefined, ownId: string): Point => {
  if (player !== undefined && player !== null) {
    return { x: player.x + Math.floor(map.foot.w / 2), y: player.y + Math.floor(map.foot.h / 2) }
  }
  const room = map.rooms.find(r => r.id === ownId)

  return room === undefined
    ? { x: map.columns / 2, y: map.rows / 2 }
    : { x: room.bounds.x + room.bounds.w / 2, y: room.bounds.y + room.bounds.h / 2 }
}

const mark = (glyph: number, fallback: string): Cell => ({
  ch: isValidGlyph(glyph) ? glyph : fallback.charCodeAt(0),
  fg: SIGN_FG,
  bg: SIGN_BG,
})

// The map row that carries the edge marks and the inspect line: the corridor's first visible row, else the
// view's top row. It steps one row inward when it would be the first or last view row and a ▲ or ▼ is drawn
// there, so the vertical marks never cover the inspect line.
const markRow = (map: OfficeMap, view: View): number => {
  const first = Math.max(map.corridor.y, view.y)
  const row = first < Math.min(map.corridor.y + map.corridor.h, view.y + view.height) ? first : view.y
  if (view.height <= 2) return row
  if (view.y > 0 && row === view.y) return row + 1
  if (view.y + view.height < map.rows && row === view.y + view.height - 1) return row - 1

  return row
}

// Crops `grid` (as large as `map`) to the view. Draws ◀ / ▶ on the mark row at each side edge that hides
// content, and ▲ / ▼ at the middle column of the first / last view row at each vertical edge that does
// (`^` / `v` when the raster refuses the glyph). Returns `grid` itself when the map fits the pane.
export const cropFrame = (grid: Cell[][], map: OfficeMap, paneColumns: number, paneRows: number, focus: Point): Cell[][] => {
  if (map.columns <= paneColumns && map.rows <= paneRows) return grid
  const view = viewFor(map.columns, map.rows, paneColumns, paneRows, focus)
  const cropped = grid.slice(view.y, view.y + view.height).map(row => row.slice(view.x, view.x + view.width))
  // Too narrow for edge marks that do not overlap.
  if (view.width < 3) return cropped
  const mid = Math.floor(view.width / 2)
  const top = cropped[0]
  const bottom = cropped[view.height - 1]
  if (view.y > 0 && top !== undefined) top[mid] = mark(UP_MARK, '^')
  if (view.y + view.height < map.rows && bottom !== undefined) bottom[mid] = mark(DOWN_MARK, 'v')
  const row = cropped[markRow(map, view) - view.y]
  if (row === undefined) return cropped
  if (view.x > 0) row[0] = mark(LEFT_MARK, '<')
  if (view.x + view.width < map.columns) row[view.width - 1] = mark(RIGHT_MARK, '>')

  return cropped
}

// Where the inspect line (D39) goes on the full frame so it lands inside the visible window, between the edge marks.
export const overlaySpan = (map: OfficeMap, paneColumns: number, paneRows: number, focus: Point): { from: number; width: number; row: number } => {
  const view = viewFor(map.columns, map.rows, paneColumns, paneRows, focus)

  return { from: view.x + 1, width: Math.max(0, view.width - 2), row: markRow(map, view) }
}

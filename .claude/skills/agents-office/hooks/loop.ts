// Pure frame pieces only: `claude plugin validate` refuses a `$` passed to a
// function imported from another file, so `startLoop` and `tick` live in
// register.tsx and call these (TODO.md D19). Durations live in timing.ts.
import { buildMap, FULL_ROWS, MIN_COLUMNS, MIN_ROWS } from './map'
import type { OfficeMap } from './map'
import { STRIP_ROWS, STRIP_SMALL_ROWS } from './timing'

// Rows an inline pane never gets: 9 rows below it, its 2 border rows, and the 2 transcript
// lines the layout keeps above it; measured at 80x24 and 100x30 on 2026-10-05 (D50).
export const INLINE_CHROME_ROWS = 13
// Tallest inline body: the full map plus a full strip. /office asks for this many rows.
export const INLINE_MAX_ROWS = FULL_ROWS + STRIP_ROWS

// Inline: an inline pane's bodyRows follows the tree, so it is never read (D50).
// Dock, or no measured viewport: bodyRows.
export const bodyRowsFor = (placement: 'dock' | 'inline', bodyRows: number, viewportRows: number | undefined): number =>
  placement === 'inline' && viewportRows !== undefined && viewportRows > 0
    ? Math.min(INLINE_MAX_ROWS, Math.max(1, viewportRows - INLINE_CHROME_ROWS))
    : bodyRows

// 0-2 strip rows until the map reaches FULL_ROWS, then up to STRIP_ROWS (D52).
// Neither the map nor the strip shrinks as the body grows.
export const stripRows = (bodyRows: number): number =>
  Math.max(0, Math.min(STRIP_ROWS, bodyRows - MIN_ROWS, Math.max(STRIP_SMALL_ROWS, bodyRows - FULL_ROWS)))

// Raster size for a pane body (D29, D52): the strip rows stay under the map and the
// result is clamped to the Raster limits (columns 1-512, rows 1-256).
export const rasterSize = (
  bodyColumns: number,
  bodyRows: number,
): { columns: number; rows: number; strip: number } => {
  const strip = stripRows(bodyRows)
  return {
    columns: Math.min(512, Math.max(1, bodyColumns)),
    rows: Math.min(256, Math.max(1, bodyRows - strip)),
    strip,
  }
}

export const isOfficeSize = (columns: number, rows: number): boolean =>
  columns >= MIN_COLUMNS && rows >= MIN_ROWS

// One-entry cache keyed on columns,rows: a pure cache like lastFrameCells
// (D32), so render, tick and spawn share one map per size.
let cached: { key: string; map: OfficeMap } | undefined

// The map for a raster size, or undefined below the 60x12 minimum.
export const mapFor = (columns: number, rows: number): OfficeMap | undefined => {
  if (!isOfficeSize(columns, rows)) return undefined
  const key = `${columns},${rows}`
  if (cached?.key === key) return cached.map
  const map = buildMap(columns, rows)
  cached = { key, map }

  return map
}

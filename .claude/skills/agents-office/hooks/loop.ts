// Pure frame pieces only: `claude plugin validate` refuses a `$` passed to a
// function imported from another file, so `startLoop` and `tick` live in
// register.tsx and call these (TODO.md D19). Durations live in timing.ts.
import { buildMap, MIN_COLUMNS, MIN_ROWS } from './map'
import type { OfficeMap } from './map'
import { STRIP_ROWS } from './timing'

// Raster size for a pane body (D29): the strip rows stay free for T10 and the
// result is clamped to the Raster limits (columns 1-512, rows 1-256).
export const rasterSize = (bodyColumns: number, bodyRows: number): { columns: number; rows: number } => ({
  columns: Math.min(512, Math.max(1, bodyColumns)),
  rows: Math.min(256, Math.max(1, bodyRows - STRIP_ROWS)),
})

export const isOfficeSize = (columns: number, rows: number): boolean =>
  columns >= MIN_COLUMNS && rows >= MIN_ROWS

// The map for a raster size, or undefined below the 60x18 minimum.
export const mapFor = (columns: number, rows: number): OfficeMap | undefined =>
  isOfficeSize(columns, rows) ? buildMap(columns, rows) : undefined

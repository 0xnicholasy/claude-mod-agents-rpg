// Pure frame pieces only: `claude plugin validate` refuses a `$` passed to a
// function imported from another file, so `startLoop` and `tick` live in
// register.tsx and call these (TODO.md D19). Durations live in timing.ts.
import { buildOffice, FULL_ROWS, isMid, MID_FOOT, MID_MIN_ROWS, MIN_COLUMNS, MIN_ROWS } from './map'
import type { Footprint, OfficeMap, TeamSpec } from './map'
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

// Every pane that passes `isOfficeSize` draws the mid 5x5 figures (D72). A pane narrower than the mid map's
// virtual width crops it with the camera instead of falling back to the small layout (supersedes D57).
export const footFor = (): Footprint => MID_FOOT

export const stripRows = (bodyRows: number, foot: Footprint = MID_FOOT): number =>
  isMid(foot)
    ? Math.max(0, Math.min(STRIP_ROWS, bodyRows - MID_MIN_ROWS))
    : Math.max(0, Math.min(STRIP_ROWS, bodyRows - MIN_ROWS, Math.max(STRIP_SMALL_ROWS, bodyRows - FULL_ROWS)))

// Raster size for a pane body (D29, D52): the strip rows stay under the map and the
// result is clamped to the Raster limits (columns 1-512, rows 1-256).
export const rasterSize = (
  bodyColumns: number,
  bodyRows: number,
): { columns: number; rows: number; strip: number; foot: Footprint } => {
  const columns = Math.min(512, Math.max(1, bodyColumns))
  const foot = footFor()
  const strip = stripRows(bodyRows, foot)
  return {
    columns,
    rows: Math.min(256, Math.max(1, bodyRows - strip)),
    strip,
    foot,
  }
}

export const isOfficeSize = (columns: number, rows: number): boolean =>
  columns >= MIN_COLUMNS && rows >= MIN_ROWS

// One-entry cache keyed on columns, rows, the own team and the team list: a pure cache like
// lastFrameCells (D32), so render, tick and spawn share one map per size.
let cached: { key: string; map: OfficeMap } | undefined

// The map for a raster size and a team list in room order, or undefined below the 60x11 minimum. The footprint
// follows the size (`footFor`) unless the caller names one.
export const mapFor = (columns: number, rows: number, teams: TeamSpec[], foot: Footprint = footFor()): OfficeMap | undefined => {
  if (!isOfficeSize(columns, rows)) return undefined
  const key = `${columns},${rows},${foot.w}x${foot.h},${teams.map(t => `${t.id}=${t.label}`).join('|')}`
  if (cached?.key === key) return cached.map
  const map = buildOffice(columns, rows, teams, foot)
  cached = { key, map }

  return map
}

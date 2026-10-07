// Pure sizing for the HTML spike: the Image box follows the pane body, the renderer pixels follow the box.
export const MAX_CELLS = 255
export const MAX_PX = 2048
// Pixels per terminal cell. The real cell aspect is unknown to a plugin, so 8x17 is an estimate.
export const CELL_W = 8
export const CELL_H = 17
// Rows an inline pane never gets: 9 below it, 2 border rows, 2 transcript lines (same figure as agents-office).
export const INLINE_CHROME_ROWS = 13
// Share of the terminal height the inline pane aims for.
export const INLINE_SHARE = 0.6

const clampCells = (n: number): number => {
  const whole = Number.isFinite(n) ? Math.floor(n) : 1
  return Math.min(MAX_CELLS, Math.max(1, whole))
}

// Inline: the pane follows its tree, so body rows come from the terminal height (about 60%), kept
// inside what the layout leaves free. Dock, or no measured viewport: the pane's own bodyRows.
export const bodyRowsFor = (placement: 'dock' | 'inline', bodyRows: number, viewportRows: number | undefined): number =>
  placement === 'inline' && viewportRows !== undefined && viewportRows > 0
    ? Math.max(1, Math.min(Math.floor(viewportRows * INLINE_SHARE), viewportRows - INLINE_CHROME_ROWS))
    : bodyRows

export type Box = { columns: number; rows: number }

export const boxFor = (
  placement: 'dock' | 'inline',
  bodyColumns: number,
  bodyRows: number,
  viewportRows: number | undefined,
): Box => ({
  columns: clampCells(bodyColumns),
  rows: clampCells(bodyRowsFor(placement, bodyRows, viewportRows)),
})

export const pixelsFor = (box: Box): { w: number; h: number } => ({
  w: Math.min(MAX_PX, box.columns * CELL_W),
  h: Math.min(MAX_PX, box.rows * CELL_H),
})

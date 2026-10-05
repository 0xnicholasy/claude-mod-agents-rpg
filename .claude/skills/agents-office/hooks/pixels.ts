// Half-block pixel compositor. Art is a grid of pixels; each vertical pair of
// pixels becomes one U+2580 cell (fg = top pixel, bg = bottom pixel). Pure: no
// state, no `$`. Nothing imports it yet (v2 D5).
import type { Cell } from './raster'

// A pixel is a 0x00RRGGBB color, or '.' for "take the room's floor color".
export type Px = number | '.'

// Upper half block.
const UPPER_HALF = 0x2580

// Distinct (fg, bg) pairs allowed in one frame (the raster hard limit is 1024).
export const PAIR_BUDGET = 256

// Compose pixel art into cells. Throws on an odd row count, because a half-block
// cell needs both a top and a bottom pixel.
export function compose(art: Px[][], floor: number): Cell[][] {
  if (art.length % 2 !== 0) throw new Error(`compose: odd pixel row count ${art.length}`)
  const width = art[0]?.length ?? 0
  if (art.some((row) => row.length !== width)) throw new Error('compose: pixel rows differ in width')
  const resolve = (px: Px): number => (px === '.' ? floor : px)
  const rows: Cell[][] = []
  for (let y = 0; y < art.length; y += 2) {
    const top = art[y] ?? []
    const bottom = art[y + 1] ?? []
    rows.push(top.map((px, x) => ({ ch: UPPER_HALF, fg: resolve(px), bg: resolve(bottom[x] ?? '.') })))
  }
  return rows
}

// Count distinct (fg, bg) pairs in a grid. The glyph does not matter.
export function countPairs(grid: Cell[][]): number {
  const seen = new Set<string>()
  for (const row of grid) for (const c of row) seen.add(`${c.fg}:${c.bg}`)
  return seen.size
}

import { DEFAULT_COLOR, packCells } from './raster'
import type { Cell } from './raster'

// Pure frame pieces only: `claude plugin validate` refuses a `$` passed to a
// function imported from another file, so `startLoop` and `tick` live in
// register.tsx and call these (TODO.md D19). Durations live in timing.ts.
// Spike frame: a bright column that moves one cell per tick over a dark floor,
// so every tick packs a different grid.
export const spikeFrame = (columns: number, rows: number, tick: number): Cell[][] => {
  const lit = tick % columns
  return Array.from({ length: rows }, () =>
    Array.from({ length: columns }, (_, x): Cell => ({
      ch: 0x2588,
      fg: x === lit ? 0xffcc00 : 0x203040,
      bg: DEFAULT_COLOR,
    })),
  )
}

export const packSpikeFrame = (columns: number, rows: number, tick: number): string =>
  packCells(spikeFrame(columns, rows, tick))

// Raster cell codec: packs a grid of cells into the `cells` string of RasterProps
// (vendor/claude-code/claude-code.d.ts 8746-8775). No Node, no DOM: the base64
// encoder is hand-written.

// One terminal cell: `ch` is a Unicode code point, `fg` and `bg` are 0x00RRGGBB
// or DEFAULT_COLOR. A named-field object (not a tuple) so call sites read clearly.
export type Cell = { ch: number; fg: number; bg: number }

// Bit 24 alone: the terminal's default color.
export const DEFAULT_COLOR = 0x01000000

// Code point ranges [first, last] the Raster refuses or draws wider than one
// column. Anything not listed here and <= 0xFFFF is accepted.
// Allowlist, not deny-list: terminal cell width is a property of the whole
// Unicode table (wide, combining, format, emoji-presentation and unassigned
// code points are scattered everywhere), so a deny-list always has gaps. Only
// ranges known to be printable and width 1 in a BMP cell are accepted. Known
// width-2 emoji-presentation code points inside otherwise-allowed blocks
// (U+231A-231B, U+23E9-23EC, U+23F0, U+23F3, U+25FD-25FE) are split out, and
// U+2600-U+26FF is dropped entirely because it is mostly emoji presentation.
const ALLOWED_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0020, 0x007e], // ASCII printable
  [0x00a0, 0x00ac], // Latin-1 (before soft hyphen)
  [0x00ae, 0x00ff], // Latin-1 (after soft hyphen U+00AD)
  [0x2010, 0x2027], // punctuation
  [0x2030, 0x205e], // punctuation
  [0x2190, 0x21ff], // arrows
  [0x2200, 0x22ff], // math operators
  [0x2300, 0x2319], // technical (before U+231A-231B)
  [0x231c, 0x2328],
  [0x232b, 0x23e8], // technical (U+2329-232A are CJK angle brackets)
  [0x23ed, 0x23ef],
  [0x23f1, 0x23f2],
  [0x23f4, 0x23ff],
  [0x2500, 0x25fc], // box drawing, blocks, geometric shapes
  [0x25ff, 0x25ff],
  [0x2800, 0x28ff], // braille
]

export const isValidGlyph = (ch: number): boolean => {
  if (!Number.isInteger(ch)) return false
  return ALLOWED_RANGES.some(([first, last]) => ch >= first && ch <= last)
}

const isValidColor = (color: number): boolean =>
  color === DEFAULT_COLOR || (Number.isInteger(color) && color >= 0 && color <= 0xffffff)

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Standard padded base64 (RFC 4648 section 4) of a byte array.
export const base64Encode = (bytes: ArrayLike<number>): string => {
  const sextet = (index: number): string => ALPHABET.charAt(index)
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0
    const hasB1 = i + 1 < bytes.length
    const hasB2 = i + 2 < bytes.length
    const b1 = bytes[i + 1] ?? 0
    const b2 = bytes[i + 2] ?? 0
    out += sextet(b0 >> 2)
    out += sextet(((b0 & 0x03) << 4) | (b1 >> 4))
    out += hasB1 ? sextet(((b1 & 0x0f) << 2) | (b2 >> 6)) : '='
    out += hasB2 ? sextet(b2 & 0x3f) : '='
  }
  return out
}

// Packs a row-major grid into little-endian u32 triplets [codePoint, fg, bg] and
// base64s them. Throws on an invalid glyph or color, naming the cell.
export const packCells = (grid: Cell[][]): string => {
  const width = grid[0]?.length ?? 0
  if (grid.length === 0 || width === 0) throw new Error('raster: empty grid')
  grid.forEach((row, y) => {
    if (row.length !== width) {
      throw new Error(`raster: ragged grid, row ${y} has ${row.length} cells, expected ${width}`)
    }
  })
  const count = grid.reduce((sum, row) => sum + row.length, 0)
  const bytes = new Uint8Array(count * 12)
  let offset = 0
  const writeWord = (word: number): void => {
    bytes[offset] = word & 0xff
    bytes[offset + 1] = (word >>> 8) & 0xff
    bytes[offset + 2] = (word >>> 16) & 0xff
    bytes[offset + 3] = (word >>> 24) & 0xff
    offset += 4
  }
  grid.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (!isValidGlyph(cell.ch)) {
        throw new Error(`raster: invalid glyph U+${cell.ch.toString(16)} at row ${y}, column ${x}`)
      }
      if (!isValidColor(cell.fg) || !isValidColor(cell.bg)) {
        throw new Error(`raster: invalid color at row ${y}, column ${x}`)
      }
      writeWord(cell.ch)
      writeWord(cell.fg)
      writeWord(cell.bg)
    })
  })
  return base64Encode(bytes)
}

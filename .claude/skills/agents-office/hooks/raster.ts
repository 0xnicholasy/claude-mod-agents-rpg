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
const REJECTED_RANGES: ReadonlyArray<readonly [number, number]> = [
  // Control characters (C0, DEL, C1).
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  // Combining marks (zero width): diacriticals, extended, supplement, for symbols, half marks.
  [0x0300, 0x036f],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20ff],
  [0xfe00, 0xfe0f], // variation selectors
  [0xfe20, 0xfe2f],
  // Zero-width and bidi formatting characters, BOM.
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0xfeff, 0xfeff],
  // Surrogates, private use, specials block end.
  [0xd800, 0xf8ff],
  [0xfff0, 0xffff],
  // East Asian wide and fullwidth.
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK radicals, Kangxi, CJK symbols
  [0x3041, 0xa4cf], // Kana, Bopomofo, CJK, Yi
  [0xa960, 0xa97f], // Hangul Jamo Extended-A
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe30, 0xfe6f], // CJK compatibility forms, small forms
  [0xff00, 0xff60], // Fullwidth forms
  [0xffe0, 0xffe6], // Fullwidth signs
  // Emoji presentation characters in the BMP (drawn two columns wide).
  [0x231a, 0x231b],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
]

// True when `ch` is one printable width-1 BMP character.
export const isValidGlyph = (ch: number): boolean => {
  if (!Number.isInteger(ch) || ch < 0 || ch > 0xffff) return false
  return !REJECTED_RANGES.some(([first, last]) => ch >= first && ch <= last)
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

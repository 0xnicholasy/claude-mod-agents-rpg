import { expect, test } from 'claude-code/testing'
import { base64Encode, DEFAULT_COLOR, isValidGlyph, packCells } from './raster'

test('raster packs the documented orange cell', () => {
  const cells = packCells([[{ ch: 0x2588, fg: 0xff8800, bg: DEFAULT_COLOR }]])
  expect(cells).toBe('iCUAAACI/wAAAAAB')
})

test('base64 encoder pads one- and two-byte tails', () => {
  // A cell is 12 bytes, so packCells output never needs padding; the encoder is
  // checked directly on 1, 2 and 3 byte tails (values from Node Buffer).
  expect(base64Encode([0xff])).toBe('/w==')
  expect(base64Encode([0xff, 0xee])).toBe('/+4=')
  expect(base64Encode([1, 2, 3])).toBe('AQID')
})

test('raster packs cells as little-endian words in row order', () => {
  // Two cells, including a high bit-24 background and a non-ASCII glyph.
  const cells = packCells([
    [
      { ch: 0x41, fg: 0x000001, bg: DEFAULT_COLOR },
      { ch: 0x2591, fg: 0x000000, bg: 0xffffff },
    ],
  ])
  expect(cells).toBe('QQAAAAEAAAAAAAABkSUAAAAAAAD///8A')
})

test('raster refuses a width-2 or non-BMP glyph', () => {
  const pack = (ch: number): string => packCells([[{ ch, fg: 0xffffff, bg: DEFAULT_COLOR }]])
  expect(() => pack(0x4e2d)).toThrow() // CJK ideograph, width 2
  expect(() => pack(0xff21)).toThrow() // fullwidth Latin, width 2
  expect(() => pack(0x1f600)).toThrow() // emoji, outside the BMP
  expect(() => pack(0x0301)).toThrow() // combining acute accent
  expect(() => pack(0x0a)).toThrow() // control character
  expect(() => pack(0x2329)).toThrow() // CJK angle bracket, width 2
  expect(() => pack(0xfe10)).toThrow() // vertical form, width 2
  expect(() => pack(0x200b)).toThrow() // zero-width space
  expect(() => pack(0xffff)).toThrow() // noncharacter
  expect(() => pack(0x10000)).toThrow() // first non-BMP code point
  expect(() => pack(0x2588)).not.toThrow() // full block is fine
  for (let ch = 0x2500; ch <= 0x259f; ch++) {
    expect(isValidGlyph(ch)).toBe(true)
  }
})

test('raster refuses invalid colors and ragged grids', () => {
  const cell = { ch: 0x41, fg: 0xffffff, bg: DEFAULT_COLOR }
  expect(() => packCells([[{ ...cell, fg: 0x02000000 }]])).toThrow()
  expect(() => packCells([[{ ...cell, bg: -1 }]])).toThrow()
  expect(() => packCells([[{ ...cell, fg: 0x01000001 }]])).toThrow()
  expect(() => packCells([[cell, cell], [cell]])).toThrow()
  expect(() => packCells([])).toThrow()
})

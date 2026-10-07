// Pixels per terminal cell: 8 across, 16 down.
export const CELL_W = 8
export const CELL_H = 16
const TILE = 16
const SPRITE_W = 16
const SPRITE_H = 24
const STEP = 2

const FLOOR_A: readonly [number, number, number] = [28, 30, 38]
const FLOOR_B: readonly [number, number, number] = [38, 41, 52]
const SPRITE: readonly [number, number, number] = [240, 170, 40]

export const frameBytes = (columns: number, rows: number): number => columns * CELL_W * rows * CELL_H * 4

// RGBA frame: checker floor with a coloured rectangle that moves STEP px per frame and wraps.
export const makeFrame = (columns: number, rows: number, frame: number): Uint8Array => {
  const width = columns * CELL_W
  const height = rows * CELL_H
  const out = new Uint8Array(width * height * 4)
  const spriteX = (frame * STEP) % width
  const spriteY = Math.max(0, height - SPRITE_H - TILE)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const inSprite =
        y >= spriteY && y < spriteY + SPRITE_H && (x - spriteX + width) % width < SPRITE_W
      const colour = inSprite
        ? SPRITE
        : (Math.floor(x / TILE) + Math.floor(y / TILE)) % 2 === 0
          ? FLOOR_A
          : FLOOR_B
      out[i] = colour[0]
      out[i + 1] = colour[1]
      out[i + 2] = colour[2]
      out[i + 3] = 255
    }
  }
  return out
}

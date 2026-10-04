import { DEFAULT_COLOR, isValidGlyph, type Cell } from './raster'
import type { Tier } from './agents'

export type Pose = 'idle' | 'walk' | 'read' | 'type' | 'run' | 'call' | 'talk'

export const POSES: readonly Pose[] = ['idle', 'walk', 'read', 'type', 'run', 'call', 'talk']

// Transparency convention (D28): a sprite never carries a floor color. Every
// sprite cell uses `bg: DEFAULT_COLOR` except the face, which has a skin bg.
// The frame builder (T05) overlays sprites on the floor: a cell whose bg is
// DEFAULT_COLOR keeps the floor's bg under the glyph, and TRANSPARENT (a space
// with DEFAULT_COLOR fg and bg) keeps the whole floor cell.
export const TRANSPARENT: Readonly<Cell> = Object.freeze({ ch: 0x20, fg: DEFAULT_COLOR, bg: DEFAULT_COLOR })

export const isTransparent = (c: Cell): boolean =>
  c.ch === TRANSPARENT.ch && c.fg === TRANSPARENT.fg && c.bg === TRANSPARENT.bg

export const TIER_COLORS: Readonly<Record<Tier, number>> = Object.freeze({
  haiku: 0x4fc3f7,
  sonnet: 0x66bb6a,
  opus: 0xffb74d,
  fable: 0xba68c8,
  grey: 0x9e9e9e,
})

const HAIR = 0x6d4c41
const SKIN = 0xffcc9c
const PROP_BOOK = 0xef5350
const PROP_KEYS = 0xcfd8dc
const PROP_TERM = 0x00e676
const PROP_PHONE = 0x90a4ae
const PROP_TALK = 0xfff176
const PLATE_FG = 0xe0e0e0
const PLATE_BG = 0x202028

export const SPRITE_PALETTE: readonly number[] = Object.freeze([
  ...Object.values(TIER_COLORS),
  HAIR, SKIN, PROP_BOOK, PROP_KEYS, PROP_TERM, PROP_PHONE, PROP_TALK, PLATE_FG, PLATE_BG,
])

export const frameCount = (pose: Pose): number => (pose === 'idle' ? 1 : 2)

const cell = (ch: number, fg: number, bg: number = DEFAULT_COLOR): Cell => ({ ch, fg, bg })

// Props sit beside the head (row 0, right) and alternate between 2 frames.
const PROPS: Readonly<Record<Exclude<Pose, 'idle' | 'walk'>, readonly [Readonly<Cell>, Readonly<Cell>]>> = Object.freeze({
  read: [cell(0x25a4, PROP_BOOK), cell(0x25a5, PROP_BOOK)],
  type: [cell(0x25ac, PROP_KEYS), cell(0x25ad, PROP_KEYS)],
  run: [cell(0x3e, PROP_TERM), cell(0x5f, PROP_TERM)],
  call: [cell(0x25ae, PROP_PHONE), cell(0x25af, PROP_PHONE)],
  talk: [cell(0x22, PROP_TALK), cell(0x2026, PROP_TALK)],
})

export const sprite = (pose: Pose, frame: number, tier: Tier): Cell[][] => {
  const color = Object.hasOwn(TIER_COLORS, tier) ? TIER_COLORS[tier] : TIER_COLORS.grey
  const n = frameCount(pose)
  const idx = Number.isInteger(frame) ? ((frame % n) + n) % n : 0
  const f = idx === 0 ? 0 : 1
  // Head: hair on the top half of the glyph, skin (face) on the bottom half.
  const head = cell(0x2580, HAIR, SKIN)
  const top: Cell[] = [{ ...TRANSPARENT }, head, { ...TRANSPARENT }]
  let bottom: Cell[] = [cell(0x2590, color), cell(0x2588, color), cell(0x258c, color)]
  if (pose === 'walk') {
    bottom = f === 0
      ? [cell(0x259f, color), cell(0x2588, color), cell(0x2598, color)]
      : [cell(0x259d, color), cell(0x2588, color), cell(0x2599, color)]
  } else if (pose !== 'idle') {
    top[2] = { ...PROPS[pose][f] }
  }
  return [top, bottom]
}

export const nameplate = (text: string, maxWidth = 12): Cell[] => {
  const width = Math.max(0, Math.floor(maxWidth))
  return Array.from(text)
    .slice(0, width)
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0x3f
      return cell(isValidGlyph(code) ? code : 0x3f, PLATE_FG, PLATE_BG)
    })
}

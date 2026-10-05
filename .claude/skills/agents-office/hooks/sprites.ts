import { DEFAULT_COLOR, isValidGlyph, type Cell } from './raster'
import type { Tier } from './agents'
import { compose, type Px } from './pixels'
import { MID_IDLE, MID_SEAT_READ, MID_SEAT_TYPE, MID_WALK, type Grid } from './midArt'

export type Pose = 'idle' | 'walk' | 'read' | 'type' | 'run' | 'call' | 'talk'

export const POSES: readonly Pose[] = ['idle', 'walk', 'read', 'type', 'run', 'call', 'talk']

export const TIER_COLORS: Readonly<Record<Tier, number>> = Object.freeze({
  haiku: 0x4fc3f7,
  sonnet: 0x66bb6a,
  opus: 0xffb74d,
  fable: 0xba68c8,
  grey: 0x9e9e9e,
})

const PROP_TERM = 0x00e676
const PROP_PHONE = 0x90a4ae
const PROP_TALK = 0xfff176
const PLATE_FG = 0xe0e0e0
const PLATE_BG = 0x202028

const cell = (ch: number, fg: number, bg: number = DEFAULT_COLOR): Cell => ({ ch, fg, bg })

export const nameplate = (text: string, maxWidth = 12): Cell[] => {
  const width = Math.max(0, Math.floor(maxWidth))
  return Array.from(text)
    .slice(0, width)
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0x3f
      return cell(isValidGlyph(code) ? code : 0x3f, PLATE_FG, PLATE_BG)
    })
}

// ---------------------------------------------------------------------------
// People figures (v2 D5, D6, D9). Each figure is 3x4 pixels composed into the
// 3x2 cell footprint with half-blocks. Reading top to bottom: hair, face (skin),
// shirt torso, two legs. A `.` pixel takes the room's floor color.
// ---------------------------------------------------------------------------

export type Facing = 'down' | 'up' | 'left' | 'right'
export type Role = 'lead' | 'dev' | 'research' | 'review'

export const FACINGS: readonly Facing[] = ['down', 'up', 'left', 'right']

const PLAYER_SHIRT = 0xf5f5f5
const DESK = 0x8d6e63
const SCREEN = 0x81d4fa
const SCREEN_ALT = 0x4fa3c7
const EYE = 0x1a1a1a
// Mid figures (v2 D54): eyes and shoes share one near-black; the shirt shade is a fixed darker tone per tier.
const MID_DARK = 0x141414
const DESK_BODY = 0x5d4037
const MONITOR_FRAME = 0x37474f
const PLAYER_SHADE = 0xb0b0b0
const SHIRT_SHADES: Readonly<Record<Tier, number>> = Object.freeze({
  haiku: 0x2e8fbd,
  sonnet: 0x3e8e41,
  opus: 0xc7862f,
  fable: 0x8e3fa0,
  grey: 0x6e6e6e,
})

export const ROLE_COLORS: Readonly<Record<Role, number>> = Object.freeze({
  // D6 gave 0x263238, which is indistinguishable from the floor (0x2b303b): the lead's legs vanished.
  lead: 0x546e7a,
  dev: 0x2f4a7a,
  research: 0x7a6a4f,
  review: 0x5e3a6e,
})

export const HAIR_TONES: readonly number[] = Object.freeze([0x2b1b12, 0x6d4c41, 0xc9a24d, 0xb5522e, 0xbdbdbd])
export const SKIN_TONES: readonly number[] = Object.freeze([0xffe0bd, 0xffcc9c, 0xc68642, 0x8d5524])

export const FIGURE_PALETTE: readonly number[] = Object.freeze([
  ...Object.values(TIER_COLORS),
  PLAYER_SHIRT,
  ...Object.values(ROLE_COLORS),
  ...HAIR_TONES,
  ...SKIN_TONES,
  DESK, SCREEN, SCREEN_ALT, EYE,
  PROP_TERM, PROP_PHONE, PROP_TALK,
  MID_DARK, DESK_BODY, MONITOR_FRAME, PLAYER_SHADE,
  ...Object.values(SHIRT_SHADES),
])

// FNV-1a, 32 bit. Picks hair and skin from a figure key.
export const hashKey = (key: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export interface FigureOpts {
  pose: Pose
  facing: Facing
  frame: number
  shirt: Tier | 'player'
  role: Role
  key: string
  floor: number
}

// Leg rows for the walk cycle: true = a leg pixel, false = floor shows through.
const WALK_LEGS: readonly (readonly [boolean, boolean, boolean])[] = [
  [true, false, true],
  [false, true, true],
  [false, true, false],
  [true, true, false],
]

// Frames per pose: 1 idle, 4 walk (0-3), 2 for every work pose.
export const frameCount = (pose: Pose): number => {
  if (pose === 'idle') return 1
  if (pose === 'walk') return 4
  return 2
}

const SEATED: ReadonlySet<Pose> = new Set<Pose>(['read', 'type'])

export const figure = (o: FigureOpts): Cell[][] => {
  const shirt = o.shirt === 'player' ? PLAYER_SHIRT : (Object.hasOwn(TIER_COLORS, o.shirt) ? TIER_COLORS[o.shirt] : TIER_COLORS.grey)
  const pants = Object.hasOwn(ROLE_COLORS, o.role) ? ROLE_COLORS[o.role] : ROLE_COLORS.dev
  const h = hashKey(o.key)
  const hair = HAIR_TONES[h % HAIR_TONES.length] ?? HAIR_TONES[0]!
  const skin = SKIN_TONES[Math.floor(h / HAIR_TONES.length) % SKIN_TONES.length] ?? SKIN_TONES[0]!
  const n = frameCount(o.pose)
  const f = Number.isInteger(o.frame) ? ((o.frame % n) + n) % n : 0

  if (SEATED.has(o.pose)) {
    // Seated in profile at a desk, monitor beside the head. Facing left mirrors
    // the scene; every other facing sits facing right.
    const screen = f === 0 ? SCREEN : SCREEN_ALT
    // A typing hand reaches the desk on frame 1; a reader keeps hands down.
    const hand: Px = o.pose === 'type' && f === 1 ? skin : shirt
    const art: Px[][] = [
      [hair, hair, screen],
      [skin, EYE, screen],
      [shirt, hand, screen],
      [DESK, DESK, DESK],
    ]
    if (o.facing === 'left') for (const row of art) row.reverse()
    return compose(art, o.floor)
  }

  let face: Px[]
  if (o.facing === 'up') face = [hair, hair, hair]
  else if (o.facing === 'left') face = [EYE, skin, hair]
  else if (o.facing === 'right') face = [hair, skin, EYE]
  else face = [EYE, skin, EYE]

  const legs: Px[] = (o.pose === 'walk' ? WALK_LEGS[f]! : WALK_LEGS[0]!).map((on): Px => (on ? pants : '.'))
  const art: Px[][] = [[hair, hair, hair], face, [shirt, shirt, shirt], legs]

  // Standing props sit on the hair row, in the top-right cell. Frame 1 widens
  // the prop by one pixel. The face row is never touched, so facing stays readable.
  if (o.pose === 'run' || o.pose === 'call' || o.pose === 'talk') {
    const prop = o.pose === 'run' ? PROP_TERM : o.pose === 'call' ? PROP_PHONE : PROP_TALK
    art[0]![2] = prop
    if (f === 1) art[0]![1] = prop
  }
  return compose(art, o.floor)
}

// Every color a figure or nameplate can draw; a frame adds only the office colors.

// Mid figures: reads are one frame, types two, walks four; everything else is one idle frame per facing.
export const midFrameCount = (pose: Pose): number => {
  if (pose === 'walk') return 4
  if (pose === 'type' || pose === 'run' || pose === 'call' || pose === 'talk') return 2
  return 1
}

export const midFigure = (o: FigureOpts): Cell[][] => {
  const tier: Tier = o.shirt === 'player' ? 'grey' : (Object.hasOwn(TIER_COLORS, o.shirt) ? o.shirt : 'grey')
  const shirt = o.shirt === 'player' ? PLAYER_SHIRT : TIER_COLORS[tier]
  const shade = o.shirt === 'player' ? PLAYER_SHADE : SHIRT_SHADES[tier]
  const pants = Object.hasOwn(ROLE_COLORS, o.role) ? ROLE_COLORS[o.role] : ROLE_COLORS.dev
  const h = hashKey(o.key)
  const hair = HAIR_TONES[h % HAIR_TONES.length] ?? HAIR_TONES[0]!
  const skin = SKIN_TONES[Math.floor(h / HAIR_TONES.length) % SKIN_TONES.length] ?? SKIN_TONES[0]!
  const facing: Facing = Object.hasOwn(MID_IDLE, o.facing) ? o.facing : 'down'
  const n = midFrameCount(o.pose)
  const f = Number.isInteger(o.frame) ? ((o.frame % n) + n) % n : 0
  const colors: Readonly<Record<string, Px>> = {
    H: hair, S: skin, T: shirt, U: shade, K: pants, P: pants, F: MID_DARK, E: MID_DARK, M: hair,
    D: DESK, B: DESK_BODY, N: MONITOR_FRAME, C: SCREEN, '.': '.',
  }
  // Seated figures ignore facing: one grid, with the monitor on the right (D54).
  const grid: Grid =
    o.pose === 'read' ? MID_SEAT_READ
    : o.pose === 'type' ? (MID_SEAT_TYPE[f] ?? MID_SEAT_READ)
    : o.pose === 'walk' ? (MID_WALK[facing][f] ?? MID_IDLE[facing])
    : MID_IDLE[facing]
  const art: Px[][] = grid.map(row => Array.from(row, ch => colors[ch] ?? '.'))
  if (o.pose === 'run' || o.pose === 'call' || o.pose === 'talk') {
    const prop = o.pose === 'run' ? PROP_TERM : o.pose === 'call' ? PROP_PHONE : PROP_TALK
    // Top-right cell (pixels 4,0 and 4,1): frame 0 puts the prop on its top pixel, frame 1 fills the cell.
    art[0]![4] = prop
    if (f === 1) art[1]![4] = prop
  }
  return compose(art, o.floor)
}

export const SPRITE_PALETTE: readonly number[] = Object.freeze([...FIGURE_PALETTE, PLATE_FG, PLATE_BG])

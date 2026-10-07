import type { Tier } from './agents'
import { hashKey, TIER_COLORS } from './sprites'

// Sprite names, scale, anchor and layer for the image scene (v3 D9, D15). One entry per name in
// renderer/sprites/atlas.json; scripts/sprites/check-table.mjs fails when the two lists differ.
// The check parses the quoted keys below, so keep one entry per line.
export type SpriteLayer = 'floor' | 'wall' | 'figure' | 'over'
export type SpriteAnchor = 'foot' | 'top'
export interface SpriteSpec {
  scale: number
  anchor: SpriteAnchor
  layer: SpriteLayer
}

export const SPRITES = {
  'armchair': { scale: 1.5, anchor: 'foot', layer: 'figure' },
  'backpack': { scale: 1, anchor: 'foot', layer: 'over' },
  'bookshelf': { scale: 1.5, anchor: 'foot', layer: 'wall' },
  'cat-bed': { scale: 2, anchor: 'foot', layer: 'floor' },
  'cat-black-sit': { scale: 2, anchor: 'foot', layer: 'figure' },
  'cat-black-walk': { scale: 2, anchor: 'foot', layer: 'figure' },
  'cat-orange-sit': { scale: 2, anchor: 'foot', layer: 'figure' },
  'cat-orange-walk': { scale: 2, anchor: 'foot', layer: 'figure' },
  'cat-tabby-sit': { scale: 2, anchor: 'foot', layer: 'figure' },
  'cat-tabby-walk': { scale: 2, anchor: 'foot', layer: 'figure' },
  'chair': { scale: 2, anchor: 'foot', layer: 'figure' },
  'coffee-machine': { scale: 1.5, anchor: 'foot', layer: 'figure' },
  'conference-table': { scale: 1.5, anchor: 'foot', layer: 'figure' },
  'corgi-down': { scale: 2, anchor: 'foot', layer: 'figure' },
  'corgi-left': { scale: 2, anchor: 'foot', layer: 'figure' },
  'corgi-right': { scale: 2, anchor: 'foot', layer: 'figure' },
  'corgi-sleep': { scale: 2, anchor: 'foot', layer: 'figure' },
  'corgi-up': { scale: 2, anchor: 'foot', layer: 'figure' },
  'desk-dual': { scale: 2, anchor: 'foot', layer: 'figure' },
  'desk-monitor': { scale: 1.5, anchor: 'foot', layer: 'figure' },
  'dog-bed': { scale: 2, anchor: 'foot', layer: 'floor' },
  'filing-cabinet': { scale: 2, anchor: 'foot', layer: 'figure' },
  'fridge': { scale: 2, anchor: 'foot', layer: 'figure' },
  'headphones': { scale: 1, anchor: 'foot', layer: 'over' },
  'keyboard': { scale: 1, anchor: 'foot', layer: 'over' },
  'kitchen-counter': { scale: 1.5, anchor: 'foot', layer: 'figure' },
  'lamp': { scale: 1, anchor: 'foot', layer: 'over' },
  'laptop-back': { scale: 0.7, anchor: 'foot', layer: 'over' },
  'laptop-closed': { scale: 0.7, anchor: 'foot', layer: 'over' },
  'laptop-front': { scale: 0.7, anchor: 'foot', layer: 'over' },
  'mascot-bounce': { scale: 2, anchor: 'foot', layer: 'figure' },
  'mascot-down': { scale: 2, anchor: 'foot', layer: 'figure' },
  'mascot-left': { scale: 2, anchor: 'foot', layer: 'figure' },
  'mascot-right': { scale: 2, anchor: 'foot', layer: 'figure' },
  'mascot-up': { scale: 2, anchor: 'foot', layer: 'figure' },
  'monitor-terminal': { scale: 1, anchor: 'foot', layer: 'over' },
  'mouse': { scale: 1, anchor: 'foot', layer: 'over' },
  'mug': { scale: 0.8, anchor: 'foot', layer: 'over' },
  'person1-down': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person1-left': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person1-right': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person1-up': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person2-down': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person2-left': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person2-right': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person2-up': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person3-down': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person3-left': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person3-right': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person3-up': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person4-down': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person4-left': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person4-right': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person4-up': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person5-down': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person5-left': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person5-right': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person5-up': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person6-down': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person6-left': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person6-right': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person6-up': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person7-down': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person7-left': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person7-right': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person7-up': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person8-down': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person8-left': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person8-right': { scale: 2, anchor: 'foot', layer: 'figure' },
  'person8-up': { scale: 2, anchor: 'foot', layer: 'figure' },
  'phone': { scale: 1, anchor: 'foot', layer: 'over' },
  'plant-small': { scale: 2, anchor: 'foot', layer: 'figure' },
  'plant-tall': { scale: 1.5, anchor: 'foot', layer: 'figure' },
  'printer': { scale: 1.5, anchor: 'foot', layer: 'figure' },
  'reception-desk': { scale: 1.25, anchor: 'foot', layer: 'figure' },
  'round-table': { scale: 1.5, anchor: 'foot', layer: 'figure' },
  'server-rack': { scale: 1.5, anchor: 'foot', layer: 'figure' },
  'sofa': { scale: 1.5, anchor: 'foot', layer: 'figure' },
  'sticky-notes': { scale: 1, anchor: 'foot', layer: 'over' },
  'wall-clock': { scale: 1.5, anchor: 'top', layer: 'wall' },
  'water-cooler': { scale: 2, anchor: 'foot', layer: 'figure' },
  'whiteboard': { scale: 1.5, anchor: 'foot', layer: 'wall' },
} as const satisfies Record<string, SpriteSpec>

export type SpriteName = keyof typeof SPRITES

export const SPRITE_NAMES = Object.keys(SPRITES) as readonly SpriteName[]

// Terminal cell size in image pixels (v3 D8, from the spike's box.ts).
export const CELL_PX = { w: 8, h: 17 } as const

// Seating offsets in px (v3 D21). A seated figure is the back view (`personN-up`) in the chair, in front of its desk,
// so the monitor shows over its head. Both are relative to the desk anchor's top (a.y x CELL_PX.h): the desk's foot
// line sits `deskFootY` below it, the chair's foot line at the footprint's bottom, and the figure's foot line `lift`
// above the chair's, so the chair's base shows under it. The figure keeps the chair's foot line as its depth.
export const SEAT = { deskFootY: 34, lift: 12 } as const

export const PERSON_VARIANTS = 8

// Person sprite number 1..8 for a figure key (v2 D6 key): FNV-1a mod 8 (v3 D9).
export const personVariant = (key: string): number => (hashKey(key) % PERSON_VARIANTS) + 1

// Nameplate colour per tier: the v2 D6 shirt colours, as a CSS hex string.
export const tierPlate = (tier: Tier): string => {
  const color = Object.hasOwn(TIER_COLORS, tier) ? TIER_COLORS[tier] : TIER_COLORS.grey
  return '#' + color.toString(16).padStart(6, '0')
}

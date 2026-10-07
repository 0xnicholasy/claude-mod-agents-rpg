import { expect, test } from 'claude-code/testing'
import { CELL_PX, PERSON_VARIANTS, SPRITES, SPRITE_NAMES, personVariant, tierPlate } from './sceneArt'
import type { Tier } from './agents'

const TIERS: readonly Tier[] = ['haiku', 'sonnet', 'opus', 'fable', 'grey']

test('personVariant is stable for a key and always 1..8', async () => {
  expect(personVariant('agent:alpha')).toBe(personVariant('agent:alpha'))
  for (let i = 0; i < 64; i++) {
    const v = personVariant(`key-${i}`)
    expect(Number.isInteger(v) && v >= 1 && v <= PERSON_VARIANTS).toBe(true)
  }
})

test('personVariant spreads 64 keys over at least 6 variants', async () => {
  const seen = new Set<number>()
  for (let i = 0; i < 64; i++) seen.add(personVariant(`key-${i}`))
  expect(seen.size >= 6).toBe(true)
})

test('every tier has a distinct plate colour', async () => {
  const plates = TIERS.map(tierPlate)
  for (const plate of plates) expect(/^#[0-9a-f]{6}$/.test(plate)).toBe(true)
  expect(new Set(plates).size).toBe(TIERS.length)
})

test('no sprite scale is zero or negative', async () => {
  for (const name of SPRITE_NAMES) expect(SPRITES[name].scale > 0).toBe(true)
})

test('every person sprite variant and facing has a table entry', async () => {
  for (let v = 1; v <= PERSON_VARIANTS; v++) {
    for (const facing of ['down', 'left', 'right', 'up']) expect(`person${v}-${facing}` in SPRITES).toBe(true)
  }
})

test('CELL_PX is the spike cell size', async () => {
  expect(CELL_PX).toEqual({ w: 8, h: 17 })
})

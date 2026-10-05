import { expect, test } from 'claude-code/testing'
import { applyKeys, emoteOf, INITIAL_PAD, MAX_TAPS, onPadInput, readKeys } from './pad'
import { isValidGlyph } from './raster'

test('a coalesced burst yields every key', () => {
  expect(readKeys('', 'wwww')).toEqual({ keys: ['w', 'w', 'w', 'w'], handled: 'wwww' })
  expect(readKeys('ww', 'wwwd')).toEqual({ keys: ['w', 'd'], handled: 'wwwd' })
})

test('a repeated value yields no keys', () => {
  expect(readKeys('wwww', 'wwww')).toEqual({ keys: [], handled: 'wwww' })
})

test('the clear space is not a key', () => {
  // The redraw reset the field to the marker; typing after it adds to the marker.
  expect(readKeys('w', ' ', ' ').keys).toEqual([])
  expect(readKeys('w', ' d', ' ').keys).toEqual(['d'])
  expect(readKeys('', ' ', ' ').keys).toEqual([])
})

test('a deletion yields no keys', () => {
  expect(readKeys('www', 'ww', ' ')).toEqual({ keys: [], handled: 'ww' })
  expect(readKeys(' w', ' ', ' ').keys).toEqual([])
})

test('applyKeys counts WASD in either case and ignores other keys', () => {
  const state = applyKeys(INITIAL_PAD, ['w', 'W', 'x', '1'], 100)
  expect(state.intent).toEqual({ key: 'w', at: 100, taps: 2 })
  expect(applyKeys(state, ['d'], 200).intent).toEqual({ key: 'd', at: 200, taps: 1 })
  expect(applyKeys(INITIAL_PAD, ['x'], 5).intent).toBeUndefined()
})

test('an input event flips the clear marker, and the marker alone changes nothing', () => {
  const typed = onPadInput(INITIAL_PAD, 'ww', 10)
  expect(typed).toMatchObject({ handled: 'ww', clear: ' ', intent: { key: 'w', taps: 2 } })
  const after = onPadInput(typed, ' d', 20)
  expect(after).toMatchObject({ clear: '', intent: { key: 'd', taps: 1 } })
  const marker = onPadInput({ ...after, clear: ' ' }, ' ', 30)
  expect(marker.clear).toBe(' ')
  expect(marker.intent).toEqual(after.intent)
})

test('taps stop queuing at the cap', () => {
  const state = applyKeys(INITIAL_PAD, Array.from({ length: 20 }, () => 'd'), 0)

  expect(state.intent?.taps).toBe(MAX_TAPS)
})

test('keys 1-4 set the emote glyph and every glyph is valid', () => {
  // The raster refuses U+2665 and U+266A, so keys 3 and 4 draw their stand-ins.
  expect(applyKeys(INITIAL_PAD, ['3'], 500).emote).toEqual({ glyph: '\u25c6', at: 500 })
  expect(['1', '2', '3', '4'].map(emoteOf)).toEqual(['!', '?', '\u25c6', '~'])
  for (const key of ['1', '2', '3', '4']) expect(isValidGlyph(emoteOf(key)?.codePointAt(0) ?? 0)).toBe(true)
  // An emote is not a move, and other keys are not emotes.
  expect(applyKeys(INITIAL_PAD, ['3'], 0).intent).toBeUndefined()
  expect(emoteOf('5')).toBeUndefined()
})

test('an emote does not clear the pending walk and the newest emote wins', () => {
  const state = applyKeys(INITIAL_PAD, ['d', '1', '4'], 10)

  expect(state.intent).toMatchObject({ key: 'd', taps: 1 })
  expect(state.emote?.glyph).toBe('~')
})

test('[ and ] set a pending jump, clear the intent, and a later WASD key cancels it', () => {
  const walking = applyKeys(INITIAL_PAD, ['d', 'd'], 10)
  const jumped = applyKeys(walking, [']'], 20)
  expect(jumped.jump).toEqual({ dir: 'next', at: 20 })
  expect(jumped.intent).toBeUndefined()
  expect(applyKeys(jumped, ['['], 30).jump).toEqual({ dir: 'prev', at: 30 })
  const cancelled = applyKeys(jumped, ['w'], 40)
  expect(cancelled.jump).toBeUndefined()
  expect(cancelled.intent).toEqual({ key: 'w', at: 40, taps: 1 })
})

test('lower-case e asks to inspect and E does not', () => {
  expect(applyKeys(INITIAL_PAD, ['e'], 70).inspect).toEqual({ at: 70 })
  expect(applyKeys(INITIAL_PAD, ['E'], 70).inspect).toBeUndefined()
})

import { expect, test } from 'claude-code/testing'
import { applyKeys, INITIAL_PAD, MAX_TAPS, onPadInput, readKeys } from './pad'

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

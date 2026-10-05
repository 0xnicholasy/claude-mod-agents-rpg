import { expect, test } from 'claude-code/testing'
import { applyKeys, chatLine, CONFIRM_OPTIONS, isYes, emoteOf, INITIAL_PAD, MAX_TAPS, onPadInput, onPadSubmit, readKeys } from './pad'
import { isValidGlyph } from './raster'
import { CHAT_MAX } from './timing'

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
  const state = applyKeys(INITIAL_PAD, ['w', 'W', 'z', '1'], 100)
  expect(state.intent).toEqual({ key: 'w', at: 100, taps: 2 })
  expect(applyKeys(state, ['d'], 200).intent).toEqual({ key: 'd', at: 200, taps: 1 })
  expect(applyKeys(INITIAL_PAD, ['z'], 5).intent).toBeUndefined()
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

test('Shift+E asks to peek and lower-case e does not', () => {
  expect(applyKeys(INITIAL_PAD, ['E'], 70).peek).toEqual({ at: 70 })
  expect(applyKeys(INITIAL_PAD, ['e'], 70).peek).toBeUndefined()
  // Chat mode keeps every key, `E` included, as text.
  expect(typed('E').peek).toBeUndefined()
})

const typed = (keys: string): ReturnType<typeof applyKeys> => applyKeys(INITIAL_PAD, ['t', ...Array.from(keys)], 10)

test('t, hi there, Enter sends the chat line and moves nobody', () => {
  const typing = typed('hi there')

  expect(typing.mode).toBe('chat')
  expect(typing.draft).toBe('hi there')
  expect(typing.intent).toBeUndefined()
  expect(chatLine(typing)).toBe('Say: hi there_')
  const sent = onPadSubmit(typing, 50)
  expect(sent.chat).toEqual({ text: 'hi there', at: 50 })
  expect(sent.mode).toBeUndefined()
  expect(sent.draft).toBeUndefined()
  expect(chatLine(sent)).toBeUndefined()
})

test('chat mode swallows WASD and every other key', () => {
  const typing = typed('wasd 1[e')

  expect(typing.draft).toBe('wasd 1[e')
  expect(typing.intent).toBeUndefined()
  expect(typing.emote).toBeUndefined()
  expect(typing.jump).toBeUndefined()
  expect(typing.inspect).toBeUndefined()
  // Without chat mode the same keys act.
  expect(applyKeys(INITIAL_PAD, ['w'], 1).intent).toBeDefined()
})

test('chat is cut to 40 cleaned characters', () => {
  const sent = onPadSubmit(typed(`a\u0007b${'x'.repeat(60)}`), 5)

  expect(Array.from(sent.chat?.text ?? '')).toHaveLength(CHAT_MAX)
  expect(sent.chat?.text.startsWith('a b')).toBe(true)
  expect(/[\u0000-\u001f\u007f-\u009f]/.test(sent.chat?.text ?? '')).toBe(false)
})

test('an empty submit cancels and Enter outside chat does nothing', () => {
  expect(onPadSubmit(typed('   '), 5).chat).toBeUndefined()
  expect(onPadSubmit(typed(''), 5).mode).toBeUndefined()
  expect(onPadSubmit(INITIAL_PAD, 5)).toBe(INITIAL_PAD)
})

test('the field keeps its text in chat mode, so a space is typed and a deletion edits the draft', () => {
  let state = onPadInput(INITIAL_PAD, 't', 1)
  expect(state.mode).toBe('chat')
  const clear = state.clear
  state = onPadInput(state, 't ', 2)
  state = onPadInput(state, 't hi', 3)
  expect(state.draft).toBe(' hi')
  expect(state.clear).toBe(clear)
  state = onPadInput(state, 't h', 4)
  expect(state.draft).toBe(' h')
  // Enter ends chat and flips the clear marker so the field resets.
  const sent = onPadSubmit(state, 5)
  expect(sent.clear).not.toBe(clear)
  expect(sent.chat?.text).toBe('h')
})

test('the draft is the text in the field, so an edit in the middle or a paste does not garble it', () => {
  let state = onPadInput(INITIAL_PAD, 't', 1)
  state = onPadInput(state, 'tabc', 2)
  expect(state.draft).toBe('abc')
  // The cursor moved and a letter was typed in the middle: neither an extension nor a prefix of the old value.
  state = onPadInput(state, 'taXbc', 3)
  expect(state.draft).toBe('aXbc')
  state = onPadInput(state, 'tbc', 4)
  expect(state.draft).toBe('bc')
  // A burst that opens chat: everything after the t is the message.
  expect(onPadInput(INITIAL_PAD, 'thi', 5).draft).toBe('hi')
})

test('the typing line shows what would be sent and marks a cut', () => {
  expect(chatLine({ ...INITIAL_PAD, mode: 'chat', draft: 'hi' })).toBe('Say: hi_')
  expect(chatLine({ ...INITIAL_PAD, mode: 'chat', draft: 'x'.repeat(CHAT_MAX + 5) })).toBe(`Say: ${'x'.repeat(CHAT_MAX)}|`)
})

test('m asks to nudge and x asks to interrupt, lower case only', () => {
  expect(applyKeys(INITIAL_PAD, ['m'], 9).nudge).toEqual({ at: 9 })
  expect(applyKeys(INITIAL_PAD, ['x'], 9).interrupt).toEqual({ at: 9 })
  expect(applyKeys(INITIAL_PAD, ['M', 'X'], 9)).toEqual(INITIAL_PAD)
})

test('m and x are text, not commands, in chat mode', () => {
  const chat = applyKeys(INITIAL_PAD, ['t', 'm', 'x'], 9)
  expect(chat.nudge).toBeUndefined()
  expect(chat.interrupt).toBeUndefined()
  expect(chat.draft).toBe('mx')
})

test('only the exact answer Yes confirms', () => {
  expect(CONFIRM_OPTIONS).toEqual(['No', 'Yes'])
  expect(isYes('Yes')).toBe(true)
  for (const answer of ['No', '', 'yes', 'Yes, please', 'Other']) expect(isYes(answer)).toBe(false)
})

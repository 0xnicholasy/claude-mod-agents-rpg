// The pad: keys typed into a one-row Input (D13). Pure: register.tsx reads and writes the `pad` atom and
// passes plain data in. The Input only ever holds the clear marker plus what was typed since the last
// redraw, so keys are found by diffing its value against what was already handled.

import { clean } from './log'
import { cut } from './map'
import { isValidGlyph } from './raster'
import { CHAT_MAX } from './timing'

export type Dir = 'w' | 'a' | 's' | 'd'

// The newest movement key, when it was pressed and how many presses are waiting; stepPlayer consumes one per tick.
export type Intent = { key: Dir; at: number; taps: number }

export type PadState = {
  // The Input value last seen.
  handled: string
  // The value drawn into the Input: '' or ' ', alternated after every event so the field never grows.
  clear: string
  intent?: Intent
  emote?: PendingEmote
  jump?: PendingJump
  // Counts jump presses: a jump resets the intent, so a tick that read an older epoch must not write taps back.
  epoch?: number
  // An `e` press waiting for the tick to inspect the nearest agent (D39).
  inspect?: { at: number }
  // An `E` press waiting for the tick to open the peek pane (D25).
  peek?: { at: number }
  // `t` enters chat mode (D23, D47): keys build `draft` and move nothing until Enter sends or cancels it.
  mode?: 'chat'
  draft?: string
  // How many code points of the field are not the message: what was there before `t`, and the `t` (D47).
  base?: number
  // A sent line waiting for the tick to put it on the player.
  chat?: PendingChat
}

// A chat line waiting for the tick to put it on the player (D23).
export type PendingChat = { text: string; at: number }

// The draft keeps more than CHAT_MAX so a cut is visible in the typing line.
const DRAFT_MAX = 120

// A room jump waiting for the tick to set the player's path (D38). `at` tells two presses apart.
export type PendingJump = { dir: 'next' | 'prev'; at: number }

// An emote waiting for the tick to put it on the player (D15).
export type PendingEmote = { glyph: string; at: number }

// Taps that can wait for a tick (one is consumed per tick), so a held key cannot queue a long walk.
export const MAX_TAPS = 8

export const INITIAL_PAD: PadState = { handled: '', clear: '' }

const CLEAR_VALUES: readonly string[] = ['', ' ']

const nextClear = (clear: string): string => (clear === '' ? ' ' : '')

// Every new character of a coalesced burst, in order, and the value now handled. A value that does not
// extend `handled` is a field the redraw reset: its text after the drawn `clear` marker is all new, and the
// marker alone is not a key.
export const readKeys = (handled: string, value: string, clear = ''): { keys: string[]; handled: string } => {
  // The marker alone is what a redraw left in the field.
  if (value === handled || value === clear) return { keys: [], handled: value }
  // A shorter value that is a prefix of what was handled is a deletion, not typing.
  if (handled.startsWith(value)) return { keys: [], handled: value }
  if (value.startsWith(handled)) return { keys: Array.from(value.slice(handled.length)), handled: value }
  const typed = value.startsWith(clear) ? value.slice(clear.length) : value

  return { keys: Array.from(typed), handled: value }
}

const isDir = (key: string): key is Dir => {
  const k = key.toLowerCase()

  return k === 'w' || k === 'a' || k === 's' || k === 'd'
}

// D15: keys 1-4 draw `!`, `?`, U+2665 and U+266A. The raster refuses U+2665 and U+266A (its allowed ranges
// skip U+2600-26FF), so each key lists stand-ins in order: the first glyph the raster accepts is drawn and
// `*` is the last resort. A raster that later accepts the heart or the note draws them with no change here.
const EMOTE_GLYPHS: Readonly<Record<string, readonly number[]>> = {
  '1': [0x21],
  '2': [0x3f],
  '3': [0x2665, 0x25c6],
  '4': [0x266a, 0x7e],
}

// The emote glyph of a key, or undefined when the key is not an emote.
export const emoteOf = (key: string): string | undefined => {
  const codes = EMOTE_GLYPHS[key]
  if (codes === undefined) return undefined

  return String.fromCodePoint(codes.find(isValidGlyph) ?? 0x2a)
}

// Dispatches every key (D13). W/A/S/D (either case) walk, 1-4 emote, [ ] jump rooms and e inspects; later keys are added here, so
// register.tsx never changes for them.
export const applyKeys = (state: PadState, keys: readonly string[], now: number): PadState => {
  let mode = state.mode
  let draft = state.draft
  let intent = state.intent
  let emote = state.emote
  let jump = state.jump
  let epoch = state.epoch
  let inspect = state.inspect
  let peek = state.peek
  for (const raw of keys) {
    // Chat mode (D47): every key, WASD and digits included, is text for the draft.
    if (mode === 'chat') {
      draft = cut(`${draft ?? ''}${raw}`, DRAFT_MAX)
      continue
    }
    // Lower-case `t` opens chat; the keys after it in the same burst are already the message.
    if (raw === 't') {
      mode = 'chat'
      draft = ''
      intent = undefined
      jump = undefined
      continue
    }
    const glyph = emoteOf(raw)
    if (glyph !== undefined) emote = { glyph, at: now }
    // Shift+E asks to peek at the nearest agent (D25); lower-case `e` inspects.
    if (raw === 'E') {
      peek = { at: now }
      continue
    }
    if (raw === 'e') {
      inspect = { at: now }
      continue
    }
    if (raw === ']' || raw === '[') {
      // A jump replaces any walking intent; keys that follow it in the same burst win over it.
      jump = { dir: raw === ']' ? 'next' : 'prev', at: now }
      intent = undefined
      epoch = (epoch ?? 0) + 1
      continue
    }
    const key = raw.toLowerCase()
    if (!isDir(key)) continue
    jump = undefined
    intent = { key, at: now, taps: intent !== undefined && intent.key === key ? Math.min(intent.taps + 1, MAX_TAPS) : 1 }
  }

  return { ...state, mode, draft, intent, emote, jump, epoch, inspect, peek }
}

// One `ui.input` change: diffs the value, applies the keys and flips the clear marker so the Input is
// redrawn empty-looking.
export const onPadInput = (state: PadState, value: string, now: number): PadState => {
  const { keys, handled } = readKeys(state.handled, value, state.clear)
  const applied = applyKeys({ ...state, handled }, keys, now)
  // In chat mode the field is not cleared: it keeps the typed text, so a space is never mistaken for the clear
  // marker. The draft is read from the field (everything after its `base`), so a deletion, a paste or an edit in
  // the middle all give the text on screen (D47).
  if (applied.mode === 'chat') {
    const chars = Array.from(value)
    const base = state.mode === 'chat' ? (state.base ?? 0) : Math.max(0, chars.length - (keys.length - keys.indexOf('t') - 1))

    return { ...applied, base, draft: chars.slice(base).join('').slice(0, DRAFT_MAX) }
  }

  return keys.length === 0 && CLEAR_VALUES.includes(value) ? { ...applied, handled } : { ...applied, clear: nextClear(state.clear) }
}

// Enter (D23, D47): in chat mode sends the draft (cleaned, cut to CHAT_MAX) or, when it is empty, cancels. Either
// way chat mode ends and the field is reset by flipping the clear marker. Outside chat mode Enter does nothing.
export const onPadSubmit = (state: PadState, now: number): PadState => {
  if (state.mode !== 'chat') return state
  const text = cut(clean(state.draft ?? ''), CHAT_MAX).trim()
  const { mode: _mode, draft: _draft, base: _base, ...rest } = state

  return { ...rest, handled: '', clear: nextClear(state.clear), ...(text === '' ? {} : { chat: { text, at: now } }) }
}

// The line the pad shows while a message is being typed (over the inspect line), or undefined outside chat mode.
// It shows what would be sent: the first CHAT_MAX characters, then `_`, or `|` once the rest would be cut.
export const chatLine = (state: PadState): string | undefined => {
  if (state.mode !== 'chat') return undefined
  const chars = Array.from(state.draft ?? '')

  return `Say: ${chars.slice(0, CHAT_MAX).join('')}${chars.length > CHAT_MAX ? '|' : '_'}`
}

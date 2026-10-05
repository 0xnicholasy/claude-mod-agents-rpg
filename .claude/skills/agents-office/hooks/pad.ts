// The pad: keys typed into a one-row Input (D13). Pure: register.tsx reads and writes the `pad` atom and
// passes plain data in. The Input only ever holds the clear marker plus what was typed since the last
// redraw, so keys are found by diffing its value against what was already handled.

import { isValidGlyph } from './raster'

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
}

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

// Dispatches every key (D13). W/A/S/D (either case) walk and 1-4 emote; later keys are added here, so
// register.tsx never changes for them.
export const applyKeys = (state: PadState, keys: readonly string[], now: number): PadState => {
  let intent = state.intent
  let emote = state.emote
  for (const raw of keys) {
    const glyph = emoteOf(raw)
    if (glyph !== undefined) emote = { glyph, at: now }
    const key = raw.toLowerCase()
    if (!isDir(key)) continue
    intent = { key, at: now, taps: intent !== undefined && intent.key === key ? Math.min(intent.taps + 1, MAX_TAPS) : 1 }
  }

  return { ...state, intent, emote }
}

// One `ui.input` change: diffs the value, applies the keys and flips the clear marker so the Input is
// redrawn empty-looking.
export const onPadInput = (state: PadState, value: string, now: number): PadState => {
  const { keys, handled } = readKeys(state.handled, value, state.clear)
  const applied = applyKeys({ ...state, handled }, keys, now)

  return keys.length === 0 && CLEAR_VALUES.includes(value) ? { ...applied, handled } : { ...applied, clear: nextClear(state.clear) }
}

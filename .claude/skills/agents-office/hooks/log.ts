// Interaction log strip lines (T10). Pure: no `$`; register.tsx reads and writes the
// `log` atom and passes plain data in.
import { bubbleText } from './choreo'

export const LOG_LINES = 5

// Appends one line and keeps the newest LOG_LINES, oldest first.
export const pushLog = (log: readonly string[], line: string): string[] =>
  [...log, line].slice(-LOG_LINES)

const LABEL_CHARS = 16

// Labels, `to` and message text come from the model or a teammate: any control character
// would reach the terminal (escape injection), so every one becomes a space (A1).
export const clean = (s: string): string => s.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim()

const cleanLabel = (s: string): string => clean(Array.from(clean(s)).slice(0, LABEL_CHARS).join(''))

export const arrived = (label: string, roomName: string): string =>
  `${cleanLabel(label)} arrived in the ${clean(roomName)}`

// The text follows the bubble rule (D39): whitespace collapsed, first 40 code points.
export const told = (from: string, to: string, text: string): string =>
  `${cleanLabel(from)} told ${cleanLabel(to)}: ${bubbleText(clean(text))}`

export const reported = (label: string, reason: string): string =>
  reason === 'answer' ? `${cleanLabel(label)} reported done` : `${cleanLabel(label)} reported stopped`

// Interaction log strip lines (T10). Pure: no `$`; register.tsx reads and writes the
// `log` atom and passes plain data in.
import { bubbleText } from './choreo'

export const LOG_LINES = 5

// Appends one line and keeps the newest LOG_LINES, oldest first.
export const pushLog = (log: readonly string[], line: string): string[] =>
  [...log, line].slice(-LOG_LINES)

export const arrived = (label: string, roomName: string): string =>
  `${label} arrived in the ${roomName}`

// The text follows the bubble rule (D39): whitespace collapsed, first 40 code points.
export const told = (from: string, to: string, text: string): string =>
  `${from} told ${to}: ${bubbleText(text)}`

export const reported = (label: string, reason: string): string =>
  reason === 'answer' ? `${label} reported done` : `${label} reported stopped`

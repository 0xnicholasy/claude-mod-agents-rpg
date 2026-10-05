// Inspect (D16, D39): the nearest agent's status line. Pure: register.tsx reads the atoms and `$.session.messages`
// and passes plain data in. Privacy: only the label, status, tool name, room, elapsed time and (for the own
// session's agents, passed in by the caller) the tail of their last text are ever shown; never a tool argument.

import type { OfficeAgent, Roster } from './agents'
import { clean } from './log'
import type { Motion } from './frame'
import type { Point } from './map'

// How far (Manhattan tiles between footprint origins) the player can inspect.
export const INSPECT_RANGE = 2
// Characters of an own agent's last text appended to the line.
export const TEXT_TAIL = 60
// A room name is cut to this many characters, so a long team label leaves room for the elapsed time at 80 columns.
export const ROOM_CHARS = 14

// The nearest agent with a motion entry within INSPECT_RANGE of the player; ties go to the lower id.
export const nearest = (agents: Roster, motion: Motion, from: Point, range = INSPECT_RANGE): OfficeAgent | undefined => {
  let best: OfficeAgent | undefined
  let bestDist = Infinity
  for (const agent of Object.values(agents)) {
    const at = motion[agent.id]
    if (at === undefined) continue
    const dist = Math.abs(at.x - from.x) + Math.abs(at.y - from.y)
    if (dist > range) continue
    if (dist < bestDist || (dist === bestDist && best !== undefined && agent.id < best.id)) {
      best = agent
      bestDist = dist
    }
  }

  return best
}

// `5s`, then `2m05s`, then `1h02m`.
export const elapsedText = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}m${String(total % 60).padStart(2, '0')}s`

  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
}

// `label | status | tool | room | elapsed`. Only an agent of this session (`own: true`) shows its tool and the
// tail of its last text; any other agent shows its pose instead (D16 privacy). An agent that has run no tool yet
// shows its pose too. `lastText` is cleaned and cut to its last TEXT_TAIL characters.
export const inspectText = (
  agent: OfficeAgent,
  roomName: string,
  now: number,
  options: { own?: boolean; lastText?: string } = {},
): string => {
  const what = options.own === true ? (agent.tool ?? agent.pose) : agent.pose
  const parts = [agent.label, agent.status, what, Array.from(roomName).slice(0, ROOM_CHARS).join(''), elapsedText(now - (agent.seenAt ?? now))]
  const tail = options.own !== true || options.lastText === undefined ? '' : Array.from(clean(options.lastText)).slice(-TEXT_TAIL).join('')
  if (tail !== '') parts.push(tail)

  return parts.join(' | ')
}

// Peek (D25): the last PEEK_MAX rows that carry text, oldest first, one cleaned line each cut to PEEK_WIDTH
// characters. Tool rows (no text) are dropped; a user row is marked `> ` so the two voices stay apart. Only the
// caller's own agents are ever passed in (D16, D25).
export const PEEK_MAX = 10
export const PEEK_WIDTH = 120
export const peekLines = (messages: ReadonlyArray<{ role: string; text: string }>): string[] =>
  messages
    .flatMap(row => {
      const text = clean(row.text)

      return text === '' ? [] : [`${row.role === 'user' ? '> ' : ''}${text}`]
    })
    .slice(-PEEK_MAX)
    .map(line => Array.from(line).slice(0, PEEK_WIDTH).join(''))

// The text of the newest assistant message row that has any, or undefined. User rows are skipped: they hold
// prompts, which are never shown (D16).
export const lastTextOf = (messages: ReadonlyArray<{ role: string; text: string }>): string | undefined => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const row = messages[i]
    if (row === undefined || row.role !== 'assistant') continue
    const text = clean(row.text)
    if (text !== '') return text
  }

  return undefined
}

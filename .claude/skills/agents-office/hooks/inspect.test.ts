import { expect, test } from 'claude-code/testing'
import type { OfficeAgent, Roster } from './agents'
import type { Motion } from './frame'
import { elapsedText, inspectText, lastTextOf, nearest } from './inspect'

const agent = (id: string, extra: Partial<OfficeAgent> = {}): OfficeAgent => ({
  id,
  label: id,
  tier: 'sonnet',
  status: 'working',
  room: 'reception',
  pose: 'idle',
  home: 'reception',
  teammate: false,
  ...extra,
})
const at = (x: number, y: number): Motion[string] => ({ x, y, path: [], frame: 0 })

test('nearest within 2 tiles', () => {
  const roster: Roster = { b: agent('b'), a: agent('a'), far: agent('far'), edge: agent('edge') }
  const motion: Motion = { b: at(12, 10), a: at(8, 10), far: at(13, 10), edge: at(11, 11) }
  // a and b are both 2 away from x=10: the lower id wins.
  expect(nearest(roster, motion, { x: 10, y: 10 })?.id).toBe('a')
  // edge is 2 away (1+1); far is 3 away and ignored.
  expect(nearest({ far: roster.far as OfficeAgent }, { far: at(13, 10) }, { x: 10, y: 10 })).toBeUndefined()
  expect(nearest({ edge: roster.edge as OfficeAgent }, { edge: at(11, 11) }, { x: 10, y: 10 })?.id).toBe('edge')
  // A nearer agent beats a lower id.
  expect(nearest(roster, { ...motion, b: at(10, 11) }, { x: 10, y: 10 })?.id).toBe('b')
})

test('inspect text format', () => {
  const main = agent('main', { tool: 'Read', seenAt: 1000 })
  expect(inspectText(main, 'proj', 126000, { own: true })).toBe('main | working | Read | proj | 2m05s')
  expect(inspectText(main, 'a-very-long-team-label (branch)', 1000, { own: true })).toBe('main | working | Read | a-very-long-te | 0s')
  expect(elapsedText(5400)).toBe('5s')
  // A remote agent shows its pose, never its tool; no tool yet shows the pose too.
  expect(inspectText(main, 'proj', 6000)).toBe('main | working | idle | proj | 5s')
  expect(inspectText(agent('x'), 'Kitchen', 0, { own: true })).toBe('x | working | idle | Kitchen | 0s')
  // Not own: no tool and no text, even when one is passed.
  expect(inspectText(main, 'proj', 6000, { lastText: 'secret' })).toBe('main | working | idle | proj | 5s')
})

test('own text keeps its last 60 cleaned characters', () => {
  const long = `${'a'.repeat(30)}\n${'b'.repeat(60)}`
  const line = inspectText(agent('main', { seenAt: 0 }), 'proj', 0, { own: true, lastText: long })
  expect(line.endsWith(` | ${'b'.repeat(60)}`)).toBe(true)
  expect(lastTextOf([{ role: 'assistant', text: 'one' }, { role: 'assistant', text: '  ' }])).toBe('one')
  // The newest text row is the user's prompt: it is never shown.
  expect(lastTextOf([{ role: 'assistant', text: 'answer' }, { role: 'user', text: 'my prompt' }])).toBe('answer')
  expect(lastTextOf([{ role: 'user', text: 'my prompt' }])).toBeUndefined()
  expect(lastTextOf([])).toBeUndefined()
})

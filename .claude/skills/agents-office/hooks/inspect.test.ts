import { expect, test } from 'claude-code/testing'
import type { OfficeAgent, Roster } from './agents'
import type { Motion } from './frame'
import { MID_FOOT } from './map'
import { elapsedText, inspectText, lastTextOf, nearest, peekLines, PEEK_WIDTH } from './inspect'

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

test('peek keeps the last 10 text messages', () => {
  const rows = Array.from({ length: 14 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', text: `line ${i}` }))
  // Tool rows carry no text and are dropped before the cut.
  const mixed = [...rows.slice(0, 7), { role: 'user', text: '' }, ...rows.slice(7), { role: 'assistant', text: '  \n ' }]
  const lines = peekLines(mixed)

  expect(lines).toHaveLength(10)
  expect(lines[0]).toBe('> line 4')
  expect(lines.at(-1)).toBe('line 13')
  expect(lines[1]).toBe('line 5')
  // A user row is marked, control characters are cleaned and a long line is cut.
  expect(peekLines([{ role: 'user', text: 'hi\u0007 there' }, { role: 'assistant', text: 'x'.repeat(500) }])).toEqual([
    expect.stringMatching(/^> hi.? there$/),
    'x'.repeat(PEEK_WIDTH),
  ])
  expect(peekLines([])).toEqual([])
})

test('mid inspect measures the gap between figures', () => {
  const roster: Roster = { two: agent('two'), three: agent('three') }
  const from = { x: 10, y: 10 }
  // Origins 7 apart in x leave a 2-cell gap between two 5-wide figures; 8 apart leave 3.
  expect(nearest({ two: roster.two as OfficeAgent }, { two: at(17, 10) }, from, undefined, MID_FOOT)?.id).toBe('two')
  expect(nearest({ three: roster.three as OfficeAgent }, { three: at(18, 10) }, from, undefined, MID_FOOT)).toBeUndefined()
  // The gap adds across both axes: 1 in x and 2 in y is 3, so it is out; 1 and 1 is in.
  expect(nearest({ two: roster.two as OfficeAgent }, { two: at(16, 17) }, from, undefined, MID_FOOT)).toBeUndefined()
  expect(nearest({ two: roster.two as OfficeAgent }, { two: at(16, 16) }, from, undefined, MID_FOOT)?.id).toBe('two')
  // The same 7-apart agent is out of range on the small map, where origins are measured.
  expect(nearest({ two: roster.two as OfficeAgent }, { two: at(17, 10) }, from)).toBeUndefined()
})

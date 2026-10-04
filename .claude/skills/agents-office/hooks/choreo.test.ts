import { expect, test } from 'claude-code/testing'
import type { OfficeAgent, Roster } from './agents'
import { advanceScripts, bubbleText, startMeet } from './choreo'
import type { ChoreoState } from './choreo'
import { placeMotion } from './frame'
import { buildMap } from './map'
import { step } from './motion'
import { BUBBLE_MS, TICK_MS } from './timing'

const map = buildMap(60, 18)

const agent = (id: string, over: Partial<OfficeAgent> = {}): OfficeAgent => ({
  id,
  label: id,
  tier: 'opus',
  status: 'working',
  room: 'devbay',
  home: 'devbay',
  pose: 'type',
  teammate: false,
  ...over,
})

const roster: Roster = {
  main: agent('main', { room: 'lobby', home: 'lobby', pose: 'idle' }),
  a1: agent('a1', { label: 'reviewer' }),
}

const initial = (): ChoreoState => ({ map, agents: roster, motion: placeMotion(map, roster, {}), bubbles: [] })

// One engine tick: agents step, then scripts advance.
const tickOnce = (state: ChoreoState, now: number): ChoreoState =>
  advanceScripts({ ...state, motion: step(state.motion) }, now)

const walking = (state: ChoreoState): boolean => Object.values(state.motion).some(m => m.path.length > 0)

const MESSAGE = 'please review the parser changes and report back to me'

test('SendMessage seats both agents in the Meeting Room, shows the 40-char bubble for 4000 ms, then returns both', () => {
  const start = initial()
  const homes = { main: start.motion.main, a1: start.motion.a1 }
  let now = 1000
  let state = startMeet(start, 'main', 'a1', MESSAGE, now)
  expect(state.agents.main?.room).toBe('meeting')
  expect(state.agents.a1?.room).toBe('meeting')

  const meeting = map.rooms.find(r => r.id === 'meeting')?.anchors ?? []
  let ticks = 0
  while (state.bubbles.length === 0 && ticks < 300) {
    now += TICK_MS
    state = tickOnce(state, now)
    ticks += 1
  }
  expect(ticks).toBeLessThan(300)
  for (const id of ['main', 'a1']) {
    const at = state.motion[id]
    expect(meeting.some(a => a.x === at?.x && a.y === at?.y)).toBe(true)
  }
  const arrivedAt = now
  expect(state.bubbles).toEqual([{ agentId: 'main', text: MESSAGE.slice(0, 40), until: arrivedAt + BUBBLE_MS }])
  expect(MESSAGE.slice(0, 40)).toHaveLength(40)
  expect(state.agents.main?.pose).toBe('talk')

  // Still shown just before the end, gone at 4000 ms.
  now = arrivedAt + BUBBLE_MS - TICK_MS
  state = advanceScripts(state, now)
  expect(state.bubbles).toHaveLength(1)
  expect(state.agents.main?.script?.phase).toBe('talking')
  now = arrivedAt + BUBBLE_MS
  state = advanceScripts(state, now)
  expect(state.bubbles).toEqual([])
  expect(state.agents.main?.script?.phase).toBe('returning')
  expect(state.agents.main?.room).toBe('lobby')
  expect(state.agents.a1?.room).toBe('devbay')

  ticks = 0
  while ((walking(state) || state.agents.main?.script !== undefined || state.agents.a1?.script !== undefined) && ticks < 300) {
    now += TICK_MS
    state = tickOnce(state, now)
    ticks += 1
  }
  expect(ticks).toBeLessThan(300)
  expect(state.motion.main).toMatchObject({ x: homes.main?.x, y: homes.main?.y })
  expect(state.motion.a1).toMatchObject({ x: homes.a1?.x, y: homes.a1?.y })
  expect(state.agents.main?.pose).toBe('idle')
  expect(state.agents.a1?.pose).toBe('type')
})

test('a non-string or unknown `to` leaves both agents in place', () => {
  const start = initial()
  for (const to of [42, undefined, { name: 'a1' }, 'nobody', 'main']) {
    const state = startMeet(start, 'main', to, 'hello', 500)
    expect(state.agents).toBe(start.agents)
    expect(state.motion).toBe(start.motion)
    expect(state.bubbles).toEqual([{ agentId: 'main', text: 'hello', until: 500 + BUBBLE_MS }])
  }
})

test('a peer matches by label, and a busy or finished peer only gets the bubble', () => {
  const start = initial()
  expect(startMeet(start, 'main', 'reviewer', 'hi', 0).agents.a1?.script?.peer).toBe('main')
  const busy = startMeet(start, 'main', 'a1', 'hi', 0)
  const again = startMeet(busy, 'main', 'a1', 'again', 10)
  expect(again.agents).toBe(busy.agents)
  expect(again.bubbles).toHaveLength(1)
  const done: ChoreoState = { ...start, agents: { ...roster, a1: agent('a1', { status: 'done' }) } }
  expect(startMeet(done, 'main', 'a1', 'hi', 0).agents).toBe(done.agents)
})

test('bubble text collapses whitespace and keeps 40 code points', () => {
  expect(bubbleText('line one\n\nline   two')).toBe('line one line two')
  expect(bubbleText('x'.repeat(50))).toBe('x'.repeat(40))
  expect(bubbleText('   ')).toBe('...')
})

test('a script is released when the peer is gone', () => {
  const state = startMeet(initial(), 'main', 'a1', 'hi', 0)
  const { a1: _gone, ...rest } = state.agents
  const released = advanceScripts({ ...state, agents: rest }, 100)
  expect(released.agents.main?.script).toBeUndefined()
  expect(released.agents.main?.room).toBe('lobby')
})

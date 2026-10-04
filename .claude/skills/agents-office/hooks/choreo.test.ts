import { expect, test } from 'claude-code/testing'
import { onActivity } from './agents'
import type { OfficeAgent, Roster } from './agents'
import { advanceScripts, bubbleText, expireBubbles, startMeet } from './choreo'
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

const devbay = map.rooms.find(r => r.id === 'devbay')?.anchors ?? []

// main in the lobby; a2 and a3 in the Dev Bay on anchors 1 and 2 (anchor 0 is free).
const threeInOneRoom = (): ChoreoState => {
  const full: Roster = { ...roster, a1: agent('a1'), a2: agent('a2'), a3: agent('a3') }
  const seated = placeMotion(map, full, {})
  const { a1: _a1, ...motion } = seated
  const { a1: _gone, ...agents } = full

  return { map, agents, motion, bubbles: [] }
}

const settle = (start: ChoreoState, from: number): ChoreoState => {
  let state = start
  let now = from
  let ticks = 0
  while (ticks < 600 && (walking(state) || Object.values(state.agents).some(a => a.script !== undefined))) {
    now += TICK_MS
    state = tickOnce(state, now)
    ticks += 1
  }
  expect(ticks).toBeLessThan(600)

  return state
}

test('the messaging agent returns to its own anchor, not the first free one', () => {
  const start = threeInOneRoom()
  expect(start.motion.a2).toMatchObject({ x: devbay[1]?.x, y: devbay[1]?.y })
  expect(start.motion.a3).toMatchObject({ x: devbay[2]?.x, y: devbay[2]?.y })
  const state = settle(startMeet(start, 'a2', 'a3', 'hi', 0), 0)
  expect(state.motion.a2).toMatchObject({ x: devbay[1]?.x, y: devbay[1]?.y })
  expect(state.motion.a3).toMatchObject({ x: devbay[2]?.x, y: devbay[2]?.y })
})

test('an agent whose anchor was taken meanwhile returns to a free anchor of its room', () => {
  const start = threeInOneRoom()
  const going = startMeet(start, 'a2', 'a3', 'hi', 0)
  const taken = { x: devbay[1]?.x ?? 0, y: devbay[1]?.y ?? 0, path: [], frame: 0 }
  const state = settle({ ...going, motion: { ...going.motion, squatter: taken } }, 0)
  const at = state.motion.a2
  expect(devbay.some(a => a.x === at?.x && a.y === at?.y)).toBe(true)
  expect(at).not.toMatchObject({ x: taken.x, y: taken.y })
})

test('a meet on an agent already in a meeting gives only a bubble over the speaker', () => {
  const first = startMeet(initial(), 'main', 'a1', 'hello', 0)
  const third: Roster = { ...first.agents, a2: agent('a2') }
  const withThird: ChoreoState = { ...first, agents: third, motion: placeMotion(map, third, first.motion) }
  const second = startMeet(withThird, 'a1', 'a2', 'and you', 10)
  expect(second.agents).toBe(withThird.agents)
  expect(second.motion).toBe(withThird.motion)
  expect(second.agents.a2?.script).toBeUndefined()
  expect(second.bubbles).toEqual([{ agentId: 'a1', text: 'and you', until: 10 + BUBBLE_MS }])
})

test('a new bubble replaces the agent\'s existing one', () => {
  const once = startMeet(initial(), 'main', 'nobody', 'first', 0)
  const twice = startMeet(once, 'main', 'nobody', 'second', 100)
  expect(twice.bubbles).toEqual([{ agentId: 'main', text: 'second', until: 100 + BUBBLE_MS }])
})

test('expireBubbles drops bubbles at their end time and keeps the reference when none expired', () => {
  const live = [{ agentId: 'main', text: 'x', until: 100 }]
  expect(expireBubbles(live, 99)).toBe(live)
  expect(expireBubbles(live, 100)).toEqual([])
})

test('the script is released in `going` when the peer goes done', () => {
  let going = startMeet(initial(), 'main', 'a1', 'hi', 0)
  for (let i = 1; i <= 5; i += 1) going = tickOnce(going, i * TICK_MS)
  expect(going.agents.main?.script?.phase).toBe('going')
  const broken: ChoreoState = { ...going, agents: { ...going.agents, a1: { ...going.agents.a1!, status: 'done' } } }
  const released = advanceScripts(broken, 600)
  expect(released.agents.main?.script).toBeUndefined()
  expect(released.agents.main?.room).toBe('lobby')
  expect(released.agents.a1?.script).toBeUndefined()
  expect(released.motion.main?.path.length).toBeGreaterThan(0)
})

test('the script is released in `talking` when the peer goes done', () => {
  let state = startMeet(initial(), 'main', 'a1', 'hi', 0)
  let now = 0
  while (state.agents.main?.script?.phase !== 'talking' && now < 60000) {
    now += TICK_MS
    state = tickOnce(state, now)
  }
  expect(state.agents.main?.script?.phase).toBe('talking')
  expect(state.agents.main?.pose).toBe('talk')
  const broken: ChoreoState = { ...state, agents: { ...state.agents, a1: { ...state.agents.a1!, status: 'done' } } }
  const released = advanceScripts(broken, now + TICK_MS)
  expect(released.agents.main?.script).toBeUndefined()
  expect(released.agents.main?.room).toBe('lobby')
  expect(released.agents.main?.pose).toBe('idle')
  expect(released.motion.main?.path.length).toBeGreaterThan(0)
})

test('a tool call under a script updates where the agent returns and does not move it', () => {
  const going = startMeet(initial(), 'a1', 'main', 'hi', 0)
  const after = onActivity(going.agents, 'a1', { room: 'library', pose: 'read' })
  expect(after.a1?.script).toMatchObject({ phase: 'going', returnRoom: 'library', returnPose: 'read' })
  expect(after.a1?.room).toBe('meeting')
  expect(after.a1?.pose).toBe(going.agents.a1?.pose)
  expect(onActivity(after, 'a1', { room: 'library', pose: 'read' })).toBe(after)

  const state = settle({ ...going, agents: after }, 0)
  const libraryAnchors = map.rooms.find(r => r.id === 'library')?.anchors ?? []
  expect(libraryAnchors.some(a => a.x === state.motion.a1?.x && a.y === state.motion.a1?.y)).toBe(true)
  expect(state.agents.a1?.pose).toBe('read')
})

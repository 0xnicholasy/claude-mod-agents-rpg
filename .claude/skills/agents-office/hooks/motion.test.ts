import { expect, test } from 'claude-code/testing'
import type { OfficeAgent } from './agents'
import type { Motion } from './frame'
import { buildMap } from './map'
import type { Point } from './map'
import { assignTarget, drawnFrame, drawnPose, enterAtDoor, step } from './motion'

const map = buildMap(60, 18)

const room = (id: string) => {
  const found = map.rooms.find(r => r.id === id)
  if (found === undefined) throw new Error(`no room ${id}`)
  return found
}

const entry = (motion: Motion, id: string): Motion[string] => {
  const found = motion[id]
  if (found === undefined) throw new Error(`no entry ${id}`)
  return found
}

const dist = (a: Point, b: Point): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

const worker = (over: Partial<OfficeAgent> = {}): OfficeAgent => ({
  id: 'a',
  label: 'a',
  tier: 'opus',
  status: 'working',
  room: 'devbay',
  pose: 'type',
  teammate: false,
  ...over,
})

test('step moves each agent exactly one tile and keeps anchors unique', () => {
  let motion: Motion = {}
  for (const id of ['a', 'b', 'c']) {
    motion = enterAtDoor(motion, map, id, 'devbay')
  }
  const targets = ['a', 'b', 'c'].map(id => entry(motion, id).path.at(-1))
  expect(new Set(targets.map(t => `${t?.x},${t?.y}`)).size).toBe(3)
  for (const t of targets) expect(room('devbay').anchors).toContainEqual(t)

  for (let i = 0; i < 5; i++) {
    const before = motion
    motion = step(before)
    for (const id of ['a', 'b', 'c']) {
      expect(dist(entry(before, id), entry(motion, id))).toBe(1)
      expect(entry(motion, id).path.length).toBe(entry(before, id).path.length - 1)
    }
  }
  while (Object.values(motion).some(m => m.path.length > 0)) motion = step(motion)
  const resting = ['a', 'b', 'c'].map(id => `${entry(motion, id).x},${entry(motion, id).y}`)
  expect(new Set(resting).size).toBe(3)
  expect(step(motion)).toBe(motion)
  expect(assignTarget(motion, map, 'a', 'devbay')).toBe(motion)
})

test('an arriving agent switches from walk to its work pose', () => {
  let motion = enterAtDoor({}, map, 'a', 'devbay')
  const agent = worker()
  const steps = entry(motion, 'a').path.length
  expect(steps).toBeGreaterThan(1)
  for (let i = 1; i < steps; i++) {
    motion = step(motion)
    expect(drawnPose(agent, entry(motion, 'a'))).toBe('walk')
  }
  motion = step(motion)

  expect(entry(motion, 'a').path).toEqual([])
  expect(drawnPose(agent, entry(motion, 'a'))).toBe('type')
  expect(drawnFrame('type', entry(motion, 'a'), 0)).toBe(0)
  expect(drawnFrame('type', entry(motion, 'a'), 300)).toBe(1)
})

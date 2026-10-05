import { expect, test } from 'claude-code/testing'
import type { OfficeAgent } from './agents'
import type { Motion } from './frame'
import { buildOffice } from './map'
import type { Point } from './map'
import { assignTarget, drawnFacing, drawnFrame, drawnPose, enterAtDoor, step } from './motion'
import { frameCount } from './sprites'
import type { OfficeMap } from './map'
const buildMap = (columns: number, rows: number): OfficeMap => buildOffice(columns, rows, [{ id: 'team:t1', label: 'proj' }], 'team:t1')

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
  room: 'team:t1',
  home: 'team:t1',
  pose: 'type',
  teammate: false,
  ...over,
})

test('step moves each agent exactly one tile and keeps anchors unique', () => {
  let motion: Motion = {}
  for (const id of ['a', 'b', 'c']) {
    motion = enterAtDoor(motion, map, id, 'team:t1')
  }
  const targets = ['a', 'b', 'c'].map(id => entry(motion, id).path.at(-1))
  expect(new Set(targets.map(t => `${t?.x},${t?.y}`)).size).toBe(3)
  for (const t of targets) expect(room('team:t1').anchors).toContainEqual(t)

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
  expect(assignTarget(motion, map, 'a', 'team:t1')).toBe(motion)
})

test('an arriving agent switches from walk to its work pose', () => {
  let motion = enterAtDoor({}, map, 'a', 'team:t1')
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

const island = { ...map, rooms: map.rooms.map(r => (r.id === 'team:t1' ? { ...r, anchors: [{ x: 0, y: 0 }] } : r)) }

test('retargeting a walker to an unreachable room keeps its path', () => {
  const walking = enterAtDoor({}, map, 'a', 'team:t1')

  expect(assignTarget(walking, island, 'a', 'team:t1')).toBe(walking)
})

test('enterAtDoor makes no entry when the room is unknown or unreachable', () => {
  const motion: Motion = {}

  expect(enterAtDoor(motion, island, 'a', 'team:t1')).toBe(motion)
  expect(enterAtDoor(motion, map, 'a', 'nowhere')).toBe(motion)
})

test('walk frames cycle through 4', () => {
  expect(frameCount('walk')).toBe(4)
  let motion: Motion = { a: { x: 0, y: 0, path: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }, { x: 5, y: 0 }], frame: 0 } }
  const seen: number[] = []
  for (let i = 0; i < 5; i++) {
    motion = step(motion)
    seen.push(entry(motion, 'a').frame)
  }
  expect(seen).toEqual([1, 2, 3, 0, 1])
})

test('drawnFacing follows the next path step and rests facing down', () => {
  const e = (path: Motion[string]['path']): Motion[string] => ({ x: 5, y: 5, path, frame: 0 })

  expect(drawnFacing(e([{ x: 6, y: 5 }]))).toBe('right')
  expect(drawnFacing(e([{ x: 4, y: 5 }]))).toBe('left')
  expect(drawnFacing(e([{ x: 5, y: 6 }]))).toBe('down')
  expect(drawnFacing(e([{ x: 5, y: 4 }]))).toBe('up')
  expect(drawnFacing(e([]))).toBe('down')
})

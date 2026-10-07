import { expect, test } from 'claude-code/testing'
import { focusOf, viewFor } from './camera'
import { buildOffice, MID_FOOT } from './map'
import type { TeamSpec } from './map'
import { sceneOf } from './scene'
import type { SceneInput } from './scene'
import { MID_SEAT_W } from './midArt'
import { CELL_PX, SPRITES } from './sceneArt'

const teams = (n: number): TeamSpec[] => Array.from({ length: n }, (_, i) => ({ id: `team:s${i}` as const, label: `project-${i}` }))
const at = (hour: number): number => new Date(2026, 9, 7, hour, 0, 0).getTime()
const inputOf = (over: Partial<SceneInput> = {}): SceneInput => ({
  map: buildOffice(100, 24, teams(2)),
  paneColumns: 100,
  paneRows: 24,
  ownId: 'team:s0',
  now: at(12),
  ...over,
})

test('2 teams give 2 team rooms plus 5 shared rooms with px bounds = cells x CELL_PX', () => {
  const input = inputOf()
  const scene = sceneOf(input)
  expect(scene.rooms.filter(r => r.kind === 'team').length).toBe(2)
  expect(scene.rooms.length).toBe(7)
  expect(scene.world).toEqual({ w: input.map.columns * CELL_PX.w, h: input.map.rows * CELL_PX.h })
  input.map.rooms.forEach((room, i) => {
    expect(scene.rooms[i]).toMatchObject({
      id: room.id,
      kind: room.kind,
      x: room.bounds.x * CELL_PX.w,
      y: room.bounds.y * CELL_PX.h,
      w: room.bounds.w * CELL_PX.w,
      h: room.bounds.h * CELL_PX.h,
    })
  })
  expect(scene.walls.length > 0 && scene.doors.length > 0).toBe(true)
})

test('every desk anchor has one desk prop and a chair', () => {
  const input = inputOf()
  const scene = sceneOf(input)
  const anchors = input.map.rooms.filter(r => r.kind === 'team').flatMap(r => r.anchors)
  expect(anchors.length > 0).toBe(true)
  expect(scene.props.filter(p => p.sprite === 'desk-monitor').length).toBe(anchors.length)
  expect(scene.props.filter(p => p.sprite === 'chair').length).toBe(anchors.length)
  // Small footprint 3x2: centre = anchor + 1.5 cells; desk foot one row above the chair foot.
  for (const a of anchors) {
    const desk = scene.props.filter(p => p.sprite === 'desk-monitor' && p.x === a.x * 8 + 12)
    expect(desk.length).toBe(1)
    expect(desk[0]?.y).toBe((a.y + 1) * 17)
    expect(scene.props.filter(p => p.sprite === 'chair' && p.x === a.x * 8 + 12 && p.y === (a.y + 2) * 17).length).toBe(1)
  }
})

test('mid maps centre team desks on the 8-cell seated figure', () => {
  const map = buildOffice(120, 30, teams(2), MID_FOOT)
  const scene = sceneOf(inputOf({ map, paneColumns: 120, paneRows: 30 }))
  const anchors = map.rooms.filter(r => r.kind === 'team').flatMap(r => r.anchors)
  expect(anchors.length > 0).toBe(true)
  for (const a of anchors) {
    expect(scene.props.filter(p => p.sprite === 'desk-monitor' && p.x === (a.x + MID_SEAT_W / 2) * CELL_PX.w).length).toBe(1)
  }
})

test('each room kind holds exactly its own furniture', () => {
  const scene = sceneOf(inputOf())
  const want: Record<string, string[]> = {
    team: ['chair', 'desk-monitor'],
    reception: ['plant-tall', 'reception-desk'],
    conference: ['conference-table', 'whiteboard'],
    kitchen: ['coffee-machine', 'fridge', 'water-cooler'],
    lab: ['printer', 'server-rack'],
    booths: ['armchair', 'phone'],
  }
  for (const room of scene.rooms) {
    // Props sit on or above the room's floor line, inside its x range.
    const inside = scene.props.filter(p => p.x >= room.x && p.x < room.x + room.w && p.y > room.y && p.y <= room.y + room.h)
    expect([...new Set(inside.map(p => p.sprite))].sort()).toEqual(want[room.kind])
  }
  for (const p of scene.props) expect(p.layer).toBe(SPRITES[p.sprite].layer)
})

test('the camera centres on the player and clamps at the map edges', () => {
  const map = buildOffice(60, 18, teams(6))
  const base = { map, paneColumns: 60, paneRows: 18 }
  const mid = { x: Math.floor(map.columns / 2), y: 4 }
  const centred = sceneOf(inputOf({ ...base, player: mid })).camera
  const view = viewFor(map.columns, map.rows, 60, 18, focusOf(map, mid, 'team:s0'))
  expect(centred).toEqual({ x: view.x * CELL_PX.w, y: view.y * CELL_PX.h, w: 60 * CELL_PX.w, h: 18 * CELL_PX.h })
  const focusX = (mid.x + Math.floor(map.foot.w / 2)) * CELL_PX.w
  expect(Math.abs(centred.x + centred.w / 2 - focusX) <= CELL_PX.w / 2).toBe(true)
  expect(centred.x > 0 && centred.x + centred.w < map.columns * CELL_PX.w).toBe(true)

  expect(sceneOf(inputOf({ ...base, player: { x: map.columns - 3, y: 2 } })).camera.x).toBe((map.columns - 60) * CELL_PX.w)
  expect(sceneOf(inputOf({ ...base, player: { x: 0, y: 2 } })).camera.x).toBe(0)
})

test('night is set at 22:00 and not at 12:00', () => {
  expect(sceneOf(inputOf({ now: at(22) })).night).toBe(true)
  expect(sceneOf(inputOf({ now: at(12) })).night).toBe(false)
})

test('sceneOf is pure and JSON-serialisable', () => {
  const input = inputOf({ player: { x: 10, y: 3 } })
  const a = sceneOf(input)
  expect(sceneOf(input)).toEqual(a)
  expect(JSON.parse(JSON.stringify(a))).toEqual(a)
})

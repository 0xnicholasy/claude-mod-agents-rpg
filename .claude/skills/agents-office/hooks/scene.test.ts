import { expect, test } from 'claude-code/testing'
import { focusOf, viewFor } from './camera'
import { buildOffice, MID_FOOT } from './map'
import type { TeamSpec } from './map'
import { PLAYER_VARIANT, sceneKey, sceneOf } from './scene'
import type { SceneInput } from './scene'
import { placeMotion } from './frame'
import type { Motion } from './frame'
import type { OfficeAgent, Roster } from './agents'
import { remotePlayersOf, remoteRoster } from './presence'
import type { PresenceRecord, Remote } from './presence'
import type { Player } from './player'
import { MID_SEAT_W } from './midArt'
import { CELL_PX, personVariant, SEAT, SPRITES } from './sceneArt'

const teams = (n: number): TeamSpec[] => Array.from({ length: n }, (_, i) => ({ id: `team:s${i}` as const, label: `project-${i}` }))
const at = (hour: number): number => new Date(2026, 9, 7, hour, 0, 0).getTime()
const playerAt = (p: { x: number; y: number }): Player => ({ ...p, facing: 'down', frame: 0, path: [] })
const agentOf = (over: Partial<OfficeAgent> = {}): OfficeAgent => ({
  id: 'main',
  label: 'main',
  tier: 'opus',
  status: 'working',
  room: 'team:s0',
  pose: 'idle',
  home: 'team:s0',
  teammate: false,
  ...over,
})
const rosterOf = (...agents: OfficeAgent[]): Roster => Object.fromEntries(agents.map(a => [a.id, a]))
// A scene input with the agents seated by placeMotion, as the office tick does.
const withAgents = (agents: Roster, over: Partial<SceneInput> = {}): SceneInput => {
  const base = inputOf()
  const motion = placeMotion(base.map, agents, {})
  return { ...base, agents, motion, ...over }
}
const recordOf = (over: Partial<PresenceRecord> = {}): PresenceRecord => ({
  v: 1,
  sessionId: 's1',
  startedAt: 0,
  heartbeatAt: at(12),
  share: 'all',
  team: { label: 'project-1', branch: 'main' },
  agents: [{ id: 'a1', label: 'remote-dev', tier: 'sonnet', role: 'dev', room: 'team:s1', pose: 'type', status: 'working' }],
  player: null,
  ...over,
})
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
  const input = inputOf({ map: buildOffice(100, 24, teams(2), MID_FOOT) })
  const scene = sceneOf(input)
  const anchors = input.map.rooms.filter(r => r.kind === 'team').flatMap(r => r.anchors)
  expect(anchors.length > 0).toBe(true)
  // The Test Lab also has a bench desk, so count the desks above the corridor (the team band).
  expect(scene.props.filter(p => p.sprite === 'desk-monitor' && p.y < scene.corridor.y).length).toBe(anchors.length)
  expect(scene.props.filter(p => p.sprite === 'chair').length).toBe(anchors.length)
  // Mid footprint 5x5: centre = anchor + 4 cells (the 8-cell seat); the desk foot sits SEAT.deskFootY below the anchor's top
  // and the chair foot at the footprint's bottom.
  for (const a of anchors) {
    const desk = scene.props.filter(p => p.sprite === 'desk-monitor' && p.x === a.x * 8 + 32)
    expect(desk.length).toBe(1)
    expect(desk[0]?.y).toBe(a.y * 17 + SEAT.deskFootY)
    expect(scene.props.filter(p => p.sprite === 'chair' && p.x === a.x * 8 + 32 && p.y === (a.y + 5) * 17).length).toBe(1)
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
    reception: ['plant-tall', 'reception-desk', 'wall-clock'],
    conference: ['conference-table', 'plant-small', 'whiteboard'],
    kitchen: ['coffee-machine', 'fridge', 'kitchen-counter', 'water-cooler'],
    lab: ['desk-monitor', 'printer', 'server-rack', 'wall-clock'],
    booths: ['armchair', 'phone', 'wall-clock'],
  }
  for (const room of scene.rooms) {
    // Props sit on or above the room's floor line, inside its x range.
    const inside = scene.props.filter(p => p.x >= room.x && p.x < room.x + room.w && p.y >= room.y && p.y <= room.y + room.h)
    expect([...new Set(inside.map(p => p.sprite))].sort()).toEqual(want[room.kind])
  }
  for (const p of scene.props) expect(p.layer).toBe(SPRITES[p.sprite].layer)
})

test('the camera centres on the player and clamps at the map edges', () => {
  const map = buildOffice(60, 18, teams(6))
  const base = { map, paneColumns: 60, paneRows: 18 }
  const mid = { x: Math.floor(map.columns / 2), y: 4 }
  const centred = sceneOf(inputOf({ ...base, player: playerAt(mid) })).camera
  const view = viewFor(map.columns, map.rows, 60, 18, focusOf(map, mid, 'team:s0'))
  expect(centred).toEqual({ x: view.x * CELL_PX.w, y: view.y * CELL_PX.h, w: 60 * CELL_PX.w, h: 18 * CELL_PX.h })
  const focusX = (mid.x + Math.floor(map.foot.w / 2)) * CELL_PX.w
  expect(Math.abs(centred.x + centred.w / 2 - focusX) <= CELL_PX.w / 2).toBe(true)
  expect(centred.x > 0 && centred.x + centred.w < map.columns * CELL_PX.w).toBe(true)

  expect(sceneOf(inputOf({ ...base, player: playerAt({ x: map.columns - 3, y: 2 }) })).camera.x).toBe((map.columns - 60) * CELL_PX.w)
  expect(sceneOf(inputOf({ ...base, player: playerAt({ x: 0, y: 2 }) })).camera.x).toBe(0)
})

test('night is set at 22:00 and not at 12:00', () => {
  expect(sceneOf(inputOf({ now: at(22) })).night).toBe(true)
  expect(sceneOf(inputOf({ now: at(12) })).night).toBe(false)
})

test('sceneOf is pure and JSON-serialisable', () => {
  const input = inputOf({ player: playerAt({ x: 10, y: 3 }) })
  const a = sceneOf(input)
  expect(sceneOf(input)).toEqual(a)
  expect(JSON.parse(JSON.stringify(a))).toEqual(a)
})

test('a reading agent is seated at its own desk, a walking one stands', () => {
  const read = agentOf({ pose: 'read' })
  const input = withAgents(rosterOf(read))
  const fig = sceneOf(input).figures.find(f => f.key === 'main')
  expect(fig?.pose).toBe('seated')
  // Seating offsets (v3 D21): the back view, SEAT.lift above the chair's foot line, depth = the chair's foot line.
  const seat = sceneOf(input).props.filter(p => p.sprite === 'chair' && p.x === fig?.x && p.y === (fig?.y ?? 0) + SEAT.lift)
  expect(seat.length).toBe(1)
  expect(fig?.z).toBe((fig?.y ?? 0) + SEAT.lift)
  expect(fig?.facing).toBe('up')
  expect(fig?.sprite).toBe(`person${personVariant('main')}-up`)
  expect(fig?.plate).toBe('main')

  const walking: Motion = { main: { ...(input.motion?.main ?? { x: 0, y: 0, frame: 0 }), path: [{ x: 99, y: 0 }] } }
  const moving = sceneOf({ ...input, motion: walking }).figures.find(f => f.key === 'main')
  expect(moving?.pose).toBe('standing')
  expect(moving?.facing).toBe('right')
  expect(moving?.sprite).toBe(`person${personVariant('main')}-right`)
})

test('the desk stands behind the seated figure so the monitor shows over its head', () => {
  const base = inputOf({ map: buildOffice(100, 24, teams(2), MID_FOOT) })
  const agents = rosterOf(agentOf({ pose: 'type' }))
  const scene = sceneOf({ ...base, agents, motion: placeMotion(base.map, agents, {}) })
  const fig = scene.figures.find(f => f.key === 'main')
  const desk = scene.props.find(p => p.sprite === 'desk-monitor' && p.x === fig?.x)
  expect(desk !== undefined && fig !== undefined && desk.y < fig.y).toBe(true)
})

test('team room signs carry project and branch, and shared rooms and the corridor hold furniture', () => {
  const scene = sceneOf(inputOf({ map: buildOffice(100, 24, [{ id: 'team:s0', label: 'proj (feat/x)' }], MID_FOOT) }))
  expect(scene.rooms.find(r => r.kind === 'team')?.name).toBe('proj (feat/x)')
  const c = scene.corridor
  const inCorridor = scene.props.filter(p => p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h)
  expect(inCorridor.length >= 4).toBe(true)
})

test('a remote agent is drawn with remote true and no tool text', () => {
  const remote: Remote = { s1: recordOf() }
  const base = inputOf()
  const remoteAgents = remoteRoster(remote)
  const input: SceneInput = { ...base, remoteAgents, motion: placeMotion(base.map, remoteAgents, {}) }
  const figs = sceneOf(input).figures
  expect(figs.length).toBe(1)
  expect(figs[0]).toMatchObject({ key: 's1:a1', remote: true, player: false, pose: 'seated', plate: 'remote-dev', highlight: false })
  expect(Object.keys(figs[0] ?? {}).some(k => k === 'tool' || k === 'text')).toBe(false)
  expect(figs[0]?.bubble).toBe(undefined)
})

test('an expired emote, chat or bubble is absent and a live one is present', () => {
  const now = at(12)
  const agent = agentOf()
  const own = (until: number): SceneInput =>
    withAgents(rosterOf(agent), {
      now,
      player: { ...playerAt({ x: 10, y: 3 }), emote: '\u2665', emoteUntil: until, chat: 'hello', chatUntil: until },
      bubbles: [{ agentId: 'main', text: 'on it', until }],
    })
  const live = sceneOf(own(now + 1000)).figures
  expect(live.find(f => f.player)).toMatchObject({ emote: '\u2665', chat: 'hello' })
  expect(live.find(f => f.key === 'main')?.bubble).toBe('on it')
  const dead = sceneOf(own(now)).figures
  expect(dead.find(f => f.player)?.emote).toBe(undefined)
  expect(dead.find(f => f.player)?.chat).toBe(undefined)
  expect(dead.find(f => f.key === 'main')?.bubble).toBe(undefined)

  const map = inputOf().map
  const guest = (until: number): SceneInput => ({
    ...inputOf(),
    now,
    others: remotePlayersOf(
      { s1: recordOf({ player: { room: 'team:s1', rx: 2, ry: 2, facing: 'left', chat: 'hi', chatUntil: until } }) },
      map,
    ),
  })
  const seen = sceneOf(guest(now + 1000)).figures.find(f => f.key === 'player:s1')
  expect(seen).toMatchObject({ remote: true, player: true, chat: 'hi', facing: 'left', plate: 'project-1' })
  expect(sceneOf(guest(now)).figures.find(f => f.key === 'player:s1')?.chat).toBe(undefined)
})

test('only the inspect target is highlighted while it is shown', () => {
  const roster = rosterOf(agentOf(), agentOf({ id: 'sub', label: 'sub', room: 'team:s0' }))
  const inspect = (until: number): SceneInput => withAgents(roster, { inspect: { agentId: 'sub', text: 'sub | idle', until } })
  const live = sceneOf(inspect(at(12) + 500)).figures
  expect(live.filter(f => f.highlight).map(f => f.key)).toEqual(['sub'])
  expect(sceneOf(inspect(at(12))).figures.some(f => f.highlight)).toBe(false)
})

test('the chat draft wins the caption over an inspect line', () => {
  const inspect = { agentId: 'main', text: 'main | working | Read', until: at(12) + 500 }
  expect(sceneOf(inputOf({ inspect })).caption).toBe('main | working | Read')
  expect(sceneOf(inputOf({ inspect, chatLine: 'Say: hi_' })).caption).toBe('Say: hi_')
  expect(sceneOf(inputOf({ inspect: { ...inspect, until: at(12) } })).caption).toBe(undefined)
  expect(sceneOf(inputOf()).caption).toBe(undefined)
})

test('a done agent has status done and the plate is cut to 16', () => {
  const done = agentOf({ status: 'done', label: 'a-very-long-agent-label-here' })
  const fig = sceneOf(withAgents(rosterOf(done))).figures[0]
  expect(fig?.status).toBe('done')
  expect(fig?.plate).toBe('a-very-long-agen')
  expect(fig?.plateColor).toBe('#ffb74d')
})

test('the player uses the fixed variant with the plate you, over agents on equal depth, and the cat is drawn', () => {
  const input = withAgents(rosterOf(agentOf({ pose: 'idle' })))
  const spot = input.motion?.main ?? { x: 0, y: 0 }
  const scene = sceneOf({
    ...input,
    player: { ...playerAt({ x: spot.x, y: spot.y }), facing: 'up' },
    cat: { x: 30, y: 4, facing: 'left', frame: 0, path: [], restUntil: 0, seed: 1 },
  })
  const me = scene.figures.find(f => f.player)
  expect(me).toMatchObject({ key: 'player', plate: 'you', sprite: `person${PLAYER_VARIANT}-up`, remote: false })
  expect(scene.figures.find(f => f.key === 'cat')).toMatchObject({ sprite: 'cat-orange-sit', plate: '', facing: 'left' })
  expect(scene.figures.findIndex(f => f.key === 'main') < scene.figures.findIndex(f => f.key === 'player')).toBe(true)
})

test('sceneKey is equal for equal models and differs when a figure moves', () => {
  const input = withAgents(rosterOf(agentOf()))
  expect(sceneKey(sceneOf(input))).toBe(sceneKey(sceneOf(input)))
  const spot = input.motion?.main
  expect(spot === undefined).toBe(false)
  const moved: Motion = { main: { x: (spot?.x ?? 0) + 1, y: spot?.y ?? 0, path: [], frame: 0 } }
  expect(sceneKey(sceneOf({ ...input, motion: moved }))).not.toBe(sceneKey(sceneOf(input)))
  expect(JSON.parse(JSON.stringify(sceneOf(input)))).toEqual(sceneOf(input))
})

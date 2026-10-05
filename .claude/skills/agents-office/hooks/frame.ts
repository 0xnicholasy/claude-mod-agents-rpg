// Pure frame builder: composes the office map, agent sprites, nameplates and
// speech bubbles into one grid of cells. No `$`; register.tsx reads the atoms
// and passes plain data in.
import type { Roster } from './agents'
import { canStand, FOOTPRINT_W, roomAt, tileAt } from './map'
import type { OfficeMap, Point, RoomKind, TileKind } from './map'
import { isValidGlyph } from './raster'
import type { Cell } from './raster'
import { drawnFacing, drawnFrame, drawnPose, targetOf } from './motion'
import { figure, nameplate } from './sprites'
import type { Facing, Pose } from './sprites'
import type { Player } from './player'

export type Motion = Record<string, { x: number; y: number; path: Point[]; frame: number }>
export type Bubble = { agentId: string; text: string; until: number }

// Colors of the office itself. frame.test.ts counts the color pairs of a full frame
// against PAIR_BUDGET (D7).
export const FLOOR_BG = 0x2b303b
export const WALL_COLOR = 0x5c6370
export const DOOR_BG = 0x8a6d46
export const SIGN_FG = 0xffe082
export const SIGN_BG = 0x3b4252
export const BUBBLE_FG = 0x202028
export const BUBBLE_BG = 0xfff8e1

// The player draws a walking pose for this long after a move.
const PLAYER_WALK_MS = 300

// One floor color per room kind (D10); the corridor keeps FLOOR_BG, which is also the team floor.
export const ROOM_FLOORS: Readonly<Record<RoomKind, number>> = Object.freeze({
  team: FLOOR_BG,
  reception: 0x3a3430,
  conference: 0x2b3a3a,
  kitchen: 0x3a3a2b,
  lab: 0x2b2f45,
  booths: 0x3a2b3a,
})

export const OFFICE_PALETTE: readonly number[] = Object.freeze([
  ...new Set([FLOOR_BG, WALL_COLOR, DOOR_BG, SIGN_FG, SIGN_BG, BUBBLE_FG, BUBBLE_BG, ...Object.values(ROOM_FLOORS)]),
])

// Floor color of every tile: a room's interior takes its kind's color, anything else FLOOR_BG.
const floorColors = (map: OfficeMap): number[][] => {
  const colors = map.tiles.map(row => row.map(() => FLOOR_BG))
  for (const room of map.rooms) {
    const { x, y, w, h } = room.bounds
    for (let dy = 0; dy < h; dy++) colors[y + dy]?.fill(ROOM_FLOORS[room.kind], x, x + w)
  }

  return colors
}

const baseCell = (kind: TileKind | undefined, floor: number): Cell => {
  switch (kind) {
    case 'wall':
    case undefined:
      return { ch: 0x2588, fg: WALL_COLOR, bg: WALL_COLOR }
    case 'door':
      return { ch: 0x20, fg: DOOR_BG, bg: DOOR_BG }
    case 'sign':
      return { ch: 0x20, fg: SIGN_FG, bg: SIGN_BG }
    case 'floor':
      return { ch: 0x20, fg: floor, bg: floor }
  }
}

// Text as cells; a glyph the Raster would refuse becomes '?'.
const textCells = (text: string, fg: number, bg: number): Cell[] =>
  Array.from(text, ch => {
    const code = ch.codePointAt(0) ?? 0x3f
    return { ch: isValidGlyph(code) ? code : 0x3f, fg, bg }
  })

// Writes a cell when (x, y) is inside the grid; everything else is clipped.
const put = (grid: Cell[][], x: number, y: number, cell: Cell): void => {
  const row = grid[y]
  if (row === undefined || x < 0 || x >= row.length) return
  row[x] = cell
}

type Plate = { id: string; left: number; y: number; cells: Cell[]; center: number }

// Nameplate policy (D27): each plate is centred on its sprite. Where two plates
// on one row want the same cell, the plate whose sprite is nearer keeps it (a
// tie goes to the left one), so desks on a 4-cell pitch show clipped labels.
const claimPlateCells = (plates: Plate[]): Map<string, string> => {
  const owners = new Map<string, string>()
  const best = new Map<string, number>()
  for (const plate of plates) {
    plate.cells.forEach((_, i) => {
      const x = plate.left + i
      const key = `${x},${plate.y}`
      const distance = Math.abs(plate.center - x)
      const current = best.get(key)
      if (current === undefined || distance < current) {
        best.set(key, distance)
        owners.set(key, plate.id)
      }
    })
  }

  return owners
}

// A plate stays on the floor run of its row that holds the sprite's centre: it shifts to
// fit and is cut at the run's end when wider. No floor at the centre (a wall, door or sign
// row) draws no plate, so a plate never covers a wall, sign or door.
const fitPlate = (map: OfficeMap, center: number, y: number, cells: Cell[]): { left: number; cells: Cell[] } | undefined => {
  if (tileAt(map, center, y) !== 'floor') return undefined
  let lo = center
  let hi = center
  while (tileAt(map, lo - 1, y) === 'floor') lo--
  while (tileAt(map, hi + 1, y) === 'floor') hi++
  const fitted = cells.slice(0, hi - lo + 1)
  const natural = center - Math.floor(fitted.length / 2)
  return { left: Math.min(Math.max(natural, lo), hi - fitted.length + 1), cells: fitted }
}

// Another session's player (T19): already placed on this map, drawn with the white shirt and the room's plate.
export type RemotePlayer = {
  id: string
  x: number
  y: number
  facing: Facing
  label: string
  emote?: string
  until?: number
}

export type FrameInput = {
  map: OfficeMap
  agents: Roster
  motion: Motion
  bubbles: readonly Bubble[]
  // Bubbles with `until <= now` are not drawn.
  now: number
  // The player avatar, drawn over every agent with the plate "you" (D14).
  player?: Player | null
  // The other sessions' players (T19), drawn under the own player.
  others?: readonly RemotePlayer[]
  // Inspect text drawn over the corridor's first row, for panes with no strip rows (D39).
  overlay?: string
  // The columns the overlay may use when the view is cropped (camera.ts overlaySpan); default the whole corridor.
  overlayFrom?: number
  overlayWidth?: number
}

export const buildFrame = ({ map, agents, motion, bubbles, now, player, others, overlay, overlayFrom, overlayWidth }: FrameInput): Cell[][] => {
  const floors = floorColors(map)
  const grid = map.tiles.map((row, y) => row.map((kind, x) => baseCell(kind, floors[y]?.[x] ?? FLOOR_BG)))
  for (const room of map.rooms) {
    // One glyph per code point (cells are per code point); a glyph the raster refuses draws as ?.
    const glyphs = Array.from(room.sign.text, g => g.codePointAt(0))
    room.sign.cells.forEach((p, i) => {
      const code = glyphs[i]
      if (code !== undefined) put(grid, p.x, p.y, { ch: isValidGlyph(code) ? code : 0x3f, fg: SIGN_FG, bg: SIGN_BG })
    })
  }

  // Floor colors come from this copy, so an overlapping figure never reads another figure's cell as floor.
  const base = grid.map(row => row.slice())

  // Back to front: a sprite lower on the screen draws over one above it.
  const placed = Object.values(agents)
    .flatMap(agent => {
      const at = motion[agent.id]
      return at === undefined ? [] : [{ agent, at }]
    })
    .sort((a, b) => a.at.y - b.at.y || a.at.x - b.at.x)

  const plates: Plate[] = []
  for (const { agent, at } of placed) {
    const pose = drawnPose(agent, at)
    // `.` pixels take the floor under the figure's top-left cell (D5).
    const floor = base[at.y]?.[at.x]?.bg ?? FLOOR_BG
    figure({
      pose,
      facing: drawnFacing(at),
      frame: drawnFrame(pose, at, now),
      shirt: agent.tier,
      // A roster entry from before roles existed has none: main was the lead, everyone else a dev.
      role: agent.role ?? (agent.id === 'main' ? 'lead' : 'dev'),
      key: agent.id,
      floor,
    }).forEach((row, dy) =>
      row.forEach((cell, dx) => {
        const x = at.x + dx
        const y = at.y + dy
        if (grid[y]?.[x] !== undefined) put(grid, x, y, cell)
      }),
    )
    const center = at.x + Math.floor(FOOTPRINT_W / 2)
    const fit = fitPlate(map, center, at.y - 1, nameplate(agent.label))
    if (fit !== undefined) plates.push({ id: agent.id, left: fit.left, y: at.y - 1, cells: fit.cells, center })
  }

  for (const other of [...(others ?? [])].sort((a, b) => a.y - b.y || a.x - b.x)) {
    figure({
      pose: 'idle',
      facing: other.facing,
      frame: 0,
      shirt: 'player',
      role: 'lead',
      key: `player:${other.id}`,
      floor: base[other.y]?.[other.x]?.bg ?? FLOOR_BG,
    }).forEach((row, dy) =>
      row.forEach((cell, dx) => {
        if (grid[other.y + dy]?.[other.x + dx] !== undefined) put(grid, other.x + dx, other.y + dy, cell)
      }),
    )
    const center = other.x + Math.floor(FOOTPRINT_W / 2)
    const fit = fitPlate(map, center, other.y - 1, nameplate(other.label))
    if (fit !== undefined) plates.push({ id: `player:${other.id}`, left: fit.left, y: other.y - 1, cells: fit.cells, center })
  }

  if (player !== undefined && player !== null) {
    const walking = player.movedAt !== undefined && now - player.movedAt < PLAYER_WALK_MS
    const pose: Pose = walking ? 'walk' : 'idle'
    figure({
      pose,
      facing: player.facing,
      frame: walking ? player.frame % 4 : 0,
      shirt: 'player',
      role: 'lead',
      key: 'player',
      floor: base[player.y]?.[player.x]?.bg ?? FLOOR_BG,
    }).forEach((row, dy) =>
      row.forEach((cell, dx) => {
        if (grid[player.y + dy]?.[player.x + dx] !== undefined) put(grid, player.x + dx, player.y + dy, cell)
      }),
    )
    const center = player.x + Math.floor(FOOTPRINT_W / 2)
    const fit = fitPlate(map, center, player.y - 1, nameplate('you'))
    // First in the list, so a tie with a neighbouring agent's plate goes to the player's.
    if (fit !== undefined) plates.unshift({ id: 'player', left: fit.left, y: player.y - 1, cells: fit.cells, center })
  }

  const owners = claimPlateCells(plates)
  for (const plate of plates) {
    plate.cells.forEach((cell, i) => {
      const x = plate.left + i
      if (owners.get(`${x},${plate.y}`) === plate.id) put(grid, x, plate.y, cell)
    })
  }

  // Bubble row sits above the nameplate; the latest-expiring active bubble wins.
  for (const { agent, at } of placed) {
    const active = bubbles
      .filter(b => b.agentId === agent.id && b.until > now)
      .sort((a, b) => b.until - a.until)[0]
    if (active === undefined) continue
    const cells = textCells(active.text, BUBBLE_FG, BUBBLE_BG)
    const left = at.x + Math.floor(FOOTPRINT_W / 2) - Math.floor(cells.length / 2)
    cells.forEach((cell, i) => put(grid, left + i, at.y - 2, cell))
  }

  // An emote shows on the bubble row above the player's plate until `until` (D15).
  if (player !== undefined && player !== null && player.emote !== undefined && (player.until ?? 0) > now) {
    const code = player.emote.codePointAt(0) ?? 0x2a
    put(grid, player.x + Math.floor(FOOTPRINT_W / 2), player.y - 2, {
      ch: isValidGlyph(code) ? code : 0x2a,
      fg: BUBBLE_FG,
      bg: BUBBLE_BG,
    })
  }

  for (const other of others ?? []) {
    if (other.emote === undefined || (other.until ?? 0) <= now) continue
    const code = other.emote.codePointAt(0) ?? 0x2a
    put(grid, other.x + Math.floor(FOOTPRINT_W / 2), other.y - 2, { ch: isValidGlyph(code) ? code : 0x2a, fg: BUBBLE_FG, bg: BUBBLE_BG })
  }

  // Inspect text (D39): one row over the corridor, cut to the corridor's width, on top of everything.
  if (overlay !== undefined && overlay !== '') {
    const { x, y, w } = map.corridor
    textCells(overlay, BUBBLE_FG, BUBBLE_BG)
      .slice(0, overlayWidth ?? w)
      .forEach((cell, i) => put(grid, (overlayFrom ?? x) + i, y, cell))
  }

  return grid
}

const sameCell = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y

// Seats every roster agent without a motion entry at the first unoccupied
// anchor of its room and drops entries of agents that left. Returns the same
// reference when nothing changed so callers can skip the state write.
export const placeMotion = (map: OfficeMap, agents: Roster, motion: Motion): Motion => {
  let next = motion
  for (const id of Object.keys(motion)) {
    const entry = motion[id]
    // An entry that is off the map or not standable, or whose path is (after a resize), is dropped and reseated
    // at an anchor below: the one allowed move that does not walk (D31, D34).
    const stale =
      entry !== undefined &&
      (!canStand(map, entry.x, entry.y) || entry.path.some(p => !canStand(map, p.x, p.y)))
    // A resting agent of a team room that stands outside that room, because the layout reflowed when a session
    // joined or left, is reseated too (D31).
    const home = agents[id]
    // An agent resting in a shared room is not displaced: it is routed home and walks.
    const where = entry === undefined ? undefined : roomAt(map, entry.x, entry.y)
    const displaced =
      entry !== undefined &&
      home !== undefined &&
      entry.path.length === 0 &&
      home.room.startsWith('team:') &&
      (where === undefined || (where.startsWith('team:') && where !== home.room))
    if (home !== undefined && !stale && !displaced) continue
    if (next === motion) next = { ...motion }
    delete next[id]
  }
  for (const agent of Object.values(agents)) {
    if (next[agent.id] !== undefined) continue
    const room = map.rooms.find(r => r.id === agent.room)
    if (room === undefined) continue
    const taken = Object.values(next).map(targetOf)
    const spot = room.anchors.find(a => !taken.some(t => sameCell(t, a))) ?? room.anchors[0]
    if (spot === undefined) continue
    if (next === motion) next = { ...motion }
    next[agent.id] = { x: spot.x, y: spot.y, path: [], frame: 0 }
  }

  return next
}

// Pure frame builder: composes the office map, agent sprites, nameplates and
// speech bubbles into one grid of cells. No `$`; register.tsx reads the atoms
// and passes plain data in.
import type { Roster } from './agents'
import { canStand, FOOTPRINT_W, tileAt } from './map'
import type { OfficeMap, Point, TileKind } from './map'
import { DEFAULT_COLOR, isValidGlyph } from './raster'
import type { Cell } from './raster'
import { drawnFrame, drawnPose, targetOf } from './motion'
import { isTransparent, nameplate, sprite } from './sprites'

export type Motion = Record<string, { x: number; y: number; path: Point[]; frame: number }>
export type Bubble = { agentId: string; text: string; until: number }

// Colors of the office itself. With SPRITE_PALETTE (14) they stay under the
// 32-color budget of D6; frame.test.ts counts the colors of a full frame.
export const FLOOR_BG = 0x2b303b
export const WALL_COLOR = 0x5c6370
export const DOOR_BG = 0x8a6d46
export const SIGN_FG = 0xffe082
export const SIGN_BG = 0x3b4252
export const BUBBLE_FG = 0x202028
export const BUBBLE_BG = 0xfff8e1

export const OFFICE_PALETTE: readonly number[] = Object.freeze([
  FLOOR_BG, WALL_COLOR, DOOR_BG, SIGN_FG, SIGN_BG, BUBBLE_FG, BUBBLE_BG,
])

const FLOOR_CELL: Readonly<Cell> = Object.freeze({ ch: 0x20, fg: FLOOR_BG, bg: FLOOR_BG })

const baseCell = (kind: TileKind | undefined): Cell => {
  switch (kind) {
    case 'wall':
    case undefined:
      return { ch: 0x2588, fg: WALL_COLOR, bg: WALL_COLOR }
    case 'door':
      return { ch: 0x20, fg: DOOR_BG, bg: DOOR_BG }
    case 'sign':
      return { ch: 0x20, fg: SIGN_FG, bg: SIGN_BG }
    case 'floor':
      return { ...FLOOR_CELL }
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

// Sprite cell over the floor (D28): DEFAULT_COLOR bg keeps the floor bg,
// TRANSPARENT keeps the whole floor cell.
const overlay = (floor: Cell, over: Cell): Cell =>
  isTransparent(over)
    ? floor
    : { ch: over.ch, fg: over.fg, bg: over.bg === DEFAULT_COLOR ? floor.bg : over.bg }

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

export type FrameInput = {
  map: OfficeMap
  agents: Roster
  motion: Motion
  bubbles: readonly Bubble[]
  // Bubbles with `until <= now` are not drawn.
  now: number
}

export const buildFrame = ({ map, agents, motion, bubbles, now }: FrameInput): Cell[][] => {
  const grid = map.tiles.map(row => row.map(kind => baseCell(kind)))
  for (const room of map.rooms) {
    room.sign.cells.forEach((p, i) => {
      const ch = room.sign.text.codePointAt(i)
      if (ch !== undefined) put(grid, p.x, p.y, { ch, fg: SIGN_FG, bg: SIGN_BG })
    })
  }

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
    sprite(pose, drawnFrame(pose, at, now), agent.tier).forEach((row, dy) =>
      row.forEach((over, dx) => {
        const x = at.x + dx
        const y = at.y + dy
        const floor = grid[y]?.[x]
        if (floor !== undefined) put(grid, x, y, overlay(floor, over))
      }),
    )
    const center = at.x + Math.floor(FOOTPRINT_W / 2)
    const fit = fitPlate(map, center, at.y - 1, nameplate(agent.label))
    if (fit !== undefined) plates.push({ id: agent.id, left: fit.left, y: at.y - 1, cells: fit.cells, center })
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
    if (agents[id] !== undefined && !stale) continue
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

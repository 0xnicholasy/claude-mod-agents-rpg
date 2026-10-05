// Pure frame builder: composes the office map, agent sprites, nameplates and
// speech bubbles into one grid of cells. No `$`; register.tsx reads the atoms
// and passes plain data in.
import type { Roster } from './agents'
import { canStand, MID_FOOT, roomAt, tileAt } from './map'
import type { OfficeMap, Point, Rect, RoomKind, TileKind } from './map'
import { isValidGlyph } from './raster'
import type { Cell } from './raster'
import { drawnFacing, drawnFrame, drawnPose, targetOf } from './motion'
import { figure, midFigure, nameplate } from './sprites'
import type { Facing, FigureOpts, Pose } from './sprites'
import type { Player } from './player'
import { catArt } from './cat'
import type { Cat } from './cat'

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

// Night runs from 20:00 to 06:00 local time and darkens the map colors by 35% (D24).
export const NIGHT_FROM = 20
export const NIGHT_TO = 6
const NIGHT_KEEP = 0.65

export const isNight = (hour: number): boolean => hour >= NIGHT_FROM || hour < NIGHT_TO

// A map color at `hour`: unchanged by day, 35% darker per channel at night.
export const tint = (color: number, hour: number): number => {
  if (!isNight(hour)) return color
  const dim = (shift: number): number => Math.round(((color >> shift) & 0xff) * NIGHT_KEEP) << shift

  return dim(16) | dim(8) | dim(0)
}

// The local hour of a clock reading, 0-23.
export const hourOf = (now: number): number => new Date(now).getHours()

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
const floorColors = (map: OfficeMap, shade: Shade): number[][] => {
  const colors = map.tiles.map(row => row.map(() => shade(FLOOR_BG)))
  for (const room of map.rooms) {
    const { x, y, w, h } = room.bounds
    for (let dy = 0; dy < h; dy++) colors[y + dy]?.fill(shade(ROOM_FLOORS[room.kind]), x, x + w)
  }

  return colors
}

type Shade = (color: number) => number

const baseCell = (kind: TileKind | undefined, floor: number, shade: Shade): Cell => {
  switch (kind) {
    case 'wall':
    case undefined:
      return { ch: 0x2588, fg: shade(WALL_COLOR), bg: shade(WALL_COLOR) }
    case 'door':
      return { ch: 0x20, fg: shade(DOOR_BG), bg: shade(DOOR_BG) }
    case 'sign':
      return { ch: 0x20, fg: shade(SIGN_FG), bg: shade(SIGN_BG) }
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
// A mid map draws the 5x5 (standing) or 8x5 (seated) figure, any other map the 3x2 one (D54, D57).
const isMidMap = (map: OfficeMap): boolean => map.foot.w === MID_FOOT.w && map.foot.h === MID_FOOT.h

const MID_PLATE_WIDTH = 7

const artFor = (map: OfficeMap, opts: FigureOpts): Cell[][] => (isMidMap(map) ? midFigure(opts) : figure(opts))

const plateFor = (map: OfficeMap, text: string): Cell[] => (isMidMap(map) ? nameplate(text, MID_PLATE_WIDTH) : nameplate(text))

const put = (grid: Cell[][], x: number, y: number, cell: Cell): void => {
  const row = grid[y]
  if (row === undefined || x < 0 || x >= row.length) return
  row[x] = cell
}

// D48: a bubble never covers a sign, wall or door. It sits on the row above the plate when that row is floor under
// the speaker's centre; otherwise it takes the plate row for as long as it shows. Cells over any other tile are
// skipped. `cx` is the speaker's centre column, `y` its top row.
const putBubble = (grid: Cell[][], map: OfficeMap, cx: number, y: number, left: number, cells: Cell[]): void => {
  const row = tileAt(map, cx, y - 2) === 'floor' ? y - 2 : y - 1
  cells.forEach((cell, i) => {
    if (tileAt(map, left + i, row) === 'floor') put(grid, left + i, row, cell)
  })
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
  emoteUntil?: number
  chat?: string
  chatUntil?: number
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
  // The map row the overlay goes on when the view is cropped (camera.ts overlaySpan); default the corridor's first row.
  overlayRow?: number
  // The cells the pad Input covers (player.ts padRectAt). A sign that starts under it is drawn one cell right when the
  // tile past its end is floor, so its first letter stays readable.
  pad?: Rect
  // The office cat (D24), drawn over the agents and under the players.
  cat?: Cat | null
  // Local hour 0-23; the map is tinted at night (D24). Undefined draws by day.
  hour?: number
}

export const buildFrame = ({ map, agents, motion, bubbles, now, player, others, cat, hour, overlay, overlayFrom, overlayWidth, overlayRow, pad }: FrameInput): Cell[][] => {
  const shade: Shade = color => (hour === undefined ? color : tint(color, hour))
  const floors = floorColors(map, shade)
  const grid = map.tiles.map((row, y) => row.map((kind, x) => baseCell(kind, floors[y]?.[x] ?? shade(FLOOR_BG), shade)))
  for (const room of map.rooms) {
    // One glyph per code point (cells are per code point); a glyph the raster refuses draws as ?.
    const glyphs = Array.from(room.sign.text, g => g.codePointAt(0))
    const first = room.sign.cells[0]
    const last = room.sign.cells[room.sign.cells.length - 1]
    const covered =
      pad !== undefined &&
      first !== undefined &&
      first.y >= pad.y &&
      first.y < pad.y + pad.h &&
      first.x >= pad.x &&
      first.x < pad.x + pad.w
    // Move the sign just past the pad's right edge, and only when that many floor cells follow its end.
    const need = covered && pad !== undefined && first !== undefined ? pad.x + pad.w - first.x : 0
    const fits = last !== undefined && Array.from({ length: need }, (_, k) => tileAt(map, last.x + 1 + k, last.y)).every(t => t === 'floor')
    const shift = fits ? need : 0
    room.sign.cells.forEach((p, i) => {
      const code = glyphs[i]
      if (code !== undefined) put(grid, p.x + shift, p.y, { ch: isValidGlyph(code) ? code : 0x3f, fg: shade(SIGN_FG), bg: shade(SIGN_BG) })
    })
  }

  // Floor colors come from this copy, so an overlapping figure never reads another figure's cell as floor.
  const base = grid.map(row => row.slice())

  // The cat is drawn first, so agents and players stand over it and never vanish behind it; it has no plate.
  if (cat !== undefined && cat !== null) {
    catArt(cat, base[cat.y]?.[cat.x]?.bg ?? shade(FLOOR_BG)).forEach((row, dy) =>
      row.forEach((cell, dx) => {
        if (grid[cat.y + dy]?.[cat.x + dx] !== undefined) put(grid, cat.x + dx, cat.y + dy, cell)
      }),
    )
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
    // `.` pixels take the floor under the figure's top-left cell (D5).
    const floor = base[at.y]?.[at.x]?.bg ?? FLOOR_BG
    artFor(map, {
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
    const center = at.x + Math.floor(map.foot.w / 2)
    const fit = fitPlate(map, center, at.y - 1, plateFor(map, agent.label))
    if (fit !== undefined) plates.push({ id: agent.id, left: fit.left, y: at.y - 1, cells: fit.cells, center })
  }

  for (const other of [...(others ?? [])].sort((a, b) => a.y - b.y || a.x - b.x)) {
    artFor(map, {
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
    const center = other.x + Math.floor(map.foot.w / 2)
    const fit = fitPlate(map, center, other.y - 1, plateFor(map, other.label))
    if (fit !== undefined) plates.push({ id: `player:${other.id}`, left: fit.left, y: other.y - 1, cells: fit.cells, center })
  }

  if (player !== undefined && player !== null) {
    const walking = player.movedAt !== undefined && now - player.movedAt < PLAYER_WALK_MS
    const pose: Pose = walking ? 'walk' : 'idle'
    artFor(map, {
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
    const center = player.x + Math.floor(map.foot.w / 2)
    const fit = fitPlate(map, center, player.y - 1, plateFor(map, 'you'))
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

  // Bubble row sits above the nameplate, or on the plate row where that row is not floor (D48); the latest-expiring active bubble wins.
  for (const { agent, at } of placed) {
    const active = bubbles
      .filter(b => b.agentId === agent.id && b.until > now)
      .sort((a, b) => b.until - a.until)[0]
    if (active === undefined) continue
    const cells = textCells(active.text, BUBBLE_FG, BUBBLE_BG)
    const left = at.x + Math.floor(map.foot.w / 2) - Math.floor(cells.length / 2)
    putBubble(grid, map, at.x + Math.floor(map.foot.w / 2), at.y, left, cells)
  }

  // An emote shows on the bubble row above the player's plate until `until` (D15).
  if (player !== undefined && player !== null && player.emote !== undefined && (player.emoteUntil ?? 0) > now) {
    const code = player.emote.codePointAt(0) ?? 0x2a
    const cx = player.x + Math.floor(map.foot.w / 2)
    putBubble(grid, map, cx, player.y, cx, [{ ch: isValidGlyph(code) ? code : 0x2a, fg: BUBBLE_FG, bg: BUBBLE_BG }])
  }

  for (const other of others ?? []) {
    if (other.emote === undefined || (other.emoteUntil ?? 0) <= now) continue
    const code = other.emote.codePointAt(0) ?? 0x2a
    const cx = other.x + Math.floor(map.foot.w / 2)
    putBubble(grid, map, cx, other.y, cx, [{ ch: isValidGlyph(code) ? code : 0x2a, fg: BUBBLE_FG, bg: BUBBLE_BG }])
  }

  // Chat bubbles (D23) sit on the same row as an emote and win over it; the text stays inside the map.
  const speakers: Array<{ x: number; y: number; chat?: string; chatUntil?: number }> = [...(others ?? [])]
  if (player !== undefined && player !== null) speakers.push(player)
  for (const speaker of speakers) {
    if (speaker.chat === undefined || (speaker.chatUntil ?? 0) <= now) continue
    const cells = textCells(speaker.chat, BUBBLE_FG, BUBBLE_BG)
    const left = Math.max(0, Math.min(map.columns - cells.length, speaker.x + Math.floor(map.foot.w / 2) - Math.floor(cells.length / 2)))
    putBubble(grid, map, speaker.x + Math.floor(map.foot.w / 2), speaker.y, left, cells)
  }

  // Inspect text (D39): one row over the corridor, cut to the corridor's width, on top of everything.
  if (overlay !== undefined && overlay !== '') {
    const { x, y: corridorY, w } = map.corridor
    const y = overlayRow ?? corridorY
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

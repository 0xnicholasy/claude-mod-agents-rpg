// Tile map of the office: one tile is one terminal cell. Pure data and
// geometry, no `$`. A character occupies a 3x2 footprint whose top-left cell
// is its position; its nameplate is drawn on the row above (frame.ts keeps it
// on that row's floor). Full layout from 18 rows (x right, y down); heights 11-17 use the
// compact bands below, and a 3-row room puts its sign on the wall row above:
//
//   top row      one team room per session, equal widths (D10)
//   corridor     2-3 rows
//   bottom row   5 rooms  Reception | Conference | Kitchen | Test Lab | Booths
//
// At 11 rows the map has no outer bottom wall; the pane edge closes the bottom rooms.
// Larger sizes stretch room widths, then heights; walls stay one cell.

// A team room is `team:<session id>` (D12).
export type RoomId = 'reception' | 'conference' | 'kitchen' | 'lab' | 'booths' | `team:${string}`
// Floor-color kind of a room: one color per kind (D10).
export type RoomKind = 'team' | 'reception' | 'conference' | 'kitchen' | 'lab' | 'booths'
export type TileKind = 'floor' | 'wall' | 'door' | 'sign'
export type Point = { x: number; y: number }
export type Rect = { x: number; y: number; w: number; h: number }
export type Room = {
  id: RoomId
  name: string
  kind: RoomKind
  // Interior rectangle (walls excluded), so rooms never overlap.
  bounds: Rect
  // Room label drawn on the top interior row (the wall row above in a 3-row
  // room); `cells` are its tile positions.
  sign: { text: string; cells: Point[] }
  // The three door cells in the wall row, left to right.
  door: Point[]
  // Footprint top-left just inside the door.
  doorStand: Point
  // Footprint top-left positions, left to right, one row of desks.
  anchors: Point[]
}
export type OfficeMap = {
  columns: number
  rows: number
  tiles: TileKind[][]
  rooms: Room[]
  corridor: Rect
  // Teams left out because they do not fit at the minimum room width (D21).
  hidden: number
}
export type TeamSpec = { id: `team:${string}`; label: string }

export const MIN_COLUMNS = 60
export const MIN_ROWS = 11
// Height of the full layout; taller maps stretch it.
export const FULL_ROWS = 18
export const FOOTPRINT_W = 3
export const FOOTPRINT_H = 2

export class OfficeTooSmall extends Error {
  constructor(columns: number, rows: number) {
    super(`Office needs at least ${MIN_COLUMNS}x${MIN_ROWS}, got ${columns}x${rows}`)
    this.name = 'OfficeTooSmall'
  }
}

type Spec = { id: RoomId; name: string; sign: string; width: number; kind: RoomKind }

// Interior rows [top, corridor, bottom] for map heights 11..17; each step adds
// one row, so 18 equals the full layout (5, 3, 6); 11 is 12 without the outer bottom wall.
// Cuts text to `n` code points, so an astral character is never split into a lone surrogate.
export const cut = (text: string, n: number): string => Array.from(text).slice(0, Math.max(0, n)).join('')

const COMPACT_BANDS: ReadonlyArray<readonly [number, number, number]> = [
  [3, 2, 3], // 11: no outer bottom wall
  [3, 2, 3], // 12
  [3, 2, 4], // 13
  [4, 2, 4], // 14
  [4, 3, 4], // 15
  [4, 3, 5], // 16
  [5, 3, 5], // 17
]
const TOP_INTERIOR_ROWS = 5
const BOTTOM_INTERIOR_ROWS = 6
const CORRIDOR_ROWS = 3

// Stretch base widths to fill `total`; the remainder goes to the first room.
const stretch = (specs: Array<{ width: number }>, total: number): number[] => {
  const sum = specs.reduce((n, s) => n + s.width, 0)
  const widths = specs.map(s => Math.floor((s.width * total) / sum))
  widths[0] = (widths[0] ?? 0) + total - widths.reduce((n, w) => n + w, 0)
  return widths
}

type RowBand = { interiorTop: number; interiorRows: number; doorRow: number }

// `pitch` is the distance between desk anchors: the footprint plus the gap. `doorInset` is how far a
// bottom-row door starts from the room's right edge.
const makeRoom = (spec: Spec, x: number, width: number, band: RowBand, doorBelow: boolean, pitch: number, doorInset: number): Room => {
  const { interiorTop, interiorRows, doorRow } = band
  const gap = pitch - FOOTPRINT_W
  const count = Math.max(1, Math.floor((width + gap) / pitch))
  const offset = Math.floor((width - (pitch * count - gap)) / 2)
  // Rooms with fewer than FOOTPRINT_H + 2 interior rows put the sign on the wall
  // row above so the interior's first row stays free for the nameplate.
  const roomy = interiorRows >= FOOTPRINT_H + 2
  const signY = roomy ? interiorTop : interiorTop - 1
  const allAnchors = Array.from({ length: count }, (_, i) => ({
    x: x + offset + pitch * i,
    y: interiorTop + (roomy ? 2 : 1),
  }))
  // Top-row rooms centre the door; bottom-row rooms put it at the right so the
  // doorStand footprint never stands on the left-aligned sign.
  const doorX = doorBelow ? x + Math.floor((width - FOOTPRINT_W) / 2) : x + width - doorInset
  const doorStandY = doorBelow ? interiorTop + interiorRows - FOOTPRINT_H : interiorTop
  // In a bottom room the doorStand is on the top interior rows, where short rooms also
  // seat their desks, so a desk overlapping it is dropped. Top rooms keep every desk: their
  // centred stand sits among the desks by design and dropping them would empty the Phone Booths.
  const anchors = doorBelow
    ? allAnchors
    : allAnchors.filter(a => Math.abs(a.x - doorX) >= FOOTPRINT_W || Math.abs(a.y - doorStandY) >= FOOTPRINT_H)
  // A bottom room's sign shares its row with the door (wall row) or the doorStand (interior row), so it is
  // cut before them.
  const sign = doorBelow ? cut(spec.sign, width) : cut(spec.sign, doorX - x)
  return {
    id: spec.id,
    name: spec.name,
    kind: spec.kind,
    bounds: { x, y: interiorTop, w: width, h: interiorRows },
    sign: { text: sign, cells: Array.from(sign, (_, i) => ({ x: x + i, y: signY })) },
    door: [0, 1, 2].map(i => ({ x: doorX + i, y: doorRow })),
    doorStand: { x: doorX, y: doorStandY },
    anchors,
  }
}

// Interior rows of the three bands for a map of `rows` rows (at least MIN_ROWS).
const rowBands = (rows: number): { topRows: number; corridorRows: number; bottomRows: number } => {
  if (rows < FULL_ROWS) {
    const bands = COMPACT_BANDS[rows - MIN_ROWS]
    if (!bands) throw new Error(`map: no compact bands for ${rows} rows`)
    return { topRows: bands[0], corridorRows: bands[1], bottomRows: bands[2] }
  }
  const extra = rows - FULL_ROWS
  const rest = extra - Math.floor(extra / 3)
  return {
    topRows: TOP_INTERIOR_ROWS + Math.floor(rest / 2),
    corridorRows: CORRIDOR_ROWS + Math.floor(extra / 3),
    bottomRows: BOTTOM_INTERIOR_ROWS + rest - Math.floor(rest / 2),
  }
}

const paintTiles = (columns: number, rows: number, corridor: Rect, rooms: Room[]): TileKind[][] => {
  const tiles: TileKind[][] = Array.from({ length: rows }, () => Array<TileKind>(columns).fill('wall'))
  const set = (p: Point, kind: TileKind): void => {
    const row = tiles[p.y]
    if (!row || p.x < 0 || p.x >= columns) throw new Error(`map: tile (${p.x},${p.y}) is outside ${columns}x${rows}`)
    row[p.x] = kind
  }
  const fill = (r: Rect): void => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) set({ x, y }, 'floor')
  }
  fill(corridor)
  for (const room of rooms) {
    fill(room.bounds)
    for (const p of room.door) set(p, 'door')
    for (const p of room.sign.cells) set(p, 'sign')
  }
  return tiles
}

export const tileAt = (map: OfficeMap, x: number, y: number): TileKind | undefined => map.tiles[y]?.[x]

// True when all six footprint cells (x..x+2, y..y+1) are floor or door.
export const canStand = (map: OfficeMap, x: number, y: number): boolean => {
  for (let dy = 0; dy < FOOTPRINT_H; dy++) {
    for (let dx = 0; dx < FOOTPRINT_W; dx++) {
      const kind = tileAt(map, x + dx, y + dy)
      if (kind !== 'floor' && kind !== 'door') return false
    }
  }
  return true
}

// Room whose interior holds the cell; undefined on walls, doors and corridor.
export const roomAt = (map: OfficeMap, x: number, y: number): RoomId | undefined =>
  map.rooms.find(r => x >= r.bounds.x && x < r.bounds.x + r.bounds.w && y >= r.bounds.y && y < r.bounds.y + r.bounds.h)?.id

// Smallest team-room interior width (D10).
export const TEAM_MIN_WIDTH = 11
// Distance between team-room desk anchors (D10).
const TEAM_PITCH = 5

// Interior widths at the 60-column minimum (54 interior columns).
const SHARED: Spec[] = [
  { id: 'reception', name: 'Reception', sign: 'Reception', width: 12, kind: 'reception' },
  { id: 'conference', name: 'Conference Room', sign: 'Conference', width: 12, kind: 'conference' },
  { id: 'kitchen', name: 'Kitchen', sign: 'Kitchen', width: 10, kind: 'kitchen' },
  { id: 'lab', name: 'Test Lab', sign: 'Test Lab', width: 10, kind: 'lab' },
  { id: 'booths', name: 'Phone Booths', sign: 'Booths', width: 10, kind: 'booths' },
]

// The teams that get a room: all of them when they fit, else the first ones that fit with the
// own team kept in place of the last one when it would be cut (D21).
const visibleTeams = (teams: TeamSpec[], ownId: string, columns: number): TeamSpec[] => {
  // n rooms need n interiors of TEAM_MIN_WIDTH plus n + 1 walls.
  const fit = Math.max(0, Math.floor((columns - 1) / (TEAM_MIN_WIDTH + 1)))
  if (teams.length <= fit) return teams
  const head = teams.slice(0, fit)
  if (head.some(t => t.id === ownId)) return head
  const own = teams.find(t => t.id === ownId)
  return own && fit > 0 ? [...head.slice(0, fit - 1), own] : head
}

/**
 * Layout of the v2 office: one team room per team in the top band, the five shared rooms in the bottom band
 * (D10). Each team room's first anchor is its lead's desk; look a team's room up by id, since the own team can take the last slot when others are hidden. `teams` must already be in room order.
 */
export const buildOffice = (columns: number, rows: number, teams: TeamSpec[], ownId: string): OfficeMap => {
  if (columns < MIN_COLUMNS || rows < MIN_ROWS) throw new OfficeTooSmall(columns, rows)
  const { topRows, corridorRows, bottomRows } = rowBands(rows)
  const shown = visibleTeams(teams, ownId, columns)

  const topBand: RowBand = { interiorTop: 1, interiorRows: topRows, doorRow: topRows + 1 }
  const corridor: Rect = { x: 1, y: topRows + 2, w: columns - 2, h: corridorRows }
  const bottomWall = corridor.y + corridor.h
  const bottomBand: RowBand = { interiorTop: bottomWall + 1, interiorRows: bottomRows, doorRow: bottomWall }

  const placed: Room[] = []
  // Team rooms have equal widths; the remainder goes to the first room.
  if (shown.length > 0) {
    const total = columns - shown.length - 1
    const base = Math.floor(total / shown.length)
    let x = 1
    shown.forEach((team, i) => {
      const width = i === 0 ? base + total - base * shown.length : base
      const sign = cut(team.label, width)
      const spec: Spec = { id: team.id, name: team.label, sign, width, kind: 'team' }
      placed.push(makeRoom(spec, x, width, topBand, true, TEAM_PITCH, 4))
      x += width + 1
    })
  }
  const widths = stretch(SHARED, columns - SHARED.length - 1)
  let x = 1
  SHARED.forEach((spec, i) => {
    const width = widths[i] ?? spec.width
    placed.push(makeRoom(spec, x, width, bottomBand, false, 4, 3))
    x += width + 1
  })

  return { columns, rows, tiles: paintTiles(columns, rows, corridor, placed), rooms: placed, corridor, hidden: teams.length - shown.length }
}

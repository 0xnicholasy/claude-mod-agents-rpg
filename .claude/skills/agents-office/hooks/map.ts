// Tile map of the office: one tile is one terminal cell. Pure data and
// geometry, no `$`. A character occupies a 3x2 footprint whose top-left cell
// is its position; its nameplate is drawn on the row above (it may overlap
// walls). Layout at the 60x18 minimum (x right, y down):
//
//   top row      4 rooms  Dev Bay | Library | Server Room | Phone Booth
//   corridor     3 rows
//   bottom row   3 rooms  Lobby | Meeting Room | Break Room
//
// Larger sizes stretch room widths, then heights; walls stay one cell.

export type RoomId = 'lobby' | 'devbay' | 'library' | 'server' | 'phone' | 'meeting' | 'break'
export type TileKind = 'floor' | 'wall' | 'door' | 'sign'
export type Point = { x: number; y: number }
export type Rect = { x: number; y: number; w: number; h: number }
export type Room = {
  id: RoomId
  name: string
  // Interior rectangle (walls excluded), so rooms never overlap.
  bounds: Rect
  // Room label drawn on the top interior row; `cells` are its tile positions.
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
}

export const MIN_COLUMNS = 60
export const MIN_ROWS = 18
export const FOOTPRINT_W = 3
export const FOOTPRINT_H = 2

export class OfficeTooSmall extends Error {
  constructor(columns: number, rows: number) {
    super(`Office needs at least ${MIN_COLUMNS}x${MIN_ROWS}, got ${columns}x${rows}`)
    this.name = 'OfficeTooSmall'
  }
}

type Spec = { id: RoomId; name: string; sign: string; width: number }

// Interior widths at the 60-column minimum.
const TOP: Spec[] = [
  { id: 'devbay', name: 'Dev Bay', sign: 'Dev Bay', width: 24 },
  { id: 'library', name: 'Library', sign: 'Library', width: 11 },
  { id: 'server', name: 'Server Room', sign: 'Server Room', width: 11 },
  { id: 'phone', name: 'Phone Booth', sign: 'Phone', width: 9 },
]
const BOTTOM: Spec[] = [
  { id: 'lobby', name: 'Lobby', sign: 'Lobby', width: 18 },
  { id: 'meeting', name: 'Meeting Room', sign: 'Meeting Room', width: 20 },
  { id: 'break', name: 'Break Room', sign: 'Break Room', width: 18 },
]
const TOP_INTERIOR_ROWS = 5
const BOTTOM_INTERIOR_ROWS = 6
const CORRIDOR_ROWS = 3

// Stretch base widths to fill `total`; the remainder goes to the first room.
const stretch = (specs: Spec[], total: number): number[] => {
  const sum = specs.reduce((n, s) => n + s.width, 0)
  const widths = specs.map(s => Math.floor((s.width * total) / sum))
  widths[0] = (widths[0] ?? 0) + total - widths.reduce((n, w) => n + w, 0)
  return widths
}

type RowBand = { interiorTop: number; interiorRows: number; doorRow: number }

const makeRoom = (spec: Spec, x: number, width: number, band: RowBand, doorBelow: boolean): Room => {
  const { interiorTop, interiorRows, doorRow } = band
  const count = Math.floor((width + 1) / 4)
  const offset = Math.floor((width - (4 * count - 1)) / 2)
  const anchors = Array.from({ length: count }, (_, i) => ({ x: x + offset + 4 * i, y: interiorTop + 2 }))
  // Top-row rooms centre the door; bottom-row rooms put it at the right so the
  // doorStand footprint never stands on the left-aligned sign.
  const doorX = doorBelow ? x + Math.floor((width - FOOTPRINT_W) / 2) : x + width - 4
  const doorStandY = doorBelow ? interiorTop + interiorRows - FOOTPRINT_H : interiorTop
  return {
    id: spec.id,
    name: spec.name,
    bounds: { x, y: interiorTop, w: width, h: interiorRows },
    sign: { text: spec.sign, cells: Array.from(spec.sign, (_, i) => ({ x: x + i, y: interiorTop })) },
    door: [0, 1, 2].map(i => ({ x: doorX + i, y: doorRow })),
    doorStand: { x: doorX, y: doorStandY },
    anchors,
  }
}

export const buildMap = (columns: number, rows: number): OfficeMap => {
  if (columns < MIN_COLUMNS || rows < MIN_ROWS) throw new OfficeTooSmall(columns, rows)

  const extra = rows - MIN_ROWS
  const corridorRows = CORRIDOR_ROWS + Math.floor(extra / 3)
  const rest = extra - Math.floor(extra / 3)
  const topRows = TOP_INTERIOR_ROWS + Math.floor(rest / 2)
  const bottomRows = BOTTOM_INTERIOR_ROWS + rest - Math.floor(rest / 2)

  const topBand: RowBand = { interiorTop: 1, interiorRows: topRows, doorRow: topRows + 1 }
  const corridor: Rect = { x: 1, y: topRows + 2, w: columns - 2, h: corridorRows }
  const bottomWall = corridor.y + corridorRows
  const bottomBand: RowBand = { interiorTop: bottomWall + 1, interiorRows: bottomRows, doorRow: bottomWall }

  const placed: Room[] = []
  const lay = (specs: Spec[], total: number, band: RowBand, doorBelow: boolean): void => {
    let x = 1
    const widths = stretch(specs, total)
    specs.forEach((spec, i) => {
      const width = widths[i] ?? spec.width
      placed.push(makeRoom(spec, x, width, band, doorBelow))
      x += width + 1
    })
  }
  lay(TOP, columns - 5, topBand, true)
  lay(BOTTOM, columns - 4, bottomBand, false)

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
  for (const room of placed) {
    fill(room.bounds)
    for (const p of room.door) set(p, 'door')
    for (const p of room.sign.cells) set(p, 'sign')
  }
  return { columns, rows, tiles, rooms: placed, corridor }
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

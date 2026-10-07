// Scene model for the image office (v3 D8, D9, D17): plain JSON data in world pixels that the renderer page
// draws. Pure, no `$`. T07 adds figures to this model.
import { focusOf, viewFor } from './camera'
import { FLOOR_BG, hourOf, isNight, ROOM_FLOORS } from './frame'
import { isMid } from './map'
import type { OfficeMap, Point, Rect, RoomKind } from './map'
import { MID_SEAT_W } from './midArt'
import { CELL_PX, SPRITES } from './sceneArt'
import type { SpriteLayer, SpriteName } from './sceneArt'

// A rectangle in world pixels.
export type SceneRect = { x: number; y: number; w: number; h: number }
export type SceneRoom = SceneRect & { id: string; name: string; kind: RoomKind; floor: number }
// `x`,`y` is the sprite's anchor point in world px: bottom-centre of the sprite for a 'foot' anchor.
export type SceneProp = { sprite: SpriteName; x: number; y: number; layer: SpriteLayer }
export type SceneModel = {
  world: { w: number; h: number }
  rooms: SceneRoom[]
  corridor: SceneRect & { floor: number }
  walls: SceneRect[]
  doors: SceneRect[]
  props: SceneProp[]
  camera: SceneRect
  night: boolean
}
export type SceneInput = {
  map: OfficeMap
  paneColumns: number
  paneRows: number
  // Player's top-left cell, or null/undefined when there is none.
  player?: Point | null
  // Room id the camera falls back to when there is no player.
  ownId: string
  now: number
}

const px = (r: Rect): SceneRect => ({ x: r.x * CELL_PX.w, y: r.y * CELL_PX.h, w: r.w * CELL_PX.w, h: r.h * CELL_PX.h })

// Merges horizontal runs of tiles of the given kinds into rectangles.
const runs = (map: OfficeMap, kinds: readonly string[]): SceneRect[] => {
  const out: SceneRect[] = []
  map.tiles.forEach((row, y) => {
    let start = -1
    for (let x = 0; x <= row.length; x++) {
      const hit = x < row.length && kinds.includes(row[x] ?? '')
      if (hit && start < 0) start = x
      if (!hit && start >= 0) {
        out.push(px({ x: start, y, w: x - start, h: 1 }))
        start = -1
      }
    }
  })

  return out
}

// Fraction positions of shared-room props across the interior width, left to right.
const SHARED: Readonly<Record<Exclude<RoomKind, 'team' | 'booths'>, readonly (readonly [SpriteName, number])[]>> = {
  reception: [['reception-desk', 0.4], ['plant-tall', 0.85]],
  conference: [['conference-table', 0.5], ['whiteboard', 0.85]],
  kitchen: [['fridge', 0.2], ['coffee-machine', 0.5], ['water-cooler', 0.8]],
  lab: [['server-rack', 0.25], ['printer', 0.75]],
}

const propsOf = (map: OfficeMap): SceneProp[] => {
  const props: SceneProp[] = []
  const add = (sprite: SpriteName, x: number, y: number): void => {
    props.push({ sprite, x, y, layer: SPRITES[sprite].layer })
  }
  for (const room of map.rooms) {
    const b = px(room.bounds)
    const floorY = b.y + b.h
    if (room.kind === 'team' || room.kind === 'booths') {
      for (const a of room.anchors) {
        // Mid team desks are laid out for the 8-cell seated figure (map.ts), so centre on that span.
        const span = room.kind === 'team' && isMid(map.foot) ? MID_SEAT_W : map.foot.w
        const cx = (a.x + span / 2) * CELL_PX.w
        if (room.kind === 'team') {
          add('desk-monitor', cx, (a.y + map.foot.h - 1) * CELL_PX.h)
          add('chair', cx, (a.y + map.foot.h) * CELL_PX.h)
        } else {
          add('armchair', cx, (a.y + map.foot.h) * CELL_PX.h)
          add('phone', cx + CELL_PX.w * 2, (a.y + map.foot.h - 1) * CELL_PX.h)
        }
      }
      continue
    }
    for (const [sprite, f] of SHARED[room.kind]) add(sprite, Math.round(b.x + b.w * f), floorY)
  }

  return props
}

export const sceneOf = (input: SceneInput): SceneModel => {
  const { map, paneColumns, paneRows, player, ownId, now } = input
  const view = viewFor(map.columns, map.rows, paneColumns, paneRows, focusOf(map, player, ownId))

  return {
    world: { w: map.columns * CELL_PX.w, h: map.rows * CELL_PX.h },
    rooms: map.rooms.map(r => ({ ...px(r.bounds), id: r.id, name: r.name, kind: r.kind, floor: ROOM_FLOORS[r.kind] })),
    corridor: { ...px(map.corridor), floor: FLOOR_BG },
    walls: runs(map, ['wall', 'sign']),
    doors: runs(map, ['door']),
    props: propsOf(map),
    camera: px({ x: view.x, y: view.y, w: view.width, h: view.height }),
    night: isNight(hourOf(now)),
  }
}

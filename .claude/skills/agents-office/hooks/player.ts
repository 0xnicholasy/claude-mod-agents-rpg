// The player avatar (D13, D14). Pure: register.tsx reads the `player` and `pad` atoms and passes plain data in.
import { canStand, FOOTPRINT_H, FOOTPRINT_W } from './map'
import type { OfficeMap, Point, Rect } from './map'
import type { Dir, Intent } from './pad'
import type { Facing } from './sprites'
import { INTENT_MS } from './timing'

export type Player = {
  x: number
  y: number
  facing: Facing
  // Walk frame, 0-3, advanced by every tile moved.
  frame: number
  // Tiles still to walk; empty for WASD movement (room jumps fill it later).
  path: Point[]
  // When the player last moved a tile, for the walk pose. Undefined until the first move.
  movedAt?: number
  emote?: string
  chat?: string
  until?: number
}

const FACING: Readonly<Record<Dir, Facing>> = { w: 'up', a: 'left', s: 'down', d: 'right' }
const DELTA: Readonly<Record<Dir, Point>> = { w: { x: 0, y: -1 }, a: { x: -1, y: 0 }, s: { x: 0, y: 1 }, d: { x: 1, y: 0 } }

// The two bottom-left columns of the last two map rows: the pad's Input draws its `…` and `⏎` there.
export const padRect = (map: OfficeMap): Rect => ({ x: 0, y: map.rows - 2, w: 2, h: 2 })

const overlaps = (at: Point, rect: Rect): boolean =>
  at.x < rect.x + rect.w && at.x + FOOTPRINT_W > rect.x && at.y < rect.y + rect.h && at.y + FOOTPRINT_H > rect.y

// First free spot, nearest the own team room's door (D14): the doorStand, then the room's anchors, then
// every other room's doorStand. A footprint over the pad's cells is skipped.
export const spawnPlayer = (map: OfficeMap, ownId: string): Player | undefined => {
  const own = map.rooms.find(room => room.id === ownId) ?? map.rooms.find(room => room.id === 'reception')
  const others = map.rooms.filter(room => room !== own).map(room => room.doorStand)
  const pad = padRect(map)
  const spot = [...(own === undefined ? [] : [own.doorStand, ...own.anchors]), ...others].find(
    p => canStand(map, p.x, p.y) && !overlaps(p, pad),
  )

  return spot === undefined ? undefined : { x: spot.x, y: spot.y, facing: 'down', frame: 0, path: [] }
}

export type StepResult = { player: Player | undefined; intent: Intent | undefined }

// One tick (D13). Each tick consumes at most one pending tap, so key repeat never outruns the tick. A tap
// moves exactly one tile even when the tick is late; pending taps older than INTENT_MS are stale and are
// dropped. Walls block via canStand, agents do not. A blocked move still turns the player. A player that can
// no longer stand (a resize) is reseated first (D14).
export const stepPlayer = (
  player: Player,
  map: OfficeMap,
  intent: Intent | undefined,
  now: number,
  ownId: string,
): StepResult => {
  const seated = canStand(map, player.x, player.y) ? player : (spawnPlayer(map, ownId) ?? player)
  if (intent === undefined || intent.taps <= 0) return { player: seated, intent }
  if (now - intent.at > INTENT_MS) return { player: seated, intent: { ...intent, taps: 0 } }
  const used: Intent = { ...intent, taps: intent.taps - 1 }
  const delta = DELTA[intent.key]
  const nx = seated.x + delta.x
  const ny = seated.y + delta.y
  const facing = FACING[intent.key]
  if (!canStand(map, nx, ny)) return { player: { ...seated, facing }, intent: used }

  return { player: { ...seated, x: nx, y: ny, facing, frame: (seated.frame + 1) % 4, movedAt: now }, intent: used }
}

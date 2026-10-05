// The player avatar (D13, D14). Pure: register.tsx reads the `player` and `pad` atoms and passes plain data in.
import { canStand, FOOTPRINT_H, FOOTPRINT_W, roomAt } from './map'
import type { OfficeMap, Point, Rect, Room } from './map'
import { findPath } from './path'
import type { Dir, Intent, PendingEmote } from './pad'
import type { Facing } from './sprites'
import { EMOTE_MS, INTENT_MS } from './timing'

export type Player = {
  x: number
  y: number
  facing: Facing
  // Walk frame, 0-3, advanced by every tile moved.
  frame: number
  // Tiles still to walk: a room jump fills it and any WASD key clears it (D38).
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

const nearestDoor = (rooms: readonly Room[], at: Point): number => {
  let best = 0
  let bestDist = Infinity
  rooms.forEach((room, i) => {
    const dist = Math.abs(room.doorStand.x - at.x) + Math.abs(room.doorStand.y - at.y)
    if (dist < bestDist) {
      best = i
      bestDist = dist
    }
  })

  return best
}

// Canonical room order for jumps (D38): team rooms, then shared rooms, each in map order.
export const jumpOrder = (map: OfficeMap): Room[] => [
  ...map.rooms.filter(room => room.kind === 'team'),
  ...map.rooms.filter(room => room.kind !== 'team'),
]

// First free spot of a room: its first anchor the player can stand on outside the pad's cells, else its doorStand.
const firstSpot = (map: OfficeMap, room: Room): Point => {
  const pad = padRect(map)

  return [...room.anchors, room.doorStand].find(p => canStand(map, p.x, p.y) && !overlaps(p, pad)) ?? room.doorStand
}

// `]` and `[` (D38): sets the path to the first free spot of the next or previous room in canonical order,
// wrapping at the ends. The current room is the one holding the player, else the one with the nearest door.
// Returns the same player when there is nothing to walk to.
export const startJump = (player: Player, map: OfficeMap, dir: 'next' | 'prev'): Player => {
  const rooms = jumpOrder(map)
  if (rooms.length === 0) return player
  const here = roomAt(map, player.x, player.y)
  const found = rooms.findIndex(room => room.id === here)
  const from = found >= 0 ? found : nearestDoor(rooms, player)
  const target = rooms[(from + (dir === 'next' ? 1 : rooms.length - 1)) % rooms.length]
  if (target === undefined) return player
  const path = findPath(map, player, firstSpot(map, target))

  return { ...player, path }
}

// One tick (D13, D35, D38). Each tick consumes at most one pending tap, so key repeat never outruns the tick. A
// tap moves exactly one tile even when the tick is late. A pending tap is stale once INTENT_MS has passed
// without a press or a consumed tap, and is then dropped: every consumed tap refreshes `at`, so the tail of a
// burst (one tap per tick) is not dropped while it drains. A fresh WASD tap clears a room-jump path; without
// one the path advances a single tile. Walls block via canStand, agents do not. A blocked move still turns the
// player. A player that can no longer stand (a resize) is reseated first (D14).
export const stepPlayer = (
  player: Player,
  map: OfficeMap,
  intent: Intent | undefined,
  now: number,
  ownId: string,
): StepResult => {
  const seated = canStand(map, player.x, player.y) ? player : (spawnPlayer(map, ownId) ?? player)
  const pending = intent !== undefined && intent.taps > 0
  if (pending && now - intent.at > INTENT_MS) return stepPath(seated, map, { ...intent, taps: 0 }, now)
  if (!pending) return stepPath(seated, map, intent, now)
  const used: Intent = { ...intent, taps: intent.taps - 1, at: now }
  const delta = DELTA[intent.key]
  const walker: Player = seated.path.length === 0 ? seated : { ...seated, path: [] }
  const nx = walker.x + delta.x
  const ny = walker.y + delta.y
  const facing = FACING[intent.key]
  if (!canStand(map, nx, ny)) return { player: { ...walker, facing }, intent: used }

  return { player: { ...walker, x: nx, y: ny, facing, frame: (walker.frame + 1) % 4, movedAt: now }, intent: used }
}

// Advances a room-jump path by one tile; a step that cannot be stood on cancels the path.
const stepPath = (player: Player, map: OfficeMap, intent: Intent | undefined, now: number): StepResult => {
  const [step, ...rest] = player.path
  if (step === undefined) return { player, intent }
  // A path from an older map (a resize) may not start next to the player any more; it is dropped, never jumped.
  if (!canStand(map, step.x, step.y) || Math.abs(step.x - player.x) + Math.abs(step.y - player.y) !== 1) {
    return { player: { ...player, path: [] }, intent }
  }
  const dx = step.x - player.x
  const dy = step.y - player.y
  const facing: Facing = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down'

  return { player: { ...player, x: step.x, y: step.y, facing, frame: (player.frame + 1) % 4, path: rest, movedAt: now }, intent }
}

// Puts a pending emote on the player for EMOTE_MS from the press (D15) and clears one that has run out. The
// shared `until` is cleared with it unless a chat line (T20) still uses it. Returns the same object when
// nothing changes.
export const settleEmote = (player: Player, pending: PendingEmote | undefined, now: number): Player => {
  if (pending !== undefined) return { ...player, emote: pending.glyph, until: pending.at + EMOTE_MS }
  if (player.emote === undefined || player.until === undefined || player.until > now) return player
  const { emote: _emote, until: _until, ...rest } = player

  return player.chat === undefined ? rest : { ...rest, until: player.until }
}

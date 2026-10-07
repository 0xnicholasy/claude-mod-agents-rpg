// Scene model for the image office (v3 D8, D9, D17): plain JSON data in world pixels that the renderer page
// draws. Pure, no `$`. T07 adds figures to this model.
import type { AgentStatus, OfficeAgent, Roster, Tier } from './agents'
import { focusOf, viewFor } from './camera'
import { CAT_FOOT, cut, isMid } from './map'
import type { OfficeMap, Rect, RoomKind } from './map'
import type { Cat } from './cat'
import { FLOOR_BG, hourOf, isNight, ROOM_FLOORS } from './frame'
import type { Bubble, Motion, RemotePlayer } from './frame'
import { MID_SEAT_W } from './midArt'
import { drawnFacing, drawnPose } from './motion'
import type { Player } from './player'
import { CELL_PX, personVariant, SEAT, SPRITE_NAMES, SPRITES, tierPlate } from './sceneArt'
import type { SpriteLayer, SpriteName } from './sceneArt'
import type { Facing } from './sprites'

// A rectangle in world pixels.
export type SceneRect = { x: number; y: number; w: number; h: number }
export type SceneRoom = SceneRect & { id: string; name: string; kind: RoomKind; floor: number }
// `x`,`y` is the sprite's anchor point in world px: bottom-centre of the sprite for a 'foot' anchor.
export type SceneProp = { sprite: SpriteName; x: number; y: number; layer: SpriteLayer }
// One drawn character. x is the centre and y the foot line, in world px; `z` is the depth (the foot line), and the
// figures array is already ordered back to front (cat, agents, other players, own player on equal depth).
// The cat has the key 'cat' and no plate. A remote figure carries no tool or text of its session (D16).
export type SceneFigure = {
  key: string
  sprite: SpriteName
  facing: Facing
  // True when the page draws the sprite flipped left-right. Only the cat sets it (see catMirror).
  mirror?: boolean
  pose: 'seated' | 'standing'
  x: number
  y: number
  z: number
  plate: string
  plateColor: string
  tier: Tier
  status: AgentStatus
  remote: boolean
  player: boolean
  highlight: boolean
  bubble?: string
  emote?: string
  chat?: string
}
// The cat PNGs (cat-orange-walk, cat-orange-sit) are drawn facing left: head and ears at the left edge, tail at the right.
// A cat facing right is that art flipped left-right.
export const CAT_ART_FACING: Facing = 'left'
export const catMirror = (facing: Facing): boolean => facing !== CAT_ART_FACING

export type SceneModel = {
  world: { w: number; h: number }
  rooms: SceneRoom[]
  corridor: SceneRect & { floor: number }
  walls: SceneRect[]
  doors: SceneRect[]
  props: SceneProp[]
  camera: SceneRect
  night: boolean
  figures: SceneFigure[]
  // The overlay line: the chat draft, else the inspect line while shown (D17).
  caption?: string
}
export type SceneInput = {
  map: OfficeMap
  paneColumns: number
  paneRows: number
  // The own player (top-left cell, facing, emote, chat), or null/undefined when there is none.
  player?: Player | null
  // Room id the camera falls back to when there is no player.
  ownId: string
  now: number
  agents?: Roster
  // `remoteRoster(remote)`: the other sessions' agents, keyed `sessionId:agentId`.
  remoteAgents?: Roster
  motion?: Motion
  bubbles?: readonly Bubble[]
  // `remotePlayersOf(remote, map)`.
  others?: readonly RemotePlayer[]
  cat?: Cat | null
  inspect?: { agentId: string; text: string; until: number } | null
  // The chat draft line (`chatLine(pad)`), which wins the caption over the inspect line.
  chatLine?: string
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

// Shared-room furniture: sprite, x as a fraction of the interior width (the sprite's centre) and the foot line as a
// fraction of the interior height (1 = floor). A wall sprite hangs near the top, a top-anchored one from it. The
// fractions keep every sprite inside the narrowest room (13 cells = 104 px) and spread out in wider ones; a back row
// (foot line near 0.6) sits behind a front row (foot line 1) so the room reads as two rows of furniture.
type SharedProp = readonly [SpriteName, number, number]
const SHARED: Readonly<Record<Exclude<RoomKind, 'team' | 'booths'>, readonly SharedProp[]>> = {
  reception: [['reception-desk', 0.4, 0.95], ['plant-tall', 0.85, 1], ['wall-clock', 0.66, 0]],
  conference: [['whiteboard', 0.5, 0.48], ['conference-table', 0.55, 0.97], ['plant-small', 0.14, 1]],
  kitchen: [['fridge', 0.2, 0.62], ['kitchen-counter', 0.64, 0.62], ['coffee-machine', 0.3, 1], ['water-cooler', 0.87, 1]],
  lab: [['server-rack', 0.18, 0.7], ['server-rack', 0.4, 0.7], ['desk-monitor', 0.35, 1], ['printer', 0.8, 1], ['wall-clock', 0.72, 0]],
}
const BOOTH_EXTRAS: readonly SharedProp[] = [['wall-clock', 0.5, 0]]

// Decor along the corridor walls: plants at both ends, a sofa, a water cooler and two clocks. The corridor is walking space, so
// every sprite hugs a wall and sorts behind the figures that cross it.
const corridorProps = (c: SceneRect): SceneProp[] => {
  const floorY = c.y + c.h - 2
  const at = (sprite: SpriteName, x: number, y: number): SceneProp => ({ sprite, x: Math.round(x), y, layer: SPRITES[sprite].layer })

  return [
    at('plant-small', c.x + 24, floorY),
    at('plant-small', c.x + c.w - 24, floorY),
    at('sofa', c.x + c.w * 0.25, floorY),
    at('water-cooler', c.x + c.w * 0.75, floorY),
    at('wall-clock', c.x + c.w * 0.4, c.y),
    at('wall-clock', c.x + c.w * 0.6, c.y),
  ]
}

export const propsOf = (map: OfficeMap): SceneProp[] => {
  const props: SceneProp[] = []
  const add = (sprite: SpriteName, x: number, y: number): void => {
    props.push({ sprite, x, y, layer: SPRITES[sprite].layer })
  }
  for (const room of map.rooms) {
    const b = px(room.bounds)
    if (room.kind === 'team' || room.kind === 'booths') {
      for (const a of room.anchors) {
        // Mid team desks are laid out for the 8-cell seated figure (map.ts), so centre on that span.
        const span = room.kind === 'team' && isMid(map.foot) ? MID_SEAT_W : map.foot.w
        const cx = (a.x + span / 2) * CELL_PX.w
        if (room.kind === 'team') {
          // The desk stands behind the chair; the seated figure sits in the chair with its back to us (SEAT).
          add('desk-monitor', cx, a.y * CELL_PX.h + SEAT.deskFootY)
          add('chair', cx, (a.y + map.foot.h) * CELL_PX.h)
        } else {
          add('armchair', cx, (a.y + map.foot.h) * CELL_PX.h)
          add('phone', cx + CELL_PX.w * 2, (a.y + map.foot.h - 1) * CELL_PX.h)
        }
      }
    }
    const extras = room.kind === 'team' ? [] : room.kind === 'booths' ? BOOTH_EXTRAS : SHARED[room.kind]
    for (const [sprite, fx, fy] of extras) add(sprite, Math.round(b.x + b.w * fx), Math.round(b.y + b.h * fy))
  }
  props.push(...corridorProps(px(map.corridor)))

  return props
}

export const PLAYER_VARIANT = 1
export const PLATE_MAX = 16
const PLAYER_PLATE = '#ffffff'

// The pad picks glyphs the terminal Raster can draw (pad.ts EMOTE_GLYPHS: a diamond U+25C6 and a tilde stand in for
// the heart and the note). The HTML page draws the real ones.
const EMOTE_ART: Readonly<Record<string, string>> = { '\u25c6': '\u2665', '~': '\u266a' }

export const emoteArt = (glyph: string): string => EMOTE_ART[glyph] ?? glyph

const spriteOf = (name: string): SpriteName => SPRITE_NAMES.find(n => n === name) ?? 'person1-down'

const personSprite = (variant: number, facing: Facing): SpriteName => spriteOf(`person${variant}-${facing}`)

type Ranked = { rank: number; figure: SceneFigure }

const figuresOf = (input: SceneInput): SceneFigure[] => {
  const { map, player, now } = input
  const motion = input.motion ?? {}
  const bubbles = input.bubbles ?? []
  const inspect = input.inspect ?? null
  const shown = inspect !== null && inspect.until > now && inspect.agentId !== '' ? inspect.agentId : undefined
  const footX = (x: number, span: number): number => (x + span / 2) * CELL_PX.w
  const footY = (y: number, h: number): number => (y + h) * CELL_PX.h
  const ranked: Ranked[] = []

  const agentFigure = (agent: OfficeAgent, remote: boolean): void => {
    const at = motion[agent.id]
    if (at === undefined) return
    const pose = drawnPose(agent, at)
    const seated = pose === 'read' || pose === 'type'
    const room = map.rooms.find(r => r.id === agent.room)
    const span = seated && room?.kind === 'team' && isMid(map.foot) ? MID_SEAT_W : map.foot.w
    const facing = drawnFacing(at)
    const bubble = remote ? undefined : bubbles.filter(b => b.agentId === agent.id && b.until > now).sort((a, b) => b.until - a.until)[0]
    // A seated figure is the back view, SEAT.lift above the chair's foot line, and keeps that line as its depth (v3 D21).
    const chairY = footY(at.y, map.foot.h)
    const drawnFacingOf: Facing = seated ? 'up' : facing
    ranked.push({
      rank: 1,
      figure: {
        key: agent.id,
        sprite: personSprite(personVariant(agent.id), drawnFacingOf),
        facing: drawnFacingOf,
        pose: seated ? 'seated' : 'standing',
        x: footX(at.x, span),
        y: seated ? chairY - SEAT.lift : chairY,
        z: chairY,
        plate: cut(agent.label, PLATE_MAX),
        plateColor: tierPlate(agent.tier),
        tier: agent.tier,
        status: agent.status,
        remote,
        player: false,
        highlight: !remote && agent.id === shown,
        ...(bubble === undefined ? {} : { bubble: bubble.text }),
      },
    })
  }
  for (const agent of Object.values(input.agents ?? {})) agentFigure(agent, false)
  for (const agent of Object.values(input.remoteAgents ?? {})) agentFigure(agent, true)

  const playerFigure = (
    key: string,
    variant: number,
    at: { x: number; y: number; facing: Facing },
    plate: string,
    remote: boolean,
    say: { emote?: string; emoteUntil?: number; chat?: string; chatUntil?: number },
  ): Ranked => {
    const y = footY(at.y, map.foot.h)
    const emote = say.emote !== undefined && (say.emoteUntil ?? 0) > now ? emoteArt(say.emote) : undefined
    const chat = say.chat !== undefined && (say.chatUntil ?? 0) > now ? say.chat : undefined
    return {
      rank: remote ? 2 : 3,
      figure: {
        key,
        sprite: personSprite(variant, at.facing),
        facing: at.facing,
        pose: 'standing',
        x: footX(at.x, map.foot.w),
        y,
        z: y,
        plate: cut(plate, PLATE_MAX),
        plateColor: PLAYER_PLATE,
        tier: 'grey',
        status: 'idle',
        remote,
        player: true,
        highlight: false,
        ...(emote === undefined ? {} : { emote }),
        ...(chat === undefined ? {} : { chat }),
      },
    }
  }
  for (const other of input.others ?? []) {
    const key = `player:${other.id}`
    ranked.push(playerFigure(key, personVariant(key), other, other.label, true, other))
  }
  if (player !== undefined && player !== null) ranked.push(playerFigure('player', PLAYER_VARIANT, player, 'you', false, player))

  const cat = input.cat
  if (cat !== undefined && cat !== null) {
    const y = footY(cat.y, CAT_FOOT.h)
    ranked.push({
      rank: 0,
      figure: {
        key: 'cat',
        sprite: spriteOf(`cat-orange-${cat.path.length > 0 ? 'walk' : 'sit'}`),
        facing: cat.facing,
        mirror: catMirror(cat.facing),
        pose: 'standing',
        x: footX(cat.x, CAT_FOOT.w),
        y,
        z: y,
        plate: '',
        plateColor: '',
        tier: 'grey',
        status: 'idle',
        remote: false,
        player: false,
        highlight: false,
      },
    })
  }

  return ranked.sort((a, b) => a.figure.z - b.figure.z || a.rank - b.rank).map(r => r.figure)
}

const captionOf = (input: SceneInput): string | undefined => {
  if (input.chatLine !== undefined && input.chatLine !== '') return input.chatLine
  const { inspect, now } = input
  if (inspect !== undefined && inspect !== null && inspect.until > now && inspect.text !== '') return inspect.text

  return undefined
}

// A stable string for the whole model: callers skip a state.json write when it did not change.
export const sceneKey = (model: SceneModel): string => JSON.stringify(model)

export const sceneOf = (input: SceneInput): SceneModel => {
  const { map, paneColumns, paneRows, player, ownId, now } = input
  const caption = captionOf(input)
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
    figures: figuresOf(input),
    ...(caption === undefined ? {} : { caption }),
  }
}

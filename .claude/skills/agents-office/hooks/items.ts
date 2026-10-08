// The things in the office the player can use with `e` (interactions D24, D25): desks, the whiteboard, the coffee
// machine, the sofa, the water coolers and the server racks. Pure geometry in cells, no `$`. Positions come from the
// scene's props (`propsOf`, px) and the team anchors, so the image scene and the text fallback share one table.
import { SMALL_FOOT } from './map'
import type { Footprint, OfficeMap, Point, Rect, RoomId } from './map'
import { propsOf } from './scene'
import { CELL_PX } from './sceneArt'
import type { SpriteName } from './sceneArt'

// Table order is the tie order after agent > cat > item (D24).
export const ITEM_KINDS = ['desk', 'whiteboard', 'coffee', 'sofa', 'cooler', 'rack'] as const
export type ItemKind = (typeof ITEM_KINDS)[number]

export type ItemSpec = { label: string; sprites: SpriteName[]; foot: Footprint }

// `foot` is the item's footprint in cells. A desk ignores it: its rect is the team anchor's footprint on the map,
// where the owner rests.
export const ITEMS: Readonly<Record<ItemKind, ItemSpec>> = {
  desk: { label: 'desk', sprites: ['desk-monitor'], foot: SMALL_FOOT },
  whiteboard: { label: 'whiteboard', sprites: ['whiteboard'], foot: { w: 6, h: 2 } },
  coffee: { label: 'coffee machine', sprites: ['coffee-machine'], foot: { w: 3, h: 2 } },
  sofa: { label: 'sofa', sprites: ['sofa'], foot: { w: 6, h: 2 } },
  cooler: { label: 'water cooler', sprites: ['water-cooler'], foot: { w: 2, h: 2 } },
  rack: { label: 'server rack', sprites: ['server-rack'], foot: { w: 3, h: 2 } },
}

export type Item = {
  id: string
  kind: ItemKind
  label: string
  // Cells, clamped inside `room` (or the corridor when `room` is undefined).
  rect: Rect
  room?: RoomId
  // A desk's team anchor (the footprint top-left where its owner rests).
  anchor?: Point
}

const inside = (r: Rect, x: number, y: number): boolean => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h

const fit = (rect: Rect, box: Rect): Rect => {
  const w = Math.min(rect.w, box.w)
  const h = Math.min(rect.h, box.h)

  return { x: Math.min(Math.max(rect.x, box.x), box.x + box.w - w), y: Math.min(Math.max(rect.y, box.y), box.y + box.h - h), w, h }
}

const kindOfSprite = (sprite: SpriteName): ItemKind | undefined =>
  ITEM_KINDS.find(kind => kind !== 'desk' && ITEMS[kind].sprites.includes(sprite))

export const itemsOf = (map: OfficeMap): Item[] => {
  const byKind: Record<ItemKind, Item[]> = { desk: [], whiteboard: [], coffee: [], sofa: [], cooler: [], rack: [] }
  const push = (kind: ItemKind, rect: Rect, room: RoomId | undefined, anchor?: Point): void => {
    const n = byKind[kind].filter(item => item.room === room).length
    byKind[kind].push({
      id: `${kind}:${room ?? 'corridor'}:${n}`,
      kind,
      label: ITEMS[kind].label,
      rect,
      ...(room === undefined ? {} : { room }),
      ...(anchor === undefined ? {} : { anchor }),
    })
  }

  for (const room of map.rooms) {
    if (room.kind !== 'team') continue
    for (const a of room.anchors) push('desk', { x: a.x, y: a.y, w: map.foot.w, h: map.foot.h }, room.id, { x: a.x, y: a.y })
  }

  for (const prop of propsOf(map)) {
    const kind = kindOfSprite(prop.sprite)
    if (kind === undefined) continue
    const foot = ITEMS[kind].foot
    // The prop's x is its centre and its y the foot line; the last row above the foot line is the floor it stands on.
    const floorX = Math.floor(prop.x / CELL_PX.w)
    const floorY = Math.ceil(prop.y / CELL_PX.h) - 1
    const room = map.rooms.find(r => inside(r.bounds, floorX, floorY))
    const box = room?.bounds ?? map.corridor
    const rect = fit({ x: Math.round(prop.x / CELL_PX.w - foot.w / 2), y: floorY + 1 - foot.h, w: foot.w, h: foot.h }, box)
    push(kind, rect, room?.id)
  }

  return ITEM_KINDS.flatMap(kind => byKind[kind])
}

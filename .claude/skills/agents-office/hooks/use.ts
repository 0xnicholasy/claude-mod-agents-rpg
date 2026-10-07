// Using things in the office with `e` (interactions D24, D30). Pure, no `$`. `targetOf` picks the one nearest thing the
// player can use; `deskOwner` says who sits at a desk; `hintOf` words the one-line hint shown near a target.
import type { OfficeAgent, Roster } from './agents'
import type { Cat } from './cat'
import type { Motion } from './frame'
import { INSPECT_RANGE, nearest } from './inspect'
import { ITEM_KINDS } from './items'
import type { Item } from './items'
import { CAT_FOOT } from './map'
import type { Footprint, Point, Rect } from './map'

// Items and the cat count from a footprint gap of 1 (D24); agents keep the v2 inspect range.
export const USE_RANGE = 1

export type Target =
  | { kind: 'agent'; id: string; gap: number }
  | { kind: 'cat'; gap: number }
  | { kind: 'item'; item: Item; gap: number }

// Agent beats cat beats item when the gaps are equal (D24).
const RANK: Record<Target['kind'], number> = { agent: 0, cat: 1, item: 2 }

// Cells between two rectangles: the horizontal gap plus the vertical gap, 0 when they touch or overlap on an axis.
export const rectGap = (a: Rect, b: Rect): number =>
  Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w)) + Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h))

export type TargetInput = {
  player: Point
  foot: Footprint
  agents: Roster
  motion: Motion
  items: readonly Item[]
  cat?: Cat
}

// Equal gap and rank can only tie between items (one agent target, one cat): table order, lower x, then id.
const itemOrder = (a: Target, b: Target): number => {
  if (a.kind !== 'item' || b.kind !== 'item') return 0

  return ITEM_KINDS.indexOf(a.item.kind) - ITEM_KINDS.indexOf(b.item.kind) || a.item.rect.x - b.item.rect.x || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0)
}

export const targetOf = (input: TargetInput): Target | undefined => {
  const { player, foot, agents, motion, items, cat } = input
  const found: Target[] = []

  // The agent path is the v2 inspect rule untouched: the smallest range at which `nearest` finds one is its gap. At a small
  // footprint that gap is the distance between top-left cells, while the cat and items use the gap between rectangles (D24),
  // so an agent 2 cells away can lose to an item that touches within 1: kept on purpose.
  for (let range = 0; range <= INSPECT_RANGE; range++) {
    const agent = nearest(agents, motion, player, range, foot)
    if (agent !== undefined) {
      found.push({ kind: 'agent', id: agent.id, gap: range })
      break
    }
  }

  const body: Rect = { x: player.x, y: player.y, w: foot.w, h: foot.h }
  if (cat !== undefined) {
    const gap = rectGap(body, { x: cat.x, y: cat.y, w: CAT_FOOT.w, h: CAT_FOOT.h })
    if (gap <= USE_RANGE) found.push({ kind: 'cat', gap })
  }
  for (const item of items) {
    const gap = rectGap(body, item.rect)
    if (gap <= USE_RANGE) found.push({ kind: 'item', item, gap })
  }

  found.sort((a, b) => a.gap - b.gap || RANK[a.kind] - RANK[b.kind] || itemOrder(a, b))

  return found[0]
}

// The agent who sits at a desk: resting on its anchor, else walking to it (the last tile of its path). Lower id wins.
export const deskOwner = (desk: Item, motion: Motion, roster: Roster): OfficeAgent | undefined => {
  const anchor = desk.anchor
  if (anchor === undefined) return undefined
  const ids = Object.keys(roster).sort()
  const resting = ids.find(id => {
    const at = motion[id]

    return at !== undefined && at.path.length === 0 && at.x === anchor.x && at.y === anchor.y
  })
  const arriving = ids.find(id => {
    const end = motion[id]?.path.at(-1)

    return end !== undefined && end.x === anchor.x && end.y === anchor.y
  })
  const id = resting ?? arriving

  return id === undefined ? undefined : roster[id]
}

// The one-line hint for a target (D30). Undefined when the agent left the roster.
export const hintOf = (target: Target | undefined, roster: Roster): string | undefined => {
  if (target === undefined) return undefined
  if (target.kind === 'item') return `e: ${target.item.label}`
  if (target.kind === 'cat') return 'e: pet the cat'
  const agent = roster[target.id]

  return agent === undefined ? undefined : `e: inspect ${agent.label}`
}

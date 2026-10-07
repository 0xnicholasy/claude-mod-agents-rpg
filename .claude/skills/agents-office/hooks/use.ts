// Using things in the office with `e` (interactions D24-D30). Pure, no `$`. `targetOf` picks the one nearest thing the
// player can use; `deskOwner` says who sits at a desk; `hintOf` words the one-line hint shown near a target; `outcomeOf`
// says what pressing `e` does; `boardLines` and `rackLines` fill the whiteboard and server rack panes.
import type { OfficeAgent, Roster } from './agents'
import type { Cat } from './cat'
import type { Motion } from './frame'
import { INSPECT_RANGE, nearest, PEEK_MAX, PEEK_WIDTH } from './inspect'
import { ITEM_KINDS } from './items'
import type { Item } from './items'
import { clean } from './log'
import { CAT_FOOT } from './map'
import type { Footprint, Point, Rect, RoomId } from './map'

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

// ---- Outcomes (D26, D27, D28, D29) ----

export const MUG_MS = 8000
export const PET_MS = 3000

// What the player holds or does after using a prop: a mug until `until`, or sitting on the sofa until a move.
export type Act = { kind: 'mug'; until: number } | { kind: 'sit' }
export type Outcome =
  | { kind: 'inspect'; id: string }
  | { kind: 'peek'; agentId: string; label: string }
  | { kind: 'board' }
  | { kind: 'rack' }
  | { kind: 'act'; act: Act }
  | { kind: 'say'; text: string }
  | { kind: 'pet' }
  // A caption line for outcomes the pane shows without a peek (empty desk, a remote desk).
  | { kind: 'line'; text: string }

export type UseCtx = {
  // The room id of the player's own team: only its desks open a peek.
  ownId: RoomId
  roster: Roster
  motion: Motion
  // Room id to the name on its plate (`Session N` for an anonymous remote session).
  roomNames: Readonly<Record<string, string>>
}

export const COOLER_LINES = [
  'Cold water. Nice.',
  'The cooler gurgles.',
  'Somebody refilled the jug.',
  'Hydrate or diedrate.',
  'Water cooler talk: tests are green.',
  'Just one more sip.',
  'The jug is nearly empty.',
  'Fresh cup, fresh start.',
] as const

const coolerLine = (seed: number): string => COOLER_LINES[Math.abs(Math.trunc(seed)) % COOLER_LINES.length] ?? COOLER_LINES[0]

const deskOutcome = (desk: Item, ctx: UseCtx): Outcome => {
  if (desk.room !== ctx.ownId) return { kind: 'line', text: `${clean(ctx.roomNames[desk.room ?? ''] ?? 'Remote')}'s desk` }
  const owner = deskOwner(desk, ctx.motion, ctx.roster)

  return owner === undefined ? { kind: 'line', text: 'Empty desk.' } : { kind: 'peek', agentId: owner.id, label: owner.label }
}

export const outcomeOf = (target: Target, ctx: UseCtx, now: number, seed: number): Outcome => {
  if (target.kind === 'agent') return { kind: 'inspect', id: target.id }
  if (target.kind === 'cat') return { kind: 'pet' }
  switch (target.item.kind) {
    case 'desk':
      return deskOutcome(target.item, ctx)
    case 'whiteboard':
      return { kind: 'board' }
    case 'rack':
      return { kind: 'rack' }
    case 'coffee':
      return { kind: 'act', act: { kind: 'mug', until: now + MUG_MS } }
    case 'sofa':
      return { kind: 'act', act: { kind: 'sit' } }
    case 'cooler':
      return { kind: 'say', text: coolerLine(seed) }
  }
}

// Clears an act that is over: the mug at `until`, sitting on any move (WASD, a room jump).
export const settleAct = <P extends { act?: Act }>(player: P, now: number, moved: boolean): P => {
  const act = player.act
  if (act === undefined) return player
  if ((act.kind === 'mug' && now >= act.until) || (act.kind === 'sit' && moved)) return { ...player, act: undefined }

  return player
}

// ---- Pane lines ----

// A plan node as the whiteboard reads it. The todo-list `plan` atom's nodes fit; `nodesOfTodos` makes a flat TodoWrite list fit.
export type BoardNode = { id: string; parentId: string | null; title: string; status: string }
export type BoardTodo = { content: string; status: string }

export const nodesOfTodos = (todos: readonly BoardTodo[]): BoardNode[] =>
  todos.map((todo, i) => ({ id: `todo-${i}`, parentId: null, title: todo.content, status: todo.status }))

const MARK: Readonly<Record<string, string>> = { completed: '[x]', in_progress: '[>]' }
export const NO_PLAN = 'No plan yet.'

// The plan as a tree in file order: `[x] done`, `[>] doing`, `[ ] to do`, two spaces per level, first PEEK_MAX lines.
export const boardLines = (nodes: readonly BoardNode[] | undefined): string[] => {
  if (nodes === undefined || nodes.length === 0) return [NO_PLAN]
  const ids = new Set(nodes.map(n => n.id))
  const kids = new Map<string | null, BoardNode[]>()
  for (const node of nodes) {
    // A node whose parent is missing counts as a root, so nothing is lost.
    const key = node.parentId !== null && ids.has(node.parentId) ? node.parentId : null
    kids.set(key, [...(kids.get(key) ?? []), node])
  }
  const lines: string[] = []
  const seen = new Set<BoardNode>()
  const walk = (node: BoardNode, depth: number): void => {
    if (seen.has(node) || lines.length >= PEEK_MAX) return
    seen.add(node)
    lines.push(Array.from(`${'  '.repeat(depth)}${MARK[node.status] ?? '[ ]'} ${clean(node.title)}`).slice(0, PEEK_WIDTH).join(''))
    for (const child of kids.get(node.id) ?? []) walk(child, depth + 1)
  }
  for (const root of kids.get(null) ?? []) walk(root, 0)
  // A parent cycle has no root above it: show what the walk did not reach, each as a root of its own.
  for (const node of nodes) walk(node, 0)

  return lines
}

export type AgentListItem = { id: string; status: string }
export type Usage = { percent?: number; usd?: number }

// A remote agent is keyed `sessionId:agentId` (presence.ts `remoteKey`); an own agent's id has no colon.
export const isRemoteAgentId = (id: string): boolean => id.includes(':')

const num = (value: number | undefined, show: (n: number) => string): string => (value === undefined || !Number.isFinite(value) ? '-' : show(value))
const RACK_HEADER = 3

// The server rack pane (D28): context and cost, running and idle counts, then each own agent's tool NAME, at most
// PEEK_MAX lines. Only the own roster entries and the `status` of the agent list are read, so no remote tool, tool
// argument or prompt text can reach it.
export const rackLines = (input: { roster: Roster; agentList: readonly AgentListItem[]; usage?: Usage }): string[] => {
  const { roster, agentList, usage } = input
  const running = agentList.filter(a => a.status === 'running').length
  const idle = agentList.filter(a => a.status === 'idle').length
  const head = [
    `context: ${num(usage?.percent, n => `${Math.round(n)}%`)}`,
    `cost: ${num(usage?.usd, n => `$${n.toFixed(2)}`)}`,
    `agents: ${running} running, ${idle} idle`,
  ]
  const rows = Object.values(roster)
    .filter(a => !isRemoteAgentId(a.id))
    .map(a => `${clean(a.label)}: ${a.tool === undefined ? '-' : clean(a.tool)}`)
  const room = PEEK_MAX - RACK_HEADER
  const shown = rows.length > room ? [...rows.slice(0, room - 1), `+${rows.length - room + 1} more`] : rows

  return [...head, ...shown].map(line => Array.from(line).slice(0, PEEK_WIDTH).join(''))
}

import { expect, test } from 'claude-code/testing'
import { buildOffice, canStand, roomAt } from './map'
import type { OfficeMap } from './map'
import type { Intent } from './pad'
import { jumpOrder, padRect, settleChat, settleEmote, spawnPlayer, startJump, stepPlayer } from './player'
import type { Player } from './player'
import { INTENT_MS } from './timing'

const map: OfficeMap = buildOffice(60, 18, [{ id: 'team:t1', label: 'proj' }])
const spawned = spawnPlayer(map, 'team:t1')
if (spawned === undefined) throw new Error('no spawn')
const start: Player = spawned
const tap = (key: Intent['key'], at: number, taps = 1): Intent => ({ key, at, taps })

test('the player spawns at the own team doorStand, clear of the pad cells', () => {
  const room = map.rooms.find(r => r.id === 'team:t1')
  expect(start).toMatchObject({ x: room?.doorStand.x, y: room?.doorStand.y, facing: 'down', path: [] })
  for (const rows of [11, 12, 18, 24]) {
    const m = buildOffice(60, rows, [{ id: 'team:t1', label: 'proj' }])
    const p = spawnPlayer(m, 'team:t1')
    const r = padRect(m)
    expect(p).toBeDefined()
    expect(p !== undefined && p.x < r.x + r.w && p.x + 3 > r.x && p.y < r.y + r.h && p.y + 2 > r.y).toBe(false)
  }
})

test('a tap moves one tile', () => {
  // Late tick: 200 ms after the press, still inside INTENT_MS.
  const out = stepPlayer(start, map, tap('d', 0), 200, 'team:t1')

  expect(out.player).toMatchObject({ x: start.x + 1, y: start.y, facing: 'right', movedAt: 200 })
  expect(out.intent?.taps).toBe(0)
  // The consumed tap does not move again on the next tick.
  const again = stepPlayer(out.player ?? start, map, out.intent, 300, 'team:t1')
  expect(again.player?.x).toBe(start.x + 1)
})

test('walls block', () => {
  // Walk left until the room's wall stops the player; it never leaves a standable tile.
  let p: Player = start
  let intent: Intent | undefined
  for (let i = 0; i < 80; i++) {
    intent = tap('a', i * 100)
    p = stepPlayer(p, map, intent, i * 100, 'team:t1').player ?? p
    expect(canStand(map, p.x, p.y)).toBe(true)
  }
  const stopped = p.x
  const blocked = stepPlayer(p, map, tap('a', 9000), 9000, 'team:t1')
  expect(blocked.player).toMatchObject({ x: stopped, facing: 'left' })
  expect(blocked.intent?.taps).toBe(0)
})

test('a held key moves one tile per tick', () => {
  let p: Player = start
  for (let i = 0; i < 4; i++) p = stepPlayer(p, map, tap('d', i * 100), i * 100, 'team:t1').player ?? p

  expect(p.x).toBe(start.x + 4)
  expect(p.frame).toBe(0)
})

test('several queued taps are consumed one per tick', () => {
  const first = stepPlayer(start, map, tap('d', 0, 4), 50, 'team:t1')

  expect(first.player?.x).toBe(start.x + 1)
  expect(first.intent?.taps).toBe(3)
})

test('a stale intent moves nothing', () => {
  const out = stepPlayer(start, map, tap('d', 0, 3), INTENT_MS + 1, 'team:t1')

  expect(out.player).toEqual(start)
  expect(out.intent?.taps).toBe(0)
})

test('a resize reseats a player that cannot stand', () => {
  const lost: Player = { ...start, x: 500, y: 500 }
  const out = stepPlayer(lost, map, undefined, 0, 'team:t1')

  expect(out.player).toMatchObject({ x: start.x, y: start.y })
})

test('an emote lasts 3000 ms from the press and then clears', () => {
  const shown = settleEmote(start, { glyph: '\u2665', at: 1000 }, 1100)

  expect(shown).toMatchObject({ emote: '\u2665', emoteUntil: 4000 })
  // Still shown just before the end, and the same object when nothing changes.
  expect(settleEmote(shown, undefined, 3999)).toBe(shown)
  const gone = settleEmote(shown, undefined, 4000)
  expect(gone.emote).toBeUndefined()
  expect(gone.emoteUntil).toBeUndefined()
})

test('an emote and a chat line each expire on their own (T10 backlog)', () => {
  const both = settleChat(settleEmote(start, { glyph: '!', at: 0 }, 0), { text: 'hi', at: 0 }, 0)

  expect(both).toMatchObject({ emote: '!', emoteUntil: 3000, chat: 'hi', chatUntil: 5000 })
  // After the emote's 3000 ms the chat is still there.
  const later = settleChat(settleEmote(both, undefined, 3000), undefined, 3000)
  expect(later.emote).toBeUndefined()
  expect(later).toMatchObject({ chat: 'hi', chatUntil: 5000 })
  // A chat that ends first leaves the emote alone.
  const sent = settleChat(settleEmote(start, { glyph: '!', at: 4000 }, 4000), { text: 'hi', at: 0 }, 4000)
  const ended = settleChat(settleEmote(sent, undefined, 5000), undefined, 5000)
  expect(ended.chat).toBeUndefined()
  expect(ended.emote).toBe('!')
})

test('a burst of 4 taps applies all 4 at one tick per 100 ms (D37)', () => {
  // Regression: staleness used to be measured from the newest press, so the 4th tap (consumed 300 ms in) expired.
  let player = start
  let intent: Intent | undefined = tap('d', 1000, 4)
  for (let i = 0; i < 4; i++) {
    const out = stepPlayer(player, map, intent, 1000 + i * 100, 'team:t1')
    player = out.player ?? player
    intent = out.intent
  }
  expect(player.x).toBe(start.x + 4)
  expect(intent?.taps).toBe(0)
})

test('a backlog that stops being consumed still goes stale', () => {
  const out = stepPlayer(start, map, tap('d', 0, 4), INTENT_MS + 50, 'team:t1')
  expect(out.player?.x).toBe(start.x)
  expect(out.intent?.taps).toBe(0)
})

test('a room jump walks tile by tile', () => {
  const jump = startJump(start, map, 'next')
  expect(jump.path.length).toBeGreaterThan(1)
  const steps = jump.path.length
  let player = jump
  for (let i = 0; i < steps; i++) {
    const before = player
    player = stepPlayer(player, map, undefined, i * 100, 'team:t1').player ?? player
    expect(Math.abs(player.x - before.x) + Math.abs(player.y - before.y)).toBe(1)
  }
  const target = jumpOrder(map)[1]
  expect(player.path).toEqual([])
  expect(roomAt(map, player.x, player.y)).toBe(target?.id)
})

test('WASD cancels a jump', () => {
  const jump = startJump(start, map, 'next')
  const out = stepPlayer(jump, map, tap('d', 0), 0, 'team:t1')
  expect(out.player?.path).toEqual([])
  expect(out.player?.x).toBe(start.x + 1)
})

test('[ from the first room goes to the last and ] wraps back', () => {
  const order = jumpOrder(map)
  const last = order[order.length - 1]
  let player = startJump(start, map, 'prev')
  while (player.path.length > 0) player = stepPlayer(player, map, undefined, 0, 'team:t1').player ?? player
  expect(roomAt(map, player.x, player.y)).toBe(last?.id)
  player = startJump(player, map, 'next')
  while (player.path.length > 0) player = stepPlayer(player, map, undefined, 0, 'team:t1').player ?? player
  expect(roomAt(map, player.x, player.y)).toBe(order[0]?.id)
})

test('a path that no longer starts next to the player is dropped', () => {
  const far: Player = { ...start, path: [{ x: start.x + 5, y: start.y }] }
  const out = stepPlayer(far, map, undefined, 0, 'team:t1')
  expect(out.player?.path).toEqual([])
  expect(out.player?.x).toBe(start.x)
})

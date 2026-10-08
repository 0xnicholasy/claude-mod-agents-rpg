import { expect, test } from 'claude-code/testing'
import { ITEM_KINDS, ITEMS, itemsOf } from './items'
import type { ItemKind } from './items'
import { buildOffice, MID_FOOT } from './map'
import type { OfficeMap, Rect, TeamSpec } from './map'
import { propsOf } from './scene'
import { CELL_PX, SPRITES } from './sceneArt'

const teams = (n: number): TeamSpec[] => Array.from({ length: n }, (_, i) => ({ id: `team:s${i}` as const, label: `project-${i}` }))
const count = (map: OfficeMap, kind: ItemKind): number => itemsOf(map).filter(item => item.kind === kind).length
const within = (r: Rect, box: Rect): boolean => r.x >= box.x && r.y >= box.y && r.x + r.w <= box.x + box.w && r.y + r.h <= box.y + box.h
const maps = (): OfficeMap[] => [
  buildOffice(80, 24, teams(1)),
  buildOffice(100, 24, teams(2)),
  buildOffice(120, 40, teams(3)),
  buildOffice(120, 30, teams(2), MID_FOOT),
]

test('every interactable prop yields one item (2 racks, 2 coolers)', () => {
  for (const map of maps()) {
    expect(count(map, 'whiteboard')).toBe(1)
    expect(count(map, 'coffee')).toBe(1)
    expect(count(map, 'sofa')).toBe(1)
    expect(count(map, 'cooler')).toBe(2)
    expect(count(map, 'rack')).toBe(2)
    const sprites = propsOf(map).map(p => p.sprite)
    expect(sprites.filter(s => s === 'server-rack')).toHaveLength(2)
    expect(sprites.filter(s => s === 'water-cooler')).toHaveLength(2)
  }
})

test('one desk per team anchor, carrying its anchor', () => {
  for (const map of maps()) {
    const anchors = map.rooms.filter(r => r.kind === 'team').flatMap(r => r.anchors)
    const desks = itemsOf(map).filter(item => item.kind === 'desk')
    expect(desks).toHaveLength(anchors.length)
    expect(desks.map(d => d.anchor)).toEqual(anchors)
    expect(desks.every(d => d.rect.w === map.foot.w && d.rect.h === map.foot.h)).toBe(true)
  }
})

test('each item rect lies inside its room, or the corridor when it has none', () => {
  for (const map of maps()) {
    for (const item of itemsOf(map)) {
      const box = item.room === undefined ? map.corridor : map.rooms.find(r => r.id === item.room)?.bounds
      expect(box).toBeDefined()
      expect(within(item.rect, box ?? map.corridor)).toBe(true)
    }
  }
})

test('items sit in the room of their prop and keep their footprint', () => {
  for (const map of maps()) {
    const items = itemsOf(map)
    const rooms = (kind: ItemKind): (string | undefined)[] => items.filter(i => i.kind === kind).map(i => i.room)
    expect(rooms('rack')).toEqual(['lab', 'lab'])
    expect(rooms('whiteboard')).toEqual(['conference'])
    expect(rooms('coffee')).toEqual(['kitchen'])
    expect(rooms('cooler')).toEqual(['kitchen', undefined])
    expect(rooms('sofa')).toEqual([undefined])
    for (const item of items.filter(i => i.kind !== 'desk')) {
      expect(item.rect.w).toBe(ITEMS[item.kind].foot.w)
      expect(item.rect.h).toBe(ITEMS[item.kind].foot.h)
    }
  }
})

test('each rect is centred on its prop and the list follows the table order', () => {
  for (const map of maps()) {
    const items = itemsOf(map)
    for (const kind of ITEM_KINDS.filter(k => k !== 'desk')) {
      const sprite = ITEMS[kind].sprites[0]
      const props = propsOf(map).filter(p => p.sprite === sprite)
      const mine = items.filter(i => i.kind === kind)
      expect(mine).toHaveLength(props.length)
      for (const [n, item] of mine.entries()) {
        const centre = (props[n]?.x ?? 0) / CELL_PX.w
        expect(Math.abs(item.rect.x + item.rect.w / 2 - centre)).toBeLessThanOrEqual(0.5)
      }
    }
    const order = items.map(i => ITEM_KINDS.indexOf(i.kind))
    expect(order).toEqual([...order].sort((a, b) => a - b))
  }
})

test('a room narrower than an item shrinks the rect inside the room', () => {
  const map = buildOffice(100, 30, teams(2))
  const narrow: OfficeMap = { ...map, rooms: map.rooms.map(r => (r.id === 'kitchen' ? { ...r, bounds: { ...r.bounds, w: 2 } } : r)) }
  const coffee = itemsOf(narrow).find(i => i.kind === 'coffee')
  const kitchen = narrow.rooms.find(r => r.id === 'kitchen')
  expect(coffee?.room).toBe('kitchen')
  expect(coffee?.rect.w).toBe(2)
  expect(within(coffee?.rect ?? { x: 0, y: 0, w: 99, h: 99 }, kitchen?.bounds ?? map.corridor)).toBe(true)
})

test('moving a room moves its items', () => {
  const map = buildOffice(100, 30, teams(2))
  const moved: OfficeMap = { ...map, rooms: map.rooms.map(r => (r.id === 'kitchen' ? { ...r, bounds: { ...r.bounds, x: r.bounds.x + 2 } } : r)) }
  const before = itemsOf(map).find(i => i.kind === 'coffee')
  const after = itemsOf(moved).find(i => i.kind === 'coffee')
  expect(before?.room).toBe('kitchen')
  expect((after?.rect.x ?? 0) - (before?.rect.x ?? 0)).toBe(2)
  expect(after?.rect.y).toBe(before?.rect.y)
  // The sofa lives in the corridor and stays put.
  expect(itemsOf(moved).find(i => i.kind === 'sofa')?.rect).toEqual(itemsOf(map).find(i => i.kind === 'sofa')?.rect)
})

test('ITEMS names the sprite of each interactable kind and every sprite exists', () => {
  expect(ITEMS.desk.sprites).toEqual(['desk-monitor'])
  expect(ITEMS.whiteboard.sprites).toEqual(['whiteboard'])
  expect(ITEMS.coffee.sprites).toEqual(['coffee-machine'])
  expect(ITEMS.sofa.sprites).toEqual(['sofa'])
  expect(ITEMS.cooler.sprites).toEqual(['water-cooler'])
  expect(ITEMS.rack.sprites).toEqual(['server-rack'])
  expect(ITEMS.coffee.label).toBe('coffee machine')
  for (const kind of ITEM_KINDS) for (const sprite of ITEMS[kind].sprites) expect(SPRITES[sprite]).toBeDefined()
})

test('item ids are unique', () => {
  for (const map of maps()) {
    const ids = itemsOf(map).map(i => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  }
})

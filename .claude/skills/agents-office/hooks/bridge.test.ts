import { expect, test } from 'claude-code/testing'
import { clampCells, newestFrame, parseLine, pixelsFor, seqFor, shouldWrite, splitLines, stateText, writeKeyOf } from './bridge'
import type { RendererLine } from './bridge'

const parseAll = (lines: string[]): RendererLine[] =>
  lines.flatMap(l => {
    const p = parseLine(l)
    return p === undefined ? [] : [p]
  })

test('a frame line split across two pieces parses once whole', () => {
  const a = splitLines('', 'dir /tmp/x\nready\nframe 1 /tmp/x/fra')
  expect(a.lines).toEqual(['dir /tmp/x', 'ready'])
  expect(a.carry).toBe('frame 1 /tmp/x/fra')
  const b = splitLines(a.carry, 'me-0.png\n')
  expect(b.lines).toEqual(['frame 1 /tmp/x/frame-0.png'])
  expect(b.carry).toBe('')
  expect(parseLine(b.lines[0] ?? '')).toEqual({ kind: 'frame', n: 1, path: '/tmp/x/frame-0.png' })
})

test('several frames in one piece use only the newest', () => {
  const { lines } = splitLines('', 'frame 1 /d/frame-0.png\nframe 2 /d/frame-1.png\nfps 11.5\nframe 3 /d/frame-0.png\n')
  expect(newestFrame(parseAll(lines))).toEqual({ n: 3, path: '/d/frame-0.png' })
  expect(newestFrame(parseAll(['ready']))).toBeUndefined()
})

test('an unknown or malformed line is ignored', () => {
  expect(parseLine('hello world')).toBeUndefined()
  expect(parseLine('frame x /a')).toBeUndefined()
  expect(parseLine('error nonsense boom')).toBeUndefined()
  expect(parseLine('dir relative')).toBeUndefined()
  expect(parseLine('frame  /a')).toBeUndefined()
  expect(parseLine('fps 0x10')).toBeUndefined()
})

test('dir, ready, fps and error lines parse', () => {
  expect(parseLine('dir /tmp/agents-office-s-abc')).toEqual({ kind: 'dir', path: '/tmp/agents-office-s-abc' })
  expect(parseLine('ready')).toEqual({ kind: 'ready' })
  expect(parseLine('fps 11.8')).toEqual({ kind: 'fps', value: 11.8 })
  expect(parseLine('error no-chromium Executable does not exist')).toEqual({
    kind: 'error',
    code: 'no-chromium',
    text: 'Executable does not exist',
  })
})

test('stateText writes the D5 shape', () => {
  const text = stateText({ seq: 4, heartbeatAt: 99, size: { w: 608, h: 368 }, scene: { label: 'x' } })
  expect(JSON.parse(text)).toEqual({ v: 1, seq: 4, heartbeatAt: 99, size: { w: 608, h: 368 }, scene: { label: 'x' } })
})

test('the heartbeat is due at 2000 ms and not at 1999 ms', () => {
  const prev = { key: 'k', at: 1000 }
  expect(shouldWrite(prev, 'k', 2999)).toBe(false)
  expect(shouldWrite(prev, 'k', 3000)).toBe(true)
  expect(shouldWrite(prev, 'other', 1001)).toBe(true)
  expect(shouldWrite(undefined, 'k', 0)).toBe(true)
})

test('300 columns clamps to 255 and 2048 px', () => {
  expect(clampCells(300)).toBe(255)
  expect(clampCells(0)).toBe(1)
  expect(clampCells(Number.NaN)).toBe(1)
  expect(pixelsFor({ columns: 300, rows: 300 })).toEqual({ w: 2040, h: 2048 })
  expect(pixelsFor({ columns: 76, rows: 21 })).toEqual({ w: 608, h: 357 })
})

test('a new box gives a new size in the state text and a new write key for the same scene', () => {
  const scene = { rooms: [] }
  const small = pixelsFor({ columns: 76, rows: 11 })
  const wide = pixelsFor({ columns: 116, rows: 23 })
  const text = (size: { w: number; h: number }) => JSON.parse(stateText({ seq: 1, heartbeatAt: 5, size, scene })) as { size: { w: number; h: number } }
  expect(text(small).size).toEqual({ w: 608, h: 187 })
  expect(text(wide).size).toEqual({ w: 928, h: 391 })
  // A resize with an unchanged scene still writes at once, not at the next heartbeat.
  const sceneText = JSON.stringify(scene)
  expect(writeKeyOf(small, sceneText)).not.toBe(writeKeyOf(wide, sceneText))
  expect(shouldWrite({ key: writeKeyOf(small, sceneText), at: 1000 }, writeKeyOf(wide, sceneText), 1100)).toBe(true)
  expect(shouldWrite({ key: writeKeyOf(small, sceneText), at: 1000 }, writeKeyOf(small, sceneText), 1100)).toBe(false)
})

test('a heartbeat-only rewrite keeps the seq and a changed key takes the next one', () => {
  expect(seqFor({ key: 'k', at: 1000 }, 'k', 7)).toBe(7)
  expect(seqFor({ key: 'k', at: 1000 }, 'other', 7)).toBe(8)
  expect(seqFor(undefined, 'k', 0)).toBe(1)
})

test('a playwright-import error line parses as an error', () => {
  expect(parseLine('error playwright-import x')?.kind).toBe('error')
})

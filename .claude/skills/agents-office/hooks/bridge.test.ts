import { expect, test } from 'claude-code/testing'
import { clampCells, newestFrame, parseLine, pixelsFor, shouldWrite, splitLines, stateText } from './bridge'
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

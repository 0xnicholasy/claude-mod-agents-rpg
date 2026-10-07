import { expect, test } from 'claude-code/testing'
import { frameBytes, makeFrame } from './pixels'

test('frame sizes in bytes', () => {
  expect(makeFrame(76, 11, 0).length).toBe(608 * 176 * 4)
  expect(frameBytes(76, 11)).toBe(428032)
  expect(frameBytes(76, 23)).toBe(894976)
  expect(frameBytes(150, 45)).toBe(3456000)
})

test('the block moves 2 px per frame and wraps', () => {
  const a = makeFrame(76, 11, 0)
  const b = makeFrame(76, 11, 1)
  expect(a.some((v, i) => v !== b[i])).toBe(true)
  expect(makeFrame(76, 11, 304)).toEqual(a)
})

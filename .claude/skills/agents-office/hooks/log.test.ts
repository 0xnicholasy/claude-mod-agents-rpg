import { expect, test } from 'claude-code/testing'
import { arrived, clean, pushLog, reported, told } from './log'

test('pushLog keeps the newest five lines in order', () => {
  let log: string[] = []
  for (const line of ['1', '2', '3', '4', '5', '6', '7']) log = pushLog(log, line)

  expect(log).toEqual(['3', '4', '5', '6', '7'])
})

test('log helpers format arrival, message and report lines', () => {
  expect(arrived('quick-search', 'Library')).toBe('quick-search arrived in the Library')
  expect(told('main', 'a1', 'hello\n  there')).toBe('main told a1: hello there')
  expect(told('main', 'a1', 'x'.repeat(50))).toBe(`main told a1: ${'x'.repeat(40)}`)
  expect(reported('a1', 'answer')).toBe('a1 reported done')
  expect(reported('a1', 'aborted')).toBe('a1 reported stopped')
})

test('log lines carry no control characters from labels, targets or text', () => {
  const evil = '\u001b[31mred\n\r\u009bX'
  const lines = [arrived(evil, 'Library'), told(evil, evil, evil), reported(evil, 'answer')]
  for (const line of lines) expect(/[\u0000-\u001f\u007f-\u009f]/.test(line)).toBe(false)
  expect(clean(' a\tb\n\nc ')).toBe('a b c')
  expect(told('x'.repeat(30), 'y'.repeat(30), 'z')).toBe(`${'x'.repeat(16)} told ${'y'.repeat(16)}: z`)
})

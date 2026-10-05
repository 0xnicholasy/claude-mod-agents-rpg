import { expect, test } from 'claude-code/testing'
import { asShare, envValue, parseOfficeArgs, presenceDir } from './presence'

test('presence dir prefers CLAUDE_CONFIG_DIR', () => {
  expect(presenceDir('/c', '/h')).toBe('/c/agents-office/presence')
  expect(presenceDir('', '/h')).toBe('/h/.claude/agents-office/presence')
  expect(presenceDir('', '')).toBeUndefined()
})

test('a failed printenv gives an empty value', () => {
  expect(envValue('/c\n', true)).toBe('/c')
  expect(envValue('', false)).toBe('')
  expect(envValue('/c\n', false)).toBe('')
})

test('the share mode falls back to all', () => {
  expect(asShare('off')).toBe('off')
  expect(asShare('bogus')).toBe('all')
  expect(asShare(undefined)).toBe('all')
})

test('office arguments split into open, share and usage', () => {
  expect(parseOfficeArgs('')).toEqual({ kind: 'open' })
  expect(parseOfficeArgs(undefined)).toEqual({ kind: 'open' })
  expect(parseOfficeArgs(' share ANON ')).toEqual({ kind: 'share', mode: 'anon' })
  expect(parseOfficeArgs('share bogus')).toEqual({ kind: 'usage' })
  expect(parseOfficeArgs('share')).toEqual({ kind: 'usage' })
  expect(parseOfficeArgs('hello')).toEqual({ kind: 'usage' })
})

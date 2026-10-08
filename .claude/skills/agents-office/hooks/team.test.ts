import { expect, test } from 'claude-code/testing'
import { teamLabel } from './team'

test('label is basename and branch', () => {
  expect(teamLabel('/x/claude-mod-agents-rpg', 'feat/agents-office-v2\n', true)).toBe(
    'claude-mod-agents-rpg (feat/agents-office-v2)',
  )
})

test('no branch gives the basename', () => {
  expect(teamLabel('/x/repo', '', true)).toBe('repo')
  expect(teamLabel('/x/repo', 'main\n', false)).toBe('repo')
  expect(teamLabel('/', '', true)).toBe('office')
})

test('control characters in the branch are cleaned', () => {
  expect(teamLabel('/x/repo', 'a\u001b[31mb\n', true)).toBe('repo (a [31mb)')
})

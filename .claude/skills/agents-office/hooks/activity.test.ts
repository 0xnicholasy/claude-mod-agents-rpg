import { expect, test } from 'claude-code/testing'
import { activityFor } from './activity'

test('every built-in tool maps to a room and pose and unknown tools go to the desk', () => {
  const table: Array<[string, string, string]> = [
    ['Read', 'library', 'read'],
    ['Grep', 'library', 'read'],
    ['Glob', 'library', 'read'],
    ['NotebookRead', 'library', 'read'],
    ['Edit', 'desk', 'type'],
    ['Write', 'desk', 'type'],
    ['MultiEdit', 'desk', 'type'],
    ['NotebookEdit', 'desk', 'type'],
    ['Bash', 'server', 'run'],
    ['BashOutput', 'server', 'run'],
    ['KillShell', 'server', 'run'],
    ['WebSearch', 'phone', 'call'],
    ['WebFetch', 'phone', 'call'],
    ['mcp__web__fetch_page', 'phone', 'call'],
    ['mcp__github__search_code', 'phone', 'call'],
    ['mcp__Http__Get', 'phone', 'call'],
    ['Agent', 'lobby', 'talk'],
    ['TaskStop', 'lobby', 'talk'],
    ['SendMessage', 'lobby', 'talk'],
    ['mcp__linear__save_issue', 'desk', 'type'],
    ['SomeFutureTool', 'desk', 'type'],
    ['toString', 'desk', 'type'],
  ]
  for (const [tool, room, pose] of table) {
    expect({ tool, ...activityFor(tool) }).toEqual({ tool, room, pose })
  }
})

import { expect, test } from 'claude-code/testing'
import { activityFor } from './activity'

test('known tools map to a room and pose and unknown tools go to the desk', () => {
  const table: Array<[string, string, string]> = [
    ['Read', 'desk', 'read'],
    ['Grep', 'desk', 'read'],
    ['Glob', 'desk', 'read'],
    ['NotebookRead', 'desk', 'read'],
    ['LSP', 'desk', 'read'],
    ['ReadMcpResourceTool', 'desk', 'read'],
    ['ListMcpResourcesTool', 'desk', 'read'],
    ['ReadMcpResourceDirTool', 'desk', 'read'],
    ['Edit', 'desk', 'type'],
    ['Write', 'desk', 'type'],
    ['MultiEdit', 'desk', 'type'],
    ['NotebookEdit', 'desk', 'type'],
    ['Bash', 'lab', 'run'],
    ['BashOutput', 'lab', 'run'],
    ['KillShell', 'lab', 'run'],
    ['Monitor', 'lab', 'run'],
    ['WebSearch', 'booths', 'call'],
    ['WebFetch', 'booths', 'call'],
    ['mcp__web__fetch_page', 'booths', 'call'],
    ['mcp__github__search_code', 'booths', 'call'],
    ['mcp__Http__Get', 'booths', 'call'],
    ['Agent', 'reception', 'talk'],
    ['TaskStop', 'reception', 'talk'],
    ['SendMessage', 'reception', 'talk'],
    ['mcp__linear__save_issue', 'desk', 'type'],
    ['SomeFutureTool', 'desk', 'type'],
    ['toString', 'desk', 'type'],
  ]
  for (const [tool, room, pose] of table) {
    expect({ tool, ...activityFor(tool) }).toEqual({ tool, room, pose })
  }
})

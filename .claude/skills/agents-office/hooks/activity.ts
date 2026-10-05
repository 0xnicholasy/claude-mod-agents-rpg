// Pure mapping from a tool name to the room and pose it implies. No `$`.
import type { RoomId } from './map'
import type { Pose } from './sprites'

// 'desk' means the agent's own desk in its home room, the own team room (OfficeAgent.home, D11).
export type Activity = { room: RoomId | 'desk'; pose: Pose }

const READ: Activity = { room: 'desk', pose: 'read' }
const DESK: Activity = { room: 'desk', pose: 'type' }
const RUN: Activity = { room: 'lab', pose: 'run' }
const CALL: Activity = { room: 'booths', pose: 'call' }
const TALK: Activity = { room: 'reception', pose: 'talk' }

const BUILT_IN = new Map<string, Activity>([
  ['Read', READ],
  ['Grep', READ],
  ['Glob', READ],
  ['NotebookRead', READ],
  ['LSP', READ],
  ['ReadMcpResourceTool', READ],
  ['ListMcpResourcesTool', READ],
  ['ReadMcpResourceDirTool', READ],
  ['Edit', DESK],
  ['Write', DESK],
  ['MultiEdit', DESK],
  ['NotebookEdit', DESK],
  ['Bash', RUN],
  ['BashOutput', RUN],
  ['KillShell', RUN],
  ['Monitor', RUN],
  ['WebSearch', CALL],
  ['WebFetch', CALL],
  ['Agent', TALK],
  ['TaskStop', TALK],
  ['SendMessage', TALK],
])

const NETWORK_MCP = /fetch|http|search/i

export const activityFor = (tool: string): Activity => {
  const known = BUILT_IN.get(tool)
  if (known !== undefined) return known
  if (tool.startsWith('mcp__') && NETWORK_MCP.test(tool)) return CALL

  return DESK
}

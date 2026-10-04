// Every atom is declared inline: `claude plugin validate` refuses a PluginState
// entry that points at an alias. The named types below are for use in code.
export type OfficeOpened = boolean
export type OfficeViewport = { columns: number; rows: number }
export type OfficeMotion = {
  x: number
  y: number
  path: Array<{ x: number; y: number }>
  frame: number
}

declare module 'claude-code' {
  interface PluginState {
    'agents-office': {
      opened: boolean
      viewport: { columns: number; rows: number }
      agents: Record<
        string,
        {
          id: string
          label: string
          tier: 'haiku' | 'sonnet' | 'opus' | 'fable' | 'grey'
          parentId?: string
          status: 'working' | 'idle' | 'done' | 'leaving'
          room: 'lobby' | 'devbay' | 'library' | 'server' | 'phone' | 'meeting' | 'break'
          pose: 'idle' | 'walk' | 'read' | 'type' | 'run' | 'call' | 'talk'
          home: 'lobby' | 'devbay' | 'library' | 'server' | 'phone' | 'meeting' | 'break'
          teammate: boolean
          completedAt?: number
          script?:
            | {
                kind: 'meet'
                peer: string
                phase: 'going' | 'talking' | 'returning'
                returnRoom: 'lobby' | 'devbay' | 'library' | 'server' | 'phone' | 'meeting' | 'break'
                returnPose: 'idle' | 'walk' | 'read' | 'type' | 'run' | 'call' | 'talk'
                returnAt: { x: number; y: number }
                until?: number
                text?: string
              }
            | {
                kind: 'report'
                phase: 'toLobby' | 'reporting' | 'toBreak'
                stopped: boolean
                until?: number
              }
        }
      >
      motion: Record<
        string,
        { x: number; y: number; path: Array<{ x: number; y: number }>; frame: number }
      >
      bubbles: Array<{ agentId: string; text: string; until: number }>
      log: string[]
    }
  }
}

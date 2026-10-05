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
      viewport: { columns: number; rows: number; strip?: number }
      agents: Record<
        string,
        {
          id: string
          label: string
          tier: 'haiku' | 'sonnet' | 'opus' | 'fable' | 'grey'
          role?: 'lead' | 'dev' | 'research' | 'review'
          parentId?: string
          status: 'working' | 'idle' | 'done' | 'leaving'
          room: 'reception' | 'conference' | 'kitchen' | 'lab' | 'booths' | `team:${string}`
          pose: 'idle' | 'walk' | 'read' | 'type' | 'run' | 'call' | 'talk'
          home: 'reception' | 'conference' | 'kitchen' | 'lab' | 'booths' | `team:${string}`
          described?: boolean
          teammate: boolean
          completedAt?: number
          script?:
            | {
                kind: 'meet'
                peer: string
                phase: 'going' | 'talking' | 'returning'
                returnRoom: 'reception' | 'conference' | 'kitchen' | 'lab' | 'booths' | `team:${string}`
                returnPose: 'idle' | 'walk' | 'read' | 'type' | 'run' | 'call' | 'talk'
                returnAt: { x: number; y: number }
                until?: number
                text?: string
              }
            | {
                kind: 'report'
                phase: 'toReception' | 'reporting' | 'toKitchen'
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
      team: { id: `team:${string}`; label: string; branch: string; startedAt: number } | null
      player: {
        x: number
        y: number
        facing: 'down' | 'up' | 'left' | 'right'
        frame: number
        path: Array<{ x: number; y: number }>
        movedAt?: number
        emote?: string
        chat?: string
        until?: number
      } | null
      inspect: { agentId: string; text: string; until: number } | null
      identity: { sessionId: string; startedAt: number; dir?: string } | null
      share: 'all' | 'anon' | 'off'
      presence: { lastText?: string; lastWriteAt: number; ended: boolean }
      pad: {
        handled: string
        clear: string
        intent?: { key: 'w' | 'a' | 's' | 'd'; at: number; taps: number }
        emote?: { glyph: string; at: number }
        jump?: { dir: 'next' | 'prev'; at: number }
        epoch?: number
        inspect?: { at: number }
      }
    }
  }
}

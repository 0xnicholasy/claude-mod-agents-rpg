// Presence directory and share preference (D17, D19). Pure: register.tsx runs `printenv` and the store calls.

export type ShareMode = 'all' | 'anon' | 'off'

const SHARE_MODES: readonly ShareMode[] = ['all', 'anon', 'off']
export const DEFAULT_SHARE: ShareMode = 'all'
export const SHARE_USAGE = 'Usage: /office share all|anon|off'

// `<CLAUDE_CONFIG_DIR>/agents-office/presence`, else `<HOME>/.claude/agents-office/presence`; undefined when both are empty.
export const presenceDir = (config: string, home: string): string | undefined => {
  const base = config.trim()
  const fallback = home.trim()
  if (base !== '') return `${base}/agents-office/presence`
  if (fallback !== '') return `${fallback}/.claude/agents-office/presence`

  return undefined
}

// The value `printenv` printed; empty when the run failed (a variable that is unset exits 1).
export const envValue = (stdout: string, ok: boolean): string => (ok ? stdout.replace(/[\r\n]+$/, '').trim() : '')

// A stored value back to a mode. `unknown` because `$.store.get` returns `unknown` (D19).
export const asShare = (value: unknown): ShareMode => SHARE_MODES.find(mode => mode === value) ?? DEFAULT_SHARE

export type OfficeArgs = { kind: 'open' } | { kind: 'share'; mode: ShareMode } | { kind: 'usage' }

// Splits the `/office` arguments: none opens the pane, `share <mode>` sets the preference, anything else is usage.
export const parseOfficeArgs = (args: string | undefined): OfficeArgs => {
  const words = (args ?? '').trim().toLowerCase().split(/\s+/).filter(word => word !== '')
  if (words.length === 0) return { kind: 'open' }
  const mode = SHARE_MODES.find(candidate => candidate === words[1])
  if (words[0] === 'share' && words.length === 2 && mode !== undefined) return { kind: 'share', mode }

  return { kind: 'usage' }
}

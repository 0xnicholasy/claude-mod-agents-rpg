import { parseLine } from './bridge'

export const CRASH_WINDOW_MS = 60_000
export const MAX_EXITS = 3
export const BACKOFF_MS: readonly number[] = [1000, 2000, 4000]

export type RendererStatus = 'off' | 'starting' | 'running' | 'backoff' | 'failed'

// Mirrors the `renderer` atom in types/index.d.ts. `retryAt` is when `retry-due` may fire.
export type Life = {
  status: RendererStatus
  dir?: string
  exits: number[]
  reason?: string
  retryAt?: number
}

export type LifeEvent =
  | { kind: 'want-start' }
  | { kind: 'spawned' }
  | { kind: 'ready'; dir?: string }
  | { kind: 'exit'; code: number | null; signal: string | null; stderr: string; stdout?: string }
  // `noOutput`: node was asked for and printed nothing before the call failed, which means it could not start.
  | { kind: 'spawn-failed'; error: string; noOutput?: boolean }
  | { kind: 'closed' }
  | { kind: 'retry-due' }

export type Failure = { code: 'no-node' | 'no-playwright' | 'no-chromium' | 'crash'; reason: string }

export const initialLife: Life = { status: 'off', exits: [] }

const REASON_NO_NODE = 'Node.js was not found. Install Node 20 or newer, then run /office scene auto.'
const REASON_NO_PLAYWRIGHT = 'The playwright package is missing. Run npm ci in the mod checkout.'
const REASON_NO_CHROMIUM = 'Chromium is not installed. Run npx playwright install chromium.'

const crashReason = (tail: string): string =>
  tail === ''
    ? 'The renderer crashed. Run /office scene image to try again.'
    : `The renderer crashed (${tail.slice(0, 80)}). Run /office scene image to try again.`

const lastLine = (text: string): string => {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l !== '')
  return lines[lines.length - 1] ?? ''
}

// render.mjs prints `error` lines on stdout, so callers pass stdout error lines too (the exit event's `stdout`).
// A fatal code (no-playwright, no-chromium) wins over an earlier launch/page line.
// Reads render.mjs's own `error <code> <text>` lines first, then the raw node and playwright messages.
export const classify = (stderr: string, error?: string): Failure => {
  const text = `${stderr}\n${error ?? ''}`
  const errors = text.split('\n').flatMap(line => {
    const parsed = parseLine(line.trim())
    return parsed !== undefined && parsed.kind === 'error' ? [parsed] : []
  })
  if (errors.some(e => e.code === 'no-playwright')) return { code: 'no-playwright', reason: REASON_NO_PLAYWRIGHT }
  if (errors.some(e => e.code === 'no-chromium')) return { code: 'no-chromium', reason: REASON_NO_CHROMIUM }
  const first = errors[0]
  if (first !== undefined) return { code: 'crash', reason: crashReason(first.text) }
  if (/Cannot find package 'playwright'/.test(text)) return { code: 'no-playwright', reason: REASON_NO_PLAYWRIGHT }
  if (/Executable doesn't exist/.test(text)) return { code: 'no-chromium', reason: REASON_NO_CHROMIUM }
  if (error !== undefined && /ENOENT|not found/i.test(error)) return { code: 'no-node', reason: REASON_NO_NODE }
  return { code: 'crash', reason: crashReason(lastLine(stderr) || (error ?? '')) }
}

const spawnFailure = (event: { error: string; noOutput?: boolean }): Failure => {
  const found = classify('', event.error)
  if (found.code === 'crash' && event.noOutput === true) return { code: 'no-node', reason: REASON_NO_NODE }

  return found
}

const fail = (reason: string, exits: number[]): Life => ({ status: 'failed', exits, reason })

const onFailure = (life: Life, failure: Failure, now: number): Life => {
  if (failure.code !== 'crash') return fail(failure.reason, life.exits)
  const exits = [...life.exits.filter(t => now - t < CRASH_WINDOW_MS), now]
  if (exits.length >= MAX_EXITS) {
    return fail(`The renderer crashed ${MAX_EXITS} times within 60 s. Run /office scene image to try again.`, exits)
  }
  const delay = BACKOFF_MS[Math.min(exits.length - 1, BACKOFF_MS.length - 1)] ?? 1000
  return { status: 'backoff', exits, reason: failure.reason, retryAt: now + delay }
}

export const next = (life: Life, event: LifeEvent, now: number): Life => {
  switch (event.kind) {
    case 'want-start':
      if (life.status === 'off') return { status: 'starting', exits: life.exits }
      // An explicit start after `failed` clears the crash count (the user asked again).
      if (life.status === 'failed') return { status: 'starting', exits: [] }
      return life
    case 'spawned':
      return life
    case 'ready':
      if (life.status !== 'starting') return life
      return { status: 'running', exits: life.exits, ...(event.dir === undefined ? {} : { dir: event.dir }) }
    case 'exit':
      if (life.status !== 'starting' && life.status !== 'running') return life
      return onFailure(life, classify(`${event.stderr}\n${event.stdout ?? ''}`), now)
    case 'spawn-failed':
      if (life.status !== 'starting' && life.status !== 'running') return life
      return onFailure(life, spawnFailure(event), now)
    case 'closed':
      if (life.status === 'failed') return life
      return { status: 'off', exits: life.exits }
    case 'retry-due':
      if (life.status !== 'backoff') return life
      if (life.retryAt !== undefined && now < life.retryAt) return life
      return { status: 'starting', exits: life.exits }
  }
}

// What the image probe found (D11): not run yet, a blit of the placeholder was accepted, or refused with this text.
export type Probe = { kind: 'pending' } | { kind: 'ok' } | { kind: 'denied'; reason: string }

export type Effective = { effective: 'probe' | 'image' | 'text'; reason?: string }

// What the pane draws (D10, D11): `text` is the v2 office; a failed renderer or a refused blit falls back to it with a
// reason, whatever the wish (so a forced `image` still falls back); `image` is forced without a probe; `auto` draws
// the picture only after the probe was accepted and stays at `probe` until then.
export const effectiveScene = (want: 'auto' | 'image' | 'text', probe: Probe, life: Life): Effective => {
  if (want === 'text') return { effective: 'text' }
  if (life.status === 'failed') return { effective: 'text', reason: life.reason ?? 'The renderer failed.' }
  if (probe.kind === 'denied') return { effective: 'text', reason: `Image scene off: ${probe.reason}` }
  if (want === 'image' || probe.kind === 'ok') return { effective: 'image' }

  return { effective: 'probe' }
}

// Over ssh the terminal runs on another machine and cannot read the renderer's files, so the Image would be a blank box
// and not a deny (the Image source doc in the API types). The probe is not run; the pane goes to text with this reason.
export const sshReason = (sshConnection: string, sshTty: string): string | undefined =>
  sshConnection !== '' || sshTty !== '' ? 'the terminal is across ssh and cannot read the renderer\'s picture files.' : undefined

// A scene written to the renderer that no `frame` line answers within this long means a hung page (E-08).
export const STALL_MS = 15_000

export const isStalled = (pendingSince: number | undefined, now: number): boolean => pendingSince !== undefined && now - pendingSince > STALL_MS

// The renderer ends itself with code 0 when no fresh heartbeat reached it for 10 s; such an exit after that long a run is
// the watchdog, not a crash. A fast clean exit still counts as a crash, so a renderer that dies at once cannot restart in a storm.
export const WATCHDOG_EXIT_MIN_MS = 9000

export const isWatchdogExit = (code: number | null, signal: string | null, ranMs: number, stderr: string): boolean =>
  code === 0 && signal === null && ranMs >= WATCHDOG_EXIT_MIN_MS && stderr.trim() === ''

// A blit refusal is final only when the host answered it (a throw is the engine closing or a race), the pane size is the
// size the frame was made for, and the text does not say nothing is mounted yet (E-07).
export const isFinalBlitDeny = (threw: boolean, deny: string, sameSize: boolean): boolean => !threw && sameSize && !/mounted/i.test(deny)

// What a closed pane asks of the plugin: the person closing the peek tab brings the office back with the pad's keys; the
// office pane closing stops the renderer, except when the plugin closed it itself to raise the peek tab (D31, E-04).
export const paneCloseOf = (
  closed: { id: string; origin: string },
  ids: { office: string; peek: string },
  swapping: boolean,
): { reopenOffice: boolean; stopRenderer: boolean } => ({
  reopenOffice: closed.id === ids.peek && closed.origin === 'person',
  stopRenderer: closed.id === ids.office && !swapping,
})

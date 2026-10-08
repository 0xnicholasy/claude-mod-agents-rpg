import { expect, test } from 'claude-code/testing'
import { classify, effectiveScene, initialLife, isFinalBlitDeny, isStalled, isWatchdogExit, next, paneCloseOf, STALL_MS } from './rendererLife'
import type { Life, LifeEvent, Probe } from './rendererLife'

const crash: LifeEvent = { kind: 'exit', code: 1, signal: null, stderr: 'boom' }

const run = (steps: Array<[LifeEvent, number]>): Life =>
  steps.reduce<Life>((life, [event, at]) => next(life, event, at), initialLife)

const start = (at: number): Array<[LifeEvent, number]> => [
  [{ kind: 'want-start' }, at],
  [{ kind: 'spawned' }, at],
  [{ kind: 'ready' }, at],
]

test('3 exits within 60 s give failed', () => {
  const life = run([
    ...start(0), [crash, 1000], [{ kind: 'retry-due' }, 2000],
    ...start(2000).slice(1), [crash, 3000], [{ kind: 'retry-due' }, 5000],
    ...start(5000).slice(1), [crash, 6000],
  ])
  expect(life.status).toBe('failed')
  expect(life.exits.length).toBe(3)
})

test('backoff runs 1 s then 2 s and holds until due', () => {
  const first = run([...start(0), [crash, 1000]])
  expect(first.status).toBe('backoff')
  expect(first.retryAt).toBe(2000)
  expect(next(first, { kind: 'retry-due' }, 1500).status).toBe('backoff')
  const second = run([...start(0), [crash, 1000], [{ kind: 'retry-due' }, 2000], [{ kind: 'ready' }, 2100], [crash, 3000]])
  expect(second.retryAt).toBe(5000)
})

test('3 exits spread over 61 s or more keep restarting', () => {
  const life = run([
    ...start(0), [crash, 1000], [{ kind: 'retry-due' }, 2000],
    ...start(2000).slice(1), [crash, 31000], [{ kind: 'retry-due' }, 33000],
    ...start(33000).slice(1), [crash, 62000],
  ])
  expect(life.status).toBe('backoff')
  expect(life.exits).toEqual([31000, 62000])
})

test('closed gives off and no retry', () => {
  const backoff = run([...start(0), [crash, 1000]])
  const off = next(backoff, { kind: 'closed' }, 1500)
  expect(off.status).toBe('off')
  expect(next(off, { kind: 'retry-due' }, 9000).status).toBe('off')
  expect(next(off, crash, 9000).status).toBe('off')
})

test('no-chromium and no-playwright go straight to failed', () => {
  const chromium = run([
    ...start(0),
    [{ kind: 'exit', code: 1, signal: null, stderr: "browserType.launch: Executable doesn't exist at /x" }, 1000],
  ])
  expect(chromium.status).toBe('failed')
  expect(chromium.exits.length).toBe(0)
  const pkg = run([
    ...start(0),
    [{ kind: 'exit', code: 1, signal: null, stderr: "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'playwright'" }, 1000],
  ])
  expect(pkg.status).toBe('failed')
  expect(next(pkg, { kind: 'retry-due' }, 99000).status).toBe('failed')
})

test('each reason string names its fix', () => {
  expect(classify('', 'spawn node ENOENT').reason).toContain('Install Node')
  expect(classify("Cannot find package 'playwright'").reason).toContain('npm ci')
  expect(classify("Executable doesn't exist").reason).toContain('npx playwright install chromium')
  expect(classify('segfault').reason).toContain('/office scene image')
  expect(classify('', 'spawn node ENOENT').code).toBe('no-node')
  expect(classify('segfault').code).toBe('crash')
})

test('classify reads render.mjs error lines', () => {
  expect(classify('error no-playwright missing').code).toBe('no-playwright')
  expect(classify('dir /x\nerror no-chromium none').code).toBe('no-chromium')
  expect(classify('error launch spawn failed').code).toBe('crash')
  expect(classify('error page blew up').code).toBe('crash')
})

test('spawn-failed with a missing node fails at once; want-start after failed resets', () => {
  const failed = run([
    [{ kind: 'want-start' }, 0],
    [{ kind: 'spawn-failed', error: 'spawn node ENOENT' }, 10],
  ])
  expect(failed.status).toBe('failed')
  expect(next(failed, { kind: 'closed' }, 20).status).toBe('failed')
  expect(next(failed, { kind: 'want-start' }, 30)).toEqual({ status: 'starting', exits: [] })
})

test('an exit carrying render.mjs stdout error lines fails at once', () => {
  const life = run([
    ...start(0),
    [{ kind: 'exit', code: 1, signal: null, stderr: '', stdout: 'dir /x\nerror launch a\nerror no-chromium none' }, 1000],
  ])
  expect(life.status).toBe('failed')
  expect(life.reason).toContain('npx playwright install chromium')
})

const pending: Probe = { kind: 'pending' }
const ok: Probe = { kind: 'ok' }
const alt = 'the Image draws its alt here: the terminal draws no placeholder images (env: inside tmux or screen)'
const failedLife: Life = { status: 'failed', exits: [], reason: 'Chromium is not installed. Run npx playwright install chromium.' }

test('auto stays at probe until the probe is accepted, then draws the image', () => {
  expect(effectiveScene('auto', pending, initialLife)).toEqual({ effective: 'probe' })
  expect(effectiveScene('auto', ok, initialLife)).toEqual({ effective: 'image' })
})

test('a denied probe gives text with the deny text as the reason', () => {
  const result = effectiveScene('auto', { kind: 'denied', reason: alt }, initialLife)
  expect(result.effective).toBe('text')
  expect(result.reason).toContain(alt)
})

test('image is forced without a probe but a refused blit or a failed life still falls back', () => {
  expect(effectiveScene('image', pending, initialLife)).toEqual({ effective: 'image' })
  expect(effectiveScene('image', { kind: 'denied', reason: alt }, initialLife).effective).toBe('text')
  expect(effectiveScene('image', ok, failedLife)).toEqual({ effective: 'text', reason: failedLife.reason })
})

test('a failed life gives text for auto, and text wants no reason', () => {
  expect(effectiveScene('auto', ok, failedLife)).toEqual({ effective: 'text', reason: failedLife.reason })
  expect(effectiveScene('text', { kind: 'denied', reason: alt }, failedLife)).toEqual({ effective: 'text' })
})

test('a spawn that fails before node printed anything is no-node, a later one is a crash', () => {
  const quiet = run([...start(0).slice(0, 1), [{ kind: 'spawn-failed', error: 'hooks stream chain failed', noOutput: true }, 10]])
  expect(quiet.status).toBe('failed')
  expect(quiet.reason).toContain('Node.js was not found')
  const loud = run([...start(0).slice(0, 1), [{ kind: 'spawn-failed', error: 'hooks stream chain failed' }, 10]])
  expect(loud.status).toBe('backoff')
})

test('a stall needs a pending scene older than STALL_MS', () => {
  expect(isStalled(undefined, 1e9)).toBe(false)
  expect(isStalled(1000, 1000 + STALL_MS)).toBe(false)
  expect(isStalled(1000, 1001 + STALL_MS)).toBe(true)
})

test('a clean exit after the heartbeat window is the watchdog, a fast or noisy one is a crash', () => {
  expect(isWatchdogExit(0, null, 10_500, '')).toBe(true)
  expect(isWatchdogExit(0, null, 500, '')).toBe(false)
  expect(isWatchdogExit(1, null, 10_500, '')).toBe(false)
  expect(isWatchdogExit(0, null, 10_500, 'boom')).toBe(false)
})

test('a thrown or not-mounted or resized blit deny is not final', () => {
  expect(isFinalBlitDeny(false, 'the Image draws its alt here', true)).toBe(true)
  expect(isFinalBlitDeny(true, 'engine closing', true)).toBe(false)
  expect(isFinalBlitDeny(false, 'no Image is mounted', true)).toBe(false)
  expect(isFinalBlitDeny(false, 'the Image draws its alt here', false)).toBe(false)
})

test('closing the office pane stops the renderer unless the plugin is swapping to the peek tab', () => {
  const ids = { office: 'office', peek: 'office-peek' }
  expect(paneCloseOf({ id: 'office', origin: 'person' }, ids, false)).toEqual({ reopenOffice: false, stopRenderer: true })
  expect(paneCloseOf({ id: 'office', origin: 'plugin' }, ids, true)).toEqual({ reopenOffice: false, stopRenderer: false })
  expect(paneCloseOf({ id: 'office-peek', origin: 'person' }, ids, false)).toEqual({ reopenOffice: true, stopRenderer: false })
  expect(paneCloseOf({ id: 'office-peek', origin: 'plugin' }, ids, false)).toEqual({ reopenOffice: false, stopRenderer: false })
})

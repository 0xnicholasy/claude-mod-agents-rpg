import { expect, test } from 'claude-code/testing'
import { classify, initialLife, next } from './rendererLife'
import type { Life, LifeEvent } from './rendererLife'

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

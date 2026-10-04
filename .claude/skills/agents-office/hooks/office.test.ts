import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { packSpikeFrame } from './loop'

const paneProps = {
  title: 'Office',
  isFocused: false,
  bodyColumns: 60,
  placement: 'inline',
  scroll: { offset: 0, bodyRows: 18 },
  view: {},
} as const

// 60 x 18 cells of 12 bytes, base64 encoded.
const FRAME_LENGTH = 4 * Math.ceil((60 * 18 * 12) / 3)

test('office pane draws a Raster on the terminal and one line elsewhere', async $ => {
  const terminal = await $.ui.mount({
    plugin: 'agents-office',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'office',
    props: paneProps,
  })
  expect(await terminal.find({ type: 'Raster', key: 'office' })).toBeDefined()
  await terminal.unmount()

  const desktop = await $.ui.mount({
    plugin: 'agents-office',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'office',
    props: paneProps,
  })
  expect(await desktop.find({ type: 'Text', text: 'Office needs the terminal surface.' })).toBeDefined()
  expect(await desktop.find({ type: 'Raster' })).toBeUndefined()
  await desktop.unmount()
})

test('office blits a new frame after one 100 ms tick', async ($, on) => {
  const clock = mock.clock(on)
  const seen: Array<{ requestId: string; key: string; cells?: string }> = []
  on('ui.blit', ($, e) => {
    seen.push(e)
    return { value: {} }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'office' } }))
  on('ui.log', () => ({ value: undefined }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'agents-office',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'office',
    props: paneProps,
  })
  await clock.advance(100)

  expect(seen).toHaveLength(1)
  expect(seen[0]?.requestId).toBe('office')
  expect(seen[0]?.key).toBe('office')
  expect(seen[0]?.cells?.length).toBe(FRAME_LENGTH)
  expect(seen[0]?.cells).toBe(packSpikeFrame(60, 18, 1))
  expect(await ui.find({ type: 'Raster' })).toMatchObject({ props: { columns: 60, rows: 18 } })
  await ui.unmount()
})

test('two ticks blit two different frames', async ($, on) => {
  const clock = mock.clock(on)
  const cells: string[] = []
  on('ui.blit', ($, e) => {
    if ('cells' in e) cells.push(e.cells)
    return { value: {} }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'office' } }))
  on('ui.log', () => ({ value: undefined }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'agents-office',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'office',
    props: paneProps,
  })
  await clock.advance(200)

  expect(cells).toHaveLength(2)
  expect(cells[0]).not.toBe(cells[1])
  await ui.unmount()
})

test('agent.spawn result delivers agentId to the roster', async ($, on) => {
  // `value` is unknown because StateWrite types it so (any atom's value).
  const writes: Array<{ plugin: string; key: string; value: unknown }> = []
  on('state.set', ($, e, next) => {
    writes.push(e)
    return next(e)
  })
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1', teammateId: 'bot@team' }))
  const result = await $.agent.spawn({
    tool_use_id: 't1',
    prompt: 'p',
    description: 'd',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
  })
  expect(result).toEqual({ model: 'claude-sonnet-5-5', agentId: 'a1', teammateId: 'bot@team' })
  expect(writes).toMatchObject([{ plugin: 'agents-office', key: 'agents', value: { a1: { id: 'a1' } } }])
})

test('/office opens the office pane', async ($, on) => {
  const opened: Array<{ id: string; title?: string }> = []
  on('ui.open', ($, e) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  await $.command.run({
    command: 'office',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })

  expect(opened).toMatchObject([{ id: 'office', title: 'Office' }])
})

const spawnArgs = {
  tool_use_id: 't1',
  prompt: 'p',
  description: 'd',
  subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: false,
  fork: false,
} as const

test('a denied spawn passes the deny through and records no agent', async ($, on) => {
  const writes: Array<{ plugin: string; key: string }> = []
  on('state.set', ($, e, next) => {
    writes.push(e)
    return next(e)
  })
  on('agent.spawn', () => ({ deny: 'x' }))
  const result = await $.agent.spawn(spawnArgs)

  expect(result).toEqual({ deny: 'x' })
  expect(writes.filter(w => w.key === 'agents')).toHaveLength(0)
})

test('rendering twice at the same size writes viewport once', async ($, on) => {
  const clock = mock.clock(on)
  const writes: Array<{ plugin: string; key: string }> = []
  on('state.set', ($, e, next) => {
    writes.push(e)
    return next(e)
  })
  const props = { plugin: 'agents-office', surface: 'terminal', component: 'Pane', requestId: 'office', props: paneProps } as const
  const first = await $.ui.mount(props)
  await clock.advance(1)
  await first.unmount()
  const second = await $.ui.mount(props)
  await clock.advance(1)

  expect(writes.filter(w => w.key === 'viewport')).toHaveLength(1)
  await second.unmount()
})

test('no blit happens before the pane renders', async ($, on) => {
  const clock = mock.clock(on)
  const seen: string[] = []
  on('ui.blit', ($, e) => {
    seen.push(e.key)
    return { value: {} }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'office' } }))
  on('ui.log', () => ({ value: undefined }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(100)

  expect(seen).toHaveLength(0)
})

const stubSession = (on: On): void => {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'office' } }))
  on('ui.log', () => ({ value: undefined }))
}

const watchRoster = (on: On): (() => string[]) => {
  let latest: Record<string, unknown> = {}
  on('state.set', ($, e, next) => {
    // StateWrite types `value` as the union of every atom; only the agents atom is read.
    if (e.key === 'agents') latest = e.value as Record<string, unknown>
    return next(e)
  })

  return () => Object.keys(latest)
}

const turnArgs = {
  answer: 'done',
  durationMs: 1,
  isAborted: false,
  turnId: 'u1',
  agentId: 'a1',
  reason: 'answer',
} as const

test('a spawned agent leaves the roster 5 s after its turn completes', async ($, on) => {
  const clock = mock.clock(on)
  stubSession(on)
  const roster = watchRoster(on)
  on('agent.list', () => ({ value: [] }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('turn.complete', () => ({ text: 'done' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(spawnArgs)
  expect(roster()).toContain('a1')
  await $.turn.complete(turnArgs)
  await clock.advance(4900)
  expect(roster()).toContain('a1')
  await clock.advance(200)

  expect(roster()).not.toContain('a1')
  expect(roster()).toContain('main')
})

test('session.start seeds main and the listed teammates', async ($, on) => {
  mock.clock(on)
  stubSession(on)
  const roster = watchRoster(on)
  on('agent.list', () => ({
    value: [{ id: 'bot', description: 'watch ci', type: 'teammate', status: 'idle' as const }],
  }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(roster().sort()).toEqual(['bot', 'main'])
})

test('the roster refreshes from agent.list every 10 s', async ($, on) => {
  const clock = mock.clock(on)
  stubSession(on)
  const roster = watchRoster(on)
  let calls = 0
  const listed: Array<{ id: string; description: string; type: string; status: 'running' }> = []
  on('agent.list', () => {
    calls += 1
    return { value: [...listed] }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(calls).toBe(1)
  listed.push({ id: 'late', description: 'joined later', type: 'teammate', status: 'running' })
  await clock.advance(10000)

  expect(calls).toBe(2)
  expect(roster()).toContain('late')
})

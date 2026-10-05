import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { buildMap } from './map'
import { findPath } from './path'
import { STRIP_ROWS } from './timing'

const paneProps = {
  title: 'Office',
  isFocused: false,
  bodyColumns: 60,
  placement: 'inline',
  // 18 map rows plus the strip rows reserved under the Raster (D29).
  scroll: { offset: 0, bodyRows: 18 + STRIP_ROWS },
  view: {},
} as const

// 60 x 18 cells of 12 bytes, base64 encoded.
const FRAME_LENGTH = 4 * Math.ceil((60 * 18 * 12) / 3)

test('desktop and vscode surfaces show the terminal-only line and no Raster', async ($, on) => {
  mock.clock(on)
  for (const surface of ['desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({
      plugin: 'agents-office',
      surface,
      component: 'Pane',
      requestId: 'office',
      props: paneProps,
    })
    expect(await ui.find({ type: 'Text', text: 'Office needs the terminal surface.' })).toBeDefined()
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    expect(await ui.findAll({ type: 'Text' })).toHaveLength(1)
    await ui.unmount()
  }
})

test('a 50x12 pane shows the widen line and ticks do not blit', async ($, on) => {
  const clock = mock.clock(on)
  const blits: string[] = []
  on('ui.blit', ($, e) => {
    blits.push(e.key)
    return { value: {} }
  })
  stubSession(on)
  on('agent.list', () => ({ value: [] }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'agents-office',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'office',
    props: { ...paneProps, bodyColumns: 50, scroll: { offset: 0, bodyRows: 12 } },
  })
  await clock.advance(300)

  expect(
    await ui.find({
      type: 'Text',
      text: 'Office needs a 60x23 pane, this one is 50x12. Widen or heighten the terminal.',
    }),
  ).toBeDefined()
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(await ui.findAll({ type: 'Text' })).toHaveLength(1)
  expect(blits).toHaveLength(0)
  await ui.unmount()
})

test('the widen line and Raster switch at the 60x23 body-size boundary', async ($, on) => {
  mock.clock(on)
  stubSession(on)
  on('agent.list', () => ({ value: [] }))
  on('ui.blit', () => ({ value: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const cases = [
    { columns: 59, rows: 23, raster: false },
    { columns: 60, rows: 22, raster: false },
    { columns: 60, rows: 23, raster: true },
  ]
  for (const c of cases) {
    const ui = await $.ui.mount({
      plugin: 'agents-office',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'office',
      props: { ...paneProps, bodyColumns: c.columns, scroll: { offset: 0, bodyRows: c.rows } },
    })
    if (c.raster) {
      expect(await ui.find({ type: 'Raster', key: 'office' })).toMatchObject({
        props: { columns: 60, rows: 18 },
      })
      expect(await ui.find({ type: 'Text', text: /Office needs a/ })).toBeUndefined()
    } else {
      expect(await ui.findAll({ type: 'Text' })).toHaveLength(1)
      expect(
        await ui.find({
          type: 'Text',
          text: `Office needs a 60x23 pane, this one is ${c.columns}x${c.rows}. Widen or heighten the terminal.`,
        }),
      ).toBeDefined()
      expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    }
    await ui.unmount()
  }
})

test('a redraw from 50x12 to 60x23 blits exactly once after 100 ms', async ($, on) => {
  const clock = mock.clock(on)
  const blits: string[] = []
  on('ui.blit', ($, e) => {
    blits.push(e.key)
    return { value: {} }
  })
  stubSession(on)
  on('agent.list', () => ({ value: [] }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'agents-office',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'office',
    props: { ...paneProps, bodyColumns: 50, scroll: { offset: 0, bodyRows: 12 } },
  })
  await clock.advance(300)
  expect(blits).toHaveLength(0)
  await ui.redraw({ ...paneProps, bodyColumns: 60, scroll: { offset: 0, bodyRows: 23 } })
  await clock.advance(100)

  expect(blits).toHaveLength(1)
  await ui.unmount()
})

test('after redraw to 100x30 the Raster and the next blit are 100 by 25', async ($, on) => {
  const clock = mock.clock(on)
  const lengths: number[] = []
  on('ui.blit', ($, e) => {
    if ('cells' in e) lengths.push(e.cells.length)
    return { value: {} }
  })
  stubSession(on)
  on('agent.list', () => ({ value: [] }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(paneAt(18 + STRIP_ROWS))
  await clock.advance(100)
  await ui.redraw({ ...paneProps, bodyColumns: 100, scroll: { offset: 0, bodyRows: 30 } })
  await clock.advance(100)

  expect(await ui.find({ type: 'Raster', key: 'office' })).toMatchObject({ props: { columns: 100, rows: 25 } })
  expect(lengths).toHaveLength(2)
  expect(lengths[1]).toBe(4 * Math.ceil((100 * 25 * 12) / 3))
  await ui.unmount()
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
  expect(await ui.find({ type: 'Raster' })).toMatchObject({ props: { columns: 60, rows: 18 } })
  await ui.unmount()
})

test('a changed office blits again on the next tick', async ($, on) => {
  const clock = mock.clock(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
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
  await clock.advance(100)
  await $.agent.spawn(spawnArgs)
  await clock.advance(100)

  expect(cells).toHaveLength(2)
  expect(cells[0]).not.toBe(cells[1])
  await ui.unmount()
})

test('mounted pane draws a Raster of bodyColumns by bodyRows minus the strip', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount({
    plugin: 'agents-office',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'office',
    props: { ...paneProps, bodyColumns: 60, scroll: { offset: 0, bodyRows: 30 } },
  })

  expect(await ui.find({ type: 'Raster', key: 'office' })).toMatchObject({
    props: { columns: 60, rows: 30 - STRIP_ROWS },
  })
  await ui.unmount()
})

test('an unchanged office does not blit on the next tick', async ($, on) => {
  const clock = mock.clock(on)
  const blits: string[] = []
  on('ui.blit', ($, e) => {
    blits.push(e.key)
    return { value: {} }
  })
  stubSession(on)
  on('agent.list', () => ({ value: [] }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'agents-office',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'office',
    props: paneProps,
  })
  await clock.advance(100)
  expect(blits).toHaveLength(1)
  await clock.advance(300)

  expect(blits).toHaveLength(1)
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
  const opened: Array<{ id: string; title?: string; rows?: number; columns?: number }> = []
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

  expect(opened).toMatchObject([{ id: 'office', title: 'Office', rows: 23, columns: 60 }])
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

// `logs`, when given, collects the text of every ui.log call.
const stubSession = (on: On, logs?: string[]): void => {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'office' } }))
  on('ui.log', (_$, e) => {
    logs?.push(e.text)

    return { value: undefined }
  })
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

test('a second session.start keeps exactly one tick and one refresh cadence', async ($, on) => {
  const clock = mock.clock(on)
  stubSession(on)
  const blits: string[] = []
  on('ui.blit', ($, e) => {
    blits.push(e.key)
    return { value: {} }
  })
  let calls = 0
  on('agent.list', () => {
    calls += 1
    return { value: [] }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'agents-office',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'office',
    props: paneProps,
  })
  await clock.advance(1)
  blits.length = 0
  await clock.advance(99)
  expect(blits).toHaveLength(1)
  const before = calls
  await clock.advance(10000 - 99)

  expect(calls - before).toBe(1)
  await ui.unmount()
})

test('a failing first agent.list still refreshes 10 s later', async ($, on) => {
  const clock = mock.clock(on)
  stubSession(on)
  const roster = watchRoster(on)
  let calls = 0
  on('agent.list', () => {
    calls += 1
    if (calls === 1) throw new Error('list failed')

    return { value: [{ id: 'bot', description: 'watch ci', type: 'teammate', status: 'idle' as const }] }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(roster()).not.toContain('bot')
  await clock.advance(10000)

  expect(roster()).toContain('bot')
})

test('an unchanged roster is not rewritten on each tick', async ($, on) => {
  const clock = mock.clock(on)
  stubSession(on)
  const writes: Array<{ key: string }> = []
  on('state.set', ($, e, next) => {
    writes.push(e)
    return next(e)
  })
  on('agent.list', () => ({ value: [] }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const after = writes.filter(w => w.key === 'agents').length
  await clock.advance(1000)

  expect(after).toBeGreaterThan(0)
  expect(writes.filter(w => w.key === 'agents')).toHaveLength(after)
})

const paneAt = (bodyRows: number) =>
  ({
    plugin: 'agents-office',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'office',
    props: { ...paneProps, scroll: { offset: 0, bodyRows } },
  }) as const

test('remounting at a different size blits a new frame with the new size', async ($, on) => {
  const clock = mock.clock(on)
  const lengths: number[] = []
  on('ui.blit', ($, e) => {
    if ('cells' in e) lengths.push(e.cells.length)
    return { value: {} }
  })
  stubSession(on)
  on('agent.list', () => ({ value: [] }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const first = await $.ui.mount(paneAt(18 + STRIP_ROWS))
  await clock.advance(100)
  await first.unmount()
  const second = await $.ui.mount(paneAt(20 + STRIP_ROWS))
  await clock.advance(100)

  expect(lengths).toHaveLength(2)
  expect(lengths[1]).toBe(4 * Math.ceil((60 * 20 * 12) / 3))
  expect(lengths[1]).not.toBe(lengths[0])
  await second.unmount()
})

test('a denied blit is retried on the next tick', async ($, on) => {
  const clock = mock.clock(on)
  let calls = 0
  on('ui.blit', () => {
    calls += 1

    return calls === 1 ? { value: { deny: 'x' } } : { value: {} }
  })
  stubSession(on)
  on('agent.list', () => ({ value: [] }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(paneAt(18 + STRIP_ROWS))
  await clock.advance(100)
  await clock.advance(100)

  expect(calls).toBe(2)
  await ui.unmount()
})

test('a spawned agent is drawn on the first tick after the spawn', async ($, on) => {
  const clock = mock.clock(on)
  const cells: string[] = []
  on('ui.blit', ($, e) => {
    if ('cells' in e) cells.push(e.cells)
    return { value: {} }
  })
  stubSession(on)
  on('agent.list', () => ({ value: [] }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(paneAt(18 + STRIP_ROWS))
  await clock.advance(100)
  await $.agent.spawn(spawnArgs)
  await clock.advance(100)

  expect(cells).toHaveLength(2)
  expect(cells[1]).not.toBe(cells[0])
  await ui.unmount()
})

test('a spawned agent is at the Lobby door, then one tile further per 100 ms tick', async ($, on) => {
  const clock = mock.clock(on)
  const positions: Array<{ x: number; y: number }> = []
  on('state.set', ($, e, next) => {
    // StateWrite types `value` as the union of every atom; only the motion atom is read.
    if (e.key === 'motion') {
      const a1 = (e.value as Record<string, { x: number; y: number }>).a1
      if (a1 !== undefined) positions.push({ x: a1.x, y: a1.y })
    }
    return next(e)
  })
  stubSession(on)
  on('agent.list', () => ({ value: [] }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('ui.blit', () => ({ value: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(paneAt(18 + STRIP_ROWS))
  await clock.advance(100)
  await $.agent.spawn(spawnArgs)
  await clock.advance(100)
  await clock.advance(100)

  const lobby = buildMap(60, 18).rooms.find(r => r.id === 'lobby')
  expect(positions).toHaveLength(3)
  expect(positions[0]).toEqual(lobby?.doorStand)
  for (const [i, p] of positions.slice(1).entries()) {
    const prev = positions[i]
    expect(Math.abs(p.x - (prev?.x ?? 0)) + Math.abs(p.y - (prev?.y ?? 0))).toBe(1)
  }
  await ui.unmount()
})

type MotionWrite = Record<string, { x: number; y: number; path: Array<{ x: number; y: number }> }>

// Starts a session with a mounted pane and returns a reader for the latest motion write.
const startOffice = async ($: Engine, on: On) => {
  const clock = mock.clock(on)
  let latest: MotionWrite = {}
  let latestBubbles: Array<{ agentId: string; text: string; until: number }> = []
  let latestRoster: string[] = []
  const logs: string[] = []
  on('state.set', ($, e, next) => {
    // StateWrite types `value` as the union of every atom; only the motion, bubbles and agents atoms are read.
    if (e.key === 'agents') latestRoster = Object.keys(e.value as Record<string, unknown>)
    if (e.key === 'motion') latest = e.value as MotionWrite
    if (e.key === 'bubbles') latestBubbles = e.value as typeof latestBubbles
    return next(e)
  })
  stubSession(on, logs)
  on('agent.list', () => ({ value: [] }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('ui.blit', () => ({ value: {} }))
  on('tool.call', () => ({ result: 'stub' }))
  on('turn.complete', () => ({ text: 'done' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(paneAt(18 + STRIP_ROWS))
  await clock.advance(100)

  return { clock, ui, logs, motion: () => latest, bubbles: () => latestBubbles, roster: () => latestRoster }
}

const endsAtAnchor = (entry: MotionWrite[string] | undefined, room: string): boolean => {
  const end = entry?.path[entry.path.length - 1]
  const anchors = buildMap(60, 18).rooms.find(r => r.id === room)?.anchors ?? []

  return end !== undefined && anchors.some(a => a.x === end.x && a.y === end.y)
}

test('a Read call on the main loop sends main toward the Library and the tool still runs', async ($, on) => {
  const { ui, motion } = await startOffice($, on)
  const result = await $.tool.call({ tool: 'Read', file_path: 'x' })

  expect(result).toMatchObject({ result: 'stub' })
  expect(endsAtAnchor(motion().main, 'library')).toBe(true)
  await ui.unmount()
})

test('a subagent-scoped call moves that agent and not main', async ($, on) => {
  const { clock, ui, motion } = await startOffice($, on)
  await $.agent.spawn(spawnArgs)
  await clock.advance(100)
  const mainBefore = motion().main
  // ToolCallArgs rejects agentId at compile time, but the runtime delivers it to the
  // hook (D9, observed in T01B); the cast is a test-only workaround.
  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a1' } as never)

  expect(endsAtAnchor(motion().a1, 'server')).toBe(true)
  expect(motion().main).toEqual(mainBefore)
  await ui.unmount()
})

test('a repeated tool call does not re-path the agent', async ($, on) => {
  const { ui, motion } = await startOffice($, on)
  await $.tool.call({ tool: 'Read', file_path: 'x' })
  const first = motion()
  expect(endsAtAnchor(first.main, 'library')).toBe(true)
  await $.tool.call({ tool: 'Read', file_path: 'y' })

  expect(motion()).toBe(first)
  await ui.unmount()
})

test('a spawned Explore agent walks to a Library anchor', async ($, on) => {
  const { ui, motion } = await startOffice($, on)
  await $.agent.spawn({ ...spawnArgs, subagentType: 'Explore' })

  expect(endsAtAnchor(motion().a1, 'library')).toBe(true)
  await ui.unmount()
})

test('a spawned default agent walks to a Dev Bay anchor', async ($, on) => {
  const { ui, motion } = await startOffice($, on)
  await $.agent.spawn(spawnArgs)

  expect(endsAtAnchor(motion().a1, 'devbay')).toBe(true)
  await ui.unmount()
})

// The most steps any walk on the map can take: BFS between every pair of anchors.
const longestPath = (): number => {
  const map = buildMap(60, 18)
  const anchors = map.rooms.flatMap(r => r.anchors)
  let longest = 0
  for (const from of anchors) {
    for (const to of anchors) longest = Math.max(longest, findPath(map, from, to).length)
  }

  return longest
}

test('main messaging a1 meets, shows the bubble for 4 s, then both return to their anchors', async ($, on) => {
  const { clock, ui, motion, bubbles } = await startOffice($, on)
  const bound = longestPath()
  await $.agent.spawn(spawnArgs)
  for (let i = 0; i < bound && (motion().a1 === undefined || (motion().a1?.path.length ?? 1) > 0); i += 1) {
    await clock.advance(100)
  }
  const homes = { main: motion().main, a1: motion().a1 }
  expect(homes.a1?.path).toEqual([])
  const message = 'please review the parser changes and report back to me'
  await $.tool.call({ tool: 'SendMessage', to: 'a1', message })

  const meeting = buildMap(60, 18).rooms.find(r => r.id === 'meeting')?.anchors ?? []
  const inMeeting = (id: 'main' | 'a1'): boolean => {
    const at = motion()[id]
    return at !== undefined && at.path.length === 0 && meeting.some(a => a.x === at.x && a.y === at.y)
  }
  let ticks = 0
  while (!(inMeeting('main') && inMeeting('a1')) && ticks < bound) {
    await clock.advance(100)
    ticks += 1
  }
  expect(inMeeting('main') && inMeeting('a1')).toBe(true)
  expect(bubbles()).toMatchObject([{ agentId: 'main', text: message.slice(0, 40) }])

  await clock.advance(4000)
  expect(bubbles()).toEqual([])

  const home = (id: 'main' | 'a1'): boolean =>
    motion()[id]?.x === homes[id]?.x && motion()[id]?.y === homes[id]?.y && motion()[id]?.path.length === 0
  ticks = 0
  while (!(home('main') && home('a1')) && ticks < bound) {
    await clock.advance(100)
    ticks += 1
  }
  expect(home('main')).toBe(true)
  expect(home('a1')).toBe(true)
  await ui.unmount()
})

test('a finished subagent reports, walks to the Break Room, leaves, and never teleports', async ($, on) => {
  const { clock, ui, motion, bubbles, roster } = await startOffice($, on)
  const bound = longestPath()
  await $.agent.spawn(spawnArgs)
  for (let i = 0; i < bound && (motion().a1 === undefined || (motion().a1?.path.length ?? 1) > 0); i += 1) {
    await clock.advance(100)
  }
  expect(roster()).toContain('a1')
  // Position before the hook runs: the first sample after it must be within one step of it.
  const before = motion().a1
  const result = await $.turn.complete(turnArgs)
  // The hook returns the downstream (stub) result unchanged.
  expect(result).toEqual({ text: 'done' })

  const breakRoom = buildMap(60, 18).rooms.find(r => r.id === 'break')?.bounds
  const inBreak = (at: MotionWrite[string] | undefined): boolean =>
    breakRoom !== undefined &&
    at !== undefined &&
    at.path.length === 0 &&
    at.x >= breakRoom.x &&
    at.x < breakRoom.x + breakRoom.w &&
    at.y >= breakRoom.y &&
    at.y < breakRoom.y + breakRoom.h
  const texts = new Set<string>()
  let previous = before
  expect(previous).toBeDefined()
  let heldSince: number | undefined
  let goneAt: number | undefined
  let ticks = 0
  // Lobby walk, 4 s of bubbles, Break Room walk; the 5 s floor is shorter than all that.
  while (goneAt === undefined && ticks < 3 * bound + 100) {
    await clock.advance(100)
    ticks += 1
    for (const bubble of bubbles()) texts.add(`${bubble.agentId}:${bubble.text}`)
    const at = motion().a1
    if (previous !== undefined && at !== undefined) {
      expect(Math.abs(at.x - previous.x) + Math.abs(at.y - previous.y)).toBeLessThanOrEqual(1)
    }
    if (!roster().includes('a1')) {
      goneAt = ticks
      // It left only from the Break Room, at least 5000 ms after the turn completed.
      expect(inBreak(previous)).toBe(true)
      expect(ticks * 100).toBeGreaterThanOrEqual(5000)
    } else if (heldSince === undefined && inBreak(at) && ticks * 100 >= 5000) {
      heldSince = ticks
    }
    previous = at ?? previous
  }

  // Gone within one tick after both conditions held.
  expect(goneAt).toBeDefined()
  expect(heldSince).toBeDefined()
  expect((goneAt ?? 0) - (heldSince ?? 0)).toBeLessThanOrEqual(1)
  expect(roster()).toContain('main')
  expect([...texts]).toEqual(expect.arrayContaining(['a1:done', 'main:got it']))
  expect(motion().a1).toBeUndefined()
  await ui.unmount()
})

test('a bubble expires on the tick even when no pane was ever drawn', async ($, on) => {
  const clock = mock.clock(on)
  let latest: Array<{ agentId: string; text: string; until: number }> | undefined
  on('state.set', ($, e, next) => {
    // StateWrite types `value` as the union of every atom; only the bubbles atom is read.
    if (e.key === 'bubbles') latest = e.value as NonNullable<typeof latest>
    return next(e)
  })
  stubSession(on)
  on('agent.list', () => ({ value: [] }))
  on('tool.call', () => ({ result: 'stub' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'SendMessage', to: 'nobody', message: 'hello' })
  expect(latest).toMatchObject([{ agentId: 'main', text: 'hello' }])
  await clock.advance(4100)

  expect(latest).toEqual([])
})

test('the strip shows quick-search arrived in the Library after it reaches the room', async ($, on) => {
  const { clock, ui, motion } = await startOffice($, on)
  const bound = longestPath()
  await $.agent.spawn({ ...spawnArgs, subagentType: 'quick-search' })
  // Retarget before it walks anywhere, so the only arrival is the Library one.
  await $.tool.call({ tool: 'Read', file_path: 'x', agentId: 'a1' } as never)
  for (let i = 0; i < bound && (motion().a1?.path.length ?? 1) > 0; i += 1) {
    await clock.advance(100)
  }
  expect(motion().a1?.path).toEqual([])
  await ui.redraw(paneProps)

  expect(await ui.find({ type: 'Text', text: /quick-search arrived in the Library/ })).toBeDefined()
  // Late ticks must not log the same walk again (A3).
  await clock.advance(2000)
  await ui.redraw(paneProps)
  expect(await ui.findAll({ type: 'Text', text: /arrived/ })).toHaveLength(1)
  await ui.unmount()
})

test('a SendMessage meeting logs the told line and no arrival in the Meeting Room', async ($, on) => {
  const { clock, ui } = await startOffice($, on)
  await $.agent.spawn({ ...spawnArgs, name: 'a1' })
  await $.tool.call({ tool: 'SendMessage', to: 'a1', message: 'hello' })
  await clock.advance((longestPath() + 5) * 100)
  await ui.redraw(paneProps)

  expect(await ui.find({ type: 'Text', text: /main told a1: hello/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /arrived in the Meeting Room/ })).toBeUndefined()
  await ui.unmount()
})

test('the strip always renders exactly five truncating rows', async ($, on) => {
  const { ui } = await startOffice($, on)
  await $.agent.spawn({ ...spawnArgs, name: 'a1' })
  const rows = async () => {
    await ui.redraw(paneProps)

    return ui.findAll({ type: 'Text' })
  }
  expect(await rows()).toHaveLength(5)
  for (let i = 0; i < 3; i += 1) await $.tool.call({ tool: 'SendMessage', to: 'a1', message: `m${i}` })
  expect(await rows()).toHaveLength(5)
  for (let i = 0; i < 5; i += 1) await $.tool.call({ tool: 'SendMessage', to: 'a1', message: `n${i}` })
  const full = await rows()
  expect(full).toHaveLength(5)
  expect(full.every(row => row.props.wrap === 'truncate-end')).toBe(true)
  await ui.unmount()
})

test('the strip shows main told a1: hello', async ($, on) => {
  const { ui } = await startOffice($, on)
  await $.agent.spawn({ ...spawnArgs, name: 'a1' })
  await $.tool.call({ tool: 'SendMessage', to: 'a1', message: 'hello' })
  await ui.redraw(paneProps)

  expect(await ui.find({ type: 'Text', text: /main told a1: hello/ })).toBeDefined()
  await ui.unmount()
})

test('a second session.start keeps the roster and exactly one blit happens per tick', async ($, on) => {
  const clock = mock.clock(on)
  stubSession(on)
  const roster = watchRoster(on)
  const blits: string[] = []
  on('ui.blit', ($, e) => {
    blits.push(e.key)
    return { value: {} }
  })
  on('agent.list', () => ({ value: [] }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(paneAt(18 + STRIP_ROWS))
  await clock.advance(100)
  await $.agent.spawn(spawnArgs)
  await clock.advance(100)
  expect(roster()).toContain('a1')

  // A reload runs session.start again in the same environment; a1 is still walking in.
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(roster()).toContain('a1')
  blits.length = 0
  await clock.advance(100)

  expect(roster()).toContain('a1')
  expect(blits).toHaveLength(1)
  await clock.advance(100)
  expect(blits).toHaveLength(2)
  await ui.unmount()
})

test('a turn.complete for an unknown agent changes nothing and resolves', async ($, on) => {
  const { clock, ui, logs, roster, motion, bubbles } = await startOffice($, on)
  await $.agent.spawn(spawnArgs)
  await clock.advance(100)
  const before = { roster: roster(), motion: motion(), bubbles: bubbles() }
  const result = await $.turn.complete({ ...turnArgs, agentId: 'ghost' })
  await $.turn.complete({ ...turnArgs, agentId: undefined })

  expect(result).toEqual({ text: 'done' })
  expect(logs.filter(text => /agents-office:.*threw/.test(text))).toEqual([])
  expect({ roster: roster(), motion: motion(), bubbles: bubbles() }).toEqual(before)
  await ui.unmount()
})

test('a SendMessage with a numeric to still runs the tool', async ($, on) => {
  const { ui, bubbles } = await startOffice($, on)
  await $.agent.spawn(spawnArgs)
  const result = await $.tool.call({ tool: 'SendMessage', to: 42, message: 'hello' })

  expect(result).toMatchObject({ result: 'stub' })
  // Bubble-only path (D39): the speaker shows the text, nobody walks to a meeting.
  expect(bubbles()).toMatchObject([{ agentId: 'main', text: 'hello' }])
  await ui.unmount()
})

test('a ui.blit that throws leaves the frame loop running and repaints next tick', async ($, on) => {
  const clock = mock.clock(on)
  stubSession(on)
  on('agent.list', () => ({ value: [] }))
  let calls = 0
  on('ui.blit', () => {
    calls += 1
    if (calls === 1) throw new Error('blit boom')

    return { value: {} }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(paneAt(18 + STRIP_ROWS))
  await clock.advance(100)
  await clock.advance(100)
  await clock.advance(100)

  // The throwing first blit cleared the frame cache, so the next tick blits the same frame again.
  expect(calls).toBeGreaterThanOrEqual(2)
  await ui.unmount()
})

test('a hook body that throws is logged as "agents-office: <name> threw" and the session still starts', async ($, on) => {
  const logs: string[] = []
  stubSession(on, logs)
  on('agent.list', () => {
    throw new Error('list boom')
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(logs.filter(text => /^agents-office: .+ threw /.test(text))).not.toEqual([])
})

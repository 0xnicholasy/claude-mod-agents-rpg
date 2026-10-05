import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { buildOffice } from './map'
import { findPath } from './path'
import { STRIP_ROWS } from './timing'
import type { OfficeMap } from './map'
const buildMap = (columns: number, rows: number): OfficeMap => buildOffice(columns, rows, [{ id: 'team:t1', label: 'proj' }], 'team:t1')

const paneProps = {
  title: 'Office',
  isFocused: false,
  bodyColumns: 60,
  placement: 'inline',
  // 18 map rows plus the 5 strip rows of a full-height body (D29, D52).
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
      text: 'Office needs a 60x11 pane, this one is 50x12. Widen or heighten the terminal.',
    }),
  ).toBeDefined()
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(await ui.findAll({ type: 'Text' })).toHaveLength(1)
  expect(blits).toHaveLength(0)
  await ui.unmount()
})

test('the widen line and Raster switch at the 60x11 body-size boundary', async ($, on) => {
  mock.clock(on)
  stubSession(on)
  on('agent.list', () => ({ value: [] }))
  on('ui.blit', () => ({ value: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const cases = [
    { columns: 59, rows: 11, raster: false },
    { columns: 60, rows: 10, raster: false },
    { columns: 60, rows: 11, raster: true },
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
        props: { columns: 60, rows: 11 },
      })
      expect(await ui.find({ type: 'Text', text: /Office needs a/ })).toBeUndefined()
    } else {
      expect(await ui.findAll({ type: 'Text' })).toHaveLength(1)
      expect(
        await ui.find({
          type: 'Text',
          text: `Office needs a 60x11 pane, this one is ${c.columns}x${c.rows}. Widen or heighten the terminal.`,
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

test('the pane draws the pad input', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount(paneAt(18 + STRIP_ROWS))

  expect(await ui.find({ type: 'Input', key: 'pad-input' })).toBeDefined()
  await ui.unmount()
})

test('typing into the pad records a coalesced burst and flips the drawn value', async ($, on) => {
  mock.clock(on)
  let pad: { handled: string; clear: string; intent?: { key: string; taps: number } } | undefined
  on('state.set', ($, e, next) => {
    // StateWrite types `value` as the union of every atom; only the pad atom is read.
    if (e.key === 'pad') pad = e.value as typeof pad
    return next(e)
  })
  const ui = await $.ui.mount(paneAt(18 + STRIP_ROWS))
  await $.ui.input({ plugin: 'agents-office', key: 'pad-input', text: 'wwww', kind: 'change' })

  expect(pad).toMatchObject({ handled: 'wwww', clear: ' ', intent: { key: 'w', taps: 4 } })
  // A repeated value is not typed again.
  await $.ui.input({ plugin: 'agents-office', key: 'pad-input', text: 'wwww', kind: 'change' })
  expect(pad?.intent?.taps).toBe(4)
  await ui.unmount()
})

test('a pad key walks the player one tile per tick', async ($, on) => {
  const clock = mock.clock(on)
  const xs: number[] = []
  on('state.set', ($, e, next) => {
    // StateWrite types `value` as the union of every atom; only the player atom is read.
    if (e.key === 'player') xs.push((e.value as { x: number }).x)
    return next(e)
  })
  on('ui.blit', () => ({ value: {} }))
  on('agent.list', () => ({ value: [] }))
  stubSession(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(paneAt(18 + STRIP_ROWS))
  await clock.advance(100)
  const spawn = xs[0]
  expect(spawn).toBeDefined()
  await $.ui.input({ plugin: 'agents-office', key: 'pad-input', text: 'ddd', kind: 'change' })
  await clock.advance(100)
  expect(xs.at(-1)).toBe((spawn ?? 0) + 1)
  await clock.advance(100)
  expect(xs.at(-1)).toBe((spawn ?? 0) + 2)
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

test('/office opens the pane with focus and the pad asks for focus after 1500 ms', async ($, on) => {
  const clock = mock.clock(on)
  let focusRequested: boolean | undefined
  on('ui.open', ($, e) => {
    focusRequested = e.focus
    return { value: { isPlaced: true } }
  })
  const logs: string[] = []
  on('ui.log', (_$, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  await $.command.run({
    command: 'office',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })
  expect(focusRequested).toBe(true)
  await clock.advance(1499)
  expect(logs).toEqual([])
  await clock.advance(1)

  // The test engine does not dispatch `$.ui.focus` to an `on('ui.focus')` hook, so it answers "no
  // implementation"; the plugin logs that once, which proves the call was made at 1500 ms.
  expect(logs.filter(text => text.startsWith('agents-office: pad focus'))).toHaveLength(1)
  await clock.advance(1500)
  expect(logs).toHaveLength(1)
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
  on('session.id', () => ({ value: 't1' }))
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

test('a spawned agent enters at the Reception door, then one tile further per 100 ms tick', async ($, on) => {
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

  const reception = buildMap(60, 18).rooms.find(r => r.id === 'reception')
  expect(positions).toHaveLength(3)
  expect(positions[0]).toEqual(reception?.doorStand)
  for (const [i, p] of positions.slice(1).entries()) {
    const prev = positions[i]
    expect(Math.abs(p.x - (prev?.x ?? 0)) + Math.abs(p.y - (prev?.y ?? 0))).toBe(1)
  }
  await ui.unmount()
})

type MotionWrite = Record<string, { x: number; y: number; path: Array<{ x: number; y: number }> }>

// Starts a session with a mounted pane and returns a reader for the latest motion write.
// `v1Roster`, when given, replaces the first roster write (the session.start seed), as if a v1 mod had stored it.
const startOffice = async ($: Engine, on: On, v1Roster?: Record<string, unknown>) => {
  const clock = mock.clock(on)
  let seedPending = v1Roster !== undefined
  let latest: MotionWrite = {}
  let latestBubbles: Array<{ agentId: string; text: string; until: number }> = []
  let latestRoster: string[] = []
  let latestAgents: Record<string, { room: string; home: string; pose: string }> = {}
  const logs: string[] = []
  on('state.set', ($, e, next) => {
    // StateWrite types `value` as the union of every atom; only the motion, bubbles and agents atoms are read.
    if (e.key === 'agents' && seedPending) {
      seedPending = false
      return next({ ...e, value: v1Roster as never })
    }
    if (e.key === 'agents') {
      latestRoster = Object.keys(e.value as Record<string, unknown>)
      latestAgents = e.value as typeof latestAgents
    }
    if (e.key === 'motion') latest = e.value as MotionWrite
    if (e.key === 'bubbles') latestBubbles = e.value as typeof latestBubbles
    return next(e)
  })
  stubSession(on, logs)
  // The share preference read in session.start: nothing stored.
  on('store.get', () => ({ value: undefined }))
  // The branch lookup in session.start: a repo with no branch (detached HEAD).
  on('process.run', () => ({
    value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('agent.list', () => ({ value: [] }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('ui.blit', () => ({ value: {} }))
  on('tool.call', () => ({ result: 'stub' }))
  on('turn.complete', () => ({ text: 'done' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(paneAt(18 + STRIP_ROWS))
  await clock.advance(100)

  return { clock, ui, logs, motion: () => latest, bubbles: () => latestBubbles, roster: () => latestRoster, agents: () => latestAgents }
}

const endsAtAnchor = (entry: MotionWrite[string] | undefined, room: string): boolean => {
  const end = entry?.path[entry.path.length - 1]
  const anchors = buildMap(60, 18).rooms.find(r => r.id === room)?.anchors ?? []

  return end !== undefined && anchors.some(a => a.x === end.x && a.y === end.y)
}

test('a Read call seats main at its team desk in the read pose and the tool still runs', async ($, on) => {
  const { ui, motion, agents } = await startOffice($, on)
  const result = await $.tool.call({ tool: 'Read', file_path: 'x' })
  const desk = buildMap(60, 18).rooms.find(r => r.id === 'team:t1')?.anchors[0]

  expect(result).toMatchObject({ result: 'stub' })
  expect(agents().main).toMatchObject({ room: 'team:t1', pose: 'read' })
  expect(motion().main).toMatchObject({ x: desk?.x, y: desk?.y, path: [] })
  await ui.unmount()
})

test('a Bash call walks main to the Test Lab', async ($, on) => {
  const { ui, motion, agents } = await startOffice($, on)
  await $.tool.call({ tool: 'Bash', command: 'ls' })

  expect(agents().main).toMatchObject({ room: 'lab', pose: 'run' })
  expect(endsAtAnchor(motion().main, 'lab')).toBe(true)
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

  expect(endsAtAnchor(motion().a1, 'lab')).toBe(true)
  expect(motion().main).toEqual(mainBefore)
  await ui.unmount()
})

test('a repeated tool call does not re-path the agent', async ($, on) => {
  const { ui, motion } = await startOffice($, on)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  const first = motion()
  expect(endsAtAnchor(first.main, 'lab')).toBe(true)
  await $.tool.call({ tool: 'Bash', command: 'pwd' })

  expect(motion()).toBe(first)
  await ui.unmount()
})

test('a spawned Explore agent walks to a team desk', async ($, on) => {
  const { ui, motion } = await startOffice($, on)
  await $.agent.spawn({ ...spawnArgs, subagentType: 'Explore' })

  expect(endsAtAnchor(motion().a1, 'team:t1')).toBe(true)
  await ui.unmount()
})

test('a spawned default agent enters at Reception and walks to a team desk', async ($, on) => {
  const { ui, motion } = await startOffice($, on)
  await $.agent.spawn(spawnArgs)

  expect(endsAtAnchor(motion().a1, 'team:t1')).toBe(true)
  await ui.unmount()
})

test('a v1 roster is migrated on the first tick', async ($, on) => {
  const v1 = (id: string, room: string): Record<string, unknown> => ({
    id, label: id, tier: 'grey', status: 'working', room, pose: 'idle', home: room, teammate: false,
  })
  const roster = { main: v1('main', 'lobby'), a1: v1('a1', 'devbay'), a2: v1('a2', 'library'), a3: v1('a3', 'server') }
  const { clock, ui, agents } = await startOffice($, on, roster)
  await clock.advance(100)
  await clock.advance(100)

  expect(agents().main).toMatchObject({ room: 'reception', home: 'team:t1' })
  expect(agents().a1).toMatchObject({ room: 'team:t1', home: 'team:t1' })
  expect(agents().a2).toMatchObject({ room: 'team:t1', home: 'team:t1' })
  expect(agents().a3).toMatchObject({ room: 'lab', home: 'lab' })
  expect(JSON.stringify(agents())).not.toMatch(/lobby|devbay|library|server|meeting|break|phone/)
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

  const meeting = buildMap(60, 18).rooms.find(r => r.id === 'conference')?.anchors ?? []
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

test('a finished subagent reports in Reception, walks to the Kitchen, leaves, and never teleports', async ($, on) => {
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

  const kitchen = buildMap(60, 18).rooms.find(r => r.id === 'kitchen')?.bounds
  const inKitchen = (at: MotionWrite[string] | undefined): boolean =>
    kitchen !== undefined &&
    at !== undefined &&
    at.path.length === 0 &&
    at.x >= kitchen.x &&
    at.x < kitchen.x + kitchen.w &&
    at.y >= kitchen.y &&
    at.y < kitchen.y + kitchen.h
  const texts = new Set<string>()
  let previous = before
  expect(previous).toBeDefined()
  let heldSince: number | undefined
  let goneAt: number | undefined
  let ticks = 0
  // Reception walk, 4 s of bubbles, Kitchen walk; the 5 s floor is shorter than all that.
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
      // It left only from the Kitchen, at least 5000 ms after the turn completed.
      expect(inKitchen(previous)).toBe(true)
      expect(ticks * 100).toBeGreaterThanOrEqual(5000)
    } else if (heldSince === undefined && inKitchen(at) && ticks * 100 >= 5000) {
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

test('the strip shows quick-search arrived in its team room after it reaches the room', async ($, on) => {
  const { clock, ui, motion } = await startOffice($, on)
  const bound = longestPath()
  await $.agent.spawn({ ...spawnArgs, subagentType: 'quick-search' })
  // Retarget before it walks anywhere, so the only arrival is the team-room one.
  await $.tool.call({ tool: 'Read', file_path: 'x', agentId: 'a1' } as never)
  for (let i = 0; i < bound && (motion().a1?.path.length ?? 1) > 0; i += 1) {
    await clock.advance(100)
  }
  expect(motion().a1?.path).toEqual([])
  await ui.redraw(paneProps)

  expect(await ui.find({ type: 'Text', text: /quick-search arrived in the office/ })).toBeDefined()
  // Late ticks must not log the same walk again (A3).
  await clock.advance(2000)
  await ui.redraw(paneProps)
  expect(await ui.findAll({ type: 'Text', text: /arrived/ })).toHaveLength(1)
  await ui.unmount()
})

test('a SendMessage meeting logs the told line and no arrival in the Conference Room', async ($, on) => {
  const { clock, ui } = await startOffice($, on)
  await $.agent.spawn({ ...spawnArgs, name: 'a1' })
  await $.tool.call({ tool: 'SendMessage', to: 'a1', message: 'hello' })
  await clock.advance((longestPath() + 5) * 100)
  await ui.redraw(paneProps)

  expect(await ui.find({ type: 'Text', text: /main told a1: hello/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /arrived in the Conference Room/ })).toBeUndefined()
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

test('a 14-row body shows the two newest strip lines', async ($, on) => {
  const { ui } = await startOffice($, on)
  await $.agent.spawn({ ...spawnArgs, name: 'a1' })
  for (let i = 0; i < 3; i += 1) await $.tool.call({ tool: 'SendMessage', to: 'a1', message: `m${i}` })
  await ui.redraw({ ...paneProps, placement: 'dock', scroll: { offset: 0, bodyRows: 14 } })
  const rows = await ui.findAll({ type: 'Text' })

  expect(rows).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: /told a1: m2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /told a1: m1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /told a1: m0/ })).toBeUndefined()
  // Oldest of the two first: m1 renders before m2.
  expect(rows[0]?.text).toContain('m1')
  expect(rows[1]?.text).toContain('m2')
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

test('session.start labels the team room with the project and branch', async ($, on) => {
  mock.clock(on)
  stubSession(on)
  on('agent.list', () => ({ value: [] }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: 'feat/x\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  let label = ''
  on('state.set', ($, e, next) => {
    // StateWrite types `value` as the union of every atom; only the team atom is read.
    if (e.key === 'team') label = (e.value as { label: string }).label
    return next(e)
  })
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })

  expect(label).toBe('proj (feat/x)')
})

test('the loop still blits when the branch lookup fails', async ($, on) => {
  const clock = mock.clock(on)
  stubSession(on)
  const blits: string[] = []
  on('ui.blit', ($, e) => {
    blits.push(e.key)
    return { value: {} }
  })
  on('agent.list', () => ({ value: [] }))
  on('process.run', () => {
    throw new Error('git missing')
  })
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(paneAt(18 + STRIP_ROWS))
  await clock.advance(100)

  expect(blits.length).toBeGreaterThan(0)
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

const viewportPane = (placement: 'dock' | 'inline', bodyColumns: number, bodyRows: number, viewport: { columns: number; rows: number; isFullscreen: boolean }) =>
  ({
    plugin: 'agents-office',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'office',
    props: { ...paneProps, placement, bodyColumns, scroll: { offset: 0, bodyRows } },
    viewport,
  }) as const

test('an inline pane sizes from the viewport, not from a 1-row bodyRows', async ($, on) => {
  mock.clock(on)
  stubSession(on)
  on('agent.list', () => ({ value: [] }))
  on('ui.blit', () => ({ value: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(viewportPane('inline', 76, 1, { columns: 80, rows: 24, isFullscreen: false }))

  expect(await ui.find({ type: 'Raster', key: 'office' })).toMatchObject({ props: { columns: 76, rows: 11 } })
  expect(await ui.findAll({ type: 'Text' })).toHaveLength(0)
  await ui.unmount()
})

test('an inline pane on a 160x50 terminal stops at 23 body rows', async ($, on) => {
  mock.clock(on)
  stubSession(on)
  on('agent.list', () => ({ value: [] }))
  on('ui.blit', () => ({ value: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(viewportPane('inline', 156, 1, { columns: 160, rows: 50, isFullscreen: false }))

  expect(await ui.find({ type: 'Raster', key: 'office' })).toMatchObject({ props: { columns: 156, rows: 18 } })
  expect(await ui.findAll({ type: 'Text' })).toHaveLength(5)
  await ui.unmount()
})

test('a docked pane sizes from bodyRows and ignores the viewport', async ($, on) => {
  mock.clock(on)
  stubSession(on)
  on('agent.list', () => ({ value: [] }))
  on('ui.blit', () => ({ value: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(viewportPane('dock', 60, 40, { columns: 200, rows: 50, isFullscreen: true }))

  expect(await ui.find({ type: 'Raster', key: 'office' })).toMatchObject({ props: { columns: 60, rows: 35 } })
  await ui.unmount()
})

test('inspect shows for 6 s and a messages deny keeps the base text', async ($, on) => {
  const clock = mock.clock(on)
  const lines: Array<string | null> = []
  on('state.set', ($, e, next) => {
    // StateWrite types `value` as the union of every atom; only the inspect atom is read.
    if (e.key === 'inspect') lines.push((e.value as { text: string } | null)?.text ?? null)
    return next(e)
  })
  on('ui.blit', () => ({ value: {} }))
  on('agent.list', () => ({ value: [] }))
  on('session.messages', () => ({ value: { deny: 'no transcript' } }))
  stubSession(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(paneAt(11))
  await clock.advance(100)
  // `]` then `[` walks the player out of its room and back onto the first desk, beside main.
  await $.ui.input({ plugin: 'agents-office', key: 'pad-input', text: ']', kind: 'change' })
  await clock.advance(6000)
  await $.ui.input({ plugin: 'agents-office', key: 'pad-input', text: '[', kind: 'change' })
  await clock.advance(6000)
  await $.ui.input({ plugin: 'agents-office', key: 'pad-input', text: 'e', kind: 'change' })
  await clock.advance(100)
  expect(lines.at(-1)).toMatch(/^main \| working \| \w+ \| .+ \| 0s$/)
  await clock.advance(5800)
  expect(lines.at(-1)).not.toBeNull()
  await clock.advance(300)
  expect(lines.at(-1)).toBeNull()
  await ui.unmount()
})

// A store kept in a map, so a test can read what the plugin persisted ($ has no store member).
const stubStore = (on: On, entries: Record<string, unknown> = {}): Map<string, unknown> => {
  const kept = new Map<string, unknown>(Object.entries(entries))
  on('store.get', (_$, e) => ({ value: kept.get(e.key) }))
  on('store.set', (_$, e) => {
    kept.set(e.key, e.value)
    return { value: undefined }
  })

  return kept
}

const runOffice = (args: string) =>
  ({ command: 'office', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as const

test('/office share anon is stored', async ($, on) => {
  const kept = stubStore(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const result = await $.command.run(runOffice('share anon'))

  expect(result).toMatchObject({ text: 'Office sharing: anon' })
  expect(kept.get('share')).toBe('anon')
})

test('/office share bogus shows usage', async ($, on) => {
  const kept = stubStore(on, { share: 'all' })
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  const result = await $.command.run(runOffice('share bogus'))

  expect(result).toMatchObject({ text: 'Usage: /office share all|anon|off' })
  expect(kept.get('share')).toBe('all')
  expect(opened).toEqual([])
})

test('/office with no arguments still opens the pane', async ($, on) => {
  stubStore(on)
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  await $.command.run(runOffice(''))

  expect(opened).toEqual(['office'])
})

test('session.start resolves the presence dir from printenv and loads the stored share mode', async ($, on) => {
  mock.clock(on)
  stubStore(on, { share: 'off' })
  stubSession(on)
  on('agent.list', () => ({ value: [] }))
  const asked: string[][] = []
  on('process.run', (_$, e) => {
    asked.push([...e.argv])
    const value = e.argv[1] === 'CLAUDE_CONFIG_DIR' ? '' : '/home/u\n'

    return { value: { exitCode: 0, stdout: value, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const writes: Array<{ key: string; value: unknown }> = []
  on('state.set', ($, e, next) => {
    writes.push({ key: e.key, value: e.value })
    return next(e)
  })
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })

  expect(asked).toContainEqual(['printenv', 'CLAUDE_CONFIG_DIR'])
  expect(asked).toContainEqual(['printenv', 'HOME'])
  expect(writes.find(w => w.key === 'identity')?.value).toMatchObject({ sessionId: 't1', dir: '/home/u/.claude/agents-office/presence' })
  expect(writes.find(w => w.key === 'share')?.value).toBe('off')
})

// Starts a session that resolves a presence dir and records every fs.write and process.run.
const startPresence = async ($: Engine, on: On, share = 'all') => {
  const clock = mock.clock(on)
  stubStore(on, { share })
  stubSession(on)
  on('agent.list', () => ({ value: [] }))
  on('ui.blit', () => ({ value: {} }))
  on('tool.call', () => ({ result: 'stub' }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('session.end', () => ({ sessionId: 't1' }))
  const runs: string[][] = []
  on('process.run', (_$, e) => {
    runs.push([...e.argv])
    const stdout = e.argv[0] === 'printenv' ? (e.argv[1] === 'HOME' ? '/home/u\n' : '') : ''

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const writes: Array<{ path: string; text: string }> = []
  on('fs.write', (_$, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })

  return { clock, runs, writes }
}

test('presence writes on change and every 3 s', async ($, on) => {
  const { clock, writes } = await startPresence($, on)
  const path = '/home/u/.claude/agents-office/presence/t1.json'
  await clock.advance(999)
  expect(writes).toHaveLength(0)
  await clock.advance(1)
  expect(writes).toHaveLength(1)
  expect(writes[0]?.path).toBe(path)
  const first = JSON.parse(writes[0]?.text ?? '{}') as { sessionId: string; share: string; team: { label: string }; player: unknown }
  expect(first).toMatchObject({ sessionId: 't1', share: 'all', team: { label: 'proj' }, player: null })
  await clock.advance(1000)
  expect(writes).toHaveLength(1)
  await clock.advance(1000)
  expect(writes).toHaveLength(1)
  await clock.advance(1000)
  expect(writes).toHaveLength(2)
  expect(JSON.parse(writes[1]?.text ?? '{}').heartbeatAt).toBe(4000)
})

test('the presence timer reads only changed foreign files into the remote atom, and share off clears it', async ($, on) => {
  const dir = '/home/u/.claude/agents-office/presence'
  const remoteRecord = JSON.stringify({
    v: 1,
    sessionId: 's2',
    startedAt: 1,
    heartbeatAt: 900,
    share: 'all',
    team: { label: 'other (main)', branch: 'main' },
    agents: [{ id: 'main', label: 'main', tier: 'opus', role: 'lead', room: 'team:s2', pose: 'type', status: 'working' }],
    player: null,
  })
  const reads: string[] = []
  on('fs.list', () => ({
    value: [
      { name: 't1.json', kind: 'file', size: 1, mtimeMs: 900, isLink: false },
      { name: 's2.json', kind: 'file', size: 1, mtimeMs: 900, isLink: false },
    ],
  }))
  on('fs.read', (_$, e) => {
    reads.push(e.path)
    return { value: remoteRecord }
  })
  const remotes: unknown[] = []
  on('state.set', ($$, e, next) => {
    if (e.key === 'remote') remotes.push(e.value)
    return next(e)
  })
  const { clock } = await startPresence($, on)
  await clock.advance(1000)
  await clock.advance(2000)

  expect(reads).toEqual([`${dir}/s2.json`])
  expect(remotes).toHaveLength(1)
  expect(Object.keys(remotes[0] as Record<string, unknown>)).toEqual(['s2'])
  await $.command.run(runOffice('share off'))
  await clock.advance(1000)
  expect(remotes[remotes.length - 1]).toEqual({})
})

test('a tool call with a path and a SendMessage never reach the presence file', async ($, on) => {
  const { clock, writes } = await startPresence($, on)
  await $.agent.spawn({ ...spawnArgs, prompt: 'hunter2 prompt', description: '/Users/x/secret.ts task' })
  await $.tool.call({ tool: 'Read', file_path: '/Users/x/secret.ts' })
  await $.tool.call({ tool: 'SendMessage', to: 'a1', message: 'hunter2' })
  await clock.advance(1000)

  // The agent is in the file, so the roster really held the message and the description when it was written.
  expect(writes.at(-1)?.text).toContain('"id":"a1"')
  for (const w of writes) {
    expect(w.text).not.toContain('secret.ts')
    expect(w.text).not.toContain('hunter2')
  }
})

test('session.end writes a tombstone', async ($, on) => {
  const { clock, writes } = await startPresence($, on)
  await clock.advance(1000)
  await $.session.end({ reason: 'other', sessionId: 't1', resume: { id: 't1' } })
  await clock.advance(5000)

  expect(writes).toHaveLength(2)
  expect(JSON.parse(writes[1]?.text ?? '{}')).toMatchObject({ v: 1, sessionId: 't1', gone: true })
})

test('share off writes one tombstone and then nothing, and skips the cleanup', async ($, on) => {
  const { clock, runs, writes } = await startPresence($, on, 'off')
  await clock.advance(5000)

  expect(writes).toHaveLength(1)
  expect(JSON.parse(writes[0]?.text ?? '{}')).toMatchObject({ gone: true })
  expect(runs.some(argv => argv[0] === 'find')).toBe(false)
})

test('session.start deletes presence files older than a day', async ($, on) => {
  const { runs } = await startPresence($, on)

  expect(runs).toContainEqual(['find', '/home/u/.claude/agents-office/presence', '-maxdepth', '1', '-type', 'f', '-name', '*.json', '-mmin', '+1440', '-delete'])
})

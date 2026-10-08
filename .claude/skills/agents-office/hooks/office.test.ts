import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, UiPane } from 'claude-code'
import { itemsOf } from './items'
import type { Item } from './items'
import { mapFor } from './loop'
import { COOLER_LINES, rectGap } from './use'
import { buildOffice, canStand, CAT_FOOT, MID_FOOT } from './map'
import { findPath } from './path'
import { NUDGE_TEXT } from './pad'
import { STRIP_ROWS, TICK_MS } from './timing'
import type { OfficeMap, Rect } from './map'
import type { SceneFigure, SceneModel } from './scene'
const buildMap = (columns: number, rows: number): OfficeMap => buildOffice(columns, rows, [{ id: 'team:t1', label: 'proj' }], MID_FOOT)

const paneProps = {
  title: 'Office',
  isFocused: false,
  bodyColumns: 76,
  placement: 'inline',
  // 23 mid map rows plus the 5 strip rows of a full-height body (D29, D52); the strip shows only past 23 body rows.
  scroll: { offset: 0, bodyRows: 23 + STRIP_ROWS },
  view: {},
} as const

// 76 x 23 cells of 12 bytes, base64 encoded.
const FRAME_LENGTH = 4 * Math.ceil((76 * 23 * 12) / 3)

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
  const ui = await $.ui.mount(paneAt(23 + STRIP_ROWS))
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
  expect(await ui.find({ type: 'Raster' })).toMatchObject({ props: { columns: 76, rows: 23 } })
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
  const ui = await $.ui.mount(paneAt(23 + STRIP_ROWS))

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
  const ui = await $.ui.mount(paneAt(23 + STRIP_ROWS))
  await $.ui.input({ plugin: 'agents-office', key: 'pad-input', text: 'wwww', kind: 'change' })

  expect(pad).toMatchObject({ handled: 'wwww', clear: ' ', intent: { key: 'w', taps: 4 } })
  // A repeated value is not typed again.
  await $.ui.input({ plugin: 'agents-office', key: 'pad-input', text: 'wwww', kind: 'change' })
  expect(pad?.intent?.taps).toBe(4)
  await ui.unmount()
})

test('a pad key walks the player one tile, then two per tick while held', async ($, on) => {
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
  const ui = await $.ui.mount(paneAt(23 + STRIP_ROWS))
  await clock.advance(100)
  const spawn = xs[0]
  expect(spawn).toBeDefined()
  await $.ui.input({ plugin: 'agents-office', key: 'pad-input', text: 'ddd', kind: 'change' })
  await clock.advance(100)
  expect(xs.at(-1)).toBe((spawn ?? 0) + 1)
  await clock.advance(100)
  expect(xs.at(-1)).toBe((spawn ?? 0) + 3)
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
  on('ui.panes', () => ({ value: [] }))
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

test('a module loaded over a drawn pane re-opens the pane with focus once, with no /office (D73)', async ($, on) => {
  const clock = mock.clock(on)
  const logs: string[] = []
  stubSession(on, logs)
  on('agent.list', () => ({ value: [] }))
  on('ui.blit', () => ({ value: {} }))
  const opens: Array<{ id: string; focus?: true }> = []
  on('ui.open', (_$, e) => {
    opens.push({ id: e.id, focus: e.focus })
    return { value: { isPlaced: true } }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  expect(opens).toEqual([])
  // No pane is drawn yet: nothing to focus.
  expect(logs.filter(text => text.startsWith('agents-office: pad focus'))).toHaveLength(0)
  const ui = await $.ui.mount({
    plugin: 'agents-office',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'office',
    props: paneProps,
  })
  await clock.advance(1000)
  expect(opens).toEqual([{ id: 'office', focus: true }])
  await clock.advance(1500)
  // The test engine answers `$.ui.focus` with "no implementation", which the plugin logs once per call made.
  expect(logs.filter(text => text.startsWith('agents-office: pad focus'))).toHaveLength(1)
  await clock.advance(5000)
  expect(opens).toHaveLength(1)
  expect(logs.filter(text => text.startsWith('agents-office: pad focus'))).toHaveLength(1)
  await ui.unmount()
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
// `panes` is what `$.ui.panes()` lists: none by default.
const stubSession = (on: On, logs?: string[], panes: UiPane[] = []): void => {
  on('ui.panes', () => ({ value: panes }))
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

// A peek tab left up by an earlier session in the same process (/clear, a resume) is closed by the next session.start and by
// /office, so the office is the pane in front.
const PEEK_UP: UiPane[] = [{ id: 'office-peek', title: 'Whiteboard', isShown: true, isFocused: false, isPlaced: true }]

const watchClosed = (on: On): string[] => {
  const closed: string[] = []
  on('ui.close', (_$, e) => {
    closed.push(e.id)

    return { value: undefined }
  })

  return closed
}

test('session.start closes a peek tab an earlier session left up', async ($, on) => {
  mock.clock(on)
  stubSession(on, undefined, PEEK_UP)
  on('agent.list', () => ({ value: [] }))
  const closed = watchClosed(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(closed).toEqual(['office-peek'])
})

test('/office closes a peek tab that is up so the office shows in front', async ($, on) => {
  mock.clock(on)
  stubSession(on, undefined, PEEK_UP)
  stubStore(on)
  on('agent.list', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const closed = watchClosed(on)
  await $.command.run(runOffice(''))

  expect(closed).toEqual(['office-peek'])
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
  const first = await $.ui.mount(paneAt(23 + STRIP_ROWS))
  await clock.advance(100)
  await first.unmount()
  const second = await $.ui.mount(paneAt(25 + STRIP_ROWS))
  await clock.advance(100)

  expect(lengths).toHaveLength(2)
  expect(lengths[1]).toBe(4 * Math.ceil((76 * 25 * 12) / 3))
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
  const ui = await $.ui.mount(paneAt(23 + STRIP_ROWS))
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
  const ui = await $.ui.mount(paneAt(23 + STRIP_ROWS))
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
  const ui = await $.ui.mount(paneAt(23 + STRIP_ROWS))
  await clock.advance(100)
  await $.agent.spawn(spawnArgs)
  await clock.advance(100)
  await clock.advance(100)

  const reception = buildMap(76, 23).rooms.find(r => r.id === 'reception')
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
  // A mounted pane makes the tick re-open it with focus once (D73).
  on('ui.open', () => ({ value: { isPlaced: true } }))
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
  // The share preference read in session.start: nothing stored. The scene is pinned to the v2 text office (T13: `auto` probes).
  on('store.get', (_$, e) => ({ value: e.key === 'scene' ? 'text' : undefined }))
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
  const ui = await $.ui.mount(paneAt(23 + STRIP_ROWS))
  await clock.advance(100)

  return { clock, ui, logs, motion: () => latest, bubbles: () => latestBubbles, roster: () => latestRoster, agents: () => latestAgents }
}

const endsAtAnchor = (entry: MotionWrite[string] | undefined, room: string): boolean => {
  const end = entry?.path[entry.path.length - 1]
  const anchors = buildMap(76, 23).rooms.find(r => r.id === room)?.anchors ?? []

  return end !== undefined && anchors.some(a => a.x === end.x && a.y === end.y)
}

test('a Read call seats main at its team desk in the read pose and the tool still runs', async ($, on) => {
  const { ui, motion, agents } = await startOffice($, on)
  const result = await $.tool.call({ tool: 'Read', file_path: 'x' })
  const desk = buildMap(76, 23).rooms.find(r => r.id === 'team:t1')?.anchors[0]

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
  const map = buildMap(76, 23)
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

  const meeting = buildMap(76, 23).rooms.find(r => r.id === 'conference')?.anchors ?? []
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

  const kitchen = buildMap(76, 23).rooms.find(r => r.id === 'kitchen')?.bounds
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

test('a 25-row body shows the newest strip line and the caption in the last row', async ($, on) => {
  const { ui } = await startOffice($, on)
  await $.agent.spawn({ ...spawnArgs, name: 'a1' })
  for (let i = 0; i < 3; i += 1) await $.tool.call({ tool: 'SendMessage', to: 'a1', message: `m${i}` })
  await ui.redraw({ ...paneProps, placement: 'dock', scroll: { offset: 0, bodyRows: 23 + 2 } })
  const rows = await ui.findAll({ type: 'Text' })

  expect(rows).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: /told a1: m1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /told a1: m0/ })).toBeUndefined()
  // The player starts at its desk, so the hint takes the last strip row from the newest line (D30), as an inspect line does.
  expect(rows[0]?.text).toContain('m1')
  expect(rows[1]?.text).toBe('e: desk')
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
  const ui = await $.ui.mount(paneAt(23 + STRIP_ROWS))
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
  const ui = await $.ui.mount(paneAt(23 + STRIP_ROWS))
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
  const ui = await $.ui.mount(paneAt(23 + STRIP_ROWS))
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

  // 156 columns is mid: the 23-row body is all map and has no strip rows (D59, D63d).
  expect(await ui.find({ type: 'Raster', key: 'office' })).toMatchObject({ props: { columns: 156, rows: 23 } })
  expect(await ui.findAll({ type: 'Text' })).toHaveLength(0)
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

// A room jump walks one tile per tick across the 76-column mid map; this is long enough to arrive.
const JUMP_MS = 12000

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
  const ui = await $.ui.mount(paneAt(23))
  await clock.advance(100)
  // `]` then `[` walks the player out of its room and back onto the first desk, beside main.
  await $.ui.input({ plugin: 'agents-office', key: 'pad-input', text: ']', kind: 'change' })
  await clock.advance(JUMP_MS)
  await $.ui.input({ plugin: 'agents-office', key: 'pad-input', text: '[', kind: 'change' })
  await clock.advance(JUMP_MS)
  await $.ui.input({ plugin: 'agents-office', key: 'pad-input', text: 'e', kind: 'change' })
  await clock.advance(100)
  expect(lines.at(-1)).toMatch(/^main \| working \| \w+ \| .+ \| 0s$/)
  await clock.advance(5800)
  expect(lines.at(-1)).not.toBeNull()
  await clock.advance(300)
  expect(lines.at(-1)).toBeNull()
  await ui.unmount()
})

test('the peek pane draws the lines', async ($, on) => {
  const clock = mock.clock(on)
  const opened: Array<{ id: string; title?: string; focus?: true }> = []
  on('ui.close', () => ({ value: undefined }))
  on('ui.open', (_$, e) => {
    opened.push({ id: e.id, title: e.title, focus: e.focus })
    return { value: { isPlaced: true } }
  })
  on('ui.blit', () => ({ value: {} }))
  on('agent.list', () => ({ value: [] }))
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'fix the bug', toolUses: [] },
      { role: 'assistant', text: 'Looking at it now', toolUses: [] },
      { role: 'user', text: '', toolUses: [], toolResults: [] },
      { role: 'assistant', text: 'Found it', toolUses: [] },
    ],
  }))
  stubSession(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(paneAt(23))
  await clock.advance(100)
  await $.ui.input({ plugin: 'agents-office', key: 'pad-input', text: ']', kind: 'change' })
  await clock.advance(JUMP_MS)
  await $.ui.input({ plugin: 'agents-office', key: 'pad-input', text: '[', kind: 'change' })
  await clock.advance(JUMP_MS)
  await $.ui.input({ plugin: 'agents-office', key: 'pad-input', text: 'E', kind: 'change' })
  await clock.advance(200)

  // Opened with focus (D31), titled for the agent.
  expect(opened.filter(o => o.id === 'office-peek')).toEqual([{ id: 'office-peek', title: 'Peek: main', focus: true }])
  const peek = await $.ui.mount({ ...paneAt(23), requestId: 'office-peek' })
  const texts = (await peek.findAll({ type: 'Text' })).map(t => String(t.text))
  expect(texts).toEqual(['> fix the bug', 'Looking at it now', 'Found it'])
  await peek.unmount()
  await ui.unmount()
})

test('a messages deny shows Nothing to show in the peek pane', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.blit', () => ({ value: {} }))
  on('agent.list', () => ({ value: [] }))
  on('session.messages', () => ({ value: { deny: 'no transcript' } }))
  stubSession(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(paneAt(23))
  await clock.advance(100)
  await $.ui.input({ plugin: 'agents-office', key: 'pad-input', text: ']', kind: 'change' })
  await clock.advance(JUMP_MS)
  await $.ui.input({ plugin: 'agents-office', key: 'pad-input', text: '[', kind: 'change' })
  await clock.advance(JUMP_MS)
  await $.ui.input({ plugin: 'agents-office', key: 'pad-input', text: 'E', kind: 'change' })
  await clock.advance(200)
  const peek = await $.ui.mount({ ...paneAt(23), requestId: 'office-peek' })

  expect((await peek.findAll({ type: 'Text' })).map(t => String(t.text))).toEqual(['Nothing to show for main.'])
  await peek.unmount()
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

test('t, a message and Enter publish the chat line without moving the player', async ($, on) => {
  const { clock, writes } = await startPresence($, on)
  const ui = await $.ui.mount(paneAt(23))
  await clock.advance(1000)
  const playerOf = (): { rx: number; ry: number; chat?: string } =>
    JSON.parse(writes.at(-1)?.text ?? '{}').player as { rx: number; ry: number; chat?: string }
  const before = playerOf()
  expect(before.chat).toBeUndefined()
  const input = (text: string, kind: 'change' | 'submit') => $.ui.input({ plugin: 'agents-office', key: 'pad-input', text, kind })
  await input('t', 'change')
  await input('twasd hi', 'change')
  await input('twasd hi', 'submit')
  await clock.advance(1000)
  const after = playerOf()

  expect(after.chat).toBe('wasd hi')
  expect({ rx: after.rx, ry: after.ry }).toEqual({ rx: before.rx, ry: before.ry })
  // The line leaves the record once its 5000 ms are up.
  await clock.advance(5000)
  expect(playerOf().chat).toBeUndefined()
  await ui.unmount()
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

test('six teams at 76 columns still blit the mounted size', async ($, on) => {
  const dir = '/home/u/.claude/agents-office/presence'
  const lengths: number[] = []
  const clock = mock.clock(on)
  stubStore(on, { share: 'all', scene: 'text' })
  stubSession(on)
  on('agent.list', () => ({ value: [] }))
  on('ui.blit', (_$, e) => {
    if ('cells' in e) lengths.push(e.cells.length)
    return { value: {} }
  })
  on('process.run', (_$, e) => {
    const stdout = e.argv[0] === 'printenv' ? (e.argv[1] === 'HOME' ? '/home/u\n' : '') : ''

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.write', () => ({ value: undefined }))
  const remotes: unknown[] = []
  on('state.set', ($$, e, next) => {
    if (e.key === 'remote') remotes.push(e.value)
    return next(e)
  })
  const ids = ['s1', 's2', 's3', 's4', 's5']
  on('fs.list', () => ({ value: ids.map(id => ({ name: `${id}.json`, kind: 'file' as const, size: 1, mtimeMs: 900, isLink: false })) }))
  on('fs.read', (_$, e) => {
    const id = e.path.slice(dir.length + 1, -'.json'.length)

    return {
      value: JSON.stringify({
        v: 1,
        sessionId: id,
        startedAt: 1,
        heartbeatAt: 900,
        share: 'all',
        team: { label: `other-${id} (main)`, branch: 'main' },
        agents: [{ id: 'main', label: 'main', tier: 'opus', role: 'lead', room: `team:${id}`, pose: 'type', status: 'working' }],
        player: null,
      }),
    }
  })
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(paneAt(23 + STRIP_ROWS))
  await clock.advance(1000)
  await clock.advance(1000)

  // The virtual office is wider than the pane (5 remote teams plus the own one), but the Raster and the blit stay as wide as the mounted pane.
  expect(await ui.find({ type: 'Raster', key: 'office' })).toMatchObject({ props: { columns: 76, rows: 23 } })
  expect(Object.keys((remotes[remotes.length - 1] ?? {}) as Record<string, unknown>)).toHaveLength(5)
  expect(lengths.length).toBeGreaterThan(0)
  expect(lengths.every(n => n === 4 * Math.ceil((76 * 23 * 12) / 3))).toBe(true)
  await ui.unmount()
})

const pressKey = async ($: Engine, text: string) => $.ui.input({ plugin: 'agents-office', key: 'pad-input', text, kind: 'change' })

// A session with main and one spawned subagent `a1` (label `general-purpose`); the player starts beside main, 5 tiles to its left.
// `answer` is what the confirm dialog gives back; 'dismiss' makes `ui.ask` reject. `calls` collects every ask, send and abort.
const startConfirm = async ($: Engine, on: On, answer: string) => {
  const clock = mock.clock(on)
  const calls = { asks: [] as string[], sends: [] as Array<{ to: unknown; text: string }>, aborts: [] as string[], strip: [] as string[], logs: [] as string[] }
  // `$.ui.ask` is a tool.call of AskUserQuestion; a deny is a dismissed dialog.
  on('tool.call', (_$, e) => {
    if (e.tool !== 'AskUserQuestion') return { result: 'stub' }
    const question = e.questions[0]?.question ?? ''
    calls.asks.push(question)
    if (answer === 'dismiss') return { deny: 'dismissed' }

    return { result: { questions: e.questions.map(q => ({ ...q, options: q.options })), answers: { [question]: answer } } }
  })
  on('session.send', (_$, e) => {
    calls.sends.push({ to: e.to, text: e.text })

    return { isDelivered: true }
  })
  on('turn.abort', (_$, e) => {
    calls.aborts.push(e.turnId)

    return { value: undefined }
  })
  on('state.set', ($$, e, next) => {
    // StateWrite types `value` as the union of every atom; only the log atom is read.
    if (e.key === 'log') calls.strip = e.value as string[]

    return next(e)
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'done' }))
  on('ui.blit', () => ({ value: {} }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.list', () => ({ value: [] }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  stubSession(on, calls.logs)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(paneAt(23))
  await clock.advance(100)
  await $.agent.spawn(spawnArgs)
  await clock.advance(6000)
  await pressKey($, ']')
  await clock.advance(JUMP_MS)
  await pressKey($, '[')
  await clock.advance(JUMP_MS)

  return { clock, calls, ui }
}

const walkToSubagent = async ($: Engine, clock: ReturnType<typeof mock.clock>) => {
  await pressKey($, 'ddddd')
  await clock.advance(1000)
}

test('a nudge needs a Yes', async ($, on) => {
  const yes = await startConfirm($, on, 'Yes')
  await walkToSubagent($, yes.clock)
  await pressKey($, 'm')
  await yes.clock.advance(200)

  expect(yes.calls.asks).toEqual(['Nudge general-purpose?'])
  expect(yes.calls.sends).toEqual([{ to: 'a1', text: NUDGE_TEXT }])
  expect(yes.calls.strip.at(-1)).toBe('You nudged general-purpose')
  await yes.ui.unmount()
})

for (const answer of ['No', 'dismiss', 'yes']) {
  test(`a nudge answered ${answer} sends nothing`, async ($, on) => {
    const run = await startConfirm($, on, answer)
    await walkToSubagent($, run.clock)
    await pressKey($, 'm')
    await run.clock.advance(200)

    expect(run.calls.asks).toEqual(['Nudge general-purpose?'])
    expect(run.calls.sends).toEqual([])
    expect(run.calls.strip).not.toContain('You nudged general-purpose')
    await run.ui.unmount()
  })
}

test('m near main asks nothing and sends nothing', async ($, on) => {
  const run = await startConfirm($, on, 'Yes')
  await pressKey($, 'm')
  await run.clock.advance(200)

  expect(run.calls.asks).toEqual([])
  expect(run.calls.sends).toEqual([])
  await run.ui.unmount()
})

test('x aborts main only after Yes', async ($, on) => {
  const yes = await startConfirm($, on, 'Yes')
  await $.turn.start({ text: 'go', turnId: 'turn-7' })
  await pressKey($, 'x')
  await yes.clock.advance(200)

  expect(yes.calls.asks).toEqual(['Interrupt main?'])
  expect(yes.calls.aborts).toEqual(['turn-7'])
  expect(yes.calls.strip.at(-1)).toBe('You interrupted main')
  await yes.ui.unmount()
})

for (const answer of ['No', 'dismiss', 'yes']) {
  test(`x answered ${answer} aborts nothing`, async ($, on) => {
    const run = await startConfirm($, on, answer)
    await $.turn.start({ text: 'go', turnId: 'turn-8' })
    await pressKey($, 'x')
    await run.clock.advance(200)

    expect(run.calls.asks).toEqual(['Interrupt main?'])
    expect(run.calls.aborts).toEqual([])
    await run.ui.unmount()
  })
}

test('x with no running turn aborts nothing even after Yes', async ($, on) => {
  const idle = await startConfirm($, on, 'Yes')
  await pressKey($, 'x')
  await idle.clock.advance(200)

  expect(idle.calls.asks).toEqual(['Interrupt main?'])
  expect(idle.calls.aborts).toEqual([])
  expect(idle.calls.strip.at(-1)).toBe('Interrupt skipped: no turn is running')
  await idle.ui.unmount()
})

test('x after the turn completed aborts nothing', async ($, on) => {
  const run = await startConfirm($, on, 'Yes')
  await $.turn.start({ text: 'go', turnId: 'turn-9' })
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 'turn-9', reason: 'answer' })
  await pressKey($, 'x')
  await run.clock.advance(200)

  expect(run.calls.asks).toEqual(['Interrupt main?'])
  expect(run.calls.aborts).toEqual([])
  await run.ui.unmount()
})

test('a finished subagent is never nudged', async ($, on) => {
  const run = await startConfirm($, on, 'Yes')
  await $.turn.complete({ ...turnArgs, agentId: 'a1', turnId: 'sub-1' })
  await walkToSubagent($, run.clock)
  await pressKey($, 'm')
  await run.clock.advance(200)

  expect(run.calls.asks).toEqual([])
  expect(run.calls.sends).toEqual([])
  await run.ui.unmount()
})

test('a resize between pane sizes keeps the mid footprint and does not reseat the office', async ($, on) => {
  const clock = mock.clock(on)
  const writes: Record<string, unknown> = {}
  on('state.set', ($, e, next) => {
    writes[e.key] = e.value
    return next(e)
  })
  stubSession(on)
  on('agent.list', () => ({ value: [] }))
  on('ui.blit', () => ({ value: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const dock = (columns: number) => ({ ...paneProps, placement: 'dock', bodyColumns: columns, scroll: { offset: 0, bodyRows: 23 } }) as const
  const ui = await $.ui.mount({ plugin: 'agents-office', surface: 'terminal', component: 'Pane', requestId: 'office', props: dock(62) })
  await clock.advance(TICK_MS * 3)
  type Entry = { x: number; y: number }
  const narrow = (writes.motion as Record<string, Entry>).main
  expect(narrow).toBeDefined()
  expect(writes.viewport).toMatchObject({ columns: 62, foot: MID_FOOT })

  // 62 to 76 columns: the footprint is the mid one at both sizes, so nothing is reseated.
  await ui.redraw(dock(76))
  await clock.advance(TICK_MS * 3)
  const own = writes.team as { id: `team:${string}`; label: string }
  const mid = buildOffice(76, 23, [{ id: own.id, label: own.label }], MID_FOOT)
  const motion = writes.motion as Record<string, Entry>
  expect(writes.seatFoot).toBeUndefined()
  expect(writes.viewport).toMatchObject({ columns: 76, foot: MID_FOOT })
  expect(motion.main).toEqual(narrow)
  for (const entry of Object.values(motion)) expect(canStand(mid, entry.x, entry.y)).toBe(true)

  // And back to the narrow pane: still the mid footprint, still no reseat.
  await ui.redraw(dock(62))
  await clock.advance(TICK_MS * 3)
  expect(writes.seatFoot).toBeUndefined()
  expect(writes.viewport).toMatchObject({ columns: 62, foot: MID_FOOT })
  await ui.unmount()
})

// ---- The image scene (T12) ----------------------------------------------------------------------------
const STATE_DIR = '/tmp/agents-office-state.t1'

// Stubs the renderer's three spawns by argv: `mktemp` (the state dir), `node` (render.mjs, which prints `lines` and
// then stays alive, setting `returned` once its stream is closed) and `rm` (the cleanup). Records every argv.
// `idle` makes the child print `lines` once and then write nothing, like a renderer showing a static scene.
// A `pkill` spawn ends the node stub like SIGTERM does (`killed`); `finish()` ends it with code 0 like the renderer's watchdog.
const stubRenderer = (
  on: On,
  lines: string,
  idle = false,
  ending: 'run' | 'exit' | 'throw' = 'run',
  frames = false,
): { spawned: string[][]; state: { returned: boolean; killed: boolean }; finish: () => void } => {
  const spawned: string[][] = []
  const state = { returned: false, killed: false }
  let finishing = false
  let frameNo = 1
  let release: (() => void) | undefined
  on('process.spawn', async function* (_$, e) {
    spawned.push([...e.argv])
    if (e.argv[0] === 'mktemp') {
      yield { stream: 'stdout' as const, text: `${STATE_DIR}\n` }
    } else if (e.argv[0] === 'pkill') {
      state.killed = true
      release?.()
    } else if (e.argv[0] === 'node') {
      try {
        if (ending === 'throw') throw new Error('spawn node ENOENT')
        yield { stream: 'stdout' as const, text: lines }
        if (ending === 'exit') return { value: { code: 1, signal: null } }
        if (idle) {
          await new Promise<void>(resolve => (release = resolve))
        } else {
          while (!state.killed && !finishing) {
            await new Promise<void>(resolve => setTimeout(() => resolve(), 20))
            if (!state.killed && !finishing) yield { stream: 'stdout' as const, text: frames ? `frame ${(frameNo += 1)} /x/frame-${frameNo % 2}.png\n` : 'fps 1\n' }
          }
        }
        if (finishing && !state.killed) {
          finishing = false

          return { value: { code: 0, signal: null } }
        }

        return { value: { code: null, signal: 'SIGTERM' } }
      } finally {
        state.returned = true
      }
    }

    return { value: { code: 0, signal: null } }
  })

  return {
    spawned,
    state,
    finish: () => {
      finishing = true
      release?.()
    },
  }
}

// The tsconfig carries no DOM or node types, but the test runtime has the timer (the stub streams wait on real time).
declare function setTimeout(handler: () => void, ms: number): number

const settle = (ms = 80): Promise<void> => new Promise(resolve => setTimeout(() => resolve(), ms))

type SceneBlit = { key: string; file?: string; format?: string; generation?: number }

// A session over a drawn pane with the image scene wanted: the tick starts the renderer once the pane has a map.
const imageSession = async ($: Engine, on: On, lines: string, opts: { deny?: string; idle?: boolean; throws?: boolean; frames?: boolean } = {}) => {
  const clock = mock.clock(on)
  const blits: SceneBlit[] = []
  const writes: Array<{ path: string; text: string }> = []
  stubStore(on)
  stubSession(on)
  on('agent.list', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.blit', (_$, e) => {
    blits.push('source' in e && 'file' in e.source ? { key: e.key, file: e.source.file, format: e.source.format, generation: e.source.generation } : { key: e.key })
    if (opts.throws === true) throw new Error('engine closing')

    return { value: opts.deny === undefined ? {} : { deny: opts.deny } }
  })
  on('fs.write', (_$, e) => {
    writes.push({ path: e.path, text: e.text })

    return { value: undefined }
  })
  const renderer = stubRenderer(on, lines, opts.idle === true, 'run', opts.frames === true)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(runOffice('scene image'))
  const ui = await $.ui.mount(paneAt(23 + STRIP_ROWS))
  for (let i = 0; i < 4; i++) {
    await clock.advance(TICK_MS)
    await settle()
  }

  return { ui, clock, blits, writes, ...renderer }
}

test('/office scene image spawns one renderer on the state file in a private temp dir', async ($, on) => {
  const { ui, spawned } = await imageSession($, on, 'dir /tmp/frames\nready\n')

  const nodes = spawned.filter(argv => argv[0] === 'node')
  expect(spawned[0]).toEqual(['mktemp', '-d', '-t', 'agents-office-state.XXXXXX'])
  expect(nodes).toHaveLength(1)
  expect(nodes[0]?.[1]?.endsWith('/renderer/render.mjs')).toBe(true)
  expect(nodes[0]?.[2]).toMatch(/^--session=[A-Za-z0-9-]+$/)
  expect(nodes[0]?.[3]).toBe(`--state=${STATE_DIR}/state.json`)
  await ui.unmount()
})

test('a second start request while the renderer runs spawns nothing', async ($, on) => {
  const { ui, clock, spawned } = await imageSession($, on, 'dir /tmp/frames\nready\n')
  expect(spawned.filter(argv => argv[0] === 'node')).toHaveLength(1)

  await $.command.run(runOffice('scene image'))
  await $.command.run(runOffice('scene image'))
  for (let i = 0; i < 6; i++) {
    await clock.advance(TICK_MS)
    await settle()
  }

  expect(spawned.filter(argv => argv[0] === 'node')).toHaveLength(1)
  expect(spawned.filter(argv => argv[0] === 'mktemp')).toHaveLength(1)
  await ui.unmount()
})

test('session.end ends the renderer and no later tick starts another', async ($, on) => {
  on('session.end', () => ({ sessionId: 't1' }))
  const { ui, clock, spawned, state } = await imageSession($, on, 'ready\n')
  expect(state.returned).toBe(false)

  await $.session.end({ reason: 'other', sessionId: 't1', resume: { id: 't1' } })
  await settle(200)
  for (let i = 0; i < 4; i++) {
    await clock.advance(TICK_MS)
    await settle()
  }

  expect(state.returned).toBe(true)
  expect(spawned.filter(argv => argv[0] === 'node')).toHaveLength(1)
  expect(spawned.filter(argv => argv[0] === 'rm')).toEqual([['rm', '-rf', '--', STATE_DIR]])
  await ui.unmount()
})

test('a frame line from the renderer becomes one Image blit with that generation', async ($, on) => {
  const { ui, blits } = await imageSession($, on, 'dir /tmp/frames\nready\nframe 3 /x/frame-1.png\n')

  const images = blits.filter(b => b.key === 'scene')
  expect(images).toHaveLength(1)
  expect(images[0]).toEqual({ key: 'scene', file: '/x/frame-1.png', format: 'png', generation: 3 })
  expect(blits.filter(b => b.key === 'office')).toHaveLength(0)
  await ui.unmount()
})

test('in image mode the tick writes the scene to state.json and the pane draws the keyed Image', async ($, on) => {
  const { ui, writes } = await imageSession($, on, 'ready\n')

  const state = writes.filter(w => w.path === `${STATE_DIR}/state.json`)
  expect(state.length).toBeGreaterThan(0)
  expect(JSON.parse(state[0]?.text ?? '{}')).toMatchObject({ v: 1, seq: 1, size: { w: 76 * 8, h: 23 * 17 } })
  expect(await ui.find({ type: 'Image', key: 'scene' })).toMatchObject({ props: { columns: 76, rows: 23 } })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()
})

// A pane of the given body size; the Image box is columns x rows cells and the state size is columns*8 x rows*17 (D8, D57).
const paneBox = (bodyColumns: number, bodyRows: number) =>
  ({
    plugin: 'agents-office',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'office',
    props: { ...paneProps, bodyColumns, scroll: { offset: 0, bodyRows } },
  }) as const

type StateSeen = { seq: number; heartbeatAt: number; size: { w: number; h: number } }
const statesOf = (writes: Array<{ path: string; text: string }>): StateSeen[] =>
  writes.filter(w => w.path === `${STATE_DIR}/state.json`).map(w => JSON.parse(w.text) as StateSeen)

test('image scene: a width and a height resize each write the new box as the state size', async ($, on) => {
  const { ui, clock, writes } = await imageSession($, on, 'ready\n')
  expect(statesOf(writes).at(-1)?.size).toEqual({ w: 76 * 8, h: 23 * 17 })
  const boxes: Array<{ columns: number; rows: number }> = []
  let current = ui
  for (const [columns, rows] of [[116, 40], [76, 28], [70, 24]] as const) {
    await current.unmount()
    current = await $.ui.mount(paneBox(columns, rows))
    await settle()
    // One tick: the new size is written at once, without waiting for the 2 s heartbeat.
    await clock.advance(TICK_MS)
    await clock.advance(TICK_MS)
    await settle()
    const image = await current.find({ type: 'Image', key: 'scene' })
    const box = { columns: Number(image?.props.columns), rows: Number(image?.props.rows) }
    boxes.push(box)
    expect(statesOf(writes).at(-1)?.size).toEqual({ w: box.columns * 8, h: box.rows * 17 })
  }
  // Width and height each changed from the previous box.
  expect(boxes[0]?.columns).toBe(116)
  expect(boxes[1]).toEqual({ columns: 76, rows: 23 })
  expect(boxes[0]?.rows).not.toBe(boxes[1]?.rows)
  expect(boxes[2]?.columns).toBe(70)
  await current.unmount()
})

test('image scene: a pane below the minimum size shows the size line, sends no new scene and keeps the heartbeat', async ($, on) => {
  const { ui, clock, writes, state } = await imageSession($, on, 'ready\n')
  const before = statesOf(writes).at(-1)
  expect(before).toBeDefined()
  await ui.unmount()
  const small = await $.ui.mount(paneBox(50, 8))
  await settle()
  for (let i = 0; i < 40; i++) {
    await clock.advance(TICK_MS)
    await settle(5)
  }
  const texts = await small.findAll({ type: 'Text' })

  expect(JSON.stringify(texts)).toContain('Office needs a 60x11 pane')
  expect(await small.find({ type: 'Image' })).toBeUndefined()
  const held = statesOf(writes).filter(s => s.seq === before?.seq)
  // 4 s below the minimum: the same seq is rewritten with newer heartbeats and no higher seq appears.
  expect(statesOf(writes).at(-1)?.seq).toBe(before?.seq)
  expect(held.length).toBeGreaterThan(1)
  expect(held.at(-1)?.heartbeatAt ?? 0).toBeGreaterThan(before?.heartbeatAt ?? 0)
  expect(state.returned).toBe(false)
  await small.unmount()

  // Back above the minimum: a new seq (so a new frame) with the new box.
  const back = await $.ui.mount(paneBox(76, 28))
  await settle()
  for (let i = 0; i < 4; i++) {
    await clock.advance(TICK_MS)
    await settle(5)
  }
  expect(statesOf(writes).at(-1)?.seq).toBeGreaterThan(before?.seq ?? 0)
  expect(statesOf(writes).at(-1)?.size).toEqual({ w: 608, h: 391 })
  await back.unmount()
})

// The test engine cannot raise `ui.close` (its `$.ui` has no close), so the loop is ended by the other caller of
// `stopRenderer`, `/office scene text`; the `ui.close` hook calls the same function.
test('ending the scene ends the renderer loop, closes its stream and removes the state dir', async ($, on) => {
  const { ui, spawned, state } = await imageSession($, on, 'ready\n')
  expect(state.returned).toBe(false)

  await $.command.run(runOffice('scene text'))
  await settle(200)

  expect(state.returned).toBe(true)
  expect(spawned.filter(argv => argv[0] === 'rm')).toEqual([['rm', '-rf', '--', STATE_DIR]])
  await ui.unmount()
})

test('a blit deny at the same size ends the renderer and shows the text office', async ($, on) => {
  const { ui, spawned, state } = await imageSession($, on, 'ready\nframe 1 /x/frame-0.png\n', { deny: 'the Image draws its alt here' })
  await settle(200)

  expect(state.returned).toBe(true)
  expect(spawned.filter(argv => argv[0] === 'rm')).toEqual([['rm', '-rf', '--', STATE_DIR]])
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Raster', key: 'office' })).toBeDefined()
  await ui.unmount()
})

test('a blit deny that says the pane is not mounted keeps the renderer running', async ($, on) => {
  const { ui, spawned, state } = await imageSession($, on, 'ready\nframe 1 /x/frame-0.png\n', { deny: 'the pane is not mounted' })
  await settle(200)

  expect(state.returned).toBe(false)
  expect(spawned.filter(argv => argv[0] === 'rm')).toEqual([])
  expect(await ui.find({ type: 'Image', key: 'scene' })).toBeDefined()
  await ui.unmount()
})

test('a stop ends a renderer that is writing nothing', async ($, on) => {
  const { ui, spawned } = await imageSession($, on, 'ready\n', { idle: true })
  expect(spawned.filter(argv => argv[0] === 'rm')).toEqual([])

  await $.command.run(runOffice('scene text'))
  await settle(200)

  expect(spawned.filter(argv => argv[0] === 'rm')).toEqual([['rm', '-rf', '--', STATE_DIR]])
  await ui.unmount()
})

test('a stop signals the renderer process by its state path and waits for its stream to end', async ($, on) => {
  const { ui, spawned, state } = await imageSession($, on, 'ready\n', { idle: true })
  expect(state.killed).toBe(false)

  await $.command.run(runOffice('scene text'))
  await settle(200)

  expect(spawned.filter(argv => argv[0] === 'pkill')).toEqual([['pkill', '-TERM', '-f', '--', `--state=${STATE_DIR.replace('.', '\\.')}/state\\.json`]])
  expect(state.killed).toBe(true)
  expect(state.returned).toBe(true)
  await ui.unmount()
})

test('blits denied as not mounted many times over keep the image scene (the office tab behind a peek)', async ($, on) => {
  const { ui, clock, blits, state } = await imageSession($, on, 'ready\nframe 1 /x/frame-0.png\n', {
    deny: 'no Image of its own is mounted under key "scene" in office',
    frames: true,
  })
  for (let i = 0; i < 40; i++) {
    await clock.advance(TICK_MS)
    await settle(3)
  }

  expect(blits.length).toBeGreaterThan(3)
  expect(state.returned).toBe(false)
  expect(await ui.find({ type: 'Image', key: 'scene' })).toBeDefined()
  await ui.unmount()
})

test('a blit that throws keeps the renderer and the image scene', async ($, on) => {
  const { ui, spawned, state } = await imageSession($, on, 'ready\nframe 1 /x/frame-0.png\n', { throws: true })
  await settle(200)

  expect(state.returned).toBe(false)
  expect(spawned.filter(argv => argv[0] === 'rm')).toEqual([])
  expect(await ui.find({ type: 'Image', key: 'scene' })).toBeDefined()
  await ui.unmount()
})

test('a scene that gets no frame for 15 s restarts the renderer', async ($, on) => {
  const { ui, clock, spawned, state } = await imageSession($, on, 'ready\n', { idle: true })
  expect(spawned.filter(argv => argv[0] === 'node')).toHaveLength(1)

  for (let i = 0; i < 200; i++) {
    await clock.advance(TICK_MS)
    await settle(3)
  }

  expect(state.killed).toBe(true)
  expect(spawned.filter(argv => argv[0] === 'node').length).toBeGreaterThan(1)
  await ui.unmount()
})

test('a clean exit after the heartbeat window is a restart, not a crash', async ($, on) => {
  const { ui, clock, spawned, finish } = await imageSession($, on, 'ready\nframe 1 /x/frame-0.png\n', { frames: true })
  for (let i = 0; i < 100; i++) {
    await clock.advance(TICK_MS)
    await settle(2)
  }
  finish()
  await settle(100)
  for (let i = 0; i < 30; i++) {
    await clock.advance(TICK_MS)
    await settle(10)
  }

  expect(spawned.filter(argv => argv[0] === 'node')).toHaveLength(2)
  expect(await ui.find({ type: 'Image', key: 'scene' })).toBeDefined()
  await ui.unmount()
})

test('with the text scene the v2 Raster frame is blitted and nothing is spawned', async ($, on) => {
  const clock = mock.clock(on)
  const keys: string[] = []
  stubStore(on, { scene: 'text' })
  stubSession(on)
  on('agent.list', () => ({ value: [] }))
  on('ui.blit', (_$, e) => {
    keys.push(e.key)

    return { value: {} }
  })
  const { spawned } = stubRenderer(on, 'ready\n')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(paneAt(23 + STRIP_ROWS))
  await clock.advance(TICK_MS * 3)
  await settle()

  expect(await ui.find({ type: 'Raster', key: 'office' })).toBeDefined()
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(keys).toContain('office')
  expect(keys).not.toContain('scene')
  expect(spawned).toEqual([])
  await ui.unmount()
})

test('/office scene stores the mode, answers with text and rejects other values', async ($, on) => {
  const kept = stubStore(on)
  const auto = await $.command.run(runOffice('scene auto'))
  expect(auto).toMatchObject({ text: 'Office scene: auto' })
  expect(kept.get('scene')).toBe('auto')

  const bad = await $.command.run(runOffice('scene bogus'))
  expect(bad).toMatchObject({ text: 'Usage: /office scene auto|image|text' })
  expect(kept.get('scene')).toBe('auto')
})

// ---- Detection and the fallback (T13) ------------------------------------------------------------------
const TMUX_DENY = 'the Image draws its alt here: the terminal draws no placeholder images (env: inside tmux or screen)'

// A pane over the stored scene mode (nothing stored = `auto`), the probe answered by `answer` per call, and the
// renderer stubbed. `logged` collects the strip log writes; `replies` is the `/office` reply.
const autoSession = async (
  $: Engine,
  on: On,
  answer: (n: number, file: string) => string | undefined,
  opts: { stored?: string; lines?: string; spawnFails?: boolean; exits?: boolean; env?: Record<string, string> } = {},
) => {
  const clock = mock.clock(on)
  const probes: Array<{ key: string; file: string }> = []
  const logs: string[][] = []
  stubStore(on, opts.stored === undefined ? {} : { scene: opts.stored })
  stubSession(on)
  on('agent.list', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('state.set', ($$, e, next) => {
    if (e.key === 'log') logs.push(e.value as string[])
    return next(e)
  })
  on('ui.blit', (_$, e) => {
    const file = 'source' in e && 'file' in e.source ? e.source.file : ''
    if (file.endsWith('placeholder.png')) probes.push({ key: e.key, file })
    const deny = file.endsWith('placeholder.png') ? answer(probes.length, file) : undefined

    return { value: deny === undefined ? {} : { deny } }
  })
  on('fs.write', () => ({ value: undefined }))
  on('process.run', (_$, e) => {
    const stdout = e.argv[0] === 'printenv' ? `${opts.env?.[e.argv[1] ?? ''] ?? ''}\n` : ''

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const ending = opts.spawnFails === true ? 'throw' : opts.exits === true ? 'exit' : 'run'
  const renderer = stubRenderer(on, opts.lines ?? 'ready\n', true, ending)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(paneAt(23 + STRIP_ROWS))
  for (let i = 0; i < 6; i++) {
    await clock.advance(TICK_MS)
    await settle()
  }

  return { ui, clock, probes, logs, ...renderer }
}

test('auto probes with the placeholder file, draws the Image and spawns once it is accepted', async ($, on) => {
  const { ui, probes, spawned } = await autoSession($, on, () => undefined)

  expect(probes[0]?.key).toBe('scene')
  expect(probes[0]?.file.endsWith('/renderer/placeholder.png')).toBe(true)
  expect(spawned.filter(argv => argv[0] === 'node')).toHaveLength(1)
  expect(await ui.find({ type: 'Image', key: 'scene' })).toBeDefined()
  await ui.unmount()
})

test('a probe deny gives the text office with the reason once, and never spawns', async ($, on) => {
  const { ui, spawned, logs } = await autoSession($, on, () => TMUX_DENY)

  expect(spawned.filter(argv => argv[0] === 'node' || argv[0] === 'mktemp')).toEqual([])
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Raster', key: 'office' })).toBeDefined()
  const reasons = (logs[logs.length - 1] ?? []).filter(line => line.includes(TMUX_DENY))
  expect(reasons).toHaveLength(1)
  const reply = await $.command.run(runOffice(''))
  expect(JSON.stringify(reply)).toContain(TMUX_DENY)
  await ui.unmount()
})

test('over ssh auto goes to the text office with the ssh reason and sends no probe', async ($, on) => {
  const { ui, probes, spawned } = await autoSession($, on, () => undefined, { env: { SSH_CONNECTION: '1.2.3.4 22 5.6.7.8 22' } })

  expect(probes).toEqual([])
  expect(spawned.filter(argv => argv[0] === 'node' || argv[0] === 'mktemp')).toEqual([])
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(JSON.stringify(await $.command.run(runOffice('')))).toContain('ssh')
  await ui.unmount()
})

test('a not-mounted deny retries and is never the verdict', async ($, on) => {
  const { ui, probes, spawned } = await autoSession($, on, n => (n < 3 ? 'no Image of its own is mounted under key "scene" in office' : undefined))

  expect(probes.length).toBe(3)
  expect(spawned.filter(argv => argv[0] === 'node')).toHaveLength(1)
  expect(await ui.find({ type: 'Image', key: 'scene' })).toBeDefined()
  await ui.unmount()
})

test('probe rounds that all run out give the text office with a reason', async ($, on) => {
  const { ui, clock, logs, spawned } = await autoSession($, on, () => 'no Image of its own is mounted under key "scene" in office')
  for (let i = 0; i < 140; i++) {
    await clock.advance(TICK_MS)
    await settle(3)
  }

  expect(spawned.filter(argv => argv[0] === 'node')).toEqual([])
  expect(await ui.find({ type: 'Raster', key: 'office' })).toBeDefined()
  expect((logs[logs.length - 1] ?? []).some(line => line.includes('never accepted the picture probe'))).toBe(true)
  await ui.unmount()
})

test('a stored text scene never probes or spawns', async ($, on) => {
  const { ui, probes, spawned } = await autoSession($, on, () => undefined, { stored: 'text' })

  expect(probes).toEqual([])
  expect(spawned).toEqual([])
  await ui.unmount()
})

test('a spawn that rejects gives the text office with the node fix line', async ($, on) => {
  const { ui, logs } = await autoSession($, on, () => undefined, { spawnFails: true })

  expect(await ui.find({ type: 'Raster', key: 'office' })).toBeDefined()
  expect((logs[logs.length - 1] ?? []).some(line => line.includes('Node.js was not found'))).toBe(true)
  await ui.unmount()
})

test('an error no-chromium line gives the text office with the chromium fix line', async ($, on) => {
  const { ui, logs } = await autoSession($, on, () => undefined, { lines: 'dir /x\nerror no-chromium none\n', exits: true })
  await settle(200)

  expect(await ui.find({ type: 'Raster', key: 'office' })).toBeDefined()
  expect((logs[logs.length - 1] ?? []).some(line => line.includes('npx playwright install chromium'))).toBe(true)
  await ui.unmount()
})

test('/office scene auto after a failure probes again', async ($, on) => {
  let deny: string | undefined = TMUX_DENY
  const { ui, probes } = await autoSession($, on, () => deny)
  expect(probes.length).toBe(1)

  deny = undefined
  await $.command.run(runOffice('scene auto'))
  for (let i = 0; i < 3; i++) await settle()

  expect(await ui.find({ type: 'Image', key: 'scene' })).toBeDefined()
  await ui.unmount()
})

test('3 renderer crashes give the text office with the crash reason', async ($, on) => {
  const { ui, clock, logs, spawned } = await autoSession($, on, () => undefined, { lines: 'ready\n', exits: true })
  for (let i = 0; i < 40; i++) {
    await clock.advance(TICK_MS)
    await settle(30)
  }

  expect(spawned.filter(argv => argv[0] === 'node')).toHaveLength(3)
  expect(await ui.find({ type: 'Raster', key: 'office' })).toBeDefined()
  expect((logs[logs.length - 1] ?? []).some(line => line.includes('crashed 3 times'))).toBe(true)
  await ui.unmount()
})

// ---- Every pad key against the image scene (T16) -----------------------------------------------------
// A session in image mode with main plus one spawned subagent `a1` (label `general-purpose`). `scene()` is the
// scene of the newest state.json write; `calls` collects the dialogs, sends, aborts and opened panes.
const padSession = async ($: Engine, on: On, answer = 'Yes') => {
  const clock = mock.clock(on)
  const states: string[] = []
  const calls = { asks: [] as string[], sends: [] as Array<{ to: unknown; text: string }>, aborts: [] as string[], opened: [] as string[] }
  stubStore(on)
  stubSession(on)
  on('agent.list', () => ({ value: [] }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.open', (_$, e) => {
    calls.opened.push(`${e.id}|${e.title ?? ''}`)

    return { value: { isPlaced: true } }
  })
  on('ui.blit', () => ({ value: {} }))
  on('session.messages', () => ({ value: { deny: 'no transcript' } }))
  on('fs.write', (_$, e) => {
    if (e.path === `${STATE_DIR}/state.json`) states.push(e.text)

    return { value: undefined }
  })
  on('tool.call', (_$, e) => {
    if (e.tool !== 'AskUserQuestion') return { result: 'stub' }
    const question = e.questions[0]?.question ?? ''
    calls.asks.push(question)

    return { result: { questions: e.questions.map(q => ({ ...q, options: q.options })), answers: { [question]: answer } } }
  })
  on('session.send', (_$, e) => {
    calls.sends.push({ to: e.to, text: e.text })

    return { isDelivered: true }
  })
  on('turn.abort', (_$, e) => {
    calls.aborts.push(e.turnId)

    return { value: undefined }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'done' }))
  stubRenderer(on, 'ready\n', false, 'run', true)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run(runOffice('scene image'))
  const ui = await $.ui.mount(paneAt(23 + STRIP_ROWS))
  const wait = async (ms: number) => {
    // Steps of one second, so every tick in between writes its state.
    for (let left = ms; left > 0; left -= 1000) {
      await clock.advance(Math.min(left, 1000))
      await settle(5)
    }
  }
  await wait(1000)
  await $.agent.spawn(spawnArgs)
  await wait(6000)
  const scene = (): SceneModel => (JSON.parse(states.at(-1) ?? '{}') as { scene: SceneModel }).scene
  const you = (): SceneFigure => {
    const figure = scene().figures.find(f => f.key === 'player')
    if (figure === undefined) throw new Error('no player figure in the scene')

    return figure
  }

  return { ui, clock, wait, scene, you, calls, states }
}

// From the first desk, beside main: `]` then `[` walks the player out of its room and back (as the inspect test does).
const toDesk = async ($: Engine, wait: (ms: number) => Promise<void>) => {
  await pressKey($, ']')
  await wait(JUMP_MS)
  await pressKey($, '[')
  await wait(JUMP_MS)
}

test('image scene: wasd runs the player two tiles per tick after the first and turns it', async ($, on) => {
  const { ui, wait, you } = await padSession($, on)
  const before = you()
  await pressKey($, 'dddd')
  await wait(1000)
  const right = you()
  expect(right.x - before.x).toBe(7 * 8)
  expect(right.facing).toBe('right')
  expect(right.sprite).toBe('person1-right')
  await pressKey($, 'aa')
  await wait(1000)
  expect(you().x - right.x).toBe(-3 * 8)
  expect(you().facing).toBe('left')
  await ui.unmount()
})

test('image scene: ] and [ jump the player between rooms and the camera follows', async ($, on) => {
  const { ui, wait, you, scene } = await padSession($, on)
  const home = { you: you(), camera: scene().camera }
  await pressKey($, ']')
  await wait(JUMP_MS)
  const away = { you: you(), camera: scene().camera }
  expect({ x: away.you.x, y: away.you.y }).not.toEqual({ x: home.you.x, y: home.you.y })
  const view = (f: SceneFigure) => ({ left: f.x - away.camera.x, top: f.y - away.camera.y })
  // Wherever the camera is, the player stays inside the camera window.
  expect(view(away.you).left).toBeGreaterThanOrEqual(0)
  expect(view(away.you).left).toBeLessThanOrEqual(away.camera.w)
  expect(view(away.you).top).toBeGreaterThanOrEqual(0)
  expect(view(away.you).top).toBeLessThanOrEqual(away.camera.h)
  await pressKey($, '[')
  await wait(JUMP_MS)
  expect({ x: you().x, y: you().y }).not.toEqual({ x: away.you.x, y: away.you.y })
  expect(you().x).toBeGreaterThanOrEqual(scene().camera.x)
  expect(you().x).toBeLessThanOrEqual(scene().camera.x + scene().camera.w)
  await ui.unmount()
})

test('image scene: keys 1 to 4 show an emote above the player that ends after 3 s', async ($, on) => {
  const { ui, wait, you } = await padSession($, on)
  const shown: Array<string | undefined> = []
  for (const key of ['1', '2', '3', '4']) {
    await pressKey($, key)
    await wait(1000)
    shown.push(you().emote)
    await wait(3000)
    expect(you().emote).toBeUndefined()
  }
  expect(shown).toEqual(['!', '?', '\u2665', '\u266a'])
  await ui.unmount()
})

test('image scene: e highlights the nearest agent and writes the inspect line as the caption for 6 s', async ($, on) => {
  const { ui, wait, scene } = await padSession($, on)
  await toDesk($, wait)
  expect(scene().caption).toBe('e: inspect main')
  await pressKey($, 'e')
  await wait(1000)
  expect(scene().figures.filter(f => f.highlight).map(f => f.key)).toEqual(['main'])
  expect(scene().caption).toMatch(/^main \| working \| \w+ \| .+ \| \d+s$/)
  await wait(6000)
  // The inspect line is over; the hint is the caption again while main is in reach.
  expect(scene().caption).toBe('e: inspect main')
  expect(scene().figures.some(f => f.highlight)).toBe(false)
  await ui.unmount()
})

test('image scene: E opens the peek pane titled for the agent and the scene is unchanged', async ($, on) => {
  const { ui, wait, calls, you } = await padSession($, on)
  await toDesk($, wait)
  const at = { x: you().x, y: you().y }
  await pressKey($, 'E')
  await wait(1000)
  expect(calls.opened.filter(o => o.startsWith('office-peek'))).toEqual(['office-peek|Peek: main'])
  expect({ x: you().x, y: you().y }).toEqual(at)
  await ui.unmount()
})

test('image scene: t shows the draft as the caption, Enter turns it into a chat bubble and the player stays', async ($, on) => {
  const { ui, wait, you, scene } = await padSession($, on)
  const before = you()
  await pressKey($, 't')
  await pressKey($, 'twasd hi')
  await wait(1000)
  expect(scene().caption).toBe('Say: wasd hi_')
  expect(you().chat).toBeUndefined()
  await $.ui.input({ plugin: 'agents-office', key: 'pad-input', text: 'twasd hi', kind: 'submit' })
  await wait(1000)
  expect(you().chat).toBe('wasd hi')
  expect(scene().caption).toBe('e: desk')
  expect({ x: you().x, y: you().y }).toEqual({ x: before.x, y: before.y })
  await wait(5000)
  expect(you().chat).toBeUndefined()
  await ui.unmount()
})

test('image scene: m asks before nudging the agent beside the player and x asks before interrupting main', async ($, on) => {
  const { ui, wait, calls } = await padSession($, on)
  await toDesk($, wait)
  await pressKey($, 'ddddd')
  await wait(1000)
  await pressKey($, 'm')
  await wait(1000)
  expect(calls.asks).toEqual(['Nudge general-purpose?'])
  expect(calls.sends).toEqual([{ to: 'a1', text: NUDGE_TEXT }])
  await $.turn.start({ text: 'go', turnId: 'turn-9' })
  await pressKey($, 'x')
  await wait(1000)
  expect(calls.asks).toEqual(['Nudge general-purpose?', 'Interrupt main?'])
  expect(calls.aborts).toEqual(['turn-9'])
  await ui.unmount()
})

// ---- Other sessions in the image scene (T17) ----------------------------------------------------------
// Three remote presence records (listed out of order): `a` is named, `b` and `c` are anonymous. Player `a` has an
// emote and a chat line. `dead` makes `b` a tombstone with a newer mtime, as a session that ended.
const remoteImageSession = async ($: Engine, on: On) => {
  const dir = '/home/u/.claude/agents-office/presence'
  const clock = mock.clock(on)
  const states: string[] = []
  const dead = { b: false }
  stubStore(on, { share: 'all', scene: 'image' })
  stubSession(on)
  on('agent.list', () => ({ value: [] }))
  on('ui.blit', () => ({ value: {} }))
  on('process.run', (_$, e) => {
    const stdout = e.argv[0] === 'printenv' ? (e.argv[1] === 'HOME' ? '/home/u\n' : '') : ''

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.write', (_$, e) => {
    if (e.path === `${STATE_DIR}/state.json`) states.push(e.text)

    return { value: undefined }
  })
  on('fs.list', () => ({
    value: ['c', 'a', 'b'].map(id => ({ name: `${id}.json`, kind: 'file' as const, size: 1, mtimeMs: id === 'b' && dead.b ? 3000 : 900, isLink: false })),
  }))
  const named = { a: 'alpha (main)', b: '', c: '' } as const
  const started = { a: 10, b: 20, c: 30 } as const
  on('fs.read', (_$, e) => {
    const id = e.path.slice(dir.length + 1, -'.json'.length) as 'a' | 'b' | 'c'
    if (id === 'b' && dead.b) return { value: JSON.stringify({ v: 1, sessionId: 'b', heartbeatAt: 3000, gone: true }) }
    const player =
      id === 'a'
        ? { room: `team:${id}`, rx: 4, ry: 4, facing: 'left', emote: '◆', emoteUntil: 60000, chat: 'hello from alpha', chatUntil: 60000 }
        : id === 'c'
          ? { room: `team:${id}`, rx: 4, ry: 4, facing: 'right' }
          : null

    return {
      value: JSON.stringify({
        v: 1,
        sessionId: id,
        startedAt: started[id],
        heartbeatAt: 900,
        share: named[id] === '' ? 'anon' : 'all',
        team: { label: named[id], branch: '' },
        agents: [{ id: 'main', label: named[id] === '' ? '' : 'main', tier: 'opus', role: 'lead', room: `team:${id}`, pose: 'type', status: 'working' }],
        player,
      }),
    }
  })
  stubRenderer(on, 'ready\n')
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(paneAt(23 + STRIP_ROWS))
  const wait = async (ms: number) => {
    for (let left = ms; left > 0; left -= 1000) {
      await clock.advance(Math.min(left, 1000))
      await settle(5)
    }
  }
  await wait(3000)
  const scene = (): SceneModel => (JSON.parse(states.at(-1) ?? '{}') as { scene: SceneModel }).scene

  return { ui, wait, scene, dead, states }
}

test('image scene: other sessions show as rooms in startedAt order with remote agents and players', async ($, on) => {
  const { ui, scene } = await remoteImageSession($, on)
  const rooms = scene().rooms.filter(r => r.kind === 'team')
  expect(rooms.map(r => r.id)).toEqual(['team:t1', 'team:a', 'team:b', 'team:c'])
  expect(rooms.map(r => r.name)).toEqual(['proj', 'alpha (main)', 'Session 3', 'Session 4'])
  const remoteAgents = scene().figures.filter(f => f.remote && !f.player)
  expect(remoteAgents.map(f => f.key).sort()).toEqual(['a:main', 'b:main', 'c:main'])
  const guests = scene().figures.filter(f => f.remote && f.player).sort((x, y) => (x.key < y.key ? -1 : 1))
  expect(guests.map(f => [f.key, f.plate])).toEqual([
    ['player:a', 'alpha (main)'],
    ['player:c', 'Session 4'],
  ])
  expect(guests[0]).toMatchObject({ emote: '♥', chat: 'hello from alpha' })
  await ui.unmount()
})

test('image scene: a tombstoned session leaves the scene within 5 s', async ($, on) => {
  const { ui, wait, scene, dead } = await remoteImageSession($, on)
  expect(scene().rooms.some(r => r.id === 'team:b')).toBe(true)
  dead.b = true
  await wait(5000)
  const rooms = scene().rooms.filter(r => r.kind === 'team')
  expect(rooms.map(r => r.id)).toEqual(['team:t1', 'team:a', 'team:c'])
  expect(scene().figures.some(f => f.key.startsWith('b:'))).toBe(false)
  // The anonymous room after it is renumbered by room order.
  expect(rooms.map(r => r.name)).toEqual(['proj', 'alpha (main)', 'Session 3'])
  await ui.unmount()
})

// ---- Using the office with e (T31) -------------------------------------------------------------------------
type Written = {
  player?: { x: number; y: number; path: unknown[]; act?: { kind: 'mug' | 'sit'; until?: number }; chat?: string; chatUntil?: number }
  cat?: { x: number; y: number }
  hintLine?: string | null
  catPetUntil?: number
  motion?: Record<string, { x: number; y: number; path: Array<{ x: number; y: number }> }>
  viewport?: { columns: number; rows: number }
  team?: { id: `team:${string}`; label: string }
  inspect?: { text: string } | null
}

// A text-scene session with the pane mounted. A test cannot write atoms, so `state.set` keeps the newest value of each
// and rewrites the player's position while `pin` is set (any key that moves the player then makes the write). `opened`
// records the pane opens as `id|title`.
const useSession = async ($: Engine, on: On, mode: 'text' | 'image' = 'text') => {
  const clock = mock.clock(on)
  const opened: string[] = []
  const states: string[] = []
  const last: Written = {}
  const pin: { at?: { x: number; y: number } } = {}
  on('state.set', ($$, e, next) => {
    // StateWrite types `value` as the union of every atom; each key is read as its own shape.
    const value = e.value as never
    if (e.key === 'player' && pin.at !== undefined && value !== null) {
      const pinned = { ...(value as object), x: pin.at.x, y: pin.at.y, path: [] }
      last.player = pinned as Written['player']

      return next({ ...e, value: pinned as never })
    }
    if (e.key === 'player' || e.key === 'motion' || e.key === 'viewport' || e.key === 'team' || e.key === 'inspect' || e.key === 'hintLine' || e.key === 'catPetUntil' || e.key === 'cat') (last as Record<string, unknown>)[e.key] = value

    return next(e)
  })
  stubSession(on)
  on('store.get', (_$, e) => ({ value: e.key === 'scene' ? mode : undefined }))
  on('fs.write', (_$, e) => {
    if (e.path === `${STATE_DIR}/state.json`) states.push(e.text)

    return { value: undefined }
  })
  const renderer = mode === 'image' ? stubRenderer(on, 'ready\n', false, 'run', true) : undefined
  // Each pane open or close as `open <id>[ focus][ esc]` / `close <id>`.
  const events: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(`${e.id}|${e.title ?? ''}`)
    events.push(`open ${e.id}${e.focus === true ? ' focus' : ''}${e.closeOnEscape === true ? ' esc' : ''}`)

    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    events.push(`close ${e.id}`)

    return { value: undefined }
  })
  on('ui.blit', () => ({ value: {} }))
  on('agent.list', () => ({ value: [{ id: 'main', status: 'running' }, { id: 'done1', status: 'completed' }] as never }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('session.messages', () => ({ value: { deny: 'no transcript' } }))
  on('tool.call', () => ({ result: 'stub' }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(paneAt(mode === 'image' ? 23 + STRIP_ROWS : 23))
  await clock.advance(TICK_MS * 4)
  const mapOf = (): OfficeMap => {
    const size = last.viewport
    const own = last.team
    const map = size === undefined ? undefined : mapFor(size.columns, size.rows, own === undefined ? [] : [{ id: own.id, label: own.label }])
    if (map === undefined) throw new Error('no map')

    return map
  }
  const items = (): Item[] => itemsOf(mapOf())
  const press = async (key: string): Promise<void> => {
    await pressKey($, key)
    await clock.advance(TICK_MS * 2)
  }
  // Puts the player on the first standable cell that is `gap` cells from `rect` and farther than that from every `apart` item and at least 3 from every agent rectangle in `agents` (a `d` makes the write the pin rewrites;
  // the step snaps a player off a cell it cannot stand on, so the cell must be a real one).
  const stand = async (rect: Rect, gap: number, apart: Rect[] = [], agents: Rect[] = []): Promise<void> => {
    const map = mapOf()
    for (let y = rect.y - gap - map.foot.h; y <= rect.y + rect.h + gap; y++) {
      for (let x = rect.x - gap - map.foot.w; x <= rect.x + rect.w + gap; x++) {
        const body = { x, y, w: map.foot.w, h: map.foot.h }
        if (!canStand(map, x, y) || rectGap(body, rect) !== gap || apart.some(other => rectGap(body, other) <= gap) || agents.some(other => rectGap(body, other) <= 2)) continue
        pin.at = { x, y }
        await press('d')

        return
      }
    }
    throw new Error('no standable cell at that gap')
  }
  // Puts the player on the first standable cell that is 2 or more cells from every item, the cat and each agent.
  const standClear = async (): Promise<void> => {
    const map = mapOf()
    const bodies: Rect[] = [
      ...items().map(i => i.rect),
      ...(last.cat === undefined ? [] : [{ x: last.cat.x, y: last.cat.y, w: CAT_FOOT.w, h: CAT_FOOT.h }]),
      ...Object.values(last.motion ?? {}).map(m => ({ x: m.x, y: m.y, w: 5, h: 5 })),
    ]
    for (let y = 0; y < map.rows; y++) {
      for (let x = 0; x < map.columns; x++) {
        const body = { x, y, w: map.foot.w, h: map.foot.h }
        if (!canStand(map, x, y) || bodies.some(other => rectGap(body, other) <= 2)) continue
        pin.at = { x, y }
        // `a`, not `d`: the same key as the last press changes nothing, and the pin needs a write.
        await press('a')

        return
      }
    }
    throw new Error('no cell clear of every target')
  }
  const peekTexts = async (): Promise<string[]> => {
    const pane = await $.ui.mount({ ...paneAt(23), requestId: 'office-peek' })
    const texts = (await pane.findAll({ type: 'Text' })).map(t => String(t.text))
    await pane.unmount()

    return texts
  }

  const scene = (): SceneModel => (JSON.parse(states.at(-1) ?? '{}') as { scene: SceneModel }).scene
  const figure = (key: string): SceneFigure | undefined => scene().figures.find(f => f.key === key)

  return { clock, ui, opened, events, last, items, press, stand, standClear, peekTexts, scene, figure, renderer }
}

test('e at the whiteboard lists a TodoWrite and the pane redraws after a second TodoWrite', async ($, on) => {
  const run = await useSession($, on)
  const board = run.items().find(i => i.kind === 'whiteboard')
  if (board === undefined) throw new Error('no whiteboard')
  await run.stand(board.rect, 1)
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'write tests', status: 'in_progress', activeForm: 'Writing tests' }, { content: 'ship', status: 'pending', activeForm: 'Shipping' }] })
  await run.press('e')

  expect(run.opened.filter(o => o.startsWith('office-peek'))).toEqual(['office-peek|Whiteboard'])
  const pane = await $.ui.mount({ ...paneAt(23), requestId: 'office-peek' })
  const lines = async () => (await pane.findAll({ type: 'Text' })).map(t => String(t.text))
  expect(await lines()).toEqual(['[>] write tests', '[ ] ship'])
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'write tests', status: 'completed', activeForm: 'Writing tests' }, { content: 'ship', status: 'in_progress', activeForm: 'Shipping' }] })
  await run.clock.advance(TICK_MS)
  expect(await lines()).toEqual(['[x] write tests', '[>] ship'])
  await pane.unmount()
  await run.ui.unmount()
})

test('e at the whiteboard shows the peek tab with the keys, behind it the office pane waits as a tab (D31)', async ($, on) => {
  const run = await useSession($, on)
  const board = run.items().find(i => i.kind === 'whiteboard')
  if (board === undefined) throw new Error('no whiteboard')
  await run.stand(board.rect, 1)
  run.events.length = 0
  await run.press('e')

  // The office pane is closed so the peek can take the keys, then comes back behind it as a tab.
  expect(run.events).toEqual(['close office', 'open office-peek focus esc', 'open office'])

  // The Escape half (the `ui.close` hook asking the pad's keys back) cannot run here: the test engine's `$.ui` has no close.
  await run.ui.unmount()
})

test('e at the whiteboard in the image scene swaps the tabs without stopping the renderer (D31)', async ($, on) => {
  const run = await useSession($, on, 'image')
  const board = run.items().find(i => i.kind === 'whiteboard')
  if (board === undefined) throw new Error('no whiteboard')
  await run.stand(board.rect, 1)
  await run.press('e')

  expect(run.events).toContain('close office')
  expect(run.renderer?.spawned.filter(argv => argv[0] === 'node')).toHaveLength(1)
  expect(run.renderer?.spawned.filter(argv => argv[0] === 'pkill')).toEqual([])
  expect(run.renderer?.state.returned).toBe(false)
  await run.ui.unmount()
})

test('e at the server rack shows own tools, the context percent and the running count', async ($, on) => {
  const run = await useSession($, on)
  const rack = run.items().find(i => i.kind === 'rack')
  if (rack === undefined) throw new Error('no rack')
  await run.stand(rack.rect, 1)
  await $.tool.call({ tool: 'Read', file_path: 'x' })
  await $.session.measure({ context: { window: 1000000, tokens: 70000, percent: 7 }, rateLimits: [], cost: { usd: 0.383951 }, changed: ['context', 'cost'] })
  await run.press('e')

  expect(run.opened.filter(o => o.startsWith('office-peek'))).toEqual(['office-peek|Server rack'])
  expect(await run.peekTexts()).toEqual(['context: 7%', 'cost: $0.38', 'agents: 1 running, 0 idle', 'main: Read'])
  await run.ui.unmount()
})

test('e at a desk peeks the agent heading for it', async ($, on) => {
  const run = await useSession($, on)
  // A new agent walks in from the door to the desk it will own: first along the corridor, then up and back along the desk row.
  await $.agent.spawn(spawnArgs)
  await run.clock.advance(TICK_MS)
  const anchor = run.last.motion?.a1?.path.at(-1)
  const desk = run.items().find(i => i.kind === 'desk' && i.anchor?.x === anchor?.x && i.anchor?.y === anchor?.y)
  if (desk === undefined) throw new Error('a1 has no desk')
  // Wait until a1 is far from its desk (it still owns it: the last tile of its path), then stand beside the desk alone.
  await run.clock.advance(TICK_MS * 28)
  const far = run.last.motion?.a1
  if (far === undefined || rectGap({ x: far.x, y: far.y, w: 5, h: 5 }, desk.rect) < 10) throw new Error('a1 is not away from its desk')
  await run.stand(desk.rect, 1, run.items().filter(i => i.id !== desk.id).map(i => i.rect), [{ x: far.x, y: far.y, w: 5, h: 5 }, { ...(run.last.motion?.main ?? { x: 0, y: 0 }), w: 5, h: 5 }])
  await run.press('e')

  expect(run.opened.filter(o => o.startsWith('office-peek'))).toEqual(['office-peek|Peek: general-purpose'])
  await run.ui.unmount()
})

test('e next to an agent inspects it and opens no peek pane', async ($, on) => {
  const run = await useSession($, on)
  const at = run.last.motion?.main
  if (at === undefined) throw new Error('main is not seated')
  await run.stand({ x: at.x, y: at.y, w: 5, h: 5 }, 0)
  await run.press('e')

  expect(run.opened.filter(o => o.startsWith('office-peek'))).toEqual([])
  expect(run.last.inspect?.text).toMatch(/^main \| /)
  await run.ui.unmount()
})

const MODES = ['text', 'image'] as const

// Stands beside `rect` with every `apart` rect farther away: one cell off if some cell allows that, else touching it.
const standBeside = async (run: Awaited<ReturnType<typeof useSession>>, rect: Rect, apart: Rect[]): Promise<void> => {
  try {
    await run.stand(rect, 1, apart)
  } catch {
    await run.stand(rect, 0, apart)
  }
}

const besideItem = async (run: Awaited<ReturnType<typeof useSession>>, kind: Item['kind']): Promise<void> => {
  const all = run.items()
  const item = all.find(i => i.kind === kind)
  if (item === undefined) throw new Error(`no ${kind}`)
  await standBeside(run, item.rect, all.filter(i => i !== item).map(i => i.rect))
}

for (const mode of MODES) {
  test(`${mode} scene: e at the coffee machine holds a mug for 8 s`, async ($, on) => {
    const run = await useSession($, on, mode)
    await besideItem(run, 'coffee')
    await run.press('e')

    expect(run.last.player?.act?.kind).toBe('mug')
    if (mode === 'image') {
      expect(run.figure('player')?.holding).toBe('mug')
      expect(run.last.inspect ?? undefined).toBeUndefined()
    } else {
      expect(run.last.inspect?.text).toBe('You hold a mug of coffee.')
    }
    await run.clock.advance(7500)
    expect(run.last.player?.act?.kind).toBe('mug')
    if (mode === 'image') expect(run.figure('player')?.holding).toBe('mug')
    await run.clock.advance(800)
    expect(run.last.player?.act).toBeUndefined()
    if (mode === 'image') expect(run.figure('player')?.holding).toBeUndefined()
    // Over for good: no later tick brings the mug back.
    await run.clock.advance(1000)
    expect(run.last.player?.act).toBeUndefined()
    await run.ui.unmount()
  })

  test(`${mode} scene: e at the sofa sits and d stands`, async ($, on) => {
    const run = await useSession($, on, mode)
    await besideItem(run, 'sofa')
    await run.press('e')

    expect(run.last.player?.act).toEqual({ kind: 'sit' })
    if (mode === 'image') expect(run.figure('player')?.pose).toBe('seated')
    else expect(run.last.inspect?.text).toBe('You sit on the sofa.')
    await run.clock.advance(3000)
    expect(run.last.player?.act).toEqual({ kind: 'sit' })
    await run.press('d')
    expect(run.last.player?.act).toBeUndefined()
    if (mode === 'image') expect(run.figure('player')?.pose).toBe('standing')
    // A room jump stands the player up as well.
    await run.press('e')
    expect(run.last.player?.act).toEqual({ kind: 'sit' })
    await run.press(']')
    expect(run.last.player?.act).toBeUndefined()
    await run.ui.unmount()
  })

  test(`${mode} scene: e at the water cooler chats one of the fixed lines for 5 s`, async ($, on) => {
    const run = await useSession($, on, mode)
    await besideItem(run, 'cooler')
    await run.press('e')

    const said = run.last.player?.chat
    expect(COOLER_LINES as readonly (string | undefined)[]).toContain(said)
    if (mode === 'image') expect(run.figure('player')?.chat).toBe(said)
    await run.clock.advance(5500)
    expect(run.last.player?.chat).toBeUndefined()
    if (mode === 'image') expect(run.figure('player')?.chat).toBeUndefined()
    await run.ui.unmount()
  })

  test(`${mode} scene: e beside the cat shows a heart on it for 3 s`, async ($, on) => {
    const run = await useSession($, on, mode)
    const kitty = run.last.cat
    if (kitty === undefined) throw new Error('no cat')
    // The cat wins a tie with an item, so touching it is enough; an agent would win the tie, so none is near.
    await run.stand({ x: kitty.x, y: kitty.y, w: CAT_FOOT.w, h: CAT_FOOT.h }, 0, [], Object.values(run.last.motion ?? {}).map(m => ({ x: m.x, y: m.y, w: 5, h: 5 })))
    await run.press('e')

    expect(run.last.catPetUntil ?? 0).toBeGreaterThan(0)
    if (mode === 'image') expect(run.figure('cat')?.emote).toBe('♥')
    else expect(run.last.inspect?.text).toBe('You pet the cat.')
    await run.clock.advance(3500)
    if (mode === 'image') expect(run.figure('cat')?.emote).toBeUndefined()
    await run.ui.unmount()
  })

  test(`${mode} scene: the hint shows beside an item and is gone after walking away`, async ($, on) => {
    const run = await useSession($, on, mode)
    await besideItem(run, 'coffee')
    await run.clock.advance(TICK_MS * 2)

    expect(run.last.hintLine).toBe('e: coffee machine')
    if (mode === 'image') expect(run.scene().caption).toBe('e: coffee machine')
    await run.standClear()
    await run.clock.advance(TICK_MS * 2)

    expect(run.last.hintLine).toBeNull()
    if (mode === 'image') expect(run.scene().caption).toBeUndefined()
    await run.ui.unmount()
  })
}

test('a subagent TodoWrite does not reach the whiteboard', async ($, on) => {
  const run = await useSession($, on)
  const board = run.items().find(i => i.kind === 'whiteboard')
  if (board === undefined) throw new Error('no whiteboard')
  await run.stand(board.rect, 1)
  await $.tool.call({ tool: 'TodoWrite', agentId: 'a1', todos: [{ content: 'sub task', status: 'pending', activeForm: 'Sub task' }] } as never)
  await run.press('e')

  expect(await run.peekTexts()).toEqual(['No plan yet.'])
  await run.ui.unmount()
})

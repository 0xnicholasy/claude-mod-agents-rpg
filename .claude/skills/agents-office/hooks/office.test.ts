import { expect, mock, test } from 'claude-code/testing'

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
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
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
  expect(result.agentId).toBe('a1')
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

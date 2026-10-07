import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ImageProps, On, UiBlitResult } from 'claude-code'

const props = {
  title: 'Image spike',
  isFocused: false,
  bodyColumns: 76,
  placement: 'inline',
  scroll: { offset: 0, bodyRows: 11 },
  view: {},
} as const

const mountPane = ($: Engine) =>
  $.ui.mount({ plugin: 'imgspike', surface: 'terminal', component: 'Pane', requestId: 'imgspike', props })

const stub = (on: On): void => {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'imgspike' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.log', (_$, e) => {
    return { value: undefined }
  })
}

test('the pane draws one keyed Image of 76x11 cells with 608x176 px rgba', async ($, on) => {
  mock.clock(on)
  const ui = await mountPane($)
  // find() types props as unknown; this is the one cast, to the documented ImageProps.
  const image = (await ui.find({ type: 'Image' }))?.props as ImageProps | undefined
  expect(image).toBeDefined()
  expect(image?.key).toBe('view')
  expect(image?.columns).toBe(76)
  expect(image?.rows).toBe(11)
  expect((image?.alt ?? '').length).toBeGreaterThan(0)
  const source = image?.source
  if (source === undefined || !('rgba' in source)) throw new Error('expected an rgba source')
  expect(source.width).toBe(608)
  expect(source.height).toBe(176)
  expect(Uint8Array.fromBase64(source.rgba).length).toBe(608 * 176 * 4)
  await ui.unmount()
})

test('a tick blits a frame of the same byte length (stubbed ui.blit)', async ($, on) => {
  const clock = mock.clock(on)
  stub(on)
  const seen: { key: string; bytes: number }[] = []
  on('ui.blit', (_$, e) => {
    if ('source' in e && 'rgba' in e.source) seen.push({ key: e.key, bytes: Uint8Array.fromBase64(e.source.rgba).length })
    return { value: {} }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'imgspike' })
  const ui = await mountPane($)
  await clock.advance(350)
  expect(seen.length).toBeGreaterThanOrEqual(3)
  expect(seen[0]).toEqual({ key: 'view', bytes: 608 * 176 * 4 })
  await ui.unmount()
})

test('a denied blit is logged with its reason and the ticker keeps going', async ($, on) => {
  const clock = mock.clock(on)
  const logs: string[] = []
  let calls = 0
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'imgspike' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.log', (_$, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('ui.blit', () => {
    calls += 1
    const result: UiBlitResult = { deny: 'not mounted' }
    return { value: result }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'imgspike' })
  const ui = await mountPane($)
  await clock.advance(250)
  expect(calls).toBeGreaterThanOrEqual(2)
  expect(logs.some(line => line.includes('blit denied: not mounted'))).toBe(true)
  await ui.unmount()
})

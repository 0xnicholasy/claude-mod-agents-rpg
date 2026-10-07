import { expect, test } from 'claude-code/testing'
import type { UiBlitArgs } from 'claude-code'
import { parseFrameLine, splitLines } from './frames'

test('frame lines parse, other lines do not, partial lines carry over', () => {
  expect(parseFrameLine('frame 1 /x.png')).toEqual({ n: 1, path: '/x.png' })
  expect(parseFrameLine('fps 10.1')).toBeUndefined()
  expect(splitLines('fra', 'me 2 /y.png\nfps')).toEqual({ lines: ['frame 2 /y.png'], carry: 'fps' })
})

test('/htmlspike opens the pane and a spawned `frame 1 /x.png` blits a png file source with generation 1', async ($, on) => {
  const opened: string[] = []
  const blits: UiBlitArgs[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'htmlspike' } }))
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.log', () => ({ value: undefined }))
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: 'frame 1 /x.png\n' }
    await new Promise(resolve => setTimeout(resolve, 20))
    return { code: 0, signal: null }
  })
  on('ui.blit', (_$, e) => {
    blits.push(e)
    return { value: {} }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'htmlspike', args: '', origin: 'user', presentation: 'text' })
  await new Promise(resolve => setTimeout(resolve, 50))
  expect(opened).toEqual(['htmlspike'])
  expect(blits.length).toBe(1)
  expect(blits[0]?.requestId).toBe('htmlspike')
  expect(blits[0]?.key).toBe('view')
  expect(blits[0]?.source).toEqual({ file: '/x.png', format: 'png', generation: 1 })
})

const htmlProps = {
  title: 'HTML spike',
  isFocused: false,
  bodyColumns: 76,
  placement: 'inline',
  scroll: { offset: 0, bodyRows: 11 },
  view: {},
} as const

test('the pane mounts the keyed Image on its very first render, before any frame', async ($, on) => {
  const ui = await $.ui.mount({ plugin: 'imgspike', surface: 'terminal', component: 'Pane', requestId: 'htmlspike', props: htmlProps })
  const image = await ui.find({ type: 'Image' })
  expect(image).toBeDefined()
  expect((image?.props as { key?: string } | undefined)?.key).toBe('view')
  await ui.unmount()
})

test('a renderer that exits early shows its exit code and stderr in the pane text', async ($, on) => {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'htmlspike' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.log', () => ({ value: undefined }))
  on('process.spawn', async function* () {
    yield { stream: 'stderr' as const, text: 'Cannot find module playwright' }
    return { value: { code: 1, signal: null } }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'htmlspike', args: '', origin: 'user', presentation: 'text' })
  await new Promise(resolve => setTimeout(resolve, 50))
  const ui = await $.ui.mount({ plugin: 'imgspike', surface: 'terminal', component: 'Pane', requestId: 'htmlspike', props: htmlProps })
  const text = await ui.find({ text: 'code 1' })
  expect(text).toBeDefined()
  await ui.unmount()
})

test('the Image box clamps a wide pane to 255 columns and floors fractional sizes to whole numbers', async ($, on) => {
  const wide = await $.ui.mount({ plugin: 'imgspike', surface: 'terminal', component: 'Pane', requestId: 'htmlspike', props: { ...htmlProps, bodyColumns: 300 } })
  expect((await wide.find({ type: 'Image' }))?.props).toMatchObject({ columns: 255 })
  await wide.unmount()
  const frac = await $.ui.mount({ plugin: 'imgspike', surface: 'terminal', component: 'Pane', requestId: 'htmlspike', props: { ...htmlProps, bodyColumns: 76.7, scroll: { offset: 0, bodyRows: 11.4 } } })
  const props = (await frac.find({ type: 'Image' }))?.props as { columns?: number; rows?: number } | undefined
  expect(props?.columns).toBe(76)
  expect(props?.rows).toBe(11)
  await frac.unmount()
})

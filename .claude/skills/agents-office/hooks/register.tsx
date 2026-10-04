import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

const PANE = 'office'
const opened = atom({ plugin: 'agents-office', key: 'opened' } as const, false)

// Runs a hook body; a failure is logged to the debug log and never thrown.
const guard = async <T,>(
  $: EngineInterface,
  name: string,
  fallback: T,
  body: () => Promise<T> | T,
): Promise<T> => {
  try {
    return await body()
  } catch (error) {
    $.ui.log(`${name} failed: ${String(error)}`, { to: 'debug' })
    return fallback
  }
}

const openOffice = async ($: EngineInterface): Promise<void> => {
  await $.ui.open({ id: PANE, title: 'Office' })
  await update($, opened, () => true)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await guard($, 'session.start', undefined, async () => {
      await $.command.register({
        name: 'office',
        description: 'Show the agents office pane',
      })
      // No unasked open: session.start input has only cwd, surface and
      // isInteractive, no fullscreen field (isFullscreen is on command.run
      // presentation and on the ui.render viewport only).
    })

    return next(e)
  })

  on('command.run', { command: 'office' }, async $ =>
    guard($, 'command.run', { text: 'Office pane failed to open.' }, async () => {
      const wasOpened = await read($, opened)
      await openOffice($)

      return { text: wasOpened ? 'Office pane reopened.' : 'Office pane opened.' }
    }),
  )

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Text>Office: no agents yet</Text>
      </Box>
    )
  })
}

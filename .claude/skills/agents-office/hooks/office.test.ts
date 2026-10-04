import { expect, test } from 'claude-code/testing'

test('office pane shows the empty state on every surface', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'agents-office',
      surface,
      component: 'Pane',
      requestId: 'office',
      props: {
        title: 'Office',
        isFocused: false,
        bodyColumns: 60,
        placement: 'inline',
        scroll: { offset: 0, bodyRows: 20 },
        view: {},
      },
    })
    expect(await ui.find({ type: 'Text', text: 'Office: no agents yet' })).toBeDefined()
    await ui.unmount()
  }
})

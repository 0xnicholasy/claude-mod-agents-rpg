import { chromium } from '/private/tmp/claude-501/-Users-hotingyuen-Desktop-claude-projects-claude-mods-claude-mod-agents-rpg/6279ab0f-657c-4da3-98af-1907ee81c96c/scratchpad/imgspike/node_modules/playwright/index.mjs'
import { pathToFileURL } from 'node:url'
const SP = process.argv[2]
const b = await chromium.launch()
for (const [scale, out] of [[1, 'office-preview.png'], [2, 'office-preview-2x.png']]) {
  const p = await b.newPage({ viewport: { width: 608, height: 368 }, deviceScaleFactor: scale })
  await p.goto(pathToFileURL(SP + '/imgspike/renderer/office.html').href)
  await p.evaluate(() => window.setState({ label: 'HELLO FROM STATE' }))
  await p.waitForTimeout(1500)
  await p.screenshot({ path: SP + '/v3-assets/' + out })
}
await b.close()

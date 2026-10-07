// Usage: node render.mjs [width] [height] [--mode=screenshot|screencast] [--seconds=N]
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync, renameSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = name => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1]
const nums = args.filter(a => !a.startsWith('--')).map(Number)
const width = nums[0] || 608
const height = nums[1] || 368
const mode = flag('mode') ?? 'screenshot'
const seconds = Number(flag('seconds') ?? 0)
const FRAME_MS = 100
const outDir = join(tmpdir(), 'imgspike')
mkdirSync(outDir, { recursive: true })
const statePath = join(here, 'state.json')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width, height } })
await page.goto(pathToFileURL(join(here, 'office.html')).href)

let n = 0
let lastState = ''
const startedAt = Date.now()
let windowStart = Date.now()
let windowFrames = 0

const pushState = async () => {
  if (!existsSync(statePath)) return
  const text = readFileSync(statePath, 'utf8')
  if (text === lastState) return
  lastState = text
  const state = JSON.parse(text)
  // The plugin writes the pixel size of the pane box; follow it.
  const { w, h } = state
  if (Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0) {
    const cur = page.viewportSize()
    if (cur === null || cur.width !== w || cur.height !== h) await page.setViewportSize({ width: w, height: h })
  }
  await page.evaluate(s => window.setState(s), state)
}

const emit = bytes => {
  const path = join(outDir, `frame-${n % 2}.png`)
  const tmp = `${path}.tmp`
  writeFileSync(tmp, bytes)
  renameSync(tmp, path)
  n += 1
  process.stdout.write(`frame ${n} ${path}\n`)
  windowFrames += 1
  if (windowFrames === 50) {
    const fps = (windowFrames / ((Date.now() - windowStart) / 1000)).toFixed(1)
    process.stdout.write(`fps ${fps}\n`)
    windowStart = Date.now()
    windowFrames = 0
  }
}

const done = () => seconds > 0 && Date.now() - startedAt > seconds * 1000
const shutdown = async () => {
  await browser.close().catch(() => {})
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

if (mode === 'screencast') {
  // Uncapped: every compositor frame Chromium sends is written (PNG, acked one by one).
  const cdp = await page.context().newCDPSession(page)
  cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
    emit(Buffer.from(data, 'base64'))
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
    if (done()) await shutdown()
  })
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
  await new Promise(() => {})
} else {
  // Paced to FRAME_MS; the fps line reports the paced rate, `max` runs unpaced to measure capability.
  const paced = flag('paced') !== '0'
  for (;;) {
    const t0 = Date.now()
    await pushState()
    const bytes = await page.screenshot({ type: 'png', omitBackground: false })
    emit(bytes)
    if (done()) break
    const wait = FRAME_MS - (Date.now() - t0)
    if (paced && wait > 0) await new Promise(r => setTimeout(r, wait))
  }
  await shutdown()
}

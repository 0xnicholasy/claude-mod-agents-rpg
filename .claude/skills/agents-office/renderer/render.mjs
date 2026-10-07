// Usage: node render.mjs [width] [height] [--seconds=N] [--paced=0] [--state=<path>]
import { mkdtempSync, chmodSync, rmSync, writeFileSync, renameSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const nums = args.filter(a => !a.startsWith('--')).map(Number)
const width = nums[0] || 608
const height = nums[1] || 368
const seconds = Number(flag('seconds') ?? 0)
const FRAME_MS = 100
// Frames go only into a private per-run dir (0700), removed on exit.
const outDir = mkdtempSync(join(tmpdir(), 'agents-office-'))
chmodSync(outDir, 0o700)
process.stdout.write(`dir ${outDir}\n`)
process.on('exit', () => rmSync(outDir, { recursive: true, force: true }))
const statePath = flag('state') ?? join(here, 'state.json')

const fail = (code, err) => {
  const text = (err instanceof Error ? err.message : String(err)).split('\n')[0]
  process.stdout.write(`error ${code} ${text}\n`)
  process.exit(1)
}

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch (err) {
  fail('no-playwright', err)
}
let browser
try {
  browser = await chromium.launch()
} catch (err) {
  fail(/executable doesn't exist/i.test(String(err)) ? 'no-chromium' : 'launch', err)
}
let page
try {
  page = await browser.newPage({ viewport: { width, height } })
  await page.addInitScript(table => {
    window.SPRITE_TABLE = table
  }, JSON.parse(readFileSync(join(here, 'sprite-table.json'), 'utf8')))
  await page.goto(pathToFileURL(join(here, 'office.html')).href)
} catch (err) {
  await browser.close().catch(() => {})
  fail('page', err)
}
process.stdout.write('ready\n')

let n = 0
let lastState = ''
const startedAt = Date.now()
let windowStart = Date.now()
let windowFrames = 0

const pushState = async () => {
  if (!existsSync(statePath)) return
  const text = readFileSync(statePath, 'utf8')
  if (text === lastState) return
  let state
  try {
    state = JSON.parse(text)
  } catch {
    return // torn or partial write: keep the last scene and retry next poll
  }
  // D5 shape: { v: 1, seq, heartbeatAt, size: { w, h }, scene }. Anything else keeps the last scene.
  if (state === null || typeof state !== 'object' || state.v !== 1) return
  // The plugin writes the pixel size of the pane box as size: { w, h }; follow it.
  const { w, h } = state.size ?? {}
  if (Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0) {
    const cur = page.viewportSize()
    if (cur === null || cur.width !== w || cur.height !== h) await page.setViewportSize({ width: w, height: h })
  }
  await page.evaluate(model => window.setScene(model), state.scene)
  lastState = text
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
let closing = false
const shutdown = async () => {
  closing = true
  await browser.close().catch(() => {})
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

// Paced to FRAME_MS; the fps line reports the paced rate, `max` runs unpaced to measure capability.
const paced = flag('paced') !== '0'
for (;;) {
  const t0 = Date.now()
  let bytes
  try {
    await pushState()
    bytes = await page.screenshot({ type: 'png', omitBackground: false })
  } catch (err) {
    // SIGTERM closes the browser mid-frame; that is a normal stop, not an error.
    if (closing) await new Promise(() => {})
    await browser.close().catch(() => {})
    fail('page', err)
  }
  emit(bytes)
  if (done()) break
  const wait = FRAME_MS - (Date.now() - t0)
  if (paced && wait > 0) await new Promise(r => setTimeout(r, wait))
}
await shutdown()

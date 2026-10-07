// Usage: node render.mjs [width] [height] [--seconds=N] [--state=<path>] [--session=<id>] [--once]
// Protocol (D6): stdout lines `dir`, `ready`, `frame`, `fps`, `error <code> <text>`.
// Watchdog (D7): private 0700 temp dir with a `pid` file, sweep of dead sibling dirs, exit on a stale
// heartbeat (> 10 s) or a changed parent pid, cleanup on SIGTERM/SIGINT.
import { mkdtempSync, writeSync, chmodSync, rmSync, writeFileSync, renameSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Captured first: if the parent dies while Chromium starts, a later read would already be the reparented pid.
const parentPid = process.ppid
const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const nums = args.filter(a => !a.startsWith('--')).map(Number)
const width = nums[0] || 608
const height = nums[1] || 368
const seconds = Number(flag('seconds') ?? 0)
const once = args.includes('--once')
const session = (flag('session') ?? 'x').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'x'
const statePath = flag('state') ?? join(here, 'state.json')

const POLL_MS = 50
const BUSY_FRAME_MS = 83 // 12 fps cap (D13)
const STALE_MS = 10_000
const WATCHDOG_MS = 1000
const PREFIX = 'agents-office-'

// Frames go only into a private per-run dir (0700), removed on exit.
const outDir = mkdtempSync(join(tmpdir(), `${PREFIX}${session}-`))
chmodSync(outDir, 0o700)
writeFileSync(join(outDir, 'pid'), String(process.pid))
process.stdout.write(`dir ${outDir}\n`)
process.on('exit', () => rmSync(outDir, { recursive: true, force: true }))
// The plugin's private state dir is removed here too, in case the plugin cannot (only a dir it made: `mktemp` names).
const stateDir = dirname(statePath)
if (basename(stateDir).startsWith('agents-office-state.')) process.on('exit', () => rmSync(stateDir, { recursive: true, force: true }))

// Remove sibling dirs whose pid file names a dead process. A dir without a readable pid file is left alone.
const alive = pid => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}
const sweep = () => {
  let names
  try {
    names = readdirSync(tmpdir())
  } catch {
    return
  }
  for (const name of names) {
    if (!name.startsWith(PREFIX)) continue
    const dir = join(tmpdir(), name)
    if (dir === outDir) continue
    try {
      const pid = Number(readFileSync(join(dir, 'pid'), 'utf8').trim())
      if (Number.isInteger(pid) && pid > 0 && !alive(pid)) rmSync(dir, { recursive: true, force: true })
    } catch {
      // no pid file or unreadable: not ours to remove
    }
  }
}
sweep()

const fail = (code, err) => {
  const text = (err instanceof Error ? err.message : String(err)).split('\n')[0]
  writeSync(1, `error ${code} ${text}\n`)
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
  // Our handlers own the signals: Playwright's SIGINT handler would exit 130 on its own.
  browser = await chromium.launch({ handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false })
} catch (err) {
  // Playwright words a missing browser as "Executable doesn't exist at <path>" (measured on 1.x, T11).
  fail(/executable doesn't exist/i.test(String(err)) ? 'no-chromium' : 'launch', err)
}
let closing = false
const shutdown = async code => {
  closing = true
  // A hung Chromium must not keep the renderer alive: give close() 3 s, then exit anyway.
  await Promise.race([browser.close().catch(() => {}), new Promise(res => setTimeout(res, 3000))])
  process.exit(code)
}
process.on('SIGTERM', () => shutdown(0))
process.on('SIGINT', () => shutdown(0))
browser.on('disconnected', () => {
  if (!closing) fail('page', new Error('browser disconnected'))
})

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

const startedAt = Date.now()
let lastHeartbeat = startedAt
setInterval(() => {
  if (closing) return
  if (process.ppid !== parentPid) void shutdown(0)
  else if (Date.now() - lastHeartbeat > STALE_MS) void shutdown(0)
}, WATCHDOG_MS)

let n = 0
let lastText = ''
let lastSeq = -1
let windowStart = Date.now()
let windowFrames = 0

// Reads state.json; returns true when a new scene (a new seq) was applied.
const pushState = async () => {
  let text
  try {
    text = readFileSync(statePath, 'utf8')
  } catch {
    return false // no file yet
  }
  if (text === lastText) return false
  let state
  try {
    state = JSON.parse(text)
  } catch {
    return false // torn or partial write: keep the last scene and retry next poll
  }
  // D5 shape: { v: 1, seq, heartbeatAt, size: { w, h }, scene }. Anything else keeps the last scene.
  if (state === null || typeof state !== 'object' || state.v !== 1) return false
  lastText = text
  if (Number.isFinite(state.heartbeatAt)) lastHeartbeat = Math.min(state.heartbeatAt, Date.now())
  if (state.seq === lastSeq) return false // heartbeat-only rewrite
  lastSeq = state.seq
  // The plugin writes the pixel size of the pane box as size: { w, h }; follow it.
  const { w, h } = state.size ?? {}
  if (Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0) {
    const cur = page.viewportSize()
    if (cur === null || cur.width !== w || cur.height !== h) await page.setViewportSize({ width: w, height: h })
  }
  await page.evaluate(model => window.setScene(model), state.scene)
  return true
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

// Pacing (D13): a frame only when a new scene arrived or the page is busy (plus one settling frame after it
// stops being busy), at most every BUSY_FRAME_MS. A static scene gives no frames at all.
let pending = true // the first frame is always taken
let lastShotBusy = false
let lastShotAt = 0
for (;;) {
  const t0 = Date.now()
  try {
    if (await pushState()) pending = true
    const busy = await page.evaluate(() => (typeof window.sceneBusy === 'function' ? window.sceneBusy() : false))
    if ((pending || busy || lastShotBusy) && t0 - lastShotAt >= BUSY_FRAME_MS) {
      const bytes = await page.screenshot({ type: 'png', omitBackground: false })
      emit(bytes)
      pending = false
      lastShotBusy = busy
      lastShotAt = Date.now()
      if (once) await shutdown(0)
    }
  } catch (err) {
    // SIGTERM closes the browser mid-frame; that is a normal stop, not an error.
    if (closing) await new Promise(() => {})
    await browser.close().catch(() => {})
    fail('page', err)
  }
  if (seconds > 0 && Date.now() - startedAt > seconds * 1000) break
  const wait = POLL_MS - (Date.now() - t0)
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
}
await shutdown(0)

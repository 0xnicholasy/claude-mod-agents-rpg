// Smoke test for the renderer: start render.mjs on the basic fixture, wait for the first
// `frame` line, check the PNG size equals the fixture's size, then stop the renderer.
// Then cases a-c (D13, D7) and --once: frame pacing, stale heartbeat, missing Chromium.
// Runs locally only: it needs Chromium (`npx playwright install chromium`).
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const renderer = join(root, '.claude/skills/agents-office/renderer/render.mjs')
// Optional first argument: a fixture path (default state-basic.json), e.g. scripts/fixtures/state-busy.json.
const fixture = process.argv[2] === undefined ? join(root, 'scripts/fixtures/state-basic.json') : resolve(process.argv[2])
// The page's sprite table must match hooks/sceneArt.ts (the page cannot import TS).
const table = spawnSync('node', [join(root, 'scripts/sprites/write-table.mjs'), '--check'], { stdio: 'inherit' })
if (table.status !== 0) process.exit(1)
const { size } = JSON.parse(readFileSync(fixture, 'utf8'))
const TIMEOUT_MS = 30_000

const child = spawn('node', [renderer, String(size.w), String(size.h), `--state=${fixture}`], {
  stdio: ['ignore', 'pipe', 'inherit'],
})

const stop = () =>
  new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve()
    const force = setTimeout(() => child.kill('SIGKILL'), 5000)
    child.once('exit', () => {
      clearTimeout(force)
      resolve()
    })
    child.kill('SIGTERM')
  })

// Resolves with the first frame path once `dir`, `ready`, `frame` have arrived in that order.
const firstFrame = () =>
  new Promise((resolve, reject) => {
    let buf = ''
    const seen = []
    const timer = setTimeout(() => reject(new Error(`no frame within ${TIMEOUT_MS / 1000} s`)), TIMEOUT_MS)
    child.stdout.on('data', chunk => {
      buf += chunk
      let cut
      while ((cut = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, cut)
        buf = buf.slice(cut + 1)
        const word = line.split(' ')[0]
        if (word === 'error') {
          clearTimeout(timer)
          reject(new Error(`renderer reported: ${line}`))
          return
        }
        if (word === 'dir' || word === 'ready' || word === 'frame') {
          if (!seen.includes(word)) seen.push(word)
        }
        const m = /^frame \d+ (.+)$/.exec(line)
        if (m) {
          clearTimeout(timer)
          if (seen.join(',') !== 'dir,ready,frame') {
            reject(new Error(`protocol order was ${seen.join(',')}, want dir,ready,frame`))
            return
          }
          console.log(`protocol ${seen.join(' -> ')}`)
          resolve(m[1])
          return
        }
      }
    })
    child.once('error', err => {
      clearTimeout(timer)
      reject(err)
    })
    child.once('exit', code => {
      clearTimeout(timer)
      reject(new Error(`renderer exited (code ${code}) before the first frame`))
    })
  })

let exitCode = 0
try {
  const file = await firstFrame()
  const png = readFileSync(file)
  // PNG IHDR: width at byte 16, height at byte 20 (big endian).
  const w = png.readUInt32BE(16)
  const h = png.readUInt32BE(20)
  if (w !== size.w || h !== size.h) throw new Error(`frame is ${w}x${h}, want ${size.w}x${size.h}`)
  // SMOKE_FRAME_OUT=<file.png> keeps a copy of the frame, because the renderer deletes its temp dir on exit.
  if (process.env.SMOKE_FRAME_OUT) copyFileSync(file, process.env.SMOKE_FRAME_OUT)
  console.log(`ok ${w}x${h}`)
} catch (err) {
  console.error(`smoke failed: ${err instanceof Error ? err.message : String(err)}`)
  exitCode = 1
} finally {
  await stop()
}

// ---- cases a-c and --once ----
const sleep = ms => new Promise(r => setTimeout(r, ms))

// Starts a renderer; `lines` fills with stdout lines, `exited` resolves with { code, ms } when it ends.
const launch = (argv, env = {}) => {
  const startedAt = Date.now()
  const proc = spawn('node', [renderer, ...argv], {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, ...env },
  })
  const lines = []
  let buf = ''
  proc.stdout.on('data', chunk => {
    buf += chunk
    let cut
    while ((cut = buf.indexOf('\n')) !== -1) {
      lines.push(buf.slice(0, cut))
      buf = buf.slice(cut + 1)
    }
  })
  const exited = new Promise(resolve => proc.once('close', code => resolve({ code, ms: Date.now() - startedAt })))
  const dirOf = () => lines.find(l => l.startsWith('dir '))?.slice(4)
  const waitFor = async (pred, ms) => {
    const until = Date.now() + ms
    while (Date.now() < until) {
      if (lines.some(pred)) return true
      await sleep(25)
    }
    return false
  }
  return { proc, lines, exited, dirOf, waitFor }
}
const frameCount = r => r.lines.filter(l => l.startsWith('frame ')).length
const killAfter = async r => {
  if (r.proc.exitCode === null && r.proc.signalCode === null) r.proc.kill('SIGTERM')
  await r.exited
}

const scratch = mkdtempSync(join(tmpdir(), 'ao-smoke-'))
const fixtureWith = (name, heartbeatAt) => {
  const base = JSON.parse(readFileSync(fixture, 'utf8'))
  const path = join(scratch, name)
  writeFileSync(path, JSON.stringify({ ...base, heartbeatAt }))
  return path
}
const sizeArgs = [String(size.w), String(size.h)]
const check = (ok, msg) => {
  if (!ok) throw new Error(msg)
}

if (exitCode === 0) {
  try {
    // (a) a static fixture produces 1 frame and then none for 3 s.
    {
      const r = launch([...sizeArgs, `--state=${fixtureWith('a.json', Date.now() + 60_000)}`])
      check(await r.waitFor(l => l.startsWith('frame '), 20_000), 'case a: no first frame')
      await sleep(3000)
      const frames = frameCount(r)
      await killAfter(r)
      check(frames === 1, `case a: ${frames} frames, want 1`)
      console.log('pass a: static fixture gave 1 frame, then none for 3 s')
    }
    // (b) a stale heartbeat makes the renderer exit 0 within 11 s, and its dir is gone.
    {
      const r = launch([...sizeArgs, `--state=${fixtureWith('b.json', Date.now() - 5000)}`])
      const { code, ms } = await Promise.race([
        r.exited,
        sleep(20_000).then(() => ({ code: 'timeout', ms: 20_000 })),
      ])
      if (code === 'timeout') await killAfter(r)
      check(code === 0 && ms <= 11_000, `case b: exit ${code} after ${ms} ms, want 0 within 11000 ms`)
      const dir = r.dirOf()
      check(dir !== undefined && !existsSync(dir), 'case b: dir still exists')
      console.log(`pass b: stale heartbeat exited 0 after ${ms} ms, dir gone`)
    }
    // (c) PLAYWRIGHT_BROWSERS_PATH=/nonexistent gives an `error no-chromium` line and exit 1.
    {
      const r = launch(sizeArgs, { PLAYWRIGHT_BROWSERS_PATH: '/nonexistent' })
      const { code } = await r.exited
      const line = r.lines.find(l => l.startsWith('error '))
      check(code === 1 && line?.startsWith('error no-chromium '), `case c: exit ${code}, line ${line}`)
      const dir = r.dirOf()
      check(dir !== undefined && !existsSync(dir), 'case c: dir still exists')
      console.log(`pass c: exit 1, "${line}"`)
    }
    // --once: one frame, exit 0, dir gone. A dead sibling dir is swept, a live one is kept.
    {
      const dead = mkdtempSync(join(tmpdir(), 'agents-office-smokedead-'))
      writeFileSync(join(dead, 'pid'), '2147483646')
      const live = mkdtempSync(join(tmpdir(), 'agents-office-smokelive-'))
      writeFileSync(join(live, 'pid'), String(process.pid))
      const r = launch([...sizeArgs, `--state=${fixtureWith('d.json', Date.now() + 60_000)}`, '--once'])
      const { code } = await r.exited
      const dir = r.dirOf()
      const swept = !existsSync(dead)
      const kept = existsSync(live)
      rmSync(dead, { recursive: true, force: true })
      rmSync(live, { recursive: true, force: true })
      check(code === 0 && frameCount(r) === 1 && dir !== undefined && !existsSync(dir), `once: exit ${code}, ${frameCount(r)} frames`)
      check(swept && kept, `sweep: dead dir swept ${swept}, live dir kept ${kept}`)
      console.log('pass once: 1 frame, exit 0, dir gone; sweep removed the dead dir and kept the live one')
    }
  } catch (err) {
    console.error(`smoke failed: ${err instanceof Error ? err.message : String(err)}`)
    exitCode = 1
  }
}
rmSync(scratch, { recursive: true, force: true })
process.exit(exitCode)

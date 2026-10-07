// Smoke test for the renderer: start render.mjs on the basic fixture, wait for the first
// `frame` line, check the PNG size equals the fixture's size, then stop the renderer.
// Runs locally only: it needs Chromium (`npx playwright install chromium`).
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const renderer = join(root, '.claude/skills/agents-office/renderer/render.mjs')
const fixture = join(root, 'scripts/fixtures/state-basic.json')
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

const firstFrame = () =>
  new Promise((resolve, reject) => {
    let buf = ''
    const timer = setTimeout(() => reject(new Error(`no frame within ${TIMEOUT_MS / 1000} s`)), TIMEOUT_MS)
    child.stdout.on('data', chunk => {
      buf += chunk
      const m = /^frame \d+ (.+)$/m.exec(buf)
      if (m) {
        clearTimeout(timer)
        resolve(m[1])
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
  console.log(`ok ${w}x${h}`)
} catch (err) {
  console.error(`smoke failed: ${err instanceof Error ? err.message : String(err)}`)
  exitCode = 1
} finally {
  await stop()
}
process.exit(exitCode)

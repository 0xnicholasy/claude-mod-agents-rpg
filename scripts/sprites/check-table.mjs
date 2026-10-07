// Fails when renderer/sprites/atlas.json and the SPRITES table in hooks/sceneArt.ts list different names.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const mod = join(root, '.claude', 'skills', 'agents-office')
const atlas = Object.keys(JSON.parse(readFileSync(join(mod, 'renderer', 'sprites', 'atlas.json'), 'utf8')).sprites)
const src = readFileSync(join(mod, 'hooks', 'sceneArt.ts'), 'utf8')
const block = /export const SPRITES = \{([\s\S]*?)\n\} as const/.exec(src)
if (block === null) {
  console.error('sprites:check: SPRITES table not found in hooks/sceneArt.ts')
  process.exit(1)
}
const table = [...block[1].matchAll(/^ {2}'([^']+)':/gm)].map(m => m[1])
const missing = atlas.filter(n => !table.includes(n))
const extra = table.filter(n => !atlas.includes(n))
if (missing.length > 0 || extra.length > 0) {
  if (missing.length > 0) console.error('sprites:check: atlas sprites without a table entry: ' + missing.join(', '))
  if (extra.length > 0) console.error('sprites:check: table entries without an atlas sprite: ' + extra.join(', '))
  process.exit(1)
}
console.log(`sprites:check: ${atlas.length} sprites match the table`)

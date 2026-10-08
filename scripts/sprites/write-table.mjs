// Writes renderer/sprite-table.json: the sprite scale/anchor/layer table of hooks/sceneArt.ts joined with each
// sprite's pixel size from renderer/sprites/atlas.json. The page cannot import TS (v3 D14), so render.mjs hands
// this file to it. hooks/sceneArt.ts stays the one source of truth.
// `node scripts/sprites/write-table.mjs` writes it; `--check` fails when the committed file is stale.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const mod = join(root, '.claude', 'skills', 'agents-office')
const out = join(mod, 'renderer', 'sprite-table.json')
const atlas = JSON.parse(readFileSync(join(mod, 'renderer', 'sprites', 'atlas.json'), 'utf8')).sprites
const src = readFileSync(join(mod, 'hooks', 'sceneArt.ts'), 'utf8')
const block = /export const SPRITES = \{([\s\S]*?)\n\} as const/.exec(src)
if (block === null) {
  console.error('sprites:table: SPRITES table not found in hooks/sceneArt.ts')
  process.exit(1)
}
const rows = [...block[1].matchAll(/^ {2}'([^']+)': \{ scale: ([\d.]+), anchor: '(\w+)', layer: '(\w+)' \},?$/gm)]
const keyed = [...block[1].matchAll(/^ {2}'[^']+':/gm)].length
if (keyed !== rows.length) {
  console.error(`sprites:table: ${keyed} table entries but only ${rows.length} match the one-line format of hooks/sceneArt.ts`)
  process.exit(1)
}
const sprites = {}
for (const [, name, scale, anchor, layer] of rows) {
  const size = atlas[name]
  if (size === undefined) {
    console.error(`sprites:table: ${name} has no atlas entry`)
    process.exit(1)
  }
  sprites[name] = { w: size.w, h: size.h, scale: Number(scale), anchor, layer }
}
const cell = /export const CELL_PX = \{ w: (\d+), h: (\d+) \}/.exec(src)
if (cell === null) {
  console.error('sprites:table: CELL_PX not found in hooks/sceneArt.ts')
  process.exit(1)
}
const text = JSON.stringify({ cell: { w: Number(cell[1]), h: Number(cell[2]) }, sprites }, null, 1) + '\n'
if (process.argv.includes('--check')) {
  let current = ''
  try {
    current = readFileSync(out, 'utf8')
  } catch {
    // a missing file counts as stale
  }
  if (current !== text) {
    console.error('sprites:table: renderer/sprite-table.json is stale, run `npm run sprites:table`')
    process.exit(1)
  }
  console.log(`sprites:table: ${rows.length} sprites match renderer/sprite-table.json`)
} else {
  writeFileSync(out, text)
  console.log(`sprites:table: wrote ${rows.length} sprites to renderer/sprite-table.json`)
}

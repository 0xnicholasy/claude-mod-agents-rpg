import { PNG } from 'pngjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load, key, components, merge } from './lib.mjs'

// usage: node slice.mjs [rawDir] [outDir] [factor]
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const RAW = resolve(process.argv[2] || join(ROOT, 'assets/sprites/raw'))
const OUT = resolve(process.argv[3] || join(ROOT, '.claude/skills/agents-office/renderer/sprites'))
mkdirSync(OUT, { recursive: true })

const FURNITURE = [
  ['desk-monitor', 'desk-dual', 'chair', 'round-table', 'conference-table'],
  ['sofa', 'armchair', 'plant-tall', 'plant-small', 'coffee-machine', 'water-cooler', 'fridge'],
  ['kitchen-counter', 'whiteboard', 'bookshelf', 'filing-cabinet', 'server-rack', 'printer'],
  ['wall-clock', 'reception-desk', 'cat-bed', 'cat-orange-sit', 'cat-orange-walk'],
]
const PETS = [
  ['mascot-down', 'mascot-left', 'mascot-right', 'mascot-up', 'mascot-bounce'],
  ['corgi-down', 'corgi-left', 'corgi-right', 'corgi-up', 'corgi-sleep'],
  ['cat-black-sit', 'cat-black-walk', 'cat-tabby-sit', 'cat-tabby-walk', 'dog-bed'],
  ['laptop-back', 'laptop-front', 'laptop-closed', 'monitor-terminal', 'keyboard', 'mouse'],
  ['mug', 'headphones', 'phone', 'lamp', 'sticky-notes', 'backpack'],
]
const DIRS = ['down', 'left', 'right', 'up']

// art-pixel size: histogram of horizontal run lengths of near-identical colour
function detect(png, m) {
  const { width: w, height: h, data } = png
  const hist = {}
  for (let y = 0; y < h; y++) {
    let run = 1
    for (let x = 1; x <= w; x++) {
      const p = y * w + x, q = p - 1
      const same = x < w && m[p] && m[q] && Math.abs(data[p * 4] - data[q * 4]) + Math.abs(data[p * 4 + 1] - data[q * 4 + 1]) + Math.abs(data[p * 4 + 2] - data[q * 4 + 2]) < 40
      if (same) run++
      else { if (run >= 2 && run <= 40) hist[run] = (hist[run] || 0) + 1; run = 1 }
    }
  }
  return hist
}

const sheets = {}
function prep(file) {
  const png = load(file)
  const m = key(png)
  const { comps } = components(m, png.width, png.height)
  const items = merge(comps.filter(c => c.area >= 40), 6).filter(c => c.area >= 600)
  return { png, m, items }
}
function rowsOf(items, names) {
  const sorted = [...items].sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1))
  const rows = []
  for (const it of sorted) {
    const cy = (it.y0 + it.y1) / 2
    const last = rows[rows.length - 1]
    if (last && cy - last.cy < 90) { last.items.push(it); last.cy = (last.cy * (last.items.length - 1) + cy) / last.items.length }
    else rows.push({ cy, items: [it] })
  }
  if (rows.length !== names.length) throw new Error(`row count ${rows.length} != ${names.length}`)
  const out = []
  rows.forEach((r, i) => {
    r.items.sort((a, b) => a.x0 - b.x0)
    if (r.items.length !== names[i].length) throw new Error(`row ${i}: ${r.items.length} items != ${names[i].length}`)
    r.items.forEach((it, j) => out.push([names[i][j], it]))
  })
  return out
}

function crop(png, m, b, ids, lab) {
  const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1
  const px = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x + b.x0, sy = y + b.y0, p = sy * png.width + sx
    if (!m[p]) continue
    const o = (y * w + x) * 4
    px[o] = png.data[p * 4]; px[o + 1] = png.data[p * 4 + 1]; px[o + 2] = png.data[p * 4 + 2]; px[o + 3] = 255
  }
  return { w, h, px }
}

// keep only pixels belonging to the item's component ids (so neighbours inside bbox are not copied)
function cropItem(sheet, it) {
  const { png, lab, m } = sheet
  const ids = new Set(it.ids)
  const w = it.x1 - it.x0 + 1, h = it.y1 - it.y0 + 1
  const px = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (y + it.y0) * png.width + (x + it.x0)
    if (!m[p] || !ids.has(lab[p])) continue
    const o = (y * w + x) * 4
    px[o] = png.data[p * 4]; px[o + 1] = png.data[p * 4 + 1]; px[o + 2] = png.data[p * 4 + 2]; px[o + 3] = 255
  }
  return { w, h, px }
}

// downscale by integer factor: dominant colour bin per block, opaque if >= 50% opaque
function down(img, f) {
  const w = Math.max(1, Math.round(img.w / f)), h = Math.max(1, Math.round(img.h / f))
  const px = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.floor(x * img.w / w), x1 = Math.max(x0 + 1, Math.floor((x + 1) * img.w / w))
    const y0 = Math.floor(y * img.h / h), y1 = Math.max(y0 + 1, Math.floor((y + 1) * img.h / h))
    let on = 0, tot = 0
    const bins = new Map()
    for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
      tot++
      const o = (sy * img.w + sx) * 4
      if (!img.px[o + 3]) continue
      on++
      const k = (img.px[o] >> 4) << 8 | (img.px[o + 1] >> 4) << 4 | (img.px[o + 2] >> 4)
      const e = bins.get(k) || { n: 0, r: 0, g: 0, b: 0 }
      e.n++; e.r += img.px[o]; e.g += img.px[o + 1]; e.b += img.px[o + 2]
      bins.set(k, e)
    }
    if (on * 2 < tot) continue
    let best = null
    for (const e of bins.values()) if (!best || e.n > best.n) best = e
    const d = (y * w + x) * 4
    px[d] = Math.round(best.r / best.n); px[d + 1] = Math.round(best.g / best.n); px[d + 2] = Math.round(best.b / best.n); px[d + 3] = 255
  }
  return { w, h, px }
}
function save(name, img) {
  const png = new PNG({ width: img.w, height: img.h })
  png.data = Buffer.from(img.px)
  writeFileSync(`${OUT}/${name}.png`, PNG.sync.write(png))
}

const atlas = {}
const jobs = []
const FACTOR = Number(process.argv[4] || 6)

// characters
{
  const s = prep(join(RAW, 'characters-raw.png'))
  const lab = components(s.m, s.png.width, s.png.height).lab
  s.lab = lab
  const hist = detect(s.png, s.m)
  console.log('run-length histogram (2..16):', Object.entries(hist).filter(([k]) => k <= 16).map(([k, v]) => `${k}:${v}`).join(' '))
  const cw = s.png.width / 8, ch = s.png.height / 4
  const cells = []
  for (const it of s.items) {
    const c = Math.min(7, Math.floor((it.x0 + it.x1) / 2 / cw)), r = Math.min(3, Math.floor((it.y0 + it.y1) / 2 / ch))
    cells.push({ name: `person${c + 1}-${DIRS[r]}`, it })
  }
  if (cells.length !== 32) throw new Error('characters ' + cells.length)
  const H = Math.max(...cells.map(c => c.it.y1 - c.it.y0 + 1))
  const W = Math.max(...cells.map(c => c.it.x1 - c.it.x0 + 1))
  for (const { name, it } of cells) {
    const img = cropItem(s, it)
    // pad to common WxH: centred horizontally, feet at bottom
    const px = new Uint8Array(W * H * 4)
    const ox = Math.floor((W - img.w) / 2), oy = H - img.h
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      const so = (y * img.w + x) * 4, d = ((y + oy) * W + x + ox) * 4
      for (let k = 0; k < 4; k++) px[d + k] = img.px[so + k]
    }
    jobs.push([name, { w: W, h: H, px }])
  }
  console.log('person common size', W, H)
}
for (const [file, names] of [['furniture-raw.png', FURNITURE], ['pets-gear-raw.png', PETS]]) {
  const s = prep(join(RAW, file))
  s.lab = components(s.m, s.png.width, s.png.height).lab
  for (const [name, it] of rowsOf(s.items, names)) jobs.push([name, cropItem(s, it)])
}
for (const [name, img] of jobs) {
  const d = down(img, FACTOR)
  save(name, d)
  atlas[name] = { w: d.w, h: d.h }
}
writeFileSync(`${OUT}/atlas.json`, JSON.stringify({ factor: FACTOR, sprites: atlas }, null, 1))
console.log('sprites', jobs.length, 'factor', FACTOR)

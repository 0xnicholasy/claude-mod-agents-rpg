import { PNG } from 'pngjs'
import { readFileSync } from 'node:fs'
export const load = p => PNG.sync.read(readFileSync(p))
// key magenta to transparent; returns Uint8Array mask (1 = opaque)
export function key(png) {
  const { width: w, height: h, data } = png
  const mag = (i) => Math.min(data[i], data[i + 2]) - data[i + 1]
  const m = new Uint8Array(w * h)
  for (let p = 0; p < w * h; p++) {
    const i = p * 4
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const isMag = mag(i) > 70 && r > 120 && b > 120 && Math.abs(r - b) < 90
    m[p] = isMag ? 0 : 1
  }
  // fringe: two passes, drop edge pixels that are partly magenta
  for (let pass = 0; pass < 2; pass++) {
    const kill = []
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const p = y * w + x
      if (!m[p]) continue
      if (m[p - 1] && m[p + 1] && m[p - w] && m[p + w]) continue
      if (mag(p * 4) > 28) kill.push(p)
    }
    for (const p of kill) m[p] = 0
  }
  return m
}
export function components(m, w, h) {
  const lab = new Int32Array(w * h).fill(-1)
  const comps = []
  const stack = []
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || lab[s] >= 0) continue
    const id = comps.length
    const c = { id, x0: w, y0: h, x1: 0, y1: 0, area: 0 }
    stack.push(s); lab[s] = id
    while (stack.length) {
      const p = stack.pop()
      const x = p % w, y = (p / w) | 0
      c.area++
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x
      if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const q = ny * w + nx
        if (m[q] && lab[q] < 0) { lab[q] = id; stack.push(q) }
      }
    }
    comps.push(c)
  }
  return { comps, lab }
}
export function merge(comps, gap) {
  let list = comps.map(c => ({ ...c, ids: [c.id] }))
  let changed = true
  while (changed) {
    changed = false
    outer: for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j]
      const dx = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1))
      const dy = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1))
      if (dx < gap && dy < gap) {
        list[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), area: a.area + b.area, ids: [...a.ids, ...b.ids] }
        list.splice(j, 1); changed = true; break outer
      }
    }
  }
  return list
}

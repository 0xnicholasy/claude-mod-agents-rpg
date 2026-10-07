import { PNG } from 'pngjs'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
const names = readdirSync('sprites').filter(f => f.endsWith('.png') && f !== 'contact.png').sort()
const S = 3, PAD = 6, COLW = 1500
const imgs = names.map(n => ({ n, p: PNG.sync.read(readFileSync('sprites/' + n)) }))
let x = PAD, y = PAD, rowH = 0
const pos = []
for (const i of imgs) {
  const w = i.p.width * S, h = i.p.height * S + 10
  if (x + w + PAD > COLW) { x = PAD; y += rowH + PAD; rowH = 0 }
  pos.push([x, y]); x += w + PAD; rowH = Math.max(rowH, h)
}
const H = y + rowH + PAD
const out = new PNG({ width: COLW, height: H })
for (let i = 0; i < out.data.length; i += 4) { out.data[i] = 0x2b; out.data[i + 1] = 0x2d; out.data[i + 2] = 0x3a; out.data[i + 3] = 255 }
imgs.forEach((im, k) => {
  const [ox, oy] = pos[k]
  for (let sy = 0; sy < im.p.height; sy++) for (let sx = 0; sx < im.p.width; sx++) {
    const so = (sy * im.p.width + sx) * 4
    if (!im.p.data[so + 3]) continue
    for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) {
      const d = ((oy + 10 + sy * S + dy) * COLW + ox + sx * S + dx) * 4
      out.data[d] = im.p.data[so]; out.data[d + 1] = im.p.data[so + 1]; out.data[d + 2] = im.p.data[so + 2]
    }
  }
})
writeFileSync('sprites/contact.png', PNG.sync.write(out))
console.log(names.length, 'sprites', COLW, H)
console.log(names.map(n => n.replace('.png', '')).join(' '))

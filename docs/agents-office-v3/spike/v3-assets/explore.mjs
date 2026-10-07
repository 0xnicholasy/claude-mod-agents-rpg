import { load, key, components, merge } from './lib.mjs'
for (const f of ['furniture', 'pets-gear', 'characters']) {
  const png = load(`${f}-raw.png`)
  const m = key(png)
  const { comps } = components(m, png.width, png.height)
  const big = comps.filter(c => c.area >= 40)
  const mg = merge(big, 6).filter(c => c.area >= 150)
  console.log(f, png.width, png.height, 'raw', comps.length, 'merged', mg.length)
  mg.sort((a, b) => a.y0 - b.y0)
  for (const c of mg) console.log(` y${c.y0}-${c.y1} x${c.x0}-${c.x1} a${c.area}`)
}

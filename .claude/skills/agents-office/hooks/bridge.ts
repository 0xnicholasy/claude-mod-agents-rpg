export const MAX_CELLS = 255
export const MAX_PX = 2048
export const CELL_W = 8
export const CELL_H = 17
export const HEARTBEAT_MS = 2000
export const STATE_VERSION = 1

export type RendererErrorCode = 'no-playwright' | 'no-chromium' | 'launch' | 'page'

export type RendererLine =
  | { kind: 'dir'; path: string }
  | { kind: 'ready' }
  | { kind: 'frame'; n: number; path: string }
  | { kind: 'error'; code: RendererErrorCode; text: string }
  | { kind: 'fps'; value: number }

export type Box = { columns: number; rows: number }

export type WriteMark = { key: string; at: number }

const ERROR_CODES: readonly string[] = ['no-playwright', 'no-chromium', 'launch', 'page']

// Splits stdout text into whole lines. The unfinished tail is returned as the next carry.
export const splitLines = (carry: string, text: string): { lines: string[]; carry: string } => {
  const parts = (carry + text).split('\n')
  const rest = parts.pop() ?? ''
  return { lines: parts.map(l => (l.endsWith('\r') ? l.slice(0, -1) : l)).filter(l => l.length > 0), carry: rest }
}

export const parseLine = (line: string): RendererLine | undefined => {
  const space = line.indexOf(' ')
  const word = space === -1 ? line : line.slice(0, space)
  const rest = space === -1 ? '' : line.slice(space + 1)
  if (word === 'ready') return rest === '' ? { kind: 'ready' } : undefined
  if (word === 'dir') return rest.startsWith('/') ? { kind: 'dir', path: rest } : undefined
  if (word === 'frame') {
    const cut = rest.indexOf(' ')
    if (cut === -1) return undefined
    const nText = rest.slice(0, cut)
    const n = /^\d+$/.test(nText) ? Number(nText) : -1
    const path = rest.slice(cut + 1)
    return n >= 0 && path.startsWith('/') ? { kind: 'frame', n, path } : undefined
  }
  if (word === 'fps') {
    const value = Number(rest)
    return /^\d+(\.\d+)?$/.test(rest) && Number.isFinite(value) && value >= 0 ? { kind: 'fps', value } : undefined
  }
  if (word === 'error') {
    const cut = rest.indexOf(' ')
    const code = cut === -1 ? rest : rest.slice(0, cut)
    if (!ERROR_CODES.includes(code)) return undefined
    return { kind: 'error', code: code as RendererErrorCode, text: cut === -1 ? '' : rest.slice(cut + 1) }
  }
  return undefined
}

// The plugin blits only the newest frame of a stdout piece.
export const newestFrame = (lines: readonly RendererLine[]): { n: number; path: string } | undefined => {
  let best: { n: number; path: string } | undefined
  for (const l of lines) if (l.kind === 'frame') best = { n: l.n, path: l.path }
  return best
}

// The scene is the caller's model; the bridge only carries it, so it is a type parameter.
export const stateText = <S>(input: {
  seq: number
  heartbeatAt: number
  size: { w: number; h: number }
  scene: S
}): string =>
  JSON.stringify({
    v: STATE_VERSION,
    seq: input.seq,
    heartbeatAt: input.heartbeatAt,
    size: { w: input.size.w, h: input.size.h },
    scene: input.scene,
  })

// Write when the scene key changed, or the heartbeat is due (D7).
export const shouldWrite = (prev: WriteMark | undefined, nextKey: string, now: number): boolean =>
  prev === undefined || prev.key !== nextKey || now - prev.at >= HEARTBEAT_MS

// The write key of a scene at an Image box: a resize changes it even when the scene text does not (D8, T19), so the
// renderer gets the new `size` at the next tick instead of at the next heartbeat.
export const writeKeyOf = (size: { w: number; h: number }, sceneText: string): string => `${size.w}x${size.h}|${sceneText}`

export const clampCells = (n: number): number => {
  const whole = Number.isFinite(n) ? Math.floor(n) : 1
  return Math.min(MAX_CELLS, Math.max(1, whole))
}

export const pixelsFor = (box: Box): { w: number; h: number } => ({
  w: Math.min(MAX_PX, clampCells(box.columns) * CELL_W),
  h: Math.min(MAX_PX, clampCells(box.rows) * CELL_H),
})

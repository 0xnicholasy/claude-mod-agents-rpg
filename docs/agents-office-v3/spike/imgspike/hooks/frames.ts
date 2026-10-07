export type FrameLine = { n: number; path: string }

// Splits streamed text into whole lines; the last, unfinished line is carried over.
export const splitLines = (carry: string, text: string): { lines: string[]; carry: string } => {
  const parts = (carry + text).split('\n')
  const rest = parts.pop() ?? ''
  return { lines: parts, carry: rest }
}

// Parses `frame <n> <absolute path>`; other lines (fps, noise) give undefined.
export const parseFrameLine = (line: string): FrameLine | undefined => {
  const match = /^frame (\d+) (\/.+)$/.exec(line.trim())
  if (match === null) return undefined
  return { n: Number(match[1]), path: match[2] ?? '' }
}

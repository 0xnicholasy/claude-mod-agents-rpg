// Mid figure art (v2 D54, faces reworked in D64): pure pixel grids in slot letters, no colours. Standing
// 5x10 px (5x5 cells), seated 8x10 px (8x5 cells). Face first: the head is rows 0-4 and the face is the
// biggest feature (the eye row is 3 skin pixels and 2 eyes across, a mouth below). sprites.ts maps each slot to a colour.
//   H hair, S skin, T shirt, U shirt shade, K tie, P pants, F shoes, E eye, M mouth,
//   D desk top, B desk body, N monitor frame, C screen, . floor
import type { Facing } from './sprites'

export type Slot = 'H' | 'S' | 'T' | 'U' | 'K' | 'P' | 'F' | 'E' | 'M' | 'D' | 'B' | 'N' | 'C' | '.'
export const SLOTS: readonly string[] = ['H', 'S', 'T', 'U', 'K', 'P', 'F', 'E', 'M', 'D', 'B', 'N', 'C', '.']
export type Grid = readonly string[]

export const MID_STAND_W = 5
export const MID_STAND_H = 10
export const MID_SEAT_W = 8
export const MID_SEAT_H = 10

// Standing, idle: one grid per facing. Left is the mirror of right.
export const MID_IDLE: Readonly<Record<Facing, Grid>> = {
  down: [
    '.HHH.',
    'HHHHH',
    'HSSSH',
    'SESES',
    '.SMS.',
    'TTKTT',
    'UTKTU',
    'SPPPS',
    '.P.P.',
    '.F.F.',
  ],
  up: [
    '.HHH.',
    'HHHHH',
    'HHHHH',
    'HHHHH',
    '.SSS.',
    'TTTTT',
    'UTTTU',
    'SPPPS',
    '.P.P.',
    '.F.F.',
  ],
  left: [
    '.HHH.',
    'HHHHH',
    'SSSHH',
    'SESHH',
    'MSSH.',
    '.TTT.',
    '.TTU.',
    '.SPP.',
    '.P.P.',
    '.F.F.',
  ],
  right: [
    '.HHH.',
    'HHHHH',
    'HHSSS',
    'HHSES',
    '.HSSM',
    '.TTT.',
    '.UTT.',
    '.PPS.',
    '.P.P.',
    '.F.F.',
  ],
}

// Rows 0-7 of a walk frame are the idle grid's, so the head never wobbles; only the legs (rows 8-9) change.
const withLegs = (idle: Grid, legs: readonly [string, string]): Grid => [...idle.slice(0, 8), legs[0], legs[1]]

// Standing, walking: four frames per facing. Frames 0 and 2 shift the legs in opposite directions; frames 1
// and 3 keep the idle legs. Left is the mirror of right (side walks move one leg forward).
const walk = (idle: Grid, a: readonly [string, string], b: readonly [string, string]): readonly Grid[] => [
  withLegs(idle, a),
  idle,
  withLegs(idle, b),
  idle,
]

export const MID_WALK: Readonly<Record<Facing, readonly Grid[]>> = {
  down: walk(MID_IDLE.down, ['PP.P.', 'FF.F.'], ['.P.PP', '.F.FF']),
  up: walk(MID_IDLE.up, ['PP.P.', 'FF.F.'], ['.P.PP', '.F.FF']),
  left: walk(MID_IDLE.left, ['.P..P', '.F..F'], ['P..P.', 'F..F.']),
  right: walk(MID_IDLE.right, ['P..P.', 'F..F.'], ['.P..P', '.F..F']),
}

// Seated at the desk, reading: one frame. The person is columns 0-4 (the down head and torso), the
// monitor is the right-hand three columns.
export const MID_SEAT_READ: Grid = [
  '.HHH....',
  'HHHHH...',
  'HSSSH...',
  'SESESNNN',
  '.SMS.NCN',
  'TTKTTNCN',
  'UTKTUNNN',
  'DDDDDDDD',
  'BBBBBBBB',
  'BB....BB',
]

// Seated, typing: two frames; a hand pixel moves along the desk top.
const withDeskRow = (row: string): Grid => [...MID_SEAT_READ.slice(0, 7), row, ...MID_SEAT_READ.slice(8)]
export const MID_SEAT_TYPE: readonly Grid[] = [withDeskRow('DSDDDDDD'), withDeskRow('DDDSDDDD')]

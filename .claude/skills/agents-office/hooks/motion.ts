// Pure movement: target assignment, one-tile steps and the drawn pose/frame
// choice. No `$`; register.tsx reads the atoms and passes plain data in.
import type { OfficeAgent } from './agents'
import type { Motion } from './frame'
import type { OfficeMap, Point } from './map'
import { findPath } from './path'
import { frameCount, POSES } from './sprites'
import type { Pose } from './sprites'
import { TICK_MS, WORK_FRAME_TICKS } from './timing'

const same = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y

// Where an entry is heading: the end of its path, or where it stands.
export const targetOf = (entry: Motion[string]): Point => entry.path[entry.path.length - 1] ?? entry

/**
 * Sends `agentId` to the first anchor of `room` that no other agent holds (its
 * position when resting, the end of its path when walking); when every anchor is
 * held it falls back to the first one. An agent already heading to an anchor of
 * the room keeps it. Returns the same reference when the target is unchanged or
 * the agent has no entry or the room is unknown. When no path to the chosen
 * anchor exists the agent keeps its current path.
 */
export const assignTarget = (motion: Motion, map: OfficeMap, agentId: string, room: string): Motion => {
  const entry = motion[agentId]
  const found = map.rooms.find(r => r.id === room)
  if (entry === undefined || found === undefined) return motion
  const current = targetOf(entry)
  if (found.anchors.some(a => same(a, current))) return motion
  const held = Object.entries(motion)
    .filter(([id]) => id !== agentId)
    .map(([, other]) => targetOf(other))
  const spot = found.anchors.find(a => !held.some(h => same(h, a))) ?? found.anchors[0]
  if (spot === undefined) return motion
  const path = findPath(map, entry, spot)
  if (path.length === 0 && !same(entry, spot)) return motion

  return { ...motion, [agentId]: { ...entry, path } }
}

/**
 * A new agent appears at the Lobby doorStand and gets a path to an anchor of
 * `room`. An agent that already has an entry is left alone.
 */
export const enterAtDoor = (motion: Motion, map: OfficeMap, agentId: string, room: string): Motion => {
  if (motion[agentId] !== undefined) return motion
  const lobby = map.rooms.find(r => r.id === 'lobby')
  if (lobby === undefined) return motion
  const placed: Motion = { ...motion, [agentId]: { x: lobby.doorStand.x, y: lobby.doorStand.y, path: [], frame: 0 } }

  const assigned = assignTarget(placed, map, agentId, room)

  // No path (unknown room or unreachable anchor): make no entry, so the next
  // placeMotion seats the agent directly.
  return (assigned[agentId]?.path.length ?? 0) === 0 ? motion : assigned
}

/**
 * Moves every agent with a non-empty path exactly one position along it and
 * toggles its walk frame. Returns the same reference when nobody walks, so an
 * idle office writes nothing (resting work frames are derived from the clock at
 * draw time, see `drawnFrame`).
 */
export const step = (motion: Motion): Motion => {
  let next = motion
  for (const [id, entry] of Object.entries(motion)) {
    const head = entry.path[0]
    if (head === undefined) continue
    if (next === motion) next = { ...motion }
    next[id] = { x: head.x, y: head.y, path: entry.path.slice(1), frame: (entry.frame + 1) % frameCount('walk') }
  }

  return next
}

const isPose = (value: string): value is Pose => POSES.some(pose => pose === value)

/** `walk` while the agent has path left, else its work pose (an unknown pose draws `idle`). */
export const drawnPose = (agent: OfficeAgent, entry: Motion[string]): Pose =>
  entry.path.length > 0 ? 'walk' : isPose(agent.pose) ? agent.pose : 'idle'

/**
 * Sprite frame for `pose`: the stored walk frame while walking; a resting work
 * pose toggles every WORK_FRAME_TICKS ticks of the clock (D12), derived from
 * `now` so the motion atom is not written for it.
 */
export const drawnFrame = (pose: Pose, entry: Motion[string], now: number): number =>
  pose === 'walk'
    ? entry.frame % frameCount('walk')
    : Math.floor(now / (TICK_MS * WORK_FRAME_TICKS)) % frameCount(pose)

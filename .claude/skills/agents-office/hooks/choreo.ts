// Pure messaging choreography (D38): a SendMessage walks both agents to the Conference
// Room, shows the speaker's bubble, then sends both back. No `$`; register.tsx reads
// the atoms, passes plain data in and writes the changed atoms back.
import { onComplete } from './agents'
import type { MeetScript, OfficeAgent, ReportScript, Roster } from './agents'
import type { Bubble, Motion } from './frame'
import type { OfficeMap, Point, RoomId } from './map'
import { assignTarget, targetOf } from './motion'
import { findPath } from './path'
import { BUBBLE_MS } from './timing'

export type ChoreoState = {
  // Undefined while no pane has been drawn (viewport 0x0): nothing can walk then.
  map: OfficeMap | undefined
  agents: Roster
  motion: Motion
  bubbles: Bubble[]
}

export const BUBBLE_CHARS = 40

/**
 * Bubble text rule: runs of whitespace (newlines included) collapse to one space,
 * the ends are trimmed, then the first 40 code points are kept (no ellipsis).
 * An empty message shows "...".
 */
export const bubbleText = (text: string): string =>
  Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, BUBBLE_CHARS).join('') || '...'

const isGone = (agent: OfficeAgent): boolean => agent.status === 'done' || agent.status === 'leaving'

const byId = (agents: Roster, id: string): OfficeAgent | undefined =>
  Object.values(agents).find(agent => agent.id === id)

// Only a string can name an agent: by id first, then by label (the spawn `name` when one was given).
const findPeer = (agents: Roster, to: unknown): OfficeAgent | undefined => {
  // d.ts SendMessage `to: unknown & unknown` (line 15775): any value can arrive.
  if (typeof to !== 'string') return undefined

  return Object.values(agents).find(agent => agent.id === to) ?? Object.values(agents).find(agent => agent.label === to)
}

const same = (a: { x: number; y: number }, b: { x: number; y: number }): boolean => a.x === b.x && a.y === b.y

// A new bubble replaces the agent's existing one.
const withBubble = (bubbles: Bubble[], bubble: Bubble): Bubble[] => [
  ...bubbles.filter(b => b.agentId !== bubble.agentId),
  bubble,
]

/** Drops bubbles with `until <= now`; returns the same reference when none expired. */
export const expireBubbles = (bubbles: Bubble[], now: number): Bubble[] => {
  const live = bubbles.filter(b => b.until > now)

  return live.length === bubbles.length ? bubbles : live
}

// Walks `id` back to the tile it left (`returnAt`) unless another agent holds it
// (position or path end) or no path leads there; then to the first free anchor of
// its return room.
const goBack = (motion: Motion, map: OfficeMap, id: string, script: MeetScript): Motion => {
  const entry = motion[id]
  if (entry === undefined) return motion
  const held = Object.entries(motion).some(([other, at]) => other !== id && same(targetOf(at), script.returnAt))
  // Only a desk of the return room counts: a tool call mid-meeting can change that room.
  const deskOfRoom = map.rooms.find(r => r.id === script.returnRoom)?.anchors.some(a => same(a, script.returnAt)) ?? false
  if (!held && deskOfRoom) {
    const path = findPath(map, entry, script.returnAt)
    if (path.length > 0) return { ...motion, [id]: { ...entry, path } }
    if (same(entry, script.returnAt)) return entry.path.length === 0 ? motion : { ...motion, [id]: { ...entry, path: [] } }
  }

  return assignTarget(motion, map, id, script.returnRoom)
}

const onAnchor = (map: OfficeMap, room: RoomId, at: Point): boolean =>
  map.rooms.find(r => r.id === room)?.anchors.some(a => a.x === at.x && a.y === at.y) ?? false

/**
 * Starts a meeting from `from` to the agent `to` names. Both get a `meet` script and
 * a path to a Conference Room anchor. With no usable peer (non-string, unknown, self),
 * a speaker or peer that is done, leaving or already in a meeting, no map, or a
 * missing motion entry, nobody walks and `from` only gets the 4000 ms bubble.
 */
export const startMeet = (state: ChoreoState, from: string, to: unknown, text: string, now: number): ChoreoState => {
  const speaker = byId(state.agents, from)
  if (speaker === undefined) return state
  const shown = bubbleText(text)
  const peer = findPeer(state.agents, to)
  const { map } = state
  const free = (agent: OfficeAgent): boolean => agent.script === undefined && !isGone(agent)
  if (
    peer === undefined ||
    peer.id === speaker.id ||
    !free(speaker) ||
    !free(peer) ||
    map === undefined ||
    state.motion[speaker.id] === undefined ||
    state.motion[peer.id] === undefined
  ) {
    return { ...state, bubbles: withBubble(state.bubbles, { agentId: speaker.id, text: shown, until: now + BUBBLE_MS }) }
  }

  const motion = assignTarget(assignTarget(state.motion, map, speaker.id, 'conference'), map, peer.id, 'conference')
  // Where each agent was heading when the meeting started (its desk), read before the walk is assigned.
  const origin = (agent: OfficeAgent): Point => {
    const { x, y } = targetOf(state.motion[agent.id] ?? { x: 0, y: 0, path: [], frame: 0 })

    return { x, y }
  }
  const script = (agent: OfficeAgent, withText: boolean): MeetScript => ({
    kind: 'meet',
    peer: agent.id === speaker.id ? peer.id : speaker.id,
    phase: 'going',
    returnRoom: agent.room,
    returnPose: agent.pose,
    returnAt: origin(agent),
    ...(withText ? { text: shown } : {}),
  })

  return {
    ...state,
    motion,
    agents: {
      ...state.agents,
      [speaker.id]: { ...speaker, room: 'conference', script: script(speaker, true) },
      [peer.id]: { ...peer, room: 'conference', script: script(peer, false) },
    },
  }
}

/**
 * Moves every script one step along. Called each tick, after the agents have
 * stepped: drops expired bubbles; when both reach their Conference Room anchors the
 * speaker's bubble shows for BUBBLE_MS; when it expires both walk back to the tile they
 * left (their `returnAt`, else the first free anchor of `returnRoom`) with their pose restored; the script is cleared once back. A script
 * whose peer vanished, finished or cannot reach the room is released. Returns the
 * same reference when nothing changes.
 */
export const advanceScripts = (state: ChoreoState, now: number): ChoreoState => {
  let bubbles = expireBubbles(state.bubbles, now)
  const { map } = state
  let motion = state.motion
  let agents = state.agents
  let touched = false
  const setAgent = (agent: OfficeAgent): void => {
    if (!touched) agents = { ...agents }
    touched = true
    agents[agent.id] = agent
  }
  const clearScript = (agent: OfficeAgent): OfficeAgent => {
    const next = { ...agent }
    delete next.script

    return next
  }
  // Ends a script early: back to the return room unless the agent is finished.
  const release = (id: string): void => {
    const agent = agents[id]
    const script = agent?.script
    if (agent === undefined || script === undefined || script.kind !== 'meet' || map === undefined) return
    const next = clearScript(agent)
    if (!isGone(agent)) {
      next.room = script.returnRoom
      next.pose = script.returnPose
      motion = goBack(motion, map, id, script)
    }
    setAgent(next)
  }
  const send = (agent: OfficeAgent, script: MeetScript): void => {
    if (map === undefined) return
    setAgent({ ...agent, room: script.returnRoom, pose: script.returnPose, script })
    motion = goBack(motion, map, agent.id, script)
  }

  // One step of a completion walk (T09). Every phase falls back to the next without a
  // jump: an unreachable Reception shows the bubbles where the agent stands; an unreachable
  // Kitchen ends the script in place.
  const advanceReport = (agent: OfficeAgent, script: ReportScript): void => {
    if (map === undefined) return
    const at = motion[agent.id]
    if (agent.status === 'working' || agent.status === 'idle') {
      // Revived by the roster list mid-report: back to its own room, script ended.
      setAgent({ ...clearScript(agent), room: agent.home, pose: 'idle' })
      motion = assignTarget(motion, map, agent.id, agent.home)
      return
    }
    if (script.phase === 'toReception') {
      // Resuming (a report started with no pane, or a path left from before): keep a path only
      // when it ends on a Reception anchor, else retarget to Reception now.
      const headsToReception = (entry: Motion[string]): boolean => entry.path.length > 0 && onAnchor(map, 'reception', targetOf(entry))
      if (at !== undefined && headsToReception(at)) return
      if (at !== undefined && !onAnchor(map, 'reception', at)) {
        motion = assignTarget(motion, map, agent.id, 'reception')
        const routed = motion[agent.id]
        if (routed !== undefined && headsToReception(routed)) return
        // Reception unreachable: drop the stale path and show the bubbles where it stands.
        if (routed !== undefined && routed.path.length > 0) motion = { ...motion, [agent.id]: { ...routed, path: [] } }
      } else if (at !== undefined && at.path.length > 0) {
        motion = { ...motion, [agent.id]: { ...at, path: [] } }
      }
      const until = now + BUBBLE_MS
      setAgent({ ...agent, pose: 'talk', script: { kind: 'report', phase: 'reporting', stopped: script.stopped, until } })
      bubbles = withBubble(bubbles, { agentId: agent.id, text: script.stopped ? 'stopped' : 'done', until })
      const parent = agent.parentId ?? 'main'
      if (agents[parent] !== undefined && parent !== agent.id) {
        bubbles = withBubble(bubbles, { agentId: parent, text: 'got it', until })
      }
      return
    }
    if (script.phase === 'reporting') {
      if (script.until !== undefined && now < script.until) return
      setAgent({
        ...agent,
        status: 'leaving',
        room: 'kitchen',
        pose: 'idle',
        script: { kind: 'report', phase: 'toKitchen', stopped: script.stopped },
      })
      motion = assignTarget(motion, map, agent.id, 'kitchen')
      return
    }
    // toKitchen: arrived (or no path to follow) ends the script; expire takes it from there.
    if (at === undefined || at.path.length === 0) setAgent(clearScript(agent))
  }

  for (const id of Object.keys(state.agents)) {
    const agent = agents[id]
    const script = agent?.script
    if (agent === undefined || script === undefined || map === undefined) continue

    if (script.kind === 'report') {
      advanceReport(agent, script)
      continue
    }

    if (script.phase === 'returning') {
      const at = motion[id]
      if (at === undefined || at.path.length === 0) setAgent(clearScript(agent))
      continue
    }

    const peer = byId(agents, script.peer)
    const pairBroken =
      peer === undefined ||
      peer.script === undefined ||
      peer.script.kind !== 'meet' ||
      peer.script.peer !== id ||
      peer.script.phase === 'returning' ||
      isGone(agent) ||
      isGone(peer)
    if (pairBroken) {
      release(id)
      release(script.peer)
      continue
    }
    // The lower id leads each pair, so a pair advances once per pass.
    if (id > peer.id) continue
    const mine = motion[id]
    const theirs = motion[peer.id]

    if (script.phase === 'going') {
      if (mine === undefined || theirs === undefined) {
        release(id)
        release(peer.id)
        continue
      }
      if (mine.path.length > 0 || theirs.path.length > 0) continue
      if (!onAnchor(map, 'conference', mine) || !onAnchor(map, 'conference', theirs)) {
        release(id)
        release(peer.id)
        continue
      }
      const until = now + BUBBLE_MS
      for (const member of [agent, peer]) {
        const base = member.script
        if (base === undefined || base.kind !== 'meet') continue
        const speaking = base.text !== undefined
        setAgent({
          ...member,
          pose: speaking ? 'talk' : 'idle',
          script: {
            kind: 'meet',
            peer: base.peer,
            phase: 'talking',
            returnRoom: base.returnRoom,
            returnPose: base.returnPose,
            returnAt: base.returnAt,
            until,
          },
        })
        if (base.text !== undefined) bubbles = withBubble(bubbles, { agentId: member.id, text: base.text, until })
      }
      continue
    }

    // talking
    if (script.until !== undefined && now < script.until) continue
    for (const member of [agent, peer]) {
      const base = member.script
      if (base === undefined || base.kind !== 'meet') continue
      send(member, {
        kind: 'meet',
        peer: base.peer,
        phase: 'returning',
        returnRoom: base.returnRoom,
        returnPose: base.returnPose,
        returnAt: base.returnAt,
      })
    }
  }

  if (!touched && motion === state.motion && bubbles === state.bubbles) return state

  return { map, agents, motion, bubbles }
}

/**
 * Starts the completion walk for the agent whose turn ended (T09): it is marked done,
 * walks to Reception, shows "done" (or "stopped" when `reason` is not 'answer') while its
 * parent (or main) shows "got it" for BUBBLE_MS, then walks to the Kitchen as
 * `leaving`. A meeting it was in is released first, so the peer returns normally.
 * A teammate only turns idle (D26); main, an unknown agent or one already finished
 * changes nothing. With no map or motion entry the agent is only marked done.
 */
export const startReport = (state: ChoreoState, agentId: string, now: number, reason: string): ChoreoState => {
  if (agentId === 'main') return state
  const completed = onComplete(state.agents, agentId, now)
  const agent = completed[agentId]
  if (completed === state.agents || agent === undefined) return state
  if (agent.teammate) return { ...state, agents: completed }

  // Dropping the meet script makes advanceScripts release the peer like any broken pair.
  const bare = { ...agent }
  delete bare.script
  const released =
    agent.script?.kind === 'meet' ? advanceScripts({ ...state, agents: { ...completed, [agentId]: bare } }, now) : { ...state, agents: { ...completed, [agentId]: bare } }
  const { map } = released
  const walking: OfficeAgent = {
    ...bare,
    room: 'reception',
    pose: 'idle',
    script: { kind: 'report', phase: 'toReception', stopped: reason !== 'answer' },
  }
  const agents = { ...released.agents, [agentId]: walking }
  if (map === undefined || released.motion[agentId] === undefined) return { ...released, agents }

  const routed = assignTarget(released.motion, map, agentId, 'reception')
  const entry = routed[agentId]
  // No path to Reception: a path left toward another room is dropped, never walked.
  if (entry !== undefined && entry.path.length > 0 && !onAnchor(map, 'reception', targetOf(entry))) {
    return { ...released, agents, motion: { ...routed, [agentId]: { ...entry, path: [] } } }
  }

  return { ...released, agents, motion: routed }
}

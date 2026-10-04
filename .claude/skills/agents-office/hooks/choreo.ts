// Pure messaging choreography (D38): a SendMessage walks both agents to the Meeting
// Room, shows the speaker's bubble, then sends both back. No `$`; register.tsx reads
// the atoms, passes plain data in and writes the changed atoms back.
import type { OfficeAgent, Roster, Script } from './agents'
import type { Bubble, Motion } from './frame'
import type { OfficeMap, RoomId } from './map'
import { assignTarget } from './motion'
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

// `to` is `unknown & unknown` in the SendMessage tool input (d.ts 15775), so it is
// narrowed here: only a string can name an agent, by id first, then by label (the
// spawn `name` when one was given).
const findPeer = (agents: Roster, to: unknown): OfficeAgent | undefined => {
  if (typeof to !== 'string') return undefined

  return Object.values(agents).find(agent => agent.id === to) ?? Object.values(agents).find(agent => agent.label === to)
}

const onAnchor = (map: OfficeMap, room: RoomId, at: Motion[string]): boolean =>
  map.rooms.find(r => r.id === room)?.anchors.some(a => a.x === at.x && a.y === at.y) ?? false

/**
 * Starts a meeting from `from` to the agent `to` names. Both get a `meet` script and
 * a path to a Meeting Room anchor. With no usable peer (non-string, unknown, self),
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
    return { ...state, bubbles: [...state.bubbles, { agentId: speaker.id, text: shown, until: now + BUBBLE_MS }] }
  }

  const motion = assignTarget(assignTarget(state.motion, map, speaker.id, 'meeting'), map, peer.id, 'meeting')
  const script = (agent: OfficeAgent, withText: boolean): Script => ({
    kind: 'meet',
    peer: agent.id === speaker.id ? peer.id : speaker.id,
    phase: 'going',
    returnRoom: agent.room,
    returnPose: agent.pose,
    ...(withText ? { text: shown } : {}),
  })

  return {
    ...state,
    motion,
    agents: {
      ...state.agents,
      [speaker.id]: { ...speaker, room: 'meeting', script: script(speaker, true) },
      [peer.id]: { ...peer, room: 'meeting', script: script(peer, false) },
    },
  }
}

/**
 * Moves every script one step along. Called each tick, after the agents have
 * stepped: drops expired bubbles; when both reach their Meeting Room anchors the
 * speaker's bubble shows for BUBBLE_MS; when it expires both walk back to their
 * `returnRoom` with their pose restored; the script is cleared once back. A script
 * whose peer vanished, finished or cannot reach the room is released. Returns the
 * same reference when nothing changes.
 */
export const advanceScripts = (state: ChoreoState, now: number): ChoreoState => {
  const live = state.bubbles.filter(b => b.until > now)
  let bubbles = live.length === state.bubbles.length ? state.bubbles : live
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
    if (agent === undefined || script === undefined || map === undefined) return
    const next = clearScript(agent)
    if (!isGone(agent)) {
      next.room = script.returnRoom
      next.pose = script.returnPose
      motion = assignTarget(motion, map, id, script.returnRoom)
    }
    setAgent(next)
  }
  const send = (agent: OfficeAgent, script: Script): void => {
    if (map === undefined) return
    setAgent({ ...agent, room: script.returnRoom, pose: script.returnPose, script })
    motion = assignTarget(motion, map, agent.id, script.returnRoom)
  }

  for (const id of Object.keys(state.agents)) {
    const agent = agents[id]
    const script = agent?.script
    if (agent === undefined || script === undefined || map === undefined) continue

    if (script.phase === 'returning') {
      const at = motion[id]
      if (at === undefined || at.path.length === 0) setAgent(clearScript(agent))
      continue
    }

    const peer = byId(agents, script.peer)
    const pairBroken =
      peer === undefined ||
      peer.script === undefined ||
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
      if (!onAnchor(map, 'meeting', mine) || !onAnchor(map, 'meeting', theirs)) {
        release(id)
        release(peer.id)
        continue
      }
      const until = now + BUBBLE_MS
      for (const member of [agent, peer]) {
        const speaking = member.script?.text !== undefined
        const base = member.script
        if (base === undefined) continue
        setAgent({
          ...member,
          pose: speaking ? 'talk' : 'idle',
          script: {
            kind: 'meet',
            peer: base.peer,
            phase: 'talking',
            returnRoom: base.returnRoom,
            returnPose: base.returnPose,
            until,
          },
        })
        if (base.text !== undefined) bubbles = [...bubbles, { agentId: member.id, text: base.text, until }]
      }
      continue
    }

    // talking
    if (script.until !== undefined && now < script.until) continue
    for (const member of [agent, peer]) {
      const base = member.script
      if (base === undefined) continue
      send(member, {
        kind: 'meet',
        peer: base.peer,
        phase: 'returning',
        returnRoom: base.returnRoom,
        returnPose: base.returnPose,
      })
    }
  }

  if (!touched && motion === state.motion && bubbles === state.bubbles) return state

  return { map, agents, motion, bubbles }
}

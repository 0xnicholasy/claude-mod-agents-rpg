# Agents Office: implementation narrative

Companion to `TODO.md` (decisions are cited as D<n>). Line numbers cite `vendor/claude-code/claude-code.d.ts`. This file describes what was built; where an early assumption was corrected, the corrected form is given.

## Module layout (all under `.claude/skills/agents-office/`)

| File | Role |
| --- | --- |
| `hooks/register.tsx` | All code that touches `$`: atoms, `guard`, `tick`, `startLoop`, `seat`, `meet`, `commitChoreo`, the event hooks and the `ui.render` hook (D19). Imports runtime `atom/read/update`. |
| `hooks/loop.ts` | Pure only: `rasterSize`, `isOfficeSize`, `mapFor` (one-entry map cache). No `$`, no tick. |
| `hooks/raster.ts` | Hand-written base64, `packCells`, glyph validation. |
| `hooks/map.ts` | Seven rooms, tiles, doors, anchors, `canStand`, `roomAt`, scaling from 60x18. |
| `hooks/sprites.ts` | 3x2 sprites per pose and frame, `TIER_COLORS`, nameplate row. |
| `hooks/frame.ts` | `buildFrame` to `Cell[][]`, `placeMotion` seating. |
| `hooks/path.ts` | BFS over `canStand` footprints (`findPath`). |
| `hooks/motion.ts` | `assignTarget`, `enterAtDoor`, one-tile-per-tick `step`. |
| `hooks/activity.ts` | `activityFor(tool)`: tool name to room (or `desk`) and pose. |
| `hooks/agents.ts` | Roster reducer: spawn, complete, `syncList`, `expire`, tier from model. |
| `hooks/choreo.ts` | Pure `ChoreoState` transitions: `startMeet`, `startReport`, `advanceScripts`, `bubbleText`. |
| `hooks/log.ts` | `pushLog` (newest 5 lines) and the line formatters. |
| `hooks/timing.ts` | `TICK_MS` 100, `BUBBLE_MS` 4000, `DESPAWN_MS` 5000, `LIST_MS` 10000, `STRIP_ROWS` 5. |
| `types/index.d.ts` | Exported types and the inline `PluginState['agents-office']` atoms. |

Pure modules take plain data and `now: number` and never touch `$`. `claude plugin validate` refuses a `$` passed to a function imported from another file, so every function that receives `$` is declared in `register.tsx` (D19). Time-based behavior is therefore tested directly (pass `now`) and through the mounted pane (`mock.clock`).

## Event flow

- `session.start`: register `/office`; seed `main`; `$.agent.list()` into `syncList`; `$.clock.every(LIST_MS)` refresh; `startLoop`. It fires again on every reload with old timers dropped, and `startLoop` cancels the previous handle (D25), so a reload does not double the loop.
- `agent.spawn`: `await next(e)`; when the result has `agentId`, add the agent (tier from the input alias, else the result model id, else grey, D4) and walk it in from the Lobby door; return the result unchanged. A `tool.call` with `tool === 'Agent'` is not used to spawn (D2): it only sends the parent to the Lobby in `talk` pose.
- `tool.call`: key `e.agentId ?? 'main'`; `activityFor(e.tool)` sets target room and pose before the tool runs; `SendMessage` goes to `meet()` instead (D40), which narrows `to` with `typeof to === 'string'`, matches the peer by id then label, and starts the meeting script; the hook always returns `next(e)`.
- `turn.complete` with `e.agentId`: `startReport` (D41-D42). Only a non-teammate, non-main agent in the roster gets the report script: walk to the Lobby, bubble "done" (or "stopped" when `reason !== 'answer'`), parent or main bubbles "got it", walk to the Break Room. A teammate only becomes idle.
- `ui.render` (`requestId: 'office'`): branch on `e.surface` first (Raster is terminal-only, 3721). Off terminal: the `Text` "Office needs the terminal surface." Terminal below 60x18 Raster size (body under 60x23): "Widen the pane for the office". Otherwise a `Raster` plus exactly `STRIP_ROWS` dim `Text` log lines (D47-D48). Render cannot write state (D20), so the viewport write is a `$.clock.after(0, ...)` closure.

## Frame loop

Each `TICK_MS` the `tick` in `register.tsx` reads the clock and atoms, then: `expire` (a done agent leaves only after `DESPAWN_MS` and standing in the Break Room, D43); `seat` (`placeMotion` plus `step`, collecting arrivals for log lines); `advanceScripts` through `commitChoreo`; `buildFrame`; `packCells`; compare with the module-level `lastFrameCells`; blit only on change (D32). A blit `deny` resets the cache; a "mounted" deny with an unchanged viewport zeroes the viewport. `lastFrameCells`, `loggedBlitDenies`, `loggedFailures` and the `mapFor` cache are the only module state, all caches and none drawn, so a reload costs one extra blit and no agents.

Failure isolation (D49): every hook body runs in `guard`, which logs `agents-office: <name> threw <error>` once per distinct name and message and returns a fallback.

## Settled API facts (corrections to the early assumptions)

- D2 holds: spawn is tracked in `agent.spawn` only, result `{ model, agentId?, teammateId? }`.
- D3 holds: subagent completion is `turn.complete` carrying `agentId`.
- D9 corrected: the typed `$.tool.call` rejects `agentId` (ToolCallReserved), but a cast (`as never`) delivers it to the plugin's `tool.call` hook at runtime (observed in one scratch run, T01B). Subagent-scoped activity is tested with that one cast.
- D19: `$` code lives in `register.tsx`; `loop.ts` is pure. This overrides the early plan that put `startLoop` and `tick` in `loop.ts`.
- D20: a `ui.render` hook cannot write state; writes go through a `$.clock.after(0, ...)` closure, so the first blit follows the first render by one timer turn.
- D22: tests observe state by spying `on('state.set', ...)`; the test engine has no `state` noun, so atoms cannot be read directly.
- D8: blits are observed with a bottom `on('ui.blit', ...)` hook while a pane is mounted; `mock.clock(on).advance(ms)` drives `$.clock.every`, `Mounted.advance` does not.

## Testing approach

- Pure modules: one focused unit test per stated behavior with explicit `now`.
- Mounted tests in `hooks/office.test.ts`: `mock.clock`, bottom hooks for `agent.spawn`, `agent.list`, `tool.call`, `ui.blit`; drive with `clock.advance(100)`.
- Raster cells are not inspectable through `drawn()`; assertions decode blit args or check the `Cell[][]` grid before packing.

## Not verified

- Frame rate, flicker (D14: the render hook reads `motion`, so each write also triggers the engine's throttled redraw), sprite legibility in a real font, and bubble placement have not been seen in a real pane.
- D9's runtime `agentId` delivery was observed in a test, not in a live session.

# Agents Office: live RPG pane of the session's agents

ultraplan: agents-office | branch: feat/agents-office | base: main | tag: pre-agents-office-main | created: 2026-10-04
Status: ACTIVE
Progress: 2/16 done

## Goal
A Claude Code mod at `.claude/skills/agents-office/` that opens a pane (`/office`, id `office`, title `Office`) drawing every running agent of this session (main, Agent-tool subagents, teammates) as a 3x2-cell pixel character in a tiled office with named rooms, rendered into one terminal `Raster` and animated at 10 fps with `$.clock.every` + `$.ui.blit`. Tool calls drive room and pose, spawns walk in, SendMessage meets in the Meeting Room, turn.complete reports in the Lobby and leaves. Every drawn value lives in `$.state` so a hot reload keeps the office populated.

## Constraints
- Base `main`; one landing PR at the end (merge commit, owner merges). No enabling PR: CI already filters `main` and `feat/**`. (owner)
- Local run target; public repo github.com/0xnicholasy/claude-mod-agents-rpg; Claude Code 2.1.289; API authority is `vendor/claude-code/claude-code.d.ts` (never edited). (owner)
- Visuals: raster pixel art only. One `Raster` per office frame, `$.clock.every` + `$.ui.blit` at 8 to 10 fps. Speech bubbles and nameplates are `Text` overlays (absolute Box) or cells inside the Raster. No PNG sprites, no `Image`, no kitty graphics. (owner)
- Terminal surface only; every other surface draws one `Text`: "Office needs the terminal surface." (owner)
- npm; TypeScript strict; tests are `*.test.ts` run by `claude plugin test`; gate is `npm run check` (validate + typecheck + test); CI runs typecheck only. (owner)
- Out of scope v1: sound, non-terminal rendering beyond the fallback line, persistence across sessions, themes, marketplace. (owner)
- Office map: fixed tile grid rendered into one `Raster` sized `e.props.bodyColumns` x (`e.props.scroll.bodyRows` minus the log strip); minimum 60x18, below that draw `Text` "Widen the pane for the office". Rooms with signs: Lobby, Dev Bay, Library, Server Room, Phone Booth, Meeting Room, Break Room. (owner design)
- Characters: 3 cells wide x 2 rows tall from block and box-drawing glyphs with per-cell colors; 2-frame walk cycle, 2-frame work cycle per activity, 1 idle frame; color by model tier (haiku, sonnet, opus, fable), fallback grey; nameplate = agent type or first 12 chars of description. (owner design)
- Movement: BFS path on the tile grid between room anchors through doors, one tile per tick; never teleport. (owner design)
- State: every value the drawing reads is a `$.state` atom declared inline in `types/index.d.ts` under `'agents-office'`. Module variables hold nothing the pane draws. One frame loop `$.clock.every(100, ...)` started in `session.start`; blit only when something changed. Despawn 5 s, bubble 4 s, list refresh 10 s; all testable with `mock.clock`. (owner design)
- Bottom strip: last 5 interactions as `Text` lines. (owner design)
- Every `on(...)` body runs inside the skeleton's `guard`; failures log via `$.ui.log(..., { to: 'debug' })`; `tool.call` hooks always call and return `next(e)`. (owner design)
- Raster cells: padded base64 of little-endian u32 triplets `[codePoint, fg, bg]`, width-1 printable BMP glyphs, `0x00RRGGBB` or `0x01000000`. No DOM, no Node: the base64 encoder is hand-written and unit-tested (no `Buffer`, no `btoa`). (owner design)
- Pure logic (map, pathfinding, sprites, cell packing, activity mapping, choreography) in separate `hooks/*.ts` modules with directly tested pure functions; `register.tsx` only wires events. (owner design)
- Project rules: no emoji in code; no `any`/`unknown` without a justifying comment (`SendMessage.to` is typed `unknown & unknown` at d.ts 15775-15784, so it is narrowed at runtime with a comment); never silence a TS error with `// eslint-disable`; state in `$.state` atoms, never module variables.
- /implement extra rule (added to CLAUDE.md in the seed PR, not by a todo): after a todo's squash-merge, run `git -C <main checkout> pull --ff-only origin feat/agents-office` so the watched mod folder reloads; grep the newest `~/.claude/debug/*.txt` (if present) for `agents-office:` lines and treat any `refused` or `threw` line as a failing check.
- `claude plugin validate` rejects a bare `export {}` in `types/index.d.ts` and `PluginState` entries that point at an alias: every atom is declared inline under `'agents-office'`.

## Decisions
Line numbers cite `vendor/claude-code/claude-code.d.ts` (the vendored copy; the original types file is 2 lines lower).
- D1 No unasked pane open. `session.start` input is `{ cwd, surface, isInteractive }` (11126+) with no fullscreen flag; fullscreen is only on `command.run` `presentation` and on `ui.render` `e.viewport?.isFullscreen`; an unasked `$.ui.open` waits undrawn below 144 columns anyway (7056). The pane opens on `/office` only. (orchestrator, 2026-10-04) | assumed: the owner asked for an unasked open when fullscreen, which the API cannot detect at session.start
- D2 Spawn tracking uses the `agent.spawn` hook alone: it "fires when the Agent tool is about to start a subagent" (3968-3976) and `next(e)` resolves to `{ model, agentId?, teammateId? }` (371-392); the input carries `description`, `subagentType`, `model?` (alias as given), `parentModel`, `parentAgentId?`, `isTeammate?`, `name?` (265-358). The hook awaits `next(e)`, registers the agent when `agentId` is set, and returns the result unchanged. `tool.call` with `e.tool === 'Agent'` is NOT used to spawn: its `next(e)` resolves only when the agent settles (`BuiltinToolResults.Agent.agentId`, 15944-15945) and would block the hook for the agent's lifetime; it is treated as a plain activity of the parent (Lobby, talking pose). (assumed, confirm by T01)
- D3 Subagent completion is `turn.complete` with `e.agentId` (TurnCompleteFields; AgentSpawnResult doc 364-369: the subagent's answer "is its own `turn.complete`, carrying this `agentId`"). `turn.start` has no `agentId` and is unused. (assumed, confirm by T02)
- D4 Model tier = first of `haiku|sonnet|opus|fable` found in the spawn input `model` alias, else in the resolved result `model` id, else grey. Teammates seeded from `$.agent.list()` without a spawn event stay grey (AgentInfo has no model, 127-188). (assumed)
- D5 `$.agent.list(): Promise<AgentInfo[]>` (3087); items `{ id, teammateId?, description, type, status, parentId?, spawnedBy?, name? }` (127-188); `AgentStatus = 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'` (504). Seeded on `session.start` and refreshed by `$.clock.every(10000)`; `completed|failed|killed` entries not already in the roster are ignored. (owner design, cites assumed)
- D6 `Raster` exists only on `Elements['terminal']` (3721; `ClientElements` omits it, 1338); on another surface the tree is refused (9132), so the render hook branches on `e.surface` before building the tree. `RasterProps = { key, columns 1-512, rows 1-256, cells }` (8748-8775); palette paints 1024 distinct color pairs at once (8746), so the sprite palette stays under 32 colors. (settled)
- D7 Blit contract: `$.ui.blit({ requestId: 'office', key: 'office', cells })` repaints the mounted Raster (2281-2300, 8713-8738); `columns`/`rows` when given must equal the mounted size, a resize is a redraw via `$.ui.invalidate('ui.render')` (8710-8711, 2279); result `{ deny? }` (12977-12986). The render hook writes the mounted size to the `viewport` atom so the tick packs the matching size; a `deny` is logged once per distinct reason. (settled)
- D8 Observing a blit in a test: `Mounted.drawn()` is the render chain's tree (14810-14821) and the kit "exercises the mod's hooks and modules, never a surface's paint" (14802), so blit cells are not visible in `drawn()`. Tests observe blits with a test-side bottom hook written exactly `on('ui.blit', e => { seen.push(e); return { value: {} } })` (`ui.blit` is a hooked event: args 6728, result 6939; the test's `on` is the chain's bottom, 14176-14178 and 14722-14723). `Mounted.advance(ms)` moves only `Client` `surface.every` timers (14912-14919); the office loop is driven by `mock.clock(on).advance(ms)` (14700, 14731-14775), which resolves `$.clock.every` waits in due order (14740-14749). (assumed, confirm by T01)
- D9 Tests fire engine events as `$.<noun>.<event>(input)` (Engine 14262-14266, EngineNoun 14344-14346): `$.session.start({ cwd, surface: 'terminal', isInteractive: true })`, `$.agent.spawn({...})` with a test bottom hook answering `{ model, agentId }`, `$.turn.complete({...agentId})`, `$.tool.call({...})` with a test bottom `on('tool.call', () => ({ result }))` stub so no real tool runs. Caveat: `ToolCallArgs` drops `agentId` (12080-12085), so a test probably cannot deliver a subagent-scoped `tool.call` through `$.tool.call`; subagent activity is therefore tested through the exported pure reducer, and the hook wiring through main-loop calls (no `agentId`). (assumed, confirm by T01)
- D10 Hook bodies stay one line each: `register.tsx` reads atoms, calls a pure reducer from `hooks/*.ts`, writes atoms, returns `next(e)`. Tick logic lives in `hooks/loop.ts` (`startLoop($)`, `tick($)`), not in `register.tsx`. (assumed)
- D11 State atoms under `'agents-office'`: `opened: boolean`; `viewport: { columns: number; rows: number }`; `agents: Record<string, OfficeAgent>` (id, label, tier, parentId?, status `'working' | 'idle' | 'done' | 'leaving'`, room, pose, completedAt?); `motion: Record<string, { x: number; y: number; path: Array<{ x: number; y: number }>; frame: number }>`; `bubbles: Array<{ agentId: string; text: string; until: number }>`; `log: string[]` (max 5). A module-level `lastFrameHash: string | null` is allowed because it is a cache, not a drawn value; a reload resets it and costs one extra blit. (assumed)
- D12 Timing: tick 100 ms; walk frame toggles every tick, work frame every 3 ticks; bubble 4000 ms; despawn per D15; roster refresh 10000 ms. All durations are constants in `hooks/timing.ts` so tests and code share them. (owner design for durations; constants file assumed)
- D15 Despawn: an agent leaves only once it stands in the Break Room AND at least 5000 ms have passed since its `turn.complete` (the owner's 5 s is a floor, because the report choreography itself takes longer than 5 s). T02 ships a plain 5 s removal; T09 replaces it. (assumed, codex plan review 2026-10-04)
- D16 Plan review (codex, 2026-10-04) folded in: T01 split into codec (T01) and blit/spawn spike (T01B); T06 split into pathfinding (T06) and motion wiring (T06B); `motion` atom declared in T01B and positions seeded in T05; `/office` covered by a T01B test; T08 asserts arrival back, not only return paths; agent.list refresh tested in T02 and T12; T09 sized M and owns the expiry replacement. (assumed)
- D13 Hooks that throw are skipped by the engine and reported by name (3836-3838); `guard` is kept anyway so the debug log carries `agents-office:` lines the /implement rule greps for. Fire-and-forget promises (`$.ui.blit`, `update`) inside the tick get `.catch` that logs. (owner design)
- D14 Frame-loop redraw trade-off: the render hook reads `motion` (so a redraw or reload draws correct positions), which means each tick's `motion` write also triggers the engine's throttled redraw (3870, "at the redraw rate") on top of the blit. Accepted for v1; if T01 shows visible flicker, `motion` is written every 5th tick and blits carry the frames between. (assumed, confirm by T01)
- D17 R4 settled (T01): `claude plugin test` resolves a sibling module by relative path without extension, so `hooks/*.test.ts` use `import { ... } from './raster'` next to `import { expect, test } from 'claude-code/testing'`; no other layout needed. A `packCells` result never needs base64 padding (a cell is 12 bytes), so padding is tested on the exported `base64Encode`. (settled, T01)
- D18 Environment: `claude plugin test` can refuse with 'hooks modules are turned off in this process: the rollout switch was saved off...'. Fix: one networked `claude -p "reply with the single word ok" --max-turns 1` outside the sandbox, then rerun. Run `npm run check` with the sandbox disabled. (orchestrator, 2026-10-04)

- D19 `claude plugin validate` refuses a `$` passed to a function imported from another file ("$ is followed only into a function declared in this same file, never across an import"). So `startLoop($)` and `tick($)` live in `register.tsx` (same-file functions, like `guard`); `hooks/loop.ts` holds pure pieces only (`TICK_MS`, frame builders). This overrides D10 and every later todo that says "`loop.ts` tick calls ...": reducers and frame builders stay pure in `hooks/*.ts` and take plain data; the `$` wiring (read atoms, call the pure function, write atoms, blit) is in `register.tsx`. Atoms are declared in `register.tsx` (an atom needs no `$`). (settled, T01B, validate output)
- D20 A `ui.render` hook cannot write state: `state.set` made while rendering is denied ("drawing is pure ... write from a handler ... or from another event"). The render hook writes `viewport` from a `$.clock.after(0, () => update(...))` closure, which runs in its own dispatch and is allowed. The first blit therefore follows the first render by one timer turn. (settled, T01B, observed in `claude plugin test`)
- D21 Test-stub shapes (T01B, observed): ops (`ui.blit`, `ui.open`, `state.set`, `command.register`, `ui.log`) are answered `{ value: ... }`: `on('ui.blit', ($, e) => { seen.push(e); return { value: {} } })`, `on('ui.open', ...) -> { value: { isPlaced: true } }` (UiOpenResult 13389), `on('command.register', () => ({ value: { command: 'office' } }))`, `on('ui.log', () => ({ value: undefined }))`. Events (`agent.spawn`, `session.start`) are answered with the bare result: `on('agent.spawn', () => ({ model, agentId: 'a1' }))` (AgentSpawnResult 371-401), `on('session.start', ($, e) => ({ cwd: e.cwd }))` (11147). Every hook takes `($, e, next)`, so the first parameter is `$`, not the event. `$.command.run` in a test needs the full `CommandRunInput` (`command`, `args`, `origin: { kind: 'composer' }`, `presentation: { isFullscreen, columns }`); `$.agent.spawn` needs `tool_use_id, prompt, description, subagentType, provider: { plugin: 'engine', tier: 'core' }, parentModel, background, fork`. `session.start` fails inside the plugin's `guard` (and the loop never starts) unless the test stubs `command.register`. (settled, T01B)
- D22 State is observable in tests by spying on writes: `on('state.set', ($, e, next) => { writes.push(e); return next(e) })` sees `{ plugin, key, value }` and the real write goes through (reads by the plugin work). The test `Engine` has no `state` noun, so a test cannot read an atom directly. (settled, T01B)
- D23 A close signal exists: `'ui.close': PaneCloseInput` (claude-code.d.ts 6710, `{ id, origin: { kind: 'plugin' | 'person' | 'unload' } }`, 7023-7047). A hook can observe it, but `unload` closes happen before hooks hear of it and the opener's hooks do not run. So `register.tsx` hooks `ui.close`, awaits `next(e)`, and for `id === 'office'` writes `viewport` to 0x0; the tick skips on 0x0 (also the initial default). Backup for `unload`: a `$.ui.blit` `{ deny }` whose reason mentions "mounted" (UiBlitResult 12985) resets viewport to 0x0 until the next render. (settled, T01B)
- D8 resolved (T01B): a test bottom hook `on('ui.blit', ...)` sees the plugin's blit while a pane is mounted via `$.ui.mount` and `mock.clock(on).advance(100)` drives `$.clock.every`; cells length for 60x18 is 4 * ceil(60*18*12/3). Proven by making the tick skip the blit: both blit tests fail. Blit does not require the Raster to be in `drawn()`. (settled)
- D9 resolved (T01B): the typed `$.tool.call({ tool, ..., agentId })` is a compile error (ToolCallReserved 12124-12128 has only `tool`, `tool_use_id`, `consent`), but with a cast (`as never`) the runtime delivers `agentId` unchanged to the plugin's `tool.call` hook (scratch test: the plugin hook logged `agentId=a1`, and `undefined` without it). Subagent-scoped `tool.call` is therefore testable with one cast plus a comment; the cast is a test-only workaround and its runtime behavior contradicts the ToolCallArgs doc (12080-12085, "dropped"), so pin it in the first test that depends on it. (observed, one run)
- D14 resolved (T01B): whether a `motion`/`tick` atom write per tick causes a visible redraw or flicker is not observable headless; check visually in a real pane after merge (`/office`, watch for flicker). The spike writes the `tick` atom every tick but the render hook does not read it, so this run does not exercise the cost. (not observable in tests)

## Todos

### T01 Raster cell codec
- status: done (#2, 2026-10-04)
- needs: none
- size: S
- scope: Hand-written base64 encoder, glyph validation (printable width-1 BMP only) and `packCells(grid: Cell[][])` in `hooks/raster.ts`, plus the `Cell` type. Settles R4: the test imports a sibling `hooks/*.ts` module; if `claude plugin test` cannot, record the working layout in `## Decisions` and use it from here on.
- files: `.claude/skills/agents-office/hooks/raster.ts`, `hooks/raster.test.ts`, `types/index.d.ts` (export `Cell` only if needed)
- done when: `raster.test.ts` "raster packs the documented orange cell" passes (input `[0x2588, 0xff8800, 0x01000000]` encodes to `iCUAAACI/wAAAAAB`; the implementer re-derives the vector with a scratch Node `Buffer` one-liner before locking it), "base64 encoder pads one- and two-byte tails", "raster packs cells as little-endian words in row order", "raster refuses a width-2 or non-BMP glyph" and "raster refuses invalid colors and ragged grids" pass.
- verify: `npm run check` (plus test "raster packs the documented orange cell" pass)

### T01B Spike: blit loop in a mounted pane, /office, and agent.spawn shape
- status: done (#3, 2026-10-04)
- needs: T01
- size: M
- scope: Declare atoms `viewport`, `agents` and `motion` (empty defaults) in `types/index.d.ts`. In `register.tsx`: terminal render returns a `Raster` key `office` sized from props (filled with one color) and writes the `viewport` atom; `session.start` starts `startLoop($)` from `hooks/loop.ts` whose tick bumps a counter and blits a frame that differs each tick. `agent.spawn` hook awaits `next(e)` and writes `{ id: agentId }` into `agents`, returning the result unchanged. Keep the skeleton's `/office` command. Record in `## Log`: whether a test's bottom `on('ui.blit')` sees the plugin's blit when the pane is mounted (D8), whether `$.tool.call` can carry `agentId` to the plugin hook (D9), whether redraw-per-tick flickers (D14). If the blit is not observable, switch the assertions to the frame grid and record the fallback as a Decision.
- files: `hooks/loop.ts`, `hooks/register.tsx`, `hooks/office.test.ts`, `types/index.d.ts`
- done when: `office.test.ts` passes "office blits a new frame after one 100 ms tick" (`const clock = mock.clock(on)`, `$.session.start`, mount, `clock.advance(100)`, test bottom hook exactly `on('ui.blit', e => { seen.push(e); return { value: {} } })` saw one call with `requestId 'office'`, `key 'office'`, cells length = 4 * ceil(60*18*12/3)), "two ticks blit two different frames", "agent.spawn result delivers agentId to the roster" (test bottom `on('agent.spawn', () => ({ value: { model: 'claude-sonnet-5-5', agentId: 'a1' } }))` or the shape the types require; the `agents` atom then holds `a1`), and "/office opens the office pane" (`$.command.run` for `office` with a bottom `on('ui.open')` stub records `{ id: 'office', title: 'Office' }`).
- verify: `npm run check` (plus test "office blits a new frame after one 100 ms tick" pass)

### T02 Agent roster reducer and lifecycle hooks
- status: todo
- needs: T01B
- size: M
- scope: `hooks/agents.ts` pure reducer over `Record<string, OfficeAgent>`: `seedMain`, `onSpawn(input, result)` (label from `name` / `subagentType` / first 12 chars of `description`, tier per D4, parentId), `onComplete(agentId, now)` (status `done`, `completedAt`), `syncList(infos)` (adds unknown running/idle/waiting agents as grey, never removes), `expire(now)` (drops `done` agents older than 5000 ms). `register.tsx`: `session.start` seeds `main`, calls `$.agent.list()`, starts `$.clock.every(10000)` refresh; `agent.spawn` and `turn.complete` hooks call the reducer. Despawn here is a plain removal; T09 replaces it with the walk-out choreography.
- files: `hooks/agents.ts`, `hooks/agents.test.ts`, `hooks/timing.ts`, `hooks/register.tsx`, `hooks/office.test.ts`, `types/index.d.ts`
- done when: `agents.test.ts` "spawn labels an agent by name, then type, then description", "tier comes from the alias, then the resolved model, else grey", "syncList adds a teammate and never removes a known agent", "expire drops a done agent only after 5000 ms" pass; `office.test.ts` "a spawned agent leaves the roster 5 s after its turn completes" passes (`$.agent.spawn` with bottom hook, `$.turn.complete({ agentId: 'a1', ... })`, `clock.advance(4900)` still present, `advance(200)` gone; T09 replaces this test when the walk-out choreography lands), "session.start seeds main and the listed teammates" (bottom `on('agent.list')` returns one idle teammate) and "the roster refreshes from agent.list every 10 s" (bottom `on('agent.list')` counts calls: 1 after session.start, 2 after `clock.advance(10000)`, and a teammate added to the stub between them appears).
- verify: `npm run check` (plus test "a spawned agent leaves the roster 5 s after its turn completes" pass)

### T03 Tile map and room layout as data
- status: todo
- needs: T01B
- size: S
- scope: `hooks/map.ts`: `Room` ids, `buildMap(columns, rows)` returning tiles (`floor | wall | door | sign`), per-room bounds, sign position, door tile, ordered anchor list (desks) and `roomAt(tile)`; scales the fixed 60x18 layout to larger sizes by stretching room widths, keeping walls one cell and every room reachable through a door; throws `OfficeTooSmall` below 60x18.
- files: `hooks/map.ts`, `hooks/map.test.ts`
- done when: `map.test.ts` "every room has a sign inside its bounds and at least two floor anchors" (Dev Bay at least 6), "rooms never overlap and every door touches a corridor floor tile", "map scales to 120x36 keeping seven rooms and one-cell walls", "buildMap throws OfficeTooSmall at 59x18" pass.
- verify: `npm run check` (plus test "rooms never overlap and every door touches a corridor floor tile" pass)

### T04 Sprite sheet, poses and tier palette
- status: todo
- needs: T01
- size: S
- scope: `hooks/sprites.ts`: `Pose = 'idle' | 'walk' | 'read' | 'type' | 'run' | 'call' | 'talk'`; `sprite(pose, frame, tier)` returns a 3x2 `Cell[][]` of block/box-drawing glyphs with per-cell fg/bg; `TIER_COLORS` for haiku, sonnet, opus, fable, grey; a `nameplate(text)` row helper trimming to 12 cells.
- files: `hooks/sprites.ts`, `hooks/sprites.test.ts`
- done when: `sprites.test.ts` "every pose and frame is 3x2 of width-1 BMP glyphs the raster accepts" (runs each cell through `raster.ts` validation), "walk and work poses have two distinct frames, idle has one", "tier colors are distinct and an unknown tier maps to grey" pass.
- verify: `npm run check` (plus test "every pose and frame is 3x2 of width-1 BMP glyphs the raster accepts" pass)

### T05 Frame builder and real pane rendering
- status: todo
- needs: T02, T03, T04
- size: M
- scope: `hooks/frame.ts`: `buildFrame({ map, agents, motion, bubbles })` returns the `Cell[][]` grid: floor, walls, door gaps, room signs, each agent's sprite at its `motion` tile with the nameplate above and a bubble row when one is active (bubbles drawn as cells, so no overlay Box in v1). `register.tsx` render: terminal branch builds the Raster from atoms; `loop.ts` tick packs `buildFrame` and blits only when the frame hash changed. The T01B counter frame is removed. An agent in `agents` with no `motion` entry gets one at its room's first free anchor (the `agent.spawn` hook writes it), so every drawn agent has a position before T06 adds walking.
- files: `hooks/frame.ts`, `hooks/frame.test.ts`, `hooks/loop.ts`, `hooks/register.tsx`, `hooks/office.test.ts`
- done when: `frame.test.ts` "frame draws every room sign at its anchor", "an agent's sprite and nameplate sit at its motion tile", "a bubble is drawn above the speaker and clipped to the grid" pass; `office.test.ts` "mounted pane draws a Raster of bodyColumns by bodyRows minus the strip" (find `{ type: 'Raster', key: 'office' }`, props.columns 60) and "an unchanged office does not blit on the next tick" pass.
- verify: `npm run check` (plus test "an unchanged office does not blit on the next tick" pass)

### T06 BFS pathfinding on the tile map
- status: todo
- needs: T03
- size: S
- scope: `hooks/path.ts` BFS over floor/door tiles with 4-neighbour moves, `findPath(map, from, to)` returning the tile list (empty when unreachable). Pure; no wiring.
- files: `hooks/path.ts`, `hooks/path.test.ts`
- done when: `path.test.ts` "path from Lobby to Library crosses only floor and door tiles and every pair of consecutive tiles is adjacent", "every room is reachable from every other room on the 60x18 and 120x36 maps" and "an unreachable target returns an empty path" pass.
- verify: `npm run check` (plus test "every room is reachable from every other room on the 60x18 and 120x36 maps" pass)

### T06B One-tile-per-tick movement wired into the loop
- status: todo
- needs: T05, T06
- size: M
- scope: `hooks/motion.ts` `assignTarget(motion, map, agentId, room)` picks a free anchor and stores the path, `step(motion)` advances every agent one tile and toggles the walk frame; agents arriving switch to their work pose. `loop.ts` tick calls `step` before building the frame. New agents enter at the Lobby door and walk to their room (replaces T05's place-at-anchor).
- files: `hooks/motion.ts`, `hooks/motion.test.ts`, `hooks/loop.ts`, `hooks/register.tsx`, `hooks/office.test.ts`, `types/index.d.ts`
- done when: `motion.test.ts` "step moves each agent exactly one tile and keeps anchors unique" and "an arriving agent switches from walk to its work pose" pass; `office.test.ts` "a spawned agent is at the Lobby door, then one tile further per 100 ms tick" passes (positions read from the `motion` atom after `clock.advance(100)` twice; distance 1 each time).
- verify: `npm run check` (plus test "a spawned agent is at the Lobby door, then one tile further per 100 ms tick" pass)

### T07 Activity mapping from tool calls to room and pose
- status: todo
- needs: T06B
- size: S
- scope: `hooks/activity.ts` `activityFor(tool: string): { room, pose }`: Read/Grep/Glob/NotebookRead/Explore-type agents -> Library `read`; Edit/Write/MultiEdit/NotebookEdit -> own desk `type`; Bash/BashOutput/KillShell -> Server Room `run`; WebSearch/WebFetch and `mcp__*` tools whose name contains `fetch|http|search` -> Phone Booth `call`; Agent/TaskStop/SendMessage -> Lobby `talk`; unknown -> own desk `type`. `register.tsx` `tool.call` hook: key = `e.agentId ?? 'main'`, apply activity, then `return next(e)` (log lines arrive in T10).
- files: `hooks/activity.ts`, `hooks/activity.test.ts`, `hooks/register.tsx`, `hooks/office.test.ts`
- done when: `activity.test.ts` "every built-in tool maps to a room and pose and unknown tools go to the desk" (table-driven over the list above) passes; `office.test.ts` "a Read call on the main loop sends main toward the Library and the tool still runs" passes (test bottom `on('tool.call', () => ({ result: 'stub' }))`; `$.tool.call({ tool: 'Read', file_path: 'x' })` resolves with the stub result; `motion.main.path` ends in a Library anchor).
- verify: `npm run check` (plus test "a Read call on the main loop sends main toward the Library and the tool still runs" pass)

### T08 Messaging choreography: SendMessage meets in the Meeting Room
- status: todo
- needs: T07
- size: M
- scope: `hooks/choreo.ts` pure state machine with scripts stored on the agent (`script: { kind: 'meet', peer, phase, returnRoom }`): `startMeet(state, from, to, text, now)` (narrow `to` to string with a justifying comment, match roster by id or `name`; unknown target -> no script, just a bubble), both walk to Meeting Room anchors, on both arrived bubble over `from` with first 40 chars for 4000 ms, when the bubble expires both walk back to `returnRoom`. `advanceScripts(state, now)` is called from the tick. `register.tsx` `tool.call` for `SendMessage` calls `startMeet`.
- files: `hooks/choreo.ts`, `hooks/choreo.test.ts`, `hooks/loop.ts`, `hooks/register.tsx`, `hooks/office.test.ts`, `types/index.d.ts`
- done when: `choreo.test.ts` "SendMessage seats both agents in the Meeting Room, shows the 40-char bubble for 4000 ms, then returns both" (reducer driven with explicit `now`), "a non-string or unknown `to` leaves both agents in place" pass; `office.test.ts` "main messaging a1 meets, shows the bubble for 4 s, then both return to their anchors" passes (mock.clock: advance tick by tick until both arrived in the Meeting Room, bounded by the map's longest path length; assert bubble present; `advance(4000)` bubble gone; advance at most (longest path length) more ticks and assert both stand on their original anchors).
- verify: `npm run check` (plus test "main messaging a1 meets, shows the bubble for 4 s, then both return to their anchors" pass)

### T09 Completion choreography: report in the Lobby, leave via the Break Room
- status: todo
- needs: T08
- size: M
- scope: `choreo.ts` `startReport(state, agentId, now)`: walk to the Lobby, on arrival bubble "done" over the agent and "got it" over its parent (or main) for 4000 ms, then walk to the Break Room. Expiry policy replaced (D15): `expire` (T02) removes the agent only once it stands in the Break Room AND `now - completedAt >= DESPAWN_MS`. `turn.complete` hook now calls `startReport` instead of marking done directly. Aborted or errored turns (`e.reason !== 'answer'`) bubble "stopped" instead of "done". T02's "a spawned agent leaves the roster 5 s after its turn completes" test is deleted and replaced by the one below; T02's `expire` unit test is updated to the new rule.
- files: `hooks/choreo.ts`, `hooks/choreo.test.ts`, `hooks/agents.ts`, `hooks/agents.test.ts`, `hooks/register.tsx`, `hooks/office.test.ts`
- done when: `choreo.test.ts` "a completed agent reports in the Lobby, the parent answers got it, and the agent walks to the Break Room" and "an aborted turn reports stopped" pass; `agents.test.ts` "expire keeps a done agent until it is in the Break Room and 5000 ms have passed" passes; `office.test.ts` "a finished subagent reports, walks to the Break Room, leaves, and never teleports" passes (every consecutive `motion` sample across `clock.advance(100)` steps has distance <= 1; `a1` present until it stands in the Break Room; gone within one tick after both conditions hold).
- verify: `npm run check` (plus test "a finished subagent reports, walks to the Break Room, leaves, and never teleports" pass)

### T10 Interaction log strip
- status: todo
- needs: T09
- size: S
- scope: `hooks/log.ts` `pushLog(log, line)` keeps the last 5; formatting helpers `arrived(label, room)`, `told(from, to, text)`, `reported(label)`. Hooks push lines on arrival (from the tick when a path completes), SendMessage, and report. Render: Raster rows = `bodyRows - 5`, then five `Text` lines (dim). Below 60x18 after subtracting the strip the widen line wins.
- files: `hooks/log.ts`, `hooks/log.test.ts`, `hooks/loop.ts`, `hooks/register.tsx`, `hooks/office.test.ts`, `types/index.d.ts`
- done when: `log.test.ts` "pushLog keeps the newest five lines in order" passes; `office.test.ts` "the strip shows quick-search arrived in the Library after it reaches the room" (find `{ type: 'Text', text: /quick-search arrived in the Library/ }`) and "the strip shows main told a1: hello" pass.
- verify: `npm run check` (plus test "the strip shows quick-search arrived in the Library after it reaches the room" pass)

### T11 Fallback surfaces, minimum size and resize handling
- status: todo
- needs: T05
- size: S
- scope: Render branches: non-terminal -> one `Text` "Office needs the terminal surface."; terminal below 60x(18+5) -> `Text` "Widen the pane for the office" and no Raster; the tick skips blitting when `viewport` is below minimum or the surface is not terminal. Resize: a new `bodyColumns`/`bodyRows` writes `viewport`, the next tick packs the new size; a blit `deny` is logged once per reason and the loop keeps running. Replaces the skeleton's empty-state test.
- files: `hooks/register.tsx`, `hooks/loop.ts`, `hooks/office.test.ts`
- done when: `office.test.ts` "desktop and vscode surfaces show the terminal-only line and no Raster", "a 50x12 pane shows the widen line and ticks do not blit", "after redraw to 100x30 the Raster and the next blit are 100 by 25" (`ui.redraw({...props, bodyColumns: 100, scroll: { offset: 0, bodyRows: 30 }})`, then `clock.advance(100)`, the bottom `on('ui.blit')` saw cells for 100x25) pass.
- verify: `npm run check` (plus test "after redraw to 100x30 the Raster and the next blit are 100 by 25" pass)

### T12 Hot-reload resilience and failure isolation
- status: todo
- needs: T10, T11
- size: S
- scope: Every hook body in `guard`; every fire-and-forget promise in `loop.ts` has `.catch` logging `agents-office: <hook> threw`. `startLoop` is idempotent per environment (a second `session.start` from a reload starts one loop, since the old environment's timers are dropped, 3322-3324) and re-seeds nothing that exists. Reducers tolerate malformed inputs (missing `agentId`, non-string `to`, unknown agent in `turn.complete`). `claude plugin validate` output is clean of refusals.
- files: `hooks/register.tsx`, `hooks/loop.ts`, `hooks/agents.ts`, `hooks/choreo.ts`, `hooks/office.test.ts`
- done when: `office.test.ts` "a second session.start keeps the roster and exactly one blit happens per tick" (spawn `a1`, fire `$.session.start` again, `clock.advance(100)`, roster still has `a1`, bottom `on('ui.blit')` count +1), "a second session.start keeps exactly one 10 s agent.list refresh" (bottom `on('agent.list')` call count rises by exactly 1 per `clock.advance(10000)` after the second start; if the test kit does not drop the first environment's timers the way a reload does, both loops are guarded by a lifecycle atom/epoch and this test proves it), "a turn.complete for an unknown agent changes nothing and resolves", "a SendMessage with a numeric to still runs the tool" pass; `claude plugin validate .claude/skills/agents-office` prints no `refused`.
- verify: `npm run check` (plus test "a second session.start keeps the roster and exactly one blit happens per tick" pass)

### T13 README and docs
- status: todo
- needs: T12
- size: S
- scope: `README.md`: what the office shows, `/office`, room legend, tier colors, terminal-only note, minimum pane size, how to run `npm run check`, how hot reload behaves. `docs/agents-office/plan.md` kept current with the settled API facts (Decisions D2-D9).
- files: `README.md`, `docs/agents-office/plan.md`
- done when: README has sections "Rooms", "Tiers", "Requirements", "Develop"; `npm run check` green (docs-only change, no new test).
- verify: `npm run check`

### TZZ Cleanup and land
- status: todo
- needs: every other todo
- scope: run `/implement cleanup`
- done when: skill removed from the branch, TODO.md archived, landing PR into main open (merge commit), owner merges

## Backlog
- Tier for teammates without a spawn event from `turn.step` `e.model` + `e.agentId` (streaming hook; needs StreamNext handling).
- `Text` overlay bubbles (absolute Box) if cell bubbles clip badly on narrow panes.
- Optional unasked open from a `command.run` whose `presentation.isFullscreen` is true.
- T02 onward: move `$`-taking helpers out of any planned `hooks/*.ts` (D19); T05 `loop.ts` tick becomes a `register.tsx` function calling a pure `buildFrame`.
- Drop the `tick` atom and `spikeFrame` when T05 lands (spike values only).
- Hot reload: `startLoop` runs on every `session.start`; idempotence stays in T12.
- Walk-cycle easing (two ticks per tile at 10 fps if one tile per tick looks too fast).

## Log
2026-10-04 T01 #2 raster cell codec packs and validates cells (R4: sibling import works; plan vector corrected to iCUAAACI/wAAAAAB)
2026-10-04 T01B #3 blit loop, /office and agent.spawn roster work in tests; D8 blit observable, D9 agentId reaches tool.call hook via cast, D14 not observable headless; D19 `$` cannot cross imports, D20 render cannot write state

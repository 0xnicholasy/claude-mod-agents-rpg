# Agents Office: implementation narrative

Companion to `TODO.md`. Line numbers cite `vendor/claude-code/claude-code.d.ts` (vendored copy; original types file is 2 lines lower).

## Module layout (all under `.claude/skills/agents-office/`)

| File | Role | Imports from `claude-code` |
| --- | --- | --- |
| `hooks/register.tsx` | Wires events to reducers; one-line bodies inside `guard`; the `ui.render` hook | runtime `atom/read/update`, types |
| `hooks/loop.ts` | `startLoop($)`, `tick($)`: step motion, advance scripts, expire, build + hash + blit | runtime `read/update`, types |
| `hooks/raster.ts` | Hand-written base64, `packCells`, glyph validation | none |
| `hooks/map.ts` | Rooms, tiles, anchors, scaling | none |
| `hooks/sprites.ts` | 3x2 sprites per pose/frame/tier, nameplate row | none |
| `hooks/frame.ts` | `buildFrame` -> `Cell[][]` | none |
| `hooks/path.ts` | BFS | none |
| `hooks/motion.ts` | Target assignment, per-tick step | none |
| `hooks/activity.ts` | Tool name -> room + pose | none |
| `hooks/agents.ts` | Roster reducer (spawn, complete, syncList, expire) | types only |
| `hooks/choreo.ts` | `meet` and `report` scripts | none |
| `hooks/log.ts` | Five-line strip | none |
| `hooks/timing.ts` | TICK_MS 100, BUBBLE_MS 4000, DESPAWN_MS 5000, LIST_MS 10000 | none |
| `types/index.d.ts` | Exported types + inline `PluginState['agents-office']` | - |

Pure modules take plain data and `now: number`; they never touch `$`. That is what makes the time-based behaviour testable both directly (pass `now`) and through the mounted pane (`mock.clock`).

## Event flow

- `session.start` (4175-4185): register `/office`; seed `main`; `$.agent.list()` -> `syncList`; `$.clock.every(LIST_MS)` refresh; `startLoop`. Fires again on every reload with the old timers dropped (3322-3324), so starting the loop here is reload-safe by construction.
- `agent.spawn` (3968-3976): `const r = await next(e); if (r.agentId) update(agents, onSpawn(e, r)); return r`. Input has `description`, `subagentType`, `model?`, `parentAgentId?`, `isTeammate?`, `name?` (265-358); result `{ model, agentId?, teammateId? }` (371-392). This covers Agent-tool subagents and teammates alike.
- `tool.call` (3842-3849): key `e.agentId ?? 'main'` (198-208); `activityFor(e.tool)`; for `SendMessage` also `startMeet` after narrowing `e.to`; for `Agent` the parent goes to the Lobby in `talk` pose; always `return next(e)`. Never await anything after `next(e)` that the drawing depends on.
- `turn.complete` (4305-4312) with `e.agentId`: `startReport`; the agent walks to the Lobby, bubbles "done" (or "stopped" when `e.reason !== 'answer'`), parent bubbles "got it", walks to the Break Room, and `expire` removes it once arrived and `now - completedAt >= DESPAWN_MS`.
- `ui.render` `{ component: 'Pane', requestId: 'office' }`: branch on `e.surface` first (Raster is terminal-only, 3721, 9132); write `viewport` from `e.props.bodyColumns` x `(e.props.scroll.bodyRows - 5)`; below 60x18 draw the widen line; else `<Raster key="office" columns rows cells={pack(buildFrame(...))} />` followed by five `Text` strip lines.

## Frame loop

`tick($)` each 100 ms: `now = await $.clock.now()`; read `agents`, `motion`, `bubbles`, `viewport`; `step` motion, `advanceScripts`, `expire`; write back only the atoms whose value changed; `buildFrame` -> `packCells` -> hash; if the hash differs from the module-level `lastFrameHash`, `$.ui.blit({ requestId: 'office', key: 'office', cells })` and store the hash. A `{ deny }` (12977-12986) is logged once per distinct reason. `lastFrameHash` is the only module variable and it is not drawn (D11).

Known trade-off (D14): the render hook reads `motion`, so each `motion` write also triggers the engine's throttled redraw (3870). T01 measures whether blit + redraw flickers; if it does, write `motion` every fifth tick and let blits carry the frames between.

## Testing approach

- Pure modules: direct unit tests with explicit `now`, one focused test per stated behaviour, sized like `office.test.ts`.
- Mounted tests (`hooks/office.test.ts`): `const clock = mock.clock(on)`; bottom hooks `on('agent.spawn', () => ({ model, agentId }))`, `on('agent.list', () => ({ value: [...] }))`, `on('tool.call', () => ({ result: 'stub' }))`, `on('ui.blit', e => { seen.push(e); return { value: {} } })`; then `$.session.start(...)`, `$.ui.mount({ plugin: 'agents-office', surface: 'terminal', component: 'Pane', requestId: 'office', props })`, drive with `clock.advance(100)`.
- `Mounted.advance` is not the office clock: it moves only `Client` frame timers (14912-14919). `mock.clock.advance` resolves `$.clock.every` waits in due order (14740-14749).
- `ToolCallArgs` drops `agentId` (12080-12085). Until T01 proves otherwise, subagent-scoped activity is tested through `activity.ts` / `motion.ts` reducers, and hook wiring through main-loop `$.tool.call` calls.
- Raster cells are not inspectable through `drawn()` after a blit (14802, 14810-14821); assertions on cells decode the bottom `on('ui.blit')` args with a test-side decoder, or assert on the `Cell[][]` grid before packing.

## Risks tracked

- R1 Test-side observation of blits is inferred, not proven: whether the plugin's `$.ui.blit` against a `$.ui.mount`-ed Raster resolves `{}` (vs `deny: not mounted`) in the kit is unverified. T01 settles it; fallback is asserting on the `Cell[][]` grid and the `motion` atom instead of blit args.
- R2 `ToolCallArgs` drops `agentId` (12080-12085), so a test likely cannot drive a subagent-scoped `tool.call` through `$.tool.call`. Mitigation: thin hooks plus reducer-level tests; T01 records the actual behaviour.
- R3 Redraw-per-tick (D14): `motion` writes trigger the engine's throttled redraw in addition to the blit (3870). T01 observes, T05 applies the every-fifth-tick fallback if needed.
- R4 Importing sibling `hooks/*.ts` modules from `*.test.ts` under `claude plugin test` is assumed to work. If the runner only loads `hooks.json` modules, pure tests move to re-exports from `register.tsx` or a `tests/` folder added to `tsconfig.include`. T01's `raster.test.ts` settles it.
- R5 The base64 vector `iCUAAAII/wAAAAAB` for `[0x2588, 0xff8800, 0x01000000]` was derived by hand; T01 re-derives it with a scratch `Buffer` one-liner before locking the test.

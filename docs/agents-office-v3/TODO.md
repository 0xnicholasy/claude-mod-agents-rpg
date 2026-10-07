# Agents Office v3: an image office drawn by headless Chromium

ultraplan: agents-office-v3 | branch: feat/agents-office-v3 | base: feat/agents-office-v2 | tag: pre-agents-office-v3-feat-agents-office-v2 | created: 2026-10-07
Status: ACTIVE
Progress: 31/36 done

## Goal
Replace the terminal-cell office scene with an HTML/CSS/JS scene that headless Chromium (playwright) renders into PNG frames, shown in the pane by the terminal `Image` element through `$.ui.blit({ requestId, key, source: { file, format: 'png', generation } })`.
Everything v2 does keeps working in the image scene: team and shared rooms, other sessions through presence, the player with WASD and every pad key, emotes, chat, inspect and status.
Where the terminal cannot draw images, or node/Chromium is missing or crashes, the pane falls back to the v2 5x5 text office by itself and says why.

## Constraints
- Base `feat/agents-office-v2`. Each todo gets a branch `feat/agents-office-v3-<id>` from `origin/feat/agents-office-v3` and a PR into it. One landing PR into `feat/agents-office-v2` at the end, merged by the owner (D1).
- Claude Code 2.1.289. The API authority is `vendor/claude-code/claude-code.d.ts`, which is never edited; grep it, never read it whole (20k lines). Line numbers in this file cite it.
- The proven spike and the generated art live in `docs/agents-office-v3/spike/` (`imgspike/` plugin: `hooks/html.tsx`, `hooks/box.ts`, `renderer/render.mjs`, `renderer/office.html`, `renderer/placeholder.png`; `v3-assets/`: `sprites/` (82 PNGs + `atlas.json`), raw sheets, `slice.mjs`, `lib.mjs`). This file calls that folder `SPIKE`. It is reference material; todos copy from it, never import from it. TZZ deletes it.
- npm, TypeScript strict. No emoji in code (write symbols such as U+2665 as `♥` escapes). No `any`/`unknown` without a comment that justifies it. Never use `// eslint-disable`.
- State lives in `$.state` atoms, declared inline under `'agents-office'` in `types/index.d.ts` (validate refuses aliases). Module variables hold only timer handles, log de-dup caches and, from T12, the renderer child's stream handle (D12).
- All `$` code stays in `register.tsx`. Every other module under `hooks/` is pure, with a `*.test.ts` beside it importing from `'claude-code/testing'`. A render cannot write state; it writes through `$.clock.after(0)` (v2 D20).
- `register.tsx` (render 1111+, tick 737-836, openOffice 883-893, ui.close 1039-1048, command.run 1050-1065) and `office.test.ts` are hot spots. The todos that touch them form one chain: T12 -> T13 -> T14 -> T15 -> T16 -> T17 -> T18 -> T19.
- Every merge leaves the branch green, and `/office` keeps drawing the v2 text office by default until T13 turns on `auto` (D10).
- The renderer (`renderer/render.mjs`, `renderer/office.html`) stays outside tsc (D14). It is checked by `npm run smoke:renderer`, which runs locally only because it needs Chromium.
- Privacy: `state.json` carries only what the frame draws (the same fields as the v2 frame: labels, rooms, poses, status, bubbles, chat). It lives in a 0700 temp dir per session and is deleted when the renderer exits (D7). Nothing new is published to presence.
- Gate: `rtk proxy npm run check` (validate + typecheck + `claude plugin test`). Validate and test run locally only; CI runs typecheck. CI sets `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`.
- LIVE (v2 definition): `tmux new-session -d -s ao -x 80 -y 24 -c <worktree> claude --debug-file <scratch>/ao.log; sleep 6; tmux send-keys -t ao '/office' Enter; sleep 4; tmux capture-pane -p -e -t ao`, then the todo's keys, then `tmux kill-session -t ao`. tmux cannot draw images, so LIVE always shows the fallback path. LIVE2 adds a second session `ao2`.
- LIVEIMG: LIVE with `/office scene image` (forced, D10). Read the renderer dir from the debug line `agents-office: renderer dir <path>` in `<scratch>/ao.log`, then Read the newest `<dir>/frame-*.png` to check the scene. This checks frames on disk, not what the terminal shows.
- GHOSTTY (owner check): the owner runs `claude` in Ghostty (not inside tmux) in the todo's worktree, runs `/office`, and confirms the named items by eye.
- Implementation goes to a `sonnet` agent. README.md is updated in T21 only.

## Decisions
- D1 Land once at the end: one landing PR from feat/agents-office-v3 into feat/agents-office-v2 after all todos. (owner, 2026-10-07)
- D2 Chromium comes from the `playwright` npm dependency of the mod. The install script runs `npx playwright install chromium`. (owner, 2026-10-07)
- D3 The v2 text office stays as the automatic fallback. When Image cannot draw (tmux, Terminal.app, a surface that draws the alt), or node or Chromium is missing or crashes, the pane draws the v2 5x5 text figures. Both paths stay maintained. (owner, 2026-10-07)
- D4 The whole scene is one image, not sprites over text. The art comes from GPT /image; more sheets (floor/wall tiles, walk cycles) can be generated later. (owner, before 2026-10-07)
- D5 Bridge: the plugin writes `<dir>/state.json` with `$.fs.write` (d.ts 3143-3149), and the renderer polls it every 50 ms. Stdin JSON lines are ruled out: `ProcessSpawnRequest.input` is written once and then stdin is closed (d.ts 7771-7775). `$.fs.write` does not document atomic writes, so a renderer that cannot parse the text keeps the last scene. The file is `{ v: 1, seq, heartbeatAt, size: { w, h }, scene }`. (planner, 2026-10-07) T01: `$.fs.write` of a 20 KB JSON at 10 writes/s for 111 s (about 1100 writes, 2595 renderer reads at 20 Hz) gave 0 parse failures, so no torn read was seen. Atomicity is still undocumented, so keep the keep-last-scene guard. | confirmed T01
- D6 Renderer to plugin: stdout lines `dir <abs>`, `ready`, `frame <n> <abs>`, `error <code> <text>`, `fps <x>`. Frames ping-pong between `frame-0.png` and `frame-1.png`, each written to `.tmp` and renamed (as in the spike). The plugin blits only the newest frame of each stdout piece, with `generation: n`. Error codes: `no-playwright`, `no-chromium`, `launch`, `page`. (planner, 2026-10-07) | confirmed T08
- D7 Temp dir and watchdog. The renderer makes `mkdtemp(<os.tmpdir()>/agents-office-<sessionId>-)` (0700), prints it as `dir`, writes `pid` into it, and removes it on SIGTERM/SIGINT. At start it removes sibling `agents-office-*` dirs whose `pid` is not alive. The renderer exits on its own when `state.json`'s `heartbeatAt` is more than 10 s old or `process.ppid` changes. The plugin rewrites the heartbeat at least every 2 s. This covers paths where nobody sends SIGTERM (kill -9, crash). (planner, 2026-10-07) T01: after kill -9 of claude, node (ppid 1) and its 4 Chromium processes stayed alive for the whole 15 s watched (5 processes), so the watchdog is needed. With a 1 s `process.ppid` poll node closed Chromium within 1 s (0 processes at t+1 s). With claude frozen by SIGSTOP (ppid unchanged), the stale-heartbeat check ended it 11 s after renderer start. Test caveat: if the pane's only process dies, tmux sends SIGHUP to the whole group and hides the orphan, so run claude under `sh -c 'claude ...; sleep 120'` and kill -9 the claude pid. | watchdog confirmed T01; temp dir, pid file and sweep measured in T11 smoke (dead-pid dir swept, live-pid dir kept, own dir gone on exit, on stale-heartbeat exit and on error exit); confirmed T14 (real sessions: kill -9 left 0 renderer processes 1 s later; a dead-pid temp dir was swept at renderer start while a live-pid dir was kept; both sessions' dirs were gone after /exit)
- D8 Geometry: the image scene draws the v2 `OfficeMap` (same `buildOffice`, BFS, motion, player tiles, `viewFor`/`focusOf` camera) in world pixels, with `CELL_PX = { w: 8, h: 17 }` from the spike's box.ts. Every atom and rule stays shared by both paths. The page tweens each tile step and eases the camera. The renderer viewport is the Image box in pixels: columns x 8 by rows x 17, each axis capped at 2048. (planner, 2026-10-07) | assumed, confirm by T15
- D9 Figure looks: person variant = FNV-1a hash of the figure key (the v2 D6 key) mod 8 -> `person1`..`person8`. Tier = nameplate colour (the v2 D6 shirt colours). Status: done/leaving draws at 60% opacity, idle draws no work prop. The player is a fixed variant with the plate `you`. Facing picks the `-down/-left/-right/-up` sprite. (planner, 2026-10-07) | assumed, confirm by T06, T15
- D10 Mode switch: `$.store` key `scene` = `auto|image|text`, set by `/office scene <mode>`. `parseOfficeArgs` (presence.ts:36) gains a `scene` kind next to `share`. `text` is v2 only. `image` is forced: no probe, but the crash ladder still falls back, so LIVEIMG can make frames in tmux. `auto` probes (D11). The default is `text` until T13, then `auto`. The `scene` atom = `{ want, effective: 'probe' | 'image' | 'text', reason? }`. (planner, 2026-10-07) | assumed, confirm by T12, T13
- D11 Detection, with no terminal-name sniffing. Image-capable means the render resolved `Image` in `$.ui.resolve(e)` (terminal surface only, d.ts 1332-1338, 3700-3722) and a probe blit of `renderer/placeholder.png` as a file source is not denied. Any probe deny (the alt case, or a file this terminal cannot read, as across ssh; d.ts 2290-2293, 5159-5165, 12977-12986) switches to text, with the deny text as the reason. A deny while running does the same. Chromium is never spawned before the probe passes. (planner, 2026-10-07) | assumed, confirm by T02, T13
- D12 Lifecycle. The renderer starts when `effective` is `image` and the Office pane is drawn (viewport not 0x0). It stops on `ui.close` of the pane (the loop calls `return()`) and on module unload (d.ts 3420-3422). There is one per session: a module-scope stream handle, like the timer handles, guarded by the `renderer` atom `{ status: 'off' | 'starting' | 'running' | 'backoff' | 'failed', dir?, exits: number[], reason? }`. A crash restarts after 1 s, 2 s and 4 s. A 3rd exit within 60 s sets `failed` and text mode until `/office scene image|auto` or the next session. A reloaded module whose pane is drawn starts its own renderer once (the D73 pattern). (planner, 2026-10-07) T01 stop paths: `/reload-plugins` after an edit sends the node child SIGTERM (0 processes 3 s later, 3 of 3 reloads); calling `return()` on the stream iterator sends SIGTERM (0 processes after 3 s); `/exit` does too (0 after 3 s). `$.ui.close` alone does NOT stop the child (5 processes 3 s later), and leaving the read loop without `return()` leaves it running, so `return()` must run on close and on every loop exit (the spike's deny give-up leaked this way). Close was tested with a plugin `$.ui.close` (tmux cannot click the close mark). | stop paths confirmed T01; T14: one render.mjs after each of 2 `/reload-plugins`, 0 within 3 s of a pane close (loop `return()`), 2 sessions gave 2 renderers with 2 dirs, `/exit` left 0; crash backoff assumed, confirm by T09
- D13 Performance budget: at most 12 fps while something moves (a tween, the camera, a bubble or emote appearing or expiring). At most 1 fps for idle animation (seated typing toggle). No frame at all when the page reports no change. CPU (node + Chromium, `ps` sampled over 30 s on the owner's Mac at 120x40): under 15% of one core idle and under 40% while walking. (planner, 2026-10-07) | the 12 fps cap and the no-frame-when-unchanged rule are implemented and smoke-measured in T11 (static scene: 1 frame, 0 more in 3 s); CPU numbers still confirm by T18 | confirmed T18 (D22)
- D14 `render.mjs` and `office.html` stay outside tsc. tsconfig has `lib: es2023` and `types: []`, and adding DOM and node types would leak into the hooks. Logic that can be pure lives in TS: `scene.ts`, `sceneArt.ts`, `bridge.ts`, `rendererLife.ts`. The page is a thin drawer of the scene model. (planner, 2026-10-07) | assumed
- D15 Assets. Generated sprites and `atlas.json` go to `.claude/skills/agents-office/renderer/sprites/`. The raw sheets go to `assets/sprites/raw/` (outside the mod folder, so the user-wide link does not ship them). `slice.mjs` and `lib.mjs` go to `scripts/sprites/`. pngjs becomes a devDependency, and `npm run sprites` regenerates. (planner, 2026-10-07) | assumed, confirm by T03
- D16 `playwright` is a `dependencies` entry of the repo-root package.json. Node resolves imports from the real path of `render.mjs`, so the user-wide symlink install still finds `<checkout>/node_modules/playwright`. (planner, 2026-10-07) | assumed, confirm by T04, T20
- D17 Overlays: the inspect line, the chat draft (`Say: ..._`) and a renderer reason are drawn inside the scene as a caption bar at the view's bottom. Speech bubbles, emotes and chat bubbles are HTML bubbles above figures. Log strip rows (when the body has any) stay as Text under the Image. (planner, 2026-10-07) | caption bar and HTML bubbles confirmed T10 (the caption sits at the bottom of the camera window, not scaled with the world; tags draw above every figure); log strip and renderer reason assumed, confirm by T15
- D18 In image mode the pad Input sits like v2 (`position="absolute" bottom={0} left={0}` over the Image's bottom-left) if T02 shows it draws over an Image without breaking the picture. Otherwise it goes on its own row under the Image, which then gets bodyRows - 1. (planner, 2026-10-07) | confirmed T02 (owner, Ghostty, 2026-10-07): the pad Input drawn over the Image's bottom-left does not break the picture (the `...` pad sits at the Image's bottom-left)
- D19 Test stubs work in `claude plugin test`: `on('process.spawn', async function* () { yield { stream: 'stdout' as const, text: 'ready\n' }; return { value: { code: 0, signal: null } } })` and `on('ui.blit', (_$, e) => ({ deny: 'x' }))` (`({ value: {} })` allows). End the spawn hook with `{ value }`, because a bare `{ code, signal }` return logs "returned neither { value } nor { deny }" (yielded chunks still arrive). Stub every other call the code makes (`clock.every`, `ui.open`, `ui.log`, `command.register`): an unstubbed one is refused ("no implementation for clock.every") and the test fails. Ran `claude plugin test` on the scratch imgspike: the stub test passed, and the one failure was an old test broken by a `$.clock.every` I added. (T01, 2026-10-07) | confirmed T01
- D20 T12 proceeds without the owner's Ghostty half of T02. tmux facts (T02, 2026-10-07): the probe blit is denied with "the Image draws its alt here: the terminal draws no placeholder images (env: inside tmux or screen)"; `'Image' in $.ui.resolve(e)` is true in tmux, so it is not a detection signal alone; a height-only pane resize re-renders the pane in tmux (bodyRows updates); ui.render must not write state (write via $.clock.after(0)); the Image must be mounted from the first render (placeholder file source) or blits are denied. D18 (pad Input absolute bottom-left over the Image, like v2) is ASSUMED until the owner checks it in Ghostty; if it breaks the picture, move the Input to its own row under the Image. | assumed, confirm by T02 owner check, T13
- D21 Seating fix (T15): a seated agent is drawn with the back view (`personN-up`) in the chair, in front of its desk, with its foot line `SEAT.lift` (12 px) above the chair's foot line and its depth `z` equal to the chair's foot line. The desk (`desk-monitor`, scale 1.5) stands behind it with its foot line `SEAT.deskFootY` (34 px, 2 rows) below the anchor's top, so the monitor shows over the head and the chair base shows under the feet. The lift is in the model's `y` (the page no longer lifts). Rejected: lowering the monitor layer (it still hides the face of a front-view figure). Desk, reception desk, kitchen and lab sprites are scaled down (1.25-1.5) so desks at the 72 px pitch no longer overlap and shared rooms fit the narrowest room (13 cells = 104 px) to within 1.5 px. Shared rooms get two rows of furniture and the corridor gets plants, a sofa, a water cooler and clocks (wall-hugging, behind figures). The cat sprite is mirrored by the page for the non-native facing. Team signs are clipped to the room width. | confirmed T15 in frames at 608x187 and 928x391; D8 held without a scale factor (CELL_PX 8x17); D9 facing/variant held; D17 log strip and renderer reason still assumed
- D22 Performance measured and held (T18, 2026-10-07, owner's Mac, `uptime` load 1.8-3.1 for the final runs). Driver: a scratch script (not committed) that spawns `render.mjs --session=perf --state=<dir>/state.json`, writes real `sceneOf` output (3 seated agents in 2 team rooms, mid figures, a player; walking = one tile per 150 ms bouncing along a row, camera following) with a heartbeat rewrite every 2 s, waits for `ready` plus 3 s, then samples node + every Chromium descendant for 30 s. CPU = delta of `ps cputime` per 1 s (macOS `ps %cpu` is a decaying average, so it is not used). idle-typing is simulated by one scene change per second (the model has no typing toggle field yet). Sizes are Image pixel boxes: 608x187, 928x391, 2040x748 (255-column cap). Final table (median CPU as % of one core, 5 processes each):

| case | size | CPU med | frames/s | max gap | PNG med |
|---|---|---|---|---|---|
| idle static | 608x187 | 6 | 0 (0 frames in 30 s) | none | - |
| idle static | 928x391 | 7 | 0 | none | - |
| idle static | 2040x748 | 6 | 0 | none | - |
| idle typing (1 change/s) | 608x187 | 10 | 1.03 | 1035 ms | 20.7 KB |
| idle typing | 928x391 | 11 | 1.0 | 1033 ms | 70.4 KB |
| idle typing | 2040x748 | 11 | 1.03 | 1037 ms | 165 KB |
| walking | 608x187 | 28 | 7.4 | 193 ms | 21.9 KB |
| walking | 928x391 | 32 | 6.7 | 176 ms | 71.6 KB |
| walking | 2040x748 | 32 | 6.9 | 195 ms | 164.8 KB |

Before the changes (same driver; load rose from 3.5 to 7.9 during the first rows, so those rows are the noisier ones): idle static 5/4/8, idle typing 7/12/11, walking 16/30/44 (608/928/2040). Over D13 only at 2040x748 walking (44 > 40); idle static was 4-13 depending on load, never a frame. Changes, in the order D13 tells: (1) CDP `Page.captureScreenshot` with `optimizeForSpeed`: at 2040x748 walking 43.5 -> 38 (2 runs each, 20 s), PNG 96 -> 165 KB; at 928x391 30 -> 30 with PNG 71 -> 96 KB, so it is on only above `FAST_PX` = 1,000,000 viewport pixels (CDP without the flag = Playwright, 43 vs 43). (2) Not needed: clip to the view (the box is the Image size, so a clip would change the frame size) and a lower busy cap (walking already gives about 7 fps, one frame per 150 ms tile step, under the 12 fps cap). Two idle fixes that were not on the list but cut idle CPU about in half (static 11-13 -> 6-7 at the same load): `render.mjs` asks the page `sceneBusy()` only after a state push, while a frame is owed or while the last shot was busy (was every 50 ms poll), and `office.html` redraws on `requestAnimationFrame` only while busy (setScene and resize call `frame()` themselves). Final constants: `BUSY_FRAME_MS` 83 (12 fps cap) unchanged, `POLL_MS` 50 unchanged, `FAST_PX` 1,000,000. Budget at 120x40 (928x391 is the 120x40 pane's Image box): idle 11 (< 15), walking 32 (< 40); a static scene wrote no frame for 30 s. | confirmed T18; GHOSTTY walking smoothness check pending (owner)
- D23 Pane resize in both axes (T19, 2026-10-07). T02 tmux probe: a height-only resize DID re-render the pane (render count 2 -> 3, body rows 6 -> 11 at 80x24 -> 80x40), although the d.ts doc says `viewport.rows` changes re-draw nothing; the owner's Ghostty probe showed body 82x20 at viewport 86x40, so height follows there too. Decision: no workaround is needed, a height-only resize re-renders and the render takes the box from `bodyRowsFor(placement, scroll.bodyRows, viewport.rows)`; the d.ts doc is wrong for the terminal (known limit if a future build honours it: the tick reads the `viewport` atom, which only a render writes, so a skipped render would leave the old box until the next one). Path: render -> `writeViewport` -> tick reads `viewport` -> `pixelsFor` -> `state.json` `size` (columns*8 x rows*17, each axis capped at 2048) -> renderer `setViewportSize` -> next frame. Two fixes: (1) the write key is now `writeKeyOf(size, sceneText)` so a resize can never wait for the 2 s heartbeat; this is a guard only, because `sceneOf` already carries `world` and `camera` sized to the box and every tested resize (a one-row change included) changed the scene text, so no office test can tell the guard from the scene change and `bridge.test.ts` pins the key and `shouldWrite` instead; (2) below MIN_COLUMNS x MIN_ROWS the render draws only the v2 size line (Image unmounted) and the tick sends no new scene, so the renderer gets no new seq and writes no frame (pause = the renderer is alive but idle); the tick rewrites the last scene with the same seq and a fresh heartbeat every 2 s (`holdRenderer`), because without it the D7 watchdog would end the renderer after 10 s, count as a crash and fall to text after 3 exits; the hold mark has an empty key, so the first write after the pane is big enough again is a new seq and a new frame (the Image remounts with the placeholder). | confirmed T19 by tests (state size per box, pause plus heartbeat plus resume) and the direct run in the Log; GHOSTTY height-only drag pending (owner)
- D24 One `e`, nearest wins (interactions, 2026-10-07, assumed). Targets: own agents within INSPECT_RANGE 2 (`nearest` in inspect.ts); the cat and items within footprint gap <= 1. Smallest gap wins. Ties: agent > cat > item, then table order, then lower x. `E` unchanged. An agent target keeps the v2 inspect path exactly.
- D25 Item geometry (interactions, 2026-10-07, assumed): from scene.ts `propsOf` (exported), px -> cells via CELL_PX. Desks come from team anchors. No collision. The text fallback uses the same items undrawn; art-only outcomes show as a caption line.
- D26 Peek panes (interactions, 2026-10-07, assumed): desk, whiteboard and rack open the existing `office-peek` pane, only from the `ui.input` hook (a plugin-initiated open waits undrawn below 144 cols, register.tsx ~1546). The `peek` atom becomes `{ source: 'agent'|'board'|'rack', agentId?, label, lines }`.
- D27 Whiteboard source (interactions, 2026-10-07, confirmed T25 with an amendment): the todo-list `plan` atom via `read($, { plugin: 'todo-list', key: 'plan' })` (d.ts 3286-3300, 8787-8790; contract todo-list types/index.d.ts:46-62). If undefined, an own `board` atom mirrored from successful TodoWrite/TaskCreate/TaskUpdate `tool.call`s (`result.newTodos ?? e.todos`, d.ts 15839-15887). The render reads the source live. Own session only. T25 spike (Claude Code 2.1.292, scratch plugin, tmux -L aot25, both plugins loaded): `read($, { plugin: 'todo-list', key: 'plan' } as const)` typechecks with the contract vendored (a typo key `plam` fails TS2769); `claude plugin validate` passes and lists "state reads: todo-list.plan" with "state of other plugins, not checked"; value is `undefined` both with todo-list absent and with it loaded before any plan exists (no throw); after the model made a plan the pane redrew by itself each time the plan changed (render log: `plan=undefined`, then `plan=2 nodes: read sample.ts/pending|report/pending`, `.../in_progress|pending`, `.../completed|completed`), with no `$.ui.invalidate`. Amendment: with todo-list loaded the model had no TodoWrite tool (it said "no TodoWrite tool exists in this session" and used the todo-list `plan` MCP tool), so the `board` mirror is only for sessions without todo-list; `undefined` means "no plan yet" or "todo-list absent" and the whiteboard shows the empty line in both.
- D28 Server rack lines (interactions, 2026-10-07, confirmed T25 with amendments): own roster agents with tool names (D16 privacy); running/idle counts from `$.agent.list()` (d.ts 3080-3087, AgentInfo.status 159-167); context % and cost from a `session.measure` hook (d.ts 4265, 10554-10580) into a `usage` atom (context.percent?/window 10409-10434; cost?.usd 10439-10444, 11182-11185). No background shell tasks (no live API). T25 spike values, LIVE (2.1.292): `session.measure` first fired at session start with `ctx={"window":1000000} cost={"usd":0} changed=context,rateLimits,cost`, so before the first response `context.tokens` and `context.percent` are absent and only `window` is set; after the first API response `cost={"usd":0.0010119999999999999} changed=rateLimits,cost` (context still absent); after the prompt turn `ctx={"tokens":[REDACTED in the debug log],"window":1000000,"percent":7} cost={"usd":0.383951} changed=context,cost`, then `cost={"usd":0.44717080000000003}`. `$.session.usage()` in `turn.start` returned `{"startedAt":...,"context":{"window":1000000},"rateLimits":[...],"cost":{"usd":0}}` before the prompt and `"context":{"tokens":[REDACTED],"window":1000000,"percent":7},"cost":{"usd":0.4075246}` at the second turn start, the same shape as the measure input. Amendments: the rack must treat `percent` and `tokens` as absent (show the window or a dash) until the first response, and `cost.usd` is a float to round for display. `$.agent.list()` polled every 1 s while one Explore subagent ran: `[Explore:running]` then `[Explore:completed]` (it was not listed as `idle`; a finished subagent stays listed for seconds, d.ts 3080-3087), so the running count is `status === 'running'` and completed entries must not count as idle.
- D29 Fun props (interactions, 2026-10-07, assumed): local, never published to presence (presence.ts:442 picks fields). Coffee = mug for MUG_MS 8 s; sofa = sit until any WASD/[/]/jump; water cooler = one of 8 fixed lines by seed as player chat for CHAT_MS; cat = heart emote on the cat for 3 s. An empty desk says `Empty desk.`; a remote agent's desk says `<Session N>'s desk` and has no peek.
- D30 Caption order (interactions, 2026-10-07, assumed): chat draft > inspect/action line > hint. Hint `e: coffee machine` (item), `e: inspect <label>` (agent). The text fallback shows it on the overlay/strip row like inspect.

## Todos

### T01 Spike the renderer lifecycle and the test engine
- status: done (#65, 2026-10-07)
- needs: none
- size: M
- scope: In a scratch plugin copied from `SPIKE/imgspike` (not committed), measure:
  - (a) whether `/reload-plugins` after an edit, `ui.close` of the pane and quitting claude each end the node child and its Chromium. Record `pgrep -fl 'chrome-headless|render.mjs'` before and 3 s after each.
  - (b) a kill -9 of the claude process: does Chromium outlive node? Does a `process.ppid` poll plus a stale-heartbeat exit (D7) clean it up within 10 s?
  - (c) whether repeated `$.fs.write` of a 20 KB JSON while the renderer polls ever yields a torn read. Count parse failures over 2 minutes at 10 writes a second.
  - (d) whether `claude plugin test` can stub `$.process.spawn` with an `on('process.spawn')` generator hook and `$.ui.blit` for an Image with an `on('ui.blit')` hook returning `{ deny }`.
- files: scratch only, under the session scratchpad; results go into this file's Decisions/Log
- done when: D5, D7 and D12 are confirmed or amended with the numbers, and the stub recipe for spawn and Image blit is written as a Decision (or a recorded "cannot stub", with the fallback test approach)
- verify: the pgrep lines and parse-failure count pasted into the Log; the stub recipe passes in a scratch `claude plugin test`

### T02 Spike detection, the Input over an Image, and height-only resize
- status: done (#87, 2026-10-07; owner verified in Ghostty 2026-10-07: pad Input over the Image does not break the picture (D18 confirmed), Image-in-elements=true, height-only resize re-renders (D23); Terminal.app probe not run: owner-skipped, the README already says Terminal.app is expected to fall back)
- needs: none
- size: S
- scope: With the scratch plugin, record:
  - the exact `deny` text of a probe blit (`source: { file: <placeholder.png>, format: 'png' }`) in tmux (LIVE), and the owner's run in Terminal.app;
  - what `$.ui.resolve(e)` holds in those terminals (`'Image' in elements`);
  - whether an absolutely placed `Input` (`bottom={0} left={0}`) over an Image breaks the picture in Ghostty (owner);
  - whether a height-only terminal resize in Ghostty re-runs the pane's `ui.render` (debug log line per render).
- files: scratch only; results into Decisions
- done when: D11 and D18 are confirmed or amended with the quoted deny strings, and the height-only resize behaviour is recorded as a Decision (re-renders / does not)
- verify: LIVE capture plus `<scratch>/ao.log` excerpt for tmux; GHOSTTY and Terminal.app results reported by the owner and quoted in the Log

### T03 Move the sprites, the atlas and the slicer into the repo
- status: done (#64, 2026-10-07)
- needs: none
- size: S
- scope: Copy `SPIKE/v3-assets/sprites/*.png` and `atlas.json` to `.claude/skills/agents-office/renderer/sprites/`. Copy `characters-raw.png`, `furniture-raw.png` and `pets-gear-raw.png` to `assets/sprites/raw/`. Copy `slice.mjs` and `lib.mjs` to `scripts/sprites/`, with input and output paths as arguments defaulting to those folders. Add pngjs as a devDependency and `"sprites": "node scripts/sprites/slice.mjs"`. Record the known art issues in the Backlog: laptop-back/closed near duplicates, corgi-sleep zzz, no walk cycles.
- files: `.claude/skills/agents-office/renderer/sprites/**`, `assets/sprites/raw/*.png`, `scripts/sprites/{slice,lib}.mjs`, `package.json`, `package-lock.json`
- done when: `npm run sprites` regenerates the 82 sprites and `atlas.json` with no git diff, and `claude plugin validate` still passes with the new folder inside the mod
- verify: `npm ci && npm run sprites && git diff --exit-code -- .claude/skills/agents-office/renderer/sprites`; `rtk proxy npm run check`

### T04 Add playwright and the renderer skeleton with a smoke script
- status: done (#68, 2026-10-07)
- needs: T01, T03
- size: S
- scope:
  - Add `playwright` to `dependencies` (D16).
  - Copy `SPIKE/imgspike/renderer/render.mjs`, `office.html` and `placeholder.png` to `.claude/skills/agents-office/renderer/`, with the screencast mode removed.
  - Add `scripts/smoke-renderer.mjs` (`npm run smoke:renderer`): it launches `render.mjs` against `scripts/fixtures/state-basic.json`, waits for the first `frame` line, checks the PNG's width and height equal `size.w`/`size.h`, and exits 0.
  - Add `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: 1` to `.github/workflows/ci.yml`.
  - Add `.gitignore` entries for any local renderer output.
- files: `package.json`, `package-lock.json`, `.claude/skills/agents-office/renderer/{render.mjs,office.html,placeholder.png}`, `scripts/smoke-renderer.mjs`, `scripts/fixtures/state-basic.json`, `.github/workflows/ci.yml`, `.gitignore`
- done when: the smoke script prints `ok <w>x<h>` and exits 0 on a machine with Chromium installed; `/office` is unchanged (nothing wires the renderer yet)
- verify: `npx playwright install chromium && npm run smoke:renderer`; `rtk proxy npm run check`

### T05 Put the sprite scale and anchor table in one place
- status: done (#66, 2026-10-07)
- needs: T03
- size: S
- scope:
  - Create `hooks/sceneArt.ts` with `SPRITES: Record<SpriteName, { scale: number; anchor: 'foot' | 'top'; layer: 'floor' | 'wall' | 'figure' | 'over' }>` covering every atlas name. The spike scales are the start: people, desks and furniture 2, mug 0.8, laptop 0.7, wall clock 1.5, sofa 1.5.
  - Add `personVariant(key)` (D9), `tierPlate(tier)` (the v2 D6 colours) and `CELL_PX`.
  - `scripts/smoke-renderer.mjs` also checks that the atlas names equal the table's names.
- files: `.claude/skills/agents-office/hooks/sceneArt.ts`, `hooks/sceneArt.test.ts`, `scripts/smoke-renderer.mjs`
- done when: tests prove `personVariant` is stable for a key and spreads 64 keys over at least 6 variants, every tier has a plate colour, and no scale is 0 or negative. The smoke check fails when a sprite file is added without a table entry.
- verify: `rtk proxy npm run check`; `npm run smoke:renderer`

### T06 Map the office to the scene model (rooms, props, camera)
- status: done (#67, 2026-10-07)
- needs: T05
- size: M
- scope: Create `hooks/scene.ts` with the `SceneModel` type and `sceneOf(input)`. Rooms come from `OfficeMap` (id, name, kind, x, y, w, h in world px; floor colour per kind from v2 D32), plus walls, doors and the night flag (`isNight(hourOf(now))`). Props follow per-kind furniture rules:
  - team: desk-monitor plus chair per desk anchor;
  - reception: reception-desk and plant;
  - conference: conference-table and whiteboard;
  - kitchen: fridge, coffee-machine and water-cooler;
  - lab: server-rack and printer;
  - booths: phone and armchair.
  The camera is `viewFor`/`focusOf` in px. Figures come in T07.
- files: `.claude/skills/agents-office/hooks/scene.ts`, `hooks/scene.test.ts`; reads `map.ts`, `camera.ts`, `frame.ts` exports only
- done when: tests show:
  - a 2-team map gives 2 team rooms plus 5 shared rooms with px bounds = cell bounds x CELL_PX;
  - every desk anchor has one desk prop;
  - the camera centres on the player and clamps at the map edges;
  - night is set at 22:00 and not at 12:00;
  - `sceneOf` is pure (the same input gives a deep-equal output).
- verify: `rtk proxy npm run check`

### T07 Map figures, player, bubbles, inspect and status into the scene
- status: done (#69, 2026-10-07)
- needs: T06
- size: M
- scope: Extend `sceneOf` with figures for own and remote agents (`remoteRoster`), the player, remote players (`remotePlayersOf`) and the cat atom. Each figure carries:
  - `key`, `sprite` (variant plus facing), `pose` (seated for read/type, else standing), x/y/z in px;
  - `plate` (cut to 16), `tier`, `status`, `remote`, `player`;
  - `bubble?`, `emote?`, `chat?` (only while `until > now`) and `highlight` (inspect target while shown).
  Add `caption` for the overlay line (chat draft first, then inspect; D17) and a stable `sceneKey(model)` string so callers can skip unchanged writes. Facing follows v2 D8.
- files: `hooks/scene.ts`, `hooks/scene.test.ts`
- done when: tests show:
  - a reading agent is seated at its own desk;
  - a remote agent appears with `remote: true` and no tool text;
  - an expired emote or chat is absent;
  - the inspect target alone has `highlight`;
  - the chat draft wins the caption over an inspect line;
  - a done agent has status `done`.
  A test that changes the business rule (for example drops the `until` check) fails.
- verify: `rtk proxy npm run check`

### T08 Write the bridge protocol as a pure module
- status: done (#71, 2026-10-07)
- needs: T01, T04
- size: S
- scope: Create `hooks/bridge.ts`:
  - `splitLines(carry, text)` and `parseLine(line)` for `dir`/`ready`/`frame`/`error`/`fps` (D6);
  - `stateText({ seq, heartbeatAt, size, scene })`;
  - `shouldWrite(prev, nextKey, now)`, true when the scene key changed or 2000 ms passed since the last write (D7);
  - `pixelsFor(box)` from the spike's box.ts (8x17, cap 2048) and `clampCells` (1-255).
  Then update `render.mjs` to speak exactly this protocol and to tolerate torn JSON (D5).
- files: `hooks/bridge.ts`, `hooks/bridge.test.ts`, `.claude/skills/agents-office/renderer/render.mjs`
- done when: tests cover:
  - a frame line split across two pieces;
  - several frames in one piece (only the newest is used);
  - an unknown line is ignored;
  - `error no-chromium <text>` parses;
  - the heartbeat is due at 2000 ms and not at 1999 ms;
  - 300 columns clamps to 255 and 2048 px.
  The smoke script sees `dir`, `ready` and `frame` in that order.
- verify: `rtk proxy npm run check`; `npm run smoke:renderer`

### T09 Write the renderer lifecycle as a pure state machine
- status: done (#74, 2026-10-07)
- needs: T08
- size: S
- scope: Create `hooks/rendererLife.ts`:
  - `next(life, event, now)` over events `want-start`, `spawned`, `ready`, `exit{code,signal,stderr}`, `spawn-failed{error}`, `closed`, `retry-due`, giving the D12 states and backoff 1/2/4 s;
  - `classify(stderr, error)` -> `no-node` | `no-playwright` (`Cannot find package 'playwright'`) | `no-chromium` (`Executable doesn't exist`) | `crash`, each with a one-line human reason naming the fix (`Run npx playwright install chromium`).
  Declare the `renderer` and `scene` atoms inline in `types/index.d.ts` (D10, D12).
- files: `hooks/rendererLife.ts`, `hooks/rendererLife.test.ts`, `.claude/skills/agents-office/types/index.d.ts`
- done when: tests show:
  - 3 exits within 60 s give `failed`;
  - 3 exits spread over 61 s+ keep restarting;
  - `closed` gives `off` and no retry;
  - `no-chromium` and `no-playwright` go straight to `failed` (a missing dependency does not get better by retrying);
  - each reason string names its fix.
- verify: `rtk proxy npm run check`

### T10 Make the page draw the scene model
- status: done (#72, 2026-10-07)
- needs: T04, T07
- size: M
- scope: Rewrite `renderer/office.html` so `window.setScene(model)` draws a `SceneModel`:
  - rooms with floor colour per kind, walls, doors and HTML room signs;
  - props and figures from `sprites/` with the table's scale and anchor, z by foot y;
  - nameplates coloured by tier, HTML bubbles (emote, chat, agent), a highlight outline (CSS `drop-shadow`) and the caption bar;
  - a night tint overlay;
  - a camera transform that eases toward `camera`, and a 100 ms tween per figure step;
  - `window.sceneBusy()`, true while a tween, ease or bubble change is in progress.
  The pixelated rendering stays. Remove the spike's demo walkers.
- files: `.claude/skills/agents-office/renderer/office.html`, `scripts/fixtures/state-basic.json`, `scripts/fixtures/state-busy.json` (2 teams, 6 agents, player, emote, chat, inspect, night)
- done when: `npm run smoke:renderer -- scripts/fixtures/state-busy.json` writes a frame. Reading the PNG shows two team rooms, the shared rooms, seated and standing figures with plates, a bubble, the highlight and the caption.
- verify: `npm run smoke:renderer -- scripts/fixtures/state-busy.json`, then Read the frame PNG it prints; `rtk proxy npm run check`

### T11 Add the frame pacing and the watchdog to render.mjs
- status: done (#75, 2026-10-07)
- needs: T08, T10
- size: S
- scope: In `render.mjs`:
  - screenshot only when the state seq changed or `sceneBusy()` is true, capped at 12 fps busy and 1 fps idle animation (D13);
  - `setViewportSize` on a `size` change;
  - mkdtemp dir, `pid` file and sweep of dead siblings (D7);
  - exit 0 on a stale heartbeat (> 10 s) or a `process.ppid` change;
  - on SIGTERM/SIGINT, close the browser and remove the dir;
  - print `error <code> <text>` and exit 1 when the playwright import or the Chromium launch fails.
  Add `--once` for the smoke script.
- files: `.claude/skills/agents-office/renderer/render.mjs`, `scripts/smoke-renderer.mjs`
- done when the smoke script shows:
  - (a) a static fixture produces 1 frame and then none for 3 s;
  - (b) a stale heartbeat makes the renderer exit within 11 s and its dir is gone;
  - (c) `PLAYWRIGHT_BROWSERS_PATH=/nonexistent` gives an `error no-chromium` line and exit 1.
- verify: `npm run smoke:renderer` (cases a-c); `rtk proxy npm run check`

### T12 Wire the image scene behind `/office scene image`
- status: done (#76, 2026-10-07)
- needs: T02, T09, T11
- size: M
- scope:
  - `parseOfficeArgs` gains `scene auto|image|text` (`$.store` key `scene`, default `text`; D10).
  - In register.tsx, the render draws Image (key `scene`, placeholder source, box from `rasterSize`, alt naming the mode) plus the pad Input placed per D18 when `effective` is `image`; otherwise the v2 Raster path is unchanged.
  - The tick, in image mode, builds `sceneOf`, writes `state.json` when `shouldWrite` says so, and skips the Raster blit.
  - A module-scope spawn loop follows `rendererLife`: it parses lines, blits the newest frame with `generation`, and logs `agents-office: renderer dir <path>` to debug.
  - `ui.close` ends the loop.
  - office tests stub spawn and blit per the T01 recipe.
- files: `hooks/register.tsx` (render 1111+, tick 737-836, ui.close 1039-1048, command.run 1050-1065, session.start 917-950), `hooks/presence.ts` (`parseOfficeArgs` :36), `hooks/presence.test.ts`, `hooks/office.test.ts`, `types/index.d.ts`
- done when:
  - office tests show `/office scene image` spawns one renderer, a `frame` line becomes one Image blit with that generation, and `ui.close` ends the loop;
  - with the default (`text`) the v2 Raster frame is unchanged;
  - LIVEIMG writes frames whose PNG shows the own team room with the main agent and the player;
  - GHOSTTY: the owner sees the image office after `/office scene image`.
- verify: `rtk proxy npm run check`; LIVE (default still text); LIVEIMG and Read the frame PNG; GHOSTTY (owner)

### T13 Detect image support and fall back to the text office
- status: done (#77, 2026-10-07)
- needs: T12
- size: M
- scope:
  - `auto` becomes the default. The render with `Image` available draws the Image and puts `effective` at `probe`; a `$.clock.after(0)` closure blits `placeholder.png` as a file source. Not denied -> `image` and the renderer starts. Denied, or no `Image` in elements -> `text` with the deny text as the reason (D11).
  - A deny while running or a `failed` lifecycle also switches to `text`.
  - The reason is pushed once to the office log, shown as the overlay line for 8 s, and appended to the `/office` reply. `/office scene auto|image` resets `failed`.
  - Pure helpers (`effectiveScene(want, probe, life)`) go in `rendererLife.ts` with tests.
- files: `hooks/register.tsx`, `hooks/rendererLife.ts`, `hooks/rendererLife.test.ts`, `hooks/office.test.ts`
- done when:
  - office tests show a probe deny gives text mode with the reason line and never spawns;
  - a spawn that rejects (`no-node`) or prints `error no-chromium` gives text mode with the fix line;
  - 3 crashes give text mode;
  - LIVE (tmux, default `auto`) shows the v2 5x5 figures and the reason line, and `pgrep -f render.mjs` finds nothing;
  - GHOSTTY: the owner sees the image office with plain `/office`.
- verify: `rtk proxy npm run check`; LIVE plus `pgrep -fl render.mjs`; GHOSTTY (owner); Terminal.app (owner) shows the text office

### T14 Harden reload, close, kill and two sessions
- status: done (#78, 2026-10-07)
- needs: T13
- size: M
- scope:
  - A reloaded module whose pane is drawn starts its renderer once (beside `askPadFocusAfterLoad`, register.tsx:909).
  - `session.end` ends the loop.
  - Check one renderer per session with two sessions, and the temp dir sweep at start.
  - Fix whatever T01's numbers showed leaks (for example Chromium outliving a killed node).
- files: `hooks/register.tsx`, `hooks/office.test.ts`, `.claude/skills/agents-office/renderer/render.mjs`
- done when:
  - after `/reload-plugins` with an edit, exactly one `render.mjs` runs for the session;
  - after closing the pane, none within 3 s;
  - after `kill -9` of claude, no Chromium of the mod within 12 s;
  - LIVE2 with `/office scene image` in both sessions shows two renderers with two different dirs;
  - an office test proves a second start request while running spawns nothing.
- verify: `rtk proxy npm run check`; LIVEIMG and LIVE2 with `pgrep -fl 'render.mjs|chrome-headless'` at each step pasted into the Log

### T15 Lay out rooms and seated figures in the image scene
- status: done (#79, 2026-10-07); GHOSTTY owner acceptance of the room look at 80x24 and 120x40 is pending
- needs: T14
- size: M
- scope: Tune `sceneOf` props, the `SPRITES` scales and the page so that:
  - each team room reads as a desk row with chairs, and seated people are not hidden behind monitors (for example the back view behind the desk, or the monitor drawn lower);
  - shared rooms carry their furniture;
  - signs show `<project> (<branch>)`;
  - the camera follows the player smoothly;
  - the cat walks the shared rooms.
  Record the chosen seating fix as a Decision.
- files: `hooks/scene.ts`, `hooks/sceneArt.ts`, their tests, `renderer/office.html`
- done when:
  - a LIVEIMG frame at 80x24 and at 120x40 shows every seated agent's head;
  - GHOSTTY: the owner accepts the room look at 80x24 and 120x40 (D8 confirmed or amended, for example with a scale factor);
  - tests pin the seating offsets.
- verify: `rtk proxy npm run check`; LIVEIMG at 80x24 and 120x40, Read both frames; GHOSTTY (owner)

### T16 Check every pad key against the image scene
- status: done (#80, 2026-10-07)
- needs: T15
- size: S
- scope: Check that WASD, `[` `]`, 1-4, `e`, `E`, `t` + Enter, `m`, `x` and Escape still drive the atoms in image mode and that the scene shows each one: player step and facing, room jump with camera move, emote bubble (now the real U+2665 and U+266A), inspect highlight plus caption, peek pane, chat bubble plus caption draft, nudge and interrupt dialogs. Fix gaps in `sceneOf` or the page only, not in pad.ts.
- files: `hooks/scene.ts`, `hooks/scene.test.ts`, `hooks/office.test.ts`, `renderer/office.html`
- done when:
  - an office test drives each key in image mode and asserts the written scene state (positions, emote, highlight, caption);
  - LIVEIMG frames after `dddd`, `]`, `3` and `e` show the change;
  - GHOSTTY: the owner walks, emotes, chats and inspects.
- verify: `rtk proxy npm run check`; LIVEIMG with the keys, Read the frames; GHOSTTY (owner)

### T17 Show other sessions in the image scene
- status: done (#81, 2026-10-07)
- needs: T16
- size: S
- scope: Check that presence teams, remote agents and remote players (with emote and chat) appear in the image scene in room order (v2 D4). The `Session N` labels for anon records must show. A tombstoned session's room must leave within 5 s. Fix gaps in `sceneOf`/page only.
- files: `hooks/scene.ts`, `hooks/scene.test.ts`, `renderer/office.html`
- done when:
  - a scene test with 3 remote records gives their rooms in `startedAt` order with `remote` figures;
  - LIVE2 with `/office scene image` in both sessions writes frames in which each pane shows the other's team room and player;
  - GHOSTTY with two sessions (owner) confirms it.
- verify: `rtk proxy npm run check`; LIVE2 plus FAKES (3 fake records, deleted afterwards), Read the frames; GHOSTTY (owner)

### T18 Measure and hold the performance budget
- status: done (#82, 2026-10-07)
- needs: T17
- size: M
- scope:
  - Measure fps (the `fps` line), CPU (`ps -o %cpu -p <node pid> <chromium pids>` every 1 s for 30 s) and PNG size at 80x24, 120x40 and the 255-column cap, idle and while walking.
  - If over D13, try in order: CDP `Page.captureScreenshot` with `optimizeForSpeed`; a screenshot clip to the view; a lower busy cap.
  - Record the numbers and the final constants as a Decision.
- files: `.claude/skills/agents-office/renderer/render.mjs`, `renderer/office.html`, this TODO's Decisions
- done when: the measured idle CPU is under 15% and walking CPU under 40% of one core on the owner's Mac (or the owner accepts the measured numbers), and a static office writes no frame for 10 s
- verify: the measurement script output pasted into the Log; `npm run smoke:renderer`; GHOSTTY (owner): walking looks smooth enough

### T19 Follow pane resizes in both axes
- status: done (#83, 2026-10-07)
- needs: T18
- size: S
- scope: Check that a width or height resize updates the Image box, the `state.json` size and the page viewport, so the next frame matches the new box. If T02 found that a height-only resize does not re-render, apply the workaround T02 chose (for example re-checking `e.viewport` on the next render) or record it as a known limit. A resize below `MIN_COLUMNS`x`MIN_ROWS` shows the v2 size line and pauses frames.
- files: `hooks/register.tsx`, `hooks/bridge.ts`, `hooks/bridge.test.ts`, `renderer/render.mjs`
- done when:
  - a test shows a new box gives a new `size` in the state text;
  - LIVEIMG resized 80x24 -> 120x40 -> 74x24 writes frames whose PNG sizes equal columns x 8 by body rows x 17 for each box (body measured per v2 D57), checked with `file <png>`;
  - GHOSTTY (owner): a height-only drag either follows or matches the recorded limit.
- verify: `rtk proxy npm run check`; LIVEIMG with `tmux resize-window`, then check the PNG sizes with `file <png>`; GHOSTTY (owner)

### T20 Install Chromium from the install script
- status: done (#70, 2026-10-07)
- needs: T04
- size: S
- scope: `scripts/install-user.sh` runs `npm ci` when `node_modules/playwright` is missing, then `npx playwright install chromium` unless `--no-chromium`. It prints what it did and still links as before (v2 D52). `uninstall-user.sh` leaves the browser cache alone and says where it is. Both stay plain sh.
- files: `scripts/install-user.sh`, `scripts/uninstall-user.sh`
- done when:
  - against a temp `CLAUDE_CONFIG_DIR`, a fresh install links the mod and leaves `npx playwright install --dry-run chromium` showing it installed;
  - `--no-chromium` skips the download;
  - a re-run prints "nothing changed" for the link;
  - the owner's real `~/.claude` is not touched.
- verify: scratch script against temp config dirs (not committed), output pasted into the Log; `rtk proxy npm run check`

### T21 Update the README for v3
- status: done (#84, 2026-10-07)
- needs: T13, T17, T19, T20
- size: S
- scope:
  - Install: the Chromium step and `--no-chromium`.
  - Use: `/office scene auto|image|text`.
  - New "Image office" section: what draws it, the fallback and its reasons.
  - Requirements: node 20+, a terminal that draws images (Ghostty, kitty, WezTerm, iTerm2), about 150 MB of Chromium.
  - Develop: `npm run sprites`, `npm run smoke:renderer`.
  - Known limits: tmux, Terminal.app and ssh fall back; height-only resize per T19; no walk cycles; pets have no collision; mixed sizes approximate.
  - A new README image from a real frame (`docs/images/office-image-120x40.png`, taken from the renderer's frame PNG).
- files: `README.md`, `docs/images/office-image-120x40.png`
- done when: every command in the README runs as written, and the owner reads the Image office section
- verify: run each README command; `rtk proxy npm run check`; owner review

### T22 Walk faster
- status: done (#87, 2026-10-07)
- needs: none
- size: S
- scope: Owner feedback from Ghostty: the player walks too slowly. A held WASD key moves one tile per 100 ms tick (tween 100 ms); the first or a lone tap still moves one tile, and a tap that repeats the last step's direction within INTENT_MS moves RUN_TILES = 2 tiles (player.ts). The page tween stays 100 ms, so it is not longer than the tick. Held-key speed: 10 -> 20 tiles/s (same code for the image and text paths).
- files: `hooks/player.ts`, tests
- done when: a held key moves 1 + 2 + 2 + ... tiles per tick and a lone tap moves 1
- verify: `rtk proxy npm run check`

### T23 Cat faces the wrong way walking left
- status: done (#87, 2026-10-07)
- needs: none
- size: S
- scope: The cat PNGs (cat-orange-walk, cat-orange-sit) are drawn facing LEFT (head and ears at the left edge), while office.html assumed right and mirrored the wrong facing. `scene.ts` now sets `mirror` on the cat figure (`catMirror`: mirrored only when facing right) and the page flips on `fig.mirror`.
- files: `hooks/scene.ts`, `renderer/office.html`, tests
- done when: a left-walking cat is drawn unflipped, a right-walking cat flipped (scene test)
- verify: `rtk proxy npm run check`; a rendered frame

### T24 Widen the room doors
- status: done (#87, 2026-10-07)
- needs: none
- size: S
- scope: Mid-layout doors were 5 cells (40 px) wide, one figure footprint. They are now 2x the footprint (10 cells, 80 px) where the room is at least 14 wide (`min(10, width - 4)`), with the doorStand where it was so signs and anchors do not move. The small layout keeps 3-cell doors.
- files: `hooks/map.ts`, `hooks/map.test.ts`
- done when: every mid room's door is `min(10, width - 4)` cells and contains the doorStand footprint; BFS and the v2 tests stay green
- verify: `rtk proxy npm run check`; a rendered frame

### T22b Stale handle error in the transcript
- status: done (#87, 2026-10-07)
- needs: none
- size: S
- scope: `ui.input hook skipped: threw ... no handler is held under handle N` reached the transcript after a reload or pad remount. The pad Input's closures are held under a handle of the render that drew it; a key typed into a tree that a later render (or a reload) replaced reaches core after the handle is released, and `next(e)` throws. The pad's own closures do nothing, so the `ui.input` hook now answers `{ element, value }` itself instead of calling `next(e)`.
- files: `hooks/register.tsx`
- done when: the hook never calls `next(e)`; keys still reach the pad (office tests)
- verify: `rtk proxy npm run check`; owner: reload plugins with the pane open, no leaked line

### T23b Procedural walk cycle
- status: done (#87, 2026-10-07)
- needs: none
- size: S
- scope: Owner feedback: the walk looked like a ghost. `renderer/office.html` splits a walking person sprite into the body and a legs band (bottom 30%, two halves, two clipped copies) and alternates the legs per tween: stride pose (first half), passing pose with a 1 art px body bob (second half). Down/up: the legs take turns lifting a foot; left/right: the halves swing opposite ways. Real walk-cycle art stays in the Backlog.
- files: `renderer/office.html`
- done when: three frames mid-walk show the legs change
- verify: rendered frames walk-a/b/c

### T25 Spike plan and activity data
- status: done (#86, 2026-10-07)
- needs: none
- size: S
- scope: In a scratch plugin (not committed), check: (a) `read($, { plugin: 'todo-list', key: 'plan' } as const)` typechecks with the todo-list contract vendored at `vendor/todo-list/index.d.ts`, passes validate, returns the plan with todo-list loaded and undefined (no throw) without it, and a render reading it redraws on a plan change; (b) `$.session.usage()` and `session.measure` values (context.percent, cost.usd) in LIVE before and after one prompt; (c) `$.agent.list()` statuses while a subagent runs.
- files: scratch only, under the session scratchpad; results go into this file's Decisions/Log
- done when: D27 and D28 are confirmed or amended with quoted values; if (a) fails, D27 drops to the own `board` mirror
- verify: LIVE with `--plugin-dir` for both mods, log excerpt in the Log

### T26 Interactables table and item geometry
- status: done (#88, 2026-10-07)
- needs: none
- size: S
- scope: New `hooks/items.ts` (pure): `ItemKind` = desk|whiteboard|coffee|sofa|cooler|rack; `ITEMS: Record<ItemKind, { label; sprites: SpriteName[]; foot: Footprint }>`; `itemsOf(map): Item[]` (`{ id, kind, label, rect, room?, anchor? }`) from the exported `propsOf` plus one desk per team anchor. The only edit to scene.ts is exporting `propsOf`.
- files: `hooks/items.ts`, `hooks/items.test.ts`, `hooks/scene.ts` (export `propsOf` only)
- done when:
  - tests show every interactable prop yields one item (2 racks, 2 coolers);
  - desk count equals the team anchors;
  - each rect lies inside its room or the corridor;
  - moving a room moves its items;
  - dropping a sprite from `ITEMS` fails a test.
- verify: `rtk proxy npm run check`; a mutation check that breaks one rule and fails a key test

### T27 Nearest-target resolution and hint
- status: done (#89, 2026-10-07)
- needs: T26
- size: S
- scope: New `hooks/use.ts` (pure): `targetOf({ player, foot, agents, motion, items, cat })` -> Target (agent|cat|item) per D24; `deskOwner(desk, motion, roster)` (the agent resting at the anchor or whose path ends there); `hintOf(target, roster)` per D30.
- files: `hooks/use.ts`, `hooks/use.test.ts`
- done when:
  - tests show agent gap 2 vs item gap 1 -> item;
  - equal gap -> agent > cat > item;
  - an item at gap 2 is out of range;
  - mid and small footprints resolve;
  - desk owner by rest and by path end;
  - exact hint strings;
  - changing the tie order fails a test.
- verify: `rtk proxy npm run check`; a mutation check that swaps the tie order and fails a test

### T28 Action outcomes and pane lines
- status: done (#90, 2026-10-07)
- needs: T27
- size: M
- scope: In `hooks/use.ts`: `outcomeOf(target, ctx, now, seed)` -> inspect|peek|board|rack|act('mug'|'sit')|say|pet|line; `COOLER_LINES` (8) with a seeded pick; `boardLines(plan|todos)` with `[x]`/`[>]`/`[ ]` and indent, capped at PEEK_MAX, else `No plan yet.`; `rackLines({ roster, agentList, usage })` with own tools only; `settleAct(player, now, moved)` (the mug expires, a move clears sit).
- files: `hooks/use.ts`, `hooks/use.test.ts`
- done when:
  - tests show each kind's outcome;
  - an empty desk gives `Empty desk.`;
  - a remote desk gives no peek;
  - board tree order holds and the cap is 10;
  - rack lines never hold a remote tool or a tool argument;
  - a missing cost or percent prints `-`;
  - the mug ends at now >= until;
  - a step clears sit.
- verify: `rtk proxy npm run check`; a mutation check that lets a remote tool into the rack and fails a test

### T29 Scene fields for actions, pet, hint
- status: done (#91, 2026-10-07)
- needs: T28
- size: S
- scope: `SceneInput` gains `act`, `catPetUntil` and `hint`. The player figure gets `holding: 'mug'` or `pose: 'seated'` with y on the sofa foot line; the cat gets the emote U+2665 while `catPetUntil` > now; `captionOf` follows D30; `sceneKey` changes with each.
- files: `hooks/scene.ts`, `hooks/scene.test.ts`
- done when: tests show each field changes the figure, the caption and `sceneKey` as described
- verify: `rtk proxy npm run check`

### T30 Page art for mug, sofa sit, cat heart
- status: todo
- needs: T29, T22, T23, T24
- size: S
- scope: `office.html` draws the mug sprite at the player's hand while holding, a sitting player with the sofa over the legs, and the emote above the cat. Add `scripts/fixtures/state-interact.json` (real `sceneOf` output).
- files: `renderer/office.html`, `scripts/fixtures/state-interact.json`
- done when: `npm run smoke:renderer` passes on the fixture and the PNG (read back) shows the three drawings; GHOSTTY (owner) at 80x24 and 120x40
- verify: `rtk proxy npm run check`; `SMOKE_FRAME_OUT=<png> npm run smoke:renderer -- <fixture>`; GHOSTTY (owner)

### T31 Wire e routing, desk, whiteboard, rack panes
- status: todo
- needs: T25, T28, T22, T23, T24
- size: M
- scope: In `ui.input`, a pending `pad.inspect` runs `targetOf`; an agent target goes to `inspectTick` unchanged; other targets are consumed and applied. `peek` atom per D26; `office-peek` titles `Peek: <label>`, `Whiteboard`, `Server rack`. The board render reads the D27 source live (plus the board mirror hooks if T25 needs them). A new `session.measure` hook writes the `usage` atom; `$.agent.list()` is read on a rack press.
- files: `hooks/register.tsx`, `types/index.d.ts`, `tsconfig.json` (vendored todo-list contract if kept), `hooks/office.test.ts`
- done when:
  - an office test shows `e` at a desk peeks its owner;
  - `e` at the whiteboard lists a TodoWrite's items and redraws after a second TodoWrite;
  - `e` at the rack shows own tools and context %;
  - `e` next to an agent inspects as before;
  - GHOSTTY (owner): the panes open beside the office.
- verify: `rtk proxy npm run check`; GHOSTTY (owner)

### T32 Wire fun props and the hint
- status: todo
- needs: T29, T31
- size: M
- scope: Outcomes write `player.act` (coffee, sofa), player chat (cooler) and `catPetUntil`. The tick runs `settleAct` and `hintOf` every tick into `sceneOf` and the text overlay/strip.
- files: `hooks/register.tsx`, `types/index.d.ts`, `hooks/office.test.ts`
- done when:
  - office tests in both modes show the mug lasts 8 s;
  - the sofa sits and then `d` stands;
  - the cooler chats;
  - the cat shows a heart;
  - the hint shows near an item and is gone when walking away;
  - the presence record has no new field;
  - LIVE text mode shows the hint;
  - GHOSTTY (owner): full tour.
- verify: `rtk proxy npm run check`; LIVE text; GHOSTTY (owner)

### T33 README: interacting with the office
- status: todo
- needs: T32
- size: S
- scope: A "Things to use" section: the `e` rules, each item's effect, own-session-only data, text-mode limits. Log that this breaks "README only in T21".
- files: `README.md`
- done when: every command and key the section names works as written, and the owner reads it
- verify: run each key in LIVE; `rtk proxy npm run check`

### TZZ Cleanup and land
- status: todo
- needs: every other todo
- scope: run `/implement cleanup`; also delete `docs/agents-office-v3/spike/`
- done when: skill removed from the branch, spike folder removed, TODO.md archived, landing PR into feat/agents-office-v2 open and approved by the owner

## Backlog
- Whiteboard markers for `blocked` and `skipped` plan nodes (T28 draws both as `[ ]`).
- Draw the top 3 plan items on the whiteboard sprite (from T25-T33 plan).
- Walk cycles: generate a walk sheet with GPT /image (4 frames x 4 facings x 8 people), slice it with `npm run sprites`, and switch the page from the procedural leg cycle to frames.
- Floor and wall tile sheets to replace the CSS gradients.
- Page-local pets (corgi, mascot) with collision against props.
- Art cleanup: drop the `laptop-closed` near duplicate of `laptop-back`, remove the zzz mark from `corgi-sleep`.
- A remote player walked tile by tile instead of jumping on each presence write (from v2 D46).
- T04: wire `npm run sprites:check` into `smoke:renderer` (T05 used the script route instead of a smoke-renderer check).

## Log
2026-10-07 T02 #87 closed from the owner's Ghostty run (D18 confirmed, Image-in-elements=true, height-only resize re-renders per D23); Terminal.app probe not run, owner-skipped.
2026-10-07 T22-T24 #87 owner fixes: held-key walk 1 -> 2 tiles per 100 ms tick after the first (tween stays 100 ms); cat art faces left so the mirror is on right-facing; mid doors 5 -> 10 cells; ui.input hook answers itself (stale handle error); procedural walk cycle in the page.
2026-10-07 T03 #64 sprites, atlas, raw sheets and the slicer live in the repo; `npm run sprites` regenerates the 82 sprites and atlas.json byte-identical
2026-10-07 T05 #66 sceneArt.ts holds the sprite scale/anchor/layer table, personVariant, tierPlate and CELL_PX; deviation: smoke-renderer.mjs does not exist yet, so the atlas-vs-table check is `npm run sprites:check` (scripts/sprites/check-table.mjs)
2026-10-07 T01 #65 (a) reload, `return()` and `/exit` each ended node and Chromium (5 -> 0 processes in 3 s), `ui.close` alone did not (5 -> 5); (b) kill -9 left 5 processes for 15 s without the watchdog, 0 at t+1 s with ppid poll, stale heartbeat exit at 11 s; (c) 0 parse failures (`torn 0`) in 111 s at 10 writes/s of 20 KB; (d) `process.spawn` generator and `ui.blit` deny stubs work in `claude plugin test` (D19)
2026-10-07 T04 #68 playwright is a dependency; render.mjs, office.html and placeholder.png live in the mod renderer dir (screencast removed, `--state=` flag and `size: { w, h }` read added); `npm run smoke:renderer` prints `ok 608x368` and leaves no render.mjs or headless_shell behind
2026-10-07 T06 #67 scene.ts holds SceneModel and sceneOf (rooms, corridor, walls, doors, props, camera, night in world px = cells x CELL_PX); figures come in T07
2026-10-07 T20 #70 install-user.sh runs `npm ci` when node_modules/playwright is missing, then `npx --no-install playwright install chromium` unless `--no-chromium`, after linking (a Chromium failure exits 1 but keeps the link); uninstall-user.sh leaves the browser cache and prints its path. Scratch run against temp CLAUDE_CONFIG_DIRs after `rm -rf node_modules`: fresh install linked, ran npm ci, `playwright install --dry-run chromium` lists chromium-1243 under ~/Library/Caches/ms-playwright; re-run printed 'nothing changed'; `--no-chromium` skipped npm ci and the download; foreign link refused; uninstall removed only this link; ~/.claude untouched; shellcheck clean; npm run check 326 pass
2026-10-07 T07 #69 scene.ts maps figures (agents, remote agents, players, cat) with sprite, pose, plate, bubble/emote/chat (until > now), highlight, plus caption and sceneKey; SceneInput.player is now a Player (was Point)
2026-10-07 T08 #71 bridge.ts holds splitLines, parseLine, newestFrame, stateText, shouldWrite, clampCells and pixelsFor; render.mjs prints dir, ready, frame, fps and `error <code>` lines and reads the D5 state shape (keeps the last scene on torn JSON or a wrong `v`); smoke prints `dir -> ready -> frame`; D6 confirmed unchanged
2026-10-07 T09 #74 rendererLife.ts holds `next`, `classify` and `initialLife`; `renderer` and `scene` atoms declared inline; 3 exits in 60 s -> failed, no-node/no-playwright/no-chromium fail at once, `closed` -> off (a `failed` state stays failed), `classify` also reads render.mjs `error <code>` lines; backoff 1 s then 2 s (the 4 s step is unreachable while the 3rd exit within 60 s fails); the `renderer` atom gains `retryAt`
2026-10-07 T10 #72 office.html draws a SceneModel (rooms, walls, doors, signs, props, y-sorted figures, plates, bubbles, highlight, caption, night tint, eased camera, 100 ms step tween, `sceneBusy()`); sprite scale/anchor reach the page through `renderer/sprite-table.json`, written from sceneArt.ts by `npm run sprites:table` and checked by `smoke:renderer`; `smoke:renderer` takes a fixture path and `SMOKE_FRAME_OUT`; state-busy.json is real `sceneOf` output
2026-10-07 T11 #75 render.mjs paces frames (a frame only on a new seq or while sceneBusy, plus one settling frame, at most every 83 ms), follows `size` with setViewportSize, makes `agents-office-<session>-` (0700) with a `pid` file and sweeps siblings whose pid is dead, exits 0 on a heartbeat older than 10 s or a ppid change (1 s check), closes the browser and removes the dir on SIGTERM/SIGINT, and has `--once`, `--session=`; office.html camera ease is now time-based (25% per 1/60 s of elapsed time). Smoke: pass a: static fixture gave 1 frame, then none for 3 s; pass b: stale heartbeat (written 5 s old) exited 0 after 5348 ms, dir gone; pass c: exit 1, "error no-chromium browserType.launch: Executable doesn't exist at /nonexistent/chromium_headless_shell-1243/..." (T08's `/executable doesn't exist/i` matches, no change needed); also --once and the dead/live sibling sweep pass
2026-10-07 T12 #76 /office scene image|auto|text (default text, auto behaves as text until T13); image mode mounts the keyed Image from the first render, writes state.json (heartbeat 2 s) and spawns render.mjs --session --state via $.process.spawn behind a mktemp 0700 state dir; the loop calls return() on the stream on every exit, logs one 'renderer loop ended: <reason>' line per exit, and a same-size blit deny falls back to text (tmux always does, about 70 ms after ready, after a frame was written). LIVE default text: v2 office draws, no render.mjs spawned. LIVEIMG in tmux: frame-0.png shows the team room with main and you; 0 render.mjs/headless_shell after stop, no agents-office* temp dirs left. GHOSTTY owner check PENDING: run `cd W && claude --plugin-dir .claude/skills/agents-office` in Ghostty (not tmux), `/office scene image`, confirm the image office shows with the pad Input at the bottom-left not breaking the picture
2026-10-07 T13 #77 `auto` is the default (nothing stored = auto); a render with Image draws it at effective `probe` and a `$.clock.after(0)` closure blits placeholder.png as a file source: accepted -> image and the renderer starts, a deny -> text with `Image scene off: <deny text>` and nothing spawned; a deny that says no Image is mounted (or a size change) retries 5 x 200 ms and is never the verdict (Ghostty probe finding). `effectiveScene(want, probe, life)` in rendererLife.ts decides probe/image/text; a failed life (no-node via a spawn rejection before node printed, `error no-chromium`, 3 crashes) also gives text with the fix line. The reason is logged once, shown as the overlay for 8 s and appended to the `/office` reply; `/office scene auto|image` resets `failed` and re-probes. LIVE tmux default auto: v2 5x5 figures, overlay `Image scene off: the Image draws its alt here: the terminal draws no place...`, no render.mjs from this worktree. GHOSTTY and Terminal.app owner checks PENDING (plain `/office` in Ghostty shows the image office; Terminal.app shows the text office)
2026-10-07 T14 #78 the only product edits were two: `session.end` now cancels the tick timer and calls `stopRenderer` (the tick is the only starter, so nothing restarts it), and `ensureRenderer` returns when the tick timer is gone (an in-flight tick cannot start a renderer after session.end). The rest of the scope already held (the tick starts one renderer when a reloaded module sees a drawn pane; `rendererLoop` is the one-per-session guard; render.mjs sweeps dead sibling dirs and exits on ppid change), so `render.mjs` is unchanged. Office tests: a second start request while running spawns nothing (2 node starts requested by `/office scene image`, 6 ticks, 1 `node`, 1 `mktemp`); session.end closes the stream, removes the state dir, and later ticks spawn nothing. MEASURED on a scratch COPY of the mod (`--plugin-dir` outside the repo, `node_modules` symlinked) because in tmux every blit is denied ("the Image draws its alt here ... (probe: no reply to the graphics query)") and T12 then stops the renderer ~70 ms after ready; the copy differs only by `isFinalDeny` returning false (a deny is retried, not final) and a `/office closeit` command that calls `$.ui.close({ id })` (the tmux click on the pane mark was not delivered). Claude ran under `env -u TMUX -u TMUX_PANE -u STY sh -c 'claude ...; sleep 120'` on `tmux -L aov3`. Counts are `pgrep -fl <copy>/renderer/render.mjs` and `pgrep -P <node pid>` (1 child = the Chromium parent; `headless_shell` total is 4 for the owner's own renderer plus 4 per renderer here): running 1 node (pid 36304, 1 child); `/reload-plugins` #1 +3 s and +9 s: 1 node (pid 36717, 1 child, the old pid gone); `/reload-plugins` #2 +4 s and +10 s: 1 node (39469, 1 child); pane closed with `$.ui.close` +3 s: 0 node, headless_shell total 8 -> 4 (log: `renderer stop requested by ui.close`, `loop ended: closed while reading`); reopened, then `kill -9` of the claude pid (under sh): +1 s, +5 s, +12 s all 0 node and headless_shell total 4; LIVE2 (two sessions, `/office scene image` in both): 2 node (46526, 46593), 1 child each, headless_shell total 12, 2 different `agents-office-<session>-` dirs, and `/exit` in both left 0 node and no temp dir of ours; sweep: a planted `agents-office-deadbeef-ZZZZZZ/pid` = 99999 (no such process) was gone after the next renderer started, the owner's live-pid dir was kept. Observed, not changed: after `/reload-plugins` the debug log shows `ui.input hook skipped: threw ... no handler is held under handle 9` once (the old module's pad handler) and macOS `mktemp -d -t agents-office-state.XXXXXX` makes `agents-office-state.XXXXXX.<rand>` (works, the template is not substituted). Review follow-ups not done: `session.end` does not await the loop's cleanup (live: temp dirs were gone after /exit, the renderer watchdog covers the rest); no test holds a tick across session.end. Still open: the in-real-Ghostty reload/close counts, because tmux cannot show a kept image. 
2026-10-07 T15 #79 seated agents use the back view in the chair (SEAT lift 12, desk foot 34) with the desk and monitor behind (D21); desks scaled to 1.5 so the 72 px pitch no longer overlaps; shared rooms hold two rows of furniture, the corridor holds plants, a sofa, a water cooler and clocks; render check from real sceneOf output at 608x187 (80x24 pane) and 928x391 (120x40 pane): every seated head visible, cat drawn and mirrored by facing; tests pin the seat offsets; GHOSTTY acceptance pending
2026-10-07 T16 #80 every pad key checked against the image scene by 7 office tests that write state.json and assert the scene (wasd position and facing, `]`/`[` jump with the player inside the camera window, `1`-`4` emotes ending after 3 s, `e` highlight plus caption for 6 s, `E` peek pane, `t` draft caption then chat bubble with the player unmoved, `m`/`x` dialogs). One gap found and fixed in `sceneOf`: the pad sends U+25C6 and `~` for keys 3 and 4 (the Raster cannot draw U+2665/U+266A), so `emoteArt` maps them to U+2665 and U+266A for the page; `!` and `?` pass through. The page needed no change (the real glyphs render, checked zoomed). LIVEIMG REPLACED by fixture frames: in tmux every blit is denied and T12 then stops the renderer, so no frame exists on disk after keys. The fixtures are the state.json text the office test writes after the simulated keys `dddd`, `]`, `[` then `3`, and `e` (real `sceneOf` output), rendered with `SMOKE_FRAME_OUT=<png> npm run smoke:renderer -- <fixture>` at 608x391: dddd moves 'you' 4 tiles right and turns it right, `]` puts 'you' in Reception, `3` shows a heart above 'you', `e` outlines the figure and writes `main | working | idle | office | 0s` as the caption bar. Not checked: a chat bubble and the note glyph together in one frame came from an edited fixture (emote plus chat both show; v2 text shows only the chat). GHOSTTY owner check PENDING: walk with WASD, `]`/`[`, press 1-4, `e`, `t` + Enter, `m`, `x` in `cd W && claude --plugin-dir .claude/skills/agents-office` and confirm each shows in the image office
2026-10-07 T17 #81 no gap in `sceneOf` or the page for other sessions: 3 remote records give rooms in `startedAt` order (own first) with `remote` agent and player figures, `Session N` plates for anon records (N = room order), and a remote player's emote and chat; a tombstone (or a dropped file) removes the room and its figures within 5 s and renumbers the later `Session N`. Two scene/office tests pin this (scene.test.ts with `orderedTeams`/`remoteRoster`/`remotePlayersOf`; office.test.ts through fs.list/fs.read presence stubs in image mode, tombstone read in 5 s). T16 follow-up fixed in the page: a figure with both chat and emote stacks them (chat above emote above plate, DOM order already so) but the chat bubble's 7 px tail overlapped the emote; `.bub` gets `margin-bottom: 6px` (v2 shows only the chat; v3 keeps both). LIVE2 REPLACED by fixture frames: in tmux every blit is denied and T12 then stops the renderer, so no frame exists on disk; the fixtures are the state.json text the office test wrote (real `sceneOf` output, 608x391) rendered with `SMOKE_FRAME_OUT=<png> npm run smoke:renderer -- <fixture>`: all 4 team rooms (proj, alpha (main), Session 3, Session 4) show their agents, the two remote players with the heart and `hello from alpha` stacked clear of the plate, and after the tombstone only 3 rooms remain with `Session 3` renumbered. No FAKES presence files were written. GHOSTTY two-session owner check PENDING: run `claude --plugin-dir .claude/skills/agents-office` in two Ghostty windows, `/office` in both, and confirm each pane shows the other's team room, agents and player
2026-10-07 T18 #82 measured idle/walking CPU, fps and PNG size with a scratch driver against render.mjs on the owner's Mac at 608x187, 928x391 and 2040x748 (table in D22): before the change only 2040x748 walking was over D13 (44% vs 40%); the screenshot now goes through CDP `Page.captureScreenshot` (`optimizeForSpeed` above 1,000,000 viewport pixels, 2040x748 walking 44 -> 32), the renderer stops asking the idle page for `sceneBusy` every 50 ms and the page stops redrawing on every animation frame while idle (idle static 11-13 -> 6-7); final: idle 6-11%, walking 28-32%, static scene 0 frames in 30 s, 7 fps walking; `npm run smoke:renderer` passes; GHOSTTY walking smoothness pending (owner)
2026-10-07 T19 #83 resize follows in both axes: render -> viewport atom -> tick -> `size` in state.json (columns*8 x rows*17) -> renderer viewport; D23 records the T02 finding (height-only resize re-renders in tmux and Ghostty) so no workaround exists; `writeKeyOf` guards a resize against waiting for the heartbeat (the scene text already changes with the box); below 60x11 the size line shows, no new seq is sent (no frames) and `holdRenderer` keeps the heartbeat so the renderer lives. LIVEIMG tmux resize frames were replaced by a direct render.mjs run because tmux denies blits, so the Image/renderer loop stops there (D20) and no resized frame is ever written in a tmux session; the state-size half is covered by office tests (box -> state.json size) and the PNG half by a scratch driver that feeds render.mjs `size` 608x187 -> 928x391 -> 560x187 with the state-busy fixture: `file` gave PNG 608 x 187, 928 x 391, 560 x 187, and 4 s of same-seq heartbeat rewrites produced 0 frames; renderer exited 0 on SIGTERM with no process left. GHOSTTY height-only drag pending (owner)
2026-10-07 T21 #84 README gains the Chromium install step and `--no-chromium`, `/office scene auto|image|text`, an "Image office" section with the fallback reasons, image-office requirements, v3 known limits and the develop commands; `docs/images/office-image-120x40.png` is a 928x391 frame from real `sceneOf` output (one team room with 3 agents, a Test Lab agent, the corridor and 5 shared rooms) rendered by `SMOKE_FRAME_OUT=<png> npm run smoke:renderer -- <fixture>` (72 KB). WezTerm and iTerm2 are listed as untested and kitty as expected from the API docs only (no D-entry covers them). T02 stays `todo`: its Decisions record the tmux results (D20) and the height-only resize in Ghostty (D23), but no D-entry records Image-in-elements for Ghostty or the D18 Input check, and the Terminal.app probe was not run
2026-10-07 T25-T33 planned: Decisions D24-D30 and nine interaction todos (desk peek, whiteboard, server rack, coffee, sofa, water cooler, cat pet, hint) added; D27 and D28 stay assumed until T25
2026-10-07 T25 #86 spike in a scratch plugin (not committed) run LIVE in tmux -L aot25 with both mods: cross-plugin read of the todo-list `plan` atom typechecks, validates, is `undefined` without a plan and redraws the pane on every plan change; `session.measure` and `$.session.usage()` give `context.percent` 7 and `cost.usd` 0.383951 after one prompt (absent / 0 before); `$.agent.list()` showed `Explore:running` then `Explore:completed`; D27 and D28 confirmed with the amendments written in them
2026-10-07 T26 #88 hooks/items.ts holds ITEM_KINDS (table order = tie order), ITEMS (label, sprites, foot) and `itemsOf(map)`: one desk per team anchor (rect = the map footprint at the anchor) plus one item per whiteboard, coffee-machine, sofa, water-cooler and server-rack prop from the exported `propsOf`, rect in cells clamped inside its room or the corridor (1 whiteboard, 1 coffee, 1 sofa, 2 coolers, 2 racks on every map size tried); item footprints are guesses (whiteboard 6x2, sofa 6x2, coffee 3x2, cooler 2x2, rack 3x2) until the art is seen at GHOSTTY; 9 tests; mutation check: emptying the rack sprites failed 2 tests; review (sonnet) found 4 Medium test gaps (clamp, x placement, room per kind, table order), all closed
2026-10-07 T27 #89 hooks/use.ts holds `targetOf` (agent target = the v2 `nearest` at the smallest range that finds one, so the inspect path is untouched; cat and items = rectangle gap <= 1 against the player body; sort by gap, agent > cat > item, table order, lower x, id), `rectGap`, `deskOwner` (resting at the anchor, else a path ending there, lower id) and `hintOf` (`e: <item label>`, `e: inspect <label>`, `e: pet the cat`); the small-foot agent gap is top-left Manhattan while item and cat gaps are rectangle gaps, so an agent 2 cells away loses to a touching item (kept, per D24); 11 tests, mutation check: swapping the tie rank failed the agent > cat > item test; review (sonnet) found 3 Medium test gaps (range edge, desk row, cat footprint on mid), all closed; note `targetOf` also exists in motion.ts with another meaning (path end), so import by module
2026-10-07 T28 #90 use.ts gains `outcomeOf` (agent -> inspect, cat -> pet, whiteboard -> board, rack -> rack, coffee -> act mug until now + MUG_MS 8000, sofa -> act sit, cooler -> say COOLER_LINES[seed % 8], own desk -> peek of its owner or `Empty desk.`, remote desk -> `<room name>'s desk` with no peek), `boardLines` over `BoardNode[]` (the todo-list plan nodes fit; `nodesOfTodos` adapts TodoWrite; tree order, `[x]` `[>]` `[ ]`, two spaces per level, first PEEK_MAX 10, a parent cycle shown as roots, `No plan yet.` when empty), `rackLines` (context, cost, running and idle counts from `status` only, own agents with tool names, ids with a colon skipped as remote, capped at PEEK_MAX with `+N more`, `-` for a missing or non-finite value) and `settleAct` (mug ends at now >= until, a move clears sit); `Act`, `Outcome`, `UseCtx`, `MUG_MS`, `PET_MS` exported for T29-T32; 21 tests in use.test.ts, mutation check: `now > until` failed the settleAct test; review (sonnet) found 4 Medium (remote-keyed rack entry, cycle handling, unsanitised text untested, duplicate id), all fixed; blocked and skipped plan nodes draw as `[ ]` (no marker in the spec)
2026-10-07 T29 #91 `SceneInput` gains `act` (the use.ts `Act`), `catPetUntil` and `hint`; the own player figure gets `holding: 'mug'` while a mug act has `until > now`, or `pose: 'seated'`, facing down, on the nearest sofa prop's foot line (x clamped 13 px around the sofa centre, `z` = the sofa foot line, so the figure sorts over the sofa and the page draws the seat again over the legs in T30); the cat gets the emote U+2665 while `catPetUntil > now`; `captionOf` is chat draft, then inspect or action line, then hint; `sceneKey` is the model JSON so each changes it; 5 tests; mutation check: leaving the seated y at the player's own y failed the sit test; review (sonnet): no Medium+, low notes: the sofa is picked without a distance cap and the 13 px slack is sized for the small sprite

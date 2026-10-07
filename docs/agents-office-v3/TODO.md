# Agents Office v3: an image office drawn by headless Chromium

ultraplan: agents-office-v3 | branch: feat/agents-office-v3 | base: feat/agents-office-v2 | tag: pre-agents-office-v3-feat-agents-office-v2 | created: 2026-10-07
Status: ACTIVE
Progress: 9/22 done

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
- D7 Temp dir and watchdog. The renderer makes `mkdtemp(<os.tmpdir()>/agents-office-<sessionId>-)` (0700), prints it as `dir`, writes `pid` into it, and removes it on SIGTERM/SIGINT. At start it removes sibling `agents-office-*` dirs whose `pid` is not alive. The renderer exits on its own when `state.json`'s `heartbeatAt` is more than 10 s old or `process.ppid` changes. The plugin rewrites the heartbeat at least every 2 s. This covers paths where nobody sends SIGTERM (kill -9, crash). (planner, 2026-10-07) T01: after kill -9 of claude, node (ppid 1) and its 4 Chromium processes stayed alive for the whole 15 s watched (5 processes), so the watchdog is needed. With a 1 s `process.ppid` poll node closed Chromium within 1 s (0 processes at t+1 s). With claude frozen by SIGSTOP (ppid unchanged), the stale-heartbeat check ended it 11 s after renderer start. Test caveat: if the pane's only process dies, tmux sends SIGHUP to the whole group and hides the orphan, so run claude under `sh -c 'claude ...; sleep 120'` and kill -9 the claude pid. | watchdog confirmed T01; temp dir, pid file and sweep assumed, confirm by T14
- D8 Geometry: the image scene draws the v2 `OfficeMap` (same `buildOffice`, BFS, motion, player tiles, `viewFor`/`focusOf` camera) in world pixels, with `CELL_PX = { w: 8, h: 17 }` from the spike's box.ts. Every atom and rule stays shared by both paths. The page tweens each tile step and eases the camera. The renderer viewport is the Image box in pixels: columns x 8 by rows x 17, each axis capped at 2048. (planner, 2026-10-07) | assumed, confirm by T15
- D9 Figure looks: person variant = FNV-1a hash of the figure key (the v2 D6 key) mod 8 -> `person1`..`person8`. Tier = nameplate colour (the v2 D6 shirt colours). Status: done/leaving draws at 60% opacity, idle draws no work prop. The player is a fixed variant with the plate `you`. Facing picks the `-down/-left/-right/-up` sprite. (planner, 2026-10-07) | assumed, confirm by T06, T15
- D10 Mode switch: `$.store` key `scene` = `auto|image|text`, set by `/office scene <mode>`. `parseOfficeArgs` (presence.ts:36) gains a `scene` kind next to `share`. `text` is v2 only. `image` is forced: no probe, but the crash ladder still falls back, so LIVEIMG can make frames in tmux. `auto` probes (D11). The default is `text` until T13, then `auto`. The `scene` atom = `{ want, effective: 'probe' | 'image' | 'text', reason? }`. (planner, 2026-10-07) | assumed, confirm by T12, T13
- D11 Detection, with no terminal-name sniffing. Image-capable means the render resolved `Image` in `$.ui.resolve(e)` (terminal surface only, d.ts 1332-1338, 3700-3722) and a probe blit of `renderer/placeholder.png` as a file source is not denied. Any probe deny (the alt case, or a file this terminal cannot read, as across ssh; d.ts 2290-2293, 5159-5165, 12977-12986) switches to text, with the deny text as the reason. A deny while running does the same. Chromium is never spawned before the probe passes. (planner, 2026-10-07) | assumed, confirm by T02, T13
- D12 Lifecycle. The renderer starts when `effective` is `image` and the Office pane is drawn (viewport not 0x0). It stops on `ui.close` of the pane (the loop calls `return()`) and on module unload (d.ts 3420-3422). There is one per session: a module-scope stream handle, like the timer handles, guarded by the `renderer` atom `{ status: 'off' | 'starting' | 'running' | 'backoff' | 'failed', dir?, exits: number[], reason? }`. A crash restarts after 1 s, 2 s and 4 s. A 3rd exit within 60 s sets `failed` and text mode until `/office scene image|auto` or the next session. A reloaded module whose pane is drawn starts its own renderer once (the D73 pattern). (planner, 2026-10-07) T01 stop paths: `/reload-plugins` after an edit sends the node child SIGTERM (0 processes 3 s later, 3 of 3 reloads); calling `return()` on the stream iterator sends SIGTERM (0 processes after 3 s); `/exit` does too (0 after 3 s). `$.ui.close` alone does NOT stop the child (5 processes 3 s later), and leaving the read loop without `return()` leaves it running, so `return()` must run on close and on every loop exit (the spike's deny give-up leaked this way). Close was tested with a plugin `$.ui.close` (tmux cannot click the close mark). | stop paths confirmed T01; crash backoff assumed, confirm by T09, T14
- D13 Performance budget: at most 12 fps while something moves (a tween, the camera, a bubble or emote appearing or expiring). At most 1 fps for idle animation (seated typing toggle). No frame at all when the page reports no change. CPU (node + Chromium, `ps` sampled over 30 s on the owner's Mac at 120x40): under 15% of one core idle and under 40% while walking. (planner, 2026-10-07) | assumed, confirm by T18
- D14 `render.mjs` and `office.html` stay outside tsc. tsconfig has `lib: es2023` and `types: []`, and adding DOM and node types would leak into the hooks. Logic that can be pure lives in TS: `scene.ts`, `sceneArt.ts`, `bridge.ts`, `rendererLife.ts`. The page is a thin drawer of the scene model. (planner, 2026-10-07) | assumed
- D15 Assets. Generated sprites and `atlas.json` go to `.claude/skills/agents-office/renderer/sprites/`. The raw sheets go to `assets/sprites/raw/` (outside the mod folder, so the user-wide link does not ship them). `slice.mjs` and `lib.mjs` go to `scripts/sprites/`. pngjs becomes a devDependency, and `npm run sprites` regenerates. (planner, 2026-10-07) | assumed, confirm by T03
- D16 `playwright` is a `dependencies` entry of the repo-root package.json. Node resolves imports from the real path of `render.mjs`, so the user-wide symlink install still finds `<checkout>/node_modules/playwright`. (planner, 2026-10-07) | assumed, confirm by T04, T20
- D17 Overlays: the inspect line, the chat draft (`Say: ..._`) and a renderer reason are drawn inside the scene as a caption bar at the view's bottom. Speech bubbles, emotes and chat bubbles are HTML bubbles above figures. Log strip rows (when the body has any) stay as Text under the Image. (planner, 2026-10-07) | caption bar and HTML bubbles confirmed T10 (the caption sits at the bottom of the camera window, not scaled with the world; tags draw above every figure); log strip and renderer reason assumed, confirm by T15
- D18 In image mode the pad Input sits like v2 (`position="absolute" bottom={0} left={0}` over the Image's bottom-left) if T02 shows it draws over an Image without breaking the picture. Otherwise it goes on its own row under the Image, which then gets bodyRows - 1. (planner, 2026-10-07) | assumed, confirm by T02
- D19 Test stubs work in `claude plugin test`: `on('process.spawn', async function* () { yield { stream: 'stdout' as const, text: 'ready\n' }; return { value: { code: 0, signal: null } } })` and `on('ui.blit', (_$, e) => ({ deny: 'x' }))` (`({ value: {} })` allows). End the spawn hook with `{ value }`, because a bare `{ code, signal }` return logs "returned neither { value } nor { deny }" (yielded chunks still arrive). Stub every other call the code makes (`clock.every`, `ui.open`, `ui.log`, `command.register`): an unstubbed one is refused ("no implementation for clock.every") and the test fails. Ran `claude plugin test` on the scratch imgspike: the stub test passed, and the one failure was an old test broken by a `$.clock.every` I added. (T01, 2026-10-07) | confirmed T01

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
- status: todo
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
- status: todo
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
- status: todo
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
- status: todo
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
- status: todo
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
- status: todo
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
- status: todo
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
- status: todo
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
- status: todo
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
- status: todo
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
- status: todo
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
- status: todo
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

### TZZ Cleanup and land
- status: todo
- needs: every other todo
- scope: run `/implement cleanup`; also delete `docs/agents-office-v3/spike/`
- done when: skill removed from the branch, spike folder removed, TODO.md archived, landing PR into feat/agents-office-v2 open and approved by the owner

## Backlog
- Walk cycles: generate a walk sheet with GPT /image (4 frames x 4 facings x 8 people), slice it with `npm run sprites`, and switch the page from bob to frames.
- Floor and wall tile sheets to replace the CSS gradients.
- Page-local pets (corgi, mascot) with collision against props.
- Art cleanup: drop the `laptop-closed` near duplicate of `laptop-back`, remove the zzz mark from `corgi-sleep`.
- A remote player walked tile by tile instead of jumping on each presence write (from v2 D46).
- T04: wire `npm run sprites:check` into `smoke:renderer` (T05 used the script route instead of a smoke-renderer check).

## Log
2026-10-07 T03 #64 sprites, atlas, raw sheets and the slicer live in the repo; `npm run sprites` regenerates the 82 sprites and atlas.json byte-identical
2026-10-07 T05 #66 sceneArt.ts holds the sprite scale/anchor/layer table, personVariant, tierPlate and CELL_PX; deviation: smoke-renderer.mjs does not exist yet, so the atlas-vs-table check is `npm run sprites:check` (scripts/sprites/check-table.mjs)
2026-10-07 T01 #65 (a) reload, `return()` and `/exit` each ended node and Chromium (5 -> 0 processes in 3 s), `ui.close` alone did not (5 -> 5); (b) kill -9 left 5 processes for 15 s without the watchdog, 0 at t+1 s with ppid poll, stale heartbeat exit at 11 s; (c) 0 parse failures (`torn 0`) in 111 s at 10 writes/s of 20 KB; (d) `process.spawn` generator and `ui.blit` deny stubs work in `claude plugin test` (D19)
2026-10-07 T04 #68 playwright is a dependency; render.mjs, office.html and placeholder.png live in the mod renderer dir (screencast removed, `--state=` flag and `size: { w, h }` read added); `npm run smoke:renderer` prints `ok 608x368` and leaves no render.mjs or headless_shell behind
2026-10-07 T06 #67 scene.ts holds SceneModel and sceneOf (rooms, corridor, walls, doors, props, camera, night in world px = cells x CELL_PX); figures come in T07
2026-10-07 T20 #70 install-user.sh runs `npm ci` when node_modules/playwright is missing, then `npx --no-install playwright install chromium` unless `--no-chromium`, after linking (a Chromium failure exits 1 but keeps the link); uninstall-user.sh leaves the browser cache and prints its path. Scratch run against temp CLAUDE_CONFIG_DIRs after `rm -rf node_modules`: fresh install linked, ran npm ci, `playwright install --dry-run chromium` lists chromium-1243 under ~/Library/Caches/ms-playwright; re-run printed 'nothing changed'; `--no-chromium` skipped npm ci and the download; foreign link refused; uninstall removed only this link; ~/.claude untouched; shellcheck clean; npm run check 326 pass
2026-10-07 T07 #69 scene.ts maps figures (agents, remote agents, players, cat) with sprite, pose, plate, bubble/emote/chat (until > now), highlight, plus caption and sceneKey; SceneInput.player is now a Player (was Point)
2026-10-07 T08 #71 bridge.ts holds splitLines, parseLine, newestFrame, stateText, shouldWrite, clampCells and pixelsFor; render.mjs prints dir, ready, frame, fps and `error <code>` lines and reads the D5 state shape (keeps the last scene on torn JSON or a wrong `v`); smoke prints `dir -> ready -> frame`; D6 confirmed unchanged
2026-10-07 T10 #72 office.html draws a SceneModel (rooms, walls, doors, signs, props, y-sorted figures, plates, bubbles, highlight, caption, night tint, eased camera, 100 ms step tween, `sceneBusy()`); sprite scale/anchor reach the page through `renderer/sprite-table.json`, written from sceneArt.ts by `npm run sprites:table` and checked by `smoke:renderer`; `smoke:renderer` takes a fixture path and `SMOKE_FRAME_OUT`; state-busy.json is real `sceneOf` output

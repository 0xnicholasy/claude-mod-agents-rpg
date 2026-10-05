# Agents Office v2: people, real rooms, WASD and one shared office

ultraplan: agents-office-v2 | branch: feat/agents-office-v2 | base: feat/agents-office | tag: pre-agents-office-v2-feat-agents-office | created: 2026-10-05
Status: ACTIVE
Progress: 12/26 done

## Goal
Every agent reads as a person. Each is a 3x2-cell half-block figure with hair, skin, a tier-colored shirt and role-colored pants. It faces the way it walks and sits at its desk while reading or editing.
The office has one team room per running Claude session, labelled `<project> (<branch>)`, plus a shared Reception, Conference Room, Kitchen, Test Lab and Phone Booths. Every session on the machine shows the same rooms and people, read from presence files.
When the pane has focus, WASD walks a player avatar. The player can emote, jump rooms, inspect, chat, peek, nudge and interrupt. The mod installs user-wide and loads once per session.

## Constraints
- Base `feat/agents-office`. One landing PR at the end, merged by the owner. Retarget it to `main` once PR #18 has merged. Never merge PR #18. (owner)
- Claude Code 2.1.289. The API authority is `vendor/claude-code/claude-code.d.ts`, which is never edited. Line numbers in this file cite it.
- npm, TypeScript strict. No emoji in code. No `any`/`unknown` without a comment that justifies it (`$.store.get`, `JSON.parse` and `SendMessage.to` need one). Never use `// eslint-disable`.
- State lives in `$.state` atoms, declared inline under `'agents-office'` in `types/index.d.ts` (validate refuses aliases). Module variables hold only timer handles and log de-dup caches (v1 D25, v1 D49).
- All `$` code stays in `register.tsx`, because `$` cannot cross an import. Every other module is pure and tested directly.
- Render cannot write state; it writes through a `$.clock.after(0)` closure (v1 D20). The `ui.input` hook is not a render, so it may write.
- `hooks.json` allows one module. There is one `on('session.start')`; new start-up work goes inside it, each piece in its own `guard`.
- Raster limits: at most 1024 color pairs, width-1 BMP glyphs only, no sextants (U+1FB00). Each frame stays under 256 pairs, enforced by a test.
- Keep the 3x2 footprint, the v1 D27 map contract, the 11-row compact map (v1 D51) and BFS.
- At 80x24 the inline body is 11 rows, so the strip has 0 rows. Every text feature needs a no-strip path.
- Privacy: presence never carries prompts, tool arguments, tool names, file paths, SendMessage text or transcripts.
- Presence: each session writes only `<dir>/<sessionId>.json`, using absolute paths. `$.fs.write` creates directories. There is no fs delete; old files are removed only by the start-up `find -delete`.
- Gate: `rtk proxy npm run check` (validate + typecheck + `claude plugin test`). Validate and test run locally only; CI runs typecheck. If plugin test reports "hooks modules are turned off", apply the v1 D18 fix.
- `<worktree>` is the feat/agents-office-v2 worktree. LIVE means: `tmux new-session -d -s ao -x 80 -y 24 -c <worktree> claude; sleep 6; tmux send-keys -t ao '/office' Enter; sleep 4; tmux capture-pane -p -e -t ao`, then the todo's extra keys, then `tmux kill-session -t ao`. LIVE2 adds a second session, `ao2`, the same way.
- FAKES (multi-team checks without extra sessions): a shell loop rewrites N fake presence records with a fresh `heartbeatAt` every 2 s. Delete the fake files afterwards.
- Every merge leaves the branch green and `/office` usable. `register.tsx` and `office.test.ts` are hot spots, so the todos that touch them form one chain.
- Implementation goes to a `sonnet` agent. The doc to update is README.md (T25 only).

## Decisions
- D1 Order: looks (sprites, then rooms), then WASD and interactions, then the shared office, then extras, then user-wide install and README. (owner, 2026-10-05)
- D2 Install user-wide. Each session loads the mod once, not twice. (owner, 2026-10-05)
- D3 Land once at the end into `feat/agents-office`, because PR #18 into main is still open. Retarget the landing PR to main after #18 merges. (owner, 2026-10-05)
- D4 "Same office" means the same rooms and the same people in every pane. Each pane lays them out for its own size and animates them locally from presence data that updates about once a second. Panes are not pixel-identical. Room order is `startedAt`, then session id. (owner, 2026-10-05)
- D5 Figures are drawn with half-blocks (U+2580, fg = top pixel, bg = bottom pixel): 3x4 pixels in the 3x2 footprint. A `.` pixel takes the room's floor color at compose time. This supersedes v1 D28 (TRANSPARENT/overlay). v1 D27, v1 D51 and BFS are unchanged. (planner, 2026-10-05) | assumed, confirm by T04
- D6 Figure colors. Shirt = tier (haiku 0x4fc3f7, sonnet 0x66bb6a, opus 0xffb74d, fable 0xba68c8, grey 0x9e9e9e; player 0xf5f5f5). Pants = role (lead 0x263238, dev 0x2f4a7a, research 0x7a6a4f, review 0x5e3a6e). Hair (5 tones) and skin (4 tones) = FNV-1a hash of the figure key: the agent id locally, `sessionId:agentId` for remote agents, the sessionId for a player. Role: main = lead; a subagent type containing "review" = review; containing explore, research or search = research; anything else = dev. A roster entry with no role draws as dev. (planner, 2026-10-05) | assumed, confirm by T04
- D7 Pair budget: a test proves a 32-figure crowd (every tier, role, pose and facing, on every room-floor kind) stays under 256 pairs. If it does not, the hair palette shrinks first. The hard limit stays 1024 (v1 D6). (planner, 2026-10-05) | assumed, confirm by T04, T16, T21
- D8 Facing comes from the next path step; a resting agent faces down. The `motion` atom keeps its shape, and walk frames cycle 0-3. The player keeps its own facing in the `player` atom. (planner, 2026-10-05) | assumed, confirm by T04
- D9 read and type are a seated pose at the agent's own team-room desk. The desk (0x8d6e63) and monitor (0x81d4fa) belong to the seated figure, not to map tiles. run, call and talk are standing poses with a prop in the top-right cell. (planner, 2026-10-05) | assumed, confirm by T03
- D10 Rooms. `RoomId = 'reception' | 'conference' | 'kitchen' | 'lab' | 'booths' | team:${string}`. Signs: Reception, Conference, Kitchen, Test Lab, Booths; full names go in log lines. Bottom-band base widths at 60 columns are 12/12/10/10/10 (54 interior). Team rooms have equal widths, at least 11 interior columns, desks 5 cells apart, and the lead at the first desk. Shared rooms keep the v1 4-cell anchors. Band heights follow v1 D51; I read the brief's "2-row corridor" as the compact value. Each room kind has one floor color (6 colors). (planner, 2026-10-05) | assumed, confirm by T05
- D11 Activity mapping:
  - Read, Grep, Glob, NotebookRead, LSP and MCP resource reads: own desk, read pose.
  - Edit, Write, MultiEdit, NotebookEdit and unknown tools: own desk, type pose.
  - Bash, BashOutput, KillShell, Monitor: lab, run.
  - WebSearch, WebFetch and fetch/http/search MCP tools: booths, call.
  - Agent, TaskStop: reception, talk.
  - SendMessage: conference meet (v1 D38-D40 with the room renamed).
  - Spawns enter at the Reception door and walk to a team desk.
  - Reports happen in Reception, then the agent goes to the Kitchen and leaves (v1 D15 with Kitchen in place of Break Room).
  - Hot-reload migration on the first tick maps v1 room ids: lobby to reception, meeting to conference, break to kitchen, server to lab, phone to booths, devbay and library to the own team room.
  (planner, 2026-10-05) | assumed, confirm by T06
- D12 The team id is `team:<$.session.id()>`. The label is `basename(cwd) (<branch>)`, with the branch from `git -C <cwd> branch --show-current`. An empty result or a failed run gives the basename alone. Sessions with the same label get " 2", " 3" in room order. (planner, 2026-10-05) | assumed, confirm by T07, T16
- D13 Pad.
  - Focus follows spike S1b: `PAD_FOCUS_MS` = 1500. Running `/office` again re-focuses the pad.
  - One pure `applyKeys` in `pad.ts` dispatches every key, so later keys need no `register.tsx` edit. W/A/S/D in either case move the player; `E` is reserved for peek.
  - `INTENT_MS` = 250. A tap always moves exactly one tile. A held key moves one tile per tick while the intent is fresh.
  - The player walks through agents. Walls block via `canStand`.
  - The Input sits over a wall cell at the bottom-left, as narrow as possible, so it does not hide bottom-room figures at 11 rows.
  (planner, 2026-10-05) | assumed, confirm by T08, T09
- D14 Player: white shirt, lead pants, plate "you". It spawns at the own team-room doorStand and is reseated like v1 D31 when the map no longer fits it. (planner, 2026-10-05) | assumed, confirm by T09
- D15 Emotes: 1 `!`, 2 `?`, 3 U+2665, 4 U+266A, shown for 3000 ms. A glyph that `isValidGlyph` refuses becomes `*`. (planner, 2026-10-05) | assumed, confirm by T10
- D16 Inspect.
  - Target: the nearest agent by Manhattan distance between footprint origins, at most 2 tiles; ties go to the lower id.
  - Text: `label | status | tool | room | elapsed`, shown for 6000 ms. elapsed counts from `seenAt`; remote agents show their pose instead of a tool.
  - Own agents also show the last 60 characters of their last text from `$.session.messages`.
  - Placement: the newest strip line. With 0 strip rows it draws over the corridor's first row.
  (planner, 2026-10-05) | assumed, confirm by T12
- D17 Presence dir = `<CLAUDE_CONFIG_DIR>/agents-office/presence`, else `<HOME>/.claude/agents-office/presence`. Both come from `printenv` through `$.process.run`, once. Before they resolve, or if both are empty, nothing reads or writes. (planner, 2026-10-05) | assumed, confirm by T13
- D18 Presence cadence.
  - One `$.clock.every(1000)` presence timer both writes and reads.
  - It writes when the record text changes or 3000 ms after the last write.
  - Tombstone: `{ v, sessionId, heartbeatAt, gone: true }`.
  - `lastText`, `lastWriteAt` and per-file mtimes live in a `presence` atom.
  - Staleness compares `heartbeatAt` with `$.clock.now()` against 10000 ms.
  (planner, 2026-10-05) | assumed, confirm by T14, T15
- D19 The share preference is `$.store` key `share`, default `all`, set by `/office share all|anon|off` (`e.args`). Bare `/office` opens the pane. `off` writes one tombstone, then stops writing, stops reading and clears `remote`. (planner, 2026-10-05) | assumed, confirm by T13
- D20 Remote records live in a `remote` atom keyed by sessionId. Their agents become `motion` entries keyed `sessionId:agentId`, walked by the local `assignTarget`/`step`. They are never subject to local expire or choreography, and are removed at once when absent from their record. (planner, 2026-10-05) | assumed, confirm by T16
- D21 Overflow: from T16 until T18, teams that do not fit at minimum width are hidden. The own team is always kept, and a `+N` mark sits at the right end of the top band. T18 replaces this with shrink-then-camera. (planner, 2026-10-05) | assumed, confirm by T18
- D22 Anon. The writer strips the team label and branch and sets agent labels to their role (T14). The reader shows "Session N", where N is the 1-based room order (T17). Your own pane still shows your own names. (planner, 2026-10-05) | assumed, confirm by T17
- D23 Chat: `t` enters chat mode. Typed characters build a draft until Enter (`onSubmit`). The text is passed through `clean`, cut to 40 characters, shown for 5000 ms and published in `player.chat`/`until`. An empty submit cancels. (planner, 2026-10-05) | assumed, confirm by T20
- D24 Cat: local to each pane, never published. It wanders the shared rooms on a seeded pseudo-random walk and rests 5-15 s. Day/night: 20:00-06:00 local time darkens map colors (floor, wall, door, sign) by 35%. `.` pixels follow the tinted floor; figure colors are untouched. (planner, 2026-10-05) | assumed, confirm by T21
- D25 Peek/nudge/interrupt.
  - `E` opens pane `office-peek` (not focused) with the last 10 text messages of the nearest own agent.
  - `m` asks `['No', 'Yes']`, then `$.session.send({ to: { agentId }, text: NUDGE_TEXT })` to the nearest own non-main agent.
  - `x` asks `['No', 'Yes']`, then `$.turn.abort` (d.ts 2831) on main.
  - None of these ever targets a remote agent.
  (planner, 2026-10-05) | assumed, confirm by T22, T23
- D26 Install: `npm run install:user` symlinks `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/agents-office` to this checkout's mod folder. It refuses to replace a real directory. `uninstall:user` removes only a symlink. Spike S3 proved a copy, not a symlink; if the symlink does not load, fall back to `rsync -a --delete`. (planner, 2026-10-05) | assumed, confirm by T24
- D27 Spike cleanup is its own todo, T01. Branch, tag and worktree setup belongs to the /ultraplan seed. (planner, 2026-10-05) | assumed
- D28 All README edits are batched in T25, so PR #20 (owner, README polish) has one conflict surface. (planner, 2026-10-05) | assumed
- D29 A remote player's position is published relative to its room (`rx`, `ry` from the room's top-left interior cell). Each pane maps it into its own room bounds and clamps to a standable tile, else the first free anchor. (planner, 2026-10-05) | assumed, confirm by T19
- D30 Lead pants are 0x546e7a, not 0x263238: the D6 value is within 5 levels per channel of the floor (0x2b303b), so the main agent's legs vanished in the T04 LIVE capture. Other role colors are unchanged. D5, D6, D7 and D8 confirmed by T04. (T04, 2026-10-05)
- D31 Layout details settled by T05. Team rooms split the top band evenly (remainder to the first room), at least 11 interior columns, desks 5 apart and centred. Bottom-room doors sit flush right (3 columns from the right edge; v1 was 4) and a bottom room's sign is cut before the door or doorStand, because the 12/12/10/10/10 widths would otherwise let the sign overwrite door cells: at 60 columns the signs read Reception, Conferenc, Kitchen, Test La, Booths; wider maps show them whole. `Room` and `OfficeMap` are generic over the id type (default v1 `RoomId`), and `canStand`, `tileAt` and `findPath` take `OfficeMap<string>` (path.ts changed by one line). At 11 rows a 10-wide bottom room keeps one desk anchor. D10 confirmed. (T05, 2026-10-05)
- D32 T06 deviations. `V2RoomId` is now just `RoomId`, and `Room`/`OfficeMap` are no longer generic (T05's generics are reverted; path.ts takes `OfficeMap` again); `OfficeMap` carries `hidden` and each `Room` its `kind`. Agent helpers take the own team room as a parameter: `seedMain(roster, home)`, `onSpawn(roster, input, result, home)`, `syncList(roster, infos, home)`. Report phases are `toReception`/`toKitchen`. The `team` atom is `null` until session.start (forced write, label = cwd basename) or the first tick (fills it after a hot reload, from `$.session.id()`/`$.session.cwd()`); before it exists the map has no team room and home is Reception. A failing `$.session.id()` is logged once and leaves the office without a team room; office tests stub `on('session.id')`. `migrateRoster` (agents.ts) runs on the tick and also drops the migrated agents' motion entries so they reseat at their desks. Floor colors: team 0x2b303b, reception 0x3a3430, conference 0x2b3a3a, kitchen 0x3a3a2b, lab 0x2b2f45, booths 0x3a2b3a; corridor 0x2b303b. log.ts needed no change (room names come from `Room.name`). (T06, 2026-10-05) | confirms D11
- D33 T07 details. `team.ts` exports `baseName`, `branchOf(stdout, ok)` and `teamLabel(cwd, stdout, ok)`; session.start runs the git lookup in its own guard `session.start branch` after the `team` guard, so a failed run keeps the basename. The `team` atom's `branch` field now holds the branch. Beyond the TODO scope, `map.ts` gained `cut(text, n)`, which cuts team and room signs by code point; this closes the T06 backlog item. frame.ts now draws sign glyphs per code point and shows `?` for a glyph the raster refuses, and the git call has a 3 s timeout; both came from the review. These are the deviations. Office tests that start a session must stub `process.run` (without it the engine throws `no implementation for process.run` and the guard logs it). (T07, 2026-10-05) | confirms D12

- D34 T08 details. `pad.ts` exports `readKeys(handled, value, clear)`, `applyKeys`, `onPadInput`, `INITIAL_PAD`; the `pad` atom is `{ handled, clear, intent? }` with `intent = { key, at, taps }` (`taps` counts presses of the same key since it last changed; T09 consumes it). A value equal to the drawn `clear` marker is never a key; a value that does not extend `handled` is a reset field and its text after the marker is all new. Every input event that carried keys flips `clear` between '' and ' '. A value that is a prefix of `handled` is a deletion and yields no keys (review). The hook returns `next(e)` and ignores `submit`; the Input sits in a wrapper Box with the Raster so `bottom={0}` is the map's last row, not a strip line. The Input needs `submitLabel=""`: with the default label it wrapped vertically inside the 2-column Box and covered 6 rows. At 80x24 it still draws `…` and `⏎` over the bottom-left wall cell and the cell above it (the Reception interior, first column); no figure is hidden there. The test engine does not dispatch `$.ui.focus` to an `on('ui.focus')` hook (it answers `no implementation`), so the office test asserts the plugin made the call at 1500 ms by the one `pad focus` debug-log line it writes on that failure. A deny is logged once with `pad focus denied: <reason>`. (T08, 2026-10-05) | confirms D13 so far
- D35 T09 details. `player.ts` exports `Player`, `padRect`, `spawnPlayer(map, ownId)` and `stepPlayer(player, map, intent, now, ownId)`, which returns `{ player, intent }`. Each tick consumes at most one pending tap (`intent.taps`, capped at `MAX_TAPS` = 8 in pad.ts), so a held key never outruns the tick; a tap moves exactly one tile even when the tick is late. Taps older than `INTENT_MS` (250 ms, measured from the newest press) are stale and dropped, so a burst such as `dddd` can walk fewer tiles than keys when ticks fall behind the window (LIVE: 3 of 4). There is no hold smoothing: a consumed tap never moves again. A blocked move still turns the player. The `player` atom gains `movedAt?` (walk pose for 300 ms after a move). The spawn tries the own doorStand, then own anchors, then other rooms' doorStands, skipping any footprint over the pad's two bottom-left columns of the last two rows. The tick (register.tsx `stepPlayerTick`) spawns the player once the team exists and writes the `player` and `pad` atoms; render only reads them. (T09, 2026-10-05) | confirms D13, D14
- D36 T10 details. The raster refuses U+2665 and U+266A (its allowed ranges skip U+2600-26FF), so D15's fallback applies. Rather than draw `*` for both, `emoteOf` in pad.ts lists stand-ins per key and draws the first glyph the raster accepts: key 3 draws U+25C6 and key 4 draws `~`, with `*` as the last resort. Keys 1 and 2 draw `!` and `?`. A raster that later accepts the heart or the note draws them with no other change. `applyKeys` stores the press as `pad.emote { glyph, at }`; the tick moves it onto `player.emote` with `until = at + EMOTE_MS` (3000) through `settleEmote` in player.ts, clears the pad entry, and clears the player's emote once `until` passes. frame.ts draws the glyph centred on the figure, two rows above its top row (the bubble row), only while `until > now`. (T10, 2026-10-05) | amends D15
- D37 T11 fixes the T09 burst bug and amends D35. Root cause: staleness was measured from the newest press, but a burst of N taps drains at one tap per 100 ms tick, so the 4th tap of `dddd` is consumed 300 ms after the press and failed the 250 ms check (LIVE: 3 of 4; a stepPlayer test with a 4-tap burst failed on the old code). Now every consumed tap refreshes `intent.at`, so staleness means "250 ms with no press and no consumed tap": a draining burst applies in full, a backlog nobody consumes (late ticks, a stalled loop) is still dropped. The tick writes the refreshed `at` back to the `pad` atom (the later of the stored and refreshed values). LIVE: `dddd` moved the player 4 columns. (T11, 2026-10-05) | amends D35
- D38 T11 details. `[` and `]` set `pad.jump { dir, at }` (a pending press, cleared by the tick like the emote) and clear `pad.intent`; a WASD key later in the same burst cancels the jump. The tick calls `startJump(player, map, dir)`, which sets `player.path` to a BFS path to the next or previous room's first free spot (first anchor the player can stand on outside the pad cells, else the doorStand). Canonical order is `jumpOrder`: team rooms, then shared rooms, each in map order, wrapping at both ends. The current room is the one holding the player's origin, else the room with the nearest doorStand. `stepPlayer` advances the path one tile per tick; a fresh WASD tap clears the path and walks instead; a path step that cannot be stood on cancels the path. A jump pressed before the player exists stays pending until it spawns. `pad.epoch` counts jump presses so a tick that read an older epoch does not write consumed taps back over a recreated intent; a path step that is not adjacent to the player (stale after a resize) is dropped. (T11, 2026-10-05) | confirms D13
- D39 T12 details. `e` (lower case only; `E` stays reserved for peek) sets `pad.inspect { at }`; the tick (`inspectTick` in register.tsx) clears it, finds `nearest` (Manhattan distance between the player's and each agent's footprint origin, at most 2, ties to the lower id) and writes the `inspect` atom `{ agentId, text, until: now + 6000 }`; with nobody in range the text is `Nobody within 2 tiles.`. Text is `label | status | tool | room | elapsed` (`inspect.ts`); a tool-less agent shows its pose, a remote agent will show its pose (inspectText shows tool and text only with `own: true`, so T16 remote agents are safe by default); `lastTextOf` skips user rows (prompts). The room name is cut to 14 characters so a long team label leaves room for the elapsed time at 80 columns. `OfficeAgent` gains optional `tool` and `seenAt` (set by `markTool` in tool.call; `seenAt` restarts only when the tool changes, and an agent with none counts from now). Own agents (every roster agent until T16) append the last 60 characters of their last text, read with `$.session.messages()` (main) or `({ agentId })`; a deny or throw keeps the base text and logs to debug. 80x24 choice: the strip has 0 rows there, so the line is drawn by frame.ts (`FrameInput.overlay`) over the first corridor row, on top of everything and cut to the corridor width; with strip rows the line replaces the newest strip row. The render writes the strip count into the `viewport` atom (`strip?`) so the tick, which blits, knows which path applies. The line clears from both after 6000 ms. (T12, 2026-10-05) | confirms D16

## Todos

### T01 Delete the spike worktree and branch
- status: done (#24, 2026-10-05)
- needs: none
- size: S
- scope: From the main checkout, run `git -C .claude/worktrees/agents-office-spikes status --porcelain`. If it prints anything, stop and report to the owner. Otherwise run `git worktree remove .claude/worktrees/agents-office-spikes`, `git worktree prune` and `git branch -D spike/agents-office-v2`. No tree files change and nothing merges (D27).
- files: git metadata only
- done when: `git worktree list` has no `agents-office-spikes` line, and `git branch --list 'spike/*'` prints nothing
- verify: `git worktree list`; `git branch --list 'spike/*'`; `test ! -e .claude/worktrees/agents-office-spikes && echo gone`

### T02 Add the half-block pixel compositor and pair counter
- status: done (#25, 2026-10-05)
- needs: none
- size: S
- scope: New pure `pixels.ts`:
  - `type Px = number | '.'`.
  - `compose(art: Px[][], floor: number): Cell[][]`: one U+2580 cell per vertical pixel pair; `.` becomes `floor`; an odd row count throws.
  - `countPairs(grid): number`: distinct (fg, bg) pairs.
  - `PAIR_BUDGET = 256`.
  Nothing imports the module yet.
- files: `.claude/skills/agents-office/hooks/pixels.ts` (new), `hooks/pixels.test.ts` (new)
- done when: tests show that 3x4 art composes to 3x2 U+2580 cells with the right fg/bg, `.` takes the floor in both halves, odd rows throw, and `countPairs` ignores glyphs
- verify: `rtk proxy npm run check`; pixels.test.ts: 'a 3x4 figure composes to 3x2 upper-half cells', 'a dot pixel takes the floor color', 'countPairs counts distinct fg/bg pairs'

### T03 Draw people figures
- status: done (#26, 2026-10-05)
- needs: T02
- size: M
- scope: Add `figure({ pose, facing, frame, shirt, role, key, floor }): Cell[][]` to `sprites.ts`, next to the v1 `sprite()` (which stays until T04).
  - Art as `Px` grids (D6, D9): facing down/up/left/right, each with an idle frame and a 4-frame walk.
  - Seated read/type: desk row and monitor.
  - Props for read, run, call and talk.
  - `hashKey` (FNV-1a) picks hair and skin.
  - Export `FIGURE_PALETTE`.
- files: `hooks/sprites.ts:1-81` (add), `hooks/sprites.test.ts`
- done when: tests show:
  - every pose x facing x frame gives 2 rows of 3 valid glyphs;
  - walk frames 0-3 differ pairwise for each facing;
  - the seated bottom row holds the desk color;
  - shirt = tier color and pants = role color;
  - the same key gives the same hair and skin, and 50 ids hit at least 3 hair and at least 3 skin tones;
  - every color is in `FIGURE_PALETTE`
- verify: `rtk proxy npm run check`; sprites.test.ts: 'every pose and facing draws 3x2 valid cells', 'walk frames differ', 'seated hides the legs behind the desk', 'hair and skin are stable per key'

### T04 Draw agents as people in the frame
- status: done (#27, 2026-10-05)
- needs: T03
- size: M
- scope:
  - Add `role` to `OfficeAgent` and the `agents` atom. Add `roleOf(type)` (D6); `seedMain`, `onSpawn` and `syncList` set it.
  - `motion.ts`: add `drawnFacing(entry)` (D8); `frameCount('walk') = 4`.
  - `buildFrame` composes `figure(...)` with `floor` = the floor cell's bg, replacing `overlay`.
  - Delete v1 `sprite`, `TRANSPARENT` and `isTransparent`.
  - Add the D7 crowd pair test. `register.tsx` is untouched (`buildFrame` keeps its signature).
- files: `hooks/agents.ts:33-110,154-180`; `types/index.d.ts:17-48`; `hooks/motion.ts:64-90`; `hooks/frame.ts:59-64,113-145`; `hooks/sprites.ts`; agents/motion/frame/sprites tests (`office.test.ts` only if a glyph assertion fails)
- done when: frame tests show a walking agent facing its next step in U+2580 cells, and a typing agent with the desk color; the 32-figure crowd counts under 256 pairs; all other v1 tests pass unchanged
- verify: `rtk proxy npm run check`; frame.test.ts: 'a crowd of 32 figures stays under 256 color pairs', 'a walking figure faces its next step'; motion.test.ts: 'walk frames cycle through 4'. LIVE: the capture shows `▀` cells forming main's figure in the Lobby.

### T05 Build the team-and-shared-room layout
- status: done (#28, 2026-10-05)
- needs: none
- size: M
- scope: Add `buildOffice(columns, rows, teams, ownId)` and type `V2RoomId` to `map.ts`, next to v1 `buildMap` (which stays until T06).
  - Team rooms go in the top band and shared rooms in the bottom band (D10).
  - Rooms carry a `kind` for the floor color.
  - Signs are cut to the interior width.
  - Teams that do not fit at minimum width are hidden: `hidden` count returned, own team kept (D21).
  - v1 behaviour where the doorStand overlaps a desk in a narrow top room is kept.
- files: `hooks/map.ts` (add after line 179), `hooks/map.test.ts`
- done when: tests at 60x11, 60x18 and 100x30 with 1, 2, 4 and 6 teams show:
  - rooms never overlap;
  - team anchors are 5 apart;
  - every room has an anchor reachable by `findPath` from the Reception doorStand;
  - at 60 columns, 4 teams fit and 2 are hidden with the own team kept
- verify: `rtk proxy npm run check`; map.test.ts: 'four team rooms fit at 60 columns', 'team desks are 5 apart', 'every room is reachable from Reception'

### T06 Move the office into the new rooms
- status: done (#29, 2026-10-05)
- needs: T04, T05
- size: M
- scope:
  - Rename `RoomId` to the D10 union and drop v1 `buildMap`. `mapFor(columns, rows, teams, ownId)` goes in loop.ts.
  - activity.ts follows D11; `home` = own team room (remove `homeOf`).
  - choreo.ts: lobby/meeting/break become reception/conference/kitchen.
  - `enterAtDoor` uses Reception. log.ts gets the new room names. frame.ts gets per-room-kind floor colors.
  - `register.tsx` session.start writes a `team` atom `{ id: team:<$.session.id()>, label: basename(e.cwd), branch: '', startedAt }`. Every `mapFor` caller passes it.
  - Add the D11 migration of v1 ids on the first tick.
  - Rewrite the room tests in office.test.ts.
- files: `hooks/{activity,agents,choreo,motion,log,loop,frame,map}.ts` and their tests; `types/index.d.ts:17-48`; `hooks/register.tsx:207-268,305-327,342-388,411-494`; `hooks/office.test.ts:548,616,650,658,678,718,796,816`
- done when: office tests show:
  - Read seats main at its team desk in the read pose;
  - Bash walks main to the Test Lab;
  - a spawn enters at the Reception door and walks to a team desk;
  - SendMessage meets in the Conference Room;
  - a finished subagent reports in Reception, walks to the Kitchen and leaves without teleporting;
  - a roster seeded with v1 ids is drawn after one tick;
  - no frame contains Library or Dev Bay
- verify: `rtk proxy npm run check`; office.test.ts: the 8 renamed room tests plus 'a v1 roster is migrated on the first tick'. LIVE: the capture shows the `Reception` sign and a team sign with the repo basename.

### T07 Label the team room with project and branch
- status: done (#30, 2026-10-05)
- needs: T06
- size: S
- scope: Inside the existing session.start (own guard), run `$.process.run(['git', '-C', e.cwd, 'branch', '--show-current'])` and update `team.label`/`branch`. New pure `team.ts` has `teamLabel(cwd, stdout, ok)`, which passes text through `clean` and falls back per D12.
- files: `hooks/team.ts` (new), `hooks/team.test.ts` (new), `hooks/register.tsx:305-327`, `hooks/office.test.ts`
- done when: team tests map `/x/claude-mod-agents-rpg` + `feat/agents-office-v2\n` to `claude-mod-agents-rpg (feat/agents-office-v2)`, and empty or failed output to the basename. An office test shows the loop still blits when `process.run` fails. If the test engine cannot stub `process.run`, it asserts only that session.start completes.
- verify: `rtk proxy npm run check`; team.test.ts: 'label is basename and branch', 'no branch gives the basename'. LIVE: the sign reads `claude-mod-agents-rpg (feat/agents-office-v2)`, cut to the room width.

### T08 Focus a pad input and decode key bursts
- status: done (#31, 2026-10-05)
- needs: T07
- size: M
- scope:
  - `openOffice` passes `focus: true`; `$.clock.after(PAD_FOCUS_MS)` calls `$.ui.focus({ requestId: 'office', key: 'pad-input' })`, and a deny is logged once.
  - Render adds an absolute `Box` (`bottom={0} left={0}`, minimal width, D13) holding `Input key="pad-input"`. Its `value` toggles between `''` and `' '`; `onSubmit` is a no-op for now.
  - `on('ui.input', { element: 'pad-input' })` calls pure `pad.ts` `readKeys(handled, value)`, which diffs the value and yields every new character of a coalesced burst. It then calls `applyKeys(state, keys, now)` and writes a `pad` atom `{ handled, clear, intent? }`.
  - `PAD_FOCUS_MS` and `INTENT_MS` go in timing.ts.
- files: `hooks/pad.ts` (new), `hooks/pad.test.ts` (new), `hooks/register.tsx:297-302,402-409,411-494` + new hook, `hooks/timing.ts`, `types/index.d.ts`, `hooks/office.test.ts`
- done when:
  - pad tests: `wwww` in one event gives 4 `w` intents; a repeated value gives none; the clear-trick space is ignored.
  - Office test: the render tree contains `pad-input`, and a bottom `ui.focus` hook sees the focus after 1500 ms (if the engine dispatches it).
  - LIVE: after `wwww` the prompt line does not contain `wwww`, and bottom-room figures are still visible. After Escape, `hello` lands in the prompt.
- verify: `rtk proxy npm run check`; pad.test.ts: 'a coalesced burst yields every key', 'the clear space is not a key'; office.test.ts: 'the pane draws the pad input'. LIVE as above.

### T09 Walk a player avatar with WASD
- status: done (#32, 2026-10-05)
- needs: T08
- size: M
- scope:
  - Add the `player` atom `{ x, y, facing, frame, path, emote?, chat?, until? } | null`.
  - Pure `player.ts`:
    - `spawnPlayer(map, ownId)` places the player at the own team-room doorStand.
    - `stepPlayer(player, map, intent, now)` moves one tile per tick under the D13 rules and consumes taps.
    - It reseats per D14.
  - The tick steps the player before `buildFrame`. `FrameInput.player` draws it on top with plate "you".
- files: `hooks/player.ts` (new), `hooks/player.test.ts` (new), `hooks/pad.ts`, `hooks/register.tsx:207-268`, `hooks/frame.ts:104-166`, `types/index.d.ts`, `hooks/office.test.ts`
- done when: player tests show:
  - a tap moves exactly 1 tile, even if the tick is late;
  - a wall blocks;
  - an intent refreshed for 4 ticks moves 4 tiles;
  - a stale intent moves nothing;
  - a resize reseats a player that cannot stand.
  LIVE: after `dddd`, two captures 1 s apart show the white-shirt figure further right.
- verify: `rtk proxy npm run check`; player.test.ts: 'a tap moves one tile', 'walls block', 'a held key moves one tile per tick'. LIVE as above.

### T10 Emote on keys 1-4
- status: done (#33, 2026-10-05)
- needs: T09
- size: S
- scope: `applyKeys` maps 1-4 to the D15 glyphs on `player.emote`, with `until = now + EMOTE_MS`. frame.ts draws the glyph on the bubble row above the player's plate, and the tick clears it after `until`.
- files: `hooks/pad.ts`, `hooks/player.ts`, `hooks/frame.ts`, `hooks/timing.ts`, `types/index.d.ts`, pad/player/frame tests
- done when: tests show that key 3 draws U+2665 above the player for 3000 ms and then nothing, and that every emote glyph passes `isValidGlyph` (or falls back to `*`). LIVE: `1` shows `!` above the player.
- verify: `rtk proxy npm run check`; frame.test.ts: 'an emote shows above the player for 3 s'. LIVE as above.

### T11 Jump rooms with [ and ]
- status: done (#34, 2026-10-05)
- needs: T10
- size: S
- scope: `]` and `[` set `player.path` to the next or previous room in canonical order (team rooms, then shared rooms), wrapping at the ends. The target is the room's first free anchor. Any WASD key clears the path, and `stepPlayer` walks one tile per tick.
- files: `hooks/pad.ts`, `hooks/player.ts`, player/pad tests
- done when: tests show:
  - `]` from the own room arrives at the next room after `path.length` ticks, never moving more than 1 tile per tick;
  - `d` mid-walk clears the path;
  - `[` from the first room goes to the last.
  LIVE: `]` walks the player out of the team room.
- verify: `rtk proxy npm run check`; player.test.ts: 'a room jump walks tile by tile', 'WASD cancels a jump'. LIVE as above.

### T12 Inspect the nearest agent with e
- status: done (#35, 2026-10-05)
- needs: T11
- size: M
- scope:
  - `OfficeAgent` gains `tool?` (last tool name, set by `onActivity`) and `seenAt`.
  - Pure `inspect.ts` has `nearest` and `inspectText` (D16), with elapsed formatted like `2m05s`.
  - `e` writes the `inspect` atom `{ agentId, text, until }`.
  - For own agents, `register.tsx` reads `$.session.messages()` (main) or `({ agentId })`, takes the last text, cleans it and appends its last 60 characters. A deny or throw keeps the base text.
  - Render shows the text as the newest strip line. With 0 strip rows, frame.ts draws it over the corridor's first row.
- files: `hooks/inspect.ts` (new), `hooks/inspect.test.ts` (new), `hooks/agents.ts`, `hooks/pad.ts`, `hooks/frame.ts`, `hooks/register.tsx` (ui.input, render strip), `types/index.d.ts`, `hooks/office.test.ts`
- done when: tests show:
  - `nearest` takes distance 2, ignores 3, and breaks ties by id;
  - exact text for a known agent;
  - the text clears after 6000 ms;
  - a messages deny gives the base text.
  LIVE at 80x24: walk next to main, press `e`; `main | working | ...` appears over the corridor.
- verify: `rtk proxy npm run check`; inspect.test.ts: 'nearest within 2 tiles', 'inspect text format'; office.test.ts: 'inspect shows for 6 s'. LIVE as above.

### T13 Resolve the presence directory and share preference
- status: todo
- needs: T12
- size: M
- scope:
  - Inside session.start (own guard), run `printenv CLAUDE_CONFIG_DIR`, then `printenv HOME`, through `$.process.run`. Pure `presence.ts` `presenceDir(config, home)` (D17) fills the `identity` atom `{ sessionId, startedAt, dir? }`.
  - command.run parses `e.args`: `share all|anon|off` calls `$.store.set('share', ...)` and replies `Office sharing: <mode>`. Any other args reply with a usage line. Empty args open the pane as before.
  - A `share` atom mirrors the store, loaded on session.start.
- files: `hooks/presence.ts` (new), `hooks/presence.test.ts` (new), `hooks/register.tsx:305-327,402-409`, `types/index.d.ts`, `hooks/office.test.ts`
- done when:
  - presence tests: `('/c', '/h')` gives `/c/agents-office/presence`; `('', '/h')` gives `/h/.claude/agents-office/presence`; `('', '')` gives undefined.
  - Office tests: `/office share anon` replies and persists; `/office share bogus` replies with usage and keeps `all`; `/office` still opens.
- verify: `rtk proxy npm run check`; presence.test.ts: 'presence dir prefers CLAUDE_CONFIG_DIR'; office.test.ts: '/office share anon is stored', '/office share bogus shows usage'

### T14 Publish this session's presence
- status: todo
- needs: T13
- size: M
- scope:
  - Pure `toRecord(...)` builds the brief's record:
    - labels passed through `clean` and cut to 16;
    - at most 32 agents (main first, then newest);
    - agents dropped from the end until the JSON is at most 8192 bytes;
    - anon strips names per D22;
    - only the documented fields (no tool, args, paths or text).
  - `presenceTimer = $.clock.every(1000)` (handle cancelled on restart, like v1 D25) writes per D18; `off` writes one tombstone and then stops.
  - A new `on('session.end')` writes the tombstone.
  - session.start runs `find <dir> -name '*.json' -mmin +1440 -delete`, only when dir ends with `/agents-office/presence`.
- files: `hooks/presence.ts`, `hooks/presence.test.ts`, `hooks/register.tsx` (timer, session.start, session.end), `hooks/timing.ts`, `types/index.d.ts`, `hooks/office.test.ts`
- done when:
  - The privacy test passes: a roster built from a `tool.call` with `file_path: '/Users/x/secret.ts'` and a SendMessage `hunter2` serializes with neither string.
  - 40 agents serialize as 32; 32 long labels stay at most 8192 bytes.
  - Office tests: one write at 1 s, none at 2 s when unchanged, a heartbeat at 3 s, and the tombstone on session.end.
  - LIVE: `ls -la <dir>` shows `<sessionId>.json` with its mtime advancing every 3 s, and `jq .` on it shows no paths.
- verify: `rtk proxy npm run check`; presence.test.ts: 'a record never carries paths or message text', 'records cap at 32 agents and 8 KB'; office.test.ts: 'presence writes on change and every 3 s', 'session.end writes a tombstone'. LIVE as above.

### T15 Read other sessions' presence
- status: todo
- needs: T14
- size: M
- scope: On the same 1 s timer:
  - `fs.list(dir)` and skip the own file.
  - Read only files whose `mtimeMs` changed (`presence.mtimes`).
  - `parseRecord(text)` checks every field, since `JSON.parse` returns an unknown type (comment it); a bad file keeps the last snapshot.
  - `mergeRemote(prev, parsed, now)` drops sessions that are stale (D18) or tombstoned.
  - Fill the `remote` atom; `off` reads nothing and clears it.
  Nothing draws remote data yet.
- files: `hooks/presence.ts`, `hooks/presence.test.ts`, `hooks/register.tsx` (timer), `types/index.d.ts`
- done when: tests show `parseRecord` accepts a valid record and rejects a wrong `v`, wrong types and oversize input; `mergeRemote` drops a record 10 s stale and a tombstone, and keeps the last snapshot on a partial file. There is no visible output, so no LIVE.
- verify: `rtk proxy npm run check`; presence.test.ts: 'a stale or tombstoned session is dropped', 'a partial file keeps the last snapshot'

### T16 Draw every session's team room and agents
- status: todo
- needs: T15
- size: M
- scope:
  - Teams = own + remote, ordered per D4; duplicate labels are suffixed (D12); passed to `mapFor`.
  - Each read, `remoteRoster` turns records into `sessionId:agentId` motion entries, targeted with `assignTarget` and the published pose. The tick steps them.
  - Removal follows D20, and the layout reflows when sessions join or leave (v1 D31 reseat).
  - Hidden teams get the `+N` mark (D21).
  - Re-run the D7 pair test with 4 teams x 8 agents.
- files: `hooks/presence.ts`, `hooks/loop.ts`, `hooks/frame.ts`, `hooks/register.tsx:207-268` and `mapFor` callers, frame/presence tests, `hooks/office.test.ts`
- done when:
  - Frame tests: own + 2 remote teams draw 3 signs in `startedAt` order; a remote agent in `conference` walks there 1 tile per tick; dropping a session reflows without errors; the 4x8 crowd stays under 256 pairs.
  - LIVE2: `ao` and `ao2` both show two team rooms in the same order.
  - FAKES (6 records): the `+N` mark appears.
- verify: `rtk proxy npm run check`; frame.test.ts: 'team rooms follow startedAt order', 'a remote agent walks to its published room'. LIVE2 and FAKES as above.

### T17 Show anonymous sessions as Session N
- status: todo
- needs: T16
- size: S
- scope: Reader side of D22: a record with `share: 'anon'` draws as `Session N`, and its plates show the role.
- files: `hooks/presence.ts`, `hooks/frame.ts`, frame/presence tests
- done when: a frame test with 3 teams, the 2nd anon, shows the sign `Session 2` and plates `lead`/`dev`. LIVE2: `/office share anon` in `ao2` shows `Session 2` in `ao` within 3 s.
- verify: `rtk proxy npm run check`; frame.test.ts: 'an anon team shows Session N'. LIVE2 as above.

### T18 Crop with a camera when team rooms overflow
- status: todo
- needs: T17
- size: M
- scope:
  - Replace D21 hiding: `buildOffice` lays out every team at minimum width on a virtual map wider than the pane.
  - New pure `camera.ts` crops a pane-wide window centred on the player (or the own team room when there is no player), clamped to the edges.
  - ◀ (U+25C0) / ▶ (U+25B6) are drawn in the corridor's first row on edges that hide content (`<`/`>` if refused).
  - BFS and motion use the virtual map; only the frame is cropped, so the blit keeps the mounted size.
- files: `hooks/camera.ts` (new), `hooks/camera.test.ts` (new), `hooks/map.ts`, `hooks/loop.ts`, `hooks/frame.ts`, `hooks/register.tsx:207-268,411-494`, `hooks/office.test.ts`
- done when:
  - Tests: 6 teams at 60 columns give a virtual width of at least 73 and a 60-wide crop; a player at the far right puts the window at the right edge with ◀ shown and no ▶; the office test blit is still the mounted size.
  - FAKES (6 records) + LIVE: `]` repeatedly scrolls the view with ◀ and ▶ marks.
- verify: `rtk proxy npm run check`; camera.test.ts: 'the window follows the player', 'edge marks show hidden rooms'. FAKES + LIVE as above.

### T19 Draw other sessions' players
- status: todo
- needs: T18
- size: S
- scope: Publish the own `player` as `{ room, rx, ry, facing, emote?, until? }` (D29). The reader maps it into its own room bounds and walks the remote player there. It is drawn with a white shirt, the team plate and emotes.
- files: `hooks/presence.ts`, `hooks/frame.ts`, presence/frame tests
- done when: tests show `rx`/`ry` round-trip in same-size rooms and clamp in a narrower room. LIVE2: `dddd` in `ao` moves a white figure in `ao2` within 2 s.
- verify: `rtk proxy npm run check`; presence.test.ts: 'a remote player is clamped into a narrower room'. LIVE2 as above.

### T20 Chat with other sessions' players on t
- status: todo
- needs: T19
- size: M
- scope: Per D23:
  - `t` sets `pad.mode = 'chat'`. Keys build `pad.draft`, shown on the inspect line, and do not move the player.
  - `onSubmit` sends: `clean`, cut to 40, `player.chat`, `until`, published.
  - Remote chat is drawn as a bubble above the remote player.
- files: `hooks/pad.ts`, `hooks/player.ts`, `hooks/presence.ts`, `hooks/frame.ts`, `hooks/register.tsx` (onSubmit), `types/index.d.ts`, pad/frame/office tests
- done when: tests show that `t`, `hi there`, Enter gives chat `hi there` with no movement; 60 characters are cut to 40; control characters are cleaned; an empty submit cancels. LIVE2: `t hello` Enter in `ao` shows `hello` above the player in `ao2`.
- verify: `rtk proxy npm run check`; pad.test.ts: 'chat mode swallows WASD', 'chat is cut to 40 cleaned characters'. LIVE2 as above.

### T21 Add the office cat and a day/night tint
- status: todo
- needs: T20
- size: M
- scope: Per D24:
  - New pure `cat.ts` with a `cat` atom (3x2 footprint, BFS, seeded targets in the shared rooms, rests 5-15 s, local only).
  - `tint(color, hour)` applied in frame.ts to map colors.
  - The pair test is re-run at night.
- files: `hooks/cat.ts` (new), `hooks/cat.test.ts` (new), `hooks/frame.ts`, `hooks/register.tsx:207-268`, `types/index.d.ts`, frame tests
- done when: tests show the cat moves at most 1 tile per tick and never stands on a wall; `tint(c, 22)` is darker than `tint(c, 12)`; the night crowd stays under 256 pairs. LIVE: the cat is visible within 20 s.
- verify: `rtk proxy npm run check`; cat.test.ts: 'the cat walks tile by tile'; frame.test.ts: 'night tints the map, not the figures'. LIVE as above.

### T22 Peek at an agent's last messages with Shift+E
- status: todo
- needs: T21
- size: M
- scope: Per D25:
  - `E` near an own agent opens `$.ui.open({ id: 'office-peek', title: 'Peek: <label>', rows: 12 })` without focus.
  - Pure `peekLines(messages)` gives the last 10 text messages, one cleaned line each, in the `peek` atom.
  - A `ui.render` hook for `office-peek` draws them as truncating `Text` lines.
  - A remote agent or a deny shows `Nothing to show for <label>.`
- files: `hooks/inspect.ts` (`peekLines`), `hooks/pad.ts`, `hooks/register.tsx` (ui.input, new render hook), `types/index.d.ts`, inspect/office tests
- done when: tests show `peekLines` keeps the last 10 text rows and drops tool rows, and the peek render draws them. LIVE: walking to main and pressing `E` opens a "Peek: main" pane with up to 10 lines, and the pad keeps focus.
- verify: `rtk proxy npm run check`; inspect.test.ts: 'peek keeps the last 10 text messages'; office.test.ts: 'the peek pane draws the lines'. LIVE as above.

### T23 Nudge an own agent with m and interrupt main with x
- status: todo
- needs: T22
- size: M
- scope: Per D25:
  - `m` near an own non-main agent: `$.ui.ask('Nudge <label>?', ['No', 'Yes'])`, then on Yes `$.session.send({ to: { agentId }, text: NUDGE_TEXT })`.
  - `x`: `$.ui.ask('Interrupt main?', ['No', 'Yes'])`, then on Yes `$.turn.abort(...)` (input shape from `OpEventOf['turn.abort']`).
  - The result goes to the log strip; a deny or throw is logged.
  - Ignored in chat mode, near main (for `m`) and near remote agents.
- files: `hooks/pad.ts`, `hooks/register.tsx` (ui.input), `hooks/log.ts`, `hooks/office.test.ts`
- done when: office tests (bottom hooks on `session.send`/`turn.abort` if dispatchable) show No sends nothing, Yes sends exactly once with the agentId, and `m` near main or a remote agent does nothing. LIVE: during a `sleep 30` Bash turn, `x` then Yes interrupts the turn.
- verify: `rtk proxy npm run check`; office.test.ts: 'a nudge needs a Yes', 'x aborts main only after Yes'. LIVE as above.

### T24 Install the mod user-wide
- status: todo
- needs: T23
- size: S
- scope: Per D26:
  - `scripts/install-user.sh` and `scripts/uninstall-user.sh`, run through `npm run install:user` / `npm run uninstall:user`.
  - Prove that the symlink loads exactly once. If it does not load, switch to the copy fallback and amend D26.
- files: `scripts/install-user.sh` (new), `scripts/uninstall-user.sh` (new), `package.json:4-9`
- done when: after `npm run install:user`, `claude plugin list` lists `agents-office` once when run in `/tmp` and once in the repo; `/office` opens in a session started in `/tmp`; uninstall removes only the link; the check stays green
- verify: `rtk proxy npm run check`; `npm run install:user && (cd /tmp && claude plugin list | grep -c agents-office)` prints 1; the same in `<worktree>` prints 1; LIVE with `-c /tmp`; `npm run uninstall:user && test ! -L ~/.claude/skills/agents-office`

### T25 Update the README for v2
- status: todo
- needs: T24
- size: M
- scope: Rebase on `feat/agents-office` first; if PR #20 is still open, flag the overlap to the owner. Rewrite:
  - Run it: user-wide install, uninstall, and the note that the user-wide copy shadows a worktree's copy while developing.
  - Rooms (D11).
  - Tiers and roles (shirt, pants).
  - Controls (focus, WASD, 1-4, `[` `]`, e, E, t, m, x, Escape).
  - Shared office: presence dir, cadence, privacy, `/office share`.
  - Known limits: not pixel-identical, 1.5 s focus delay, the transcript view cannot be opened.
- files: `README.md`
- done when: the README names no v1 room, and every key handled in `pad.ts` appears under Controls
- verify: `rtk proxy npm run check`; `grep -nE 'Library|Dev Bay|Lobby|Break Room' README.md` prints nothing

### TZZ Cleanup and land
- status: todo
- needs: every other todo
- scope: Run `/implement cleanup`. The landing PR from `feat/agents-office-v2` goes into `feat/agents-office`, or into `main` if PR #18 has merged by then (D3). The owner merges it.
- done when: the skill is removed from the branch, TODO.md is archived, and the landing PR into feat/agents-office (or main, per D3) is open and approved by the owner

## Backlog
- A 5x3-cell large figure on maps of 18 rows or more (brief, optional).
- Replace presence polling with `classic.FileChanged` + `watchPaths` once spike S4 is confirmed.
- Try focusing the pad without the 1500 ms delay (untested in S1b).
- Pad (T08 review): a typed space can be lost when it equals the pending clear marker (matters when Space becomes a key, T20 chat); cancel or de-dup the focus timer when `/office` runs twice; the pad draws `…` and `⏎` over two cells of the bottom-left corner.
- Pad (T09): the player can still be walked under the pad's `…` and `⏎` cells.
- Jump (T11 review): a pressed `]` mid-walk picks its room from the nearest door when the player is in the corridor, so a second press can re-target; a pending jump has no staleness limit; the tick has no re-entrancy guard (a slow tick could consume one step twice).
- Inspect (T12 review): `seenAt` restarts only when the tool name changes and `tool` survives a finished turn, so repeated Bash calls show a growing elapsed time; the tick re-reads the viewport for the strip count (use `size.strip`); `markTool` and `onActivity` are two roster writes; T16 must pass `own: false` for remote agents (the default already hides their tool and text).
- Emote (T10): at the top team row the bubble row is the sign wall row, so the glyph overwrites a sign letter for 3 s (the same holds for agent bubbles).
- Emote (T10 review): `player.until` is shared by `emote` and `chat`; give the emote its own expiry or take the later of the two before T20 sets `chat`.
- Minimap: rejected, because 80x24 has no spare rows.
- Arrival log lines read `arrived in the <project>` for the own team room (T06); consider `at their desk` wording (T06).
- Make `roomAt` generic over the room id so it accepts an `Office` (T06). At 60 columns the bottom signs read `Conferenc` and `Test La`; consider shorter sign text (T05 review).

## Log
- 2026-10-05 plan written: 26 todos (8 S, 17 M, TZZ).
- 2026-10-05 T01 done: spike worktree and branch spike/agents-office-v2 removed (only the approved spike edits were present).
- 2026-10-05 T02 done: pixels.ts compose/countPairs/PAIR_BUDGET with tests; compose also throws on rows of unequal width.
- 2026-10-05 T03 done: figure()/hashKey/FIGURE_PALETTE in sprites.ts; shirt is `Tier | 'player'`, `Role` and `Facing` types exported from sprites.ts for T04 to import. D9 confirmed (seated figure carries desk and monitor).
- 2026-10-05 T04 done: agents draw as half-block people (figure() in buildFrame), `role` on agents, drawnFacing, 4 walk frames; v1 sprite/TRANSPARENT/isTransparent removed. The v1 32-color budget test became a color-subset plus pair-budget test (D7). D30 changed the lead pants color.
- 2026-10-05 T05 done: buildOffice/V2RoomId/RoomKind/TeamSpec in map.ts with hidden count and own team kept; v1 buildMap unchanged (shares extracted rowBands/paintTiles helpers). See D31.
- 2026-10-05 T06 done: v1 rooms and buildMap removed; office runs on team room + Reception/Conference/Kitchen/Test Lab/Booths, per-kind floors, `team` atom, v1 roster migration on the first tick. See D32.
- 2026-10-05 T07 done: team label is `basename (branch)` from `git branch --show-current` (team.ts); signs cut by code point (`cut` in map.ts). See D33.
- 2026-10-05 T08 done: pad Input focused 1500 ms after `/office`, `ui.input` decodes key bursts into the `pad` atom (WASD intents only so far). See D34.
- 2026-10-05 T09 done: player avatar (white shirt, plate `you`) spawns at the own team doorStand and walks one tile per tick on WASD taps; `player` atom, `player.ts`. See D35.
- 2026-10-05 T10 done: keys 1-4 show an emote above the player for 3000 ms (`!`, `?`, and stand-ins for the heart and note the raster refuses). See D36.
- 2026-10-05 T11 done: `[` and `]` auto-walk the player to the next or previous room; a burst of taps now applies in full (consumed taps refresh staleness). See D37, D38.
- 2026-10-05 T12 done: `e` shows `label | status | tool | room | elapsed` (plus the tail of an own agent's last text) for 6 s, over the corridor at 80x24 or in the newest strip row. See D39.

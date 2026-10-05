# Agents Office v2: people, real rooms, WASD and one shared office

ultraplan: agents-office-v2 | branch: feat/agents-office-v2 | base: feat/agents-office | tag: pre-agents-office-v2-feat-agents-office | created: 2026-10-05
Status: ACTIVE
Progress: 30/35 done

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
- Keep the 3x2 footprint, the v1 D27 map contract, the 11-row compact map (v1 D51) and BFS. (Amended by D53: the 3x2 footprint is the fallback below 72 columns; the mid 5x5 footprint is the default above it.)
- At 80x24 the inline body is 11 rows, so the strip has 0 rows. Every text feature needs a no-strip path.
- Privacy: presence never carries prompts, tool arguments, tool names, file paths, SendMessage text or transcripts.
- Presence: each session writes only `<dir>/<sessionId>.json`, using absolute paths. `$.fs.write` creates directories. There is no fs delete; old files are removed only by the start-up `find -delete`.
- Gate: `rtk proxy npm run check` (validate + typecheck + `claude plugin test`). Validate and test run locally only; CI runs typecheck. If plugin test reports "hooks modules are turned off", apply the v1 D18 fix.
- `<worktree>` is the feat/agents-office-v2 worktree. LIVE means: `tmux new-session -d -s ao -x 80 -y 24 -c <worktree> claude; sleep 6; tmux send-keys -t ao '/office' Enter; sleep 4; tmux capture-pane -p -e -t ao`, then the todo's extra keys, then `tmux kill-session -t ao`. LIVE2 adds a second session, `ao2`, the same way. LIVE120 = LIVE with `-x 120 -y 40`. LIVE74 = LIVE with `-x 74 -y 24`.
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
- D40 T13 details. `presence.ts` exports `presenceDir`, `envValue(stdout, ok)`, `asShare`, `DEFAULT_SHARE`, `SHARE_USAGE` and `parseOfficeArgs`. The `identity` atom is `{ sessionId, startedAt, dir? }` (null until session.start; `dir` is absent when both variables are empty) and the `share` atom mirrors `$.store` key `share`; each is filled in its own session.start guard (`session.start presence`, `session.start share`). `printenv` runs with the 3 s timeout the git call uses; a failed run gives ''. `/office` arguments are trimmed and lower-cased: none opens the pane, exactly `share <all|anon|off>` stores the mode and replies `Office sharing: <mode>`, anything else (including a bare `share`) replies `Usage: /office share all|anon|off` and opens nothing. The test engine has no `$.store`, so office tests stub `store.get`/`store.set` with a map. (T13, 2026-10-05) | confirms D17, D19
- D41 T14 details. `toRecord` copies fields one by one (never spreads an agent), so tool, seenAt, script, bubble and message text cannot reach the file; the id, parentId and team branch are cleaned and cut to 64 code points, labels to 16 (an empty label falls back to the role). The record's `player` is always `null` until T19. Main goes first, then the newest agents (roster order reversed). The heartbeat is due when 3000 ms have passed since the last write, so with a 1 s timer it lands 4 s after the first write when nothing changes (the todo's "at 3 s" counted from a 0 s write); readers keep the 10 s staleness window. `presence` atom = `{ lastText?, lastWriteAt, ended }` where `lastText` is the record JSON without its heartbeat. Deviations: the start-up `find` also skips when share is `off` (an off session neither reads nor writes), and `presencePath` refuses a session id outside `[A-Za-z0-9._-]` so the file cannot leave the dir. `OfficeAgent.described` marks a label taken from the task description (prompt text), which publishes as the role (review fix); the sweep uses `-maxdepth 1 -type f`; a tick cannot write after session.end cancels the timer. A write that throws is logged once per distinct message and retried on the next tick. `/office share off` takes effect on the next tick (at most 1 s). `$.fs.write` and `$.clock.every` are stubbed in office tests with `on('fs.write')`. LIVE ran in the real `~/.claude` (a temporary CLAUDE_CONFIG_DIR starts the first-run login wizard); the one file it made was deleted afterwards. (T14, 2026-10-05) | confirms D18, D22 (writer)
- D42 T15 details. `team.label` and `team.branch` have their own cap of 40 code points (`TEAM_TEXT_MAX`), in the publisher (`toRecord`, branch was 64) and the reader (`parseRecord`); agent labels stay at 16 and ids at 64. This fixes the T14 cut of `claude-mod-agents-rpg` (21 characters) to 16, so other panes can show `basename (branch)`. The reader (`parseRecord`, `planReads`, `mergeRemote` in presence.ts) treats the file as untrusted: text over 8192 bytes, a wrong `v`, a bad session id or wrong types give undefined (the last snapshot is kept); at most 32 agents; an agent with an unknown tier, role, room, pose or status, an empty or duplicate id is dropped; a bad `player` becomes null (coordinates clamped to 0-200, chat 40, emote 2). A tombstone is `{ kind: 'gone' }`. Only `<id>.json` regular files are read, never the own file, never more than 16 (newest first), and never one whose mtime is more than STALE_MS (10000) from now; a file is read again only when its `mtimeMs` differs from `presence.mtimes` (an optional map, so a hot-reloaded atom without it still works). `mergeRemote(prev, parsed, now, listed)` keeps a listed session's last record when its file was unchanged or unreadable, drops it when it is unlisted, tombstoned, stale (heartbeat more than 10 s from now on either side, so a forged future heartbeat cannot keep it alive) or when the record's `sessionId` differs from its file name, and returns `prev` itself when nothing changed. `presenceTick` now runs `publishTick` then `readTick`, each in its own guard (`presence write`, `presence read`, `presence tombstone`); with share `off` it writes the tombstone, reads nothing and clears `remote` and `mtimes`. A failing `fs.list` is logged once and keeps the snapshot as it was. The `remote` atom is declared inline in `types/index.d.ts` and nothing draws it yet. (T15, 2026-10-05) | confirms D18, D20 (reader), amends D41 (label cap)
- D43 T16 details. `presence.ts` gains `remoteKey`, `remoteRoster(remote)` (entries keyed `sessionId:agentId`, `home` = the published room, `parentId` re-keyed the same way), `orderedTeams(own, remote)` (sorted by `startedAt`, then id; a repeated label gets " 2", " 3" in room order; an anonymous record's empty label is `Session` until T17) and `routeRemote(motion, map, remoteAgents)` (one `assignTarget` per remote agent that has a motion entry). `register.tsx` merges the remote roster into `seat` (so `placeMotion` keeps their motion entries) and into both `buildFrame` calls; it is never merged into the `agents` atom, so remote agents are never expired, choreographed, inspected or targeted by tool hooks. `placeMotion` has a new rule for the reflow (v1 D31): a resting agent of a team room standing outside that room is reseated at an anchor of it, which is the one allowed move that does not walk; remote agents in a room that is not on the map (a hidden team) are not drawn. `buildFrame` draws `+N` over the right end of the top wall row when `map.hidden > 0`. Team signs are cut to the room width, so two sessions whose labels are longer than the room show the same text and the " 2" suffix can be cut (LIVE2 at 80x24: both signs read `agents-office-v2-t16 (feat/agents-off`). LIVE2 showed two team rooms in the same order in both panes, and the killed session's room left the other pane within 5 s. The reseat rule fires only for a resting team-room agent that stands in the corridor or in another team's room; one resting in a shared room is routed home and walks. The own team sorts by `identity.startedAt` (the value other panes read), not `team.startedAt`. A sign on the top wall row stops before the `+N` mark. FAKES was not run (the +N mark has frame tests). (T16, 2026-10-05) | confirms D4, D12, D20, D21, D7 (4 teams x 8 agents)
- D44 T17 details. The reader labels an anonymous record (empty team label) `Session N`, where N is the 1-based room order after sorting by `startedAt`, then id; its plates already read the role because the writer publishes roles (D22). Sign rule (folded in from the T16 LIVE finding): `fitSign(label, n)` in map.ts keeps a trailing " 2", " 3" when a team sign is cut, so same-label rooms stay distinguishable; a label with no numeric suffix is cut at the right edge as before. Root cause of the T16 identical signs: a session's own label was whole while its twin's published label is cut to 40 code points (D42), so the two never matched and got no number. `orderedTeams` now cuts the own label to 40 like a published one. LIVE2 at 80x24: `ao` showed `Session 1` with plate `lead` for the anon `ao2`, and `ao2` showed `agents-office-v2-t17 (feat/agents- 2` for the twin. Two different branches of one project can still read the same when cut (backlog). (T17, 2026-10-05) | confirms D22 (reader), amends D12, D43
- D45 T18 details. D21 hiding is gone: `buildOffice(columns, rows, teams)` (the `ownId` argument and `OfficeMap.hidden` are removed, as are `visibleTeams` and the `+N` mark) lays out every team and widens the map to `virtualColumns` = max(pane, teams x 12 + 1), so `map.columns` can exceed the pane; the shared rooms stretch across it. BFS, motion, the player and the tick all use that map. `camera.ts` is pure: `viewFor` centres a pane-wide window on a column and clamps it, `focusOf` follows the player's centre, else the own team room's centre, and `cropFrame` crops the finished frame and draws U+25C0 / U+25B6 (`<` / `>` if refused) at the first and last column of the corridor's first row when content is hidden on that side; a map that fits is returned untouched. Only the two `register.tsx` call sites (tick blit, render) crop, so the Raster and the blit keep the mounted size. The inspect line (D39) is drawn inside the visible window, between the edge marks (`overlaySpan`; `buildFrame` takes `overlayFrom` and `overlayWidth`; found in review). LIVE (FAKES, 6 records plus one session, 80x24, 76-column pane, 85-column map): the view opened at the right edge with the left mark; `]` scrolled it with the left mark, the right mark, then both (the fake script re-stamped `startedAt` every 2 s, so room order shifted during the run; that is the script, not the mod). Fakes `fake-t18-1` to `fake-t18-6` were deleted afterwards. (T18, 2026-10-05) | replaces D21, amends D31, D43
- D46 T19 details. The own player is published by `toPresencePlayer(map, player, now)`: `room` is the room holding its origin (else the room with the nearest door, for the corridor), `rx`/`ry` the offset from that room's top-left interior cell (never below 0), and the emote with its `until` only while it still shows. `chat` is not published until T20. The reader places it with `placeRemotePlayer(map, player)`: the offset is clamped into the room's interior (so a narrower room still holds it), then moved to the nearest tile a figure can stand on in that room, else the first free anchor or the doorStand; a room missing from the map draws nothing. `remotePlayersOf(remote, map)` gives `RemotePlayer[]` to `buildFrame({ others })`, drawn with the white shirt, the session's team label as the plate (`nameplate` cuts it; `Session N` when anonymous), the sender's `until` capped at EMOTE_MS from now and the emote glyph. Deviation: the remote player is drawn at its latest published spot and is not walked tile by tile (it changes at most once per presence write, about 1 s); a walk needs per-session state in an atom and goes to the Backlog. The sender's `until` is a ms clock value shared by both machines' panes (same host). (T19, 2026-10-05) | confirms D29
- D47 T20 details. Input route: the pad Input stays the only text field. `t` sets `pad.mode = 'chat'`; from then on every key (WASD, digits, brackets included) is appended to `pad.draft` (capped at 120 code points), and the draft shows on the inspect line as `Say: <draft>_` (the typing line wins over an inspect line). In chat mode `onPadInput` does not flip the clear marker, so the field keeps what was typed: a typed space is never mistaken for the marker (this closes the T08 backlog item for chat) and a shorter value removes draft characters. Enter arrives as `ui.input` kind `submit`; the hook calls `onPadSubmit`, which cleans the draft, cuts it to CHAT_MAX (40), sets `pad.chat { text, at }` and ends chat mode (a blank draft only cancels) and flips the marker so the field resets. The tick moves `pad.chat` onto `player.chat` with `chatUntil = at + CHAT_MS` (5000). Expiry fix (T10 backlog): `player.until` is gone; `emoteUntil` and `chatUntil` expire separately in `settleEmote`/`settleChat`, and the published player carries `emote`/`emoteUntil` and `chat`/`chatUntil` only while each still shows. A reader caps both expiries at the record's heartbeat + EMOTE_MS / CHAT_MS. In chat mode the draft is read from the field (everything after its `base`, the code points before and including `t`), so a deletion, paste or mid-line edit gives the text on screen; the typing line shows the first 40 characters and ends in `|` once the rest would be cut. Chat is text the user typed on purpose to share, so it is published (also under `anon`); nothing else from a prompt is. The own chat is drawn above the own player too. The bubble row is the sign row for a player at the top team row, so a bubble there overwrites sign letters for 5 s (LIVE capture; same as the emote backlog item). (T20, 2026-10-05) | confirms D23
- D48 Bubbles never cover a sign, wall or door (folded into T21 from the T10, T20 and T20 LIVE findings). Rule in `putBubble` (frame.ts), used by agent bubbles, emotes and chat: the bubble goes on the row above the plate (`y - 2`) when the tile under the speaker's centre column on that row is floor; otherwise it goes on the plate row (`y - 1`) in place of the plate for as long as it shows. A cell over any tile that is not floor is skipped, so a bubble is also cut at the room's walls. At 80x24 (the 11-row map) a top-room desk has its sign on wall row 0, so the bubble takes the plate row. Test: 'an emote or a bubble at a top-room desk never covers the sign' fails on the old code; the T10 edge tests moved to a desk whose bubble row is floor. LIVE: the emote `!` replaced the `o` of the plate `you` and the sign `agents-office-v2-t21 (feat/agents-office` stayed whole. (T21, 2026-10-05) | amends D15, D23, D36, D47
- D49 T21 details. `cat.ts` is pure: `Cat { x, y, facing, frame, path, restUntil, seed }`, `spawnCat(map, seed, now)`, `stepCat(cat, map, now)` and `catArt(cat, floor)`. The cat spawns on a seeded spot among the shared rooms' door spots and desk spots, rests CAT_REST_MIN_MS to CAT_REST_MAX_MS (5000-15000, drawn from the seed), then picks another spot with a Mulberry32 draw and walks a BFS path one tile per tick; a path that is no longer adjacent or standable is dropped and a cat that cannot stand (a resize) is reseated. The walk is seeded from the own team id, so the same pane walks the same route; it is never published. The `cat` atom is written only when the cat changed (a resting cat writes nothing). The sprite is 3x4 pixels in two fur colors (CAT_FUR 0xd9822b, CAT_DARK 0x8a4b1f), drawn first, under the agents and players (review: drawn last it hid an agent resting on the same spot), with no plate. `tint(color, hour)`, `isNight(hour)` and `hourOf(now)` are in frame.ts; `buildFrame` takes `hour` (undefined draws by day) and `cat`; floor, wall, door and sign colors are tinted, so a figure's `.` pixels follow the tinted floor while figure, plate and bubble colors stay as they are. Night is 20:00-06:00 local time and keeps 65% of each channel (D24). LIVE ran at 15:00 local, so the tint is covered by tests only. The night crowd test (32 figures plus a cat) stays under 256 pairs. (T21, 2026-10-05) | confirms D24
- D50 T22 details. Shift+E (`E`) sets `pad.peek { at }`. The peek runs in the `ui.input` hook, not the tick: an open the plugin makes on its own waits undrawn below 144 columns, while one answering a key press is placed at any width (d.ts PaneOpenArgs; a tick-time `$.ui.open` drew nothing at 80x24 in LIVE). `peekTick` (register.tsx) finds the nearest agent within 2 tiles in the own roster only, so a remote agent is never peeked and a peek never carries another session's text; it writes the `peek` atom `{ agentId, label, lines }` and opens `office-peek` (`rows: 12`, no focus, so the pad keeps the keys). Nobody in range sets the inspect line `Nobody within 2 tiles.` and opens nothing. `peekLines` (inspect.ts) keeps the last 10 rows that carry text, oldest first, one cleaned line each cut to 120 characters; user rows are marked `> ` (D25 says text messages, so prompts of the own agent are shown here, unlike inspect's D16 tail). A messages deny, throw or no text shows `Nothing to show for <label>.`. A `ui.render` hook for `office-peek` draws the lines as truncating Text and writes nothing. The pane is a second tab beside Office; the Office tab stays shown and the pad keeps focus. LIVE (fresh session, no messages) opened `Peek: main` and the second tab read `Nothing to show for main.`; the 10-line content is covered by tests, because LIVE may not type a prompt. (T22, 2026-10-05) | confirms D25
- D51 T23 details. `m` and `x` (lower case; `M` and `X` do nothing) set `pad.nudge` / `pad.interrupt`; like the peek, `confirmTick` runs in the `ui.input` hook, not the tick. It does not await the dialog, so the pad keeps working while it is open; the `asking` atom lets one dialog exist at a time, and both keys in one burst ask nothing. `m` needs an own non-main agent within 2 tiles (the own roster only, so a remote agent is never targeted); near main or nobody it does nothing and draws nothing. Both ask with `['No', 'Yes']` (`CONFIRM_OPTIONS`, No first) and only the exact label `Yes` acts (`isYes`): No, Escape (the ask rejects), a typed `Other` text such as `yes` and a throw all do nothing. Yes sends `$.session.send({ to: { agentId }, text: NUDGE_TEXT })` once (fixed text, nothing from a prompt) and logs `You nudged <label>`; a send that answers `isDelivered: false` or throws logs `Nudge to <label> failed`. `x` reads the main turn id from the new `turn` atom (`turn.start` writes it, `turn.complete` of main clears it) at the press, and a Yes aborts that id (a turn that ended meanwhile makes the abort fail and log `Interrupt failed`; a turn that began meanwhile is not touched). With no running turn at the press the dialog still opens (this lets LIVE show it with no model call) and a Yes logs `Interrupt skipped: no turn is running`. Review fixes: `m` skips main and done or leaving agents before the nearest search (a finished subagent would be resumed by a send, and a subagent beside main stays reachable); the dialog flag is claimed in one update and reset at session.start; `confirmTick` has its own guard and drops presses older than 1000 ms. Yes calls `$.turn.abort({ turnId })` and logs `You interrupted main`. Deviation from the done-when: LIVE could not run the `sleep 30` Bash turn or reach a subagent without sending a prompt to the model, which this run forbids; the abort and the nudge are covered by office tests ('a nudge needs a Yes', 'x aborts main only after Yes' and their No, dismiss and `yes` variants) and LIVE showed the `x` confirm dialog and its cancel. (T23, 2026-10-05) | confirms D25
- D52 T24 details. The symlink loads: with `CLAUDE_CONFIG_DIR` pointed at a temp dir, `claude plugin list` run in `/tmp` and in the repo each shows one `agents-office@skills-dir` entry (Scope user, Status loaded, Path = the link), so the D26 copy fallback is not needed. The todo's `grep -c agents-office` prints 2 because the entry has a name line and a Path line that both match; `grep -c '❯ agents-office'` prints 1. `scripts/install-user.sh` links to the checkout it runs from (a worktree links its own copy), so the link target is that checkout's `.claude/skills/agents-office`. It honours `CLAUDE_CONFIG_DIR`, else `$HOME/.claude`; a re-run prints "nothing changed"; a real directory or a symlink to another target is refused (exit 1) unless `--force`, which replaces it. `uninstall-user.sh` removes the link only when `readlink` equals this checkout's mod folder and leaves a real directory or a foreign link alone (exit 1). Both are plain sh with no dependencies. Checked by a scratch script (not committed) against temp config dirs: fresh install, re-run, conflicting dir refused, foreign link refused, `--force` over both, uninstall, uninstall of a foreign link and of a directory, and the `HOME` fallback; the owner's real `~/.claude` was never touched. LIVE was not run: a session started with a temporary `CLAUDE_CONFIG_DIR` opens the first-run theme wizard (as in T14) and logging in was out of scope, so `/office` in a `/tmp` session is unconfirmed; the plugin list proves the load. (T24, 2026-10-05) | confirms D2, D26
- D53 (owner, 2026-10-05). The owner rejected the 3x4-pixel (3x2-cell) figure and chose "Mid 5x5 cells". Owner's wording: "GPT style halved: eyes, hair, tie, legs, shoes kept." "Rooms grow to ~7 rows; 80x24 shows one room band and the camera scrolls." "Falls back to current 3x2 if the pane is tiny." This amends the Constraint "Keep the 3x2 footprint", D5 and v1 D27, and replaces the Backlog 5x3 item.
- D54 (assumed, confirm by F03). Mid art: standing 5x10 px (5x5 cells), seated 8x10 px (8x5 cells; person in columns 0-4, monitor in columns 5-7 rows 3-6, desk top at px row 7, desk body at rows 8-9). Derived once from gpt-grids.json with the gpt-preview.mjs resample (dominant colour, eye wins), then re-lettered by hand into slots: H hair, S skin, T shirt, U shirt shade, K tie, P pants, F shoes, E eye, M mouth, D desk top, B desk body, N monitor frame, C screen, `.` floor. Shirt = tier and shade = a fixed darker tone per tier; pants = role and tie = pants colour; hair and skin come from hashKey; mouth = hair; eyes and shoes = 0x141414. Facings come from down/up/left/right. Side walks resample walk1-4 to 5 px and mirror for left. Down and up walks alternate the legs (frames 1 and 3 swap, 2 and 4 idle). Seated read is one frame; seated type toggles a hand pixel. The prop goes in the figure's top-right cell.
- D55 (assumed, confirm by F02; F01 measured the call sites). OfficeMap.foot is the single source of the footprint; the cat has its own CAT_FOOT (3x2). F01 measured: `FOOTPRINT_W`/`FOOTPRINT_H` are defined at map.ts:50-51 and on 34 lines (definitions and imports included) in 6 files: map.ts 8 uses (106, 109, 111, 119, 120, 126, 181, 182), frame.ts 9 uses plus the import (242, 261, 282, 303, 304, 310, 317, 327, 328; W only), player.ts 2 (33), presence.ts 4 (436, 437, 442, 443), map.test.ts 3 (54, 58, 190) and path.test.ts 2 (29, 30). `path.ts`, `cat.ts`, `inspect.ts`, `camera.ts` and `register.tsx` never name the constants: they go through `canStand(map, x, y)`. See D63.
- D56 (assumed, confirm by F04). Mid geometry: 7-row bands (sign/bubble row, plate row, 5 figure rows), a 5-row corridor, 5-wide doors, team desks 9 apart, shared anchors 6 apart, minimum interior widths 17 (team) and 13 (shared), map rows max(rows, 23) where 23 = 1+7+1+5+1+7+1, and map columns max(pane, teams x 18 + 1, 71).
- D57 (F01 measured, confirm by F08). Mid applies at 72 or more pane columns and 11 or more body rows. 60-71 columns keep the 3x2 layout and the v1 D51 bands. A footprint change reseats motion entries, the player path and the cat. F01 measured the viewport (debug overlay in a scratch crop, LIVE in tmux): 80x24 gives a 76x11 body (map 76x23 cropped to 11 rows, strip 0), 74x24 gives 70x11 (below 72: 3x2), 120x40 gives a 116-column body of 23 rows, of which the v1 rule draws 18 Raster rows plus a 5-row strip. The 116x23 expected in F01 is the whole body, not the Raster. `INLINE_MAX_ROWS` = `FULL_ROWS` 18 + `STRIP_ROWS` 5 = 23, so an inline body never exceeds 23 rows and D59 holds only if F08 makes `rasterSize` give the mid map all 23 rows (strip 0). The thresholds stand: 72 columns splits 70 (small) from 76 (mid); `MIN_COLUMNS` is 60 and `MIN_ROWS` is 11.
- D58 (F01 measured, confirm by F05). The camera centres on the focus in both axes (the player's centre, else the own team room's centre). ▲ U+25B2 and ▼ U+25BC go at the middle column of the first and last view rows, falling back to `^`/`v`. ◀▶ and the inspect/chat overlay go on the first visible corridor row. F01 measured: `isValidGlyph` accepts U+25B2 and U+25BC (and U+25C0, U+25B6, U+23CE), so no fallback is needed; the `^`/`v` fallback is already the `isValidGlyph(glyph) ? glyph : fallback` branch at camera.ts:30. A vertical crop of the 23-row map to the pane rows works at both `cropFrame` call sites (register.tsx:759 tick blit, :1118 render): at 80x24 the Raster stays mounted at 76x11, at 74x24 at 70x11 and at 120x40 at 116x18, with the blit the same size and ▲/▼ drawn at the middle column of the first/last view row. The pad Input is `position="absolute" bottom={0} left={0}` of the Raster wrapper (register.tsx:1151), so it stays at the bottom-left of the view, not of the map (see D63).
- D59 (assumed, confirm by F08). In mid, the map comes first; strip rows appear only past 23 map rows.
- D60 (F01 measured, confirm by F06). 256 pairs per frame, counted after the crop. If over, shrink in this order: shade becomes one fixed darken; hair 5 to 3 tones; skin 4 to 3 tones. F01 measured 32 mid figures (5x10 standing, 8x10 seated, from gpt-grids.json, recoloured per D54 with 20 hair x skin combinations covered first), plus one plate pair, one bubble pair and one cat pair-set, on a 160x23 frame of 4 teams. Pairs, same for day (12:00) and night (22:00): 12 seated + 20 standing 185 full and 90 on the worst 76x11 crop; all standing 162 full and 96 crop; all seated 133 full and 64 crop; the empty frame is 9. All are under 256, so no shrink step is applied and the order above stays a reserve. Headroom is 71 pairs on the full frame. The count leaves out emotes, chat bubbles and remote-player extras beyond the one bubble pair, so F06 re-runs it on real frames.
- D61 (assumed, confirm by F07). Inspect in mid uses the footprint-gap distance (2 or less). Plates are cut to 7 and centred on the person. The cat stands at person spot + (1, foot.h-2). The pad-cell skip uses the default view. Amended by D63: the pad-cell skip is relative to the view, not the default view.
- D62 (assumed, confirm by F09). The presence schema is unchanged; mixed-size panes clamp rx/ry, so positions are approximate.
- D63 (F01, 2026-10-05). Corrections to F02-F09 from the real code. (a) F02 touches only map.ts, frame.ts, player.ts, presence.ts, map.test.ts and path.test.ts for `FOOTPRINT_*`; path.ts, cat.ts, inspect.ts, camera.ts and register.tsx read `canStand` only, so they leave F02 (the cat and inspect read `map.foot` in F07). (b) `map.test.ts` and `path.test.ts` import `FOOTPRINT_W`/`FOOTPRINT_H`, so "every existing test passes unchanged" cannot hold with "grep matches nothing outside map.ts": the two test files switch to `SMALL_FOOT.w`/`.h` in F02, a mechanical edit. (c) The pad Input draws at the bottom-left of the mounted Raster (register.tsx:1151) while `padRect` (player.ts:30) is the map's last two rows; with a vertical crop the two coincide only when the view is at the map bottom. F05 keeps `padRect` for standing and F07 makes the spawn and jump skip use the cells under the Input at the current view bottom-left; the loss when the view is scrolled up is the 2x1 cells at the view's bottom-left (wall column and room margin), confirmed by F05 LIVE. (d) F08 must change `rasterSize` and `stripRows` in mid so that a 23-row inline body gives a 23-row Raster and 0 strip rows (v1 gives 18 + 5, measured at 120x40); `FULL_ROWS` stays 18 for the small layout. (e) F05 also needs `rows` in `cropFrame` and in both call sites, and `mapAt` (register.tsx) must pass the mid row count through `mapFor`.
- D64 (owner review of F03, 2026-10-05). Mid art faces reworked, amending D54 grids: the old grids read as hooded blobs (hair on rows 0-2 and the sides of the eye row left 5 skin pixels). New grids are face first: hair on rows 0-1 and the corners of row 2, 3 skin pixels on row 2, 5 on the eye row, a mouth on row 4 (down); the up view is hair only; the side view puts the face on the facing side with the mouth at the edge. Walk frames now keep rows 0-7 identical to the idle grid (the hands no longer swap) and change only the legs (rows 8-9): frames 1 and 3 shift the legs in opposite directions, frames 2 and 4 are the idle grid, so a facing has 3 distinct walk grids, not 4. Seated reuses the down head and torso in columns 0-4. Left is the exact mirror of right.
- D65 (F04, 2026-10-05). Amends D56: mid team desks are centred for the 8-cell seated figure (D54), not the 5-cell footprint, so at the 17-column minimum the desks sit at the room's left edge and 9 apart and the second seat ends on the last interior column. Standing positions still use the 5x5 footprint. `buildOffice` throws for a footprint that is neither `SMALL_FOOT` nor `MID_FOOT`.
- D66 (F05, 2026-10-05). Confirms D58. `viewFor(mapColumns, mapRows, paneColumns, paneRows, focus)` returns `{ x, y, width, height }` (the spec's {x, y} plus the clamped size). `focusOf` returns the player's top-left plus `floor(foot/2)` in each axis (x stays `player.x + 1` for 3x2), else the own room's centre. `overlaySpan(map, paneColumns, paneRows, focus)` also returns `row`, the mark row (first visible corridor row, else the view's top row, stepped one row inward when it would be the first or last view row under a ▲ or ▼, so the marks never cover the inspect line); `buildFrame` takes it as `overlayRow`. `cropFrame` returns the grid itself only when the map fits both axes. Both register.tsx call sites pass the raster rows; the pad Input stays `bottom={0}` of the Raster wrapper, so it is already at the view's bottom-left, and `padRect` is untouched (F07 owns the spawn skip, D63c). `mapAt` and `rasterSize` stay as they are until F08.
- D67 (F07, 2026-10-05). Confirms D61 and D63c. `nearest(agents, motion, from, range, foot = SMALL_FOOT)`: a 3x2 `foot` keeps the D16 origin distance; any other measures the gap between two figures, `max(0, |dx| - foot.w) + max(0, |dy| - foot.h)`, against `INSPECT_RANGE` 2. The cat steps and rests on `{ ...map, foot: CAT_FOOT }` (so a 5x5 map never blocks it) and its spots are person spot + (1, foot.h - 2) on a map whose footprint is bigger than the cat's, the spot itself on the small map. `placeRemotePlayer` needed no change: its clamp already uses `map.foot`, and the new test covers 3x2 to 5x5 and back. `spawnPlayer`, `startJump` and `stepPlayer` take a trailing `pad: Rect` (default `padRect(map)`); `padRectAt(view)` gives the 2x2 cells at the view's bottom-left. Deviation: `register.tsx` is touched (allowed only for the pad skip): `stepPlayerTick` takes the pane size and passes `padRectAt(viewFor(...))`, and `inspectTick` passes `map.foot` to `nearest`. `peekTick` and `confirmTick` (the `E`, `m` calls from the ui.input hook) take a `foot` from `footOf($)`, which rebuilds the map from the viewport, so peek and nudge agree with inspect. The pad skip uses the view focused on the player before this tick's step (best effort: a jump recentres the camera, so near a clamped corner the skip can differ from the drawn view).

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
- status: done (#36, 2026-10-05)
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
- status: done (#37, 2026-10-05)
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
- status: done (#38, 2026-10-05)
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
- status: done (#39, 2026-10-05)
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
- status: done (#40, 2026-10-05)
- needs: T16
- size: S
- scope: Reader side of D22: a record with `share: 'anon'` draws as `Session N`, and its plates show the role.
- files: `hooks/presence.ts`, `hooks/frame.ts`, frame/presence tests
- done when: a frame test with 3 teams, the 2nd anon, shows the sign `Session 2` and plates `lead`/`dev`. LIVE2: `/office share anon` in `ao2` shows `Session 2` in `ao` within 3 s.
- verify: `rtk proxy npm run check`; frame.test.ts: 'an anon team shows Session N'. LIVE2 as above.

### T18 Crop with a camera when team rooms overflow
- status: done (#41, 2026-10-05)
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
- status: done (#42, 2026-10-05)
- needs: T18
- size: S
- scope: Publish the own `player` as `{ room, rx, ry, facing, emote?, until? }` (D29). The reader maps it into its own room bounds and walks the remote player there. It is drawn with a white shirt, the team plate and emotes.
- files: `hooks/presence.ts`, `hooks/frame.ts`, presence/frame tests
- done when: tests show `rx`/`ry` round-trip in same-size rooms and clamp in a narrower room. LIVE2: `dddd` in `ao` moves a white figure in `ao2` within 2 s.
- verify: `rtk proxy npm run check`; presence.test.ts: 'a remote player is clamped into a narrower room'. LIVE2 as above.

### T20 Chat with other sessions' players on t
- status: done (#43, 2026-10-05)
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
- status: done (#44, 2026-10-05)
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
- status: done (#45, 2026-10-05)
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
- status: done (#46, 2026-10-05)
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
- status: done (#47, 2026-10-05)
- needs: T23
- size: S
- scope: Per D26:
  - `scripts/install-user.sh` and `scripts/uninstall-user.sh`, run through `npm run install:user` / `npm run uninstall:user`.
  - Prove that the symlink loads exactly once. If it does not load, switch to the copy fallback and amend D26.
- files: `scripts/install-user.sh` (new), `scripts/uninstall-user.sh` (new), `package.json:4-9`
- done when: after `npm run install:user`, `claude plugin list` lists `agents-office` once when run in `/tmp` and once in the repo; `/office` opens in a session started in `/tmp`; uninstall removes only the link; the check stays green
- verify: `rtk proxy npm run check`; `npm run install:user && (cd /tmp && claude plugin list | grep -c agents-office)` prints 1; the same in `<worktree>` prints 1; LIVE with `-c /tmp`; `npm run uninstall:user && test ! -L ~/.claude/skills/agents-office`

### F01 Spike: measure the mid figure, vertical crop and pair budget
- status: done (#49, 2026-10-05)
- needs: T24
- size: S
- scope: Measurement only. Code goes on a scratch branch `spike/mid-figure` that is deleted afterwards; only TODO.md merges. (1) Record pane columns and body rows at 80x24, 120x40 and 74x24 from the `viewport` atom (debug log). Expected: 76x11, about 116x23, about 70x11. (2) Crop the current frame to 11 rows of a padded 23-row map at the two `cropFrame` call sites in `register.tsx`, and confirm the Raster and the blit keep the mounted size and the pad Input stays at the bottom left. (3) Compose 32 mid figures from the `gpt-preview.mjs` mid grids, recoloured per D54, and count pairs day and night, on the full frame and on an 11-row crop. (4) Check `isValidGlyph` for U+25B2 and U+25BC. (5) `grep -n` every `FOOTPRINT_W`/`FOOTPRINT_H` use. Add these lines to Constraints: LIVE120 = LIVE with `-x 120 -y 40`; LIVE74 = LIVE with `-x 74 -y 24`.
- files: `docs/agents-office-v2/TODO.md` (D53-D62 amended with the numbers, Constraints)
- done when: D57 states the measured pane sizes, D60 the pair counts, D58 the glyph result and D55 the footprint call sites; any number that breaks an assumption is flagged to the owner before F02
- verify: `git branch --list 'spike/*'` prints nothing; `rtk proxy npm run check`; LIVE and LIVE120 captures of the scratch crop saved in the scratchpad

### F02 Carry the footprint on the map
- status: done (#50, 2026-10-05)
- needs: F01
- size: M
- scope: Add `type Footprint = { w: number; h: number }`, `SMALL_FOOT` (3x2), `MID_FOOT` (5x5) and `OfficeMap.foot`; `buildOffice` sets `SMALL_FOOT`. Every `FOOTPRINT_*` user found by F01 (map.ts, frame.ts, player.ts, presence.ts and the two tests, D63) reads `map.foot`; the cat gets its own `CAT_FOOT` (3x2). No behaviour change.
- files: `hooks/map.ts`, `hooks/frame.ts`, `hooks/player.ts`, `hooks/presence.ts`, `hooks/map.test.ts`, `hooks/path.test.ts` (D63)
- done when: every existing test passes with only the `FOOTPRINT_*` imports in map.test.ts and path.test.ts changed to `SMALL_FOOT`; `grep -n FOOTPRINT_ hooks/*.ts` matches nothing outside map.ts; a new test shows `canStand` on a map with `foot` 5x5 refuses a spot whose 25th cell is wall
- verify: `rtk proxy npm run check`; map.test.ts 'canStand checks every cell of the map footprint'; LIVE and LIVE120 captures match the pre-change captures (3x2 figures, same rooms)

### F03 Add the mid figure art and recolouring
- status: done (#51, 2026-10-05)
- needs: F01
- size: M
- scope: New pure `midArt.ts` holds the D54 grids in semantic letters: 4 facings idle, 4 walk frames per facing, seated read, and seated type (2 frames). Add `midFigure({ pose, facing, frame, shirt, role, key, floor })` to `sprites.ts`. It maps slots to colours per D54 and returns 5x5 cells (standing) or 8x5 cells (seated) through `compose`, with props in the top-right cell. Extend `FIGURE_PALETTE`. Nothing draws it yet.
- files: `hooks/midArt.ts` (new), `hooks/midArt.test.ts` (new), `hooks/sprites.ts`, `hooks/sprites.test.ts`
- done when: tests show that every standing grid is 5x10 and every seated grid 8x10 using only slot letters; that down, left and right have an eye pixel and up has none; that down has the tie and a standing figure's bottom row is shoes; that walk frames 0-3 differ pairwise per facing; that shirt = tier, pants = tie = role, and hair/skin are stable per key; and that every colour is in `FIGURE_PALETTE`
- verify: `rtk proxy npm run check`; midArt.test.ts 'grids use only slot letters' and 'the front view has eyes and a tie'; sprites.test.ts 'mid figures recolour by tier and role'; LIVE and LIVE120 unchanged-regression captures (nothing draws the art yet)

### F04 Lay out the office at mid size
- status: done (#53, 2026-10-05)
- needs: F02
- size: M
- scope: `buildOffice(columns, rows, teams, foot)`. With `MID_FOOT` it follows D56: bands of 7 interior rows, a 5-row corridor, doors 5 wide, team desks 9 apart with the lead first, shared anchors 6 apart, team minimum 17, shared minimum 13, rows max(rows, 23), columns max(pane, teams x 18 + 1, 71). The `SMALL_FOOT` path is unchanged. Not wired yet.
- files: `hooks/map.ts`, `hooks/map.test.ts`
- done when: tests at 76x11, 116x23 and 160x50 with 1, 2, 4 and 7 teams show that rooms never overlap; every anchor and doorStand passes `canStand` with 5x5; every room is reachable by `findPath` from the Reception doorStand; team desks are 9 apart; the map is 23 rows at 11 and at 23 body rows; and a 3x2 map at 60x11 is tile-identical to the previous output
- verify: `rtk proxy npm run check`; map.test.ts 'mid rooms fit a 5x5 figure with a plate row', 'every mid room is reachable' and 'the small layout is unchanged'; LIVE and LIVE120 unchanged-regression captures

### F05 Scroll the camera vertically
- status: done (#54, 2026-10-05)
- needs: F02
- size: M
- scope: `camera.ts` works in 2D per D58. `viewFor` returns {x, y}, `focusOf` returns {x, y}, and `cropFrame` crops rows to the pane and draws ▲/▼ (or `^`/`v`). ◀/▶ and the overlay row move to the first visible corridor row, else the view's top row, and `buildFrame` takes `overlayRow`. A map that fits returns untouched, so the 3x2 layout looks the same. Update both `register.tsx` crop call sites (:759, :1118), pass `rows` to `cropFrame`, and keep the pad Input at the view bottom-left (D63).
- files: `hooks/camera.ts`, `hooks/camera.test.ts`, `hooks/frame.ts`, `hooks/register.tsx` (tick blit, render), `hooks/office.test.ts`
- done when: tests show that a 23-row map in an 11-row pane centred on a top-band room shows rows 0-10 with ▼ and no ▲; that a player in the bottom band moves the view down with ▲ shown; that ◀/▶ draw on a visible row; and that the office test blit is still the mounted size
- verify: `rtk proxy npm run check`; camera.test.ts 'the view follows the player vertically' and 'edge marks stay inside the view'; LIVE and LIVE120 unchanged-regression captures (the 3x2 map always fits)

### F06 Draw mid figures in the frame
- status: todo
- needs: F03, F04
- size: M
- scope: When `map.foot` is mid, `buildFrame` draws `midFigure` for agents, the player and remote players. Seated agents use the 8x5 seat at their desk. Plates are centred on the person and cut to 7. Bubbles are centred and follow D48. Re-run the D7/D60 pair test with a mid crowd, day and night, full and cropped.
- files: `hooks/frame.ts`, `hooks/frame.test.ts`
- done when: frame tests show that a mid map draws a 5x5 walking figure facing its next step; that a typing agent draws desk and monitor colours across 8 cells; that a top-desk bubble never covers the sign; and that 32 mid figures plus the cat stay under 256 pairs day and night
- verify: `rtk proxy npm run check`; frame.test.ts 'a mid crowd stays under 256 pairs' and 'a seated mid figure carries its desk and monitor'; LIVE and LIVE120 unchanged-regression captures (not wired)

### F07 Fit interactions to the mid footprint
- status: done (#55, 2026-10-05)
- needs: F04
- size: M
- scope: Per D61. `nearest` uses the footprint-gap distance (2 or less) on mid maps and keeps D16 on small maps. The cat stands at person spot + (1, foot.h-2) with `CAT_FOOT`. `placeRemotePlayer` clamps a 3x2-sized `rx`/`ry` into a mid room and the reverse. The spawn and jump pad-cell skip uses the cells under the Input at the current view bottom-left (D63).
- files: `hooks/inspect.ts`, `hooks/cat.ts`, `hooks/presence.ts`, `hooks/player.ts`, their tests
- done when: tests on a mid map show that an agent with a 2-cell gap is found and one with a 3-cell gap is not; that the cat never stands on a wall and walks tile by tile; that a remote player published from an 11-wide room lands on a standable tile of a 17-wide mid room, and the reverse; and that `]` arrives at a bottom-band anchor
- verify: `rtk proxy npm run check`; inspect.test.ts 'mid inspect measures the gap between figures'; presence.test.ts 'a remote player moves between figure sizes'; LIVE and LIVE120 unchanged-regression captures

### F08 Switch to mid figures at 72 columns and above
- status: todo
- needs: F05, F06, F07
- size: M
- scope: `loop.ts` adds `footFor(columns, rows)` per D57, and `mapFor` passes it. The strip follows D59 in mid: `rasterSize` and `stripRows` give a 23-row body a 23-row Raster and 0 strip rows (v1 gives 18 + 5, D63). The render writes `viewport.foot`. When it differs from the last frame, the tick reseats every motion entry, clears the player path and respawns the cat. After a hot reload, a missing `foot` counts as small. Rewrite the office tests that assume the 3x2 layout at large sizes.
- files: `hooks/loop.ts`, `hooks/loop.test.ts`, `hooks/register.tsx` (tick, render), `types/index.d.ts` (`viewport.foot`), `hooks/office.test.ts`
- done when: tests show that `footFor(76, 11)` is mid and `footFor(70, 11)` is small; that a resize from 70 to 76 columns reseats every agent onto a standable tile within one tick; and that inline 23 rows gives 0 strip rows and a 23-row map
- verify: `rtk proxy npm run check`; loop.test.ts 'mid starts at 72 columns'; office.test.ts 'a footprint change reseats the office'. LIVE: the capture shows a 5-row figure with eyes and a tie in the own team room, the top band whole, and ▼ at the bottom; after five `]` presses to reach a bottom room, ▲ shows. LIVE120: the whole office with no ▲▼. LIVE74: the 3x2 layout.

### F09 Check mixed figure sizes across sessions
- status: todo
- needs: F08
- size: S
- scope: No schema change (D62). Run `ao` at 80x24 (mid) and `ao2` at 74x24 (3x2). Fix only clamp or placement bugs found; anything else goes to the Backlog.
- files: `hooks/presence.ts`, `hooks/presence.test.ts` (only if a fix is needed)
- done when: LIVE2 shows that `dddd` in `ao2` moves its white figure in `ao` within 2 s onto a standable tile, and that `ao` shows `ao2`'s team room; the reverse direction holds
- verify: `rtk proxy npm run check`; LIVE2 (`ao` at 80x24, `ao2` at 74x24) and LIVE120 for `ao`, with both captures saved

### T25 Update the README for v2
- status: todo
- needs: F09
- size: M
- scope: Rebase on `feat/agents-office` first; if PR #20 is still open, flag the overlap to the owner. Rewrite:
  - Run it: user-wide install, uninstall, and the note that the user-wide copy shadows a worktree's copy while developing.
  - Rooms (D11).
  - Tiers and roles (shirt, pants).
  - Controls (focus, WASD, 1-4, `[` `]`, e, E, t, m, x, Escape).
  - Shared office: presence dir, cadence, privacy, `/office share`.
  - Known limits: not pixel-identical, 1.5 s focus delay, the transcript view cannot be opened.
  - README covers figure sizes, the 72-column fallback and the ▲▼ marks under Known limits/Controls.
- files: `README.md`
- done when: the README names no v1 room, and every key handled in `pad.ts` appears under Controls
- verify: `rtk proxy npm run check`; `grep -nE 'Library|Dev Bay|Lobby|Break Room' README.md` prints nothing

### TZZ Cleanup and land
- status: todo
- needs: every other todo
- scope: Run `/implement cleanup`. The landing PR from `feat/agents-office-v2` goes into `feat/agents-office`, or into `main` if PR #18 has merged by then (D3). The owner merges it.
- done when: the skill is removed from the branch, TODO.md is archived, and the landing PR into feat/agents-office (or main, per D3) is open and approved by the owner

## Backlog
- F08: once `viewport.foot` exists, make `footOf` (register.tsx) read it instead of rebuilding the map; the 'Nobody within 2 tiles.' hint now means a 2-cell gap on mid.
- F04 follow-up: at the 71-column minimum the shared rooms are 13 wide and the bottom signs stop short of the 5-wide door, so 'Reception' draws as 'Receptio' and 'Conference' as 'Conferen'. Decide in F08 whether to widen Reception or accept the cut.
- Shoe and eye near-black 0x141414 has about 1.4:1 contrast against the darkest room floor (F03 review); check on real floors in F06 and lighten if the shoes vanish.
- A 5x3-cell large figure on maps of 18 rows or more (brief, optional).
- Replace presence polling with `classic.FileChanged` + `watchPaths` once spike S4 is confirmed.
- Try focusing the pad without the 1500 ms delay (untested in S1b).
- Pad (T08 review): a typed space can be lost when it equals the pending clear marker (matters when Space becomes a key, T20 chat); cancel or de-dup the focus timer when `/office` runs twice; the pad draws `…` and `⏎` over two cells of the bottom-left corner.
- Pad (T09): the player can still be walked under the pad's `…` and `⏎` cells.
- Jump (T11 review): a pressed `]` mid-walk picks its room from the nearest door when the player is in the corridor, so a second press can re-target; a pending jump has no staleness limit; the tick has no re-entrancy guard (a slow tick could consume one step twice).
- Inspect (T12 review): `seenAt` restarts only when the tool name changes and `tool` survives a finished turn, so repeated Bash calls show a growing elapsed time; the tick re-reads the viewport for the strip count (use `size.strip`); `markTool` and `onActivity` are two roster writes; T16 must pass `own: false` for remote agents (the default already hides their tool and text).
- Emote (T10): at the top team row the bubble row is the sign wall row, so the glyph overwrites a sign letter for 3 s (the same holds for agent bubbles). DONE in T21 (D48).
- Emote (T10 review): `player.until` is shared by `emote` and `chat`; give the emote its own expiry or take the later of the two before T20 sets `chat`.
- T12 found: the player can stand on an agent's desk tile, so the plates overlap (`youn`). Consider blocking agent-occupied tiles.
- Presence (T13 review): T14 must read the `share` atom after session.start has loaded it and treat a failed `store.get` as a reason to log, not to publish silently; `identity.dir` is an absolute path in a readable atom (never publish it); `/office share` racing the first `loadShare` can be overwritten by the stale stored value; `envValue` trims real path spaces and accepts a relative CLAUDE_CONFIG_DIR; `printenv` reuses `GIT_TIMEOUT_MS`.
- Presence (T14): `/clear` ends the session under a new id with no `session.start`, so `identity.sessionId` goes stale and the old file lingers until the day sweep; the write cadence is not rate-limited between a change and the timer (at most 1 per tick); a thrown fs.write retries every second.
- Presence (T15): a listing over 16 fresh files shows only the newest 16 sessions; a record's `player` is parsed but unused until T19; a `fs.list` that throws every second logs once and is retried each tick; `fs.read` has no timeout of its own.
- Presence (T16): a remote agent is placed at its published room on first sight (no walk-in) and a second session's remote player is not drawn until T19; the displaced-agent reseat rule also reseats a local agent resting in the corridor whose route to its team room failed; an own label that differs from its published (cut, or empty when anon) form can number duplicates differently per pane.
- Signs (T17): two sessions of one project on different branches whose labels are the same up to the room width still read alike when cut; consider showing the branch tail.
- Camera (T18): the pane scrolls only 9 columns at 7 teams, so the marks barely move at 80x24; a remote player's room is not centred on until T19.
- Minimap: rejected, because 80x24 has no spare rows.
- Arrival log lines read `arrived in the <project>` for the own team room (T06); consider `at their desk` wording (T06).
- Make `roomAt` generic over the room id so it accepts an `Office` (T06). At 60 columns the bottom signs read `Conferenc` and `Test La`; consider shorter sign text (T05 review).
- Remote players (T19): drawn at the published spot without a walk; the camera does not centre on a remote player's room; a corridor player is published in the room with the nearest door, so it reappears inside that room; two remote players clamped onto one tile overlap; the player is published as null while the pane is below the minimum size.
- Chat (T20): a pad Escape does not cancel a draft (only an empty Enter) and chat mode has no timeout; a draft stays after the pane closes; chat has no history. (The bubble-on-sign part is fixed by D48.)
- Cat (T21): the cat walks through agents and players (no collision) and is drawn under them; a cat left inside a team room by a reflow stays until its next walk; a bubble from a desk just below the corridor can land in the corridor; it keeps one walk speed (1 tile per tick, as agents); a pane that opens at night has no way to test the tint live except by changing the clock; the tint uses the machine's local time zone.
- Peek (T22): the peek is a snapshot taken at the key press and does not refresh; the pane is a second tab that needs a tab switch to read; user prompts of the own agent appear in it; no review subagent ran for T22 (tool-call cap), only a self-review. A catch-up review (sonnet code-reviewer, 2026-10-05) found no MEDIUM or above; LOW items: `peekTick` leaves `pad.peek` set when the player is null until a later input drops it as stale; its local `opened` shadows the module-level `opened` atom; it awaits `$.session.messages` and `$.ui.open` before `next(e)`, so a slow transcript read delays pad keys; closing the Office pane leaves `office-peek` open with its stale snapshot; no test for the nobody-in-range case, a stale press or a second `E`; the inspect.test peek regex is looser than the real string.
- Nudge and interrupt (T23 review, not fixed): a press made while a dialog is open is dropped with no feedback and `m` then `t` in one burst opens the dialog during chat; `turn.complete` clears the turn atom after `next`, so a throwing `next` leaves it stale until the next `turn.start`; whether a subagent run raises `turn.start` is unconfirmed (the atom would then hold its id). The nudge text is fixed and one-way (no reply handling); `x` asks even with no running turn; LIVE never reached a subagent or a running turn (no model call allowed), so only the dialog and its cancel were seen live.
- Install (T24): `claude plugin list` shows the user-wide mod as `agents-office@skills-dir`; T25 should note the user-wide link shadows a worktree's copy. Not covered: `/office` in a `/tmp` session (login wizard), Windows, and a relative `CLAUDE_CONFIG_DIR` (the link target is absolute, the link path is as given).

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
- 2026-10-05 T13 done: `presence.ts` resolves the presence dir (CLAUDE_CONFIG_DIR, else HOME/.claude) into the `identity` atom, and `/office share all|anon|off` is stored in `$.store` and mirrored in the `share` atom. See D40.
- 2026-10-05 T14 done: each session writes `<sessionId>.json` (changed record or every 3 s, tombstone on session.end and on share off); a day-old file sweep runs at session start. See D41.
- 2026-10-05 T15 done: the 1 s presence timer reads other sessions' files (changed mtimes only), validates every field, drops stale or tombstoned sessions and fills the `remote` atom; share `off` reads nothing; team label and branch cap raised to 40 in publisher and reader. See D42.
- 2026-10-05 T16 done: every session's team room is drawn in `startedAt` order with its agents, walking to their published rooms one tile per tick; hidden teams show `+N`. See D43.
- 2026-10-05 T17 done: an anonymous session's room reads `Session N` (N = room order) and its plates read the role; cut team signs keep their " 2" suffix, and the own label is cut like a published one. See D44.
- 2026-10-05 T18 done: teams never hide; when they need more than the pane the office is wider and a camera crops it to follow the player (or the own room) with left and right marks. See D45.
- 2026-10-05 T19 done: the own player is published as `{ room, rx, ry, facing, emote?, until? }` and other sessions' players are drawn in a white shirt with their team plate and emote, clamped into this pane's room. See D46.
- 2026-10-05 T20 done: `t` opens chat in the pad, Enter sends a line cleaned and cut to 40 that other sessions draw above the player for 5 s; emote and chat now expire separately. See D47.
- 2026-10-05 T21 done: a seeded office cat wanders the shared rooms of each pane, the map tints 35% darker from 20:00 to 06:00, and a bubble never covers a sign (it takes the plate row). See D48, D49.
- 2026-10-05 T22 done: Shift+E opens a `Peek: <label>` pane with the nearest own agent's last 10 text messages, never a remote agent's. See D50.
- 2026-10-05 T23 done: `m` nudges the nearest own non-main agent and `x` interrupts main, each only after a No/Yes confirm that acts on the exact answer Yes. See D51.
- 2026-10-05 T24 done: `npm run install:user` symlinks the mod into `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/agents-office` (idempotent, refuses a real dir or foreign link without `--force`) and `npm run uninstall:user` removes only a link to this repo; the symlink loads once. See D52.
- 2026-10-05 owner rejected 3x2 figure; F01-F09 inserted (Mid 5x5, D53)
- 2026-10-05 F01 done (#49): spike measured 76x11, 70x11 and 116x23 bodies; the 11-row vertical crop keeps the Raster size at both call sites; 32 mid figures peak at 185 pairs (day = night), so no D60 shrink; U+25B2 and U+25BC are valid; `FOOTPRINT_*` appears on 34 lines in 6 files. No OWNER CHECK. Corrections to F02, F05, F07, F08 in D63.
- 2026-10-05 F02 done (#50): `OfficeMap.foot` (`Footprint`, `SMALL_FOOT`, `MID_FOOT`, `CAT_FOOT`) replaces `FOOTPRINT_*`; map.ts `makeRoom` uses `SMALL_FOOT` until F04 passes the footprint in; the two tests import `SMALL_FOOT`; new test 'canStand checks every cell of the map footprint'. LIVE and LIVE120 show the same 3x2 layout. No behaviour change.
- 2026-10-05 F03 done (#51): `midArt.ts` holds the D54 grids (letters; left walks are mirrors of right); `midFigure` and `midFrameCount` in `sprites.ts`; `FIGURE_PALETTE` gains the near-black, desk body, monitor frame, player shade and five tier shades (the palette size bound in two tests moved from 32 to 48). Seated ignores facing (one grid). Nothing draws it yet; LIVE and LIVE120 unchanged.
- 2026-10-05 F03b done: mid figure faces reworked (D64); `midArt.ts` builds walk frames from the idle grid so the head stays still; tests and the sprites walk-distinct count (4 to 3) updated.
- 2026-10-05 F04 done (#53): `buildOffice(columns, rows, teams, foot = SMALL_FOOT)` lays out MID_FOOT per D56 (7-row bands, 5-row corridor, 5-wide doors, team desks 9 apart, shared anchors 6 apart; rows above 23 go a third to the corridor, the rest to the two bands). Shared rooms get equal base widths (13 each at the 71-column floor), so the shared anchors at 13 wide keep one anchor beside the door. `makeRoom` takes the footprint; `virtualColumns` takes an optional footprint. Small layout unchanged (snapshot test). Not wired. LIVE and LIVE120 unchanged. No OWNER CHECK.
- 2026-10-05 F05 done (#54): `camera.ts` is 2D (D66): `viewFor`/`focusOf` take and return x and y, `cropFrame` crops rows and draws ▲/▼ at the middle column of the first and last view row, ◀/▶ and the inspect line use the first visible corridor row else the view's top row (`overlayRow`). Both register.tsx crop sites pass the raster rows. A map that fits returns untouched, so LIVE and LIVE120 show the same 3x2 office. Vertical behaviour is covered by camera tests on a 23-row mid map in an 11-row pane. No OWNER CHECK.
- 2026-10-05 F07 done (#55): `nearest` takes the map footprint (gap distance on mid, D16 on small); the cat walks on a CAT_FOOT map and rests at person spot + (1, foot.h - 2) on mid; the spawn and jump pad skip takes a `pad` Rect (`padRectAt(view)`, wired in `stepPlayerTick`); `placeRemotePlayer` already clamped between sizes, now tested. Small layout unchanged; LIVE and LIVE120 show the same 3x2 office. No OWNER CHECK. Deviation in D67.

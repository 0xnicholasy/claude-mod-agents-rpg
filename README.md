# claude-mod-agents-rpg

Agents Office is a Claude Code mod. It adds an `/office` command that opens a pane showing your Claude Code agents as small pixel people in an office. Every agent has hair, skin, a shirt in its model tier colour and trousers in its role colour. It sits at a desk while it reads or edits, walks between rooms when it calls other tools, and shows a speech bubble when agents message each other or finish.

You get a character of your own. With the pane focused, WASD walks it around, number keys emote, and other keys inspect an agent, peek at its messages, say a line, nudge it or interrupt the session.

Every Claude Code session on the machine can show up in the same office, one team room per session, read from small presence files (see "Shared office").

![The office at 80x24: the session's team room, with the main agent and your own character](docs/images/office-80x24.png)

## Install

The mod folder is `.claude/skills/agents-office/` in this repo. There are two ways to load it.

**Project-local.** Start `claude` in this repo. The mod loads from the project skills folder as `agents-office@skills-dir`. If `/office` is not offered, run `claude plugin list` to check that it is loaded and enabled.

**User-wide.** From a checkout of this repo:

```
npm run install:user
```

This links `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/agents-office` to the mod folder of this checkout, so every Claude Code session loads the mod once, whatever its directory. The script refuses to replace a real directory, or a link to another checkout, unless you add `--force` (`npm run install:user -- --force`). Running it again on an already installed link changes nothing.

```
npm run uninstall:user
```

This removes the link, and only if it points at this checkout. It leaves a real directory or a link to another checkout in place.

While you develop in a checkout, the user-wide link shadows that checkout's own project copy: the sessions run the linked checkout's files. Uninstall first (or point the link at the checkout you are editing) when you want a worktree's copy to be the one that loads.

## Use

- `/office` opens the pane. Nothing opens by itself. Running it again re-focuses the pad.
- `/office share all|anon|off` sets what this session publishes to the shared office (see "Shared office"). The choice is stored and kept between sessions; the default is `all`. Any other argument prints the usage line.

About one and a half seconds after the pane opens, a one-row input at its bottom-left takes the keyboard focus. That input is the pad: the keys below go to the office instead of the prompt.

## Controls

These work once the pad has focus.

| Key | What it does |
| --- | --- |
| `W` `A` `S` `D` (either case) | Walk your character one tile. A tap moves exactly one tile; holding a key moves one tile per tick. Walls block you; agents do not. |
| `[` and `]` | Walk to the previous or next room, team rooms first and then the shared rooms, wrapping at both ends. |
| `1` `2` `3` `4` | Emote for 3 seconds: `!`, `?`, a heart and a note. The pane cannot draw the heart or the note glyph, so `3` shows a diamond and `4` shows `~`. |
| `e` | Inspect the nearest agent within 2 tiles: label, status, tool, room and elapsed time, shown for 6 seconds. It shows your own session's agents, with the last 60 characters of their latest text; a remote agent is never inspected. |
| `Shift+E` | Peek: opens a second pane with the last 10 text messages of the nearest agent of your own session. |
| `t` | Chat. What you type until Enter becomes a speech bubble of up to 40 characters above your character for 5 seconds. An empty line cancels. In chat mode every key, WASD and digits included, is text. |
| `m` | Nudge the nearest agent of your own session that is not main. A No/Yes dialog comes first; Yes sends the fixed text "Nudge from the office: please post a short status update." |
| `x` | Interrupt the main session's running turn, after a No/Yes dialog. |
| `Escape` | Returns focus to the prompt. It does not cancel a chat draft; send an empty line to do that. |

Inspect, peek and nudge only ever target agents of your own session, never a remote one.

## Rooms

Every office has one team room per session, a corridor and five shared rooms.

| Room | What happens there |
| --- | --- |
| Team room, labelled `project (branch)` | One per Claude Code session, holding its main agent and subagents. Agents sit here at their own desk while they read or edit. The label is the directory name and the git branch, and the branch is dropped when there is none. Sessions with the same label get ` 2`, ` 3`. |
| Reception | Spawned agents walk in at its door. Agent and TaskStop calls send an agent here, and finished agents report here. |
| Conference | A SendMessage between two known agents brings both here. |
| Kitchen | A finished agent goes here after its report and leaves 5 seconds or more after it finished. |
| Test Lab | Bash, BashOutput, KillShell, Monitor. |
| Booths | WebSearch, WebFetch, and MCP tools whose name contains fetch, http or search. |

The tool an agent just called decides its room (`hooks/activity.ts`):

- Read, Grep, Glob, NotebookRead, LSP, ReadMcpResourceTool, ListMcpResourcesTool and ReadMcpResourceDirTool: the agent's own desk, in a reading pose.
- Edit, Write, MultiEdit, NotebookEdit and any tool not listed (including MCP tools that are not network tools): the agent's own desk, in a typing pose.

Code search that runs through Bash shows in the Test Lab, not at a desk, because the office sees only the tool name.

## Tiers and roles

The shirt colour is the model tier: the first of haiku, sonnet, opus, fable found in the model alias given at spawn, otherwise in the resolved model id.

| Tier | Shirt |
| --- | --- |
| haiku | `#4fc3f7` |
| sonnet | `#66bb6a` |
| opus | `#ffb74d` |
| fable | `#ba68c8` |
| grey | `#9e9e9e` |

Grey means the model is unknown. It is used for the main session and for teammates that were only seen in `agent.list` and never spawned through the hook. Your own character wears a white shirt and the plate "you".

The trouser colour is the role:

| Role | Trousers | Who |
| --- | --- | --- |
| lead | `#546e7a` | The main session. |
| dev | `#2f4a7a` | Any subagent that is not a reviewer or researcher, and any agent with no role. |
| research | `#7a6a4f` | A subagent type containing explore, research or search. |
| review | `#5e3a6e` | A subagent type containing review. |

Hair and skin tones come from a hash of the agent's id, so an agent keeps its look.

## What you will see

- Spawn: a new agent appears at the Reception door and walks to a desk in its team room.
- Work: the agent walks to the room its latest tool call names (see "Rooms") and stands there in a working pose; at a desk it sits.
- Messaging: when an agent calls SendMessage to another known agent, both walk to the Conference room. The sender shows a speech bubble with the first 40 characters of the message for 4 seconds, then both return to what they were doing.
- Completion: a subagent that finishes its turn walks to Reception and shows "done" (or "stopped" if the turn did not end with an answer). Its parent, or the main session, shows "got it". It then walks to the Kitchen and leaves once at least 5 seconds have passed since it finished.
- Log: the map comes first; a pane with more than 23 body rows shows up to five lines under it with the newest events (arrivals at a room, messages, reports), oldest first.
- Cat: a cat wanders the shared rooms and rests 5 to 15 seconds between walks. It is only drawn in your own pane; it is not published.
- Night: from 20:00 to 06:00 by your machine's clock, the floors, walls, doors and signs are 35% darker. Figures keep their colours.

## Figure sizes and the camera

- At every pane size the office draws (60 columns and 11 rows or more), a standing person is 5x5 cells, and a person at a desk takes 8x5 cells (the person plus the monitor). Their plate shows the label, cut to 7 characters.
- A pane narrower or shorter than the 5x5 map (which is at least 71 columns by 23 rows) crops it with the camera below; there is no smaller layout.
- A map larger than the pane is cropped around your character (or around your own team room when your character is not drawn). Arrows at the pane edges show where more office is hidden: `▲` and `▼` at the middle column of the first and last row, `◀` and `▶` on the first visible corridor row. `^` and `v` replace the vertical marks where the terminal cannot draw triangles.
- At 80x24 the pane body is 76 columns by 11 rows, so you see one room band at a time and `[` `]` or WASD scroll the view. At 120x40 the whole office fits in the pane and no `▲` or `▼` shows.

![The whole office at 120x40: team room, corridor, the five shared rooms and the cat in the Kitchen](docs/images/office-120x40.png)

## Shared office

Each Claude Code session writes one small JSON file, and every pane reads the files of the others, so all your sessions show the same rooms and the same people.

- The directory is `$CLAUDE_CONFIG_DIR/agents-office/presence`, or `$HOME/.claude/agents-office/presence` when that variable is empty. Each session writes only `<sessionId>.json` there.
- Cadence: once a second the mod writes when the record changed and otherwise refreshes it every 3 seconds. A session whose heartbeat is older than 10 seconds drops out of the office. At start-up files not modified for 24 hours are deleted. A pane shows at most 16 other sessions.
- Published: a format version, the session id, the start time and heartbeat time, the share mode, the team label and branch, and for each agent (main plus the newest, at most 32, and the record is at most 8 KB) its id, label, tier, role, room, pose, status and parent id. For your own character it publishes the room and position inside it, its facing and, while they show, the emote and any chat line you typed on purpose.
- Never published: prompts, file paths, tool names or arguments, SendMessage text and transcripts. The one free text is the chat line you type with `t`.
- `/office share anon` publishes the role as every agent's label and blanks the team label and branch. Other panes show such a session as `Session N`, where N is its position in the room order. Your own pane still shows your own names.
- `/office share off` writes one "gone" record, then stops writing and stops reading: you see only your own session.
- Room order is by start time, then session id. Each pane lays the rooms out for its own size and animates the people locally from presence data that updates about once a second, so panes are not pixel-identical and a remote character's position is approximate.

## Requirements

- Claude Code 2.1.289, the version the API types were taken from (see `CLAUDE.md`).
- The terminal surface only. Other surfaces show "Office needs the terminal surface."
- A pane body of at least 60 columns by 11 rows. Inline, that means a terminal of about 64x24; the office fits 80x24 with no log there. `/office` requests a pane of up to 23 rows. A smaller pane shows a line naming the needed and actual size ("Office needs a 60x11 pane, this one is ...") and draws nothing else. Resizing to a valid size redraws at once.

## Known limits

- Panes are not pixel-identical, and a remote figure's position is approximate when the two panes have different sizes (see "Shared office").
- The pad takes focus 1.5 seconds after the pane opens, so keys pressed earlier go to the prompt.
- The peek pane is a snapshot taken when you press `Shift+E`; it does not refresh and sits in a second tab. The full transcript view cannot be opened from the office.
- Teammates have no tier colour and show grey.
- A subagent's `agentId` on `tool.call` was observed through a test cast only (the typed test API drops it). Whether a real session delivers it the same way is not confirmed.
- The cat walks through people and is drawn under them.
- The night tint uses the machine's local time zone.
- Not covered: Windows, `/office` in a `/tmp` session (login wizard), and a relative `CLAUDE_CONFIG_DIR` (the user-wide link target is absolute; the link path is used as given).
- At the narrowest layouts a bottom-room sign can be cut short, for example `Conferenc`.

## Develop

- `npm install`, then `npm run check`. It runs `validate` (`claude plugin validate`), `typecheck` (`tsc -p tsconfig.json`) and `test` (`claude plugin test`). Validate and test need the `claude` CLI and run locally only. CI runs typecheck only.
- Mod path: `.claude/skills/agents-office/` (manifest `.claude-plugin/plugin.json`, hooks in `hooks/`, state contract in `types/index.d.ts`). The design notes are in `docs/agents-office/plan.md`; the v2 plan and decisions are in `docs/agents-office-v2/TODO.md`.
- Hot reload: saving a file in the mod reloads the module in a running session. The office keeps its agents, because state lives in `$.state` atoms and not in module variables.
- Debug lines in the Claude Code debug log start with `agents-office:`. A line containing `threw` or `refused` is a failure.

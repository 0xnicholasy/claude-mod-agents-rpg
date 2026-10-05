# claude-mod-agents-rpg

Agents Office is a Claude Code mod. It adds an `/office` command that opens a pane showing the session's agents as small pixel characters in a seven-room office. Each agent stands in the room that matches its latest tool call, walks between rooms, shows speech bubbles when agents message each other or finish, and a five-line log under the map lists the recent events. The main session appears as a character too.

## Run it

1. Start `claude` in this repo. The mod loads automatically from the project skills folder `.claude/skills/agents-office/` (as `agents-office@skills-dir`, per Claude Code's skills-dir plugin loading). If `/office` is not offered, run `claude plugin list` to check that it is loaded and enabled.
2. Run `/office`. The pane opens only on `/office`; nothing opens by itself.
3. Spawn any subagent (for example with the Agent tool) and watch it appear.

## Rooms

The tool an agent just called decides its room (`hooks/activity.ts`).

| Room | Sent there by |
| --- | --- |
| Dev Bay | The default desk room of spawned agents. |
| Library | Read, Grep, Glob, NotebookRead, LSP, ReadMcpResourceTool, ListMcpResourcesTool, ReadMcpResourceDirTool. Agents whose subagent type contains "explore" have their desk here. |
| Server Room | Bash, BashOutput, KillShell, Monitor. |
| Phone Booth | WebSearch, WebFetch, and MCP tools whose name contains fetch, http or search. |
| Lobby | Agent and TaskStop calls, spawn walk-ins through the Lobby door, the main session's desk, and completion reports. |
| Meeting Room | A SendMessage between two known agents (see "What you will see"). |
| Break Room | Finished agents, before they leave. |

Edit, Write, MultiEdit, NotebookEdit, and any tool not listed above (including MCP tools that are not network tools) send an agent to its own desk room: Dev Bay for spawned agents, Library for explore-type agents, Lobby for the main session.

Code search that runs through Bash shows in the Server Room, not the Library, because the office sees only the tool name.

## Tiers

The character color is the model tier. The tier is the first of haiku, sonnet, opus, fable found in the model alias given at spawn, otherwise in the resolved model id.

| Tier | Color |
| --- | --- |
| haiku | `#4fc3f7` |
| sonnet | `#66bb6a` |
| opus | `#ffb74d` |
| fable | `#ba68c8` |
| grey | `#9e9e9e` |

Grey means the model is unknown. It is used for the main session and for teammates that were only seen in `agent.list` and never spawned through the hook.

## What you will see

- Spawn: a new agent appears at the Lobby door and walks to its desk.
- Messaging: when an agent calls SendMessage to another known agent, both walk to the Meeting Room. The sender shows a speech bubble with the first 40 characters of the message for 4 seconds, then both return to what they were doing.
- Completion: a subagent that finishes its turn walks to the Lobby and shows "done" (or "stopped" if the turn did not end with an answer). Its parent, or the main session, shows "got it". It then walks to the Break Room and leaves once at least 5 seconds have passed since it finished.
- Log: the five lines under the map show the newest events (arrivals at a room, messages, reports), oldest first.

## Requirements

- Claude Code 2.1.289, the version the API types were taken from (see `CLAUDE.md`).
- The terminal surface only. Other surfaces show "Office needs the terminal surface."
- A pane body of at least 60 columns by 11 rows. Inline, that means a terminal of about 64x24 (13 rows are kept for the border, the prompt area and two transcript lines); the office fits 80x24 with no log strip there. `/office` requests a pane of up to 23 rows. The log strip under the map shows 0-2 rows when the pane is small (none at 11 rows) and up to 5 when it is roomy. An inline pane is sized from the terminal height and capped at 23 rows; a height-only terminal resize applies after the next width change or `/office`. A smaller pane shows a line naming the needed and actual size ("Office needs a 60x11 pane, this one is ...") and draws nothing else. Resizing to a valid size redraws at once.

## Develop

- `npm install`, then `npm run check`. It runs `validate` (`claude plugin validate`), `typecheck` (`tsc -p tsconfig.json`) and `test` (`claude plugin test`). Validate and test need the `claude` CLI and run locally only. CI runs typecheck only.
- Mod path: `.claude/skills/agents-office/` (manifest `.claude-plugin/plugin.json`, hooks in `hooks/`, state contract in `types/index.d.ts`). The design notes are in `docs/agents-office/plan.md`.
- Hot reload: saving a file in the mod reloads the module in a running session. The office keeps its agents, because state lives in `$.state` atoms and not in module variables. Module variables hold only caches and timer handles (`loggedFailures`, `loggedBlitDenies`, `lastFrameCells`, `loopTimer`, `refreshTimer` in `register.tsx`; the map cache in `loop.ts`), none of them drawn.
- Debug lines in the Claude Code debug log start with `agents-office:`. A line containing `threw` or `refused` is a failure.

## Known limits

- The builder never saw the office in a real pane. Frame rate, whether the sprites are legible in your terminal font, and where the speech bubbles land are not confirmed.
- Teammates have no tier color and show grey.
- The `agentId` on a subagent's `tool.call` was observed through a test cast only (the typed test API drops it). Whether a real session delivers it the same way is not confirmed.

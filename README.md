# claude-mod-agents-rpg

Agents Office is a Claude Code mod. It adds an `/office` command that opens a pane showing the session's agents as small pixel characters in a seven-room office. Each agent stands in the room that matches its latest tool call, walks between rooms, shows speech bubbles when agents message each other or finish, and a five-line log under the map lists the recent events. The main session appears as a character too.

## Run it

1. Start `claude` in this repo. The mod is in `.claude/skills/agents-office/` and is loaded from there.
2. Run `/office`. The pane opens only on `/office`; nothing opens by itself.
3. Spawn any subagent (for example with the Agent tool) and watch it appear.

## Rooms

The tool an agent just called decides its room (`hooks/activity.ts`).

| Room | Sent there by |
| --- | --- |
| Dev Bay | Edit, Write, MultiEdit, NotebookEdit, and any tool not listed here, including MCP tools that are not network tools. Spawned agents have their desk here. |
| Library | Read, Grep, Glob, NotebookRead, LSP, ReadMcpResourceTool, ListMcpResourcesTool, ReadMcpResourceDirTool. Agents whose subagent type contains "explore" have their desk here. |
| Server Room | Bash, BashOutput, KillShell, Monitor. |
| Phone Booth | WebSearch, WebFetch, and MCP tools whose name contains fetch, http or search. |
| Lobby | Agent, TaskStop, SendMessage as a plain tool call. The main session has its desk here. New agents walk in through the Lobby door. |
| Meeting Room | A SendMessage between two known agents (see "What you will see"). |
| Break Room | Finished agents, before they leave. |

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
- A pane body of at least 60 columns by 23 rows (an 18-row map plus the 5-row log). A smaller pane shows "Widen the pane for the office" and draws nothing else. Resizing to a valid size redraws at once.

## Develop

- `npm install`, then `npm run check`. It runs `validate` (`claude plugin validate`), `typecheck` (`tsc -p tsconfig.json`) and `test` (`claude plugin test`). Validate and test need the `claude` CLI and run locally only. CI runs typecheck only.
- Mod path: `.claude/skills/agents-office/` (manifest `.claude-plugin/plugin.json`, hooks in `hooks/`, state contract in `types/index.d.ts`). The design notes are in `docs/agents-office/plan.md`.
- Hot reload: saving a file in the mod reloads the module in a running session. The office keeps its agents, because state lives in `$.state` atoms and not in module variables. The one module variable set is a cache of already-logged failures and is never drawn.
- Debug lines in the Claude Code debug log start with `agents-office:`. A line containing `threw` or `refused` is a failure.

## Known limits

- The builder never saw the office in a real pane. Frame rate, whether the sprites are legible in your terminal font, and where the speech bubbles land are not confirmed.
- Teammates have no tier color and show grey.
- The `agentId` on a subagent's `tool.call` was observed through a test cast only (the typed test API drops it). Whether a real session delivers it the same way is not confirmed.

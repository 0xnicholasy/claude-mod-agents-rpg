# Agents Office

[![ci](https://github.com/0xnicholasy/claude-mod-agents-rpg/actions/workflows/ci.yml/badge.svg)](https://github.com/0xnicholasy/claude-mod-agents-rpg/actions/workflows/ci.yml)

A pane inside Claude Code that shows your session's agents as small pixel characters in an office.

Agents Office is a Claude Code mod: a plugin of function hooks that hot-reloads in a running session (version 0.1.0). The `/office` command opens a pane with a seven-room office. Each agent stands in the room that matches its latest tool call, walks between rooms, and shows speech bubbles when agents message each other or finish. A five-line log under the map lists recent events. The main session appears as a character too.

Layout sketch (not a screenshot; the real pane is drawn with colored sprites):

```text
+------------------------+-----------+-----------+---------+
|        Dev Bay         |  Library  |Server Room|  Phone  |
+------------------------+-----------+-----------+---------+
|                    corridor (3 rows)                     |
+------------------+--------------------+------------------+
|      Lobby       |    Meeting Room    |    Break Room    |
+------------------+--------------------+------------------+
```

<!-- TODO: add a real screenshot or GIF -->

## Requirements

- Claude Code 2.1.289, the version the API types were taken from. Other versions are untested.
- The terminal surface. Other surfaces show "Office needs the terminal surface."
- A pane body of at least 60 columns by 23 rows (an 18-row map plus the 5-row log). `/office` requests a pane of that size.

## Install

Pick one. All three load the mod as `agents-office@skills-dir`.

1. Clone this repo and run `claude` inside it. The mod loads from [`.claude/skills/agents-office/`](.claude/skills/agents-office/).
2. Copy [`.claude/skills/agents-office/`](.claude/skills/agents-office/) into your own project's `.claude/skills/` and start `claude` in that project.
3. Point Claude Code at the folder, from anywhere:

   ```bash
   claude --plugin-dir <path-to>/.claude/skills/agents-office
   # or
   CLAUDE_CODE_PLUGIN_DIRS=<path-to>/.claude/skills/agents-office claude
   ```

To confirm it loaded, run `claude plugin list` and look for `agents-office@skills-dir`.

## Usage

1. Run `/office`. The pane opens only on `/office`; nothing opens by itself.
2. Spawn a subagent, for example with the Agent tool.
3. Watch it walk in through the Lobby door, move between rooms as it calls tools, and leave through the Break Room when it finishes.

## How it works

The tool an agent just called decides its room ([`hooks/activity.ts`](.claude/skills/agents-office/hooks/activity.ts)).

| Room | Sent there by |
| --- | --- |
| Dev Bay | The default desk room of spawned agents. |
| Library | Read, Grep, Glob, NotebookRead, LSP, ReadMcpResourceTool, ListMcpResourcesTool, ReadMcpResourceDirTool. Agents whose subagent type contains "explore" have their desk here. |
| Server Room | Bash, BashOutput, KillShell, Monitor. |
| Phone Booth | WebSearch, WebFetch, and MCP tools whose name contains fetch, http or search. |
| Lobby | Agent and TaskStop calls, spawn walk-ins through the Lobby door, the main session's desk, and completion reports. |
| Meeting Room | A SendMessage between two known agents. |
| Break Room | Finished agents, before they leave. |

Edit, Write, MultiEdit, NotebookEdit, and any tool not listed above (including MCP tools that are not network tools) send an agent to its own desk room: Dev Bay for spawned agents, Library for explore-type agents, Lobby for the main session. Code search that runs through Bash shows in the Server Room, because the office sees only the tool name.

Character color is the model tier: the first of haiku, sonnet, opus, fable found in the model alias given at spawn, otherwise in the resolved model id.

| Tier | Color |
| --- | --- |
| haiku | `#4fc3f7` |
| sonnet | `#66bb6a` |
| opus | `#ffb74d` |
| fable | `#ba68c8` |
| grey | `#9e9e9e` |

Grey means the model is unknown. It is used for the main session and for teammates that were only seen in `agent.list` and never spawned through the hook.

Events:

- Spawn: a new agent appears at the Lobby door and walks to its desk.
- Messaging: when an agent calls SendMessage to another known agent, both walk to the Meeting Room. The sender shows a speech bubble with the first 40 characters of the message for 4 seconds, then both return to what they were doing.
- Completion: a subagent that finishes its turn walks to the Lobby and shows "done" (or "stopped" if the turn did not end with an answer). Its parent, or the main session, shows "got it". It then walks to the Break Room and leaves once at least 5 seconds have passed since it finished.
- Log: the five lines under the map show the newest events (arrivals at a room, messages, reports), oldest first.

## Troubleshooting

- `/office` is not offered: run `claude plugin list` and check that `agents-office@skills-dir` is loaded and enabled.
- The pane shows a line like "Office needs a 60x23 pane, this one is ...": the pane body is smaller than 60x23. Widen or heighten the terminal. Resizing to a valid size redraws at once. See also the first item under Known limits.
- The pane shows "Office needs the terminal surface.": the mod draws on the terminal surface only.
- Something looks wrong: Claude Code's debug log lines from this mod start with `agents-office:`. A line containing `threw` or `refused` marks a failure.

## Known limits

- In some terminals the inline pane opens too short, so `/office` shows the "Office needs a 60x23 pane" line instead of the office. A fix is in progress.
- The office has not yet been checked in a real terminal pane. Frame rate, whether the sprites are legible in your terminal font, and where the speech bubbles land are not confirmed.
- Teammates have no tier color and show grey.
- The `agentId` on a subagent's `tool.call` was observed through a test cast only (the typed test API drops it). Whether a real session delivers it the same way is not confirmed.

## Develop

- `npm install`, then `npm run check`. It runs `validate` (`claude plugin validate`), `typecheck` (`tsc -p tsconfig.json`) and `test` (`claude plugin test`). Validate and test need the `claude` CLI and run locally only. CI runs typecheck only.
- Mod path: [`.claude/skills/agents-office/`](.claude/skills/agents-office/) (manifest [`.claude-plugin/plugin.json`](.claude/skills/agents-office/.claude-plugin/plugin.json), hooks in [`hooks/`](.claude/skills/agents-office/hooks/), state contract in [`types/index.d.ts`](.claude/skills/agents-office/types/index.d.ts)). The API declarations are vendored at [`vendor/claude-code/claude-code.d.ts`](vendor/claude-code/claude-code.d.ts); do not edit that file.
- Hot reload: saving a file in the mod reloads the module in a running session. The office keeps its agents, because state lives in `$.state` atoms declared in `types/index.d.ts` and not in module variables. Module variables hold only caches and timer handles (`loggedFailures`, `loggedBlitDenies`, `lastFrameCells`, `loopTimer`, `refreshTimer` in `register.tsx`; the map cache in `loop.ts`), none of them drawn.
- Design notes: [`docs/agents-office/plan.md`](docs/agents-office/plan.md).
- Code rules: no emoji in code; no `any` or `unknown` without a comment that justifies it; never silence a TypeScript error with `// eslint-disable`.

## Star history

<a href="https://www.star-history.com/#0xnicholasy/claude-mod-agents-rpg&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=0xnicholasy/claude-mod-agents-rpg&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=0xnicholasy/claude-mod-agents-rpg&type=Date" />
    <img alt="Star history chart for 0xnicholasy/claude-mod-agents-rpg" src="https://api.star-history.com/svg?repos=0xnicholasy/claude-mod-agents-rpg&type=Date" />
  </picture>
</a>

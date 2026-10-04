# claude-mod-agents-rpg

Agents Office is a Claude Code mod. It adds an `/office` command that opens a pane showing the agents of the current session as pixel characters. This is the skeleton: the pane currently shows "Office: no agents yet".

Spawned agents walk in from the Lobby door to their room.

## Run

Start `claude` in this repo (the mod lives in `.claude/skills/agents-office/`), enable it for the session, then run `/office`.

## Checks

- `npm install`
- `npm run check` runs validate, typecheck and test. It needs the `claude` CLI.
- `npm run typecheck` is the only check CI runs.

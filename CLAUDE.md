# claude-mod-agents-rpg

A Claude Code mod ("Agents Office"): a pane that shows the session's agents as pixel characters. Written in TypeScript (TSX) as a plugin of function hooks that hot-reloads in a session.

## Stack and commands

- Package manager: npm. Dev dependency: TypeScript 5.x.
- Mod path: `.claude/skills/agents-office/` (manifest in `.claude-plugin/plugin.json`, hooks in `hooks/`, state contract in `types/index.d.ts`).
- Claude Code version the API types came from: 2.1.289. The API declarations are vendored at `vendor/claude-code/claude-code.d.ts`; never edit that file, regenerate it by loading the plugin-authoring skill.
- `npm run check` is the gate. It runs `validate` (`claude plugin validate`), `typecheck` (`tsc -p tsconfig.json`) and `test` (`claude plugin test`). Validate and test need the claude CLI and run locally only; CI runs typecheck.

## Rules

- No emoji in code.
- No `any` or `unknown` without a comment that justifies it.
- Never silence a TypeScript error with `// eslint-disable`.
- State lives in `$.state` atoms declared in `types/index.d.ts`, never in module variables.

## Delivery

- Build with a `sonnet` implementation agent.
- Tests: `npm run check`.
- Docs to update: `README.md`.
- For /implement: after a todo's squash-merge, run `git -C <main checkout> pull --ff-only origin feat/agents-office` so the watched mod folder reloads. Then grep the newest `~/.claude/debug/*.txt` (if present) for `agents-office:` lines and treat any `refused` or `threw` line as a failing check.

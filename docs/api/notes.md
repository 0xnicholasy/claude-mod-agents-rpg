# API notes (Claude Code 2.1.289)

Source: `vendor/claude-code/claude-code.d.ts` (copy of the plugin-authoring types file) and the skill's `reference.md`. Line numbers below refer to the original types file `plugin-authoring/types/claude-code.d.ts` (the vendored copy has a short header prepended, so its lines are offset by a few).

## Spec deviations found during research (read first)

- Pane size: the Pane's render props (`e.props`, original lines ~9775-9815) carry `title: string`, `isFocused: boolean`, `bodyColumns: number` (cells across the body), `placement: 'dock' | 'inline'` (dock = beside the transcript, terminal fullscreen from 110 columns), `scroll: SiteScroll` with `scroll.bodyRows` (rows in the body), and `view: SiteView` (which transcript is on screen; no `agentId` = main). The render input also carries `viewport?: RenderViewport` (9216) with terminal-wide `columns` (9852), `rows` (9859) and `isFullscreen?: boolean` (9872). Size the office from `e.props.bodyColumns` x `e.props.scroll.bodyRows`.
- Mounting a Pane in a test needs props `{ title, isFocused, bodyColumns, placement, scroll: { offset, bodyRows }, view: {} }`: `$.ui.mount({ plugin, surface, component: 'Pane', requestId, props })`, then `find({ type, text })`, `unmount()` (see `hooks/office.test.ts`).
- `claude plugin validate` rejects a bare `export {}` in `types/index.d.ts` and rejects `PluginState` entries that point at an alias: write the entry inline, e.g. `'agents-office': { opened: boolean }`.
- `command.run` input carries `presentation.isFullscreen`.
- `session.start` input is `{ cwd: string; surface: RenderSurface | null; isInteractive: boolean }` (11124-11139). It has no fullscreen flag. Fullscreen is only knowable inside a `ui.render` via `e.viewport?.isFullscreen`.
- An unasked `$.ui.open` (from `session.start` or a timer) seats only from 144 terminal columns and waits below that (SKILL.md).
- `turn.start` input has no `agentId` (`{ text, turnId }`, 12721-12732). `turn.step` and `turn.complete` do carry `agentId?`.
- `SendMessage.to` is typed `unknown & unknown` (15773-15782): narrow at runtime to string.

## Agent tracking

- `tool.call` input: `export type ToolCallInput = ToolCallEnvelope & AgentLoop;` (12103)
- `export type AgentLoop = { agentId?: string; }` (196-206). `agentId` is absent on the main loop; present only for subagents and teammates.
- `Agent` tool input (15203-15220): `{ description: string; prompt: string; subagent_type?: string; model?: "sonnet" | "opus" | "haiku" | "fable"; name?: string; ... }`
- `SendMessage` tool input (15773-15782): `{ to: unknown & unknown; summary?: string; message: string; notify_when_idle?: boolean; }`
- `TaskStop` tool input (15852-15857): `{ task_id?: string; shell_id?: string; }` (accepts an agent id or name per doc comment)
- `turn.step` input (12777-12811): `{ turnId: string; index: number; model: string; effort?: 'low'|'medium'|'high'|'xhigh'|'max'|number; messageCount: number; agentId?: string; }`
- `turn.complete` input (12627-12671): `TurnCompleteFields = { answer: string; durationMs: number; isAborted: boolean; turnId: string; agentId?: string; usage?: TurnUsage; }` & refused/unrefused; reason `'answer' | 'aborted' | 'refusal' | 'error'` (12677)
- `agent.spawn` result (369-394): `export type AgentSpawnResult = { agentId: string; parentAgentId?: string; name?: string; status?: AgentStatus; deny?: { text: string; }; }`
- `$.agent.list()` items (125-186): `export type AgentInfo = { id: string; teammateId?: string; description: string; type: string; status: AgentStatus; parentId?: string; spawnedBy?: string; name?: string; }`
- Shell-hook shapes `SubagentStartHookInput` (11686-11690: `agent_id`, `agent_type`) and `SubagentStopHookInput` (11692-11710) exist; they are the settings-hook payloads, not the function-hook event inputs.

## Drawing

- `$.ui.open: (pane: PaneOpenArgs) => Promise<UiOpenResult>` (2398); `PaneOpenArgs = { id: string; title?: string; focus?: true; closeOnEscape?; holdToasts?; rows?; columns? }` (7058). `$.ui.close: (pane: PaneCloseArgs)` (2410).
- `export type RasterProps = { key: string; columns: number; rows: number; cells: string }` (8746). `columns` 1 to 512, `rows` 1 to 256 (8753-8760).
- Cells (8762-8772): standard padded base64 of `columns * rows` little-endian u32 triplets `[codePoint, foreground, background]`. codePoint is one printable width-1 BMP character. Color is `0x00RRGGBB`, or `0x01000000` for the terminal default.
- `$.ui.blit: (args: UiBlitArgs) => Promise<UiBlitResult>` (2298); `UiBlitArgs = RasterBlitArgs | ImageBlitArgs` (12969); `RasterBlitArgs = { requestId: string; key: string; cells: string; columns?: number; rows?: number }` (8711-8735).
- `BoxProps` (841): `key?`, `hover?`, `position?: 'relative' | 'absolute'`, `top?` (integer, negative OK), `left?` (integer), plus flex props.
- `TextProps` (12011-12027): `color?`, `backgroundColor?`, `dimColor?`, `bold?`, `italic?`, `underline?`, `strikethrough?`, `inverse?`, `wrap?: 'wrap' | 'end' | 'middle' | 'truncate' | 'truncate-start' | 'truncate-middle' | 'truncate-end'`.
- `$.clock.after` / `$.clock.every`: `TimerCall = (ms: number, fn: () => void) => Timer` (3352, 3362, 12065); `Timer = { cancel: () => void }` (12054-12058). A reload drops the previous environment's timers.
- `atom(ref, initial)` (657-659), `read($, atom|derived): Promise<T>` (8785-8788), `update($, atom, fn): Promise<T>` (13835-13837), `derive(sources, compute)` (3648). `PluginState` is an empty interface extended with `declare module 'claude-code' { interface PluginState { '<plugin>': { ... } } }` (7454).
- `$.ui.log: (text: string, options?: { to?: 'transcript' | 'debug' }) => void` (2330, 13295-13300).
- `$.ui.resolve(e)` returns the element table for `e.surface` (2314). Surfaces: `terminal`, `desktop`, `vscode`, `mobile`.

### Example: pane.tsx (verbatim from the skill)

```tsx
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { ToolCall } from '../types'

const PANE = 'tool-calls'
const calls = atom({ plugin: 'tool-calls', key: 'calls' } as const, [])

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tool-calls',
      description: 'Show the tool calls of this session in a pane',
    })
    void $.ui.open({ id: PANE, title: 'Tool calls' })

    return next(e)
  })

  on('command.run', { command: 'tool-calls' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Tool calls' })

    return { text: 'Tool calls pane opened.' }
  })

  on('tool.call', async ($, e, next) => {
    const call: ToolCall = { id: e.tool_use_id, tool: e.tool, isDone: false }
    await update($, calls, list => [...list, call].slice(-200))
    const ran = await next(e)
    await update($, calls, list =>
      list.map(one => (one.id === call.id ? { ...one, isDone: true } : one)),
    )

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, calls)
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 4)

    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>No tool calls yet.</Text>}
        {list.slice(-room).map(call => (
          <Text dimColor={call.isDone}>
            {call.isDone ? 'done' : 'runs'} {call.tool}
          </Text>
        ))}
      </Box>
    )
  })
}
```

### Example: pane-state.d.ts

```ts
export type ToolCall = { id: string; tool: string; isDone: boolean }

declare module 'claude-code' {
  interface PluginState {
    'tool-calls': { calls: ToolCall[] }
  }
}
```

## Testing and loading

- tsconfig from the types header (67-77):

```json
{
  "compilerOptions": {
    "target": "es2023", "lib": ["es2023"], "types": [],
    "module": "esnext", "moduleResolution": "bundler",
    "strict": true, "noUncheckedIndexedAccess": true,
    "noEmit": true, "skipLibCheck": true,
    "jsx": "react", "jsxFactory": "h", "jsxFragmentFactory": "Fragment"
  },
  "include": [".claude-plugin/types", "hooks", "types", "tests"]
}
```

- `claude-code/testing` (14124+): `test(name, [options,] body)` (14137) with `TestBody = ($: Engine, on: On) => unknown` (14146) and `TestOptions = { plugins?, timeoutMs?, options? }` (14154-14169); `describe(name, body)` (14210); `tier(tier)` (14188); `expect` with jest-style matchers incl. `.not`, `.resolves`, `.rejects` (14407).
- `mock.clock` (14729-14773): `{ now(): number; advance(ms): Promise<void>; set(ms): Promise<void>; settle(): Promise<void>; sleep(ms): Promise<void> }`. `mock.store(on, entries?)` (14706), `mock.env(on, variables)` (14713).
- `$.ui.mount(target): Promise<Mounted>` (14335). `Mounted` (14790): `find(query)` (14829), `findAll` (14838), `press` (14852), `input` (14865), `select` (14875), `key` (14886), `pointer` (14895), `post` (14908), `advance(ms)` (14917, frame clock), `resize(size)` (14926), `drawn(scope?)` (14819), `redraw(props?)` (14938), `unmount()` (14946).
- `claude plugin validate <dir>` reads the manifest and module source the way the engine will, reports what the module hooks and calls and everything the engine would refuse, and checks `$.state` keys against the contract.
- `claude plugin test <dir>` runs `*.test.ts` / `*.test.tsx`; default timeout 5000 ms; a test passes when its body resolves.
- Loading: a plugin in a project `.claude/skills/<name>/` (or `--plugin-dir`, `CLAUDE_CODE_PLUGIN_DIRS`) loads as `<name>@skills-dir`. The folder is watched in interactive sessions; a save reloads the module (`register` runs again, old timers dropped, `$.state` kept). Saves during a turn reload when the turn ends. Headless `claude -p` loads fresh; `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` makes long-lived headless sessions watch too.
- `claude --version`: `2.1.289 (Claude Code)`.

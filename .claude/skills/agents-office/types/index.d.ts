export type OfficeOpened = boolean

declare module 'claude-code' {
  interface PluginState {
    'agents-office': { opened: boolean }
  }
}

declare module 'claude-code' {
  interface PluginState {
    imgspike: {
      frame: number
      size: { columns: number; rows: number }
      ticking: boolean
      htmlStatus: string
      htmlRunning: boolean
      htmlBox: { columns: number; rows: number }
    }
  }
}

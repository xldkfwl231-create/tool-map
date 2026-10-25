export type Usage = Record<string, number>
export type DoneState = { seconds: number; isAborted: boolean }

declare module 'claude-code' {
  interface PluginState {
    'tool-map': {
      used: Usage
      active: string[]
      opened: string[]
      selected: string
      last: string
      done: DoneState | null
      usage: number | null
    }
  }
}

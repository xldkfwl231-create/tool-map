export type Usage = Record<string, number>

declare module 'claude-code' {
  interface PluginState {
    'tool-map': { used: Usage; active: string[]; opened: string[]; selected: string; last: string }
  }
}

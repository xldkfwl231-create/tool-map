export type Usage = Record<string, number>
export type DoneState = { seconds: number; isAborted: boolean }
export type TurnCost = {
  model: string
  effort: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  usd: number | null
  limitPct: number | null
}
export type ModelTotal = { turns: number; tokens: number; usd: number; limitPct: number }

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
      lastTurn: TurnCost | null
      byModel: Record<string, ModelTotal>
    }
  }
}

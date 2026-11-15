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
export type GitState = { branch: string; ahead: number; behind: number }
export type TodayTotal = { date: string; prompts: number; usd: number }

declare module 'claude-code' {
  interface PluginState {
    'tool-map': {
      used: Usage
      active: string[]
      last: string
      done: DoneState | null
      usage: number | null
      lastTurn: TurnCost | null
      prompts: number
      git: GitState | null
      today: TodayTotal | null
    }
  }
}

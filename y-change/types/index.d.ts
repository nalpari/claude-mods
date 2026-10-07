// one Edit or Write Claude made: `diff` is unified hunks cut to a few rows, `more` the rows cut,
// `why` the explanation, absent until the turn that made the change ends
export type Change = { id: string; file: string; diff: string; more: number; why?: string }

declare module 'claude-code' {
  interface PluginState {
    'y-change': { changes: Change[] }
  }
}

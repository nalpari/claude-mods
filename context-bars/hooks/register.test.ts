import { expect, test } from 'claude-code/testing'

const cat = (name: string, tokens: number, kind: 'used' | 'free', color: string) =>
  ({ name, tokens, color, isDeferred: false, kind })

const props = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} }

const usage = (autoCompactThreshold?: number) => ({ value: {
  startedAt: 0,
  rateLimits: [],
  context: {
    window: 1000,
    breakdown: {
      categories: [
        cat('Messages', 400, 'used', 'red'), cat('System prompt', 100, 'used', 'blue'),
        cat('Empty', 0, 'used', 'green'), cat('Free space', 500, 'free', 'gray'),
      ],
      totalTokens: 500, maxTokens: 1000, rawMaxTokens: 1000, percentage: 50,
      model: 'm', gridRows: [], memoryFiles: [], mcpTools: [], agents: [], isAutoCompactEnabled: autoCompactThreshold !== undefined,
      apiUsage: null, autocompactSource: 'auto', autoCompactThreshold,
    },
  },
} })

test('band draws a header, one full-width bar with a compaction marker, and a legend', async ($, on) => {
  on('session.usage', async () => usage(900))

  const ui = await $.ui.mount({ plugin: 'context-bars', surface: 'terminal', component: 'AbovePrompt', props })
  const segments = (await ui.findAll({ type: 'Box' })).filter(s => s.props.backgroundColor)
  expect(segments.map(s => [s.props.width, s.props.backgroundColor])).toEqual([
    ['40%', '#d9644a'], ['10%', '#5b8db8'], ['40%', 'subtle'], [1, 'warning'], [undefined, 'subtle'],
  ])
  expect(await ui.find({ type: 'Text', text: /context/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /compacts at/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /50%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /messages 400/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /free 500/ })).toBeDefined()
})

test('the empty track never shares a color with a used segment', async ($, on) => {
  // the engine's real theme keys: the free row and System prompt are both promptBorder
  const real = usage(900)
  real.value.context.breakdown.categories = [
    cat('System prompt', 100, 'used', 'promptBorder'), cat('System tools', 100, 'used', 'inactive'),
    cat('Messages', 300, 'used', 'purple_FOR_SUBAGENTS_ONLY'), cat('Free space', 500, 'free', 'promptBorder'),
  ]
  on('session.usage', async () => real)

  const ui = await $.ui.mount({ plugin: 'context-bars', surface: 'terminal', component: 'AbovePrompt', props })
  const bars = (await ui.findAll({ type: 'Box' })).filter(s => s.props.backgroundColor)
  const used = bars.slice(0, 3).map(s => s.props.backgroundColor)
  const track = bars.at(-1)!.props.backgroundColor
  expect(used).not.toContain(track)
  expect(await ui.find({ type: 'Text', color: track })).toBeDefined()
})

test('without auto-compaction there is no marker', async ($, on) => {
  on('session.usage', async () => usage())

  const ui = await $.ui.mount({ plugin: 'context-bars', surface: 'terminal', component: 'AbovePrompt', props })
  const segments = (await ui.findAll({ type: 'Box' })).filter(s => s.props.backgroundColor)
  expect(segments.map(s => [s.props.width, s.props.backgroundColor])).toEqual([
    ['40%', '#d9644a'], ['10%', '#5b8db8'], [undefined, 'subtle'],
  ])
})

test('the desktop keeps the engine\'s colors', async ($, on) => {
  on('session.usage', async () => usage(900))

  const ui = await $.ui.mount({ plugin: 'context-bars', surface: 'desktop', component: 'AbovePrompt', props })
  const segments = (await ui.findAll({ type: 'Box' })).filter(s => s.props.backgroundColor)
  expect(segments.slice(0, 2).map(s => s.props.backgroundColor)).toEqual(['red', 'blue'])
})

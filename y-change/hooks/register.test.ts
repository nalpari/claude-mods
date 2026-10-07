import { expect, test } from 'claude-code/testing'

const PANE = { plugin: 'y-change', surface: 'terminal', component: 'Pane', requestId: 'y-change' } as const
const props = { title: '변경 이유', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

const hunk = (lines: string[]) => ({ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines })
const edited = (filePath: string, lines: string[]) => ({ result: {
  filePath, oldString: 'a', newString: 'b', originalFile: 'a', structuredPatch: [hunk(lines)], userModified: false, replaceAll: false,
} })
const typed = { command: 'y-change', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const
const turn = { answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const

test('an edit shows its diff at once and its reason once the turn ends', async ($, on) => {
  let asked = ''
  on('turn.complete', async (_, e) => ({ text: e.answer }))
  on('tool.call', async () => edited('/repo/main.rs', ['-let x = 1;', '+let mut x = 1;']))
  on('model.fork', async (_, e) => {
    asked = e.prompt

    return { value: { isAnswered: true, text: '### 1\n`mut` 은 값을 바꿀 수 있게 한다.', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }
  })

  await $.tool.call({ tool: 'Edit', file_path: '/repo/main.rs', old_string: 'a', new_string: 'b' })
  const ui = await $.ui.mount({ ...PANE, props })
  expect(await ui.find({ type: 'Text', text: /main\.rs/ })).toBeDefined()
  const code = await ui.find({ type: 'Code' })
  expect(code?.props.source).toBe('@@ -1,1 +1,1 @@\n-let x = 1;\n+let mut x = 1;')
  expect(code?.props.format).toBe('diff')
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()

  await $.turn.complete(turn)
  expect(asked).toContain('### 1: /repo/main.rs')
  expect(asked).toContain('+let mut x = 1;')
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('`mut` 은 값을 바꿀 수 있게 한다.')
})

test('a long diff is cut to hunks that still parse, and a failed explanation is asked again', async ($, on) => {
  let answers = false
  let asks = 0
  on('turn.complete', async (_, e) => ({ text: e.answer }))
  on('tool.call', async () => edited('/repo/big.py', Array.from({ length: 100 }, (_, i) => `+line ${i}`)))
  on('model.fork', async () => {
    asks++

    return { value: answers
      ? { isAnswered: true, text: '### 1\n이유', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }
      : { isAnswered: false, reason: 'empty-reply', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }
  })

  await $.tool.call({ tool: 'Write', file_path: '/repo/big.py', content: 'x' })
  const ui = await $.ui.mount({ ...PANE, props })
  const source = String((await ui.find({ type: 'Code' }))?.props.source)
  expect(source.split('\n')[0]).toBe('@@ -1,0 +1,80 @@')
  expect(source.split('\n').length).toBe(81)
  expect(await ui.find({ type: 'Text', text: /20줄 더/ })).toBeDefined()

  await $.turn.complete(turn)
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  answers = true
  await $.turn.complete(turn)
  expect(asks).toBe(2)
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('이유')
})

test('a subagent turn asks nothing, and a failed edit is not recorded', async ($, on) => {
  let asks = 0
  on('turn.complete', async (_, e) => ({ text: e.answer }))
  on('tool.call', async () => ({ result: 'no', isError: true }))
  on('model.fork', async () => {
    asks++

    return { value: { isAnswered: false, reason: 'nothing-to-fork' } }
  })

  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' })
  await $.turn.complete({ ...turn, agentId: 'a1' })
  await $.turn.complete(turn)
  expect(asks).toBe(0)
  const ui = await $.ui.mount({ ...PANE, props })
  expect(await ui.find({ type: 'Text', text: /아직 변경이 없습니다/ })).toBeDefined()
})

test('/y-change closes the pane when it is shown and opens it otherwise', async ($, on) => {
  let panes: { id: string; title: string; isShown: boolean; isFocused: boolean; isPlaced: boolean }[] = []
  on('ui.panes', async () => ({ value: panes }))
  on('ui.open', async (_, e) => {
    panes = [{ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: true }]

    return { value: { isPlaced: true } }
  })
  on('ui.close', async () => {
    panes = []

    return { value: undefined }
  })

  expect((await $.command.run(typed)).text).toMatch(/열었습니다/)
  expect(panes.length).toBe(1)
  expect((await $.command.run(typed)).text).toMatch(/닫았습니다/)
  expect(panes.length).toBe(0)
  expect((await $.command.run(typed)).text).toMatch(/열었습니다/)
})

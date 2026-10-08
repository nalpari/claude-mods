import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const props = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} }
const band = (over: Partial<typeof props> = {}) =>
  ({ plugin: 'task-progress', surface: 'terminal', component: 'AbovePrompt', props: { ...props, ...over } }) as const

const todo = (content: string, status: 'pending' | 'in_progress' | 'completed') => ({ content, status, activeForm: `${content}ing` })

// stands in for the engine: every task tool answers as it would, and the band beneath the plugin is another mod's
const engine = (on: On) => {
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['engine band'] }))
  on('session.end', async (_, e) => ({ sessionId: e.sessionId }))
  let id = 0
  on('tool.call', async (_, e) => {
    if (e.tool === 'TodoWrite') return { result: { oldTodos: [], newTodos: e.todos } }
    if (e.tool === 'TaskCreate') return { result: { task: { id: String(++id), subject: e.subject } } }
    if (e.tool === 'TaskUpdate') return { result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }

    return { result: { tasks: [{ id: '9', subject: 'Listed', status: 'completed', blockedBy: [] }] } }
  })
}

test('a todo list draws a bar, the count and the item in progress', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('Build', 'completed'), todo('Test', 'in_progress'), todo('Ship', 'pending'), todo('Wrap', 'pending')] })

  const ui = await $.ui.mount(band())
  expect(await ui.find({ type: 'Text', text: /▰{5}▱{15}/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1\/4/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Testing…/ })).toBeDefined()
  // drawn above the band beneath, not in its place
  expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
})

test('created tasks are counted as they are updated, and a deleted one leaves', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'TodoWrite', todos: [] })
  for (const subject of ['One', 'Two', 'Three']) await $.tool.call({ tool: 'TaskCreate', subject, description: subject })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  expect(await (await $.ui.mount(band())).find({ type: 'Text', text: /1\/3/ })).toBeDefined()

  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'deleted' })
  expect(await (await $.ui.mount(band())).find({ type: 'Text', text: /1\/2/ })).toBeDefined()
})

test('TaskList replaces what was tracked', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('Old', 'pending')] })
  await $.tool.call({ tool: 'TaskList' })

  expect(await (await $.ui.mount(band({ isWorking: true }))).find({ type: 'Text', text: /1\/1/ })).toBeDefined()
})

test('an empty list draws an empty bar and 0/0, even when the turn is over', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'TodoWrite', todos: [] })

  for (const isWorking of [false, true]) {
    const ui = await $.ui.mount(band({ isWorking }))
    expect(await ui.find({ type: 'Text', text: /^task-progress {2}▱{20} {2}0\/0$/ })).toBeDefined()
  }
})

test('nothing is drawn under a survey, or once everything is done and the turn is over', async ($, on) => {
  engine(on)

  await $.tool.call({ tool: 'TodoWrite', todos: [] })
  const survey = await $.ui.mount(band({ hasSurvey: true }))
  expect(await survey.find({ type: 'Text', text: /task-progress/ })).toBeUndefined()
  expect(await survey.find({ type: 'Text', text: /engine band/ })).toBeDefined()

  await $.tool.call({ tool: 'TodoWrite', todos: [todo('A', 'completed'), todo('B', 'completed')] })
  expect(await (await $.ui.mount(band())).find({ type: 'Text', text: /task-progress/ })).toBeUndefined()
  expect(await (await $.ui.mount(band({ isWorking: true }))).find({ type: 'Text', text: /2\/2/ })).toBeDefined()
})

test('a /clear starts the list over, so the next tasks are counted from zero', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('A', 'completed'), todo('B', 'pending')] })
  await $.tool.call({ tool: 'TaskCreate', subject: 'C', description: 'C' })
  expect(await (await $.ui.mount(band({ isWorking: true }))).find({ type: 'Text', text: /1\/3/ })).toBeDefined()

  await $.session.end({ reason: 'clear', sessionId: 'old', resume: { id: 'old' } })
  expect(await (await $.ui.mount(band({ isWorking: true }))).find({ type: 'Text', text: /^task-progress {2}▱{20} {2}0\/0$/ })).toBeDefined()

  await $.tool.call({ tool: 'TaskCreate', subject: 'D', description: 'D' })
  expect(await (await $.ui.mount(band({ isWorking: true }))).find({ type: 'Text', text: /0\/1/ })).toBeDefined()
})

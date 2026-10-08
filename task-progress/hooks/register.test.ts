import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const props = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} }
const band = (over: Partial<typeof props> = {}) =>
  ({ plugin: 'task-progress', surface: 'terminal', component: 'AbovePrompt', props: { ...props, ...over } }) as const

const todo = (content: string, status: 'pending' | 'in_progress' | 'completed') => ({ content, status, activeForm: `${content}ing` })

// stands in for the engine: every task tool answers as it would, and the band beneath the plugin is another mod's
const engine = (on: On) => {
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['engine band'] }))
  let id = 0
  on('tool.call', async (_, e) => {
    if (e.tool === 'TodoWrite') return { result: { oldTodos: [], newTodos: e.todos } }
    if (e.tool === 'TaskCreate') return { result: { task: { id: String(++id), subject: e.subject } } }
    if (e.tool === 'TaskUpdate') return { result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }

    return { result: { tasks: [{ id: '9', subject: 'Listed', status: 'completed', blockedBy: [] }] } }
  })
}

test('a todo list draws a bar to the right edge, the count and the item in progress', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('Build', 'completed'), todo('Test', 'in_progress'), todo('Ship', 'pending'), todo('Wrap', 'pending')] })

  // label, bar and count fill the 100 columns exactly: 13 + 2 + 80 + 2 + 3
  const ui = await $.ui.mount(band())
  expect(await ui.find({ type: 'Text', text: /^task-progress {2}█{20}░{60} {2}1\/4$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▸ Testing…/ })).toBeDefined()
  // drawn above the band beneath, not in its place
  expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
})

test('the bar follows the width of the band, down to five cells', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('Build', 'completed'), todo('Test', 'pending'), todo('Ship', 'pending'), todo('Wrap', 'pending')] })

  expect(await (await $.ui.mount(band({ bodyColumns: 40 }))).find({ type: 'Text', text: /^task-progress {2}█{5}░{15} {2}1\/4$/ })).toBeDefined()
  expect(await (await $.ui.mount(band({ bodyColumns: 20 }))).find({ type: 'Text', text: /^task-progress {2}█{1}░{4} {2}1\/4$/ })).toBeDefined()
})

test('the colors run blue to green along the track, whatever the fill', async ($, on) => {
  engine(on)
  const colors = async () => (await (await $.ui.mount(band({ isWorking: true }))).findAll({ type: 'Text', text: /^█$/ })).map(c => c.props.color)

  await $.tool.call({ tool: 'TodoWrite', todos: [todo('A', 'completed'), todo('B', 'pending'), todo('C', 'pending'), todo('D', 'pending')] })
  const quarter = await colors()
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('A', 'completed'), todo('B', 'completed')] })
  const full = await colors()

  expect(full.length).toBe(80)
  expect(full[0]).toBe('#5b8db8')
  expect(full[79]).toBe('#7fbf6a')
  expect(full[40]).not.toBe(full[0])
  expect(full[40]).not.toBe(full[79])
  // a cell keeps its place on the track as the bar fills
  expect(quarter).toEqual(full.slice(0, 20))
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
    expect(await ui.find({ type: 'Text', text: /^task-progress {2}░{80} {2}0\/0$/ })).toBeDefined()
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

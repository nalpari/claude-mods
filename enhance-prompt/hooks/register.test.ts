import type { ModelCompleteResult, ModelForkResult, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const props = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} }
const band = () => ({ plugin: 'enhance-prompt', surface: 'terminal', component: 'AbovePrompt', props }) as const
const footer = (surface: 'terminal' | 'desktop' = 'terminal') => ({ plugin: 'enhance-prompt', surface, component: 'SessionMode', props: { modes: [] } }) as const
const desktopBand = (over: object = {}) => ({ plugin: 'enhance-prompt', surface: 'desktop', component: 'AbovePrompt', props: { ...props, ...over } }) as const
const typed = (text: string, over: object = {}) => ({ text, wait: false, origin: { kind: 'composer' }, ...over }) as const

const ORIGINAL = '로그인 버그 좀 고쳐줘 제발'
const IMPROVED = '로그인 폼에서 빈 비밀번호가 통과되는 버그를 고쳐줘'

// stands in for the engine: a `$` call is answered as { value }, the model answers as the test says, and every prompt that gets through is recorded
const engine = (on: On, model: { fork?: ModelForkResult; complete?: ModelCompleteResult } = {}) => {
  const entered: string[] = []
  const filled: string[] = []
  const answered = { isAnswered: true, text: IMPROVED, usage } as const
  mock.store(on)
  on('model.fork', async () => ({ value: model.fork ?? answered }))
  on('model.complete', async () => ({ value: model.complete ?? answered }))
  on('prompt.fill', async (_, e) => {
    filled.push(e.text)

    return { isFilled: true }
  })
  on('prompt.submit', async (_, e) => {
    entered.push(e.text)

    return { text: e.text }
  })
  on('ui.render', async () => ({ type: 'Text', props: {}, children: ['engine band'] }))
  on('session.end', async (_, e) => ({ sessionId: e.sessionId }))

  return { entered, filled }
}

test('Enter holds the prompt; 허용 sends the improved one and empties the box', async ($, on) => {
  const { entered, filled } = engine(on)

  const held = await $.prompt.submit(typed(ORIGINAL))
  expect(held.drop).toBeDefined()
  expect(entered).toEqual([])

  const ui = await $.ui.mount(band())
  expect(await ui.find({ type: 'Text', text: ORIGINAL })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: IMPROVED })).toBeDefined()
  // drawn above the band beneath, not in its place
  expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()

  await ui.press({ key: 'accept' })
  expect(entered).toEqual([IMPROVED])
  expect(filled).toEqual([''])
  // decided: the band is gone
  expect(await (await $.ui.mount(band())).find({ key: 'accept' })).toBeUndefined()
})

test('거부 sends the prompt as typed and empties the box', async ($, on) => {
  const { entered, filled } = engine(on)
  await $.prompt.submit(typed(ORIGINAL))

  await (await $.ui.mount(band())).press({ key: 'reject' })
  expect(entered).toEqual([ORIGINAL])
  expect(filled).toEqual([''])
})

test('a model that changes nothing, or cannot answer, sends the prompt as typed', async ($, on) => {
  const { entered } = engine(on, { fork: { isAnswered: true, text: ORIGINAL, usage } })
  await $.prompt.submit(typed(ORIGINAL))
  expect(entered).toEqual([ORIGINAL])
})

test('a failed model call sends the prompt as typed', async ($, on) => {
  const { entered } = engine(on, { fork: { isAnswered: false, reason: 'api-error', status: 500, error: 'overloaded', usage } })
  await $.prompt.submit(typed(ORIGINAL))
  expect(entered).toEqual([ORIGINAL])
})

test('before the first reply there is nothing to fork: it asks without history', async ($, on) => {
  const { entered } = engine(on, { fork: { isAnswered: false, reason: 'nothing-to-fork' } })

  expect((await $.prompt.submit(typed(ORIGINAL))).drop).toBeDefined()
  expect(entered).toEqual([])
})

test('while one prompt waits for the decision, the next one goes as typed', async ($, on) => {
  const { entered } = engine(on)
  await $.prompt.submit(typed(ORIGINAL))
  await $.prompt.submit(typed('그리고 테스트도 같이 돌려줘'))

  expect(entered).toEqual(['그리고 테스트도 같이 돌려줘'])
})

test('prompts that are not plain typed text go through untouched', async ($, on) => {
  const { entered } = engine(on)
  const sent = [
    typed('/compact 해줘 지금 바로'),
    typed('a'),
    typed('x'.repeat(2001)),
    typed('@src/app.ts 이 파일 설명해줘'),
    typed(ORIGINAL, { attachments: [{ type: 'image' }] }),
    typed(ORIGINAL, { turnId: 't1' }),
    typed(ORIGINAL, { origin: { kind: 'task-notification' } }),
  ]
  for (const one of sent) await $.prompt.submit(one)

  expect(entered).toEqual(sent.map(one => one.text))
})

test('/enhance-prompt turns it off and on, and the footer switch says which', async ($, on) => {
  const { entered } = engine(on)
  const label = async () => (await (await $.ui.mount(footer())).find({ key: 'toggle' }))?.props.label
  const run = () => $.command.run({ command: 'enhance-prompt', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

  await run()
  expect(await label()).toBe('enhance-prompt: OFF')
  await $.prompt.submit(typed(ORIGINAL))
  expect(entered).toEqual([ORIGINAL])

  await run()
  expect(await label()).toBe('enhance-prompt: ON')
  expect((await $.prompt.submit(typed(ORIGINAL))).drop).toBeDefined()
})

test('pressing the footer switch turns it off and on', async ($, on) => {
  const { entered } = engine(on)
  const label = async () => (await (await $.ui.mount(footer())).find({ key: 'toggle' }))?.props.label
  const press = async () => (await $.ui.mount(footer())).press({ key: 'toggle' })

  expect(await label()).toBe('enhance-prompt: ON')
  expect(await (await $.ui.mount(footer())).find({ type: 'Text', text: /engine band/ })).toBeDefined()

  await press()
  expect(await label()).toBe('enhance-prompt: OFF')
  await $.prompt.submit(typed(ORIGINAL))
  expect(entered).toEqual([ORIGINAL])

  await press()
  expect(await label()).toBe('enhance-prompt: ON')
  expect((await $.prompt.submit(typed(ORIGINAL))).drop).toBeDefined()
})

// the desktop draws the footer's mode labels as a chip that is there only while a mode is on, so the switch cannot rely on it: it sits in the band
test('on the desktop the switch is in the band above the prompt, not the footer', async ($, on) => {
  const { entered } = engine(on)
  const toggle = async () => (await $.ui.mount(desktopBand())).find({ key: 'toggle' })

  expect((await toggle())?.props.label).toBe('enhance-prompt: ON')
  expect(await (await $.ui.mount(footer('desktop'))).find({ key: 'toggle' })).toBeUndefined()

  await (await $.ui.mount(desktopBand())).press({ key: 'toggle' })
  expect((await toggle())?.props.label).toBe('enhance-prompt: OFF')
  await $.prompt.submit(typed(ORIGINAL))
  expect(entered).toEqual([ORIGINAL])

  await (await $.ui.mount(desktopBand())).press({ key: 'toggle' })
  expect((await toggle())?.props.label).toBe('enhance-prompt: ON')
  expect((await $.prompt.submit(typed(ORIGINAL))).drop).toBeDefined()

  // the switch stays beside the review it does not belong to
  const ui = await $.ui.mount(desktopBand())
  expect(await ui.find({ key: 'accept' })).toBeDefined()
  expect(await ui.find({ key: 'toggle' })).toBeDefined()
})

test('one switch per surface: the terminal band has none, and a survey keeps the desktop band', async ($, on) => {
  engine(on)

  expect(await (await $.ui.mount(band())).find({ key: 'toggle' })).toBeUndefined()
  expect(await (await $.ui.mount(desktopBand({ hasSurvey: true }))).find({ key: 'toggle' })).toBeUndefined()
})

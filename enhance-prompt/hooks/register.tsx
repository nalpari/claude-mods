import type { EngineInterface, PromptSubmitInput, Register } from 'claude-code'

type Clarification = { question: string; answer: string }
type Stage =
  | { kind: 'idle' }
  | { kind: 'enhancing' }
  | { kind: 'asking'; original: string; asked: Clarification[]; question: string }
  | { kind: 'review'; original: string; enhanced: string }
// what the model sends back: one more question, or the improved prompt
type Reply = { question: string } | { enhanced: string }

// prompts outside these bounds go through as typed: "ok" has nothing to improve, a pasted log would be echoed back whole
const MIN_CHARS = 8
const MAX_CHARS = 2000
// a model that keeps asking would never get to the review
const MAX_QUESTIONS = 3
const QUESTION = /^QUESTION:\s*(\S[\s\S]*)/

const ask = (text: string, asked: Clarification[]) => `[enhance-prompt] Rewrite the prompt below, which the user is about to send, so an AI coding assistant understands it better.

- Keep the user's intent, scope and language. Do not answer it, and do not add requirements the user did not state.
- Use this conversation${asked.length > 0 ? ' and the clarifications' : ''} to spell out what the prompt leaves implicit: what "it" or "that" refers to, which files or functions, the result expected, the constraints already stated.
- Keep code, paths, identifiers and quoted text exactly as written.
${asked.length < MAX_QUESTIONS
  ? '- If an essential detail is still unclear and nothing above settles it, reply with one line and nothing else: QUESTION: <one short question, in the user\'s language>. Ask only what would change the rewritten prompt; if nothing essential is unclear, do not ask.'
  : '- Do not ask any more questions: write the best prompt you can from what you have.'}
- Otherwise reply with the rewritten prompt only: no preface, no quotes, no explanation. Use exactly this structure, with the four headings in English as written and what is under them in the user's language. Fill each section only from what the prompt, this conversation and the clarifications say; if a section has nothing, write "-" under it.

[THE JOB]
Description of the task

[THE WHY]
Reason or context for the task

[GUARDRAILS]
Constraints and guidelines

[DONE MEAN]
Completion criteria

<prompt>
${text}
</prompt>${asked.length > 0 ? `

<clarifications>
${asked.map(c => `Q: ${c.question}\nA: ${c.answer}`).join('\n')}
</clarifications>` : ''}`

// what is held between Enter and the person's decision; a module variable like task-progress's list, so a reload drops a review in progress
let stage: Stage = { kind: 'idle' }
let isOn = true

const setStage = ($: EngineInterface, next: Stage) => {
  stage = next
  $.ui.invalidate('ui.render')
}

const toggle = async ($: EngineInterface) => {
  isOn = !isOn
  await $.store.set('isOn', isOn)
  $.ui.invalidate('ui.render')
}

// only the person's own Enter, outside a running turn, on plain text
const isTyped = (e: PromptSubmitInput) =>
  e.origin.kind === 'composer'
  && e.turnId === undefined
  // the held prompt is sent again by the plugin, which expands neither images nor @mentions
  && e.attachments === undefined
  && !/^[/!]/.test(e.text.trim())

const isSkipped = (e: PromptSubmitInput) => {
  const text = e.text.trim()

  return !isTyped(e)
    || /(^|\s)@\S/.test(text)
    || text.length < MIN_CHARS
    || text.length > MAX_CHARS
}

// the next question or the improved prompt, or undefined to send the prompt as typed
const enhance = async ($: EngineInterface, text: string, asked: Clarification[]): Promise<Reply | undefined> => {
  const prompt = ask(text, asked)
  let r = await $.model.fork({ prompt })
  // nothing to fork from before the conversation's first reply, and right after /clear: ask with no history
  if (!r.isAnswered && r.reason === 'nothing-to-fork') {
    r = await $.model.complete({ model: 'haiku', prompt, maxTokens: 2048, timeoutMs: 30_000 })
  }
  const fail = (reason: string) => {
    $.ui.toast(`enhance-prompt: 개선하지 못해 원본을 보냅니다 (${reason})`)

    return undefined
  }
  if (!r.isAnswered) return fail(r.reason)
  const reply = r.text.trim()
  const question = QUESTION.exec(reply)?.[1].trim()
  if (question !== undefined) return asked.length < MAX_QUESTIONS ? { question } : fail('too-many-questions')

  return reply === '' || reply === text.trim() ? undefined : { enhanced: reply }
}

// asks the model once more with everything answered so far; the drop that holds the prompt, or undefined to send it as typed
const converse = async ($: EngineInterface, original: string, asked: Clarification[]) => {
  setStage($, { kind: 'enhancing' })
  let reply: Reply | undefined
  try {
    reply = await enhance($, original, asked)
  } finally {
    if (reply === undefined) setStage($, { kind: 'idle' })
  }
  if (reply === undefined) return undefined

  // the drop leaves what was typed in the box; the question or review shows it as 원본, so empty the box before it is drawn
  await $.prompt.fill({ text: '' })
  if ('question' in reply) {
    setStage($, { kind: 'asking', original, asked, question: reply.question })

    return { drop: '입력창 위의 질문에 답해 주세요.' }
  }
  setStage($, { kind: 'review', original, enhanced: reply.enhanced })

  return { drop: '개선된 프롬프트를 입력창 위에서 확인해 주세요.' }
}

// cleared first, so a second press cannot send it twice; a prompt that cannot be sent goes back to the box
const decide = async ($: EngineInterface, text: string) => {
  setStage($, { kind: 'idle' })
  await $.prompt.submit({ text, asUser: true }).catch(() => $.prompt.fill({ text }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'enhance-prompt', description: '프롬프트 개선 켜기/끄기' })
    isOn = (await $.store.get('isOn')) !== false
    setStage($, { kind: 'idle' })

    return next(e)
  })

  // /clear (or a resume) ends the session and starts the next one without a session.start: a held prompt is not the new session's
  on('session.end', ($, e, next) => {
    setStage($, { kind: 'idle' })

    return next(e)
  })

  on('command.run', { command: 'enhance-prompt' }, async $ => {
    await toggle($)

    return { text: `프롬프트 개선을 ${isOn ? '켰' : '껐'}습니다.` }
  })

  // an open question takes the person's next Enter as its answer; a review or an enhancement already under way leaves later prompts alone: they go as typed
  on('prompt.submit', async ($, e, next) => {
    const held = stage
    if (held.kind === 'asking' && isTyped(e)) {
      const asked = [...held.asked, { question: held.question, answer: e.text.trim() }]

      return (await converse($, held.original, asked)) ?? next({ ...e, text: held.original })
    }
    if (!isOn || held.kind !== 'idle' || isSkipped(e)) return next(e)

    return (await converse($, e.text, [])) ?? next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // the band is one instance: a hook that answers without next hides every other mod's band, so draw above what is beneath
    const below = await next(e)
    const held = stage
    if (e.props.hasSurvey || held.kind === 'idle') return below

    const { Box, Button, Text } = $.ui.resolve(e)
    const title = <Text color="claude">enhance-prompt</Text>

    if (held.kind === 'enhancing') {
      return (
        <Box flexDirection="column">
          <Text wrap="truncate">{title}<Text dimColor>{'  프롬프트를 개선하는 중…'}</Text></Text>
          {below}
        </Box>
      )
    }

    if (held.kind === 'asking') {
      return (
        <Box flexDirection="column">
          <Text>{title}{`  ${held.question}`}</Text>
          <Text dimColor>{`원본  ${held.original}`}</Text>
          <Box>
            <Button key="skip" label="건너뛰기" onPress={() => decide($, held.original)} />
            <Text dimColor>{'  입력창에 답하고 Enter · 건너뛰면 입력한 원본을 보냅니다'}</Text>
          </Box>
          {below}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text>{title}{'  개선된 프롬프트를 보낼까요?'}</Text>
        <Text dimColor>{`원본  ${held.original}`}</Text>
        <Text>{`개선  ${held.enhanced}`}</Text>
        <Box>
          <Button key="accept" label="허용" hotkey="y" variant="primary" onPress={() => decide($, held.enhanced)} />
          <Text>{'  '}</Text>
          <Button key="reject" label="거부" hotkey="n" onPress={() => decide($, held.original)} />
          <Text dimColor>{'  거부하면 입력한 원본을 보냅니다'}</Text>
        </Box>
        {below}
      </Box>
    )
  })

  // the desktop's footer is a chip that is there only while a mode is on, so there the switch sits in the band above the prompt;
  // the terminal has none: mod-switch's pane or /enhance-prompt switches it
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.surface === 'terminal' || e.props.hasSurvey) return below

    const { Box, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {below}
        <Box>
          <Button key="toggle" label={`enhance-prompt: ${isOn ? 'ON' : 'OFF'}`} variant={isOn ? 'primary' : 'secondary'} onPress={() => toggle($)} />
        </Box>
      </Box>
    )
  })
}

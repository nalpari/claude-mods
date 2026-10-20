import type { EngineInterface, PromptSubmitInput, Register } from 'claude-code'

type Stage = { kind: 'idle' } | { kind: 'enhancing' } | { kind: 'review'; original: string; enhanced: string }

// prompts outside these bounds go through as typed: "ok" has nothing to improve, a pasted log would be echoed back whole
const MIN_CHARS = 8
const MAX_CHARS = 2000

const ask = (text: string) => `[enhance-prompt] Rewrite the prompt below, which the user is about to send, so an AI coding assistant understands it better.

- Keep the user's intent, scope and language. Do not answer it, and do not add requirements the user did not state.
- Use this conversation to spell out what the prompt leaves implicit: what "it" or "that" refers to, which files or functions, the result expected, the constraints already stated.
- Keep code, paths, identifiers and quoted text exactly as written.
- Reply with the rewritten prompt only: no preface, no quotes, no explanation. If the prompt is already clear, reply with it unchanged.

<prompt>
${text}
</prompt>`

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
const isSkipped = (e: PromptSubmitInput) => {
  const text = e.text.trim()

  return e.origin.kind !== 'composer'
    || e.turnId !== undefined
    // the held prompt is sent again by the plugin, which expands neither images nor @mentions
    || e.attachments !== undefined
    || /(^|\s)@\S/.test(text)
    || /^[/!]/.test(text)
    || text.length < MIN_CHARS
    || text.length > MAX_CHARS
}

// the improved text, or undefined to send the prompt as typed
const enhance = async ($: EngineInterface, text: string) => {
  const prompt = ask(text)
  let r = await $.model.fork({ prompt })
  // nothing to fork from before the conversation's first reply, and right after /clear: ask with no history
  if (!r.isAnswered && r.reason === 'nothing-to-fork') {
    r = await $.model.complete({ model: 'haiku', prompt, maxTokens: 2048, timeoutMs: 30_000 })
  }
  if (!r.isAnswered) {
    $.ui.toast(`enhance-prompt: 개선하지 못해 원본을 보냅니다 (${r.reason})`)

    return undefined
  }
  const enhanced = r.text.trim()

  return enhanced === '' || enhanced === text.trim() ? undefined : enhanced
}

// cleared first, so a second press cannot send it twice; the box still holds what was typed (the drop leaves it), so it is emptied too,
// and a prompt that cannot be sent goes back to it
const decide = async ($: EngineInterface, text: string) => {
  setStage($, { kind: 'idle' })
  await $.prompt.fill({ text: '' })
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

  // a review or an enhancement already under way leaves later prompts alone: they go as typed
  on('prompt.submit', async ($, e, next) => {
    if (!isOn || stage.kind !== 'idle' || isSkipped(e)) return next(e)

    setStage($, { kind: 'enhancing' })
    let enhanced: string | undefined
    try {
      enhanced = await enhance($, e.text)
    } finally {
      if (enhanced === undefined) setStage($, { kind: 'idle' })
    }
    if (enhanced === undefined) return next(e)

    setStage($, { kind: 'review', original: e.text, enhanced })

    return { drop: '개선된 프롬프트를 입력창 위에서 확인해 주세요.' }
  })

  // the status line is text only and cannot be pressed, so the switch is a Button drawn beside the footer's mode labels;
  // the desktop's footer is a chip that is there only while a mode is on, so there the switch sits in the band above the prompt
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const below = await next(e)
    if (e.surface !== 'terminal') return below

    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box>
        {below}
        <Text>{' '}</Text>
        <Button key="toggle" label={`enhance-prompt: ${isOn ? 'ON' : 'OFF'}`} variant={isOn ? 'primary' : 'secondary'} onPress={() => toggle($)} />
      </Box>
    )
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

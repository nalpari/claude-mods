import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Change } from '../types'

const PANE = 'y-change'
const TITLE = '변경 이유'
// changes kept, and diff rows drawn per change
const MAX_CHANGES = 30
const MAX_ROWS = 80

const changes = atom({ plugin: 'y-change', key: 'changes' } as const, [])

type Hunk = { oldStart: number; newStart: number; lines: string[] }

// the tool's patch as unified hunks, cut to MAX_ROWS; a cut hunk gets its counts again so it still parses
const toDiff = (hunks: readonly Hunk[]) => {
  let room = MAX_ROWS
  const out: string[] = []

  for (const hunk of hunks) {
    if (room <= 0) break
    const lines = hunk.lines.slice(0, room)
    room -= lines.length
    const count = (mark: string) => lines.filter(l => l[0] === ' ' || l[0] === mark).length
    out.push(`@@ -${hunk.oldStart},${count('-')} +${hunk.newStart},${count('+')} @@`, ...lines)
  }

  const total = hunks.reduce((n, hunk) => n + hunk.lines.length, 0)

  return { diff: out.join('\n'), more: total - (MAX_ROWS - room) }
}

// asked over the session's own transcript, so the model answers from why it made the change
const ask = (pending: readonly Change[]) => `[y-change] For each code change below, which you made earlier in this conversation, explain it to a reader who has never used this programming language. Write in the language the user has been writing in.

For each change cover:
1. What changed: in plain words, line by line where that helps.
2. Why: the reason for this change in this conversation (the request, the bug, the constraint that led to it). If the conversation does not show the reason, say so instead of guessing.
3. Language notes: each piece of syntax, keyword or library call in the diff a newcomer to the language would not know, in a sentence each.

Start each change's explanation with a line holding exactly \`### <number>\`, then markdown. Write nothing before the first such line.

${pending.map((c, i) => `### ${i + 1}: ${c.file}\n\`\`\`diff\n${c.diff}\n\`\`\``).join('\n\n')}`

// '### 1\n…\n### 2\n…' -> the texts by their number
const parse = (text: string) => {
  const parts = text.split(/^### (\d+).*$/m)
  const whys = new Map<number, string>()
  for (let i = 1; i < parts.length; i += 2) whys.set(Number(parts[i]), (parts[i + 1] ?? '').trim())

  return whys
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'y-change', description: '코드 변경 이유 pane 열기/닫기' })

    return next(e)
  })

  // a toggle; a pane waiting undrawn (opened unasked in a narrow terminal) is opened, not closed
  on('command.run', { command: 'y-change' }, async $ => {
    const isShown = (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)
    if (isShown) {
      await $.ui.close({ id: PANE })

      return { text: '변경 이유 pane을 닫았습니다.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: '변경 이유 pane을 열었습니다.' }
  })

  on('tool.call', { tool: ['Edit', 'Write'] }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true || ran.result.staged) return ran

    const { diff, more } = toDiff(ran.result.structuredPatch)
    if (diff === '') return ran

    const change: Change = { id: e.tool_use_id, file: ran.result.gitDiff?.filename ?? ran.result.filePath, diff, more }
    await update($, changes, list => [...list, change].slice(-MAX_CHANGES))

    return ran
  })

  // one question per turn for everything it changed; what stays unexplained is asked again next turn
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done

    const pending = (await read($, changes)).filter(c => c.why === undefined)
    if (pending.length === 0) return done

    const asked = await $.model.fork({ prompt: ask(pending) })
    if (!asked.isAnswered) {
      $.ui.toast(`y-change: 변경 이유를 만들지 못했습니다 (${asked.reason})`)

      return done
    }

    const whys = parse(asked.text)
    const byId = new Map(pending.map((c, i) => [c.id, whys.get(i + 1)]))
    await update($, changes, list => list.map(c => (byId.get(c.id) ? { ...c, why: byId.get(c.id) } : c)))

    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Code, Markdown } = $.ui.resolve(e)
    const list = await read($, changes)

    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>아직 변경이 없습니다. Claude가 파일을 수정하면 diff와 변경 이유가 여기에 표시됩니다.</Text>}
        {/* newest first, so the latest change shows without scrolling */}
        {[...list].reverse().map(c => (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold>{c.file}</Text>
            <Code source={c.diff} path={c.file} format="diff" />
            {c.more > 0 && <Text dimColor>… {c.more}줄 더</Text>}
            {c.why === undefined
              ? <Text dimColor>이번 턴이 끝나면 변경 이유를 설명합니다.</Text>
              : <Markdown text={c.why} />}
          </Box>
        ))}
      </Box>
    )
  })
}

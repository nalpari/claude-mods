import type { Register } from 'claude-code'

type Item = { id: string; label: string; status: 'pending' | 'in_progress' | 'completed' }

// the track's colors, left to right; a cell keeps its color as the bar fills, so a fuller bar reaches further along it
const BLUE: [number, number, number] = [0x5b, 0x8d, 0xb8]
const TEAL: [number, number, number] = [0x4f, 0xb6, 0xb2]
const GREEN: [number, number, number] = [0x7f, 0xbf, 0x6a]

const LABEL = 'task-progress'
// fewest cells the bar gets
const MIN_WIDTH = 5

// the color t (0..1) along the track
const at = (t: number) => {
  const [r, g, b] = t < 0.5 ? BLUE : TEAL
  const [r2, g2, b2] = t < 0.5 ? TEAL : GREEN
  const k = t < 0.5 ? t * 2 : t * 2 - 1
  const hex = (from: number, to: number) => Math.round(from + (to - from) * k).toString(16).padStart(2, '0')

  return `#${hex(r, r2)}${hex(g, g2)}${hex(b, b2)}`
}

// the task list as the tools below last left it; TodoWrite and TaskList send the whole list,
// TaskCreate and TaskUpdate one change. A task made before the mod loaded is unknown to
// TaskCreate/TaskUpdate until TaskList is called.
let items: Item[] = []

export const register: Register = on => {
  on('session.start', ($, e, next) => {
    items = []

    return next(e)
  })

  // subagents keep their own lists: only the main loop's calls count
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true || e.agentId !== undefined) return ran

    items = ran.result.newTodos.map((t, i) => ({ id: String(i), label: t.activeForm, status: t.status }))
    $.ui.invalidate('ui.render')

    return ran
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true || e.agentId !== undefined) return ran

    items = [...items, { id: ran.result.task.id, label: e.activeForm ?? ran.result.task.subject, status: 'pending' }]
    $.ui.invalidate('ui.render')

    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true || e.agentId !== undefined || !ran.result.success) return ran

    const { taskId, status } = e
    items = status === 'deleted'
      ? items.filter(i => i.id !== taskId)
      : items.map(i => i.id === taskId ? { ...i, label: e.activeForm ?? e.subject ?? i.label, status: status ?? i.status } : i)
    $.ui.invalidate('ui.render')

    return ran
  })

  on('tool.call', { tool: 'TaskList' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true || e.agentId !== undefined) return ran

    // TaskList has no activeForm: keep the label a known task already has
    items = ran.result.tasks.map(t => ({ id: t.id, label: items.find(i => i.id === t.id)?.label ?? t.subject, status: t.status }))
    $.ui.invalidate('ui.render')

    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // the band is one instance: a hook that answers without next hides every other mod's band, so draw above what is beneath
    const below = await next(e)
    const done = items.filter(i => i.status === 'completed').length
    const isFinished = items.length > 0 && done === items.length

    // an empty list shows 0/0; a finished one stays while the turn runs, then goes
    if (e.props.hasSurvey || (isFinished && !e.props.isWorking)) return below

    const { Box, Text } = $.ui.resolve(e)
    const active = items.find(i => i.status === 'in_progress')
    const count = `${done}/${items.length}`
    // the label, the count and the two gaps are fixed; the bar takes the rest of the row
    const width = Math.max(MIN_WIDTH, e.props.bodyColumns - LABEL.length - count.length - 4)
    // floor, so the bar is only full when every task is done
    const filled = items.length === 0 ? 0 : Math.floor((width * done) / items.length)

    return (
      <Box flexDirection="column">
        <Text wrap="truncate">
          <Text color="claude">{LABEL}</Text>{'  '}
          {Array.from({ length: filled }, (_, i) => <Text color={at(i / (width - 1))}>█</Text>)}
          <Text dimColor>{'░'.repeat(width - filled)}</Text>
          {'  '}
          <Text bold>{count}</Text>
        </Text>
        {active && <Text wrap="truncate" dimColor>{`▸ ${active.label}…`}</Text>}
        {below}
      </Box>
    )
  })
}

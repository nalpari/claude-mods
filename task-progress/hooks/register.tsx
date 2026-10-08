import type { Register } from 'claude-code'

type Item = { id: string; label: string; status: 'pending' | 'in_progress' | 'completed' }

// widest the bar gets, in cells
const WIDTH = 20

// the task list as the tools below last left it; TodoWrite and TaskList send the whole list,
// TaskCreate and TaskUpdate one change. A task made before the mod loaded is unknown to
// TaskCreate/TaskUpdate until TaskList is called.
let items: Item[] = []

export const register: Register = on => {
  on('session.start', ($, e, next) => {
    items = []

    return next(e)
  })

  // /clear (or a resume) ends the session and starts the next one without a session.start: the old list is not the new session's
  on('session.end', ($, e, next) => {
    items = []
    $.ui.invalidate('ui.render')

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
    const width = Math.max(5, Math.min(WIDTH, Math.floor(e.props.bodyColumns / 4)))
    // floor, so the bar is only full when every task is done
    const filled = items.length === 0 ? 0 : Math.floor((width * done) / items.length)

    return (
      <Box flexDirection="column">
        <Text wrap="truncate">
          <Text color="claude">task-progress</Text>{'  '}
          <Text color="success">{'▰'.repeat(filled)}</Text>
          <Text dimColor>{'▱'.repeat(width - filled)}</Text>
          {'  '}
          <Text bold>{`${done}/${items.length}`}</Text>
          {active && <Text dimColor>{`  ·  ${active.label}…`}</Text>}
        </Text>
        {below}
      </Box>
    )
  })
}

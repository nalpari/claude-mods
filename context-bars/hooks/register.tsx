import type { Register } from 'claude-code'

// legend labels, lower-cased; a category not listed keeps its own name
const SHORT: Record<string, string> = {
  'system tools': 'tools',
  'custom agents': 'agents',
  'free space': 'free',
}

// the engine names each row by theme key, and the terminal's dark theme paints System prompt
// (promptBorder) and System tools (inactive) in near-identical greys; the desktop has its own palette.
// A category not listed keeps the engine's color.
const TERMINAL_COLORS: Record<string, string> = {
  'System prompt': '#5b8db8',
  'System tools': '#4fb6b2',
  'MCP tools': '#9d7bf0',
  'Custom agents': '#7fbf6a',
  'Memory files': '#e6b655',
  'Skills': '#f08fb4',
  'Messages': '#d9644a',
}

// 4200 -> 4.2k, 52000 -> 52k, 1000000 -> 1M
const fmt = (n: number) =>
  n >= 999_500 ? `${+(n / 1e6).toFixed(1)}M`
  : n >= 1e4 ? `${Math.round(n / 1e3)}k`
  : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k`
  : `${n}`

export const register: Register = on => {
  // redraw once the window has changed
  on('turn.complete', ($, e, next) => {
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // the band is one instance: a hook that answers without next hides every other mod's band, so draw above what is beneath
    const below = await next(e)
    const { context } = await $.session.usage({ breakdown: 'summary' })
    const b = context.breakdown

    if (e.props.hasSurvey || !b) return below

    const { Box, Text } = $.ui.resolve(e)
    // deferred rows sit outside the window and the buffer is drawn as part of the track
    const used = b.categories.filter(c => c.kind === 'used')
      .map(c => e.surface === 'terminal' ? { ...c, color: TERMINAL_COLORS[c.name] ?? c.color } : c)
    // the engine paints Free space promptBorder, System prompt's color too: recolor it so the track reads as empty
    const track = 'subtle'
    const found = b.categories.find(c => c.kind === 'free')
    const free = found && { ...found, color: track }
    if (used.length === 0) return below

    const total = Math.max(b.rawMaxTokens, b.totalTokens)
    const pct = (n: number) => Math.round((n / total) * 100)
    const compact = b.autoCompactThreshold
    const percent = Math.round(b.percentage)

    // whole-percent widths from cumulative edges, so they never add past 100%
    let sum = 0
    const segments = used.map(c => {
      const from = pct(sum)
      sum += c.tokens

      return { c, w: pct(sum) - from }
    }).filter(s => s.w > 0)
    // the track up to the compaction marker; the flexible one after it takes the rest
    const gap = compact === undefined ? 0 : Math.floor((compact / total) * 100) - pct(sum)

    const legend = free ? [...used, free] : used
    const cols = e.props.bodyColumns >= 80 ? 4 : 2
    const lines = Array.from({ length: Math.ceil(legend.length / cols) }, (_, i) => legend.slice(i * cols, (i + 1) * cols))

    return (
      <Box flexDirection="column">
        {below}
        <Box justifyContent="space-between">
          <Text wrap="truncate">
            <Text color="claude">◆</Text> <Text bold>context</Text>
          </Text>
          <Text wrap="truncate">
            <Text bold>{fmt(b.totalTokens)}</Text>
            <Text dimColor> of {fmt(b.rawMaxTokens)}{compact === undefined ? '' : ' · compacts at '}</Text>
            {compact === undefined ? null : <Text bold>{fmt(compact)}</Text>}
            {'  '}
            <Text bold inverse color={percent >= 90 ? 'error' : percent >= 70 ? 'warning' : 'success'}> {percent}% </Text>
          </Text>
        </Box>
        {/* segments are percent-wide Boxes with a background, so the layout fits the band
            whatever its cell metric */}
        <Box width="100%" height={1}>
          {segments.map(({ c, w }) => <Box width={`${w}%`} height={1} backgroundColor={c.color} />)}
          {gap > 0 ? <Box width={`${gap}%`} height={1} backgroundColor={track} /> : null}
          {compact === undefined ? null : <Box width={1} height={1} backgroundColor="warning" />}
          <Box flexGrow={1} height={1} backgroundColor={track} />
        </Box>
        {lines.map(line => (
          <Box>
            {line.map(c => {
              const name = c.name.toLowerCase()

              return (
                <Box width={`${100 / cols}%`}>
                  <Text wrap="truncate">
                    <Text color={c.color}>■</Text> {SHORT[name] ?? name} <Text bold>{fmt(c.tokens)}</Text>
                    {c.kind === 'free' ? null : <Text dimColor> {pct(c.tokens)}%</Text>}
                  </Text>
                </Box>
              )
            })}
          </Box>
        ))}
      </Box>
    )
  })
}

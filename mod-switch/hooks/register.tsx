import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Mod } from '../types'

const PANE = 'mod-switch'
const TITLE = 'mods'

const mods = atom({ plugin: 'mod-switch', key: 'mods' } as const, [])

type Installed = { id: string; scope: string; enabled: boolean; installPath: string; projectPath?: string }

// a mod is a plugin whose hooks.json names a hooks module; the others (skills, MCP servers) are not this pane's to switch
const isMod = async ($: EngineInterface, dir: string) => {
  try {
    return 'modules' in JSON.parse(await $.fs.read(`${dir}/hooks/hooks.json`))
  } catch {
    return false
  }
}

// the mods installed for this session (user scope, or this project's), on or off
const load = async ($: EngineInterface) => {
  const root = await $.session.root()
  const { stdout } = await $.process.run(['claude', 'plugin', 'list', '--json'])
  const list: Mod[] = []
  for (const p of JSON.parse(stdout) as Installed[]) {
    if ((p.projectPath ?? root) === root && await isMod($, p.installPath)) list.push({ id: p.id, scope: p.scope, enabled: p.enabled })
  }
  await update($, mods, () => list)
}

// the CLI writes the setting; /reload-plugins makes the running session follow it. The switch is flipped before the reload, which reloads this module too
const flip = async ($: EngineInterface, id: string, scope: string) => {
  const same = (m: Mod) => m.id === id && m.scope === scope
  const mod = (await read($, mods)).find(same)
  if (mod === undefined) return

  const ran = await $.process.run(['claude', 'plugin', mod.enabled ? 'disable' : 'enable', id, '--scope', scope])
  if (ran.exitCode !== 0) {
    $.ui.toast(`mod-switch: ${id} 전환 실패 (${(ran.stderr || ran.stdout).trim()})`)

    return
  }
  await update($, mods, list => list.map(m => (same(m) ? { ...m, enabled: !mod.enabled } : m)))
  await $.command.run({ command: 'reload-plugins' }).catch(() => $.ui.toast('mod-switch: /reload-plugins 를 직접 실행하면 적용됩니다'))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'mod-switch', description: '설치된 mod 목록 pane 열기/닫기' })

    return next(e)
  })

  // a toggle; a pane waiting undrawn (opened unasked in a narrow terminal) is opened, not closed
  on('command.run', { command: 'mod-switch' }, async $ => {
    const isShown = (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced)
    if (isShown) {
      await $.ui.close({ id: PANE })

      return { text: 'mod 목록 pane을 닫았습니다.' }
    }
    // read afresh at each opening: /plugin may have installed or switched mods since
    await load($)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'mod 목록 pane을 열었습니다.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, mods)

    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>설치된 mod가 없습니다.</Text>}
        {list.map(m => (
          <Box marginBottom={1}>
            {/* switching itself off would take this pane, and the way back, with it */}
            {m.id.split('@')[0] === $.plugin.name
              ? <Text dimColor>{'  -  '}</Text>
              : <Button key={`${m.id}/${m.scope}`} label={m.enabled ? '●  ON' : '○ OFF'} variant={m.enabled ? 'primary' : 'secondary'} onPress={() => flip($, m.id, m.scope)} />}
            <Text wrap="truncate" dimColor={!m.enabled}>{`  ${m.id}`}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}

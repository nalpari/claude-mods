import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const PANE = { plugin: 'mod-switch', surface: 'terminal', component: 'Pane', requestId: 'mod-switch' } as const
const props = { title: 'mods', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
const typed = { command: 'mod-switch', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

const ROOT = '/repo'
const entry = (id: string, enabled: boolean, over: object = {}) => ({ id, scope: 'user', enabled, installPath: `/cache/${id}`, ...over })
// which of the installed plugins hold a hooks module; the rest are skills only
const MODS = new Set(['/cache/y-change@mods', '/cache/enhance-prompt@mods', '/cache/mod-switch@mods', '/cache/other@mods'])

// stands in for the engine: the plugin list, the files, the CLI that switches, the pane list and the reload; every argv and command is recorded
const engine = (on: On, installed: object[], cli = { exitCode: 0, stderr: '' }) => {
  const ran: string[] = []
  const commands: string[] = []
  const toasts: string[] = []
  let panes: { id: string; title: string; isShown: boolean; isFocused: boolean; isPlaced: boolean }[] = []
  on('session.root', async () => ({ value: ROOT }))
  on('process.run', async (_, e) => {
    ran.push(e.argv.join(' '))
    if (e.argv[2] === 'list') return { value: { exitCode: 0, stdout: JSON.stringify(installed), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }

    return { value: { exitCode: cli.exitCode, stdout: '', stderr: cli.stderr, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.read', async (_, e) => {
    if (!MODS.has(e.path.replace('/hooks/hooks.json', ''))) throw new Error('ENOENT')

    return { value: '{ "modules": ["./register.tsx"] }' }
  })
  on('command.run', async (_, e) => {
    commands.push(e.command)

    return { text: '' }
  })
  on('ui.toast', async (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.panes', async () => ({ value: panes }))
  on('ui.open', async (_, e) => {
    panes = [{ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: true }]

    return { value: { isPlaced: true } }
  })
  on('ui.close', async () => {
    panes = []

    return { value: undefined }
  })

  return { ran, commands, toasts, shown: () => panes.length > 0 }
}

const installed = [
  entry('y-change@mods', true),
  entry('enhance-prompt@mods', false),
  entry('mod-switch@mods', true),
  entry('superpowers@official', true),
  entry('other@mods', true, { scope: 'project', projectPath: '/elsewhere' }),
]

test('the pane lists the installed mods, each switch showing on or off; skills-only plugins and other projects are left out', async ($, on) => {
  engine(on, installed)
  await $.command.run(typed)

  const ui = await $.ui.mount({ ...PANE, props })
  expect(await ui.find({ type: 'Button', key: 'y-change@mods/user' })).toBeDefined()
  expect((await ui.find({ type: 'Button', key: 'y-change@mods/user' }))?.props.label).toBe('●  ON')
  expect((await ui.find({ type: 'Button', key: 'enhance-prompt@mods/user' }))?.props.label).toBe('○ OFF')
  expect(await ui.find({ type: 'Text', text: /superpowers/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /other@mods/ })).toBeUndefined()
})

test('this mod is listed without a switch', async ($, on) => {
  engine(on, installed)
  await $.command.run(typed)

  const ui = await $.ui.mount({ ...PANE, props })
  expect(await ui.find({ type: 'Text', text: /mod-switch@mods/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'mod-switch@mods/user' })).toBeUndefined()
})

test('pressing a switch turns the mod off through the CLI, reloads, and draws it off; pressing again turns it on', async ($, on) => {
  const { ran, commands } = engine(on, installed)
  await $.command.run(typed)
  const ui = await $.ui.mount({ ...PANE, props })

  await ui.press({ key: 'y-change@mods/user' })
  expect(ran).toContain('claude plugin disable y-change@mods --scope user')
  expect(commands).toEqual(['reload-plugins'])
  expect((await ui.find({ type: 'Button', key: 'y-change@mods/user' }))?.props.label).toBe('○ OFF')

  await ui.press({ key: 'y-change@mods/user' })
  expect(ran).toContain('claude plugin enable y-change@mods --scope user')
  expect((await ui.find({ type: 'Button', key: 'y-change@mods/user' }))?.props.label).toBe('●  ON')
})

test('a switch the CLI refuses stays where it was, and says why', async ($, on) => {
  const { commands, toasts } = engine(on, installed, { exitCode: 1, stderr: 'no such plugin' })
  await $.command.run(typed)
  const ui = await $.ui.mount({ ...PANE, props })

  await ui.press({ key: 'y-change@mods/user' })
  expect((await ui.find({ type: 'Button', key: 'y-change@mods/user' }))?.props.label).toBe('●  ON')
  expect(commands).toEqual([])
  expect(toasts[0]).toMatch(/no such plugin/)
})

test('/mod-switch closes the pane when it is shown and opens it otherwise', async ($, on) => {
  const { shown } = engine(on, installed)

  expect((await $.command.run(typed)).text).toMatch(/열었습니다/)
  expect(shown()).toBe(true)
  expect((await $.command.run(typed)).text).toMatch(/닫았습니다/)
  expect(shown()).toBe(false)
  expect((await $.command.run(typed)).text).toMatch(/열었습니다/)
})

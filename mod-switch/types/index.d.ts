// one installed mod: `id` is `<name>@<marketplace>`, `scope` where it was installed (user, project, local)
export type Mod = { id: string; scope: string; enabled: boolean }

declare module 'claude-code' {
  interface PluginState {
    'mod-switch': { mods: Mod[] }
  }
}

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

function load(file) {
  const built = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external', loader: { '.svg': 'dataurl' } })
  const mod = new Module(path.resolve(file), module)
  mod.filename = path.resolve(file); mod.paths = module.paths
  mod._compile(built.outputFiles[0].text, mod.filename)
  return mod.exports
}

test('settings navigation exposes profile and core sections without API settings', () => {
  const { Sidebar } = load('src/renderer/src/components/sidebar/Sidebar.tsx')
  const html = renderToStaticMarkup(React.createElement(Sidebar, { mainView: 'settings' }))
  for (const label of ['Профиль', 'Оформление', 'Агент', 'Безопасность', 'Данные']) assert.match(html, new RegExp(label))
  assert.doesNotMatch(html, /Модель и API|Интернет-поиск/)
})

test('agent instruction is passed to the next request without trimming', () => {
  const { toChatConfig } = load('src/renderer/src/services/settingsService.ts')
  const config = toChatConfig({ defaultModel: 'pro', systemPrompt: 'Follow these rules. ', accessMode: 'confirm' })
  assert.equal(config.systemPrompt, 'Follow these rules. ')
  assert.equal(config.accessMode, 'confirm')
  assert.equal(config.model, 'pro')
})

test('a saved terminal shell applies to new agent requests and invalid saved profiles use Auto', () => {
  const { loadSettings, saveSettings, toChatConfig } = load('src/renderer/src/services/settingsService.ts')
  const previousStorage = global.localStorage
  let raw = null
  global.localStorage = { getItem: () => raw, setItem: (_, value) => { raw = value } }
  try {
    assert.equal(loadSettings().terminalShell, 'auto')
    assert.equal(saveSettings({ ...loadSettings(), terminalShell: 'cmd' }), true)
    assert.equal(loadSettings().terminalShell, 'cmd')
    assert.equal(toChatConfig(loadSettings()).terminalShell, 'cmd')
    raw = JSON.stringify({ terminalShell: 'unknown' })
    assert.equal(loadSettings().terminalShell, 'auto')
  } finally { global.localStorage = previousStorage }
})

test('settings autosave debounces, flushes latest draft and retains it after failure', async () => {
  const { createSettingsAutosave } = load('src/renderer/src/services/settingsAutosave.ts')
  const saved = []
  let succeeds = false
  const saver = createSettingsAutosave(value => { saved.push(value); return succeeds }, () => {}, 15)
  saver.update({ text: 'hello ' })
  saver.update({ text: 'hello world ' })
  assert.equal(saver.flush(), false)
  assert.deepEqual(saved, [{ text: 'hello world ' }])
  succeeds = true
  assert.equal(saver.flush(), true)
  saver.update({ text: 'next ' })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.deepEqual(saved.at(-1), { text: 'next ' })
  assert.equal(saved.length, 3)
  saver.dispose()
})

test('a failed draft only restores edited fields over current saved settings', () => {
  const { mergeSettingsDraft } = load('src/renderer/src/services/settingsAutosave.ts')
  const saved = { accessMode: 'read-only', systemPrompt: 'old', theme: 'oled' }
  assert.deepEqual(mergeSettingsDraft(saved, { systemPrompt: 'new' }), { accessMode: 'read-only', systemPrompt: 'new', theme: 'oled' })
})

test('older saved context limits cannot override the fixed context budget', () => {
  const { loadSettings, toChatConfig } = load('src/renderer/src/services/settingsService.ts')
  const oldWindow = global.window; const oldStorage = global.localStorage
  global.window = {}; global.localStorage = { getItem: () => JSON.stringify({ contextLength: 32000, systemPrompt: 'Keep this' }) }
  try {
    const settings = loadSettings()
    assert.equal(settings.systemPrompt, 'Keep this')
    assert.equal(toChatConfig(settings).contextLength, 500000)
  } finally { global.window = oldWindow; global.localStorage = oldStorage }
})

test('profile tab renders login state and authenticated usage limits', () => {
  const { ProfileTab } = load('src/renderer/src/components/settings/tabs/ProfileTab.tsx')
  const anonHtml = renderToStaticMarkup(React.createElement(ProfileTab, {
    auth: { status: 'anonymous', profile: null, avatarDataUrl: null, usage: null, error: null, scope: null },
    busy: false,
    onLogin: () => {},
    onCancelLogin: () => {},
    onRefresh: () => {},
    onLogout: () => {}
  }))
  assert.match(anonHtml, /Войти через Zipply/)

  const authedHtml = renderToStaticMarkup(React.createElement(ProfileTab, {
    auth: { status: 'authenticated', profile: { displayName: 'Alex', plan: 'pro' }, avatarDataUrl: null, usage: { remainingPercent: 72 }, error: null, scope: 'profile:read' },
    busy: false,
    onLogin: () => {},
    onCancelLogin: () => {},
    onRefresh: () => {},
    onLogout: () => {}
  }))
  assert.match(authedHtml, /Alex/)
  assert.match(authedHtml, /72%/)
})

test('themes tab renders five presets plus custom theme trigger', () => {
  const { ThemesTab } = load('src/renderer/src/components/settings/tabs/ThemesTab.tsx')
  const html = renderToStaticMarkup(React.createElement(ThemesTab, {
    settings: { theme: 'obsidian', defaultModel: 'base', systemPrompt: '', localOnly: true, accessMode: 'confirm' },
    onThemeSelect: () => {}
  }))
  for (const label of ['Зипли', 'Светлая', 'OLED', 'Claude', 'Codex', 'Добавить тему']) {
    assert.match(html, new RegExp(label))
  }
})

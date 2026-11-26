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
  mod.filename = path.resolve(file)
  mod.paths = module.paths
  mod._compile(built.outputFiles[0].text, mod.filename)
  return mod.exports
}

test('command confirmation keeps the command and decisions without an AI explanation button', () => {
  const { CommandApproval } = load('src/renderer/src/components/chat/CommandApproval.tsx')
  const html = renderToStaticMarkup(React.createElement(CommandApproval, { approval: { requestId: 'r', approvalId: 'a', command: 'npm test', kind: 'command' } }))
  assert.match(html, /npm test/)
  assert.match(html, /Отмена/)
  assert.match(html, /Разрешить/)
  assert.doesNotMatch(html, /Объяснить с помощью ИИ/)
  assert.doesNotMatch(html, /aria-modal="true"|bg-black\/60/)
})

test('chat composer displays the current access selector', () => {
  const { ChatActionRow } = load('src/renderer/src/components/chat-input/ChatActionRow.tsx')
  const html = renderToStaticMarkup(React.createElement(ChatActionRow, { buttonRef: { current: null }, onToggleMenu() {}, onSend() {}, hasText: false, accessMode: 'confirm', onAccessModeChange() {} }))
  assert.match(html, /Доступ агента/)
  assert.match(html, /С подтверждением/)
})

test('full access confirmation explains the access and offers cancel and confirmation', () => {
  const { FullAccessConfirm } = load('src/renderer/src/components/chat-input/FullAccessConfirm.tsx')
  const html = renderToStaticMarkup(React.createElement(FullAccessConfirm, { onCancel() {}, onConfirm() {} }))
  assert.match(html, /Включить полный доступ/)
  assert.match(html, /изменять файлы и запускать команды/)
  assert.match(html, /Терминал не изолирован/)
  assert.match(html, /Отмена/)
  assert.match(html, /Включить/)
  assert.doesNotMatch(html, /aria-modal="true"|bg-black\/60/)
})

test('access settings persist for the next request without changing other settings', () => {
  const { loadSettings, saveSettings, toChatConfig } = load('src/renderer/src/services/settingsService.ts')
  const previousWindow = global.window
  const previousStorage = global.localStorage
  const data = new Map()
  const secrets = new Map()
  global.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
  global.window = { api: { secrets: { get: key => ({ value: secrets.get(key) || '' }), set: (key, value) => { secrets.set(key, value); return { ok: true } } } } }
  try {
    const initial = { ...loadSettings(), defaultModel: 'max' }
    assert.equal(saveSettings(initial), true)
    assert.equal(saveSettings({ ...loadSettings(), accessMode: 'read-only' }), true)
    const config = toChatConfig(loadSettings())
    assert.equal(config.accessMode, 'read-only')
    assert.equal(config.model, 'max')
  } finally { global.window = previousWindow; global.localStorage = previousStorage }
})

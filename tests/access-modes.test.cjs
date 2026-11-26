const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const os = require('node:os')
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

test('legacy automatic and new unrestricted access settings both load without migration loss', () => {
  const { loadSettings } = load('src/renderer/src/services/settingsService.ts')
  const previousWindow = global.window
  const previousStorage = global.localStorage
  const values = new Map()
  global.window = { api: { secrets: { get: () => ({ value: '' }), set: () => ({ ok: true }) } } }
  global.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  try {
    assert.equal(loadSettings().accessMode, 'confirm')
    values.set('zipply_app_settings_v1', JSON.stringify({ accessMode: 'automatic' }))
    assert.equal(loadSettings().accessMode, 'automatic')
    values.set('zipply_app_settings_v1', JSON.stringify({ accessMode: 'unrestricted' }))
    assert.equal(loadSettings().accessMode, 'unrestricted')
  } finally {
    global.window = previousWindow
    global.localStorage = previousStorage
  }
})

test('composer and settings expose four modes and reserve confirmation for unrestricted', () => {
  const { AccessSelector } = load('src/renderer/src/components/chat-input/AccessSelector.tsx')
  const { SecurityTab } = load('src/renderer/src/components/settings/tabs/SecurityTab.tsx')
  const composer = renderToStaticMarkup(React.createElement(AccessSelector, { value: 'automatic', onChange: () => true }))
  const settings = renderToStaticMarkup(React.createElement(SecurityTab, { accessMode: 'automatic', onAccessModeChange() {} }))
  for (const label of ['Только чтение', 'С подтверждением', 'Автоматически', 'Полный доступ']) {
    assert.ok(composer.includes(label), `composer exposes ${label}`)
    assert.ok(settings.includes(label), `settings expose ${label}`)
  }
})

test('settings confirmation uses a visible viewport dialog while composer confirmation stays anchored', () => {
  const { FullAccessConfirm } = load('src/renderer/src/components/chat-input/FullAccessConfirm.tsx')
  const viewport = renderToStaticMarkup(React.createElement(FullAccessConfirm, { placement: 'viewport', onCancel() {}, onConfirm() {} }))
  const anchored = renderToStaticMarkup(React.createElement(FullAccessConfirm, { onCancel() {}, onConfirm() {} }))
  assert.match(viewport, /fixed inset-0/)
  assert.match(viewport, /role="dialog"/)
  assert.match(viewport, /justify-center/)
  assert.match(anchored, /absolute bottom-full/)
  assert.doesNotMatch(anchored, /fixed inset-0/)
  const settingsSource = fsSync.readFileSync('src/renderer/src/components/settings/MainSettingsView.tsx', 'utf8')
  assert.match(settingsSource, /FullAccessConfirm placement="viewport"/)
})

test('automatic confirms recognized risky commands while unrestricted executes them directly', async () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  for (const [accessMode, shouldAsk, shouldExecute] of [
    ['automatic', true, false],
    ['unrestricted', false, true]
  ]) {
    let asked = false
    let executed = false
    const tool = {
      name: 'terminal',
      validate: () => null,
      getExecutionPolicy: () => ({ mutates: true, cacheable: false, parallelSafe: false }),
      execute: async () => { executed = true; return { formattedContent: 'command ran' } }
    }
    const board = new Blackboard()
    board.setArtifact('config', { accessMode, workspacePath: process.cwd(), confirmAction: async () => { asked = true; return false } })
    const messages = []
    await ToolExecutor.executeCalls({ getHandler: name => name === 'terminal' ? tool : undefined }, [
      { id: accessMode, name: 'terminal', argumentsJson: JSON.stringify({ command: 'git push' }) }
    ], messages, board, () => {})
    assert.equal(asked, shouldAsk, `${accessMode} confirmation request`)
    assert.equal(executed, shouldExecute, `${accessMode} command execution`)
  }
})

test('unrestricted still asks before reading an external file', async () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-external-access-'))
  const workspace = path.join(root, 'workspace')
  const outside = path.join(root, 'outside.txt')
  await fs.mkdir(workspace)
  await fs.writeFile(outside, 'external')
  let approvals = 0
  let executed = false
  const tool = {
    name: 'read_file',
    validate: () => null,
    getExecutionPolicy: () => ({ mutates: false, cacheable: false, parallelSafe: false }),
    execute: async () => { executed = true; return { formattedContent: 'read', success: true } }
  }
  try {
    const board = new Blackboard()
    board.setArtifact('config', { accessMode: 'unrestricted', workspacePath: workspace, confirmAction: async () => { approvals++; return true } })
    await ToolExecutor.executeCalls({ getHandler: name => name === 'read_file' ? tool : undefined }, [
      { id: 'outside', name: 'read_file', argumentsJson: JSON.stringify({ path: outside }) }
    ], [], board, () => {})
    assert.equal(approvals, 1)
    assert.equal(executed, true)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})


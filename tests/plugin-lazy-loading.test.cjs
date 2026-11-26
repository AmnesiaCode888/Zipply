const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')

function load(file) {
  const filename = path.resolve(file)
  const result = buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false })
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths; mod._compile(result.outputFiles[0].text, filename); return mod.exports
}

const { PluginManager } = load('src/main/agent/plugins/PluginManager.ts')
const { createAgentSnapshot } = load('src/main/agent/plugins/BuiltInPlugins.ts')
const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')

test('plugin manager persists validated tool IDs per chat and clears them on uninstall or chat deletion', async () => {
  const dir = await fs.mkdtemp(path.join(path.resolve('scratch'), 'zipply-plugin-state-'))
  try {
    const manager = new PluginManager(dir)
    manager.setInstalled('cybersec', true)
    assert.deepEqual(manager.getLoadedToolIds('chat-a'), [])
    assert.deepEqual(manager.loadTool('chat-a', 'cybersec', 'cybersec_audit_project'), ['cybersec_audit_project'])
    assert.deepEqual(manager.getLoadedToolIds('chat-b'), [])
    assert.deepEqual(new PluginManager(dir).getLoadedToolIds('chat-a'), ['cybersec_audit_project'])
    assert.throws(() => manager.loadTool('chat-a', 'cybersec', 'not_a_tool'), /Неизвестный/)
    assert.throws(() => manager.loadTool('chat-a', 'missing', 'cybersec_audit_project'), /не установлен/)
    manager.removeChat('chat-a')
    assert.deepEqual(new PluginManager(dir).getLoadedToolIds('chat-a'), [])
    manager.loadTool('chat-b', 'cybersec', 'cybersec_audit_project')
    manager.setInstalled('cybersec', false)
    assert.deepEqual(new PluginManager(dir).getLoadedToolIds('chat-b'), [])
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('new snapshots expose plugin manager and base tools, while loading one tool adds only that tool', async () => {
  const baseTool = { name: 'read_file', description: 'Read file', parameters: {}, execute: async () => ({ formattedContent: '' }) }
  const base = { id: 'zipply', name: 'Zipply', isReadOnly: false, getTools: () => [baseTool], getSystemPrompt: () => 'base prompt' }
  const dir = await fs.mkdtemp(path.join(path.resolve('scratch'), 'zipply-plugin-snapshot-'))
  const manager = new PluginManager(dir)
  try {
    manager.setInstalled('cybersec', true)
    const agent = createAgentSnapshot(base, ['cybersec'], { getLoadedToolIds: () => manager.getLoadedToolIds('chat-a'), loadTool: (pluginId, toolId) => manager.loadTool('chat-a', pluginId, toolId) })
    const initial = ToolExecutor.buildToolDefs(agent).map(tool => tool.function.name)
    assert.deepEqual(initial.sort(), ['plugin_manager', 'read_file'])
    const handler = agent.getHandler('plugin_manager')
    assert.deepEqual(handler.getExecutionPolicy(), { mutates: false, parallelSafe: false, cacheable: false })
    const board = { getArtifact: () => undefined }
    const described = await handler.execute(JSON.stringify({ action: 'describe', pluginId: 'cybersec', toolId: 'cybersec_audit_project' }), board)
    assert.equal(described.success, true)
    assert.match(described.formattedContent, /Проверяет код/)
    assert.equal(agent.getHandler('cybersec_audit_project'), undefined)
    const loaded = await handler.execute(JSON.stringify({ action: 'load', pluginId: 'cybersec', toolId: 'cybersec_audit_project' }), board)
    assert.equal(loaded.success, true)
    assert.deepEqual(manager.getLoadedToolIds('chat-a'), ['cybersec_audit_project'])
    const next = ToolExecutor.buildToolDefs(agent).map(tool => tool.function.name)
    assert.ok(next.includes('cybersec_audit_project'))
    assert.equal(next.filter(name => name.startsWith('cybersec_')).length, 1)
    assert.match(agent.getSystemPrompt({}), /CyberSec/)
    assert.doesNotMatch(agent.getSystemPrompt({}), /Не выполняет код и не изменяет файлы/)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('agent sends plugin tool schema only in a later model request after explicit load', async () => {
  const { runAgent } = load('src/main/agent/index.ts')
  const dir = await fs.mkdtemp(path.join(path.resolve('scratch'), 'zipply-plugin-rounds-'))
  const manager = new PluginManager(dir)
  const originalFetch = global.fetch
  const requests = []
  try {
    manager.setInstalled('cybersec', true)
    await fs.writeFile(path.join(dir, 'app.js'), 'const options = { rejectUnauthorized: false }\n')
    global.fetch = async (_url, options) => {
      const request = JSON.parse(options.body)
      requests.push(request)
      const names = request.tools.map(tool => tool.function.name)
      if (requests.length === 1) {
        assert.ok(names.includes('plugin_manager'))
        assert.equal(names.some(name => name.startsWith('cybersec_')), false)
        return Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: 'load', type: 'function', function: { name: 'plugin_manager', arguments: JSON.stringify({ action: 'load', pluginId: 'cybersec', toolId: 'cybersec_audit_project' }) } }] } }] })
      }
      if (requests.length === 2) {
        assert.ok(names.includes('cybersec_audit_project'))
        assert.equal(names.filter(name => name.startsWith('cybersec_')).length, 1)
        return Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: 'audit', type: 'function', function: { name: 'cybersec_audit_project', arguments: '{}' } }] } }] })
      }
      assert.match(request.messages.at(-1).content, /app\.js:1/)
      return Response.json({ choices: [{ message: { content: 'Готово' } }] })
    }
    const events = []
    await runAgent('zipply', [{ role: 'user', content: 'Подключи и запусти аудит CyberSec' }], { model: 'test', stream: false, workspacePath: dir }, event => events.push(event), undefined, ['cybersec'], { sessionId: 'chat-lazy', manager })
    assert.deepEqual(manager.getLoadedToolIds('chat-lazy'), ['cybersec_audit_project'])
    assert.equal(requests.length, 3)
    assert.ok(events.some(event => event.type === 'tool_result' && /app\.js:1/.test(event.result)))
  } finally { global.fetch = originalFetch; await fs.rm(dir, { recursive: true, force: true }) }
})

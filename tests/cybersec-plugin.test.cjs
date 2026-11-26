const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const net = require('node:net')
const { EventEmitter } = require('node:events')
function load(file) {
  const filename = path.resolve(file)
  const result = buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false })
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths; mod._compile(result.outputFiles[0].text, filename); return mod.exports
}
const { PluginManager } = load('src/main/agent/plugins/PluginManager.ts')
const { createAgentSnapshot } = load('src/main/agent/plugins/BuiltInPlugins.ts')
const { CyberSecCodeAudit, CyberSecPorts } = load('src/main/agent/plugins/CyberSecTools.ts')
const { createPluginTool, getPluginToolIds } = load('src/main/agent/plugins/BuiltInPlugins.ts')
const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')

test('plugin installation is owned by main process, persists, migrates and rejects unknown packages', async () => {
  const testRoot = path.resolve('scratch')
  const dir = await fs.mkdtemp(path.join(testRoot, 'zipply-plugin-'))
  try {
    const manager = new PluginManager(dir)
    assert.deepEqual(manager.list(), [])
    assert.deepEqual(manager.list(['sentinel', 'unknown', 'cybersec']), ['cybersec'])
    assert.deepEqual(new PluginManager(dir).list(), ['cybersec'])
    assert.throws(() => manager.setInstalled('unknown', true), /Неизвестный/)
    assert.deepEqual(manager.setInstalled('cybersec', false), [])
    assert.deepEqual(new PluginManager(dir).list(['cybersec']), [])
    assert.deepEqual(manager.setInstalled('cybersec', true), ['cybersec'])
    await fs.writeFile(path.join(dir, 'plugins.json'), '{broken')
    assert.throws(() => new PluginManager(dir).list())
  } finally { if (path.dirname(dir) === testRoot) await fs.rm(dir, { recursive: true, force: true }) }
})

test('CyberSec exposes only the seven retained core checks', () => {
  assert.deepEqual(getPluginToolIds('cybersec').sort(), [
    'cybersec_audit_project', 'cybersec_audit_server_config', 'cybersec_check_http_posture',
    'cybersec_check_ports', 'cybersec_check_tls', 'cybersec_dns_records', 'cybersec_scan_secrets'
  ])
  assert.equal(createPluginTool('cybersec', 'cybersec_npm_audit'), undefined)
  assert.equal(createPluginTool('cybersec', 'cybersec_check_headers'), undefined)
})

test('tools are isolated per agent snapshot and execute through the agent tool path', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-audit-'))
  try {
    await fs.writeFile(path.join(dir, 'client.js'), 'const options = { rejectUnauthorized: false }\n')
    const base = { id: 'zipply', name: 'Zipply', isReadOnly: false, getTools: () => [], getSystemPrompt: () => '' }
    const enabled = createAgentSnapshot(base, ['cybersec'])
    const disabled = createAgentSnapshot(base, [])
    assert.deepEqual(disabled.getTools().map(tool => tool.name), ['plugin_manager'])
    assert.equal(enabled.getTools().length, 1)
    assert.equal(ToolExecutor.buildToolDefs(enabled, [], true).length, 1)
    await enabled.getHandler('plugin_manager').execute(JSON.stringify({ action: 'load', pluginId: 'cybersec', toolId: 'cybersec_audit_project' }), new Blackboard())
    assert.equal(enabled.getTools().length, 2)
    assert.equal(disabled.getHandler('cybersec_audit_project'), undefined)
    const board = new Blackboard(); board.setArtifact('config', { workspacePath: dir })
    const messages = []
    assert.equal(await ToolExecutor.executeCalls(enabled, [{ id: 'c1', name: 'cybersec_audit_project', argumentsJson: '{}' }], messages, board, () => {}), true)
    assert.match(messages[0].content, /client\.js:1/)
    assert.equal(disabled.getHandler('cybersec_audit_project'), undefined)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('agent advertises and runs CyberSec tools only for an installed package', async () => {
  const { runAgent } = load('src/main/agent/index.ts')
  const testRoot = path.resolve('scratch')
  const dir = await fs.mkdtemp(path.join(testRoot, 'zipply-agent-plugin-'))
  const original = global.fetch
  try {
    await fs.writeFile(path.join(dir, 'client.js'), 'const config = { rejectUnauthorized: false }\n')
    let round = 0
    global.fetch = async (_url, options) => {
      const request = JSON.parse(options.body)
      const names = (request.tools || []).map(tool => tool.function.name)
      if (round === 0) {
        assert.ok(names.includes('plugin_manager'))
        assert.equal(names.includes('cybersec_audit_project'), false)
        round++
        return Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: 'load-1', type: 'function', function: { name: 'plugin_manager', arguments: JSON.stringify({ action: 'load', pluginId: 'cybersec', toolId: 'cybersec_audit_project' }) } }] } }] })
      }
      if (round === 1) {
        assert.ok(names.includes('cybersec_audit_project'))
        round++
        return Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: 'audit-1', type: 'function', function: { name: 'cybersec_audit_project', arguments: '{}' } }] } }] })
      }
      assert.match(request.messages.at(-1).content, /client\.js:1/)
      return Response.json({ choices: [{ message: { content: 'Проверка завершена' } }] })
    }
    const events = []
    await runAgent('zipply', [{ role: 'user', content: 'Проверь проект' }], { model: 'test', stream: false, workspacePath: dir }, event => events.push(event), undefined, ['cybersec'])
    assert.ok(events.some(event => event.type === 'tool_result' && !event.error && /client\.js:1/.test(event.result)))
    assert.equal(events.at(-1).type, 'done')
    global.fetch = async (_url, options) => {
      const names = (JSON.parse(options.body).tools || []).map(tool => tool.function.name)
      assert.equal(names.includes('cybersec_audit_project'), false)
      assert.ok(names.includes('plugin_manager'))
      return Response.json({ choices: [{ message: { content: 'Плагин выключен' } }] })
    }
    await runAgent('zipply', [{ role: 'user', content: 'Привет' }], { model: 'test', stream: false, workspacePath: dir }, () => {}, undefined, [])
  } finally { global.fetch = original; if (path.dirname(dir) === testRoot) await fs.rm(dir, { recursive: true, force: true }) }
})

test('local audit reports bounded candidates without exposing source secrets or following symlinks', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-audit-'))
  const external = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-external-'))
  try {
    await fs.writeFile(path.join(dir, 'client.js'), "const token = 'super-secret-value'; const options = { rejectUnauthorized: false }\n// rejectUnauthorized: false\n")
    await fs.writeFile(path.join(dir, 'Dockerfile'), 'FROM node\nUSER root\n')
    await fs.writeFile(path.join(dir, '.env'), 'DEBUG=true\n')
    await fs.writeFile(path.join(external, 'outside.py'), 'DEBUG=True\n')
    try { await fs.symlink(external, path.join(dir, 'linked'), 'dir') } catch {}
    const board = new Blackboard(); board.setArtifact('config', { workspacePath: dir })
    const result = await new CyberSecCodeAudit().execute('{}', board)
    assert.equal(result.success, true)
    assert.match(result.formattedContent, /client\.js:1/)
    assert.match(result.formattedContent, /Dockerfile:2/)
    assert.doesNotMatch(result.formattedContent, /super-secret-value|outside\.py|\.env/)
    assert.equal(result.data.findings.length, 2)
    const aborted = new AbortController(); aborted.abort()
    assert.equal((await new CyberSecCodeAudit().execute('{}', board, aborted.signal)).error, true)
    const noWorkspace = new Blackboard()
    assert.match((await new CyberSecCodeAudit().execute('{}', noWorkspace)).formattedContent, /выберите папку/i)
  } finally { await fs.rm(dir, { recursive: true, force: true }); await fs.rm(external, { recursive: true, force: true }) }
})

test('port probe validates ranges, requires approval and connects only to the specified port', async () => {
  const original = net.createConnection
  const connections = []
  net.createConnection = options => {
    connections.push(options)
    const socket = new EventEmitter()
    socket.destroy = () => socket
    socket.setTimeout = () => socket
    queueMicrotask(() => socket.emit('connect'))
    return socket
  }
  try {
    const port = 443
    const tool = new CyberSecPorts()
    assert.ok(tool.validate(JSON.stringify({ host: '192.168.1.0/24', ports: [80] })))
    assert.ok(tool.validate(JSON.stringify({ host: '127.0.0.1', ports: Array(1025).fill(80) })))
    assert.ok(tool.validate(JSON.stringify({ host: '127.0.0.1', port_range: '1-1025' })))
    assert.ok(tool.validate(JSON.stringify({ host: '127.0.0.1', ports: [80], port_range: '1-2' })))
    assert.equal(tool.validate(JSON.stringify({ host: '127.0.0.1', port_range: '1-1024' })), null)
    const board = new Blackboard()
    board.setArtifact('config', { confirmAction: async () => false })
    assert.equal((await tool.execute(JSON.stringify({ host: '127.0.0.1', ports: [port] }), board)).error, true)
    assert.equal(connections.length, 0)
    let action
    board.setArtifact('config', { confirmAction: async value => { action = value; return true } })
    const result = await tool.execute(JSON.stringify({ host: '127.0.0.1', ports: [port, port] }), board)
    assert.equal(action.kind, 'network'); assert.equal(action.target, '127.0.0.1')
    assert.deepEqual(connections, [{ host: '127.0.0.1', port }])
    assert.deepEqual(result.data.results, [{ port, status: 'open' }])
    assert.match(result.formattedContent, /подключение установлено/)
  } finally { net.createConnection = original }
})

test('port ranges use a bounded worker pool and report progress', async () => {
  const original = net.createConnection
  let active = 0, maxActive = 0
  const connected = []
  net.createConnection = options => {
    connected.push(options.port); active++; maxActive = Math.max(maxActive, active)
    const socket = new EventEmitter(); let destroyed = false
    socket.destroy = () => { if (!destroyed) { destroyed = true; active-- }; return socket }
    socket.setTimeout = () => socket
    setImmediate(() => socket.emit('connect'))
    return socket
  }
  try {
    const board = new Blackboard(); let approval
    board.setArtifact('config', { confirmAction: async action => { approval = action; return true } })
    const progress = []
    const result = await new CyberSecPorts().execute(JSON.stringify({ host: '127.0.0.1', port_range: '1-64' }), board, undefined, event => progress.push(event))
    assert.equal(result.success, true)
    assert.match(approval.command, /1-64/)
    assert.equal(connected.length, 64)
    assert.ok(maxActive > 1 && maxActive <= 32)
    assert.equal(active, 0)
    assert.equal(result.data.results.length, 64)
    assert.ok(progress.length > 0)
  } finally { net.createConnection = original }
})

test('cancelling a port scan closes in-flight sockets without starting remaining ports', async () => {
  const original = net.createConnection
  let started = 0, destroyed = 0
  net.createConnection = () => {
    started++
    const socket = new EventEmitter(); let closed = false
    socket.destroy = () => { if (!closed) { closed = true; destroyed++ }; return socket }
    socket.setTimeout = () => socket
    return socket
  }
  try {
    const board = new Blackboard(); board.setArtifact('config', { confirmAction: async () => true })
    const controller = new AbortController()
    const pending = new CyberSecPorts().execute(JSON.stringify({ host: '127.0.0.1', port_range: '1-100' }), board, controller.signal)
    setImmediate(() => controller.abort())
    const result = await pending
    assert.equal(result.error, true)
    assert.match(result.formattedContent, /отменена/)
    assert.ok(started > 0 && started <= 32)
    assert.equal(destroyed, started)
  } finally { net.createConnection = original }
})

test('a scan with only connection errors is reported as failed', async () => {
  const original = net.createConnection
  net.createConnection = () => {
    const socket = new EventEmitter()
    socket.destroy = () => socket; socket.setTimeout = () => socket
    queueMicrotask(() => socket.emit('error', Object.assign(new Error('denied'), { code: 'EACCES' })))
    return socket
  }
  try {
    const board = new Blackboard(); board.setArtifact('config', { confirmAction: async () => true })
    const result = await new CyberSecPorts().execute(JSON.stringify({ host: '127.0.0.1', ports: [80] }), board)
    assert.equal(result.error, true)
    assert.match(result.formattedContent, /Не удалось проверить ни одного порта/)
  } finally { net.createConnection = original }
})

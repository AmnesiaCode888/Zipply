const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const net = require('node:net')
function load(file) {
  const filename = path.resolve(file)
  const built = buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false })
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths; mod._compile(built.outputFiles[0].text, filename); return mod.exports
}
const { CyberSecPorts } = load('src/main/agent/plugins/CyberSecTools.ts')
const { Blackboard } = load('src/main/agent/core/Blackboard.ts')

test('TCP port probe inspects only the approved local target', { timeout: 15000 }, async () => {
  const server = net.createServer(socket => socket.destroy())
  const second = net.createServer(socket => socket.destroy())
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    await new Promise((resolve, reject) => { second.once('error', reject); second.listen(0, '127.0.0.1', resolve) })
    const port = server.address().port
    const secondPort = second.address().port
    const board = new Blackboard()
    const approvals = []
    board.setArtifact('config', { confirmAction: async action => { approvals.push(action); return true } })
    const ports = await new CyberSecPorts().execute(JSON.stringify({ host: '127.0.0.1', ports: [port, secondPort] }), board)
    assert.equal(ports.success, true)
    assert.deepEqual(ports.data.results, [port, secondPort].sort((a, b) => a - b).map(port => ({ port, status: 'open' })))
    const range = await new CyberSecPorts().execute(JSON.stringify({ host: '127.0.0.1', port_range: `${port}-${port}` }), board)
    assert.deepEqual(range.data.results, [{ port, status: 'open' }])
    assert.equal(approvals.length, 2)
    assert.equal(approvals[0].kind, 'network')
    assert.equal(approvals[0].target, '127.0.0.1')
  } finally { if (second.listening) await new Promise(resolve => second.close(resolve)); if (server.listening) await new Promise(resolve => server.close(resolve)) }
})

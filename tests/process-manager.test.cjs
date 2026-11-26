const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
function load(file) { const r = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' }); const m = new Module(path.resolve(file), module); m.filename = path.resolve(file); m.paths = module.paths; m._compile(r.outputFiles[0].text, m.filename); return m.exports }

test('long running process can be polled across requests and stopped only by its owner', async () => {
  const { ProcessManager } = load('src/main/agent/services/ProcessManager.ts')
  const manager = new ProcessManager()
  const owner = { senderId: 1, sessionId: 'chat-a', workspace: process.cwd() }
  const stranger = { ...owner, sessionId: 'chat-b' }
  try {
    const command = `node -e "console.log('ready');setInterval(()=>{},1000)"`
    const started = await manager.start(owner, 'request-a', command, process.cwd())
    assert.ok(started.id)
    await assert.rejects(manager.poll(stranger, started.id, 0, 0), /не найден/i)
    const polled = await manager.poll(owner, started.id, 0, 5000)
    assert.match(polled.output, /ready/)
    assert.equal(manager.list(stranger).length, 0)
    await manager.stop(owner, started.id)
    assert.equal((await manager.poll(owner, started.id, polled.cursor, 0)).status, 'stopped')
  } finally { await manager.shutdown() }
})

test('request cancellation stops only processes started during that request', async () => {
  const { ProcessManager } = load('src/main/agent/services/ProcessManager.ts')
  const manager = new ProcessManager(); const owner = { senderId: 1, sessionId: 'chat', workspace: process.cwd() }
  const command = `node -e "setInterval(()=>{},1000)"`
  try {
    const old = await manager.start(owner, 'old', command, process.cwd())
    const current = await manager.start(owner, 'new', command, process.cwd())
    await manager.stopRequest(owner, 'new')
    assert.equal((await manager.poll(owner, current.id, 0, 0)).status, 'stopped')
    assert.equal((await manager.poll(owner, old.id, 0, 0)).status, 'running')
  } finally { await manager.shutdown() }
})

test('concurrent stop calls share the same termination', async () => {
  const { ProcessManager } = load('src/main/agent/services/ProcessManager.ts')
  const manager = new ProcessManager(); const owner = { senderId: 1, sessionId: 'chat', workspace: process.cwd() }
  try {
    const entry = await manager.start(owner, 'req', 'node -e "setInterval(()=>{},1000)"', process.cwd())
    const results = await Promise.allSettled([manager.stop(owner, entry.id), manager.stop(owner, entry.id)])
    assert.deepEqual(results.map(r => r.status), ['fulfilled', 'fulfilled'])
  } finally { await manager.shutdown() }
})

test('poll paginates large output without advancing past unread characters', async () => {
  const { ProcessManager } = load('src/main/agent/services/ProcessManager.ts')
  const manager = new ProcessManager(); const owner = { senderId: 1, sessionId: 'chat', workspace: process.cwd() }
  const expected = 'x'.repeat(50000) + '\n' + 'line\n'.repeat(400)
  try {
    const started = await manager.start(owner, 'req', 'node -e "process.stdout.write(\'x\'.repeat(50000)+\'\\n\'+\'line\\n\'.repeat(400))"', process.cwd())
    let cursor = 0, output = ''
    for (let i = 0; i < 50; i++) {
      const part = await manager.poll(owner, started.id, cursor, 1000)
      assert.ok(part.output.length <= 30000); assert.ok(part.output.split('\n').length <= 220)
      output += part.output; cursor = part.cursor
      if (part.status === 'exited' && !part.output) break
    }
    assert.equal(output, expected)
  } finally { await manager.shutdown() }
})

test('UTF-8 characters split between stream chunks are reconstructed', async () => {
  const { ProcessManager } = load('src/main/agent/services/ProcessManager.ts'); const manager = new ProcessManager(); const owner = { senderId: 1, sessionId: 'chat', workspace: process.cwd() }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-process-')); const script = path.join(dir, 'unicode.js')
  try {
    await fs.writeFile(script, "const b=Buffer.from('Привет');process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.write(b.subarray(1)),100)")
    const started = await manager.start(owner, 'req', `node "${script}"`, process.cwd()); let cursor = 0, output = ''
    for (let i = 0; i < 20; i++) { const p = await manager.poll(owner, started.id, cursor, 1000); output += p.output; cursor = p.cursor; if (p.status === 'exited' && !p.output) break }
    assert.equal(output, 'Привет')
  } finally { await manager.shutdown(); await fs.rm(dir, { recursive: true, force: true }) }
})

test('retained completed processes have a fixed upper bound', async () => {
  const { ProcessManager } = load('src/main/agent/services/ProcessManager.ts'); const manager = new ProcessManager(); const owner = { senderId: 1, sessionId: 'chat', workspace: process.cwd() }
  try {
    for (let i = 0; i < 25; i++) {
      const started = await manager.start(owner, String(i), 'node -e "process.stdout.write(\'ok\')"', process.cwd())
      let cursor = 0
      for (;;) { const p = await manager.poll(owner, started.id, cursor, 1000); cursor = p.cursor; if (p.status === 'exited') break }
    }
    assert.ok(manager.list(owner).length <= 20)
  } finally { await manager.shutdown() }
})

test('a failing process reports its nonzero exit code', async () => {
  const { ProcessManager } = load('src/main/agent/services/ProcessManager.ts'); const manager = new ProcessManager(); const owner = { senderId: 1, sessionId: 'chat', workspace: process.cwd() }
  try {
    const started = await manager.start(owner, 'req', 'node -e "process.exit(7)"', process.cwd()); let cursor = 0, final
    for (;;) { final = await manager.poll(owner, started.id, cursor, 1000); cursor = final.cursor; if (final.status === 'exited' || final.status === 'failed') break }
    assert.equal(final.exitCode, 7)
  } finally { await manager.shutdown() }
})

test('stopping a shell also terminates its running child', async () => {
  const { ProcessManager } = load('src/main/agent/services/ProcessManager.ts'); const manager = new ProcessManager(); const owner = { senderId: 1, sessionId: 'chat', workspace: process.cwd() }
  try {
    const started = await manager.start(owner, 'req', 'node -e "console.log(process.pid);setInterval(()=>{},1000)"', process.cwd())
    let cursor = 0, output = ''
    for (let i = 0; i < 10 && !/\d+/.test(output); i++) { const p = await manager.poll(owner, started.id, cursor, 2000); output += p.output; cursor = p.cursor }
    const pid = Number(output.match(/\d+/)?.[0]); assert.ok(pid > 0, output)
    await manager.stop(owner, started.id)
    for (let i = 0; i < 20; i++) { try { process.kill(pid, 0) } catch (e) { if (e.code === 'ESRCH') return; throw e }; await new Promise(resolve => setTimeout(resolve, 50)) }
    assert.fail('Child process is still running')
  } finally { await manager.shutdown() }
})

test('process is not reported as exited until its output streams close', async () => {
  const cp = require('node:child_process'); const { EventEmitter } = require('node:events'); const { PassThrough } = require('node:stream')
  const original = cp.spawn; let child
  cp.spawn = () => { child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.pid = 12345; queueMicrotask(() => child.emit('spawn')); return child }
  try {
    const { ProcessManager } = load('src/main/agent/services/ProcessManager.ts'); const manager = new ProcessManager(); const owner = { senderId: 1, sessionId: 'chat', workspace: process.cwd() }
    const started = await manager.start(owner, 'req', 'mock', process.cwd())
    child.emit('exit', 0, null)
    assert.equal((await manager.poll(owner, started.id, 0, 0)).status, 'running')
    child.stdout.write('late output'); child.stdout.end(); child.stderr.end(); child.emit('close', 0, null)
    const final = await manager.poll(owner, started.id, 0, 0)
    assert.equal(final.status, 'exited'); assert.equal(final.output, 'late output')
  } finally { cp.spawn = original }
})

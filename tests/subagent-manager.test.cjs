const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

function load(file) {
  const source = path.resolve(file)
  const result = buildSync({ entryPoints: [source], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const mod = new Module(source, module)
  mod.filename = source
  mod.paths = module.paths
  mod._compile(result.outputFiles[0].text, source)
  return mod.exports
}

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('SubagentManager returns an id immediately and wait yields the final report', async () => {
  const { SubagentManager } = load('src/main/agent/services/SubagentManager.ts')
  const manager = new SubagentManager()
  const entered = deferred()
  const release = deferred()

  const child = manager.spawn({
    rootRunId: 'root-a',
    sessionId: 'chat-a',
    role: 'explorer',
    task: 'Inspect parser',
    run: async () => {
      entered.resolve()
      await release.promise
      return { summary: 'Parser uses a state machine.' }
    }
  })

  assert.equal(typeof child.id, 'string')
  assert.ok(['queued', 'running'].includes(child.status))
  await entered.promise
  assert.equal(manager.get({ rootRunId: 'root-a' }, child.id).status, 'running')

  const waiting = manager.wait({ rootRunId: 'root-a' }, child.id, 1000)
  release.resolve()
  const result = await waiting
  assert.equal(result.status, 'completed')
  assert.equal(result.summary, 'Parser uses a state machine.')
})

test('SubagentManager scopes listing by root and enforces the active concurrency limit', async () => {
  const { SubagentManager } = load('src/main/agent/services/SubagentManager.ts')
  const manager = new SubagentManager({ maxConcurrentPerRoot: 1 })
  const release = deferred()

  const first = manager.spawn({
    rootRunId: 'root-a',
    sessionId: 'chat-a',
    role: 'explorer',
    task: 'First task',
    run: async () => { await release.promise; return { summary: 'done' } }
  })
  assert.throws(() => manager.spawn({
    rootRunId: 'root-a',
    sessionId: 'chat-a',
    role: 'explorer',
    task: 'Over the limit',
    run: async () => ({ summary: 'never' })
  }), /лимит/i)

  const other = manager.spawn({
    rootRunId: 'root-b',
    sessionId: 'chat-b',
    role: 'reviewer',
    task: 'Independent task',
    run: async () => ({ summary: 'separate' })
  })
  assert.deepEqual(manager.list({ rootRunId: 'root-a' }).map(item => item.id), [first.id])
  assert.deepEqual(manager.list({ rootRunId: 'root-b' }).map(item => item.id), [other.id])
  release.resolve()
  await Promise.all([manager.wait({ rootRunId: 'root-a' }, first.id, 1000), manager.wait({ rootRunId: 'root-b' }, other.id, 1000)])
})

test('SubagentManager delivers steering at the child safe point and stops its descendant tree', async () => {
  const { SubagentManager } = load('src/main/agent/services/SubagentManager.ts')
  const manager = new SubagentManager()
  const childStarted = deferred()
  const childAborted = deferred()

  const parent = manager.spawn({
    rootRunId: 'root-a',
    sessionId: 'chat-a',
    role: 'explorer',
    task: 'Parent task',
    run: async () => ({ summary: 'parent done' })
  })
  await manager.wait({ rootRunId: 'root-a' }, parent.id, 1000)

  const child = manager.spawn({
    rootRunId: 'root-a',
    parentId: parent.id,
    sessionId: 'chat-a',
    role: 'worker',
    task: 'Child task',
    run: async ({ signal, consumeSteers }) => new Promise(resolve => {
      childStarted.resolve()
      signal.addEventListener('abort', () => {
        childAborted.resolve()
        resolve({ summary: `stopped:${consumeSteers().join('|')}` })
      }, { once: true })
    })
  })
  await childStarted.promise
  manager.steer({ rootRunId: 'root-a' }, child.id, 'Check the error path')
  assert.deepEqual(manager.consumeSteers(child.id), ['Check the error path'])
  assert.deepEqual(manager.consumeSteers(child.id), [])

  await manager.stop({ rootRunId: 'root-a' }, parent.id, { recursive: true })
  await childAborted.promise
  const stopped = await manager.wait({ rootRunId: 'root-a' }, child.id, 1000)
  assert.equal(stopped.status, 'cancelled')
})

test('SubagentManager can interrupt and resume a child while enforcing owner scope', async () => {
  const { SubagentManager } = load('src/main/agent/services/SubagentManager.ts')
  const manager = new SubagentManager()
  const firstRunStarted = deferred()
  let runs = 0
  const child = manager.spawn({
    rootRunId: 'root-a',
    senderId: 7,
    sessionId: 'chat-a',
    role: 'reviewer',
    task: 'Inspect a change',
    run: async ({ signal }) => {
      runs++
      if (runs > 1) return { summary: 'Review resumed and finished.' }
      return new Promise(resolve => {
        firstRunStarted.resolve()
        signal.addEventListener('abort', () => resolve({ summary: 'Review paused.' }), { once: true })
      })
    }
  })
  await firstRunStarted.promise
  await manager.interrupt({ senderId: 7, sessionId: 'chat-a' }, child.id)
  const interrupted = await manager.wait({ senderId: 7, sessionId: 'chat-a' }, child.id, 1000)
  assert.equal(interrupted.status, 'interrupted')
  assert.deepEqual(manager.listForOwner(8, 'chat-a'), [])
  assert.throws(() => manager.controlForOwner(8, 'chat-a', child.id, 'resume'), /не найден/i)

  manager.controlForOwner(7, 'chat-a', child.id, 'resume')
  const resumed = await manager.wait({ senderId: 7, sessionId: 'chat-a' }, child.id, 1000)
  assert.equal(resumed.status, 'completed')
  assert.equal(resumed.summary, 'Review resumed and finished.')
  assert.equal(runs, 2)
})

test('SubagentManager stops all work owned by a discarded chat without touching another owner', async () => {
  const { SubagentManager } = load('src/main/agent/services/SubagentManager.ts')
  const manager = new SubagentManager()
  const started = new Map()
  const makeRun = id => async ({ signal }) => new Promise(resolve => {
    started.set(id, resolve)
    signal.addEventListener('abort', () => resolve({ summary: 'stopped' }), { once: true })
  })
  const owned = manager.spawn({ rootRunId: 'root-a', senderId: 1, sessionId: 'chat-a', role: 'explorer', task: 'Owned', run: makeRun('owned') })
  const other = manager.spawn({ rootRunId: 'root-b', senderId: 2, sessionId: 'chat-b', role: 'explorer', task: 'Other', run: makeRun('other') })
  while (!started.has('owned') || !started.has('other')) await new Promise(resolve => setImmediate(resolve))

  await manager.stopForOwner(1, 'chat-a')
  assert.ok(['stopping', 'cancelled'].includes(manager.get({ senderId: 1, sessionId: 'chat-a' }, owned.id).status))
  assert.equal(manager.get({ senderId: 2, sessionId: 'chat-b' }, other.id).status, 'running')
  const stopped = await manager.wait({ senderId: 1, sessionId: 'chat-a' }, owned.id, 1000)
  assert.equal(stopped.status, 'cancelled')
  await manager.stopForOwner(2, 'chat-b')
  await manager.wait({ senderId: 2, sessionId: 'chat-b' }, other.id, 1000)
})

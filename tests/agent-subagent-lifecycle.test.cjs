const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs/promises')

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

test('spawn_agent returns a running child immediately and manage_agents can await its report', async () => {
  const { SpawnAgentTool } = load('src/main/agent/tools/SpawnAgentTool.ts')
  const { SubagentManager } = load('src/main/agent/services/SubagentManager.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-background-subagent-'))
  const originalFetch = global.fetch
  const childRequest = deferred()
  const releaseChild = deferred()
  global.fetch = async () => {
    childRequest.resolve()
    return releaseChild.promise
  }

  try {
    const manager = new SubagentManager()
    const board = new Blackboard()
    board.setArtifact('config', { model: 'test', stream: false, workspacePath: dir, requestId: 'root-a' }, false)
    board.setArtifact('rootAgentRunId', 'root-a', false)
    board.setArtifact('parentAgentTools', [], false)

    const execution = new SpawnAgentTool(manager).execute(JSON.stringify({ task: 'Return a short result', role: 'explorer' }), board)
    await childRequest.promise
    const immediate = await Promise.race([
      execution,
      new Promise((_, reject) => setTimeout(() => reject(new Error('spawn_agent waited for the child')), 500))
    ])
    assert.equal(immediate.data.status, 'running')
    assert.equal(immediate.data.subagents.length, 1)
    assert.equal(manager.get({ rootRunId: 'root-a' }, immediate.data.agentId).status, 'running')

    releaseChild.resolve(Response.json({
      usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
      choices: [{ message: { content: 'Short result.' } }]
    }))
    const report = await manager.wait({ rootRunId: 'root-a' }, immediate.data.agentId, 3000)
    assert.equal(report.status, 'completed')
    assert.match(report.summary, /Short result/)
  } finally {
    global.fetch = originalFetch
    releaseChild.resolve(Response.json({ choices: [{ message: { content: 'cleanup' } }] }))
    await fs.rm(dir, { recursive: true, force: true })
  }
})

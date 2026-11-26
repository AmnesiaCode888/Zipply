const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

function load(file) {
  const source = path.resolve(file)
  const built = buildSync({ entryPoints: [source], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const mod = new Module(source, module); mod.filename = source; mod.paths = module.paths
  mod._compile(built.outputFiles[0].text, source)
  return mod.exports
}

test('terminal execution is reported only after approval and reaches the chat state', async () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const { applyEventToBlocks } = load('src/renderer/src/hooks/useChat.ts')
  let approve
  const approval = new Promise(resolve => { approve = resolve })
  const board = new Blackboard()
  board.setArtifact('config', { accessMode: 'confirm', workspacePath: process.cwd(), confirmAction: () => approval })
  const tool = { name: 'terminal', validate: () => null, getExecutionPolicy: () => ({ mutates: true }), execute: async () => ({ formattedContent: 'done' }) }
  const events = []; const blocks = []; const message = { id: 'm', role: 'assistant' }
  const run = ToolExecutor.executeCalls({ getHandler: () => tool }, [{ id: 'cmd', name: 'terminal', argumentsJson: '{"command":"echo hi"}' }], [], board, event => {
    events.push(event)
    applyEventToBlocks(event, blocks, message)
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(events.some(event => event.executionStarted), false)
  assert.equal(blocks[0].tool.executionStarted, undefined)
  approve(true)
  await run
  assert.deepEqual(events.map(event => event.type), ['tool_start', 'tool_progress', 'tool_result'])
  assert.equal(events[1].executionStarted, true)
  assert.equal(blocks[0].tool.executionStarted, true)
  assert.equal(blocks[0].tool.status, 'completed')
})

test('background process preserves the silence timer across polls and resets it for new output', () => {
  const { applyEventToBlocks } = load('src/renderer/src/hooks/useChat.ts')
  const blocks = []; const message = { id: 'm', role: 'assistant' }
  const originalNow = Date.now
  let now = 1000
  Date.now = () => now
  try {
    const event = value => applyEventToBlocks(value, blocks, message)
    event({ type: 'tool_start', callId: 'start', toolName: 'process_start', args: { command: 'long' } })
    event({ type: 'tool_result', callId: 'start', result: 'started', data: { id: 'p1', status: 'running' } })
    now = 2500
    event({ type: 'tool_start', callId: 'poll1', toolName: 'process_poll', args: { process_id: 'p1' } })
    event({ type: 'tool_result', callId: 'poll1', result: 'running', data: { id: 'p1', status: 'running', output: '' } })
    assert.equal(blocks[1].tool.processLastOutputAt, 1000)
    now = 5000
    event({ type: 'tool_start', callId: 'poll2', toolName: 'process_poll', args: { process_id: 'p1' } })
    event({ type: 'tool_result', callId: 'poll2', result: 'output', data: { id: 'p1', status: 'running', output: 'new data' } })
    assert.equal(blocks[2].tool.processLastOutputAt, 5000)
    now = 6000
    event({ type: 'tool_start', callId: 'poll3', toolName: 'process_poll', args: { process_id: 'p1' } })
    event({ type: 'tool_result', callId: 'poll3', result: 'exited', data: { id: 'p1', status: 'exited', output: '' } })
    assert.equal(blocks[3].tool.processLastOutputAt, 5000)
    assert.equal(blocks[3].tool.processResult.status, 'exited')
  } finally { Date.now = originalNow }
})

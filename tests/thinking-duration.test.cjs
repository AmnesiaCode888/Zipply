const test = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

function load(file) {
  const source = path.resolve(file)
  const output = buildSync({
    entryPoints: [source],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    packages: 'external',
    loader: { '.svg': 'dataurl', '.css': 'empty' }
  })
  const mod = new Module(source, module)
  mod.filename = source
  mod.paths = module.paths
  mod._compile(output.outputFiles[0].text, source)
  return mod.exports
}

test('reasoning events stay out of user-visible blocks while final text is rendered', () => {
  const { applyEventToBlocks } = load('src/renderer/src/hooks/useChat.ts')
  const blocks = []
  const message = { id: 'm1', role: 'assistant', isStreaming: true }

  applyEventToBlocks({ type: 'reasoning', content: 'Let me think...' }, blocks, message)
  applyEventToBlocks({ type: 'reasoning', content: ' more thought' }, blocks, message)
  assert.deepEqual(blocks, [])

  applyEventToBlocks({ type: 'token', content: 'Hello' }, blocks, message)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'text')
  assert.equal(blocks[0].content, 'Hello')
  assert.equal(blocks[0].isStreaming, true)
})

test('reasoning events stay hidden when tool activity arrives before final text', () => {
  const { applyEventToBlocks } = load('src/renderer/src/hooks/useChat.ts')
  const blocks = []
  const message = { id: 'm2', role: 'assistant', isStreaming: true }

  applyEventToBlocks({ type: 'reasoning', content: 'I will run a command' }, blocks, message)
  applyEventToBlocks({ type: 'tool_start', callId: 'call-1', toolName: 'run_command', args: { command: 'ls' } }, blocks, message)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'tool')
  assert.equal(blocks[0].tool.targetName, 'ls')
})

test('finishInterruptedMessages calculates durationSec for interrupted thinking block', () => {
  const { finishInterruptedMessages } = load('src/renderer/src/services/chatStorageService.ts')

  const startTime = 3000000
  const originalDateNow = Date.now
  Date.now = () => startTime + 12000 // 12 seconds later

  try {
    const messages = [
      {
        id: 'msg-1',
        role: 'assistant',
        isStreaming: true,
        blocks: [
          {
            type: 'thinking',
            id: 'th-1',
            content: 'Working on solution...',
            startedAt: startTime,
            isStreaming: true
          }
        ]
      }
    ]

    const finished = finishInterruptedMessages(messages)
    assert.equal(finished[0].isStreaming, false)
    assert.equal(finished[0].blocks[0].isStreaming, false)
    assert.equal(finished[0].blocks[0].durationSec, 12)
  } finally {
    Date.now = originalDateNow
  }
})

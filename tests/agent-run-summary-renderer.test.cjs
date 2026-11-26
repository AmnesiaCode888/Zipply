const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

function load(file) {
  const source = path.resolve(file)
  const built = buildSync({ entryPoints: [source], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external', loader: { '.svg': 'dataurl', '.css': 'empty' } })
  const mod = new Module(source, module)
  mod.filename = source
  mod.paths = module.paths
  mod._compile(built.outputFiles[0].text, source)
  return mod.exports
}

test('run summary is retained on the assistant message', () => {
  const { applyEventToBlocks } = load('src/renderer/src/hooks/useChat.ts')
  const message = { id: 'assistant-1', role: 'assistant' }
  const summary = { reason: 'completed', rounds: 3, usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 }, elapsedMs: 500, checks: [], verificationStatus: 'unverified', unverifiedCriteria: ['output exists'] }
  applyEventToBlocks({ type: 'run_summary', summary }, [], message)
  assert.deepEqual(message.runSummary, summary)
})

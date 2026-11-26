const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

function load(file) {
  const filename = path.resolve(file)
  const result = buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false })
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths; mod._compile(result.outputFiles[0].text, filename); return mod.exports
}

test('a refs-only turn remains a real user turn without expanding extension content into history', () => {
  const { buildAgentHistory } = load('src/renderer/src/services/agentHistory.ts')
  const history = buildAgentHistory([{
    id: 'user-1', role: 'user', content: '',
    extensionRefs: [{ kind: 'skill', id: 'skill-1', label: 'Review', revision: 'sha256:abc' }]
  }])
  assert.equal(history.length, 1)
  assert.equal(history[0].role, 'user')
  assert.match(history[0].content, /выбранные расширения/i)
  assert.doesNotMatch(JSON.stringify(history), /SKILL\.md|bodyPath|sha256:abc/)
})

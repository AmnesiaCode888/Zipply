const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
function load(file) { const r = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' }); const m = new Module(path.resolve(file), module); m.filename = path.resolve(file); m.paths = module.paths; m._compile(r.outputFiles[0].text, m.filename); return m.exports }

test('process tools have separate read and mutation policies', () => {
  const { toolRegistry } = load('src/main/agent/tools/ToolRegistry.ts')
  for (const name of ['process_start', 'process_stop']) assert.equal(toolRegistry.getTool(name).getExecutionPolicy().mutates, true)
  for (const name of ['process_poll', 'process_list']) {
    const policy = toolRegistry.getTool(name).getExecutionPolicy()
    assert.equal(policy.mutates, false); assert.equal(policy.cacheable, false)
  }
})

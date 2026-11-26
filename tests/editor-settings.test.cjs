const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
function load() {
  const file = path.resolve('src/renderer/src/services/editorSettings.ts')
  const built = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false })
  const mod = new Module(file, module); mod.filename = file; mod.paths = module.paths; mod._compile(built.outputFiles[0].text, file); return mod.exports
}
test('editor settings persist and malformed values fall back to safe defaults', () => {
  const { loadEditorSettings, saveEditorSettings } = load()
  let stored = ''
  let notified = false
  global.localStorage = { getItem: () => stored || null, setItem: (_, value) => { stored = value } }
  global.window = { dispatchEvent: () => { notified = true } }
  try {
    assert.deepEqual(loadEditorSettings(), { diagnostics: true, delay: 1000, markers: true })
    assert.equal(saveEditorSettings({ diagnostics: false, delay: 2000, markers: false }), true)
    assert.equal(notified, true)
    assert.deepEqual(loadEditorSettings(), { diagnostics: false, delay: 2000, markers: false })
    stored = '{"delay":-1,"diagnostics":"bad"}'
    assert.deepEqual(loadEditorSettings(), { diagnostics: true, delay: 1000, markers: true })
  } finally { delete global.localStorage; delete global.window }
})

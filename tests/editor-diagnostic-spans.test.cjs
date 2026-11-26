const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
function load() {
  const file = path.resolve('src/renderer/src/components/layout/diagnosticSpans.ts')
  const built = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false })
  const mod = new Module(file, module); mod.filename = file; mod.paths = module.paths; mod._compile(built.outputFiles[0].text, file); return mod.exports
}
test('diagnostic ranges preserve text and underline exact positions including overlaps', () => {
  const { diagnosticSpans } = load()
  const text = 'const x = 1\nconst y = bad\n'
  const spans = diagnosticSpans(text, [
    { line: 2, column: 11, endLine: 2, endColumn: 14, category: 'Error', message: 'bad' },
    { line: 2, column: 12, endLine: 2, endColumn: 13, category: 'Warning', message: 'overlap' }
  ])
  assert.equal(spans.map(part => part.text).join(''), text)
  assert.deepEqual(spans.filter(part => part.category), [{ text: 'bad', category: 'Error' }])
})

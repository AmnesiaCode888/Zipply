const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

function load(file) {
  const result = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const mod = new Module(path.resolve(file), module)
  mod.filename = path.resolve(file)
  mod.paths = module.paths
  mod._compile(result.outputFiles[0].text, mod.filename)
  return mod.exports
}

test('parsePartialToolArgs decodes partial Windows paths and unicode escapes without breaking', () => {
  const { parsePartialToolArgs } = load('src/renderer/src/services/partialToolArgs.ts')

  const winPartial = parsePartialToolArgs('{"path":"C:\\\\Users\\\\amnesia\\\\proj')
  assert.equal(winPartial.path, 'C:\\Users\\amnesia\\proj')

  const unicodeContent = parsePartialToolArgs('{"path":"a.ts","content":"if (a \\u003c b)\\n\\treturn \\"')
  assert.equal(unicodeContent.path, 'a.ts')
  assert.equal(unicodeContent.content, 'if (a < b)\n\treturn "')
})

test('parsePartialToolArgs ignores nested path/command keys inside streamed content', () => {
  const { parsePartialToolArgs } = load('src/renderer/src/services/partialToolArgs.ts')

  const streamed = '{"content":"{\\"path\\": \\"nested.json\\", \\"command\\": \\"rm -rf\\"}","path":"real'
  const parsed = parsePartialToolArgs(streamed)
  assert.equal(parsed.content, '{"path": "nested.json", "command": "rm -rf"}')
  assert.equal(parsed.path, 'real')
  assert.equal(parsed.command, undefined)
})

test('parsePartialToolArgs preserves multi-edit fragments even before edits array closes', () => {
  const { parsePartialToolArgs } = load('src/renderer/src/services/partialToolArgs.ts')

  const streamed = '{"path":"app.ts","edits":[{"target":"old1","replacement":"new1"},{"target":"old2","replacement":"new'
  const parsed = parsePartialToolArgs(streamed)
  assert.equal(parsed.path, 'app.ts')
  assert.equal(parsed.target, 'old1\n\nold2')
  assert.equal(parsed.content, 'new1\n\nnew')
})

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

function load(file) {
  const built = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external', loader: { '.svg': 'dataurl' } })
  const mod = new Module(path.resolve(file), module)
  mod.filename = path.resolve(file)
  mod.paths = module.paths
  mod._compile(built.outputFiles[0].text, mod.filename)
  return mod.exports
}

const { CommandApproval } = load('src/renderer/src/components/chat/CommandApproval.tsx')
const render = (details, target = 'file.txt') => renderToStaticMarkup(React.createElement(CommandApproval, { approval: { requestId: 'r', approvalId: 'a', command: '', kind: 'file', target, details } }))

test('write approval shows actual multiline content with indentation, not escaped JSON', () => {
  const html = render(JSON.stringify({ path: 'file.txt', content: 'first\n  second "quoted"\n' }))
  assert.match(html, /Новое содержимое/)
  assert.match(html, /first\n  second &quot;quoted&quot;\n/)
  assert.doesNotMatch(html, /\\n/)
  assert.doesNotMatch(html, /&quot;content&quot;/)
})

test('edit approval shows both old and replacement fragments, including empty replacement', () => {
  const html = render(JSON.stringify({ path: 'file.txt', target: 'old\n  value', replacement: '' }))
  assert.match(html, /Было/)
  assert.match(html, /Станет/)
  assert.match(html, /old\n  value/)
  assert.match(html, /Пустое содержимое/)
})

test('unexpected approval details remain visible and safely escaped', () => {
  const html = render('<script>alert(1)</script>')
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.doesNotMatch(html, /<script>/)
})

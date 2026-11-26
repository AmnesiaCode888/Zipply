const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

function load(file) {
  const result = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external', loader: { '.svg': 'dataurl', '.css': 'empty' } })
  const mod = new Module(path.resolve(file), module)
  mod.filename = path.resolve(file); mod.paths = module.paths
  mod._compile(result.outputFiles[0].text, mod.filename)
  return mod.exports
}

test('long read and search targets truncate independently of visible error and running statuses', () => {
  const { ToolCallCard } = load('src/renderer/src/components/tools/ToolCallCard.tsx')
  const target = 'very/long/'.repeat(30) + 'target.ts'
  for (const [type, label] of [['file_read', 'Прочитал'], ['search', 'Поиск']]) {
    for (const [status, display] of [['running', 'выполняется'], ['error', 'ошибка']]) {
      const html = renderToStaticMarkup(React.createElement(ToolCallCard, { tool: { id: type, type, label, targetName: target, content: 'details', status } }))
      assert.match(html, type === 'file_read' ? /class="[^"]*truncate[^"]*">target\.ts/ : /class="[^"]*truncate[^"]*">very\/long/)
      assert.match(html, new RegExp(`</span><span class="[^"]*shrink-0[^"]*whitespace-nowrap[^"]*"> — ${display}</span>`))
      assert.ok(html.includes(`title="${target}"`))
      assert.match(html, /aria-expanded="false"/)
    }
  }
})

test('long failing terminal commands retain an unobscured error status', () => {
  const { ToolCallCard } = load('src/renderer/src/components/tools/ToolCallCard.tsx')
  const command = 'python '.repeat(100)
  const html = renderToStaticMarkup(React.createElement(ToolCallCard, { tool: { id:'cmd', type:'terminal', label:'Терминал', targetName:command, content:'failure', status:'error' } }))
  assert.match(html, /class="[^"]*truncate[^"]*"[^>]*>Терминал/)
  assert.match(html, /<span class="[^"]*shrink-0[^"]*whitespace-nowrap[^"]*">\s*— ошибка<\/span>/)
})

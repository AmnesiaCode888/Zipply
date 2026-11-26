const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
function load(file) { const r = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external', loader: { '.svg': 'dataurl', '.css': 'empty' } }); const m = new Module(path.resolve(file), module); m.filename = path.resolve(file); m.paths = module.paths; m._compile(r.outputFiles[0].text, m.filename); return m.exports }
const markup = (Component, props) => renderToStaticMarkup(React.createElement(Component, props))
test('each running tool has a shining label while completed and failed tools remain static', () => {
  const { ToolCallCard } = load('src/renderer/src/components/tools/ToolCallCard.tsx')
  for (const type of ['file_read', 'search', 'terminal', 'file_edit']) {
    for (const status of ['running', 'completed', 'error']) {
      const html = markup(ToolCallCard, { tool: { id: type, type, label: 'Действие', targetName: 'test.ts', content: 'result', status } })
      assert.equal(html.includes('data-shining-text="true"'), status === 'running', `${type}: ${status}`)
    }
  }
})
test('collapsed activity shines only while a tool is running', () => {
  const { ChatMessageItem } = load('src/renderer/src/components/ChatMessageItem.tsx')
  const block = (id, status) => ({ type: 'tool', id, tool: { id, type: 'search', label: 'Поиск', targetName: id, content: 'result', status } })
  for (const status of ['running', 'completed', 'error']) {
    const html = markup(ChatMessageItem, { message: { id: 'm', role: 'assistant', blocks: [block('a', 'completed'), block('b', status)], isStreaming: status === 'running' } })
    assert.equal(html.includes('data-shining-text="true"'), status === 'running', status)
  }
})

test('live thinking shines and completed thinking remains static', () => {
  const { ThinkingBlock } = load('src/renderer/src/components/ThinkingBlock.tsx')
  for (const isStreaming of [true, false]) {
    const html = markup(ThinkingBlock, { content: 'мысль', isStreaming })
    assert.equal(html.includes('data-shining-text="true"'), isStreaming)
  }
})

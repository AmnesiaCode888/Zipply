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
const session = (id, title) => ({ id, title, createdAt: 1, updatedAt: 1, messages: [] })
const renderSidebar = (props = {}) => {
  const { Sidebar } = load('src/renderer/src/components/sidebar/Sidebar.tsx')
  return renderToStaticMarkup(React.createElement(Sidebar, { sessions: [session('a', 'Первый чат'), session('b', 'Фоновый чат')], activeChatId: 'a', ...props }))
}

test('only chats waiting for confirmation show an accessible indicator, including background chats', () => {
  const html = renderSidebar({ approvalChatIds: ['b'] })
  const rows = html.split('role="button"').slice(1)
  assert.equal(rows.length, 2)
  assert.doesNotMatch(rows[0], /Ожидает подтверждения инструмента/)
  assert.match(rows[1], /Фоновый чат/)
  assert.match(rows[1], /aria-label="Ожидает подтверждения инструмента"/)
})

test('indicator follows the requested chat id and disappears after confirmation', () => {
  const marked = renderSidebar({ activeChatId: 'b', approvalChatIds: ['a'] })
  const rows = marked.split('role="button"').slice(1)
  assert.match(rows[0], /Ожидает подтверждения инструмента/)
  assert.doesNotMatch(rows[1], /Ожидает подтверждения инструмента/)
  assert.doesNotMatch(renderSidebar({ approvalChatIds: [] }), /Ожидает подтверждения инструмента/)
  assert.doesNotMatch(renderSidebar(), /Ожидает подтверждения инструмента/)
})

test('only the chat with a pending title uses shining text', () => {
  const html = renderSidebar({ generatingTitleChatIds: ['b'] })
  const rows = html.split('role="button"').slice(1)
  assert.doesNotMatch(rows[0], /data-shining-text/)
  assert.match(rows[1], /data-shining-text="true"/)
})


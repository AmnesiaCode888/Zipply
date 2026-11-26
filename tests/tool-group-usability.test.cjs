const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

function load(file) {
  const built = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external', loader: { '.svg': 'dataurl', '.css': 'empty' } })
  const mod = new Module(path.resolve(file), module)
  mod.filename = path.resolve(file); mod.paths = module.paths
  mod._compile(built.outputFiles[0].text, mod.filename)
  return mod.exports
}
const action = (id, type, status = 'completed') => ({ type: 'tool', id, tool: { id, type, label: type === 'file_read' ? 'Прочитал' : type === 'search' ? 'Поиск' : type === 'file_edit' ? 'Отредактировал' : 'Терминал', targetName: `${id}.ts`, content: `result ${id}`, status } })
function render(blocks, isStreaming = false) {
  const { ChatMessageItem } = load('src/renderer/src/components/ChatMessageItem.tsx')
  return renderToStaticMarkup(React.createElement(ChatMessageItem, { message: { id: 'm', role: 'assistant', blocks, isStreaming } }))
}
const textOf = html => html.replace(/<[^>]*>/g, '')

test('a live read remains visible while earlier actions are compacted', () => {
  const html = render([action('first', 'file_read'), action('second', 'file_read'), action('current', 'file_read', 'running')], true)
  assert.match(html, /Читаю файлы/); assert.doesNotMatch(html, /current\.ts/)
})

test('edits and errors remain visible with completed commands in stages', () => {
  const html = render([action('one', 'file_read'), action('two', 'file_read'), action('bad', 'search', 'error'), action('changed', 'file_edit'), action('check', 'terminal')])
  assert.match(html, /Поиск информации/)
  assert.match(textOf(html), /bad\.ts.*ошибка/)
  assert.match(html, /changed\.ts/)
  assert.match(html, /Выполнение команды/)
})

test('two actions show the active action while the earlier one is grouped', () => {
  const html = render([action('first', 'file_read'), action('second', 'file_read', 'running')], true)
  assert.match(html, /Читаю файлы/)
  assert.doesNotMatch(html, /second\.ts/)
})

test('read groups count calls without falsely calling web pages or batches individual files', () => {
  const { applyEventToBlocks } = load('src/renderer/src/hooks/useChat.ts')
  for (const calls of [
    [['read_files', { files: [{ path: 'a.ts' }, { path: 'b.ts' }] }], ['read_files', { files: [{ path: 'c.ts' }, { path: 'd.ts' }] }]],
    [['read_page', { url: 'https://example.com/one' }], ['read_page', { url: 'https://example.com/two' }]],
    [['read_file', { path: 'same.ts', start_line: 1 }], ['read_file', { path: 'same.ts', start_line: 20 }]]
  ]) {
    const blocks = [], message = { id: 'm', role: 'assistant', blocks }
    calls.forEach(([name, args], index) => {
      const callId = `call-${index}`
      applyEventToBlocks({ type: 'tool_start', callId, toolName: name, args }, blocks, message)
      applyEventToBlocks({ type: 'tool_result', callId, result: 'ok' }, blocks, message)
    })
    const html = renderToStaticMarkup(React.createElement(load('src/renderer/src/components/ChatMessageItem.tsx').ChatMessageItem, { message }))
    assert.match(html, /Чтение файлов/)
    assert.doesNotMatch(html, /2 файла/)
  }
})

test('a long read or search target cannot hide its error or running status', () => {
  const { ToolCallCard } = load('src/renderer/src/components/tools/ToolCallCard.tsx')
  for (const [type, status, expected] of [['file_read', 'error', 'ошибка'], ['search', 'running', 'выполняется']]) {
    const html = renderToStaticMarkup(React.createElement(ToolCallCard, { tool: { id: type, type, label: 'Действие', targetName: 'long/path/'.repeat(30), content: 'result', status } }))
    assert.match(html, /class="truncate min-w-0"/)
    assert.match(html, new RegExp(`<span class="shrink-0 whitespace-nowrap">[^<]*${expected}</span>`))
  }
})

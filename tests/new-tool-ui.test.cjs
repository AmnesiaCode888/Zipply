const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
function load(file) { const r = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external', loader: { '.svg': 'dataurl', '.css': 'empty' } }); const m = new Module(path.resolve(file), module); m.filename = path.resolve(file); m.paths = module.paths; m._compile(r.outputFiles[0].text, m.filename); return m.exports }
test('patch result displays both files and their individual diffs', () => {
  const { ToolCallCard } = load('src/renderer/src/components/tools/ToolCallCard.tsx')
  const tool = { id: '1', type: 'terminal', label: 'Пакет правок', content: 'done', status: 'completed', patchFiles: [{ path: 'a.ts', action: 'update', diff: '-old\n+new' }, { path: 'b.ts', action: 'create', diff: '+second' }] }
  const html = renderToStaticMarkup(React.createElement(ToolCallCard, { tool, isExpanded: true }))
  assert.match(html, /a\.ts/); assert.match(html, /b\.ts/); assert.match(html, /second/); assert.match(html, /Изменён/); assert.match(html, /Создан/)
})

test('unified diff skips headers and uses hunk line numbers', () => {
  const { DiffViewer } = load('src/renderer/src/components/tools/DiffViewer.tsx')
  const diffText = 'Index: a.ts\n===================================================================\n--- a.ts\n+++ b.ts\n@@ -42,1 +88,1 @@\n-oldValue\n+newValue'
  const html = renderToStaticMarkup(React.createElement(DiffViewer, { diffText }))
  assert.doesNotMatch(html, /-- a\.ts|\+\+ b\.ts|Index: a\.ts/)
  assert.match(html, />42</); assert.match(html, />88</)
})

test('process results display state and exit code without raw JSON', () => {
  const { applyEventToBlocks } = load('src/renderer/src/hooks/useChat.ts')
  const { ToolCallCard } = load('src/renderer/src/components/tools/ToolCallCard.tsx')
  const blocks = [], message = { id: 'm', role: 'assistant' }
  applyEventToBlocks({ type: 'tool_start', callId: 'p', toolName: 'process_poll', args: { process_id: 'abc' } }, blocks, message)
  applyEventToBlocks({ type: 'tool_result', callId: 'p', result: 'Процесс abc: exited; курсор 4\ndone', data: { id: 'abc', status: 'exited', output: 'done', cursor: 4, truncated: false, exitCode: 3, signal: null } }, blocks, message)
  const html = renderToStaticMarkup(React.createElement(ToolCallCard, { tool: blocks[0].tool, isExpanded: true }))
  assert.match(html, /Вывод процесса/); assert.match(html, /Завершён/); assert.match(html, /Код выхода: 3/); assert.match(html, /done/)
})

test('code analysis identifies the requested operation and position', () => {
  const { applyEventToBlocks } = load('src/renderer/src/hooks/useChat.ts')
  const blocks = [], message = { id: 'm', role: 'assistant' }
  applyEventToBlocks({ type: 'tool_start', callId: 'a', toolName: 'code_intelligence', args: { operation: 'references', path: 'src/a.ts', line: 12, column: 4 } }, blocks, message)
  const { ToolCallCard } = load('src/renderer/src/components/tools/ToolCallCard.tsx')
  const html = renderToStaticMarkup(React.createElement(ToolCallCard, { tool: blocks[0].tool }))
  assert.match(html, /Поиск использований/); assert.match(html, /12:4/)
})

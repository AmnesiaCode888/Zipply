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
  mod.filename = path.resolve(file)
  mod.paths = module.paths
  mod._compile(result.outputFiles[0].text, mod.filename)
  return mod.exports
}
const tool = (id, type = 'file_read', status = 'completed') => ({ type: 'tool', id, tool: { id, type, label: type === 'search' ? 'Поиск' : 'Прочитал', targetName: `${id}.txt`, content: `result-${id}`, status } })

test('activity stages cross thoughts but do not cross response text', () => {
  const { buildActivityItems } = load('src/renderer/src/components/chat/activityStages.ts')
  const blocks = [tool('a'), tool('b'), { id: 'text', type: 'text', content: 'Between' }, tool('c', 'search'), tool('d', 'search'), { id: 'thought', type: 'thinking', content: 'thinking' }, tool('e')]
  const items = buildActivityItems(blocks)
  assert.deepEqual(items.map(item => item.kind === 'activity' ? item.blocks.map(block => block.id) : [item.block.id]), [['a','b'], ['text'], ['c','d','thought','e']])
})

test('running file previews remain visible while collapsed stage errors stay tucked away', () => {
  const { ChatMessageItem } = load('src/renderer/src/components/ChatMessageItem.tsx')
  const file = { type: 'tool', id: 'file', tool: { id: 'file', type: 'file_edit', label: 'Написал', targetName: 'live.ts', content: 'live preview', status: 'running' } }
  const html = renderToStaticMarkup(React.createElement(ChatMessageItem, { message: { id: 'm', role: 'assistant', blocks: [tool('error', 'search', 'error'), file], isStreaming: true, activeFileToolId: 'file' } }))
  assert.doesNotMatch(html, /ошибк/i)
  assert.match(html, /aria-expanded="true"/)
  assert.match(html, /live preview/)
})

test('read and search cards expose their available output with an accessible control', () => {
  const { ToolCallCard } = load('src/renderer/src/components/tools/ToolCallCard.tsx')
  for (const type of ['file_read', 'search']) {
    const html = renderToStaticMarkup(React.createElement(ToolCallCard, { tool: { id: type, type, label: type === 'search' ? 'Поиск' : 'Прочитал', targetName: 'source', content: 'visible output', status: 'error' }, isExpanded: true }))
    assert.match(html, /aria-expanded="true"/)
    assert.match(html, /visible output/)
    assert.match(html, /ошибк/i)
  }
})

test('legacy tool list is grouped without losing the final answer', () => {
  const { ChatMessageItem } = load('src/renderer/src/components/ChatMessageItem.tsx')
  const html = renderToStaticMarkup(React.createElement(ChatMessageItem, { message: { id: 'm', role: 'assistant', tools: [tool('a').tool, tool('b').tool], content: 'Answer' } }))
  assert.match(html, /Чтение файлов/); assert.match(html, /Answer/)
})

test('new coding tools and multi-edit previews retain their meaning during streaming', () => {
  const { applyEventToBlocks } = load('src/renderer/src/hooks/useChat.ts')
  const blocks = [], message = { id: 'm', role: 'assistant' }
  applyEventToBlocks({ type: 'tool_call_stream', callId: 'find', toolName: 'find_files', argsBuffer: '{"pattern":"*.ts"}' }, blocks, message)
  applyEventToBlocks({ type: 'tool_start', callId: 'find', toolName: 'find_files', args: { pattern: '*.ts' } }, blocks, message)
  applyEventToBlocks({ type: 'tool_start', callId: 'reads', toolName: 'read_files', args: { files: [{ path: 'a' }, { path: 'b' }] } }, blocks, message)
  applyEventToBlocks({ type: 'tool_call_stream', callId: 'edit', toolName: 'edit_file', argsBuffer: '{"path":"a","edits":[{"target":"one","replacement":"ONE"},{"target":"two","replacement":"TW' }, blocks, message)
  const byId = id => blocks.find(block => block.id === id).tool
  assert.equal(byId('find').type, 'search')
  assert.equal(byId('find').targetName, '*.ts')
  assert.equal(byId('reads').type, 'file_read')
  assert.match(byId('reads').targetName, /a/)
  assert.match(byId('reads').targetName, /b/)
  assert.match(byId('edit').content, /ONE/)
  assert.match(byId('edit').content, /TW/)
  assert.match(byId('edit').streamTarget, /two/)
})


test('manual group expansion remains stable as more completed actions arrive', () => {
  const originalLoad = Module._load
  const state = []
  let hookIndex = 0
  let groupButton
  const wrappedReact = { ...React, createElement(type, props, ...children) {
    if (type === 'button' && props?.['aria-expanded'] !== undefined && !groupButton) groupButton = props
    return React.createElement(type, props, ...children)
  }, useState(initial) {
    const index = hookIndex++
    if (index >= 2) return React.useState(initial)
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
    return [state[index], (next) => { state[index] = typeof next === 'function' ? next(state[index]) : next }]
  } }
  let ChatMessageItem
  try {
    Module._load = function (id, ...args) { return id === 'react' ? wrappedReact : originalLoad.call(this, id, ...args) }
    ;({ ChatMessageItem } = load('src/renderer/src/components/ChatMessageItem.tsx'))
  } finally { Module._load = originalLoad }
  const blocks = [tool('one'), tool('two'), tool('active', 'search', 'running')]
  const message = { id: 'm', role: 'assistant', blocks, isStreaming: true }
  const render = () => { hookIndex = 0; groupButton = undefined; return renderToStaticMarkup(React.createElement(ChatMessageItem, { message })) }
  assert.match(render(), /aria-expanded="false"/)
  groupButton.onClick()
  assert.match(render(), /aria-expanded="true"/)
  blocks.splice(2, 0, tool('three'))
  const expanded = render()
  assert.match(expanded, /aria-expanded="true"/)
  assert.match(expanded.replace(/<[^>]*>/g, ''), /Прочитал\s+three\.txt/)
  groupButton.onClick()
  const collapsed = render()
  assert.match(collapsed, /aria-expanded="false"/)
  assert.match(collapsed, /Ищу информацию/)
  assert.doesNotMatch(collapsed, /three\.txt/)
  assert.doesNotMatch(collapsed, /result-active/)
})

test('approval presents each proposed replacement before authorization', () => {
  const { CommandApproval } = load('src/renderer/src/components/chat/CommandApproval.tsx')
  const details = JSON.stringify({ path: 'a.ts', edits: [{ target: 'old1', replacement: 'new1' }, { target: 'old2', replacement: 'new2' }] })
  const html = renderToStaticMarkup(React.createElement(CommandApproval, { approval: { requestId: 'r', approvalId: 'a', kind: 'file', target: 'a.ts', command: 'edit_file', details } }))
  assert.match(html, /Было · правка 1/)
  assert.match(html, /Станет · правка 2/)
  for (const text of ['old1', 'new1', 'old2', 'new2']) assert.match(html, new RegExp(text))
  assert.match(html, /Разрешить/)
})


test('running action remains visible and joins its stage after completion', () => {
  const { ChatMessageItem } = load('src/renderer/src/components/ChatMessageItem.tsx')
  const blocks = [tool('a'), tool('b'), tool('c', 'file_read', 'running')]
  const render = isStreaming => renderToStaticMarkup(React.createElement(ChatMessageItem, { message: { id: 'm', role: 'assistant', blocks, isStreaming } }))
  assert.match(render(true), /Читаю файлы/)
  blocks[2].tool.status = 'completed'
  assert.doesNotMatch(render(false), /c\.txt/)
  assert.match(render(false), /Чтение файлов/)
})

test('failed and running actions stay hidden inside a collapsed stage', () => {
  const { ChatMessageItem } = load('src/renderer/src/components/ChatMessageItem.tsx')
  const unknown = tool('unknown'); delete unknown.tool.status
  const blocks = [tool('a'), unknown, tool('b'), tool('failed', 'file_read', 'error'), tool('c'), tool('active', 'file_read', 'running')]
  const html = renderToStaticMarkup(React.createElement(ChatMessageItem, { message: { id: 'm', role: 'assistant', blocks, isStreaming: true } }))
  assert.match(html, /Читаю файлы/)
  const text = html.replace(/<[^>]*>/g, '')
  assert.doesNotMatch(text, /failed\.txt/)
  assert.doesNotMatch(text, /active\.txt/)
})

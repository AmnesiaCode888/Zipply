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
const render = tool => renderToStaticMarkup(React.createElement(load('src/renderer/src/components/tools/ToolCallCard.tsx').ToolCallCard, { tool }))

test('reading a file shows its icon and basename while retaining its full path', () => {
  const html = render({ id: 'read', type: 'file_read', label: 'Прочитал', targetName: 'src/components/Chat.tsx', content: 'result', status: 'completed' })
  assert.match(html, /Прочитал/); assert.match(html, /<svg/); assert.match(html, />Chat\.tsx</); assert.match(html, /title="src\/components\/Chat\.tsx"/)
})

test('batch reads retain individual file paths and show an icon and name for each file', () => {
  const { applyEventToBlocks } = load('src/renderer/src/hooks/useChat.ts')
  const blocks = [], message = { id: 'm', role: 'assistant', blocks }
  applyEventToBlocks({ type: 'tool_start', callId: 'read', toolName: 'read_files', args: { files: [{ path: 'src/a.ts' }, { path: 'docs/b.md' }] } }, blocks, message)
  const html = render(blocks[0].tool)
  assert.match(html, />a\.ts</); assert.match(html, />b\.md</)
  assert.equal((html.match(/<svg/g) || []).length, 2)
  assert.match(html, /title="src\/a\.ts"/); assert.match(html, /title="docs\/b\.md"/)
})

test('web page reads and search queries are not displayed as file names', () => {
  const page = render({ id: 'web', type: 'file_read', label: 'Прочитал', targetName: 'https://example.com/article.html', content: 'result' })
  const search = render({ id: 'search', type: 'search', label: 'Поиск', targetName: 'app.ts', content: 'result' })
  assert.equal((page.match(/<svg/g) || []).length, 1); assert.match(page, /https:\/\/example\.com\/article\.html/)
  assert.equal((search.match(/<svg/g) || []).length, 1); assert.match(search, /app\.ts/)
})

test('a collapsed activity group retains all file targets for its expanded view', () => {
  const { buildActivityItems } = load('src/renderer/src/components/chat/activityStages.ts')
  const blocks = ['src/a.ts', 'docs/b.md', 'src/c.ts'].map((targetName, index) => ({ type: 'tool', id: String(index), tool: { id: String(index), type: 'file_read', label: 'Прочитал', targetName, content: 'result', status: 'completed' } }))
  const [stage] = buildActivityItems(blocks)
  assert.equal(stage.title, 'Работа над задачей')
  assert.deepEqual(stage.blocks.map(block => block.tool.targetName), ['src/a.ts', 'docs/b.md', 'src/c.ts'])
})

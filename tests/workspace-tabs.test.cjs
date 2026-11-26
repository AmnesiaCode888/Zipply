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
  mod.filename = path.resolve(file); mod.paths = module.paths
  mod._compile(built.outputFiles[0].text, mod.filename)
  return mod.exports
}
test('workspace tab shows its empty state and panel controls', () => {
  const { WorkspacePanel } = load('src/renderer/src/components/layout/WorkspacePanel.tsx')
  const html = renderToStaticMarkup(React.createElement(WorkspacePanel, { width: 440, maxWidth: 600, tabs: [{ id: '1', title: 'Вкладка 1' }], activeTabId: '1' }))
  assert.match(html, /role="tab"/)
  assert.match(html, /Добавить вкладку/)
  assert.match(html, /Закрыть вкладку Вкладка 1/)
  assert.doesNotMatch(html, /Закрыть рабочую панель/)
  assert.match(html, /Выберите, что открыть/)
  assert.match(html, /Файлы/)
  assert.match(html, /Терминал/)
  assert.match(html, /Изменения/)
  assert.doesNotMatch(html, /Здесь появятся рабочие инструменты/)
})

test('legacy tabs and file tabs restore without losing their order', () => {
  const { loadTabs } = load('src/renderer/src/hooks/useWorkspaceTabs.ts')
  const state = { tabs: [{ id: '2', title: 'Вкладка 2' }, { id: '1', title: 'Файлы', type: 'files' }], activeTabId: '1', nextId: 3 }
  global.localStorage = { getItem: () => JSON.stringify(state) }
  try { assert.deepEqual(loadTabs(), state) } finally { delete global.localStorage }
})

test('the chooser remains available after closing every tab', () => {
  const { WorkspacePanel } = load('src/renderer/src/components/layout/WorkspacePanel.tsx')
  const html = renderToStaticMarkup(React.createElement(WorkspacePanel, { width: 440, maxWidth: 600, tabs: [], activeTabId: null }))
  assert.match(html, /Выберите, что открыть/)
  assert.match(html, /Файлы/)
  assert.match(html, /Терминал/)
  assert.match(html, /Изменения/)
})

test('file tab restores its per-chat selection and renders the filename', () => {
  const { loadTabs } = load('src/renderer/src/hooks/useWorkspaceTabs.ts')
  const state = { tabs: [{ id: '1', title: 'Файлы', type: 'files', filesBySession: { chat1: { folderPath: 'C:/project', path: 'src/app.ts' } } }], activeTabId: '1', nextId: 2 }
  global.localStorage = { getItem: () => JSON.stringify(state) }
  try { assert.deepEqual(loadTabs(), state) } finally { delete global.localStorage }
  const { WorkspacePanel } = load('src/renderer/src/components/layout/WorkspacePanel.tsx')
  const html = renderToStaticMarkup(React.createElement(WorkspacePanel, { width: 440, maxWidth: 600, tabs: state.tabs, activeTabId: '1', sessionId: 'chat1', folderPath: 'C:/project' }))
  assert.match(html, /app\.ts/)
  assert.match(html, /Изменить ширину списка файлов/)
})

test('terminal and Zipply Терминал tabs restore cleanly and render WorkspaceTerminal view', () => {
  const { loadTabs } = load('src/renderer/src/hooks/useWorkspaceTabs.ts')
  const state = {
    tabs: [
      { id: '2', title: 'Zipply Терминал', type: 'ai-terminal', pinned: true },
      { id: '1', title: 'Терминал', type: 'terminal' }
    ],
    activeTabId: '2',
    nextId: 3
  }
  global.localStorage = { getItem: () => JSON.stringify(state) }
  try { assert.deepEqual(loadTabs(), state) } finally { delete global.localStorage }
  const { WorkspacePanel } = load('src/renderer/src/components/layout/WorkspacePanel.tsx')
  const html = renderToStaticMarkup(React.createElement(WorkspacePanel, { width: 440, maxWidth: 600, tabs: state.tabs, activeTabId: '2', sessionId: 'chat1', folderPath: 'C:/project' }))
  assert.match(html, /Zipply Терминал/)
  assert.match(html, /Закреплённый терминал Zipply/)
  assert.doesNotMatch(html, /Открепить вкладку Zipply Терминал/)
  assert.match(html, /Фоновые задачи/)
  assert.match(html, /role="tabpanel"/)
  assert.match(html, /bg-canvas/)
})

test('default workspace tabs pin Zipply Терминал by default', () => {
  const { loadTabs } = load('src/renderer/src/hooks/useWorkspaceTabs.ts')
  global.localStorage = { getItem: () => null }
  try {
    const state = loadTabs()
    assert.equal(state.tabs.length, 1)
    assert.equal(state.tabs[0].type, 'ai-terminal')
    assert.equal(state.tabs[0].pinned, true)
  } finally {
    delete global.localStorage
  }
})

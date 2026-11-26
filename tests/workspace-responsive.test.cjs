const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

function loadHook() {
  const file = 'src/renderer/src/hooks/useWorkspacePanel.ts'
  const built = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const mod = new Module(path.resolve(file), module)
  mod.filename = path.resolve(file); mod.paths = module.paths
  mod._compile(built.outputFiles[0].text, mod.filename)
  return mod.exports.useWorkspacePanel
}

test('workspace uses the visible sidebar width when deciding whether to hide it', () => {
  const useWorkspacePanel = loadHook()
  const oldWindow = global.window
  const oldStorage = global.localStorage
  global.localStorage = { getItem: key => key === 'zipply_workspace_open' ? 'true' : null }
  let result
  function App() { result = useWorkspacePanel(true, true, 260); return null }
  try {
    global.window = { innerWidth: 550 }
    renderToStaticMarkup(React.createElement(App))
    assert.equal(result.replace, true)
    assert.equal(result.hideSidebar, false, '360px remains alongside the actual compressed sidebar')
    global.window = { innerWidth: 400 }
    renderToStaticMarkup(React.createElement(App))
    assert.equal(result.hideSidebar, true, 'the sidebar is hidden when less than 320px remains')
  } finally { global.window = oldWindow; global.localStorage = oldStorage }
})

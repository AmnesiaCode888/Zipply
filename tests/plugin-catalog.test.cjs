const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

function load(file) {
  const filename = path.resolve(file)
  const result = buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', write: false })
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths; mod._compile(result.outputFiles[0].text, filename); return mod.exports
}

test('built-in plugin registry has complete catalog entries and unique documented tool IDs', () => {
  const { pluginCatalog } = load('src/shared/plugins/catalog.ts')
  const { builtInPackages, validatePluginRegistry } = load('src/main/agent/plugins/BuiltInPlugins.ts')
  assert.deepEqual(builtInPackages.map(plugin => plugin.id), pluginCatalog.map(plugin => plugin.id))
  assert.deepEqual(validatePluginRegistry(), [])
  assert.equal(pluginCatalog[0].id, 'cybersec')
  assert.ok(pluginCatalog[0].capabilities.length > 0)
  assert.ok(pluginCatalog[0].examples.length > 0)
})

test('SQLite and PDF are available as independently loadable built-in plugins', () => {
  const { getPluginToolIds } = load('src/main/agent/plugins/BuiltInPlugins.ts')
  assert.deepEqual(getPluginToolIds('sqlite'), ['sqlite_inspect_database'])
  assert.deepEqual(getPluginToolIds('pdf'), ['pdf_analyze_document'])
})

test('SQLite tool guides a requested plugin smoke test to create a small fixture before read-only inspection', () => {
  const { createPluginTool } = load('src/main/agent/plugins/BuiltInPlugins.ts')
  const tool = createPluginTool('sqlite', 'sqlite_inspect_database')
  assert.match(tool.description, /тестов.*баз/i)
  assert.match(tool.description, /обычн.*инструмент/i)
  assert.match(tool.description, /не уточняй схему/i)
})

test('SQLite and PDF can be listed, described, and loaded through plugin_manager', async () => {
  const { builtInPackages } = load('src/main/agent/plugins/BuiltInPlugins.ts')
  const { PluginManagerTool } = load('src/main/agent/plugins/PluginManagerTool.ts')
  const loadedTools = new Set()
  const manager = new PluginManagerTool({
    installedPluginIds: ['sqlite', 'pdf'],
    plugins: builtInPackages,
    getLoadedToolIds: () => [...loadedTools],
    getPluginTools: id => builtInPackages.find(plugin => plugin.id === id)?.createTools() || [],
    loadTool: (_pluginId, toolId) => loadedTools.add(toolId)
  })
  const listed = await manager.execute(JSON.stringify({ action: 'list' }), {})
  assert.deepEqual(listed.data.map(plugin => plugin.id), ['sqlite', 'pdf'])

  for (const [pluginId, toolId] of [['sqlite', 'sqlite_inspect_database'], ['pdf', 'pdf_analyze_document']]) {
    const described = await manager.execute(JSON.stringify({ action: 'describe', pluginId }), {})
    assert.deepEqual(described.data.tools.map(tool => tool.id), [toolId])
    const loaded = await manager.execute(JSON.stringify({ action: 'load', pluginId, toolId }), {})
    assert.equal(loaded.success, true)
    assert.equal(loadedTools.has(toolId), true)
  }
})

test('new plugin tools use localized file labels and stable activity text', () => {
  const { resolveToolPresentation } = load('src/shared/toolPresentation.ts')
  const { inferToolActivity } = load('src/shared/activity.ts')
  assert.deepEqual(resolveToolPresentation({ toolName: 'sqlite_inspect_database', args: { path: 'data/app.sqlite' } }), {
    type: 'file_read', label: 'Анализ SQLite', targetName: 'data/app.sqlite'
  })
  assert.deepEqual(resolveToolPresentation({ toolName: 'pdf_analyze_document', args: { path: 'docs/report.pdf' } }), {
    type: 'file_read', label: 'Анализ PDF', targetName: 'docs/report.pdf'
  })
  assert.equal(inferToolActivity('sqlite_inspect_database', { path: 'data/app.sqlite' }), 'Анализирую SQLite data/app.sqlite')
  assert.equal(inferToolActivity('pdf_analyze_document', { path: 'docs/report.pdf' }), 'Анализирую PDF docs/report.pdf')
})

test('plugin registry rejects normalized collisions with base tools and reserved manager ID', () => {
  const { builtInPackages, validatePluginRegistry } = load('src/main/agent/plugins/BuiltInPlugins.ts')
  const existingToolId = builtInPackages[0].createTools()[0].name
  assert.ok(validatePluginRegistry([existingToolId.toUpperCase()]).some(error => error.includes('без учёта регистра')))
  const reservedPackage = [{ ...builtInPackages[0], createTools: () => [{ name: 'PLUGIN_MANAGER', description: 'Reserved name', parameters: {} }] }]
  assert.ok(validatePluginRegistry([], reservedPackage).some(error => error.includes('plugin_manager')))
  const caseVariantPackages = [builtInPackages[0], { ...builtInPackages[0], id: builtInPackages[0].id.toUpperCase() }]
  assert.ok(validatePluginRegistry([], caseVariantPackages).some(error => error.includes('ID плагина без учёта регистра')))
})

test('plugin manager lists and describes any supplied installed manifest without a hard-coded plugin list', async () => {
  const { PluginManagerTool } = load('src/main/agent/plugins/PluginManagerTool.ts')
  const manifest = { id: 'demo-plugin', name: 'Demo', summary: 'Small demo plugin', version: '1.0.0', description: 'A test plugin', category: 'Test', icon: 'demo', capabilities: [], examples: [], safetyNotes: 'No side effects.' }
  const secondManifest = { ...manifest, id: 'other-plugin', name: 'Other', summary: 'Another plugin' }
  const tool = { name: 'demo_scan', description: 'Scans one local fixture.', parameters: { path: { type: 'string', description: 'Fixture path', required: true } } }
  const otherTool = { ...tool, name: 'other_check' }
  const manager = new PluginManagerTool({ installedPluginIds: ['demo-plugin', 'other-plugin'], plugins: [manifest, secondManifest], getLoadedToolIds: () => ['demo_scan', 'other_check'], getPluginTools: id => id === 'demo-plugin' ? [tool] : id === 'other-plugin' ? [otherTool] : [], loadTool() {} })
  const listed = await manager.execute(JSON.stringify({ action: 'list' }), {})
  assert.equal(listed.data[0].id, 'demo-plugin')
  assert.deepEqual(listed.data[0].loadedTools, ['demo_scan'])
  assert.deepEqual(listed.data[1].loadedTools, ['other_check'])
  const described = await manager.execute(JSON.stringify({ action: 'describe', pluginId: 'demo-plugin', toolId: 'demo_scan' }), {})
  assert.equal(described.data.plugin, 'Demo')
  assert.equal(described.data.parameters.path.required, true)
})

test('plugin library and detail page are projections of the shared catalog', () => {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const libraryModule = load('src/renderer/src/components/plugins/PluginLibrary.tsx')
  const detailsModule = load('src/renderer/src/components/plugins/PluginDetails.tsx')
  const { pluginCatalog } = load('src/shared/plugins/catalog.ts')
  const library = renderToStaticMarkup(React.createElement(libraryModule.PluginLibrary, { installedIds: [], onInstall() {}, onSelect() {} }))
  const details = renderToStaticMarkup(React.createElement(detailsModule.PluginDetails, { plugin: libraryModule.plugins[0], onRemove() {} }))
  assert.equal(libraryModule.plugins[0].name, pluginCatalog[0].name)
  assert.match(library, new RegExp(pluginCatalog[0].summary))
  for (const capability of pluginCatalog[0].capabilities) assert.ok(details.includes(capability.title))
  assert.ok(details.includes(pluginCatalog[0].safetyNotes))
})

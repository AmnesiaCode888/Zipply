const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const Module = require('node:module')
const path = require('node:path')

function loadComponent(relativePath) {
  const file = path.resolve(relativePath)
  const built = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react'], write: false })
  const mod = new Module(file, module)
  mod.filename = file
  mod.paths = module.paths
  mod._compile(built.outputFiles[0].text, file)
  return mod.exports
}

test('plugin artwork has bounded dimensions in the library and plugin page', () => {
  const { PluginDetails } = loadComponent('src/renderer/src/components/plugins/PluginDetails.tsx')
  const { PluginLibrary, plugins } = loadComponent('src/renderer/src/components/plugins/PluginLibrary.tsx')
  const library = renderToStaticMarkup(React.createElement(PluginLibrary, { installedIds: [], onInstall() {}, onSelect() {} }))
  const details = renderToStaticMarkup(React.createElement(PluginDetails, { plugin: plugins[0], onRemove() {} }))
  const artworkTags = html => [...html.matchAll(/<svg\b(?=[^>]*viewBox="0 0 48 48")[^>]*>/g)].map(match => match[0])
  const checkSizes = (tags, expected) => {
    assert.equal(tags.length, expected.length)
    tags.forEach((tag, index) => {
      const size = expected[index]
      assert.match(tag, new RegExp(`width="${size}"`))
      assert.match(tag, new RegExp(`height="${size}"`))
      assert.match(tag, new RegExp(`width:${size}px;height:${size}px`))
    })
  }
  checkSizes(artworkTags(library), [44, 44, 44])
  checkSizes(artworkTags(details), [64, 20, 20, ...Array(plugins[0].capabilities.length).fill(24)])
})

test('SQLite and PDF use custom 48px artwork in the same tile style as CyberSec', () => {
  const { plugins } = loadComponent('src/renderer/src/components/plugins/PluginLibrary.tsx')
  for (const id of ['sqlite', 'pdf']) {
    const icon = plugins.find(plugin => plugin.id === id).icon
    const html = renderToStaticMarkup(React.createElement(icon, { size: 44 }))
    assert.match(html, /viewBox="0 0 48 48"/)
    assert.match(html, /linearGradient/)
    assert.match(html, /stroke="#D5DDFF"/)
  }
})

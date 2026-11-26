const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

function loadCard() {
  const file = path.resolve('src/renderer/src/components/tools/ToolCallCard.tsx')
  const built = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external', loader: { '.svg': 'dataurl', '.css': 'empty' } })
  const mod = new Module(file, module)
  mod.filename = file
  mod.paths = module.paths
  mod._compile(built.outputFiles[0].text, file)
  return mod.exports.ToolCallCard
}

test('collapsed file tools do not build the diff body until expanded', () => {
  const Card = loadCard()
  const tool = { id: 'large-file', type: 'file_edit', label: 'Написал', targetName: 'file.ts', content: '+uniquePreviewMarker', status: 'completed' }
  const render = isExpanded => renderToStaticMarkup(React.createElement(Card, { tool, isExpanded }))
  assert.doesNotMatch(render(false), /uniquePreviewMarker/)
  assert.match(render(true), /uniquePreviewMarker/)
})

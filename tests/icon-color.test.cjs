const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const file = 'src/renderer/src/components/chat-input/ChatActionRow.tsx'
const result = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external', loader: { '.svg': 'dataurl' } })
const mod = new Module(path.resolve(file), module)
mod.filename = path.resolve(file)
mod.paths = module.paths
mod._compile(result.outputFiles[0].text, mod.filename)

test('send icon inherits its state colour instead of overriding it inline', () => {
  for (const [hasText, expectedClass] of [[false, 'text-muted'], [true, 'text-white']]) {
    const html = renderToStaticMarkup(React.createElement(mod.exports.ChatActionRow, {
      buttonRef: { current: null }, onToggleMenu() {}, onSend() {}, onRemovePlan() {},
      hasText, accessMode: 'confirm', onAccessModeChange() {}
    }))
    const send = html.match(/<button[^>]*aria-label="Отправить"[\s\S]*?<\/button>/)?.[0]
    assert.ok(send)
    const svg = send.match(/<svg[^>]*>/)?.[0]
    assert.ok(svg)
    assert.match(svg, new RegExp(`class="[^"]*${expectedClass}`))
    assert.doesNotMatch(svg, /style="[^"]*color:/)
  }
})

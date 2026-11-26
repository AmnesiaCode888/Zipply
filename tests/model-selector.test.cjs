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

test('ModeSelector renders model options and reasoning effort levels', () => {
  const { ModeSelector } = load('src/renderer/src/components/mode-selector/ModeSelector.tsx')
  const html = renderToStaticMarkup(React.createElement(ModeSelector, {
    model: 'glm-5-3-flash-uncensored',
    reasoningEffort: 'max'
  }))
  assert.match(html, /Lite/)
  assert.match(html, /max/)
  assert.match(html, /Zipply Pro/)
  assert.match(html, /Zipply Lite/)
  assert.match(html, /Zipply Ultra/)
  for (const level of ['off', 'low', 'high', 'max']) {
    assert.match(html, new RegExp(`>${level}<`))
  }
})

test('toChatConfig forwards selected model and reasoningEffort', () => {
  const { toChatConfig } = load('src/renderer/src/services/settingsService.ts')
  const config = toChatConfig({
    theme: 'obsidian',
    defaultModel: 'glm-5-3-flash-uncensored',
    reasoningEffort: 'max',
    systemPrompt: 'Test prompt',
    localOnly: true,
    accessMode: 'confirm'
  })
  assert.equal(config.model, 'glm-5-3-flash-uncensored')
  assert.equal(config.reasoningEffort, 'max')
})

test('ChatService sends reasoning_effort for OAuth authFetch requests', async () => {
  const { ChatService } = load('src/main/agent/services/ChatService.ts')
  let capturedUrl = null
  let capturedBody = null
  const authFetch = async (url, init) => {
    capturedUrl = url
    capturedBody = JSON.parse(init.body)
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const res = await ChatService.chat(
    {
      authFetch,
      model: 'deepseek-v4-1-flash-1017-uncensored',
      reasoningEffort: 'max',
      stream: false
    },
    [{ role: 'user', content: 'hi' }]
  )
  assert.equal(res.content, 'ok')
  assert.equal(capturedUrl, '/api/code/chat/completions')
  assert.equal(capturedBody.model, 'deepseek-v4-1-flash-1017-uncensored')
  assert.equal(capturedBody.reasoning_effort, 'max')
})

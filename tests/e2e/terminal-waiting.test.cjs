const { test } = require('node:test')
const assert = require('node:assert/strict')
const { _electron: electron } = require('playwright-core')
const { buildSync } = require('esbuild')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')

test('terminal waiting status follows execution, output and completion', { timeout: 45000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-terminal-wait-'))
  const bundle = buildSync({
    stdin: { contents: `
      import React, { useState } from 'react'
      import { createRoot } from 'react-dom/client'
      import { ChatMessageItem } from './src/renderer/src/components/ChatMessageItem'
      function Fixture() {
        const [tool, setTool] = useState({ id: 'cmd', type: 'terminal', toolName: 'terminal', label: 'Терминал', targetName: 'long command', status: 'running' })
        window.updateTool = changes => setTool(old => ({ ...old, ...changes }))
        return <ChatMessageItem message={{ id: 'message', role: 'assistant', isStreaming: true, blocks: [{ type: 'tool', id: 'cmd', tool }] }} />
      }
      createRoot(document.getElementById('root')).render(<Fixture />)
    `, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, platform: 'browser', write: false, loader: { '.svg': 'dataurl', '.css': 'empty' }
  }).outputFiles[0].text
  let app
  try {
    app = await electron.launch({ args: ['tests/e2e/bootstrap.cjs'], env: { ...process.env, ZIPPLY_E2E_ROOT: root }, timeout: 30000 })
    const page = await app.firstWindow()
    await page.goto('about:blank')
    await page.setContent('<div id="root"></div>')
    await page.addScriptTag({ content: bundle })
    const waiting = page.getByRole('button', { name: 'Ожидаю ответ от терминала' })
    await page.waitForTimeout(3200)
    assert.equal(await waiting.count(), 0, 'approval must not be mistaken for terminal execution')
    await page.evaluate(() => window.updateTool({ executionStarted: true }))
    await page.waitForTimeout(1500)
    assert.equal(await waiting.count(), 0, 'fast execution should not show a waiting state')
    await waiting.waitFor({ timeout: 3500 })
    assert.equal(await waiting.locator('[data-terminal-waiting]').count(), 1)
    await page.evaluate(() => window.updateTool({ content: 'progress' }))
    await waiting.waitFor({ state: 'hidden', timeout: 1000 })
    await waiting.waitFor({ timeout: 4500 })
    await page.evaluate(() => window.updateTool({ status: 'completed' }))
    await waiting.waitFor({ state: 'hidden', timeout: 1000 })
    assert.equal(await waiting.count(), 0, 'completion must clear the waiting state')
  } finally {
    if (app) await app.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

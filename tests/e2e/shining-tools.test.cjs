const { test } = require('node:test')
const assert = require('node:assert/strict')
const { _electron: electron } = require('playwright-core')
const { buildSync } = require('esbuild')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')

test('all active tool labels and thinking stay static and stop when complete', { timeout: 30000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-shining-'))
  const bundle = buildSync({ stdin: { contents: `
    import React, { useState } from 'react'
    import { createRoot } from 'react-dom/client'
    import { ToolCallCard } from './src/renderer/src/components/tools/ToolCallCard'
    import { ChatMessageItem } from './src/renderer/src/components/ChatMessageItem'
    import { ThinkingBlock } from './src/renderer/src/components/ThinkingBlock'
    function Fixture() {
      const [status, setStatus] = useState('running')
      window.finishTools = () => setStatus('completed')
      const tool = type => ({ id: type, type, label: type === 'terminal' ? 'Терминал' : 'Инструмент', targetName: type === 'file_read' ? 'example.ts' : 'команда', content: 'вывод', status })
      return <div style={{padding: '28px', width: '500px', background: '#0A0A0A', display: 'grid', gap: '14px'}}>
        {['file_read', 'search', 'terminal', 'file_edit', 'folder'].map(type => <div data-case={type} key={type}><ToolCallCard tool={tool(type)} /></div>)}
        <div data-case="group"><ChatMessageItem message={{ id: 'm', role: 'assistant', isStreaming: status === 'running', blocks: [{ type: 'tool', id: 'search', tool: tool('search') }] }} /></div>
        <div data-case="thinking"><ThinkingBlock content="мысли" isStreaming={status === 'running'} /></div>
      </div>
    }
    createRoot(document.getElementById('root')).render(<Fixture />)
  `, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, platform: 'browser', write: false, loader: { '.svg': 'dataurl', '.css': 'empty' } }).outputFiles[0].text
  const assets = path.join(process.cwd(), 'out/renderer/assets')
  const cssName = (await fs.readdir(assets)).find(name => /^index-.*\.css$/.test(name))
  const css = await fs.readFile(path.join(assets, cssName), 'utf8')
  let app
  try {
    app = await electron.launch({ args: ['tests/e2e/bootstrap.cjs'], env: { ...process.env, ZIPPLY_E2E_ROOT: root }, timeout: 30000 })
    const page = await app.firstWindow()
    await page.goto('about:blank')
    await page.setContent('<div id="root"></div>')
    await page.addStyleTag({ content: css })
    await page.addScriptTag({ content: bundle })
    for (const name of ['file_read', 'search', 'terminal', 'file_edit', 'folder', 'group', 'thinking']) {
      const label = page.locator(`[data-case="${name}"] [data-shining-text="true"]`).first()
      await label.waitFor()
      assert.equal(await label.evaluate(element => getComputedStyle(element).animationName), 'none', name)
      assert.equal(await label.evaluate(element => getComputedStyle(element).backgroundImage), 'none', name)
    }
    if (process.env.ZIPPLY_SHINING_TOOLS_SCREENSHOT) {
      await page.evaluate(() => document.querySelectorAll('[data-shining-text="true"]').forEach(element => element.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = 1200 })))
      await page.screenshot({ path: process.env.ZIPPLY_SHINING_TOOLS_SCREENSHOT })
    }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    assert.equal(await page.locator('[data-case="group"] [data-shining-text]').evaluate(element => getComputedStyle(element).animationName), 'none')
    await page.evaluate(() => window.finishTools())
    await page.waitForFunction(() => !document.querySelector('[data-shining-text="true"]'))
  } finally {
    if (app) await app.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

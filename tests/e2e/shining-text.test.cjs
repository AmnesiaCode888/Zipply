const { test } = require('node:test')
const assert = require('node:assert/strict')
const { _electron: electron } = require('playwright-core')
const { buildSync } = require('esbuild')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')

test('active label remains visible and static after its text changes', { timeout: 30000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-shining-'))
  let app
  try {
    const js = buildSync({ stdin: { contents: `
      import React, { useEffect, useState } from 'react'
      import { createRoot } from 'react-dom/client'
      import { ChatMessageItem } from './src/renderer/src/components/ChatMessageItem'
      const block = (id, status, activity) => ({ type: 'tool', id, tool: { id, type: 'search', label: 'Поиск', targetName: 'test', content: 'result', status, activity } })
      function App() {
        const [activity, setActivity] = useState('Ищу информацию')
        useEffect(() => { setTimeout(() => setActivity('Работаю над задачей'), 700) }, [])
        return <ChatMessageItem message={{ id: 'm', role: 'assistant', blocks: [block('a', 'completed'), block('b', 'running', activity)], isStreaming: true }} />
      }
      createRoot(document.getElementById('root')).render(<App />)
    `, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.svg': 'dataurl', '.css': 'empty' } }).outputFiles[0].text
    const html = await fs.readFile('out/renderer/index.html', 'utf8')
    const cssPath = /href="\.\/assets\/(index-[^"]+\.css)"/.exec(html)?.[1]
    assert.ok(cssPath, 'built stylesheet exists')
    const css = await fs.readFile(path.join('out/renderer/assets', cssPath), 'utf8')
    app = await electron.launch({ args: ['tests/e2e/bootstrap.cjs'], env: { ...process.env, ZIPPLY_E2E_ROOT: root } })
    const page = await app.firstWindow()
    await page.goto('data:text/html,<div id="root"></div>')
    await page.addStyleTag({ content: css })
    await page.addScriptTag({ content: js })
    await page.getByText('Ищу информацию').waitFor()
    await page.evaluate(() => { window.firstShiningText = document.querySelector('[data-shining-text]') })
    await page.getByText('Работаю над задачей').waitFor()
    assert.equal(await page.evaluate(() => window.firstShiningText === document.querySelector('[data-shining-text]')), true, 'animation must not restart when the activity changes')
    await page.waitForTimeout(400)
    const png = await page.getByText('Работаю над задачей').screenshot()
    const visiblePixels = await page.evaluate(async data => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0)
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let count = 0
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 60 && pixels[i + 1] > 60 && pixels[i + 2] > 60) count++
      return count
    }, png.toString('base64'))
    assert.ok(visiblePixels > 20, `expected visible text pixels, found ${visiblePixels}`)
    assert.equal(await page.getByText('Работаю над задачей').evaluate(element => getComputedStyle(element).animationName), 'none')
  } finally {
    if (app) await app.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})


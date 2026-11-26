const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright-core')
const { buildSync } = require('esbuild')

const browserPath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(value => value && fs.existsSync(value))

test('workspace and title bar stay within the window when width changes', { timeout: 30000, skip: !browserPath && 'Chromium executable is unavailable' }, async () => {
  const assets = path.join('out', 'renderer', 'assets')
  const cssName = fs.readdirSync(assets).find(name => name.startsWith('index-') && name.endsWith('.css'))
  assert.ok(cssName, 'build the renderer before running UI tests')
  const css = fs.readFileSync(path.join(assets, cssName), 'utf8')
  const script = buildSync({ stdin: { contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import { AppLayout } from './src/renderer/src/components/layout/AppLayout';
const root = createRoot(document.getElementById('root'));
window.renderCase = width => root.render(<AppLayout isSidebarOpen={true} sidebarWidth={width} isResizing={false} onToggleSidebar={() => {}} onCreateChat={() => {}} startResizing={() => {}} resetWidth={() => {}} sidebar={<div>Chats</div>} onNavigate={() => {}} onOpenSettings={() => {}}><div>Chat</div></AppLayout>);
window.renderCase(260);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.svg': 'dataurl' }, platform: 'browser' }).outputFiles[0].text
  const browser = await chromium.launch({ headless: true, executablePath: browserPath })
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
    await page.setContent('<div id="root"></div>')
    await page.addStyleTag({ content: css })
    await page.evaluate(() => { const data = { zipply_workspace_open: 'true' }; Object.defineProperty(window, 'localStorage', { value: { getItem: key => data[key] ?? null, setItem: (key, value) => { data[key] = value } } }) })
    await page.addScriptTag({ content: script })
    const panel = page.getByRole('region', { name: 'Рабочая панель' })
    await page.waitForFunction(() => document.querySelector('[data-workspace-mode="replace"]')?.getBoundingClientRect().width > 0, null, { timeout: 5000 })
    for (const width of [900, 550]) {
      await page.setViewportSize({ width, height: 700 })
      await page.waitForTimeout(250)
      const frame = await page.locator('[data-app-frame]').boundingBox()
      const panelBox = await panel.boundingBox()
      assert.ok(panelBox.x >= frame.x && panelBox.x + panelBox.width <= frame.x + frame.width + 1, `panel fits at ${width}px: ${JSON.stringify({ frame, panelBox })}`)
      assert.ok(panelBox.width >= 320, `panel remains usable at ${width}px`)
      assert.equal(await page.getByTitle('Двойной клик — сброс ширины').count(), 1, `sidebar remains visible at ${width}px`)
    }
    await page.getByRole('button', { name: 'Закрыть рабочую панель' }).click()
    await page.evaluate(() => window.renderCase(460))
    await page.setViewportSize({ width: 400, height: 700 })
    await page.waitForTimeout(350)
    for (const name of ['Toggle Sidebar', 'Открыть рабочую панель', 'Minimize', 'Maximize', 'Close']) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox()
      assert.ok(box && box.x >= 0 && box.x + box.width <= 401 && box.width >= 24, `${name} remains reachable: ${JSON.stringify(box)}`)
    }
  } finally { await browser.close() }
})

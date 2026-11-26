const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { chromium } = require('playwright-core')
const { buildSync } = require('esbuild')

const browserPath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(value => value && fs.existsSync(value))

test('file diff is mounted on demand and released after its closing animation', { timeout: 30000, skip: !browserPath && 'Chromium executable is unavailable' }, async () => {
  const script = buildSync({ stdin: { contents: `
    import React, { useState } from 'react'; import { createRoot } from 'react-dom/client';
    import { ToolCallCard } from './src/renderer/src/components/tools/ToolCallCard';
    function App() { const [expanded, setExpanded] = useState(false); return <ToolCallCard tool={{ id: 'f', type: 'file_edit', label: 'Написал', targetName: 'file.ts', content: '+uniquePreviewMarker', status: 'completed' }} isExpanded={expanded} onToggle={() => setExpanded(value => !value)} /> }
    createRoot(document.getElementById('root')).render(<App />);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', loader: { '.svg': 'dataurl', '.css': 'empty' }, platform: 'browser' }).outputFiles[0].text
  const browser = await chromium.launch({ headless: true, executablePath: browserPath })
  try {
    const page = await browser.newPage()
    await page.setContent('<div id="root"></div>')
    await page.addScriptTag({ content: script })
    const toggle = page.locator('[role="button"][aria-expanded]')
    await toggle.waitFor()
    assert.equal(await page.getByText('uniquePreviewMarker').count(), 0)
    await toggle.click()
    await page.getByText('uniquePreviewMarker').waitFor({ state: 'attached' })
    await toggle.click()
    await page.getByText('uniquePreviewMarker').waitFor({ state: 'detached' })
    await toggle.click()
    await page.getByText('uniquePreviewMarker').waitFor({ state: 'attached' })
  } finally { await browser.close() }
})

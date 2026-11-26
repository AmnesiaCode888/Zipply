const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright-core')
const { buildSync } = require('esbuild')

const browserPath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(value => value && fs.existsSync(value))

test('short window keeps composer, approval, drawer and question usable with a long draft and attachment', { timeout: 30000, skip: !browserPath && 'Chromium executable is unavailable' }, async () => {
  const assets = path.join('out', 'renderer', 'assets')
  const cssName = fs.readdirSync(assets).find(name => name.startsWith('index-') && name.endsWith('.css'))
  assert.ok(cssName, 'build the renderer before running the UI tests')
  const css = fs.readFileSync(path.join(assets, cssName), 'utf8')
  const script = buildSync({
    stdin: {
      contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import { ChatCanvas } from './src/renderer/src/components/chat/ChatCanvas';
const session = { id: 's', folderPath: 'C:/demo' };
const drafts = new Map([['s', { value: Array(20).fill('This is a long draft').join('\\n'), files: [{ id: 'f', file: new File(['hello'], 'example.txt', { type: 'text/plain' }), preview: '' }], planMode: false }]]);
const root = createRoot(document.getElementById('root'));
window.renderCase = kind => root.render(<ChatCanvas activeSession={session} drafts={drafts} messages={[]} onSendMessage={() => {}} approval={kind === 'approval' ? { requestId: 'r', approvalId: 'a', command: 'dir' } : null} question={kind === 'question' ? { requestId: 'r', questionId: 'q', question: 'Choose one', options: ['First', 'Second'] } : null} />);
window.renderCase('approval');`,
      resolveDir: process.cwd(), loader: 'tsx'
    },
    bundle: true, write: false, format: 'iife', loader: { '.svg': 'dataurl' }, platform: 'browser'
  }).outputFiles[0].text
  const browser = await chromium.launch({ headless: true, executablePath: browserPath })
  try {
    const page = await browser.newPage({ viewport: { width: 300, height: 300 } })
    await page.setContent('<style>#root { position:absolute; top:40px; bottom:0; width:100% }</style><div id="root"></div>')
    await page.addStyleTag({ content: css })
    await page.addStyleTag({ content: '#root { height: calc(100% - 40px) }' })
    await page.addScriptTag({ content: script })
    const canvas = page.locator('[data-chat-canvas]')
    const send = page.getByRole('button', { name: 'Отправить' })
    const assertInCanvas = async locator => {
      const box = await locator.boundingBox()
      const container = await canvas.boundingBox()
      assert.ok(box && container && box.y >= container.y && box.y + box.height <= container.y + container.height, 'control fits within the chat canvas')
    }
    await assertInCanvas(send)
    await page.getByRole('button', { name: 'Разрешить' }).click()
    const textarea = page.getByPlaceholder('Напиши что-нибудь…')
    await textarea.click()
    await textarea.press('End')
    await textarea.type(' changed')
    assert.match(await textarea.inputValue(), /changed/)
    await assertInCanvas(send)
    await page.getByRole('button', { name: 'Действия' }).click()
    await page.getByRole('button', { name: 'Прикрепить файлы' }).click()
    await page.evaluate(() => window.renderCase('question'))
    await assertInCanvas(send)
    await page.getByRole('button', { name: 'First' }).click()
  } finally {
    await browser.close()
  }
})


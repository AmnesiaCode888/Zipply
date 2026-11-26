const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { chromium } = require('playwright-core')
const { buildSync } = require('esbuild')

const browserPath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(value => value && fs.existsSync(value))
const script = buildSync({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {useChatSessions} from './src/renderer/src/hooks/useChatSessions'; function Probe(){window.hook=useChatSessions();window.renders++;return <div>{window.hook.sessions.length}</div>}; createRoot(document.getElementById('root')).render(<React.StrictMode><Probe /></React.StrictMode>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic' }).outputFiles[0].text

test('workspace checks settle without repeatedly writing unchanged chat history', { timeout: 30000, skip: !browserPath && 'Chromium executable is unavailable' }, async () => {
  const browser = await chromium.launch({ headless: true, executablePath: browserPath })
  try {
    const page = await browser.newPage()
    await page.setContent('<div id="root"></div>')
    await page.evaluate(() => {
      const sessions = Array.from({ length: 20 }, (_, i) => ({ id: `chat-${i}`, title: `Chat ${i}`, createdAt: 1, updatedAt: 1, folderPath: `C:/workspaces/chat-${i}`, messages: [] }))
      const storage = { zipply_chat_sessions_v1: JSON.stringify(sessions), zipply_active_chat_id_v1: 'chat-0' }
      window.calls = 0; window.writes = 0; window.backups = 0; window.renders = 0
      window.api = { storage: { get: key => ({ exists: Object.hasOwn(storage, key), value: storage[key] }), set: (key, value) => { if (key === 'zipply_chat_sessions_v1') window.writes++; storage[key] = value; return { ok: true } } }, workspace: { create: (id, title, folderPath) => { window.calls++; return new Promise(resolve => setTimeout(() => resolve({ success: true, folderPath }), 20)) }, saveSession: () => { window.backups++; return Promise.resolve({ success: true }) } } }
    })
    await page.addScriptTag({ content: script })
    await page.waitForTimeout(250)
    const settled = await page.evaluate(() => ({ calls: window.calls, writes: window.writes, backups: window.backups }))
    assert.equal(settled.calls, 20, 'each default workspace is checked once, including under StrictMode')
    assert.equal(settled.writes, 0, 'unchanged folder paths do not rewrite the history')
    assert.equal(settled.backups, 20, 'startup backup migration does not repeat under StrictMode')
    await page.evaluate(() => window.hook.renameChat('chat-0', 'Renamed'))
    await page.waitForTimeout(100)
    assert.equal(await page.evaluate(() => window.calls), 20, 'updating chat metadata does not recheck every workspace')
  } finally { await browser.close() }
})

test('an older workspace check cannot overwrite a changed folder', { timeout: 30000, skip: !browserPath && 'Chromium executable is unavailable' }, async () => {
  const browser = await chromium.launch({ headless: true, executablePath: browserPath })
  try {
    const page = await browser.newPage()
    await page.setContent('<div id="root"></div>')
    await page.evaluate(() => {
      const session = { id: 'chat-1', title: 'Chat', createdAt: 1, updatedAt: 1, folderPath: 'C:/workspaces/chat-1', messages: [] }
      const storage = { zipply_chat_sessions_v1: JSON.stringify([session]), zipply_active_chat_id_v1: session.id }
      window.calls = 0; window.renders = 0
      window.api = { storage: { get: key => ({ exists: Object.hasOwn(storage, key), value: storage[key] }), set: (key, value) => { storage[key] = value; return { ok: true } } }, workspace: { create: (id, title, folderPath) => { window.calls++; return new Promise(resolve => setTimeout(() => resolve({ success: true, folderPath }), 120)) }, saveSession: () => Promise.resolve({ success: true }) } }
    })
    await page.addScriptTag({ content: script })
    await page.waitForFunction(() => window.calls > 0)
    await page.evaluate(() => window.hook.changeChatFolder('chat-1', 'C:/chosen'))
    await page.waitForTimeout(250)
    assert.equal(await page.evaluate(() => window.hook.sessions[0].folderPath), 'C:/chosen')
    const id = await page.evaluate(() => window.hook.createChat('New chat', 'C:/original'))
    await page.waitForFunction(id => window.hook.sessions.some(session => session.id === id), id)
    await page.evaluate(id => window.hook.changeChatFolder(id, 'C:/chosen-new'), id)
    await page.waitForTimeout(250)
    assert.equal(await page.evaluate(id => window.hook.sessions.find(session => session.id === id).folderPath, id), 'C:/chosen-new')
  } finally { await browser.close() }
})

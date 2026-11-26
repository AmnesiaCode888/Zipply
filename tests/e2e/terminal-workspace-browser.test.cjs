const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright-core')
const { buildSync } = require('esbuild')

const browserPath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(value => value && fs.existsSync(value))

test('a chat card opens its own background terminal and stopping it leaves the other task active', { timeout: 30000, skip: !browserPath }, async () => {
  const bundle = buildSync({
    stdin: { contents: `
      import React from 'react'
      import { createRoot } from 'react-dom/client'
      import { AppLayout } from './src/renderer/src/components/layout/AppLayout'
      import { TerminalTool } from './src/renderer/src/components/tools/TerminalTool'
      const chat = { id: 'chat', folderPath: 'C:/workspace' }
      createRoot(document.getElementById('root')).render(
        <AppLayout activeSession={chat} isSidebarOpen={false} sidebarWidth={240} isResizing={false} onToggleSidebar={() => {}} onCreateChat={() => {}} startResizing={() => {}} resetWidth={() => {}} sidebar={null} onNavigate={() => {}} onOpenSettings={() => {}}>
          <TerminalTool command="start first" terminalSessionId="first" background />
        </AppLayout>
      )`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, platform: 'browser', jsx: 'automatic', write: false, loader: { '.svg': 'dataurl' }
  }).outputFiles[0].text
  const assets = path.join('out', 'renderer', 'assets')
  const css = fs.readdirSync(assets).find(name => name.startsWith('index-') && name.endsWith('.css'))
  const browser = await chromium.launch({ executablePath: browserPath, headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
    await page.setContent('<div id="root"></div>')
    await page.addStyleTag({ path: path.join(assets, css) })
    await page.evaluate(() => {
      const store = new Map()
      Object.defineProperty(window, 'localStorage', { value: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) } })
      const listeners = new Set()
      const sessions = ['check', 'first', 'second'].map((id, index) => ({
        id, origin: 'ai', background: index > 0, title: `${id} task`, command: `start ${id}`,
        status: index > 0 ? 'running' : 'exited', exitCode: index > 0 ? null : 0, startedAt: index
      }))
      const emit = event => listeners.forEach(listener => listener({ sessionId: 'chat', workspace: 'C:\\workspace', event }))
      window.promote = () => emit({ type: 'session_state', terminalId: 'check', status: 'running', exitCode: null, signal: null, background: true })
      window.api = { platform: 'win32', terminal: {
        list: async () => sessions,
        attach: async (_, id) => {
          const buffered = `${id} output\r\n`
          emit({ type: 'session_output', terminalId: id, chunk: buffered, cursor: buffered.length })
          const live = `${id} live\r\n`
          emit({ type: 'session_output', terminalId: id, chunk: live, cursor: buffered.length + live.length })
          return { rawBuffer: buffered, rawCursor: buffered.length }
        },
        signal: async (_, id) => {
          window.stopped = id
          emit({ type: 'session_state', terminalId: id, status: 'stopped', exitCode: null, signal: 'SIGKILL' })
        },
        onEvent: listener => { listeners.add(listener); return () => listeners.delete(listener) },
        resize: () => {}
      } }
    })
    await page.addScriptTag({ content: bundle })
    await page.getByRole('button', { name: 'В терминале' }).click()
    const panel = page.getByRole('region', { name: 'Рабочая панель' })
    const fixed = panel.getByRole('tab', { name: 'Zipply Терминал', selected: true })
    await fixed.waitFor()
    assert.equal(await fixed.evaluate(tab => getComputedStyle(tab.parentElement).position), 'sticky')
    assert.equal(await fixed.locator('.bg-accent').count(), 0)
    const selection = panel.getByRole('combobox', { name: 'Выбрать фоновую задачу' })
    await selection.waitFor()
    assert.equal(await selection.inputValue(), 'first')
    const output = panel.locator('.xterm-rows')
    await output.getByText('first live', { exact: true }).waitFor()
    assert.equal(await output.getByText('first output', { exact: true }).count(), 1)
    if (process.env.ZIPPLY_TERMINAL_SCREENSHOT) {
      await page.waitForFunction(() => {
        const terminal = document.querySelector('#workspace-panel')
        return terminal && terminal.parentElement.getBoundingClientRect().width >= terminal.getBoundingClientRect().width - 1
      })
      await page.screenshot({ path: process.env.ZIPPLY_TERMINAL_SCREENSHOT })
    }
    await panel.getByRole('button', { name: 'Остановить' }).click()
    assert.equal(await page.evaluate(() => window.stopped), 'first')
    assert.match(await selection.locator('option:checked').innerText(), /Остановлена/)
    await selection.selectOption('second')
    await output.getByText('second live', { exact: true }).waitFor()
    assert.equal(await output.getByText('first output', { exact: true }).count(), 0)
    await panel.getByRole('button', { name: 'Остановить' }).waitFor()
    await panel.getByRole('button', { name: 'Добавить вкладку' }).click()
    await panel.getByRole('tab', { name: 'Zipply Терминал' }).click()
    assert.equal(await selection.inputValue(), 'second')
    await panel.getByRole('button', { name: 'Команды', exact: true }).click()
    assert.equal(await panel.getByRole('combobox', { name: 'Выбрать команду' }).inputValue(), 'check')
    await page.evaluate(() => window.promote())
    assert.equal(await selection.inputValue(), 'check')
  } finally { await browser.close() }
})

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { _electron: electron } = require('playwright-core')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')

test('a real terminal command displays an animated waiting status in the chat', { timeout: 45000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-terminal-live-'))
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    if (!body.stream) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'Тест' } }] })); return }
    const last = body.messages.at(-1)
    const delta = last.role === 'tool' ? { content: 'Готово.' } : { tool_calls: [{ index: 0, id: 'slow-command', type: 'function', function: { name: 'terminal', arguments: JSON.stringify({ command: 'node -e "setTimeout(()=>{},8000)"' }) } }] }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let app
  try {
    app = await electron.launch({ args: ['tests/e2e/bootstrap.cjs'], env: { ...process.env, ZIPPLY_E2E_ROOT: root }, timeout: 30000 })
    const page = await app.firstWindow()
    await page.getByPlaceholder('Напиши что-нибудь…').waitFor()
    await page.evaluate(port => {
      window.api.secrets.set('apiKey', 'test-key')
      localStorage.setItem('zipply_app_settings_v1', JSON.stringify({ baseUrl: `http://127.0.0.1:${port}/v1`, openRouterModel: 'test', accessMode: 'unrestricted' }))
      window.observedEvents = []
      window.api.agent.onEvent(event => window.observedEvents.push(event))
    }, server.address().port)
    await page.getByPlaceholder('Напиши что-нибудь…').fill('Запусти долгую команду')
    await page.getByRole('button', { name: 'Отправить' }).click()
    await page.waitForFunction(() => window.observedEvents.some(event => event.type === 'tool_progress' && event.executionStarted), null, { timeout: 12000 })
    const running = page.getByRole('button', { name: 'Выполняю команду' }).locator('[data-shining-text="true"]')
    await running.waitFor({ timeout: 2000 })
    assert.notEqual(await running.evaluate(element => getComputedStyle(element).animationName), 'none')
    const runningPosition = await running.evaluate(element => getComputedStyle(element).backgroundPosition)
    await page.waitForTimeout(350)
    assert.notEqual(await running.evaluate(element => getComputedStyle(element).backgroundPosition), runningPosition)
    if (process.env.ZIPPLY_SHINING_SCREENSHOT) await page.screenshot({ path: process.env.ZIPPLY_SHINING_SCREENSHOT })
    const waiting = page.getByRole('button', { name: 'Ожидаю ответ от терминала' })
    await waiting.waitFor({ timeout: 6000 })
    const style = await waiting.locator('[data-terminal-waiting]').evaluate(element => ({ animation: getComputedStyle(element).animationName, background: getComputedStyle(element).backgroundImage }))
    assert.notEqual(style.animation, 'none')
    assert.match(style.background, /gradient/)
    const position = await waiting.locator('[data-terminal-waiting]').evaluate(element => getComputedStyle(element).backgroundPosition)
    await page.waitForTimeout(350)
    assert.notEqual(await waiting.locator('[data-terminal-waiting]').evaluate(element => getComputedStyle(element).backgroundPosition), position, 'the shine moves over time')
    await page.getByText('Готово.', { exact: true }).waitFor({ timeout: 12000 })
    assert.equal(await waiting.count(), 0)
  } finally {
    if (app) await app.close()
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('a background command keeps its waiting status while the agent waits between polls', { timeout: 45000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-process-live-'))
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    if (!body.stream) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'Тест' } }] })); return }
    const last = body.messages.at(-1)
    if (last.role === 'tool') await new Promise(resolve => setTimeout(resolve, 7000))
    const delta = last.role === 'tool' ? { content: 'Готово.' } : { tool_calls: [{ index: 0, id: 'background-command', type: 'function', function: { name: 'process_start', arguments: JSON.stringify({ command: 'node -e "setTimeout(()=>{},12000)"' }) } }] }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let app
  try {
    app = await electron.launch({ args: ['tests/e2e/bootstrap.cjs'], env: { ...process.env, ZIPPLY_E2E_ROOT: root }, timeout: 30000 })
    const page = await app.firstWindow()
    await page.getByPlaceholder('Напиши что-нибудь…').waitFor()
    await page.evaluate(port => {
      window.api.secrets.set('apiKey', 'test-key')
      localStorage.setItem('zipply_app_settings_v1', JSON.stringify({ baseUrl: `http://127.0.0.1:${port}/v1`, openRouterModel: 'test', accessMode: 'unrestricted' }))
      window.observedEvents = []
      window.api.agent.onEvent(event => window.observedEvents.push(event))
    }, server.address().port)
    await page.getByPlaceholder('Напиши что-нибудь…').fill('Запусти долгий процесс')
    await page.getByRole('button', { name: 'Отправить' }).click()
    await page.waitForFunction(() => window.observedEvents.some(event => event.type === 'tool_result' && event.data?.status === 'running'), null, { timeout: 12000 })
    const waiting = page.getByRole('button', { name: 'Ожидаю ответ от терминала' })
    await waiting.waitFor({ timeout: 5000 })
    assert.notEqual(await waiting.locator('[data-terminal-waiting]').evaluate(element => getComputedStyle(element).animationName), 'none')
    await page.getByText('Готово.', { exact: true }).waitFor({ timeout: 10000 })
    assert.equal(await waiting.count(), 0)
  } finally {
    if (app) await app.close()
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  }
})

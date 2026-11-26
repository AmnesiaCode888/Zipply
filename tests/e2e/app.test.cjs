const { test } = require('node:test')
const assert = require('node:assert/strict')
const { _electron: electron } = require('playwright-core')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

function startProvider() {
  const requests = []
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    requests.push(body)
    if (!body.stream) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'Тестовый чат' } }] })); return }
    const latest = body.messages[body.messages.length - 1]
    const user = [...body.messages].reverse().find(message => message.role === 'user')
    const prompt = typeof user?.content === 'string' ? user.content : (user?.content || []).filter(part => part.type === 'text').map(part => part.text).join(' ')
    let delta
    if (prompt.includes('Пропуск уточнения') && latest.role !== 'tool') {
      delta = { tool_calls: [{ index: 0, id: 'call-skip', type: 'function', function: { name: 'ask_user', arguments: JSON.stringify({ question: 'Что выбрать?', options: ['Один', 'Два'] }) } }] }
    } else if (prompt.includes('Группа уточнений') && latest.role !== 'tool') {
      delta = { tool_calls: [{ index: 0, id: 'call-group', type: 'function', function: { name: 'ask_user', arguments: JSON.stringify({ questions: [{ question: 'Какой цвет?', options: ['Белый', 'Чёрный', 'Синий', 'Красный', 'Зелёный'] }, { question: 'Какой размер?' }, { question: 'Какой материал?', options: ['Хлопок', 'Лён'] }, { question: 'Какой фасон?' }] }) } }] }
    } else if (prompt.includes('Два уточнения') && body.messages.filter(message => message.role === 'tool' && message.name === 'ask_user').length < 2) {
      await new Promise(resolve => setTimeout(resolve, 700))
      const count = body.messages.filter(message => message.role === 'tool' && message.name === 'ask_user').length
      delta = { tool_calls: [{ index: 0, id: `call-question-${count}`, type: 'function', function: { name: 'ask_user', arguments: JSON.stringify({ question: count ? 'Второй вопрос?' : 'Первый вопрос?', options: ['Первый вариант', 'Второй вариант', 'Третий вариант', 'Четвёртый вариант'] }) } }] }
    } else if (latest.role !== 'tool' && prompt.includes('Запусти процесс')) {
      delta = { tool_calls: [{ index: 0, id: 'call-process-start', type: 'function', function: { name: 'process_start', arguments: JSON.stringify({ command: 'node -e "console.log(\'ready\');setInterval(()=>{},1000)"' }) } }] }
    } else if (latest.role !== 'tool' && (prompt.includes('Проверь процесс') || prompt.includes('Останови процесс'))) {
      const started = body.messages.find(message => message.role === 'tool' && message.name === 'process_start')
      const processId = /Процесс ([a-f0-9-]{36})/.exec(started?.content || '')?.[1]
      const name = prompt.includes('Проверь процесс') ? 'process_poll' : 'process_stop'
      delta = { tool_calls: [{ index: 0, id: `call-${name}`, type: 'function', function: { name, arguments: JSON.stringify({ process_id: processId, wait_ms: 5000 }) } }] }
    } else if (latest.role !== 'tool' && prompt.includes('Проверь команду')) {
      const command = process.platform === 'win32' ? "Set-Content -LiteralPath 'denied.txt' -Value 'bad'" : "printf bad > denied.txt"
      delta = { tool_calls: [{ index: 0, id: 'call-command', type: 'function', function: { name: 'terminal', arguments: JSON.stringify({ command }) } }] }
    } else if (latest.role !== 'tool' && prompt.includes('Примени пакет')) {
      const operations = [{ path: 'a.txt', action: 'update', edits: [{ target: 'one', replacement: 'ONE' }] }, { path: 'b.txt', action: 'update', edits: [{ target: 'two', replacement: 'TWO' }] }]
      delta = { tool_calls: [{ index: 0, id: 'call-patch', type: 'function', function: { name: 'apply_patch', arguments: JSON.stringify({ operations }) } }] }
    } else if (latest.role !== 'tool' && prompt.includes('Создай файл')) {
      delta = { tool_calls: [{ index: 0, id: 'call-write', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'created.txt', content: 'данные из теста' }) } }] }
    } else delta = { content: latest.role === 'tool' ? 'Действие обработано.' : 'Изображение получено.' }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`)
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}/v1` })))
}

test('agent questions preserve the composer focus and draft while allowing answers', { timeout: 60000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-question-e2e-')); const provider = await startProvider(); let app
  try {
    let page; ({ app, page } = await launch(root))
    await page.getByRole('button', { name: 'Профиль' }).click(); await page.getByRole('button', { name: 'Настройки' }).click()
    await page.getByRole('button', { name: 'Модель и API' }).click()
    await page.locator('#model-api-key').fill('local-test-key')
    await page.locator('#model-url').fill(provider.url)
    await page.getByRole('button', { name: 'Назад к чату', exact: true }).click()
    await page.waitForTimeout(500)
    await send(page, 'Два уточнения')
    const composer = page.getByPlaceholder('Напиши что-нибудь…')
    await composer.fill('Черновик')
    const first = page.getByRole('dialog', { name: 'Первый вопрос?' })
    await first.waitFor({ timeout: 15000 })
    const layout = await first.evaluate(dialog => {
      const buttons = [...dialog.querySelectorAll('button')].filter(button => button.textContent.includes('вариант'))
      const area = dialog.querySelector('.overflow-y-auto').getBoundingClientRect()
      return { count: buttons.length, positions: buttons.map(button => { const box = button.getBoundingClientRect(); return { x: box.x, top: box.top, bottom: box.bottom } }), top: area.top, bottom: area.bottom }
    })
    assert.equal(layout.count, 4)
    assert.ok(layout.positions[0].x < layout.positions[1].x)
    assert.ok(layout.positions.every(position => position.top >= layout.top && position.bottom <= layout.bottom))
    assert.equal(await composer.evaluate(el => el === document.activeElement), true)
    await page.keyboard.type(' продолжение')
    assert.equal(await composer.inputValue(), 'Черновик продолжение')
    await first.getByLabel('Свой ответ').fill('Мой ответ')
    await first.getByRole('button', { name: 'Ответить' }).click()
    const second = page.getByRole('dialog', { name: 'Второй вопрос?' })
    await second.waitFor({ timeout: 15000 })
    assert.equal(await second.getByLabel('Свой ответ').inputValue(), '')
    assert.equal(await composer.inputValue(), 'Черновик продолжение')
    if (process.env.ZIPPLY_QUESTION_SCREENSHOT) await page.screenshot({ path: process.env.ZIPPLY_QUESTION_SCREENSHOT })
    await second.getByRole('button', { name: 'Второй вариант' }).click()
    await page.getByText('Действие обработано.').waitFor({ timeout: 15000 })
    assert.equal(await composer.inputValue(), 'Черновик продолжение')
    assert.ok(provider.requests.some(request => request.messages.some(message => message.role === 'tool' && String(message.content).includes('Мой ответ'))))
  } finally { if (app) await app.close(); await new Promise(resolve => provider.server.close(resolve)); await fs.rm(root, { recursive: true, force: true }) }
})

test('skipping a question is reported to the agent as a skip rather than an error', { timeout: 60000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-skip-e2e-')); const provider = await startProvider(); let app
  try {
    let page; ({ app, page } = await launch(root))
    await page.getByRole('button', { name: 'Профиль' }).click(); await page.getByRole('button', { name: 'Настройки' }).click()
    await page.getByRole('button', { name: 'Модель и API' }).click()
    await page.locator('#model-api-key').fill('local-test-key')
    await page.locator('#model-url').fill(provider.url)
    await page.getByRole('button', { name: 'Назад к чату', exact: true }).click()
    await page.waitForTimeout(500)
    await send(page, 'Пропуск уточнения')
    const dialog = page.getByRole('dialog', { name: 'Что выбрать?' }); await dialog.waitFor({ timeout: 15000 })
    await dialog.getByRole('button', { name: 'Пропустить' }).click()
    await page.getByText('Действие обработано.').waitFor({ timeout: 15000 })
    assert.ok(provider.requests.some(request => request.messages.some(message => message.role === 'tool' && /пользователь пропустил уточнение/i.test(String(message.content)))))
    assert.equal(await page.getByText('Уточнение — ошибка').count(), 0)
  } finally { if (app) await app.close(); await new Promise(resolve => provider.server.close(resolve)); await fs.rm(root, { recursive: true, force: true }) }
})

test('grouped questions collect selections and custom answers without losing the composer draft', { timeout: 60000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-group-e2e-')); const provider = await startProvider(); let app
  try {
    let page; ({ app, page } = await launch(root))
    await page.getByRole('button', { name: 'Профиль' }).click(); await page.getByRole('button', { name: 'Настройки' }).click()
    await page.getByRole('button', { name: 'Модель и API' }).click()
    await page.locator('#model-api-key').fill('local-test-key')
    await page.locator('#model-url').fill(provider.url)
    await page.getByRole('button', { name: 'Назад к чату', exact: true }).click()
    await page.waitForTimeout(500)
    await send(page, 'Группа уточнений')
    const composer = page.getByPlaceholder('Напиши что-нибудь…'); await composer.fill('Черновик')
    const dialog = page.getByRole('dialog', { name: 'Нужно уточнение' }); await dialog.waitFor({ timeout: 15000 })
    const next = dialog.getByRole('button', { name: 'Далее' }); assert.equal(await next.isDisabled(), true)
    assert.equal(await dialog.getByRole('button', { name: 'Свой ответ' }).count(), 0)
    assert.equal(await dialog.getByText('Какой размер?', { exact: true }).count(), 0)
    await dialog.getByRole('button', { name: 'Белый' }).click(); assert.equal(await next.isEnabled(), true)
    await next.click()
    await dialog.getByLabel('Свой ответ: Какой размер?').fill('Большой')
    await dialog.getByRole('button', { name: 'Назад' }).click()
    assert.equal(await dialog.getByRole('button', { name: 'Белый' }).getAttribute('aria-pressed'), 'true')
    await next.click()
    assert.equal(await dialog.getByLabel('Свой ответ: Какой размер?').inputValue(), 'Большой')
    await next.click()
    await dialog.getByRole('button', { name: 'Хлопок' }).click()
    await next.click()
    await dialog.getByLabel('Свой ответ: Какой фасон?').fill('Свободный')
    const submit = dialog.getByRole('button', { name: 'Ответить' })
    if (process.env.ZIPPLY_GROUP_SCREENSHOT) await page.screenshot({ path: process.env.ZIPPLY_GROUP_SCREENSHOT })
    assert.equal(await submit.isEnabled(), true); await submit.click()
    await page.getByText('Действие обработано.').waitFor({ timeout: 15000 })
    assert.equal(await composer.inputValue(), 'Черновик')
    assert.ok(provider.requests.some(request => request.messages.some(message => message.role === 'tool' && /Какой цвет\?[\s\S]*Белый[\s\S]*Какой размер\?[\s\S]*Большой[\s\S]*Какой материал\?[\s\S]*Хлопок[\s\S]*Какой фасон\?[\s\S]*Свободный/.test(String(message.content)))))
  } finally { if (app) await app.close(); await new Promise(resolve => provider.server.close(resolve)); await fs.rm(root, { recursive: true, force: true }) }
})

async function launch(root) {
  const app = await electron.launch({ args: ['tests/e2e/bootstrap.cjs'], env: { ...process.env, ZIPPLY_E2E_ROOT: root }, timeout: 30000 })
  const page = await app.firstWindow()
  await page.getByPlaceholder('Напиши что-нибудь…').waitFor()
  return { app, page }
}
async function send(page, text) {
  await page.getByPlaceholder('Напиши что-нибудь…').fill(text)
  await page.getByRole('button', { name: 'Отправить' }).click()
}

test('full access confirmation leaves the composer available', { timeout: 30000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-access-panel-')); let app
  try {
    let page; ({ app, page } = await launch(root))
    const composer = page.getByPlaceholder('Напиши что-нибудь…')
    await composer.fill('Черновик')
    await page.getByRole('button', { name: /Доступ агента:/ }).click()
    await page.getByRole('menuitemradio', { name: /Полный доступ/ }).click()
    const panel = page.getByRole('dialog', { name: 'Включить полный доступ?' })
    await panel.waitFor()
    assert.notEqual(await panel.getAttribute('aria-modal'), 'true')
    assert.equal(await composer.evaluate(element => element === document.activeElement), true)
    await page.keyboard.type(' продолжение')
    assert.equal(await composer.inputValue(), 'Черновик продолжение')
    await panel.getByRole('button', { name: 'Отмена' }).click()
    assert.equal(await composer.inputValue(), 'Черновик продолжение')
  } finally { if (app) await app.close(); await fs.rm(root, { recursive: true, force: true }) }
})

test('chat list supports keyboard selection and protects against accidental deletion', { timeout: 30000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-list-')); let app
  try {
    let page; ({ app, page } = await launch(root))
    await page.keyboard.press('Control+n')
    const chats = page.getByRole('button', { name: /Новый чат/ })
    const old = chats.last()
    await old.focus(); await page.keyboard.press('Enter')
    assert.equal(await old.getAttribute('aria-current'), 'page')
    await old.getByRole('button', { name: 'Удалить' }).click()
    const dialog = page.getByRole('dialog', { name: 'Удалить чат?' })
    await dialog.waitFor({ timeout: 2000 })
    await dialog.getByRole('button', { name: 'Отмена' }).click()
    assert.equal(await chats.count(), 2)
  } finally { if (app) await app.close(); await fs.rm(root, { recursive: true, force: true }) }
})

test('composer keeps drafts across chats and settings', { timeout: 30000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-draft-')); let app
  try {
    let page; ({ app, page } = await launch(root))
    const input = page.getByPlaceholder('Напиши что-нибудь…')
    await input.fill('Черновик первого чата')
    await page.getByRole('button', { name: 'Действия' }).click()
    await page.getByRole('button', { name: 'Сделай план' }).click()
    await page.locator('input[type="file"][accept*="image"]').setInputFiles({ name: 'draft.png', mimeType: 'image/png', buffer: png })
    await page.locator('img[alt="draft.png"]').waitFor()
    await page.getByRole('button', { name: 'Профиль' }).click(); await page.getByRole('button', { name: 'Настройки' }).click()
    await page.getByRole('button', { name: 'Назад к чату', exact: true }).click()
    assert.equal(await input.inputValue(), 'Черновик первого чата')
    await page.locator('img[alt="draft.png"]').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Выключить режим плана' }).filter({hasText: /^План$/}).count(), 1)
    await page.keyboard.press('Control+n')
    await input.fill('Другой черновик')
    await page.getByText('Новый чат', { exact: true }).last().click()
    assert.equal(await input.inputValue(), 'Черновик первого чата')
  } finally { if (app) await app.close(); await fs.rm(root, { recursive: true, force: true }) }
})

test('composer handles mixed clipboard, IME, and keyboard menus', { timeout: 30000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-input-')); let app
  try {
    let page; ({ app, page } = await launch(root))
    const input = page.getByPlaceholder('Напиши что-нибудь…')
    await input.fill('AB')
    await input.evaluate(element => {
      element.setSelectionRange(1, 1)
      const data = new DataTransfer()
      data.setData('text/plain', 'текст')
      data.items.add(new File([new Uint8Array([1, 2, 3])], 'pasted.png', { type: 'image/png' }))
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    })
    assert.equal(await input.inputValue(), 'AтекстB')
    await page.locator('img[alt="pasted.png"]').waitFor()
    await input.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })))
    assert.equal(await input.inputValue(), 'AтекстB')
    const reset = page.locator('button[aria-label="Вернуть режим Pro"]')
    await reset.evaluate(element => element.focus())
    assert.equal(await reset.evaluate(element => element === document.activeElement), false)
    const mode = page.getByRole('button', { name: 'Режим: pro' })
    await mode.click()
    await input.focus()
    await page.keyboard.press('ArrowRight')
    assert.equal(await mode.getAttribute('aria-label'), 'Режим: pro')
    await page.keyboard.press('Escape')
    const actions = page.getByRole('button', { name: 'Действия' })
    await actions.click(); await actions.click(); await actions.click()
    await page.waitForTimeout(300)
    assert.equal(await actions.getAttribute('aria-expanded'), 'true')
    await page.getByRole('button', { name: 'Сделай план' }).waitFor()
  } finally { if (app) await app.close(); await fs.rm(root, { recursive: true, force: true }) }
})

test('plan and access cannot change while an attachment is being saved', { timeout: 30000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-upload-')); let app
  try {
    let page; ({ app, page } = await launch(root))
    await page.getByRole('button', { name: 'Действия' }).click()
    await page.getByRole('button', { name: 'Сделай план' }).click()
    await page.locator('input[type="file"][accept*="image"]').setInputFiles({ name: 'slow.png', mimeType: 'image/png', buffer: png })
    await page.locator('img[alt="slow.png"]').waitFor()
    await page.evaluate(() => {
      const original = File.prototype.arrayBuffer
      let release
      const gate = new Promise(resolve => { release = resolve })
      window.__releaseUpload = release
      File.prototype.arrayBuffer = async function () { await gate; return original.call(this) }
    })
    await page.getByRole('button', { name: 'Отправить' }).click()
    assert.equal(await page.getByRole('button', { name: 'Доступ агента: Только чтение (режим плана)' }).isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: 'Выключить режим плана' }).filter({hasText: /^План$/}).isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: 'Действия' }).isDisabled(), true)
    await page.evaluate(() => window.__releaseUpload())
    await page.getByText('API-ключ OpenRouter не указан.', { exact: false }).waitFor()
  } finally { if (app) await app.close(); await fs.rm(root, { recursive: true, force: true }) }
})

test('plan mode can be enabled and removed from the composer', { timeout: 60000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-plan-'))
  let app
  try {
    let page
    ;({ app, page } = await launch(root))
    assert.equal(await page.getByRole('button', { name: /Доступ агента:/ }).locator('.activity-label-revealing').count(), 0)
    const hiddenOption = page.locator('[role="menuitemradio"]').filter({ hasText: 'С подтверждением' })
    await hiddenOption.evaluate(element => element.focus())
    assert.equal(await hiddenOption.evaluate(element => element === document.activeElement), false, 'closed access menu must not accept keyboard focus')
    await page.getByRole('button', { name: 'Действия' }).click()
    await page.getByRole('button', { name: 'Сделай план' }).click()
    const remove = page.getByRole('button', { name: 'Выключить режим плана' }).filter({ hasText: /^План$/ })
    await remove.waitFor({ timeout: 2000 })
    const access = page.getByRole('button', { name: 'Доступ агента: Только чтение (режим плана)' })
    await access.waitFor({ timeout: 2000 })
    await page.getByPlaceholder('Напиши что-нибудь…').fill('Моя задача')
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'Действия' }).click()
    const disableInMenu = page.getByRole('button', { name: 'Выключить режим плана', exact: true }).filter({ hasText: 'Выключить режим плана' })
    await disableInMenu.waitFor({ timeout: 2000 })
    await disableInMenu.click()
    assert.equal(await remove.count(), 0)
    assert.equal(await page.getByPlaceholder('Напиши что-нибудь…').inputValue(), 'Моя задача')
    await page.waitForTimeout(100)
    assert.equal(await page.getByPlaceholder('Напиши что-нибудь…').evaluate(element => element === document.activeElement), true)
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'Действия' }).click()
    await page.getByRole('button', { name: 'Сделай план' }).click()
    await remove.waitFor({ timeout: 2000 })
    await page.waitForTimeout(300)
    assert.equal(await access.locator('svg').count(), 0)
    await access.focus()
    await page.keyboard.press('Enter')
    assert.equal(await access.getAttribute('aria-expanded'), 'true')
    await page.keyboard.press('Escape')
    assert.equal(await access.getAttribute('aria-expanded'), 'false')
    await access.click()
    await page.getByRole('menuitemradio', { name: /С подтверждением/ }).click()
    const planDialog = page.getByRole('dialog', { name: 'Выключить режим плана?' })
    await planDialog.waitFor({ timeout: 2000 })
    assert.equal(await page.getByPlaceholder('Напиши что-нибудь…').evaluate(element => element === document.activeElement), true)
    assert.notEqual(await planDialog.getAttribute('aria-modal'), 'true')
    await planDialog.getByRole('button', { name: 'Отмена' }).click()
    assert.equal(await remove.count(), 1)
    await access.click()
    await page.getByRole('menuitemradio', { name: /С подтверждением/ }).click()
    await planDialog.getByRole('button', { name: 'Выключить и сменить доступ' }).click()
    assert.equal(await remove.count(), 0)
    await page.getByRole('button', { name: 'Действия' }).click()
    await page.getByRole('button', { name: 'Сделай план' }).click()
    await remove.waitFor({ timeout: 2000 })
    await page.locator('.plan-chip-slide').evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)) })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(400, 700))
    const [accessBox, planBox, modeBox, sendBox] = await Promise.all([
      access.boundingBox(), remove.boundingBox(), page.getByRole('button', { name: /Режим:/ }).boundingBox(), page.getByRole('button', { name: 'Отправить' }).boundingBox()
    ])
    assert.ok(accessBox && planBox && modeBox && sendBox)
    const follows = (first, second) => second.y >= first.y + first.height - 1 || (Math.abs(second.y - first.y) <= 1 && second.x >= first.x + first.width - 1)
    assert.ok(follows(accessBox, planBox), `plan follows the access selector: ${JSON.stringify({ accessBox, planBox, modeBox, sendBox })}`)
    assert.ok(follows(planBox, modeBox), 'plan does not overlap the mode selector')
    assert.ok(follows(modeBox, sendBox), 'mode selector does not overlap send')
    const composerBox = await page.locator('[data-composer-box]').boundingBox()
    assert.ok(composerBox)
    for (const box of [accessBox, planBox, modeBox, sendBox]) {
      assert.ok(box.x >= composerBox.x && box.x + box.width <= composerBox.x + composerBox.width + 1, 'controls stay inside the composer')
    }
    await remove.focus()
    await page.keyboard.press('Enter')
    assert.equal(await remove.count(), 0)
    assert.equal(await page.getByPlaceholder('Напиши что-нибудь…').inputValue(), 'Моя задача')
    assert.equal(await page.getByPlaceholder('Напиши что-нибудь…').evaluate(element => element === document.activeElement), true)
  } finally {
    if (app) await app.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('Electron saves settings, asks before actions, restores history and transfers an image archive', { timeout: 120000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-e2e-'))
  const provider = await startProvider()
  let app
  try {
    let page
    ;({ app, page } = await launch(root))
    await page.getByRole('button', { name: 'Профиль' }).click(); await page.getByRole('button', { name: 'Настройки' }).click()
    await page.getByRole('button', { name: 'Модель и API' }).click()
    await page.locator('#model-api-key').fill('local-test-key')
    await page.locator('#model-url').fill(provider.url)
    await page.getByRole('button', { name: 'Назад к чату', exact: true }).click()
    await page.waitForTimeout(500)
    const folder = await page.evaluate(() => JSON.parse(localStorage.getItem('zipply_chat_sessions_v1'))[0].folderPath)
    const relativeFolder = path.relative(root, folder)
    assert.ok(relativeFolder && !relativeFolder.startsWith('..') && !path.isAbsolute(relativeFolder), `workspace must be isolated: ${folder}`)
    await send(page, 'Проверь команду')
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ timeout: 15000 })
    assert.match(await dialog.innerText(), /denied\.txt/)
    assert.notEqual(await dialog.getAttribute('aria-modal'), 'true')
    const composer = page.getByPlaceholder('Напиши что-нибудь…')
    await composer.fill('Черновик во время подтверждения')
    assert.equal(await composer.evaluate(element => element === document.activeElement), true)
    await dialog.getByRole('button', { name: 'Разрешить' }).focus()
    await page.keyboard.press('Escape')
    await composer.fill('')
    await page.getByText('Действие обработано.').first().waitFor({ timeout: 15000 })
    await assert.rejects(fs.access(path.join(folder, 'denied.txt')))
    await send(page, 'Создай файл')
    await dialog.waitFor({ timeout: 15000 })
    assert.match(await dialog.innerText(), /данные из теста/)
    await assert.rejects(fs.access(path.join(folder, 'created.txt')))
    await dialog.getByRole('button', { name: 'Разрешить' }).click()
    await page.getByText('Действие обработано.').nth(1).waitFor({ timeout: 15000 })
    assert.equal(await fs.readFile(path.join(folder, 'created.txt'), 'utf8'), 'данные из теста')
    await app.close(); app = null
    ;({ app, page } = await launch(root))
    await page.getByText('Создай файл', { exact: true }).first().waitFor()
    await page.locator('input[type="file"][accept*="image"]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png })
    await send(page, 'Посмотри изображение')
    await page.getByText('Изображение получено.').waitFor({ timeout: 15000 })
    assert.ok(provider.requests.some(request => JSON.stringify(request.messages).includes('data:image/png;base64,')))
    await page.getByRole('button', { name: 'Профиль' }).click(); await page.getByRole('button', { name: 'Настройки' }).click()
    await page.getByRole('button', { name: 'Данные', exact: true }).click()
    const backup = path.join(root, 'backup.zip')
    const errors = []
    page.on('dialog', dialog => { errors.push(dialog.message()); return dialog.dismiss() })
    await app.evaluate(({ session }, target) => {
      globalThis.__e2eDownload = new Promise(resolve => {
        session.defaultSession.once('will-download', (_event, item) => {
          item.setSavePath(target)
          item.once('done', (_event, state) => resolve(state))
        })
      })
    }, backup)
    await page.getByRole('button', { name: 'Экспорт с вложениями (.zip)' }).click()
    assert.equal(await app.evaluate(() => globalThis.__e2eDownload), 'completed')
    assert.deepEqual(errors, [])
    await fs.access(backup)
    await page.getByRole('button', { name: 'Очистить' }).click()
    await page.getByRole('button', { name: 'Да, удалить' }).click()
    await fs.rm(folder, { recursive: true, force: true })
    await page.locator('input[type="file"][accept*=".zip"]').setInputFiles(backup)
    await page.getByRole('dialog', { name: 'Заменить историю?' }).getByRole('button', { name: 'Заменить историю' }).click()
    await page.getByText(/История импортирована:/).waitFor()
    await page.getByRole('button', { name: 'Назад к чату', exact: true }).click()
    await page.getByText('Посмотри изображение', { exact: true }).first().waitFor({ timeout: 15000 })
    const image = page.locator('img[alt="photo.png"]')
    await image.waitFor({ timeout: 15000 })
    assert.ok((await image.getAttribute('src')).startsWith('data:image/png;base64,'))
    const requestCount = provider.requests.length
    await send(page, 'Посмотри ещё раз')
    await page.getByText('Изображение получено.').nth(1).waitFor({ timeout: 15000 })
    assert.ok(provider.requests.slice(requestCount).some(request => JSON.stringify(request.messages).includes('data:image/png;base64,')))
    await page.getByRole('button', { name: 'Профиль' }).click(); await page.getByRole('button', { name: 'Настройки' }).click()
    await page.getByRole('button', { name: 'Данные', exact: true }).click()
    await page.locator('input[type="file"][accept*=".zip"]').setInputFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from('broken archive') })
    await page.getByRole('dialog', { name: 'Заменить историю?' }).getByRole('button', { name: 'Заменить историю' }).click()
    await page.getByText(/не удалось|ошибка|архив/i).last().waitFor()
    await page.getByRole('button', { name: 'Назад к чату', exact: true }).click()
    await page.getByText('Посмотри изображение', { exact: true }).first().waitFor()
    await app.close(); app = null
    ;({ app, page } = await launch(root))
    await page.getByText('Посмотри изображение', { exact: true }).first().waitFor()
    await page.locator('img[alt="photo.png"]').waitFor()
  } finally {
    if (app) await app.close()
    await new Promise(resolve => provider.server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('batch patch confirmation displays both files and applies the approved changes', { timeout: 45000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-patch-e2e-')); const provider = await startProvider(); let app
  try {
    let page; ({ app, page } = await launch(root))
    await page.getByRole('button', { name: 'Профиль' }).click(); await page.getByRole('button', { name: 'Настройки' }).click(); await page.getByRole('button', { name: 'Модель и API' }).click()
    await page.locator('#model-api-key').fill('local-test-key'); await page.locator('#model-url').fill(provider.url)
    await page.getByRole('button', { name: 'Назад к чату', exact: true }).click(); await page.waitForTimeout(500)
    const folder = await page.evaluate(() => JSON.parse(localStorage.getItem('zipply_chat_sessions_v1'))[0].folderPath)
    await fs.writeFile(path.join(folder, 'a.txt'), 'one\n'); await fs.writeFile(path.join(folder, 'b.txt'), 'two\n')
    await send(page, 'Примени пакет')
    const dialog = page.getByRole('dialog'); await dialog.waitFor({ timeout: 15000 })
    const text = await dialog.innerText(); assert.match(text, /a\.txt/); assert.match(text, /b\.txt/)
    await dialog.getByRole('button', { name: 'Разрешить' }).click()
    await page.getByText('Действие обработано.').waitFor({ timeout: 15000 })
    assert.equal(await fs.readFile(path.join(folder, 'a.txt'), 'utf8'), 'ONE\n'); assert.equal(await fs.readFile(path.join(folder, 'b.txt'), 'utf8'), 'TWO\n')
    await page.getByRole('button', { name: /Изменяю файлы|Изменение файлов/ }).first().click()
    const patchCard = page.getByRole('button', { name: /Пакет правок/ }).first(); await patchCard.click({ timeout: 3000 })
    await page.getByText('a.txt · Изменён').waitFor(); await page.getByText('b.txt · Изменён').waitFor()
    await page.getByText('a.txt · Изменён').click()
    await page.evaluate(async () => { await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))) })
    await fs.mkdir('scratch', { recursive: true }); await page.screenshot({ path: 'scratch/patch-e2e.png' })
  } finally { if (app) await app.close(); await new Promise(resolve => provider.server.close(resolve)); await fs.rm(root, { recursive: true, force: true }) }
})

test('a process remains available to the same chat across messages and can be stopped', { timeout: 60000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-process-e2e-')); const provider = await startProvider(); let app
  try {
    let page; ({ app, page } = await launch(root))
    await page.getByRole('button', { name: 'Профиль' }).click(); await page.getByRole('button', { name: 'Настройки' }).click(); await page.getByRole('button', { name: 'Модель и API' }).click()
    await page.locator('#model-api-key').fill('local-test-key'); await page.locator('#model-url').fill(provider.url)
    await page.getByRole('button', { name: 'Назад к чату', exact: true }).click(); await page.waitForTimeout(500)
    await send(page, 'Запусти процесс'); let dialog = page.getByRole('dialog'); await dialog.waitFor({ timeout: 10000 }); await dialog.getByRole('button', { name: 'Разрешить' }).click()
    await page.getByText('Действие обработано.').first().waitFor({ timeout: 10000 })
    await send(page, 'Проверь процесс'); await page.getByText('Действие обработано.').nth(1).waitFor({ timeout: 10000 })
    const poll = provider.requests.flatMap(r => r.messages || []).find(m => m.role === 'tool' && m.name === 'process_poll')
    assert.match(poll?.content || '', /ready/)
    await send(page, 'Останови процесс'); dialog = page.getByRole('dialog'); await dialog.waitFor({ timeout: 10000 }); await dialog.getByRole('button', { name: 'Разрешить' }).click()
    await page.getByText('Действие обработано.').nth(2).waitFor({ timeout: 10000 })
    assert.ok(provider.requests.some(r => r.messages?.some(m => m.role === 'tool' && m.name === 'process_stop' && /остановлен/.test(m.content))))
  } finally { if (app) await app.close(); await new Promise(resolve => provider.server.close(resolve)); await fs.rm(root, { recursive: true, force: true }) }
})


test('documents reach the model and scheduled tasks run in a background chat', { timeout: 60000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-new-e2e-')); const provider = await startProvider(); let app
  try {
    let page; ({ app, page } = await launch(root))
    await page.getByRole('button', { name: 'Профиль' }).click(); await page.getByRole('button', { name: 'Настройки' }).click()
    await page.getByRole('button', { name: 'Модель и API' }).click()
    await page.locator('#model-api-key').fill('local-test-key')
    await page.locator('#model-url').fill(provider.url)
    await page.getByRole('button', { name: 'Назад к чату', exact: true }).click()
    await page.waitForTimeout(500)
    const folder = await page.evaluate(() => JSON.parse(localStorage.getItem('zipply_chat_sessions_v1'))[0].folderPath)
    await page.locator('input[type="file"][accept*="image"]').setInputFiles({ name: 'report.txt', mimeType: 'text/plain', buffer: Buffer.from('Unique report content') })
    await send(page, 'Прочитай документ')
    await page.getByText('Изображение получено.').waitFor({ timeout: 15000 })
    assert.ok(provider.requests.some(request => JSON.stringify(request.messages).includes('Unique report content')))
    await app.evaluate(({ dialog }, value) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [value] }) }, folder)
    await page.getByRole('button', { name: 'Профиль' }).click(); await page.getByRole('button', { name: 'Настройки' }).click()
    await page.getByRole('button', { name: 'Расписание', exact: true }).click()
    await page.locator('#schedule-prompt').fill('Запланированный отчёт')
    await page.getByRole('button', { name: 'Выбрать папку проекта' }).click()
    const target = new Date(Date.now() + 120000)
    const localDate = new Date(target.getTime() - target.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    await page.locator('#schedule-date').fill(localDate)
    await page.getByRole('button', { name: 'Добавить задачу' }).click()
    await page.getByText('Запланированный отчёт', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Назад к чату', exact: true }).click()
    const before = await page.locator('[aria-current="page"]').first().innerText()
    await page.evaluate(() => { const original = Date.now; Date.now = () => original() + 180000 })
    await page.getByRole('button', { name: /По расписанию: Запланированный отчёт/ }).waitFor({ timeout: 15000 })
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('zipply_chat_sessions_v1')).some(s => s.title.includes('По расписанию:') && s.messages.some(m => m.role === 'assistant' && !m.isStreaming)), null, { timeout: 15000 })
    assert.equal(await page.locator('[aria-current="page"]').first().innerText(), before)
    assert.ok(provider.requests.some(request => JSON.stringify(request.messages).includes('Запланированный отчёт')))
  } finally { if (app) await app.close(); await new Promise(resolve => provider.server.close(resolve)); await fs.rm(root, { recursive: true, force: true }) }
})

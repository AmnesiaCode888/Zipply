const { test } = require('node:test')
const assert = require('node:assert/strict')
const { _electron: electron } = require('playwright-core')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')

test('files tab browses the chat folder and restores its type', { timeout: 30000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-file-panel-'))
  let app
  try {
    app = await electron.launch({ args: ['tests/e2e/bootstrap.cjs'], env: { ...process.env, ZIPPLY_E2E_ROOT: root } })
    const page = await app.firstWindow()
    await page.getByPlaceholder('Напиши что-нибудь…').waitFor()
    const folder = await page.evaluate(() => JSON.parse(localStorage.getItem('zipply_chat_sessions_v1'))[0].folderPath)
    await fs.mkdir(path.join(folder, 'src'), { recursive: true })
    await fs.writeFile(path.join(folder, 'src', 'hello.txt'), 'Привет из файла')
    await page.getByRole('button', { name: 'Открыть рабочую панель' }).click()
    const panel = page.getByRole('region', { name: 'Рабочая панель' })
    assert.equal(await panel.getByRole('button', { name: /Терминал/ }).isDisabled(), true)
    await panel.getByRole('button', { name: 'Файлы', exact: true }).click()
    await panel.getByRole('button', { name: 'src', exact: true }).click()
    await panel.getByRole('button', { name: 'hello.txt', exact: true }).click()
    await panel.getByText('Привет из файла').waitFor()
    const editor = panel.getByRole('textbox', { name: 'Редактор файла' })
    await editor.fill('Новый текст')
    await panel.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(button => button.textContent === 'Сохранить' && button.disabled))
    assert.equal(await fs.readFile(path.join(folder, 'src', 'hello.txt'), 'utf8'), 'Новый текст')
    await panel.getByRole('button', { name: 'Назад к файлам' }).click()
    await page.reload()
    await panel.getByRole('tab', { name: 'hello.txt', selected: true }).waitFor()
    await panel.getByRole('button', { name: 'Назад к файлам' }).click()
    await panel.getByRole('button', { name: 'src', exact: true }).waitFor()
  } finally {
    if (app) await app.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('files tab updates tree and open file preview automatically on disk changes', { timeout: 45000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-file-watch-'))
  let app
  try {
    app = await electron.launch({ args: ['tests/e2e/bootstrap.cjs'], env: { ...process.env, ZIPPLY_E2E_ROOT: root }, timeout: 30000 })
    const page = await app.firstWindow()
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('auth:getState')
      ipcMain.handle('auth:getState', () => ({
        status: 'authenticated',
        subscriptionReady: true,
        profile: { id: 'test-user', plan: 'pro', isPro: true },
        avatarDataUrl: null,
        usage: { active: { plan: 'pro', tier: 'pro' } },
        history: null,
        error: null,
        scope: null
      }))
    })
    await page.reload()
    const win = await app.browserWindow(page)
    await win.evaluate(w => w.setSize(1600, 800))
    const openPanel = page.getByRole('button', { name: 'Открыть рабочую панель' })
    await openPanel.waitFor()
    const folder = await page.evaluate(() => JSON.parse(window.api.storage.get('zipply_chat_sessions_v1').value)[0].folderPath)
    await fs.mkdir(path.join(folder, 'src'), { recursive: true })
    await fs.writeFile(path.join(folder, 'src', 'live.txt'), 'Начальный текст')
    await openPanel.click()
    const panel = page.getByRole('region', { name: 'Рабочая панель' })
    const separator = panel.getByRole('separator', { name: 'Изменить ширину рабочей панели' })
    await separator.focus()
    await page.keyboard.press('End')
    await panel.getByRole('button', { name: 'Добавить вкладку' }).click()
    await panel.getByRole('button', { name: 'Файлы', exact: true }).click()
    await panel.getByRole('button', { name: 'src', exact: true }).click()
    await panel.getByRole('button', { name: 'live.txt', exact: true }).click()
    const editor = panel.getByRole('textbox', { name: 'Редактор файла' })
    await page.waitForFunction(() => document.querySelector('[aria-label="Редактор файла"]')?.value === 'Начальный текст')

    // Create a nested file and modify the open file without clicking Refresh
    await fs.writeFile(path.join(folder, 'src', 'auto.txt'), 'Новый файл')
    await fs.writeFile(path.join(folder, 'src', 'live.txt'), 'Обновлённый текст')
    await panel.getByRole('button', { name: 'auto.txt', exact: true }).waitFor({ timeout: 5000 })
    await page.waitForFunction(() => document.querySelector('[aria-label="Редактор файла"]')?.value === 'Обновлённый текст', null, { timeout: 5000 })

    // Removing the newly added file updates the tree automatically too
    await fs.rm(path.join(folder, 'src', 'auto.txt'))
    await panel.getByRole('button', { name: 'auto.txt', exact: true }).waitFor({ state: 'detached', timeout: 5000 })
    assert.equal(await editor.inputValue(), 'Обновлённый текст')
  } finally {
    if (app) await app.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('file tree width can be resized and restored', { timeout: 30000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-tree-resize-'))
  let app
  try {
    app = await electron.launch({ args: ['tests/e2e/bootstrap.cjs'], env: { ...process.env, ZIPPLY_E2E_ROOT: root } })
    const page = await app.firstWindow()
    const win = await app.browserWindow(page)
    await win.evaluate(w => w.setSize(1600, 800))
    await page.getByPlaceholder('Напиши что-нибудь…').waitFor()
    await page.getByRole('button', { name: 'Открыть рабочую панель' }).click()
    const panel = page.getByRole('region', { name: 'Рабочая панель' })
    const panelResize = panel.getByRole('separator', { name: 'Изменить ширину рабочей панели' })
    await panelResize.focus(); await page.keyboard.press('End')
    await panel.getByRole('button', { name: 'Файлы', exact: true }).click()
    const treeResize = panel.getByRole('separator', { name: 'Изменить ширину списка файлов' })
    await treeResize.waitFor({ state: 'visible' })
    await treeResize.focus(); await page.keyboard.press('ArrowLeft')
    assert.equal(await treeResize.getAttribute('aria-valuenow'), '276')
    await page.reload()
    await treeResize.waitFor({ state: 'visible' })
    assert.equal(await treeResize.getAttribute('aria-valuenow'), '276')
    await treeResize.dblclick()
    assert.equal(await treeResize.getAttribute('aria-valuenow'), '260')
  } finally {
    if (app) await app.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('editor diagnoses unsaved text and navigates to its error', { timeout: 30000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-live-editor-'))
  let app
  try {
    app = await electron.launch({ args: ['tests/e2e/bootstrap.cjs'], env: { ...process.env, ZIPPLY_E2E_ROOT: root } })
    const page = await app.firstWindow()
    await page.getByPlaceholder('Напиши что-нибудь…').waitFor()
    const folder = await page.evaluate(() => JSON.parse(localStorage.getItem('zipply_chat_sessions_v1'))[0].folderPath)
    await fs.mkdir(folder, { recursive: true })
    await fs.writeFile(path.join(folder, 'live.ts'), 'const ok: number = 1\n')
    await page.evaluate(() => localStorage.setItem('zipply_editor_settings_v1', JSON.stringify({ diagnostics: true, delay: 500, markers: true })))
    await page.getByRole('button', { name: 'Открыть рабочую панель' }).click()
    const panel = page.getByRole('region', { name: 'Рабочая панель' })
    await panel.getByRole('button', { name: 'Файлы', exact: true }).click()
    await panel.getByRole('button', { name: 'live.ts', exact: true }).click()
    const editor = panel.getByRole('textbox', { name: 'Редактор файла' })
    await editor.fill('const ok = 1\nconst fail: number = "bad"\n')
    await panel.getByText('Проблемы', { exact: true }).click({ timeout: 15000 })
    const issue = panel.getByRole('button', { name: /2:.*not assignable/ })
    await issue.waitFor({ timeout: 15000 })
    assert.equal(await panel.locator('.workspace-diagnostic-marker.is-error').count() > 0, true)
    assert.equal(await panel.locator('.workspace-diagnostic-underline.is-error').count() > 0, true)
    await issue.click()
    assert.ok(await editor.evaluate(element => element.selectionStart >= element.value.indexOf('const fail')))
    assert.equal(await fs.readFile(path.join(folder, 'live.ts'), 'utf8'), 'const ok: number = 1\n')
  } finally {
    if (app) await app.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('workspace panel persists and preserves the chat across layout changes', { timeout: 60000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-panel-'))
  let app
  try {
    app = await electron.launch({ args: ['tests/e2e/bootstrap.cjs'], env: { ...process.env, ZIPPLY_E2E_ROOT: root } })
    const page = await app.firstWindow()
    const win = await app.browserWindow(page)
    await win.evaluate(w => w.setSize(1300, 800))
    const input = page.getByPlaceholder('Напиши что-нибудь…')
    await input.fill('Сохранённый черновик')
    const toggle = page.getByRole('button', { name: 'Открыть рабочую панель' })
    await toggle.click()
    const panel = page.getByRole('region', { name: 'Рабочая панель' })
    await panel.getByRole('button', { name: 'Добавить вкладку' }).waitFor()
    assert.equal(await input.isVisible(), true)
    assert.equal(await panel.evaluate(element => getComputedStyle(element).borderTopLeftRadius), '0px')
    assert.equal(await page.locator('[data-content-pane]').evaluate(element => getComputedStyle(element).borderTopRightRadius), '18px')
    await page.locator('.workspace-panel-wrap').evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))) })
    const separator = page.getByRole('separator', { name: 'Изменить ширину рабочей панели' })
    const handle = await separator.boundingBox()
    await page.mouse.move(handle.x + 4, handle.y + 100)
    await page.mouse.down()
    await page.mouse.move(handle.x - 40, handle.y + 100)
    await page.mouse.up()
    assert.ok(Number(await separator.getAttribute('aria-valuenow')) > 440)
    await separator.dblclick()
    await page.waitForFunction(() => document.querySelector('[role="separator"][aria-label="Изменить ширину рабочей панели"]')?.getAttribute('aria-valuenow') === '440', null, { timeout: 2000 })
    assert.equal(await separator.getAttribute('aria-valuenow'), '440')
    await separator.focus()
    await page.keyboard.press('ArrowLeft')
    assert.equal(await separator.getAttribute('aria-valuenow'), '456')
    if (process.env.ZIPPLY_PANEL_SCREENSHOT) await page.screenshot({ path: process.env.ZIPPLY_PANEL_SCREENSHOT })
    await page.getByRole('button', { name: 'Профиль' }).click(); await page.getByRole('button', { name: 'Настройки' }).click()
    assert.equal(await panel.count(), 0)
    await page.getByRole('button', { name: 'Главная', exact: true }).click()
    await panel.getByRole('button', { name: 'Добавить вкладку' }).waitFor()
    await page.reload()
    await panel.getByRole('button', { name: 'Добавить вкладку' }).waitFor()
    assert.equal(await separator.getAttribute('aria-valuenow'), '456')
    await input.fill('Черновик при изменении размера')
    await win.evaluate(w => w.setSize(500, 700))
    await page.waitForFunction(() => document.querySelector('[data-workspace-mode="replace"]'))
    assert.equal(await input.isVisible(), false)
    await page.getByRole('button', { name: 'Закрыть рабочую панель' }).click()
    assert.equal(await input.inputValue(), 'Черновик при изменении размера')
    assert.equal(await input.isVisible(), true)
  } finally {
    if (app) await app.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('narrow composer keeps controls aligned and accessible with context', { timeout: 30000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-composer-'))
  let app
  try {
    app = await electron.launch({ args: ['tests/e2e/bootstrap.cjs'], env: { ...process.env, ZIPPLY_E2E_ROOT: root } })
    const page = await app.firstWindow()
    const win = await app.browserWindow(page)
    await win.evaluate(w => w.setSize(1040, 700))
    await page.getByPlaceholder('Напиши что-нибудь…').waitFor()
    await page.evaluate(() => {
      const sessions = JSON.parse(localStorage.getItem('zipply_chat_sessions_v1'))
      sessions[0].messages = [{ id: 'context-message', role: 'assistant', content: 'Ответ', contextStatus: { estimatedTokens: 40000, limit: 100000, compacted: false } }]
      localStorage.setItem('zipply_chat_sessions_v1', JSON.stringify(sessions))
    })
    await page.reload()
    await page.getByRole('button', { name: 'Открыть рабочую панель' }).click()
    const send = page.getByRole('button', { name: 'Отправить' })
    const composer = page.locator('[data-composer-box]')
    const context = page.getByRole('button', { name: /Контекст:/ })
    await context.waitFor()
    const sendBox = await send.boundingBox()
    const composerBox = await composer.boundingBox()
    assert.ok(composerBox.x + composerBox.width - (sendBox.x + sendBox.width) < 25, 'send stays aligned to the right edge')
    assert.ok(Math.abs((await context.boundingBox()).y - sendBox.y) < 10, 'controls stay on the same row')
    const access = page.getByRole('button', { name: /Доступ агента:/ })
    assert.equal(await access.isVisible(), true)
    assert.equal(await access.getByText('Спросить').isVisible(), true)
    await access.click()
    await page.getByRole('menuitemradio', { name: /Только чтение/ }).click()
    assert.equal(await page.getByRole('button', { name: 'Доступ агента: Только чтение' }).getByText('Чтение').isVisible(), true)
    const mode = page.getByRole('button', { name: /Режим:/ })
    assert.equal(await mode.isVisible(), true)
    if (process.env.ZIPPLY_COMPOSER_SCREENSHOT) await page.screenshot({ path: process.env.ZIPPLY_COMPOSER_SCREENSHOT })
    await mode.click()
    const expandedMode = await mode.boundingBox()
    const expandedSend = await send.boundingBox()
    assert.ok(expandedMode.x + expandedMode.width <= expandedSend.x, 'open mode selector does not overlap send')
    await mode.click()
  } finally {
    if (app) await app.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('workspace tabs can be created, selected, closed and restored', { timeout: 30000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-workspace-tabs-'))
  let app
  try {
    app = await electron.launch({ args: ['tests/e2e/bootstrap.cjs'], env: { ...process.env, ZIPPLY_E2E_ROOT: root } })
    const page = await app.firstWindow()
    await page.getByPlaceholder('Напиши что-нибудь…').waitFor()
    await page.getByRole('button', { name: 'Открыть рабочую панель' }).click()
    const panel = page.getByRole('region', { name: 'Рабочая панель' })
    const tabs = panel.getByRole('tab')
    assert.equal(await tabs.count(), 1)
    assert.equal(await tabs.first().getAttribute('aria-selected'), 'true')
    await panel.getByRole('button', { name: 'Добавить вкладку' }).click()
    assert.equal(await tabs.count(), 2)
    assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true')
    await tabs.first().click()
    assert.equal(await tabs.first().getAttribute('aria-selected'), 'true')
    await page.getByRole('button', { name: 'Закрыть вкладку Вкладка 1' }).click()
    await panel.getByRole('tab', { name: 'Вкладка 1' }).waitFor({ state: 'detached' })
    assert.equal(await tabs.count(), 1)
    assert.equal(await tabs.first().getAttribute('aria-selected'), 'true')
    await page.getByRole('button', { name: 'Закрыть рабочую панель' }).click()
    await page.getByRole('button', { name: 'Открыть рабочую панель' }).click()
    assert.equal(await tabs.first().innerText(), 'Вкладка 2')
    await page.reload()
    await panel.getByRole('button', { name: 'Добавить вкладку' }).waitFor()
    assert.equal(await tabs.first().innerText(), 'Вкладка 2')
    await panel.getByRole('button', { name: 'Закрыть вкладку Вкладка 2' }).click()
    await panel.getByRole('tab', { name: 'Вкладка 2' }).waitFor({ state: 'detached' })
    assert.equal(await tabs.count(), 0)
    await panel.getByRole('button', { name: 'Добавить вкладку' }).click()
    assert.equal(await tabs.count(), 1)
    for (let i = 0; i < 6; i++) await panel.getByRole('button', { name: 'Добавить вкладку' }).click()
    const active = panel.getByRole('tab', { selected: true })
    await page.waitForFunction(() => {
      const list = document.querySelector('[role="tablist"][aria-label="Рабочие вкладки"]')
      const tab = list?.querySelector('[role="tab"][aria-selected="true"]')?.parentElement
      return list && tab && tab.getBoundingClientRect().right <= list.getBoundingClientRect().right + 1
    })
    await active.focus()
    await page.keyboard.press('ArrowLeft')
    assert.equal(await panel.getByRole('tab', { selected: true }).innerText(), 'Вкладка 8')
    await page.keyboard.press('Delete')
    await panel.getByRole('tab', { name: 'Вкладка 8' }).waitFor({ state: 'detached' })
    assert.equal(await panel.getByRole('tab', { name: 'Вкладка 8' }).count(), 0)
    assert.equal(await panel.getByRole('tab', { selected: true }).innerText(), 'Вкладка 9')
    assert.equal(await panel.evaluate(element => getComputedStyle(element).borderTopRightRadius), '0px')
    await page.waitForTimeout(500) // Let the selected tab finish scrolling before the mouse click.
    await panel.getByRole('tab', { selected: true }).click({ button: 'middle' })
    await panel.getByRole('tab', { name: 'Вкладка 9' }).waitFor({ state: 'detached', timeout: 3000 })
    assert.equal(await panel.getByRole('tab', { name: 'Вкладка 9' }).count(), 0)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    assert.equal(await panel.getByRole('tab', { selected: true }).locator('..').evaluate(element => getComputedStyle(element).animationName), 'none')
    if (process.env.ZIPPLY_TABS_SCREENSHOT) await page.screenshot({ path: process.env.ZIPPLY_TABS_SCREENSHOT })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await panel.getByRole('button', { name: 'Добавить вкладку' }).click()
    await panel.getByRole('button', { name: 'Закрыть вкладку Вкладка 10' }).click()
    await page.getByRole('button', { name: 'Закрыть рабочую панель' }).click()
    await page.getByRole('button', { name: 'Открыть рабочую панель' }).click()
    assert.equal(await panel.getByRole('tab', { name: 'Вкладка 10' }).count(), 0)
  } finally {
    if (app) await app.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('workspace tabs can be reordered with the mouse and keyboard and restore their order', { timeout: 30000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-tabs-reorder-'))
  let app
  try {
    app = await electron.launch({ args: ['tests/e2e/bootstrap.cjs'], env: { ...process.env, ZIPPLY_E2E_ROOT: root } })
    const page = await app.firstWindow()
    const win = await app.browserWindow(page)
    await win.evaluate(w => w.setSize(1600, 800))
    await page.getByPlaceholder('Напиши что-нибудь…').waitFor()
    await page.getByRole('button', { name: 'Открыть рабочую панель' }).click()
    const panel = page.getByRole('region', { name: 'Рабочая панель' })
    const separator = panel.getByRole('separator')
    await separator.focus(); await page.keyboard.press('End')
    await panel.getByRole('button', { name: 'Добавить вкладку' }).click()
    await panel.getByRole('button', { name: 'Добавить вкладку' }).click()
    const tabs = panel.getByRole('tab')
    await panel.getByRole('tab', { name: 'Вкладка 1' }).dragTo(panel.getByRole('tab', { name: 'Вкладка 3' }), { targetPosition: { x: 120, y: 15 } })
    assert.deepEqual(await tabs.allInnerTexts(), ['Вкладка 2', 'Вкладка 3', 'Вкладка 1'])
    assert.equal(await panel.getByRole('tab', { selected: true }).innerText(), 'Вкладка 3')
    await panel.getByRole('tab', { name: 'Вкладка 3' }).focus()
    await page.keyboard.press('Alt+Shift+ArrowLeft')
    assert.deepEqual(await tabs.allInnerTexts(), ['Вкладка 3', 'Вкладка 2', 'Вкладка 1'])
    await panel.getByRole('tab', { name: 'Вкладка 1' }).dragTo(panel.getByRole('tab', { name: 'Вкладка 3' }), { targetPosition: { x: 10, y: 15 } })
    assert.deepEqual(await tabs.allInnerTexts(), ['Вкладка 1', 'Вкладка 3', 'Вкладка 2'])
    await page.reload()
    await panel.getByRole('button', { name: 'Добавить вкладку' }).waitFor()
    assert.deepEqual(await tabs.allInnerTexts(), ['Вкладка 1', 'Вкладка 3', 'Вкладка 2'])
  } finally {
    if (app) await app.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

 test('chat hover preview shows the first message and closes on leave', { timeout: 30000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-preview-'))
  let app
  try {
    app = await electron.launch({ args: ['tests/e2e/bootstrap.cjs'], env: { ...process.env, ZIPPLY_E2E_ROOT: root } })
    const page = await app.firstWindow()
    await page.getByPlaceholder('Напиши что-нибудь…').waitFor()
    await page.evaluate(() => {
      const sessions = JSON.parse(localStorage.getItem('zipply_chat_sessions_v1'))
      sessions[0].title = 'Настройка проекта'
      sessions[0].messages = [{ id: 'u', role: 'user', content: 'Помоги настроить проект React' }]
      localStorage.setItem('zipply_chat_sessions_v1', JSON.stringify(sessions))
    })
    await page.reload()
    const row = page.getByRole('button', { name: /Настройка проекта/ })
    await row.hover()
    const preview = page.getByRole('tooltip')
    await preview.waitFor()
    assert.match(await preview.innerText(), /Помоги настроить проект React/)
    assert.match(await preview.innerText(), /Сообщений: 1/)
    await page.mouse.move(1000, 500)
    await preview.waitFor({ state: 'hidden' })
  } finally {
    if (app) await app.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('sidebar chat title stays vertically centered with its action icons', { timeout: 30000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-chat-align-'))
  let app
  try {
    app = await electron.launch({ args: ['tests/e2e/bootstrap.cjs'], env: { ...process.env, ZIPPLY_E2E_ROOT: root } })
    const page = await app.firstWindow()
    const row = page.getByRole('button', { name: 'Новый чат' }).last()
    await row.hover()
    const title = await row.locator('.activity-label').boundingBox()
    const icon = await row.getByTitle('Переименовать').boundingBox()
    assert.ok(Math.abs((title.y + title.height / 2) - (icon.y + icon.height / 2)) <= 1)
  } finally {
    if (app) await app.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { _electron: electron } = require('playwright-core')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')

test('terminal settings apply the saved shell to a new personal terminal', { timeout: 45000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-shell-settings-'))
  const shell = process.platform === 'win32' ? { id: 'cmd', label: 'Командная строка' } : { id: 'sh', label: 'sh' }
  let app
  try {
    app = await electron.launch({ args: ['tests/e2e/bootstrap.cjs'], env: { ...process.env, ZIPPLY_E2E_ROOT: root }, timeout: 30000 })
    const page = await app.firstWindow()
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('auth:getState')
      ipcMain.handle('auth:getState', () => ({ status: 'authenticated', profile: { id: 'test-user' }, avatarDataUrl: null, usage: null, history: null, error: null, scope: null }))
    })
    await page.reload()
    await page.getByRole('button', { name: 'Профиль' }).waitFor()
    await page.getByRole('button', { name: 'Профиль' }).click()
    await page.getByRole('button', { name: 'Настройки' }).click()
    await page.getByRole('searchbox', { name: 'Поиск разделов настроек' }).fill('оболочка')
    await page.getByRole('button', { name: 'Агент', exact: true }).click()
    await page.getByLabel('Оболочка терминала').selectOption(shell.id)
    if (process.env.ZIPPLY_SHELL_SETTINGS_SCREENSHOT) await page.screenshot({ path: process.env.ZIPPLY_SHELL_SETTINGS_SCREENSHOT })
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Открыть рабочую панель' }).click()
    const panel = page.getByRole('region', { name: 'Рабочая панель' })
    await panel.getByRole('button', { name: 'Добавить вкладку' }).click()
    await panel.getByRole('button', { name: 'Терминал', exact: true }).click()
    await panel.getByText(`${shell.label} · Работает`, { exact: true }).waitFor()
    await panel.getByRole('button', { name: 'Закрыть вкладку Терминал', exact: true }).click()
    assert.equal(await page.evaluate(() => JSON.parse(window.api.storage.get('zipply_app_settings_v1').value).terminalShell), shell.id)
  } finally { if (app) await app.close(); await fs.rm(root, { recursive: true, force: true }) }
})

test('settings confirm history replacement and allow cancelling it', { timeout: 45000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-settings-e2e-'))
  let app
  try {
    app = await electron.launch({ args: ['tests/e2e/bootstrap.cjs'], env: { ...process.env, ZIPPLY_E2E_ROOT: root }, timeout: 30000 })
    const page = await app.firstWindow()
    await page.getByPlaceholder('Напиши что-нибудь…').waitFor()
    await page.getByRole('button', { name: 'Профиль' }).click(); await page.getByRole('button', { name: 'Настройки' }).click()
    if (process.env.ZIPPLY_SETTINGS_SCREENSHOT) {
      await page.getByRole('button', { name: 'Редактор', exact: true }).click()
      await page.getByRole('button', { name: 'Редактор', exact: true }).waitFor()
      await page.waitForTimeout(250)
      await page.screenshot({ path: process.env.ZIPPLY_SETTINGS_SCREENSHOT })
    }
    await page.getByRole('button', { name: 'Данные', exact: true }).click()
    const before = await page.evaluate(() => localStorage.getItem('zipply_chat_sessions_v1'))
    await page.locator('input[type="file"][accept*=".zip"]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from('[]') })
    const confirmation = page.getByRole('dialog', { name: 'Заменить историю?' })
    await confirmation.waitFor({ timeout: 3000 })
    assert.match(await confirmation.innerText(), /backup\.json/)
    assert.equal(await page.evaluate(() => localStorage.getItem('zipply_chat_sessions_v1')), before)
    await confirmation.getByRole('button', { name: 'Отмена' }).click()
    assert.equal(await confirmation.count(), 0)
    assert.equal(await page.evaluate(() => localStorage.getItem('zipply_chat_sessions_v1')), before)
  } finally { if (app) await app.close(); await fs.rm(root, { recursive: true, force: true }) }
})

test('settings search finds a section and scheduled tasks can be edited and deleted', { timeout: 45000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-settings-schedule-e2e-'))
  let app
  try {
    app = await electron.launch({ args: ['tests/e2e/bootstrap.cjs'], env: { ...process.env, ZIPPLY_E2E_ROOT: root }, timeout: 30000 })
    const page = await app.firstWindow()
    await page.getByPlaceholder('Напиши что-нибудь…').waitFor()
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, root)
    await page.getByRole('button', { name: 'Профиль' }).click(); await page.getByRole('button', { name: 'Настройки' }).click()
    await page.getByLabel('Поиск разделов настроек').fill('распис')
    await page.getByRole('button', { name: 'Расписание', exact: true }).click()
    await page.locator('#schedule-prompt').fill('Первый текст')
    await page.getByRole('button', { name: 'Выбрать папку проекта' }).click()
    const time = new Date(Date.now() + 3600000)
    await page.locator('#schedule-date').fill(new Date(time.getTime() - time.getTimezoneOffset() * 60000).toISOString().slice(0, 16))
    await page.getByRole('button', { name: 'Добавить задачу' }).click()
    await page.getByRole('button', { name: 'Изменить', exact: true }).click()
    await page.locator('#schedule-prompt').fill('Обновлённая задача')
    await page.getByRole('button', { name: 'Сохранить задачу' }).click()
    await page.getByText('Обновлённая задача', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Удалить задачу: Обновлённая задача' }).click()
    await page.getByRole('button', { name: 'Удалить задачу', exact: true }).click()
    await page.getByText('Запланированных задач пока нет.').waitFor()
  } finally { if (app) await app.close(); await fs.rm(root, { recursive: true, force: true }) }
})

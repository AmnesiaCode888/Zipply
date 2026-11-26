const { test } = require('node:test')
const assert = require('node:assert/strict')
const { _electron: electron } = require('playwright-core')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')

test('workspace replace mode and window controls remain within narrow window', { timeout: 30000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-responsive-'))
  let app
  try {
    app = await electron.launch({ args: ['tests/e2e/bootstrap.cjs'], env: { ...process.env, ZIPPLY_E2E_ROOT: root } })
    const page = await app.firstWindow()
    const win = await app.browserWindow(page)
    await page.getByPlaceholder('Напиши что-нибудь…').waitFor()
    await page.getByRole('button', { name: 'Открыть рабочую панель' }).click()
    await win.evaluate(w => w.setSize(900, 700))
    const panel = page.getByRole('region', { name: 'Рабочая панель' })
    await page.waitForFunction(() => {
      const panel = document.querySelector('[data-workspace-mode="replace"]')
      return panel && panel.getBoundingClientRect().width > 0
    })
    const [frame, panelBox] = await Promise.all([page.locator('[data-app-frame]').boundingBox(), panel.boundingBox()])
    assert.ok(panelBox.x >= frame.x && panelBox.x + panelBox.width <= frame.x + frame.width + 1, 'workspace panel must fit beside sidebar')
    await page.getByRole('button', { name: 'Закрыть рабочую панель' }).click()
    await page.evaluate(() => localStorage.setItem('zipply_sidebar_width', '460'))
    await page.reload()
    await win.evaluate(w => w.setSize(400, 700))
    await page.waitForTimeout(350)
    for (const name of ['Toggle Sidebar', 'Открыть рабочую панель', 'Закрыть рабочую панель', 'Minimize', 'Maximize', 'Close']) {
      const button = page.getByRole('button', { name, exact: true })
      if (await button.count() === 0) continue
      const box = await button.boundingBox()
      assert.ok(box && box.x >= 0 && box.x + box.width <= 401 && box.width >= 24, `${name} must remain reachable`)
    }
  } finally {
    if (app) await app.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

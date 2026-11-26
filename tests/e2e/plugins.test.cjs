const { test } = require('node:test')
const assert = require('node:assert/strict')
const { _electron: electron } = require('playwright-core')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')

test('plugins can be installed, opened, restored and removed', { timeout: 45000 }, async () => {
  const tempRoot = path.resolve(os.tmpdir())
  const root = await fs.mkdtemp(path.join(tempRoot, 'zipply-plugins-'))
  let app
  try {
    app = await electron.launch({ args: ['tests/e2e/bootstrap.cjs'], env: { ...process.env, ZIPPLY_E2E_ROOT: root } })
    const page = await app.firstWindow()
    const openLibrary = async () => page.getByRole('button', { name: 'Плагины', exact: true }).click()
    await openLibrary()
    await page.getByRole('button', { name: 'Установить CyberSec' }).first().click()
    const installed = page.getByRole('navigation', { name: 'Установленные плагины' })
    await installed.getByRole('button', { name: 'CyberSec', exact: true }).click()
    await page.getByRole('heading', { name: 'CyberSec', exact: true }).waitFor()
    await page.reload()
    await openLibrary()
    await installed.getByRole('button', { name: 'CyberSec', exact: true }).click()
    await page.getByRole('button', { name: 'Удалить из моих плагинов' }).click()
    assert.equal(await installed.getByRole('button', { name: 'CyberSec', exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Установить CyberSec' }).first().waitFor()
  } finally { if (app) await app.close(); if (path.dirname(root) === tempRoot && path.basename(root).startsWith('zipply-plugins-')) await fs.rm(root, { recursive: true, force: true }) }
})

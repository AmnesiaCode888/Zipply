const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

function load(file) {
  const built = buildSync({
    entryPoints: [file],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    packages: 'external',
    loader: { '.svg': 'dataurl' }
  })
  const mod = new Module(path.resolve(file), module)
  mod.filename = path.resolve(file)
  mod.paths = module.paths
  mod._compile(built.outputFiles[0].text, mod.filename)
  return mod.exports
}

test('semver comparison ignores prereleases and detects newer stable releases', () => {
  const { compareVersions, isUpdateAvailable } = load('src/shared/updates.ts')
  assert.equal(compareVersions('v0.2.0', '0.1.0'), 1)
  assert.equal(compareVersions('0.1.0', '0.1.0'), 0)
  assert.equal(compareVersions('0.5.0-beta', '0.5.0'), -1)
  assert.equal(isUpdateAvailable('0.1.0', 'v0.1.1'), true)
  assert.equal(isUpdateAvailable('0.1.0', 'v0.5.0-beta'), false)
  assert.equal(isUpdateAvailable('0.2.0', 'v0.1.9'), false)
})

test('UpdateService checks GitHub releases with ETag, handles 404, and opens zipply.my', async () => {
  const { UpdateService } = load('src/main/services/UpdateService.ts')
  const opened = []
  let mode = '404'
  const seenHeaders = []

  const service = new UpdateService({
    currentVersion: '0.1.0',
    isPackaged: false,
    openExternal: async (url) => { opened.push(url) },
    fetchFn: async (_url, init) => {
      seenHeaders.push(init.headers)
      if (mode === '404') {
        return new Response('Not Found', { status: 404 })
      }
      if (mode === '200-new') {
        return new Response(
          JSON.stringify({ tag_name: 'v0.2.0', name: 'Zipply 0.2.0', published_at: '2026-11-27T00:00:00Z' }),
          { status: 200, headers: { etag: '"v0.2.0-etag"' } }
        )
      }
      if (mode === '304') {
        return new Response(null, { status: 304 })
      }
      throw new Error('offline')
    }
  })

  const state404 = await service.checkForUpdates({ manual: true })
  assert.equal(state404.status, 'up-to-date')
  assert.equal(state404.error, null)

  mode = '200-new'
  const stateNew = await service.checkForUpdates({ manual: true })
  assert.equal(stateNew.status, 'available')
  assert.equal(stateNew.latestVersion, '0.2.0')
  assert.equal(stateNew.releaseUrl, 'https://zipply.my')

  mode = '304'
  const stateCached = await service.checkForUpdates({ manual: true })
  assert.equal(seenHeaders[2]['If-None-Match'], '"v0.2.0-etag"')
  assert.equal(stateCached.status, 'available')
  assert.equal(stateCached.latestVersion, '0.2.0')

  mode = 'error'
  const stateBgError = await service.checkForUpdates({ manual: false })
  assert.equal(stateBgError.status, 'available')

  const stateManualError = await service.checkForUpdates({ manual: true })
  assert.equal(stateManualError.status, 'error')

  await service.openDownloadPage()
  assert.deepEqual(opened, ['https://zipply.my/'])
})

test('Sidebar and ProfileTab render update banner and version check controls', () => {
  const { Sidebar } = load('src/renderer/src/components/sidebar/Sidebar.tsx')
  const { ProfileTab } = load('src/renderer/src/components/settings/tabs/ProfileTab.tsx')

  const sidebarHtml = renderToStaticMarkup(React.createElement(Sidebar, {
    mainView: 'chat',
    updateAvailable: { version: '0.2.0', releaseUrl: 'https://zipply.my' }
  }))
  assert.match(sidebarHtml, /Доступна v0\.2\.0/)
  assert.match(sidebarHtml, /Скачать на zipply\.my/)

  const profileHtml = renderToStaticMarkup(React.createElement(ProfileTab, {
    auth: { status: 'anonymous', profile: null, avatarDataUrl: null, usage: null, error: null, scope: null },
    busy: false,
    onLogin: () => {},
    onCancelLogin: () => {},
    onRefresh: () => {},
    onLogout: () => {},
    updateState: {
      currentVersion: '0.1.0',
      status: 'available',
      latestVersion: '0.2.0',
      releaseName: 'Zipply 0.2.0',
      releaseUrl: 'https://zipply.my',
      publishedAt: null,
      checkedAt: 1,
      error: null
    },
    onCheckUpdates: () => {},
    onOpenUpdateDownload: () => {}
  }))
  assert.match(profileHtml, /Zipply v0\.1\.0/)
  assert.match(profileHtml, /Доступна новая версия v0\.2\.0/)
  assert.match(profileHtml, /Скачать на zipply\.my/)
  assert.match(profileHtml, /Проверить/)
})

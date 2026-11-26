const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

const file = path.resolve('src/renderer/src/services/pluginStorage.ts')
const built = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false })
const mod = new Module(file, module)
mod.filename = file
mod.paths = module.paths
mod._compile(built.outputFiles[0].text, file)
const { loadInstalledPlugins, clearLegacyInstalledPlugins } = mod.exports

test('legacy plugin IDs can be read for migration and removed safely', () => {
  let stored = null
  global.localStorage = { getItem: () => stored, removeItem: () => { stored = null } }
  try {
    assert.deepEqual(loadInstalledPlugins(), [])
    stored = '["sentinel",1,"cybersec",null]'
    assert.deepEqual(loadInstalledPlugins(), ['cybersec'])
    clearLegacyInstalledPlugins()
    assert.equal(stored, null)
    stored = '{broken'
    assert.deepEqual(loadInstalledPlugins(), [])
    global.localStorage.removeItem = () => { throw new Error('storage unavailable') }
    assert.doesNotThrow(clearLegacyInstalledPlugins)
  } finally { delete global.localStorage }
})

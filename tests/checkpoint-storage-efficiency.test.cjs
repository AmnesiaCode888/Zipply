const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

test('a successful checkpoint returns the written snapshot without reading history twice', () => {
  const file = path.resolve('src/renderer/src/services/chatStorageService.ts')
  const built = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const mod = new Module(file, module); mod.filename = file; mod.paths = module.paths
  mod._compile(built.outputFiles[0].text, file)
  const previousWindow = global.window
  const initial = { id: 'one', title: 'Chat', createdAt: 1, updatedAt: 1, folderPath: 'work', messages: [] }
  let stored = JSON.stringify([initial]), reads = 0, writes = 0, backups = 0
  global.window = { api: {
    storage: {
      get: () => { reads++; return { exists: true, value: stored } },
      set: (_key, value) => { writes++; stored = value; return { ok: true } }
    },
    workspace: { saveSession: () => { backups++; return Promise.resolve({ success: true }) } }
  } }
  try {
    const messages = [{ id: 'm', role: 'assistant', content: 'current', isStreaming: true }]
    const snapshot = mod.exports.checkpointSessionMessages('one', messages)
    assert.equal(reads, 1)
    assert.equal(writes, 1)
    assert.equal(backups, 1)
    assert.equal(snapshot, stored)
    assert.deepEqual(JSON.parse(snapshot)[0].messages, messages)
    stored = JSON.stringify([{ ...initial, messages: [{ id: 'm', role: 'assistant', content: 'newer' }] }])
    assert.equal(mod.exports.isCurrentCheckpoint(snapshot), false)
  } finally { global.window = previousWindow }
})

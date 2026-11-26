const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
function load(file) {
  const code = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' }).outputFiles[0].text
  const mod = new Module(path.resolve(file), module); mod.filename = path.resolve(file); mod.paths = module.paths; mod._compile(code, mod.filename); return mod.exports
}
test('shared storage migrates local history and backups only once', () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), '.zipply-storage-test-'))
  const oldWindow = global.window, oldLocal = global.localStorage
  try {
    const { AppStorage } = load('src/main/services/AppStorage.ts')
    const disk = new AppStorage(root)
    const local = new Map([['zipply_chat_sessions_v1', JSON.stringify([{id:'new',updatedAt:2,messages:[]}])]])
    global.localStorage = { getItem: key => local.get(key) ?? null }
    const backup = {id:'old',updatedAt:1,messages:[{id:'m'}]}
    global.window = { api: { storage: { get: key => disk.get(key), set: (key, value) => {disk.set(key,value); return {ok:true}}, keys: () => ({keys:disk.keys()}) }, workspace: {loadSessions: () => ({sessions:[backup],errors:[]})} } }
    const { appStorage } = load('src/renderer/src/services/appStorage.ts')
    assert.deepEqual(JSON.parse(appStorage.getItem('zipply_chat_sessions_v1')).map(s => s.id), ['new','old'])
    appStorage.setItem('zipply_chat_sessions_v1', '[]')
    assert.equal(appStorage.getItem('zipply_chat_sessions_v1'), '[]')
    appStorage.removeItem('zipply_chat_sessions_v1')
    assert.equal(appStorage.getItem('zipply_chat_sessions_v1'), null)
    assert.throws(() => disk.get('../escape'))
  } finally { global.window = oldWindow; global.localStorage = oldLocal; fs.rmSync(root,{recursive:true,force:true}) }
})


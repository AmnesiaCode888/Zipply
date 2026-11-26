const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function load() {
  const file = path.resolve('src/main/services/AppStorage.ts')
  const code = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text
  const mod = new Module(file, module); mod.filename = file; mod.paths = module.paths; mod._compile(code, file)
  return mod.exports.AppStorage
}

test('a prepared checkpoint cannot commit over a synchronous history update', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zipply-checkpoint-'))
  try {
    const Storage = load(); const storage = new Storage(root); const key = 'zipply_chat_sessions_v1'
    storage.set(key, JSON.stringify([{ id: 'a', messages: [] }]))
    const prepared = await storage.prepareCheckpoint('a', [{ id: 'm', role: 'assistant', content: 'stream' }])
    assert.equal(prepared.status, 'ready')
    const imported = [{ id: 'a', messages: [{ id: 'new', role: 'user', content: 'imported' }] }]
    storage.set(key, JSON.stringify(imported))
    assert.equal(storage.commitCheckpoint(prepared.token).status, 'superseded')
    assert.deepEqual(JSON.parse(storage.get(key).value), imported)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('asynchronous checkpoints preserve updates to different chats in arrival order', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zipply-checkpoint-'))
  try {
    const Storage = load(); const storage = new Storage(root)
    const key = 'zipply_chat_sessions_v1'
    storage.set(key, JSON.stringify([{ id: 'a', messages: [] }, { id: 'b', messages: [] }]))
    const a = [{ id: 'a1', role: 'assistant', content: 'one' }]
    const b = [{ id: 'b1', role: 'assistant', content: 'two' }]
    const firstPending = storage.prepareCheckpoint('a', a), secondPending = storage.prepareCheckpoint('b', b)
    const first = await firstPending; assert.equal(first.status, 'ready'); assert.equal(storage.commitCheckpoint(first.token).status, 'saved')
    const second = await secondPending; assert.equal(second.status, 'ready'); assert.equal(storage.commitCheckpoint(second.token).status, 'saved')
    const saved = JSON.parse(storage.get(key).value)
    assert.deepEqual(saved.find(s => s.id === 'a').messages, a)
    assert.deepEqual(saved.find(s => s.id === 'b').messages, b)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('discarding an obsolete prepared checkpoint releases the next chat', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zipply-checkpoint-'))
  try {
    const Storage = load(); const storage = new Storage(root); const key = 'zipply_chat_sessions_v1'
    storage.set(key, JSON.stringify([{ id: 'a', messages: [] }, { id: 'b', messages: [] }]))
    const first = await storage.prepareCheckpoint('a', [{ id: 'obsolete' }])
    const secondPending = storage.prepareCheckpoint('b', [{ id: 'fresh' }])
    storage.discardCheckpoint(first.token)
    const second = await secondPending
    assert.equal(second.status, 'ready'); assert.equal(storage.commitCheckpoint(second.token).status, 'saved')
    const stored = JSON.parse(storage.get(key).value)
    assert.deepEqual(stored.find(s => s.id === 'a').messages, [])
    assert.deepEqual(stored.find(s => s.id === 'b').messages, [{ id: 'fresh' }])
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('a failed preparation releases the queue for the next checkpoint', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zipply-checkpoint-'))
  try {
    const Storage = load(); const storage = new Storage(root); const key = 'zipply_chat_sessions_v1'
    storage.set(key, 'invalid json')
    await assert.rejects(storage.prepareCheckpoint('a', []))
    storage.set(key, JSON.stringify([{ id: 'a', messages: [] }]))
    const next = await storage.prepareCheckpoint('a', [{ id: 'ok' }])
    assert.equal(next.status, 'ready'); assert.equal(storage.commitCheckpoint(next.token).status, 'saved')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('checkpoint backups are queued before deletion without serializing on the commit call', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zipply-checkpoint-'))
  try {
    const file = path.resolve('src/main/services/SessionStore.ts')
    const code = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text
    const mod = new Module(file, module); mod.filename = file; mod.paths = module.paths; mod._compile(code, file)
    const store = new mod.exports.SessionStore(root); let serialized = false
    const session = { id: 'a', messages: [], toJSON() { serialized = true; return { id: this.id, messages: this.messages } } }
    const saved = store.saveCheckpoint(session)
    assert.equal(serialized, false)
    const deleted = store.remove('a')
    await Promise.all([saved, deleted])
    assert.equal(serialized, true)
    assert.equal(fs.existsSync(path.join(root, 'sessions', 'a.json')), false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('a pending checkpoint cannot overwrite imported or deleted history', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zipply-checkpoint-'))
  try {
    const Storage = load(); const storage = new Storage(root)
    const key = 'zipply_chat_sessions_v1'
    storage.set(key, JSON.stringify([{ id: 'same', messages: [] }]))
    const pending = storage.prepareCheckpoint('same', [{ id: 'old', role: 'assistant', content: 'old' }])
    await Promise.resolve()
    const imported = [{ id: 'same', messages: [{ id: 'new', role: 'user', content: 'imported' }] }]
    storage.set(key, JSON.stringify(imported))
    assert.equal((await pending).status, 'superseded')
    assert.deepEqual(JSON.parse(storage.get(key).value), imported)
    const missing = await storage.prepareCheckpoint('deleted', [])
    assert.equal(missing.status, 'missing')
    assert.deepEqual(JSON.parse(storage.get(key).value), imported)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('a committed asynchronous checkpoint updates the chat state without rereading or rewriting the history', () => {
  const oldLoad = Module._load, oldWindow = global.window, oldStorage = global.localStorage
  const initial = { id: 'a', title: 'A', createdAt: 1, updatedAt: 1, folderPath: 'a', messages: [] }
  const state = []; let reads = 0, writes = 0
  const data = new Map([['zipply_chat_sessions_v1', JSON.stringify([initial])]])
  const react = { useState(value) { const i = state.length; state.push(typeof value === 'function' ? value() : value); return [state[i], update => { state[i] = typeof update === 'function' ? update(state[i]) : update }] }, useRef: value => ({ current: value }), useCallback: fn => fn, useEffect() {} }
  global.localStorage = { getItem: key => { reads++; return data.get(key) ?? null }, setItem: (key, value) => { writes++; data.set(key, value) } }
  global.window = { api: { workspace: { saveSession: () => Promise.resolve({ success: true }) } } }
  try {
    const file = path.resolve('src/renderer/src/hooks/useChatSessions.ts')
    const code = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' }).outputFiles[0].text
    Module._load = function(id, ...args) { return id === 'react' ? react : oldLoad.call(this, id, ...args) }
    const mod = new Module(file, module); mod.filename = file; mod.paths = module.paths; mod._compile(code, file)
    Module._load = oldLoad
    const hook = mod.exports.useChatSessions(); reads = 0; writes = 0
    const messages = [{ id: 'm', role: 'assistant', content: 'live' }]
    hook.updateSessionMessages('a', messages, undefined, { asynchronous: true })
    assert.deepEqual(state.find(Array.isArray)[0].messages, messages)
    assert.equal(reads, 0); assert.equal(writes, 0)
  } finally { Module._load = oldLoad; global.window = oldWindow; global.localStorage = oldStorage }
})

test('an asynchronous checkpoint cannot overwrite an import queued before React applies it', () => {
  const oldLoad = Module._load, oldWindow = global.window, oldStorage = global.localStorage
  const session = { id: 'a', title: 'Old', createdAt: 1, updatedAt: 1, folderPath: 'a', messages: [] }
  const state = [], queued = [], data = new Map([['zipply_chat_sessions_v1', JSON.stringify([session])]])
  const react = { useState(value) { const i = state.length; state.push(typeof value === 'function' ? value() : value); return [state[i], update => queued.push(() => { state[i] = typeof update === 'function' ? update(state[i]) : update })] }, useRef: value => ({ current: value }), useCallback: fn => fn, useEffect() {} }
  global.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
  global.window = { api: { workspace: { saveSession: () => Promise.resolve({ success: true }) } } }
  try {
    const file = path.resolve('src/renderer/src/hooks/useChatSessions.ts')
    const code = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' }).outputFiles[0].text
    Module._load = function(id, ...args) { return id === 'react' ? react : oldLoad.call(this, id, ...args) }
    const mod = new Module(file, module); mod.filename = file; mod.paths = module.paths; mod._compile(code, file); Module._load = oldLoad
    const hook = mod.exports.useChatSessions()
    hook.updateSessionMessages('a', [{ id: 'old', role: 'assistant', content: 'old' }], undefined, { asynchronous: true })
    const imported = { ...session, title: 'Imported', messages: [{ id: 'new', role: 'user', content: 'new' }] }
    assert.equal(hook.importSessions([imported]), true)
    for (const apply of queued) apply()
    assert.deepEqual(state.find(Array.isArray)[0], imported)
    assert.deepEqual(JSON.parse(data.get('zipply_chat_sessions_v1'))[0], imported)
  } finally { Module._load = oldLoad; global.window = oldWindow; global.localStorage = oldStorage }
})

test('a successful async checkpoint also flushes unsaved messages from another chat', () => {
  const oldLoad = Module._load, oldWindow = global.window, oldStorage = global.localStorage
  const sessions = ['a', 'b'].map(id => ({ id, title: id, createdAt: 1, updatedAt: 1, folderPath: id, messages: [] }))
  const state = [], data = new Map([['zipply_chat_sessions_v1', JSON.stringify(sessions)]]); let failing = true
  const react = { useState(value) { const i = state.length; state.push(typeof value === 'function' ? value() : value); return [state[i], update => { state[i] = typeof update === 'function' ? update(state[i]) : update }] }, useRef: value => ({ current: value }), useCallback: fn => fn, useEffect() {} }
  global.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { if (failing) throw Error('quota'); data.set(key, value) } }
  global.window = { api: { workspace: { saveSession: () => Promise.resolve({ success: true }) } } }
  try {
    const file = path.resolve('src/renderer/src/hooks/useChatSessions.ts')
    const code = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' }).outputFiles[0].text
    Module._load = function(id, ...args) { return id === 'react' ? react : oldLoad.call(this, id, ...args) }
    const mod = new Module(file, module); mod.filename = file; mod.paths = module.paths; mod._compile(code, file); Module._load = oldLoad
    const hook = mod.exports.useChatSessions()
    const a = [{ id: 'a1', role: 'assistant', content: 'unsaved' }], b = [{ id: 'b1', role: 'assistant', content: 'saved' }]
    hook.updateSessionMessages('a', a); failing = false
    data.set('zipply_chat_sessions_v1', JSON.stringify([sessions[0], { ...sessions[1], messages: b }]))
    hook.updateSessionMessages('b', b, undefined, { asynchronous: true })
    const stored = JSON.parse(data.get('zipply_chat_sessions_v1'))
    assert.deepEqual(stored.find(s => s.id === 'a').messages, a)
    assert.deepEqual(stored.find(s => s.id === 'b').messages, b)
  } finally { Module._load = oldLoad; global.window = oldWindow; global.localStorage = oldStorage }
})

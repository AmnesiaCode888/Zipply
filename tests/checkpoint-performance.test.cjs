const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

function load(file) {
  const result = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const mod = new Module(path.resolve(file), module)
  mod.filename = path.resolve(file); mod.paths = module.paths
  mod._compile(result.outputFiles[0].text, mod.filename)
  return mod.exports
}

test('a persisted streaming checkpoint updates React state without a second history and backup write', () => {
  const oldLoad = Module._load, oldWindow = global.window, oldStorage = global.localStorage
  const session = { id: 's', title: 'Chat', createdAt: 1, updatedAt: 1, folderPath: 'work', messages: [] }
  const data = new Map([['zipply_chat_sessions_v1', JSON.stringify([session])]])
  let writes = 0, backups = 0
  const states = []
  const react = { useState(initial) { const i = states.length; states.push(typeof initial === 'function' ? initial() : initial); return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value }] }, useRef: value => ({ current: value }), useCallback: fn => fn, useEffect() {} }
  global.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { writes++; data.set(key, value) } }
  global.window = { api: { workspace: { saveSession: () => { backups++; return Promise.resolve({ success: true }) } } } }
  try {
    const storage = load('src/renderer/src/services/chatStorageService.ts')
    Module._load = function (id, ...args) { return id === 'react' ? react : oldLoad.call(this, id, ...args) }
    const { useChatSessions } = load('src/renderer/src/hooks/useChatSessions.ts'); Module._load = oldLoad
    const sessions = useChatSessions()
    const messages = [{ id: 'm', role: 'assistant', content: 'Partial', isStreaming: true }]
    const persisted = storage.checkpointSessionMessages('s', messages)
    sessions.updateSessionMessages('s', messages, undefined, persisted)
    assert.equal(writes, 1)
    assert.equal(backups, 1)
    assert.deepEqual(states[0][0].messages, messages)
    assert.deepEqual(JSON.parse(data.get('zipply_chat_sessions_v1'))[0].messages, messages)
  } finally { Module._load = oldLoad; global.window = oldWindow; global.localStorage = oldStorage }
})

test('startup creates the saved default workspace path for sessions that already have folderPath', async () => {
  const oldLoad = Module._load, oldWindow = global.window, oldStorage = global.localStorage
  const folderPath = 'C:/Users/test/Zipply/workspaces/chat-new'
  const session = { id: 'chat-new', title: 'New chat', createdAt: 1, updatedAt: 1, folderPath, messages: [] }
  const data = new Map([['zipply_chat_sessions_v1', JSON.stringify([session])]])
  const effects = [], created = []
  const react = {
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: value => ({ current: value }),
    useCallback: callback => callback,
    useEffect: effect => effects.push(effect)
  }
  global.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
  global.window = { api: { workspace: {
    create: (id, title, customPath) => { created.push({ id, title, customPath }); return Promise.resolve({ success: true, folderPath: customPath }) },
    saveSession: () => Promise.resolve({ success: true })
  } } }
  try {
    Module._load = function (id, ...args) { return id === 'react' ? react : oldLoad.call(this, id, ...args) }
    load('src/renderer/src/hooks/useChatSessions.ts').useChatSessions()
    Module._load = oldLoad
    const cleanups = effects.map(effect => effect()).filter(Boolean)
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(created.some(item => item.id === session.id && item.customPath === folderPath))
    cleanups.forEach(cleanup => cleanup())
  } finally { Module._load = oldLoad; global.window = oldWindow; global.localStorage = oldStorage }
})

test('a queued rename cannot overwrite a newer checkpoint', () => {
  const oldLoad = Module._load, oldWindow = global.window, oldStorage = global.localStorage
  const session = { id: 's', title: 'Old', createdAt: 1, updatedAt: 1, folderPath: 'work', messages: [] }
  const data = new Map([['zipply_chat_sessions_v1', JSON.stringify([session])]])
  const state = [], queued = []
  const react = { useState(initial) { const i = state.length; state.push(typeof initial === 'function' ? initial() : initial); return [state[i], value => queued.push(() => { state[i] = typeof value === 'function' ? value(state[i]) : value })] }, useRef: value => ({ current: value }), useCallback: fn => fn, useEffect() {} }
  global.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
  global.window = { api: { workspace: { saveSession: () => Promise.resolve({ success: true }) } } }
  try {
    const storage = load('src/renderer/src/services/chatStorageService.ts')
    Module._load = function (id, ...args) { return id === 'react' ? react : oldLoad.call(this, id, ...args) }
    const { useChatSessions } = load('src/renderer/src/hooks/useChatSessions.ts'); Module._load = oldLoad
    const sessions = useChatSessions()
    sessions.renameChat('s', 'Renamed')
    const messages = [{ id: 'm', role: 'assistant', content: 'checkpoint' }]
    const persisted = storage.checkpointSessionMessages('s', messages)
    sessions.updateSessionMessages('s', messages, undefined, persisted)
    for (const update of queued) update()
    const stored = JSON.parse(data.get('zipply_chat_sessions_v1'))[0]
    assert.equal(stored.title, 'Renamed')
    assert.deepEqual(stored.messages, messages)
  } finally { Module._load = oldLoad; global.window = oldWindow; global.localStorage = oldStorage }
})

test('a checkpoint still attempts a backup when local history is full', () => {
  const oldWindow = global.window, oldStorage = global.localStorage
  const session = { id: 's', title: 'Chat', createdAt: 1, updatedAt: 1, folderPath: 'work', messages: [] }
  const backup = []
  global.localStorage = { getItem: () => JSON.stringify([session]), setItem: () => { throw new Error('quota') } }
  global.window = { api: { workspace: { saveSession: value => { backup.push(value); return Promise.resolve({ success: true }) } } } }
  try {
    const storage = load('src/renderer/src/services/chatStorageService.ts')
    const messages = [{ id: 'm', role: 'assistant', content: 'recover me' }]
    assert.equal(storage.checkpointSessionMessages('s', messages), null)
    assert.deepEqual(backup[0].messages, messages)
  } finally { global.window = oldWindow; global.localStorage = oldStorage }
})

test('processing the first of two deferred chat checkpoints never overwrites the other chat', () => {
  const oldLoad = Module._load, oldWindow = global.window, oldStorage = global.localStorage
  const sessions = ['a', 'b'].map(id => ({ id, title: id, createdAt: 1, updatedAt: 1, folderPath: id, messages: [] }))
  const data = new Map([['zipply_chat_sessions_v1', JSON.stringify(sessions)]]); const state = [], queued = []
  const react = { useState(initial) { const i = state.length; state.push(typeof initial === 'function' ? initial() : initial); return [state[i], value => queued.push(() => { state[i] = typeof value === 'function' ? value(state[i]) : value })] }, useRef: value => ({ current: value }), useCallback: fn => fn, useEffect() {} }
  global.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
  global.window = { api: { workspace: { saveSession: () => Promise.resolve({ success: true }) } } }
  try {
    const storage = load('src/renderer/src/services/chatStorageService.ts')
    Module._load = function (id, ...args) { return id === 'react' ? react : oldLoad.call(this, id, ...args) }
    const hook = load('src/renderer/src/hooks/useChatSessions.ts').useChatSessions(); Module._load = oldLoad
    const a = [{ id: 'a1', role: 'assistant', content: 'A live' }]; const b = [{ id: 'b1', role: 'assistant', content: 'B live' }]
    const checkpointA = storage.checkpointSessionMessages('a', a); hook.updateSessionMessages('a', a, undefined, checkpointA)
    const checkpointB = storage.checkpointSessionMessages('b', b); hook.updateSessionMessages('b', b, undefined, checkpointB)
    queued.shift()()
    const stored = JSON.parse(data.get('zipply_chat_sessions_v1'))
    assert.deepEqual(stored.find(s => s.id === 'a').messages, a); assert.deepEqual(stored.find(s => s.id === 'b').messages, b)
  } finally { Module._load = oldLoad; global.window = oldWindow; global.localStorage = oldStorage }
})

test('an older deferred checkpoint does not roll back a newer checkpoint in the same chat', () => {
  const oldLoad = Module._load, oldWindow = global.window, oldStorage = global.localStorage
  const session = { id: 'a', title: 'A', createdAt: 1, updatedAt: 1, folderPath: 'a', messages: [] }; const data = new Map([['zipply_chat_sessions_v1', JSON.stringify([session])]]); const state = [], queued = []
  const react = { useState(initial) { const i = state.length; state.push(typeof initial === 'function' ? initial() : initial); return [state[i], value => queued.push(() => { state[i] = typeof value === 'function' ? value(state[i]) : value })] }, useRef: value => ({ current: value }), useCallback: fn => fn, useEffect() {} }
  global.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
  global.window = { api: { workspace: { saveSession: () => Promise.resolve({ success: true }) } } }
  try {
    const storage = load('src/renderer/src/services/chatStorageService.ts')
    Module._load = function (id, ...args) { return id === 'react' ? react : oldLoad.call(this, id, ...args) }
    const hook = load('src/renderer/src/hooks/useChatSessions.ts').useChatSessions(); Module._load = oldLoad
    const first = [{ id: 'm', role: 'assistant', content: 'first' }]; const second = [{ id: 'm', role: 'assistant', content: 'second' }]
    const one = storage.checkpointSessionMessages('a', first); hook.updateSessionMessages('a', first, undefined, one)
    const two = storage.checkpointSessionMessages('a', second); hook.updateSessionMessages('a', second, undefined, two)
    queued.shift()(); assert.deepEqual(JSON.parse(data.get('zipply_chat_sessions_v1'))[0].messages, second)
  } finally { Module._load = oldLoad; global.window = oldWindow; global.localStorage = oldStorage }
})

test('an unsaved live message survives a later rename when storage recovers', () => {
  const oldLoad = Module._load, oldWindow = global.window, oldStorage = global.localStorage
  const session = { id: 'a', title: 'A', createdAt: 1, updatedAt: 1, folderPath: 'a', messages: [] }; const data = new Map([['zipply_chat_sessions_v1', JSON.stringify([session])]]); const state = []; let failing = true
  const react = { useState(initial) { const i = state.length; state.push(typeof initial === 'function' ? initial() : initial); return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value }] }, useRef: value => ({ current: value }), useCallback: fn => fn, useEffect() {} }
  global.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { if (failing) throw Error('quota'); data.set(key, value) } }
  global.window = { api: { workspace: { saveSession: () => Promise.resolve({ success: true }) } } }
  try {
    Module._load = function (id, ...args) { return id === 'react' ? react : oldLoad.call(this, id, ...args) }
    const hook = load('src/renderer/src/hooks/useChatSessions.ts').useChatSessions(); Module._load = oldLoad
    const messages = [{ id: 'm', role: 'assistant', content: 'still in memory' }]
    hook.updateSessionMessages('a', messages); failing = false; hook.renameChat('a', 'Renamed')
    assert.deepEqual(JSON.parse(data.get('zipply_chat_sessions_v1'))[0].messages, messages)
  } finally { Module._load = oldLoad; global.window = oldWindow; global.localStorage = oldStorage }
})

test('a successful checkpoint in another chat also saves messages pending from a quota failure', () => {
  const oldLoad = Module._load, oldWindow = global.window, oldStorage = global.localStorage
  const sessions = ['a', 'b'].map(id => ({ id, title: id, createdAt: 1, updatedAt: 1, folderPath: id, messages: [] })); const data = new Map([['zipply_chat_sessions_v1', JSON.stringify(sessions)]]); const state = []; const backup = []; let failing = true
  const react = { useState(initial) { const i = state.length; state.push(typeof initial === 'function' ? initial() : initial); return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value }] }, useRef: value => ({ current: value }), useCallback: fn => fn, useEffect() {} }
  global.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { if (failing) throw Error('quota'); data.set(key, value) } }
  global.window = { api: { workspace: { saveSession: value => { backup.push(value); return Promise.resolve({ success: true }) } } } }
  try {
    const storage = load('src/renderer/src/services/chatStorageService.ts')
    Module._load = function (id, ...args) { return id === 'react' ? react : oldLoad.call(this, id, ...args) }
    const hook = load('src/renderer/src/hooks/useChatSessions.ts').useChatSessions(); Module._load = oldLoad
    const a = [{ id: 'a1', role: 'assistant', content: 'A pending' }]; const b = [{ id: 'b1', role: 'assistant', content: 'B saved' }]
    hook.updateSessionMessages('a', a); failing = false
    const checkpoint = storage.checkpointSessionMessages('b', b); hook.updateSessionMessages('b', b, undefined, checkpoint)
    const stored = JSON.parse(data.get('zipply_chat_sessions_v1'))
    assert.deepEqual(stored.find(s => s.id === 'a').messages, a); assert.deepEqual(stored.find(s => s.id === 'b').messages, b)
    assert.deepEqual(backup.filter(s => s.id === 'a').at(-1).messages, a)
  } finally { Module._load = oldLoad; global.window = oldWindow; global.localStorage = oldStorage }
})

test('deletion signals the running chat only after successful storage and before backup removal', () => {
  const oldLoad = Module._load, oldWindow = global.window, oldStorage = global.localStorage
  const sessions = ['a', 'b'].map(id => ({ id, title: id, createdAt: 1, updatedAt: 1, folderPath: id, messages: [] })); const data = new Map([['zipply_chat_sessions_v1', JSON.stringify(sessions)]]); const state = []; const actions = []; let failing = true
  const react = { useState(initial) { const i = state.length; state.push(typeof initial === 'function' ? initial() : initial); return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value }] }, useRef: value => ({ current: value }), useCallback: fn => fn, useEffect() {} }
  global.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { if (failing) throw Error('quota'); data.set(key, value); actions.push('saved') } }
  global.window = { api: { workspace: { deleteSession: () => { actions.push('backup'); return Promise.resolve({ success: true }) } } } }
  try {
    Module._load = function (id, ...args) { return id === 'react' ? react : oldLoad.call(this, id, ...args) }
    const hook = load('src/renderer/src/hooks/useChatSessions.ts').useChatSessions(); Module._load = oldLoad
    hook.deleteChat('a', () => actions.push('cancel')); assert.deepEqual(actions, []); assert.equal(JSON.parse(data.get('zipply_chat_sessions_v1')).length, 2)
    failing = false; hook.deleteChat('a', () => actions.push('cancel')); assert.deepEqual(actions, ['saved', 'cancel', 'backup']); assert.deepEqual(JSON.parse(data.get('zipply_chat_sessions_v1')).map(s => s.id), ['b'])
  } finally { Module._load = oldLoad; global.window = oldWindow; global.localStorage = oldStorage }
})

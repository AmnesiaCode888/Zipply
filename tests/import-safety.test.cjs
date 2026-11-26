const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

function load(file) {
  const result = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const mod = new Module(path.resolve(file), module)
  mod.filename = path.resolve(file)
  mod.paths = module.paths
  mod._compile(result.outputFiles[0].text, mod.filename)
  return mod.exports
}

const session = (messages = []) => ({ id: 'chat-1', title: 'Chat', createdAt: 1, updatedAt: 2, folderPath: 'test-workspace', messages })
const message = (extra = {}) => ({ id: 'm-1', role: 'assistant', content: 'Hello', ...extra })

async function readImport(value) {
  const previous = global.FileReader
  global.FileReader = class { readAsText(file) { this.onload({ target: { result: JSON.stringify(file) } }) } }
  try { return await load('src/renderer/src/services/settingsService.ts').importChatsFromJson(value) }
  finally { global.FileReader = previous }
}

test('import rejects invalid nested messages and preserves valid tool and history records', async () => {
  const valid = session([message({
    blocks: [{ type: 'text', id: 'b-1', content: 'Reply' }, { type: 'tool', id: 'b-2', tool: { id: 't-1', type: 'file_read', label: 'Read', status: 'completed' } }],
    agentHistory: [{ role: 'assistant', content: null, tool_calls: [{ id: 't-1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] }, { role: 'tool', content: 'ok', tool_call_id: 't-1' }]
  })])
  assert.deepEqual(await readImport([valid]), [valid])
  for (const bad of [null, {}, message({ role: 'unexpected' }), message({ content: {} }), message({ blocks: [null] }), message({ blocks: [{ type: 'tool', id: 'b', tool: null }] }), message({ tools: [{ id: 't', type: 'file_read', label: 1 }] }), message({ agentHistory: [null] })]) {
    await assert.rejects(readImport([session([bad])]), /формат|идентификатор/i)
  }
})

test('import rejects duplicate session, message, and block IDs', async () => {
  await assert.rejects(readImport([session(), session()]), /формат|идентификатор/i)
  await assert.rejects(readImport([session([message(), message()])]), /формат|идентификатор/i)
  await assert.rejects(readImport([session([message({ blocks: [{ type: 'text', id: 'b', content: 'a' }, { type: 'text', id: 'b', content: 'b' }] })])]), /формат|идентификатор/i)
  await assert.rejects(readImport([session([message({ tools: [{ id: 't', type: 'search', label: 'Search' }, { id: 't', type: 'search', label: 'Search' }] })])]), /формат|идентификатор/i)
})

test('successful import updates history and reports success', () => {
  const previousWindow = global.window, previousStorage = global.localStorage, previousLoad = Module._load
  const old = session([message()])
  const imported = { ...session([message({ content: 'Imported' })]), id: 'chat-2' }
  const data = new Map([['zipply_chat_sessions_v1', JSON.stringify([old])]])
  const states = []
  const react = { useState: initial => { const i = states.length; states.push(typeof initial === 'function' ? initial() : initial); return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value }] }, useRef: value => ({ current: value }), useCallback: value => value, useEffect: () => {} }
  global.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
  global.window = { api: {} }
  try {
    Module._load = function (id, ...args) { return id === 'react' ? react : previousLoad.call(this, id, ...args) }
    const { useChatSessions } = load('src/renderer/src/hooks/useChatSessions.ts')
    Module._load = previousLoad
    assert.equal(useChatSessions().importSessions([imported]), true)
    assert.deepEqual(JSON.parse(data.get('zipply_chat_sessions_v1')), [imported])
    assert.equal(states[0][0].messages[0].content, 'Imported')
    assert.equal(states[1], 'chat-2')
  } finally { Module._load = previousLoad; global.window = previousWindow; global.localStorage = previousStorage }
})

test('failed import storage write preserves existing history and its backup', () => {
  const previousWindow = global.window, previousStorage = global.localStorage, previousLoad = Module._load
  const old = session([message()])
  const data = new Map([['zipply_chat_sessions_v1', JSON.stringify([old])]])
  const deleted = []
  const states = []
  const react = { useState: initial => { const i = states.length; states.push(typeof initial === 'function' ? initial() : initial); return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value }] }, useRef: value => ({ current: value }), useCallback: value => value, useEffect: () => {} }
  global.localStorage = { getItem: key => data.get(key) ?? null, setItem: () => { throw new Error('quota') } }
  global.window = { api: { workspace: { deleteSession: id => { deleted.push(id); return Promise.resolve({ success: true }) } } } }
  try {
    Module._load = function (id, ...args) { return id === 'react' ? react : previousLoad.call(this, id, ...args) }
    const { useChatSessions } = load('src/renderer/src/hooks/useChatSessions.ts')
    Module._load = previousLoad
    assert.equal(useChatSessions().importSessions([{ ...session(), id: 'chat-2' }]), false)
    assert.deepEqual(JSON.parse(data.get('zipply_chat_sessions_v1')), [old])
    assert.deepEqual(deleted, [])
    assert.equal(states[0][0].id, 'chat-1')
  } finally { Module._load = previousLoad; global.window = previousWindow; global.localStorage = previousStorage }
})

test('failed import does not rewrite the active streaming history while reading old IDs', () => {
  const previousWindow = global.window, previousStorage = global.localStorage, previousLoad = Module._load
  const old = session([message()])
  const data = new Map([['zipply_chat_sessions_v1', JSON.stringify([old])]])
  const states = []
  const react = { useState: initial => { const i = states.length; states.push(typeof initial === 'function' ? initial() : initial); return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value }] }, useRef: value => ({ current: value }), useCallback: value => value, useEffect: () => {} }
  global.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { if (value.includes('"id":"imported"')) throw new Error('quota'); data.set(key, value) } }
  global.window = { api: {} }
  try {
    Module._load = function (id, ...args) { return id === 'react' ? react : previousLoad.call(this, id, ...args) }
    const { useChatSessions } = load('src/renderer/src/hooks/useChatSessions.ts'); Module._load = previousLoad
    const hook = useChatSessions()
    const streaming = [session([message({ isStreaming: true })])]
    data.set('zipply_chat_sessions_v1', JSON.stringify(streaming))
    assert.equal(hook.importSessions([{ ...session(), id: 'imported' }]), false)
    assert.deepEqual(JSON.parse(data.get('zipply_chat_sessions_v1')), streaming)
  } finally { Module._load = previousLoad; global.window = previousWindow; global.localStorage = previousStorage }
})

test('an imported interrupted stream is finished without losing its content', () => {
  const previousWindow = global.window, previousStorage = global.localStorage, previousLoad = Module._load
  const data = new Map([['zipply_chat_sessions_v1', JSON.stringify([session()])]])
  const states = []
  const react = { useState: initial => { const i = states.length; states.push(typeof initial === 'function' ? initial() : initial); return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value }] }, useRef: value => ({ current: value }), useCallback: value => value, useEffect: () => {} }
  global.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
  global.window = { api: {} }
  try {
    Module._load = function (id, ...args) { return id === 'react' ? react : previousLoad.call(this, id, ...args) }
    const { useChatSessions } = load('src/renderer/src/hooks/useChatSessions.ts'); Module._load = previousLoad
    const imported = session([message({ isStreaming: true, blocks: [{ type: 'text', id: 'b', content: 'partial', isStreaming: true }, { type: 'tool', id: 't', tool: { id: 't', type: 'file_read', label: 'Read', status: 'running' } }] })])
    assert.equal(useChatSessions().importSessions([imported]), true)
    const restored = JSON.parse(data.get('zipply_chat_sessions_v1'))[0].messages[0]
    assert.equal(restored.isStreaming, false)
    assert.equal(restored.blocks[0].content, 'partial')
    assert.equal(restored.blocks[0].isStreaming, false)
    assert.equal(restored.blocks[1].tool.status, 'error')
    assert.equal(states[0][0].messages[0].isStreaming, false)
  } finally { Module._load = previousLoad; global.window = previousWindow; global.localStorage = previousStorage }
})

test('imported sessions without a workspace path are still backed up', async () => {
  const previousWindow = global.window, previousStorage = global.localStorage, previousLoad = Module._load
  const data = new Map([['zipply_chat_sessions_v1', JSON.stringify([session()])]])
  const saved = [], states = []
  const react = { useState: initial => { const i = states.length; states.push(typeof initial === 'function' ? initial() : initial); return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value }] }, useRef: value => ({ current: value }), useCallback: value => value, useEffect: () => {} }
  global.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
  global.window = { api: { workspace: { saveSession: value => { saved.push(value); return Promise.resolve({ success: true }) }, deleteSession: () => Promise.resolve({ success: true }) } } }
  try {
    Module._load = function (id, ...args) { return id === 'react' ? react : previousLoad.call(this, id, ...args) }
    const { useChatSessions } = load('src/renderer/src/hooks/useChatSessions.ts'); Module._load = previousLoad
    const imported = { ...session([message()]), id: 'imported' }; delete imported.folderPath
    assert.equal(useChatSessions().importSessions([imported]), true)
    assert.equal(saved.length, 1)
    assert.equal(saved[0].id, 'imported')
    await new Promise(resolve => setImmediate(resolve))
  } finally { Module._load = previousLoad; global.window = previousWindow; global.localStorage = previousStorage }
})

test('a queued streaming update cannot overwrite a successful import with the same ID', () => {
  const previousWindow = global.window, previousStorage = global.localStorage, previousLoad = Module._load
  const data = new Map([['zipply_chat_sessions_v1', JSON.stringify([session([message()])])]])
  const state = [], queued = []
  const react = { useState(initial) { const i = state.length; state.push(typeof initial === 'function' ? initial() : initial); return [state[i], value => queued.push(() => { state[i] = typeof value === 'function' ? value(state[i]) : value })] }, useRef: value => ({ current: value }), useCallback: fn => fn, useEffect() {} }
  global.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
  global.window = { api: { workspace: { saveSession: () => Promise.resolve({ success: true }) } } }
  try {
    Module._load = function (id, ...args) { return id === 'react' ? react : previousLoad.call(this, id, ...args) }
    const { useChatSessions } = load('src/renderer/src/hooks/useChatSessions.ts'); Module._load = previousLoad
    const hook = useChatSessions()
    hook.updateSessionMessages('chat-1', [message({ content: 'old stream' })])
    const imported = session([message({ content: 'imported' })])
    assert.equal(hook.importSessions([imported]), true)
    for (const update of queued) update()
    assert.equal(JSON.parse(data.get('zipply_chat_sessions_v1'))[0].messages[0].content, 'imported')
    assert.equal(state[0][0].messages[0].content, 'imported')
  } finally { Module._load = previousLoad; global.window = previousWindow; global.localStorage = previousStorage }
})

test('failed history clearing leaves the active stream untouched', () => {
  const previousWindow = global.window, previousStorage = global.localStorage, previousLoad = Module._load
  const data = new Map([['zipply_chat_sessions_v1', JSON.stringify([session()])]])
  const states = []
  const react = { useState: initial => { const i = states.length; states.push(typeof initial === 'function' ? initial() : initial); return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value }] }, useRef: value => ({ current: value }), useCallback: value => value, useEffect: () => {} }
  global.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { if (value.includes('Новый чат')) throw new Error('quota'); data.set(key, value) } }
  global.window = { api: {} }
  try {
    Module._load = function (id, ...args) { return id === 'react' ? react : previousLoad.call(this, id, ...args) }
    const { useChatSessions } = load('src/renderer/src/hooks/useChatSessions.ts'); Module._load = previousLoad
    const hook = useChatSessions()
    const streaming = [session([message({ isStreaming: true })])]
    data.set('zipply_chat_sessions_v1', JSON.stringify(streaming))
    hook.clearAllChats()
    assert.deepEqual(JSON.parse(data.get('zipply_chat_sessions_v1')), streaming)
  } finally { Module._load = previousLoad; global.window = previousWindow; global.localStorage = previousStorage }
})

test('import keeps old backups when writing the imported backup fails', async () => {
  const previousWindow = global.window, previousStorage = global.localStorage, previousLoad = Module._load
  const data = new Map([['zipply_chat_sessions_v1', JSON.stringify([session()])]])
  const states = [], deleted = []
  const react = { useState: initial => { const i = states.length; states.push(typeof initial === 'function' ? initial() : initial); return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value }] }, useRef: value => ({ current: value }), useCallback: value => value, useEffect: () => {} }
  global.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
  global.window = { api: { workspace: { saveSession: () => Promise.resolve({ success: false }), deleteSession: id => { deleted.push(id); return Promise.resolve({ success: true }) } } } }
  try {
    Module._load = function (id, ...args) { return id === 'react' ? react : previousLoad.call(this, id, ...args) }
    const { useChatSessions } = load('src/renderer/src/hooks/useChatSessions.ts'); Module._load = previousLoad
    assert.equal(useChatSessions().importSessions([{ ...session(), id: 'new-chat' }]), true)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(deleted, [])
  } finally { Module._load = previousLoad; global.window = previousWindow; global.localStorage = previousStorage }
})

test('import deletes old backups only after the new backups succeed', async () => {
  const previousWindow = global.window, previousStorage = global.localStorage, previousLoad = Module._load
  const data = new Map([['zipply_chat_sessions_v1', JSON.stringify([session()])]])
  const states = [], deleted = []; let finish
  const react = { useState: initial => { const i = states.length; states.push(typeof initial === 'function' ? initial() : initial); return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value }] }, useRef: value => ({ current: value }), useCallback: value => value, useEffect: () => {} }
  global.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
  global.window = { api: { workspace: { saveSession: () => new Promise(resolve => { finish = resolve }), deleteSession: id => { deleted.push(id); return Promise.resolve({ success: true }) } } } }
  try {
    Module._load = function (id, ...args) { return id === 'react' ? react : previousLoad.call(this, id, ...args) }
    const { useChatSessions } = load('src/renderer/src/hooks/useChatSessions.ts'); Module._load = previousLoad
    assert.equal(useChatSessions().importSessions([{ ...session(), id: 'new-chat' }]), true)
    assert.deepEqual(deleted, [])
    finish({ success: true })
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(deleted, ['chat-1'])
  } finally { Module._load = previousLoad; global.window = previousWindow; global.localStorage = previousStorage }
})

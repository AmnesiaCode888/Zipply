const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

test('stream checkpoints use async IPC, and late checkpoint responses cannot overwrite terminal state', async () => {
  const old = { load: Module._load, window: global.window, storage: global.localStorage, raf: global.requestAnimationFrame, cancel: global.cancelAnimationFrame, timeout: global.setTimeout, clear: global.clearTimeout }
  const session = { id: 'a', title: 'Chat', folderPath: 'a', messages: [], createdAt: 1, updatedAt: 1 }
  const other = { id: 'b', title: 'Other', folderPath: 'b', messages: [], createdAt: 1, updatedAt: 1 }
  const data = new Map([['zipply_chat_sessions_v1', JSON.stringify([session, other])], ['zipply_app_settings_v1', JSON.stringify({ apiKey: 'test' })]])
  let listener, requestId, frame, timer, finishCheckpoint, reads = 0, writes = 0; const updates = []; const sent = [], committed = [], discarded = []
  const react = { useState: value => [value, () => {}], useRef: value => ({ current: value }), useCallback: fn => fn, useEffect: fn => { fn() } }
  global.setTimeout = fn => { timer = fn; return 1 }; global.clearTimeout = () => {}
  global.requestAnimationFrame = fn => { frame = fn; return 1 }; global.cancelAnimationFrame = () => { frame = null }
  global.window = { addEventListener() {}, removeEventListener() {}, api: {
    storage: { get: key => { reads++; return { exists: data.has(key), value: data.get(key) ?? null } }, set: (key, value) => { writes++; data.set(key, value); return { ok: true } }, prepareCheckpoint: (id, messages) => { sent.push({ id, messages }); return new Promise(resolve => { finishCheckpoint = resolve }) }, commitCheckpoint: token => { committed.push(token); return { status: 'saved' } }, discardCheckpoint: token => discarded.push(token) },
    workspace: { saveSession: () => Promise.resolve({ success: true }) },
    agent: { onEvent: fn => { listener = fn; return () => {} }, chat: (_history, _settings, id) => { requestId = id }, cancel() {} }
  } }
  try {
    const file = path.resolve('src/renderer/src/hooks/useChat.ts')
    const code = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' }).outputFiles[0].text
    Module._load = function(id, ...args) { return id === 'react' ? react : old.load.call(this, id, ...args) }
    const mod = new Module(file, module); mod.filename = file; mod.paths = module.paths; mod._compile(code, file); Module._load = old.load
    const hook = mod.exports.useChat({ activeSession: session, sessions: [session, other], onUpdateSessionMessages: (...args) => updates.push(args) })
    hook.sendMessage('hello'); assert.ok(requestId)
    const requestA = requestId
    listener({ type: 'token', requestId: requestA, content: 'live' }); frame(); reads = 0; writes = 0
    timer(); assert.equal(sent.length, 1); assert.equal(reads, 0); assert.equal(writes, 0)
    listener({ type: 'token', requestId: requestA, content: ' buffered' }); frame(); timer()
    assert.equal(sent.length, 1, 'only one checkpoint per chat is in flight')
    finishCheckpoint({ status: 'ready', token: 'first' }); await Promise.resolve(); await Promise.resolve()
    assert.deepEqual(committed, ['first']); assert.deepEqual(updates.at(-1)[3], { asynchronous: true })
    assert.equal(sent.length, 2); assert.match(JSON.stringify(sent[1].messages), /buffered/)
    hook.sendMessageForSession(other, 'other message')
    finishCheckpoint({ status: 'ready', token: 'stale' }); await Promise.resolve(); await Promise.resolve()
    assert.deepEqual(committed, ['first']); assert.deepEqual(discarded, ['stale'])
    assert.match(data.get('zipply_chat_sessions_v1'), /other message/)
    assert.match(data.get('zipply_chat_sessions_v1'), /live/)
    listener({ type: 'token', requestId: requestA, content: ' final' }); frame(); timer(); assert.equal(sent.length, 3)
    listener({ type: 'done', requestId: requestA }); const afterTerminal = updates.length
    finishCheckpoint({ status: 'ready', token: 'late' }); await Promise.resolve(); await Promise.resolve()
    assert.equal(updates.length, afterTerminal)
    assert.deepEqual(discarded, ['stale', 'late'])
    assert.match(JSON.stringify(data.get('zipply_chat_sessions_v1')), /live/)
  } finally { Module._load = old.load; global.window = old.window; global.localStorage = old.storage; global.requestAnimationFrame = old.raf; global.cancelAnimationFrame = old.cancel; global.setTimeout = old.timeout; global.clearTimeout = old.clear }
})

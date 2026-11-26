const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

function load(file) {
  const result = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const mod = new Module(path.resolve(file), module); mod.filename = path.resolve(file); mod.paths = module.paths
  mod._compile(result.outputFiles[0].text, mod.filename); return mod.exports
}

function harness() {
  const original = { load: Module._load, window: global.window, storage: global.localStorage, raf: global.requestAnimationFrame, cancel: global.cancelAnimationFrame }
  const slots = []; let cursor = 0; let effects = []; let listener; let frame = null; const cancelled = []; const approvals = []; const sent = []; const configs = []; const updates = []
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i] },
    useCallback(fn) { cursor++; return fn },
    useEffect(fn, deps) { const i = cursor++; const prev = slots[i]; if (!prev || deps.some((v, j) => v !== prev.deps[j])) effects.push(() => { prev?.cleanup?.(); slots[i] = { deps, cleanup: fn() } }) }
  }
  const storage = new Map([['zipply_app_settings_v1', JSON.stringify({ apiKey: 'test' })]])
  global.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) }
  global.requestAnimationFrame = callback => { frame = callback; return 1 }; global.cancelAnimationFrame = () => { frame = null }
  global.window = { addEventListener() {}, removeEventListener() {}, api: { agent: {
    onEvent(fn) { listener = fn; return () => {} }, chat(_h, config, id) { sent.push(id); configs.push(config) }, cancel(id) { cancelled.push(id) }, approve(...args) { approvals.push(args) }, generateTitle: async () => null
  } } }
  Module._load = function (id, ...args) { return id === 'react' ? react : original.load.call(this, id, ...args) }
  const { useChat } = load('src/renderer/src/hooks/useChat.ts'); Module._load = original.load
  const update = (...args) => updates.push(args)
  return {
    render(activeSession, sessions, historyRevision = 0) { cursor = 0; effects = []; const hook = useChat({ activeSession, sessions, onUpdateSessionMessages: update, historyRevision }); for (const effect of effects) effect(); return hook },
    emit(event) { listener(event) }, flush() { const callback = frame; frame = null; callback?.() }, sent, configs, cancelled, approvals, updates,
    cleanup() { for (const slot of slots) slot?.cleanup?.(); Module._load = original.load; global.window = original.window; global.localStorage = original.storage; global.requestAnimationFrame = original.raf; global.cancelAnimationFrame = original.cancel }
  }
}

test('retry preserves plan mode for an interrupted request', () => {
  const h = harness(); const session = { id: 'plan', title: 'Plan', messages: [] }
  try {
    let hook = h.render(session, [session]); hook.sendMessage('Plan this', true)
    h.emit({ type: 'error', requestId: h.sent[0], message: 'interrupted' })
    hook = h.render(session, [session]); hook.retry()
    assert.equal(h.configs.at(-1).planMode, true)
    assert.equal(h.updates.at(-1)[1][0].planMode, true)
  } finally { h.cleanup() }
})

test('retry preserves plan mode from restored chat history', () => {
  const h = harness(); const session = { id: 'restored', title: 'Plan', messages: [
    { id: 'u', role: 'user', content: 'Plan this', planMode: true },
    { id: 'a', role: 'assistant', blocks: [{ type: 'text', id: 'err-1', content: '⚠️ interrupted' }] }
  ] }
  try {
    const hook = h.render(session, [session]); hook.retry()
    assert.equal(h.configs.at(-1).planMode, true)
  } finally { h.cleanup() }
})

test('switching chats keeps both requests and routes background events and approval to their own chats', () => {
  const h = harness(); const a = { id: 'a', title: 'A', messages: [] }; const b = { id: 'b', title: 'B', messages: [] }; const sessions = [a, b]
  try {
    let hook = h.render(a, sessions); hook.sendMessage('first'); const first = h.sent[0]
    hook = h.render(b, sessions); hook.sendMessage('second'); const second = h.sent[1]
    assert.deepEqual(h.cancelled, []); assert.ok(first && second && first !== second)
    h.emit({ type: 'token', requestId: first, content: 'background A' }); h.emit({ type: 'token', requestId: second, content: 'foreground B' }); h.flush()
    h.emit({ type: 'approval_request', requestId: first, approvalId: 'approval-a', command: 'test' })
    hook = h.render(b, sessions); assert.equal(hook.approval, null); assert.deepEqual(hook.approvalChatIds, ['a']); assert.match(JSON.stringify(hook.messages), /foreground B/)
    hook = h.render(a, sessions); assert.match(JSON.stringify(hook.messages), /background A/); assert.equal(hook.approval.approvalId, 'approval-a'); hook.respondToApproval(true)
    assert.deepEqual(h.approvals, [[first, 'approval-a', true]])
    h.emit({ type: 'done', requestId: first }); h.emit({ type: 'done', requestId: second })
    assert.ok(h.updates.some(([id, messages]) => id === 'a' && JSON.stringify(messages).includes('background A')))
    assert.ok(h.updates.some(([id, messages]) => id === 'b' && JSON.stringify(messages).includes('foreground B')))
  } finally { h.cleanup() }
})

test('removing a chat cancels only its request and ignores late events', () => {
  const h = harness(); const a = { id: 'a', title: 'A', messages: [] }; const b = { id: 'b', title: 'B', messages: [] }
  try {
    let hook = h.render(a, [a, b]); hook.sendMessage('first'); const first = h.sent[0]
    hook = h.render(b, [a, b]); hook.sendMessage('second'); const second = h.sent[1]
    h.render(b, [b]); assert.deepEqual(h.cancelled, [first]); const count = h.updates.length
    h.emit({ type: 'token', requestId: first, content: 'late' }); h.emit({ type: 'done', requestId: first }); h.flush()
    assert.equal(h.updates.length, count); h.emit({ type: 'done', requestId: second }); assert.notEqual(h.updates.length, count)
  } finally { h.cleanup() }
})

test('events pending during a quick round trip between chats remain in their original chat', () => {
  const h = harness(); const a = { id: 'a', title: 'A', messages: [] }; const b = { id: 'b', title: 'B', messages: [] }; const sessions = [a, b]
  try {
    let hook = h.render(a, sessions); hook.sendMessage('first'); const first = h.sent[0]
    h.emit({ type: 'token', requestId: first, content: 'pending text' })
    h.render(b, sessions); h.render(a, sessions); h.flush()
    hook = h.render(a, sessions); assert.match(JSON.stringify(hook.messages), /pending text/); assert.deepEqual(h.cancelled, [])
  } finally { h.cleanup() }
})

test('stopping a chat retains late history and does not cancel another chat', () => {
  const h = harness(); const a = { id: 'a', title: 'A', messages: [] }; const b = { id: 'b', title: 'B', messages: [] }; const sessions = [a, b]
  try {
    let hook = h.render(a, sessions); hook.sendMessage('first'); const first = h.sent[0]
    hook = h.render(b, sessions); hook.sendMessage('second'); const second = h.sent[1]
    hook = h.render(a, sessions); hook.cancelStream(); assert.deepEqual(h.cancelled, [first])
    h.emit({ type: 'history', requestId: first, messages: [{ role: 'tool', tool_call_id: 'one', content: 'saved' }] }); h.emit({ type: 'error', requestId: first, message: 'cancelled' })
    hook = h.render(a, sessions); assert.match(JSON.stringify(hook.messages), /saved/); assert.equal(hook.isStreaming, false)
    hook = h.render(b, sessions); assert.equal(hook.isStreaming, true); assert.ok(hook.runningChatIds.includes('b'))
    h.emit({ type: 'done', requestId: second })
  } finally { h.cleanup() }
})

test('first completed chat applies the generated title against its temporary title', async () => {
  const h = harness(); const session = { id: 't', title: 'Новый чат', messages: [] }
  try {
    global.window.api.agent.generateTitle = async () => 'Настройка проекта'
    const hook = h.render(session, [session]); hook.sendMessage('Помоги настроить проект React')
    h.emit({ type: 'done', requestId: h.sent[0] })
    await new Promise(resolve => setImmediate(resolve))
    const titleUpdate = h.updates.find(update => update[2] === 'Настройка проекта')
    assert.ok(titleUpdate)
    assert.equal(titleUpdate[4], 'Помоги настроить проект Reac...')
  } finally { h.cleanup() }
})

test('title generation state follows the pending request and clears on failure', async () => {
  const h = harness(); const session = { id: 'title-pending', title: 'Новый чат', messages: [] }
  let rejectTitle
  try {
    global.window.api.agent.generateTitle = () => new Promise((_resolve, reject) => { rejectTitle = reject })
    let hook = h.render(session, [session]); hook.sendMessage('Настрой проект')
    h.emit({ type: 'done', requestId: h.sent[0] })
    hook = h.render(session, [session]); assert.deepEqual(hook.generatingTitleChatIds, ['title-pending'])
    rejectTitle(new Error('offline'))
    await new Promise(resolve => setImmediate(resolve))
    hook = h.render(session, [session]); assert.deepEqual(hook.generatingTitleChatIds, [])
  } finally { h.cleanup() }
})

test('first chat title is generated during the response and preserves the latest streamed messages', async () => {
  const h = harness(); const session = { id: 'early-title', title: 'Новый чат', messages: [] }
  let resolveTitle
  try {
    global.window.api.agent.generateTitle = () => new Promise(resolve => { resolveTitle = resolve })
    let hook = h.render(session, [session]); hook.sendMessage('Создай сайт для кафе')
    hook = h.render(session, [session])
    assert.deepEqual(hook.generatingTitleChatIds, ['early-title'])
    h.emit({ type: 'token', requestId: h.sent[0], content: 'Работаю над сайтом' }); h.flush()
    resolveTitle('Сайт для кафе')
    await new Promise(resolve => setImmediate(resolve))
    const update = h.updates.find(item => item[2] === 'Сайт для кафе')
    assert.ok(update)
    assert.match(JSON.stringify(update[1]), /Работаю над сайтом/)
    assert.equal(update[4], 'Создай сайт для кафе')
  } finally { h.cleanup() }
})

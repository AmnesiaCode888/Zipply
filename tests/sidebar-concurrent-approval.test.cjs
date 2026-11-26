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
  const slots = []; let cursor = 0; let effects = []; let listener; let frame = null; const cancelled = []; const approvals = []; const sent = []; const updates = []
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
    onEvent(fn) { listener = fn; return () => {} }, chat(_h, _c, id) { sent.push(id) }, cancel(id) { cancelled.push(id) }, approve(...args) { approvals.push(args) }, generateTitle: async () => null
  } } }
  Module._load = function (id, ...args) { return id === 'react' ? react : original.load.call(this, id, ...args) }
  const { useChat } = load('src/renderer/src/hooks/useChat.ts'); Module._load = original.load
  const update = (...args) => updates.push(args)
  return {
    render(activeSession, sessions, historyRevision = 0) { cursor = 0; effects = []; const hook = useChat({ activeSession, sessions, onUpdateSessionMessages: update, historyRevision }); for (const effect of effects) effect(); return hook },
    emit(event) { listener(event) }, flush() { const callback = frame; frame = null; callback?.() }, sent, cancelled, approvals, updates,
    cleanup() { for (const slot of slots) slot?.cleanup?.(); Module._load = original.load; global.window = original.window; global.localStorage = original.storage; global.requestAnimationFrame = original.raf; global.cancelAnimationFrame = original.cancel }
  }
}

test('two simultaneous approvals remain bound to their chats when switching and responding', () => {
  const h = harness()
  const a = { id: 'a', title: 'A', messages: [] }
  const b = { id: 'b', title: 'B', messages: [] }
  const sessions = [a, b]
  try {
    let chat = h.render(a, sessions)
    chat.sendMessage('first')
    const first = h.sent[0]
    chat = h.render(b, sessions)
    chat.sendMessage('second')
    const second = h.sent[1]

    h.emit({ type: 'approval_request', requestId: first, approvalId: 'approval-a', command: 'first command' })
    h.emit({ type: 'approval_request', requestId: second, approvalId: 'approval-b', command: 'second command' })
    chat = h.render(b, sessions)
    assert.deepEqual(chat.approvalChatIds, ['a', 'b'])
    assert.equal(chat.approval.approvalId, 'approval-b')
    chat.respondToApproval(false)

    chat = h.render(a, sessions)
    assert.deepEqual(chat.approvalChatIds, ['a'])
    assert.equal(chat.approval.approvalId, 'approval-a')
    chat.respondToApproval(true)
    assert.deepEqual(h.approvals, [[second, 'approval-b', false], [first, 'approval-a', true]])
    chat = h.render(a, sessions)
    assert.deepEqual(chat.approvalChatIds, [])
  } finally { h.cleanup() }
})

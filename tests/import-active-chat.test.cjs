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

test('replacing an active chat with the same ID cancels stale events and displays imported messages', () => {
  const oldLoad = Module._load, oldWindow = global.window, oldStorage = global.localStorage
  const oldRaf = global.requestAnimationFrame, oldCancel = global.cancelAnimationFrame
  const slots = []; let cursor = 0; let effects = []
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial } },
    useCallback(fn) { cursor++; return fn },
    useEffect(fn, deps) { const i = cursor++; const prev = slots[i]; if (!prev || deps.some((v, j) => v !== prev.deps[j])) effects.push(() => { prev?.cleanup?.(); slots[i] = { deps, cleanup: fn() } }) }
  }
  const store = new Map([['zipply_app_settings_v1', JSON.stringify({ apiKey: 'test' })]])
  global.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
  global.requestAnimationFrame = () => 1; global.cancelAnimationFrame = () => {}
  let emit; let requestId; const cancelled = []; const updates = []
  global.window = { addEventListener() {}, removeEventListener() {}, api: { agent: {
    onEvent(fn) { emit = fn; return () => {} }, chat(_h, _c, id) { requestId = id }, cancel(id) { cancelled.push(id) }
  } } }
  try {
    Module._load = function (id, ...args) { return id === 'react' ? react : oldLoad.call(this, id, ...args) }
    const { useChat } = load('src/renderer/src/hooks/useChat.ts'); Module._load = oldLoad
    const oldSession = { id: 'same', title: 'Chat', messages: [{ id: 'old', role: 'user', content: 'old' }] }
    const imported = { ...oldSession, messages: [{ id: 'new', role: 'user', content: 'imported' }] }
    const update = (...args) => updates.push(args)
    const render = (session, revision) => { cursor = 0; effects = []; const hook = useChat({ activeSession: session, onUpdateSessionMessages: update, historyRevision: revision }); for (const effect of effects) effect(); return hook }
    let hook = render(oldSession, 0)
    hook.sendMessage('question')
    emit({ requestId, type: 'token', content: 'stale' })
    const count = updates.length
    hook.discardForHistoryReplacement()
    assert.deepEqual(cancelled, [requestId])
    assert.equal(updates.length, count)
    emit({ requestId, type: 'token', content: 'late' })
    render(imported, 1)
    hook = render(imported, 1)
    assert.deepEqual(hook.messages, imported.messages)
    assert.equal(updates.length, count)
  } finally { Module._load = oldLoad; global.window = oldWindow; global.localStorage = oldStorage; global.requestAnimationFrame = oldRaf; global.cancelAnimationFrame = oldCancel }
})

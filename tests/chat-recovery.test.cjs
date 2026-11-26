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

test('interrupted stream is restored with received and pending text, preserving other chats', () => {
  const { saveStoredSessions, loadStoredSessions, checkpointSessionMessages } = load('src/renderer/src/services/chatStorageService.ts')
  const { applyEventsToMessages } = load('src/renderer/src/hooks/useChat.ts')
  const oldStorage = global.localStorage
  const data = new Map()
  global.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
  try {
    const messages = [
      { id: 'u', role: 'user', content: 'Question' },
      { id: 'a', role: 'assistant', blocks: [], isStreaming: true }
    ]
    saveStoredSessions([
      { id: 'first', title: 'Chat', createdAt: 1, updatedAt: 1, folderPath: 'workspace', messages },
      { id: 'second', title: 'Other', createdAt: 1, updatedAt: 1, folderPath: 'workspace2', messages: [{ id: 'u2', role: 'user', content: 'Keep me' }] }
    ])
    const received = applyEventsToMessages(messages, [{ type: 'token', content: 'Partial ' }, { type: 'tool_call_stream', callId: 'tool', toolName: 'read_file', argsBuffer: '{"path":"a.txt"}' }])
    checkpointSessionMessages('first', received)
    const pending = applyEventsToMessages(received, [{ type: 'token', content: 'answer' }])
    checkpointSessionMessages('first', pending)
    const sessions = loadStoredSessions()
    assert.equal(sessions[0].messages[0].content, 'Question')
    const assistant = sessions[0].messages[1]
    assert.equal(assistant.isStreaming, false)
    assert.deepEqual(assistant.blocks.filter(block => block.type === 'text').map(block => block.content), ['Partial ', 'answer'])
    assert.equal(assistant.blocks.find(block => block.type === 'tool').tool.status, 'error')
    assert.ok(assistant.blocks.filter(block => block.type === 'text').every(block => !block.isStreaming))
    assert.equal(sessions[1].messages[0].content, 'Keep me')
  } finally { global.localStorage = oldStorage }
})

test('closing while an agent event waits for a frame saves the event', () => {
  const previousLoad = Module._load
  const previousWindow = global.window
  const previousStorage = global.localStorage
  const previousRaf = global.requestAnimationFrame
  const previousCancelRaf = global.cancelAnimationFrame
  const effects = []
  const react = {
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: value => ({ current: value }),
    useCallback: callback => callback,
    useEffect: effect => effects.push(effect)
  }
  const data = new Map()
  global.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
  global.requestAnimationFrame = () => 1
  global.cancelAnimationFrame = () => {}
  let emitAgentEvent
  let requestId
  const windowEvents = new Map()
  global.window = {
    addEventListener: (name, listener) => windowEvents.set(name, listener),
    removeEventListener: name => windowEvents.delete(name),
    api: { agent: {
      onEvent: callback => { emitAgentEvent = callback; return () => {} },
      chat: (_history, _config, id) => { requestId = id },
      cancel: () => {}
    } }
  }
  let cleanups = []
  try {
    const storage = load('src/renderer/src/services/chatStorageService.ts')
    const session = { id: 'active', title: 'Existing', createdAt: 1, updatedAt: 1, folderPath: 'workspace', messages: [{ id: 'old', role: 'user', content: 'Earlier' }] }
    storage.saveStoredSessions([session])
    global.localStorage.setItem('zipply_app_settings_v1', JSON.stringify({ apiKey: 'test-key' }))
    Module._load = function (id, ...args) { return id === 'react' ? react : previousLoad.call(this, id, ...args) }
    const { useChat } = load('src/renderer/src/hooks/useChat.ts')
    Module._load = previousLoad
    const hook = useChat({ activeSession: session, onUpdateSessionMessages: (id, messages) => storage.saveStoredSessions([{ ...session, id, messages }]) })
    cleanups = effects.map(effect => effect()).filter(Boolean)
    hook.sendMessage('New question')
    emitAgentEvent({ requestId, type: 'token', content: 'Received before close' })
    windowEvents.get('beforeunload')()
    const restored = storage.loadStoredSessions()[0]
    assert.equal(restored.messages[0].content, 'Earlier')
    assert.equal(restored.messages[1].content, 'New question')
    assert.equal(restored.messages[2].blocks[0].content, 'Received before close')
    assert.equal(restored.messages[2].isStreaming, false)
  } finally {
    for (const cleanup of cleanups) cleanup()
    Module._load = previousLoad
    global.window = previousWindow
    global.localStorage = previousStorage
    global.requestAnimationFrame = previousRaf
    global.cancelAnimationFrame = previousCancelRaf
  }
})

test('temporary backup read errors do not replace recoverable history with an empty chat', () => {
  const oldWindow = global.window, oldStorage = global.localStorage
  const data = new Map(); let available = false
  const saved = { id: 'recovered', title: 'Saved', createdAt: 1, updatedAt: 1, folderPath: 'work', messages: [{ id: 'm', role: 'user', content: 'important' }] }
  global.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
  global.window = { api: { workspace: { loadSessions: () => available ? { sessions: [saved], errors: [] } : { sessions: [], errors: ['unavailable'] } } } }
  try {
    const { loadStoredSessions } = load('src/renderer/src/services/chatStorageService.ts')
    loadStoredSessions()
    assert.equal(data.has('zipply_chat_sessions_v1'), false)
    available = true
    assert.equal(loadStoredSessions()[0].messages[0].content, 'important')
  } finally { global.window = oldWindow; global.localStorage = oldStorage }
})

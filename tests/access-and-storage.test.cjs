const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')

function load(file) {
  const built = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const mod = new Module(path.resolve(file), module)
  mod.filename = path.resolve(file)
  mod.paths = module.paths
  mod._compile(built.outputFiles[0].text, mod.filename)
  return mod.exports
}

test('approval mode asks before changing a file and rejects the action if denied', async () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  let executed = false
  let approval
  const tool = { name: 'write_file', validate: () => null, getExecutionPolicy: () => ({ mutates: true, cacheable: false }), execute: async () => { executed = true; return { formattedContent: 'ok' } } }
  const board = new Blackboard()
  board.setArtifact('config', { accessMode: 'confirm', workspacePath: 'project', confirmAction: async action => { approval = action; return false } })
  const messages = []
  await ToolExecutor.executeCalls({ getHandler: () => tool }, [{ id: '1', name: 'write_file', argumentsJson: JSON.stringify({ path: 'a.txt', content: 'hello' }) }], messages, board, () => {})
  assert.equal(executed, false)
  assert.equal(approval.kind, 'file')
  assert.equal(approval.target, path.resolve('project', 'a.txt'))
  assert.match(messages[0].content, /отклон/i)
})

test('read-only access rejects a mutating tool even when it is requested', async () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  let executed = false
  const tool = { name: 'terminal', validate: () => null, getExecutionPolicy: () => ({ mutates: true }), execute: async () => { executed = true; return { formattedContent: 'ok' } } }
  const board = new Blackboard()
  board.setArtifact('config', { accessMode: 'read-only' })
  const messages = []
  await ToolExecutor.executeCalls({ getHandler: () => tool }, [{ id: '1', name: 'terminal', argumentsJson: '{"command":"echo x"}' }], messages, board, () => {})
  assert.equal(executed, false)
  assert.match(messages[0].content, /недоступен/i)
})

test('confirmation mode asks before even a simple terminal command', async () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  let executed = false
  let action
  const tool = { name: 'terminal', validate: () => null, getExecutionPolicy: () => ({ mutates: true }), execute: async () => { executed = true; return { formattedContent: 'ok' } } }
  const board = new Blackboard()
  board.setArtifact('config', { accessMode: 'confirm', workspacePath: process.cwd(), confirmAction: async value => { action = value; return true } })
  await ToolExecutor.executeCalls({ getHandler: () => tool }, [{ id: '1', name: 'terminal', argumentsJson: '{"command":"npm test","cwd":"src"}' }], [], board, () => {})
  assert.equal(executed, true)
  assert.equal(action.command, 'npm test')
  assert.equal(action.cwd, path.join(process.cwd(), 'src'))
})

test('automatic mode still asks for a recognized destructive command', async () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  let executed = false
  let asked = false
  const tool = { name: 'terminal', validate: () => null, getExecutionPolicy: () => ({ mutates: true }), execute: async () => { executed = true; return { formattedContent: 'ok' } } }
  const board = new Blackboard()
  board.setArtifact('config', { accessMode: 'automatic', confirmAction: async () => { asked = true; return false } })
  await ToolExecutor.executeCalls({ getHandler: () => tool }, [{ id: '1', name: 'terminal', argumentsJson: '{"command":"git push"}' }], [], board, () => {})
  assert.equal(asked, true)
  assert.equal(executed, false)
})

test('session storage reads saved sessions and ignores malformed files', async () => {
  const { SessionStore } = load('src/main/services/SessionStore.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-recover-'))
  try {
    const store = new SessionStore(dir)
    await store.save({ id: 'chat-1', title: 'Saved', messages: [] })
    await fs.writeFile(path.join(dir, 'sessions', 'broken.json'), '{broken')
    const result = store.loadAllSync()
    assert.equal(result.sessions[0].title, 'Saved')
    assert.equal(result.errors.length, 1)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('corrupted local history recovers saved sessions without replacing them with a new chat', () => {
  const { loadStoredSessions } = load('src/renderer/src/services/chatStorageService.ts')
  const previousWindow = global.window
  const previousStorage = global.localStorage
  const data = new Map([['zipply_chat_sessions_v1', '{broken']])
  const session = { id: 'restored', title: 'Recovered', createdAt: 1, updatedAt: 1, folderPath: 'project', messages: [] }
  global.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
  global.window = { api: { workspace: { loadSessions: () => ({ sessions: [session], errors: [] }) } } }
  try { assert.equal(loadStoredSessions()[0].id, 'restored') }
  finally { global.window = previousWindow; global.localStorage = previousStorage }
})

test('import rejects malformed chat data before replacing existing history', async () => {
  const { importChatsFromJson } = load('src/renderer/src/services/settingsService.ts')
  const previous = global.FileReader
  global.FileReader = class {
    readAsText(file) { this.onload({ target: { result: file.text } }) }
  }
  try {
    await assert.rejects(importChatsFromJson({ text: '[{"id":"../outside","messages":[]}]' }), /формат|идентификатор/i)
    await assert.rejects(importChatsFromJson({ text: '[{"id":"chat-1","messages":{} }]' }), /формат/i)
  } finally { global.FileReader = previous }
})

test('storage write failure is returned to callers before they remove backups', () => {
  const { saveStoredSessions } = load('src/renderer/src/services/chatStorageService.ts')
  const previous = global.localStorage
  global.localStorage = { setItem: () => { throw new Error('quota') } }
  try { assert.equal(saveStoredSessions([]), false) }
  finally { global.localStorage = previous }
})

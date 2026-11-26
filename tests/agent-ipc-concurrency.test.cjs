const { test } = require('node:test')
const assert = require('node:assert/strict')
const { transformSync } = require('esbuild')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { EventEmitter } = require('node:events')

function harness(plugins = { list: () => [], setInstalled: () => [] }) {
  const handlers = {}; const runs = []; const subagentCalls = []
  const ipcMain = { on: (name, fn) => { handlers[name] = fn }, handle: (name, fn) => { handlers[name] = fn } }
  const subagentManager = new EventEmitter()
  subagentManager.listForOwner = (senderId, sessionId) => { subagentCalls.push(['list', senderId, sessionId]); return [] }
  subagentManager.controlForOwner = (senderId, sessionId, agentId, action) => {
    subagentCalls.push(['control', senderId, sessionId, agentId, action])
    return Promise.resolve({ id: agentId, status: action === 'stop' ? 'cancelled' : action === 'interrupt' ? 'interrupted' : 'queued' })
  }
  subagentManager.stopForOwner = (senderId, sessionId) => { subagentCalls.push(['stop-owner', senderId, sessionId]) }
  const original = Module._load
  try {
    Module._load = function (id, ...args) {
      if (id === './AgentInteractionBroker' || id === './McpIpcHandler' || id === './ExtensionsIpcHandler' || id === './agentIpcTypes') {
        const ipcFile = path.resolve('src/main/ipc', `${path.basename(id)}.ts`); const local = new Module(ipcFile, module)
        local.filename = ipcFile; local.paths = module.paths
        local._compile(transformSync(fs.readFileSync(ipcFile, 'utf8'), { loader: 'ts', format: 'cjs' }).code, ipcFile)
        return local.exports
      }
      if (id === '../../shared/chatTitle' || id === '../../shared/extensions') {
        const sharedFile = path.resolve('src/shared', `${path.basename(id)}.ts`); const shared = new Module(sharedFile, module)
        shared.filename = sharedFile; shared.paths = module.paths
        shared._compile(transformSync(fs.readFileSync(sharedFile, 'utf8'), { loader: 'ts', format: 'cjs' }).code, sharedFile)
        return shared.exports
      }
      if (id === 'electron') return { ipcMain, BrowserWindow: { getAllWindows: () => [] } }
      if (id === '../agent/services/SubagentManager') return { subagentManager }
      if (id === '../agent/mcp/McpTrustStore') return { mcpToolTrustFingerprint: () => '' }
      if (id === '../agent/index') return { runAgent: (...args) => new Promise(resolve => runs.push({ signal: args[4], resolve, config: args[2], emit: args[3], plugins: args[5] })) }
      if (id === '../agent/services/ChatService') return { ChatService: {} }
      if (id === '../agent/services/CommandExplanation') return { explainCommand: async () => '' }
      if (id === '../agent/services/ProcessManager') return { processManager: { stopSender: async () => {}, stopSenderRequest: async () => {}, stopSession: async () => {} } }
      if (id === '../agent/services/TerminalSessionManager') return { terminalSessionManager: { stopRequest: async () => {}, stopSession: async () => {} } }
      return original.call(this, id, ...args)
    }
    const file = path.resolve('src/main/ipc/AgentIpcHandler.ts'); const mod = new Module(file, module); mod.filename = file; mod.paths = module.paths
    mod._compile(transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' }).code, file)
    new mod.exports.AgentIpcHandler(plugins).register()
  } finally { Module._load = original }
  const sender = id => { const s = new EventEmitter(); s.id = id; s.isDestroyed = () => false; s.send = () => {}; return s }
  return { handlers, runs, sender, subagentCalls }
}

test('agent receives the main-process plugin snapshot, not renderer-provided plugin IDs', async () => {
  const { handlers, runs, sender } = harness({ list: () => [], setInstalled: () => [] })
  const run = handlers['agent:chat']({ sender: sender(1) }, { requestId: 'plugin-check', settings: { installedPlugins: ['cybersec'] } })
  assert.deepEqual(runs[0].plugins, [])
  runs[0].resolve(); await run
})

test('plugin IPC rejects requests from a non-main frame', () => {
  const { handlers, sender } = harness()
  const s = sender(1); s.mainFrame = {}
  assert.throws(() => handlers['plugins:list']({ sender: s, senderFrame: {} }, []), /источник/)
  assert.throws(() => handlers['plugins:setInstalled']({ sender: s, senderFrame: {} }, 'cybersec', true), /источник/)
})

test('replacing an id retains the new controller after the old request finishes', async () => {
  const { handlers, runs, sender } = harness(); const event = { sender: sender(1) }
  const first = handlers['agent:chat'](event, { requestId: 'same' }); const second = handlers['agent:chat'](event, { requestId: 'same' })
  assert.equal(runs[0].signal.aborted, true); runs[0].resolve(); await first
  handlers['agent:cancel'](event, { requestId: 'same' }); assert.equal(runs[1].signal.aborted, true)
  runs[1].resolve(); await second
})

test('process owner is assigned by IPC and scoped to the sender and chat', async () => {
  const { handlers, runs, sender } = harness(); const s = sender(7)
  const run = handlers['agent:chat']({ sender: s }, { requestId: 'request', sessionId: 'session', settings: { workspacePath: 'project', processOwner: { senderId: 99 }, subagentOwner: { senderId: 99, sessionId: 'other' }, subagentDependencyPaths: ['C:\\sensitive'] } })
  assert.equal(runs[0].config.processOwner.senderId, 7)
  assert.equal(runs[0].config.processOwner.sessionId, 'session')
  assert.deepEqual(runs[0].config.subagentOwner, { senderId: 7, sessionId: 'session' })
  assert.equal(runs[0].config.subagentDependencyPaths, undefined)
  assert.equal(runs[0].config.requestId, 'request')
  runs[0].resolve(); await run
})

test('subagent IPC scopes list and controls to the calling renderer and chat', async () => {
  const { handlers, sender, subagentCalls } = harness()
  const owner = sender(11); owner.mainFrame = {}
  const event = { sender: owner, senderFrame: owner.mainFrame }
  assert.deepEqual(handlers['agent:subagents:list'](event, 'chat-a'), [])
  await handlers['agent:subagents:control'](event, { sessionId: 'chat-a', agentId: 'child-a', action: 'resume' })
  assert.deepEqual(subagentCalls, [
    ['list', 11, 'chat-a'],
    ['control', 11, 'chat-a', 'child-a', 'resume']
  ])
  assert.throws(() => handlers['agent:subagents:list']({ sender: owner, senderFrame: {} }, 'chat-a'), /источник/)
})

test('discarding a chat stops its subagents in that owner scope', () => {
  const { handlers, sender, subagentCalls } = harness()
  const owner = sender(13); owner.mainFrame = {}
  handlers['agent:discardSession']({ sender: owner, senderFrame: owner.mainFrame }, { sessionId: 'chat-a' })
  assert.deepEqual(subagentCalls, [['stop-owner', 13, 'chat-a']])
})

test('destroyed renderer aborts each of its active runs and cleans listeners after completion', async () => {
  const { handlers, runs, sender, subagentCalls } = harness(); const s = sender(1); const event = { sender: s }
  const first = handlers['agent:chat'](event, { requestId: 'one' }); const second = handlers['agent:chat'](event, { requestId: 'two' })
  s.emit('destroyed'); assert.equal(runs[0].signal.aborted, true); assert.equal(runs[1].signal.aborted, true)
  assert.deepEqual(subagentCalls, [['stop-owner', 1, undefined]])
  runs.forEach(run => run.resolve()); await Promise.all([first, second]); assert.equal(s.listenerCount('destroyed'), 0)
})

test('a different renderer cannot cancel or replace another renderer request', async () => {
  const { handlers, runs, sender } = harness(); const firstSender = { sender: sender(1) }; const secondSender = { sender: sender(2) }
  const first = handlers['agent:chat'](firstSender, { requestId: 'same' }); handlers['agent:cancel'](secondSender, { requestId: 'same' }); assert.equal(runs[0].signal.aborted, false)
  const second = handlers['agent:chat'](secondSender, { requestId: 'same' }); assert.equal(runs[0].signal.aborted, false)
  handlers['agent:cancel'](firstSender, { requestId: 'same' }); assert.equal(runs[0].signal.aborted, true); assert.equal(runs[1].signal.aborted, false)
  runs.forEach(run => run.resolve()); await Promise.all([first, second])
})

test('superseded runs cannot emit or ask approval, while ordinary cancellation still emits its final event', async () => {
  const { handlers, runs, sender } = harness(); const s = sender(1); const sent = []; s.send = (_channel, event) => sent.push(event); const event = { sender: s }
  const first = handlers['agent:chat'](event, { requestId: 'same' }); const second = handlers['agent:chat'](event, { requestId: 'same' })
  runs[0].emit({ type: 'error', message: 'old' }); const approved = await runs[0].config.confirmAction({ kind: 'file', command: '' }); assert.equal(approved, false)
  assert.equal(sent.some(message => message.message === 'old' || message.type === 'approval_request'), false)
  handlers['agent:cancel'](event, { requestId: 'same' }); runs[1].emit({ type: 'history', messages: [] }); runs[1].emit({ type: 'error', message: 'cancelled' })
  assert.deepEqual(sent.map(message => message.type), ['history', 'error']); assert.equal(sent[1].message, 'cancelled')
  runs.forEach(run => run.resolve()); await Promise.all([first, second])
})

test('questions accept only the owning sender and request and stop waiting on cancellation', async () => {
  const { handlers, runs, sender } = harness(); const owner = sender(1); const events = []; owner.send = (_, event) => events.push(event)
  const run = handlers['agent:chat']({ sender: owner }, { requestId: 'one' })
  const answer = runs[0].config.askUser({ question: 'Выберите цвет', options: ['Белый', 'Чёрный'] })
  const question = events.find(event => event.type === 'question_request')
  assert.ok(question)
  handlers['agent:answer']({ sender: sender(2) }, { requestId: 'one', questionId: question.questionId, answer: 'Белый' })
  handlers['agent:answer']({ sender: owner }, { requestId: 'other', questionId: question.questionId, answer: 'Белый' })
  handlers['agent:answer']({ sender: owner }, { requestId: 'one', questionId: question.questionId, answer: 'Чёрный' })
  assert.equal(await answer, 'Чёрный')
  const cancelled = runs[0].config.askUser({ question: 'Ещё вопрос', options: [] })
  handlers['agent:cancel']({ sender: owner }, { requestId: 'one' })
  assert.equal(await cancelled, null)
  runs[0].resolve(); await run
})

test('group answers require the owning request and one nonempty answer per question', async () => {
  const { handlers, runs, sender } = harness(); const owner = sender(1); const events = []; owner.send = (_, event) => events.push(event)
  const run = handlers['agent:chat']({ sender: owner }, { requestId: 'one' })
  const pending = runs[0].config.askUser({ questions: [{ question: 'A', options: [] }, { question: 'B', options: [] }] })
  const id = events[0].questionId
  let settled = false; pending.then(() => { settled = true })
  for (const [source, requestId, answer] of [[sender(2), 'one', ['x', 'y']], [owner, 'other', ['x', 'y']], [owner, 'one', ['x']], [owner, 'one', ['x', ' ']], [owner, 'one', 'x']]) {
    handlers['agent:answer']({ sender: source }, { requestId, questionId: id, answer })
  }
  await Promise.resolve(); assert.equal(settled, false)
  handlers['agent:answer']({ sender: owner }, { requestId: 'one', questionId: id, answer: [' x ', ' y '] })
  assert.deepEqual(await pending, ['x', 'y'])
  const otherRun = handlers['agent:chat']({ sender: owner }, { requestId: 'two' })
  const one = runs[0].config.askUser({ questions: [{ question: 'A', options: [] }] })
  const two = runs[1].config.askUser({ questions: [{ question: 'B', options: [] }] })
  const idOne = events.at(-2).questionId; const idTwo = events.at(-1).questionId
  handlers['agent:answer']({ sender: owner }, { requestId: 'two', questionId: idOne, answer: ['wrong'] })
  handlers['agent:answer']({ sender: owner }, { requestId: 'one', questionId: idOne, answer: null })
  assert.equal(await one, null)
  handlers['agent:answer']({ sender: owner }, { requestId: 'two', questionId: idTwo, answer: ['ok'] })
  assert.deepEqual(await two, ['ok'])
  const cancelled = runs[1].config.askUser({ questions: [{ question: 'C', options: [] }] })
  handlers['agent:cancel']({ sender: owner }, { requestId: 'two' }); assert.equal(await cancelled, null)
  runs[1].resolve(); await otherRun
  runs[0].resolve(); await run
})

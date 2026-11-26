const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')

function load(file, mocks = {}) {
  const r = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const m = new Module(path.resolve(file), module)
  m.filename = path.resolve(file)
  m.paths = module.paths
  const origLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request]
    return origLoad.call(this, request, parent, isMain)
  }
  try {
    m._compile(r.outputFiles[0].text, m.filename)
  } finally {
    Module._load = origLoad
  }
  return m.exports
}

test('RunJournal persists tool states and reconcileDiskState detects partial mutations on disk', async () => {
  const { RunJournalStore } = load('src/main/agent/core/RunJournal.ts')
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-journal-'))
  const ws = path.join(baseDir, 'ws')
  await fs.mkdir(ws, { recursive: true })
  const target = path.join(ws, 'out.txt')
  await fs.writeFile(target, 'BEFORE')

  try {
    const store = new RunJournalStore(path.join(baseDir, 'journals'))
    await store.startRun({
      runId: 'run-1',
      sessionId: 'sess-1',
      requestId: 'req-1',
      agentId: 'zipply',
      workspacePath: ws,
      taskState: { goal: 'Update out.txt', constraints: [], acceptanceCriteria: [], confirmedFacts: [], nextStep: '' },
      history: [{ role: 'user', content: 'Write AFTER into out.txt' }]
    })
    await store.recordToolStart('sess-1', {
      callId: 'c1',
      toolName: 'write_file',
      argsJson: JSON.stringify({ path: 'out.txt', content: 'AFTER' }),
      targetPaths: [target]
    })

    // Simulate crash right after writing file on disk before tool_result was recorded
    await fs.writeFile(target, 'AFTER')

    const loaded = await store.load('sess-1')
    assert.ok(loaded)
    assert.equal(loaded.tools[0].status, 'started')
    const rec = await store.reconcileDiskState(loaded)
    assert.equal(rec.inFlightTools.length, 1)
    assert.match(rec.reconciliationNote, /write_file/)
    assert.match(rec.reconciliationNote, /Повторная запись не требуется/)
    assert.equal(rec.hasAppliedMutation, true)
    await fs.writeFile(target, 'Manual change')
    const conflict = await store.reconcileDiskState(loaded)
    assert.match(conflict.reconciliationNote, /правки пользователя/)
    assert.equal(conflict.hasAppliedMutation, false)
  } finally {
    await fs.rm(baseDir, { recursive: true, force: true })
  }
})

test('AgentRunner injects mid-run steer messages without aborting or restarting the run', async () => {
  const { runAgent } = load('src/main/agent/index.ts')
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-steer-run-'))
  await fs.writeFile(path.join(ws, 'a.txt'), 'hello')

  const originalFetch = global.fetch
  const bodies = []
  const steerQueue = []
  let req = 0
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    bodies.push(body)
    req++
    if (req === 1) {
      return Response.json({
        choices: [{
          message: {
            content: null,
            tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'a.txt' }) } }]
          }
        }]
      })
    }
    return Response.json({
      choices: [{ message: { content: 'Applied steer: UPPERCASE!' } }]
    })
  }

  const events = []
  try {
    await runAgent(
      'zipply',
      [{ role: 'user', content: 'Read a.txt' }],
      {
        model: 'test',
        stream: false,
        workspacePath: ws,
        accessMode: 'automatic',
        consumeSteers: () => steerQueue.splice(0)
      },
      (evt) => {
        events.push(evt)
        if (evt.type === 'tool_result') {
          // Simulate user sending mid-run steering right while tools run
          steerQueue.push('Switch output to UPPERCASE')
        }
      }
    )

    assert.equal(bodies.length, 2, 'single continuous run without cancel+restart')
    const secondPrompt = JSON.stringify(bodies[1].messages)
    assert.match(secondPrompt, /Switch output to UPPERCASE/)
    assert.equal(events.find(e => e.type === 'run_summary')?.summary?.reason, 'completed')
  } finally {
    global.fetch = originalFetch
    await fs.rm(ws, { recursive: true, force: true })
  }
})

test('AgentRunner replans before executing a mutation queued by an earlier model request', async () => {
  const { runAgent } = load('src/main/agent/index.ts')
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-steer-batch-'))
  const originalFetch = global.fetch
  const requests = []
  const steers = []
  const events = []
  try {
    await fs.writeFile(path.join(ws, 'before.txt'), 'Keep me')
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body)
      requests.push(body.messages)
      const message = requests.length === 1
        ? { content: null, tool_calls: [
            { id: 'read', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'before.txt' }) } },
            { id: 'write', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'before.txt', content: 'Replace me' }) } }
          ] }
        : { content: 'Сохранено исходное содержимое.' }
      return Response.json({ choices: [{ message }] })
    }
    await runAgent(
      'zipply', [{ role: 'user', content: 'Заменить before.txt' }],
      { model: 'test', stream: false, workspacePath: ws, accessMode: 'unrestricted', consumeSteers: () => steers.splice(0) },
      event => {
        events.push(event)
        if (event.type === 'tool_result' && event.callId.endsWith(':read')) steers.push('Оставь файл без изменений')
      }
    )
    assert.equal(await fs.readFile(path.join(ws, 'before.txt'), 'utf8'), 'Keep me')
    assert.match(JSON.stringify(requests[1]), /Оставь файл без изменений/)
    assert.equal(events.find(event => event.type === 'run_summary')?.summary.reason, 'completed')
  } finally {
    global.fetch = originalFetch
    await fs.rm(ws, { recursive: true, force: true })
  }
})

test('a replaced journal ignores delayed progress, result, steering, and finish events from an old run', async () => {
  const { RunJournalStore } = load('src/main/agent/core/RunJournal.ts')
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-journal-replacement-'))
  try {
    const journal = new RunJournalStore(baseDir)
    const common = {
      sessionId: 'session', agentId: 'zipply', workspacePath: baseDir,
      taskState: { goal: 'Keep latest run', constraints: [], acceptanceCriteria: [], confirmedFacts: [], nextStep: '' },
      history: [{ role: 'user', content: 'Keep latest run' }]
    }
    await journal.startRun({ ...common, requestId: 'old', runId: 'old' })
    await journal.startRun({ ...common, requestId: 'new', runId: 'new' })
    await journal.recordToolStart('session', { callId: 'write', toolName: 'write_file', argsJson: '{}' }, 'new')

    await journal.recordToolResult('session', { callId: 'write', result: 'old result', error: false }, 'old')
    await journal.updateProgress('session', { history: [{ role: 'user', content: 'Old goal' }] }, 'old')
    await journal.appendSteer('session', 'Old correction', 'old')
    await journal.finishRun('session', 'completed', undefined, undefined, 'old')

    const record = await journal.load('session')
    assert.equal(record.status, 'running')
    assert.equal(record.history[0].content, 'Keep latest run')
    assert.equal(record.pendingSteers.length, 0)
    assert.equal(record.tools[0].status, 'started')
  } finally {
    await fs.rm(baseDir, { recursive: true, force: true })
  }
})

test('AgentIpcHandler exposes agent:steer, persists RunJournal, and resumes interrupted runs via agent:resume', async () => {
  const handlers = new Map()
  const listeners = new Map()
  const ipcMainMock = {
    handle: (ch, fn) => handlers.set(ch, fn),
    on: (ch, fn) => listeners.set(ch, fn)
  }
  const { AgentIpcHandler } = load('src/main/ipc/AgentIpcHandler.ts', {
    electron: { ipcMain: ipcMainMock, app: { getPath: () => os.tmpdir() } },
    '../agent/services/TerminalSessionManager': {
      terminalSessionManager: {
        startCommand: async () => ({ session: { id: 's', status: 'exited', exitCode: 0 }, output: '', rawCursor: 0, truncated: false }),
        stopRequest: async () => {},
        stopSession: async () => {}
      }
    }
  })
  const { RunJournalStore } = load('src/main/agent/core/RunJournal.ts')
  const { PluginManager } = load('src/main/agent/plugins/PluginManager.ts')

  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-ipc-journal-'))
  const ws = path.join(baseDir, 'ws')
  await fs.mkdir(ws, { recursive: true })
  const originalFetch = global.fetch

  try {
    const journal = new RunJournalStore(path.join(baseDir, 'journals'))
    const ipc = new AgentIpcHandler(new PluginManager(baseDir), undefined, journal)
    ipc.register()

    assert.ok(listeners.has('agent:steer'), 'agent:steer IPC listener registered')
    assert.ok(listeners.has('agent:resume'), 'agent:resume IPC listener registered')
    assert.ok(handlers.has('agent:getJournal'), 'agent:getJournal IPC handler registered')

    const sent = []
    const sender = {
      id: 99,
      mainFrame: {},
      isDestroyed: () => false,
      once: () => {},
      removeListener: () => {},
      send: (ch, payload) => sent.push({ ch, payload })
    }

    // Seed an interrupted run directly into journal and resume it via agent:resume
    await journal.startRun({
      runId: 'run-crashed',
      sessionId: 'sess-resume',
      requestId: 'req-old',
      agentId: 'zipply',
      workspacePath: ws,
      taskState: { goal: 'Finish interrupted job', constraints: [], acceptanceCriteria: [], confirmedFacts: [], nextStep: '' },
      history: [{ role: 'assistant', name: 'zipply_context_snapshot', content: JSON.stringify([
        { role: 'user', content: 'Create result.txt' }
      ]) }]
    })
    await journal.appendSteer('sess-resume', 'Make sure it includes DONE')
    await journal.recordToolStart('sess-resume', {
      callId: 'interrupted-write', toolName: 'write_file',
      argsJson: JSON.stringify({ path: 'result.txt', content: 'DONE' }), targetPaths: [path.join(ws, 'result.txt')]
    })
    await fs.writeFile(path.join(ws, 'result.txt'), 'DONE')
    const originalMtime = new Date('2020-01-01T00:00:00Z')
    await fs.utimes(path.join(ws, 'result.txt'), originalMtime, originalMtime)

    const prompted = []
    global.fetch = async (_url, options) => {
      prompted.push(JSON.parse(options.body).messages)
      const message = prompted.length === 1
        ? { content: null, tool_calls: [
            { id: 'updated-plan', type: 'function', function: {
              name: 'update_plan', arguments: JSON.stringify({ plan: [{ step: 'Check recovered file', status: 'completed' }] })
            } },
            { id: 'repeated-write', type: 'function', function: {
              name: 'write_file', arguments: JSON.stringify({ path: 'result.txt', content: 'DONE' })
            } }
          ] }
        : { content: 'Recovered.' }
      return Response.json({ choices: [{ message }] })
    }

    const resumeHandler = listeners.get('agent:resume')
    await resumeHandler(
      { sender, senderFrame: sender.mainFrame },
      { sessionId: 'sess-resume', settings: { model: 'test', stream: false, workspacePath: ws }, requestId: 'req-resume', agentId: 'zipply' }
    )

    const summaryEvt = sent.find(s => s.payload?.type === 'run_summary')
    assert.ok(summaryEvt, 'resumed run emits run_summary')
    assert.equal(summaryEvt.payload.summary.reason, 'completed')
    const afterJournal = await handlers.get('agent:getJournal')({ sender, senderFrame: sender.mainFrame }, { sessionId: 'sess-resume' })
    assert.equal(afterJournal.status, 'completed')
    assert.equal(afterJournal.taskState.goal, 'Finish interrupted job')
    assert.deepEqual(afterJournal.taskState.userCorrections, ['Make sure it includes DONE'])
    assert.equal(afterJournal.pendingSteers.length, 0)
    assert.equal(afterJournal.tools.find(tool => tool.callId === 'interrupted-write')?.status, 'completed')
    assert.equal((await fs.stat(path.join(ws, 'result.txt'))).mtimeMs, originalMtime.getTime())
    assert.ok(afterJournal.history.some(message => message.role === 'user' && message.content === 'Create result.txt'))
    assert.ok(prompted[0].some(message => message.role === 'user' && message.content.includes('Make sure it includes DONE')))
    assert.match(JSON.stringify(prompted[0]), /файл на диске изменён/)
  } finally {
    global.fetch = originalFetch
    await fs.rm(baseDir, { recursive: true, force: true })
  }
})

test('AgentIpcHandler awaits the mutation journal before touching disk and checkpoints result and task state', async () => {
  const listeners = new Map()
  const ipcMain = { on: (channel, listener) => listeners.set(channel, listener), handle() {} }
  const { AgentIpcHandler } = load('src/main/ipc/AgentIpcHandler.ts', { electron: { ipcMain, app: { getPath: () => os.tmpdir() } } })
  const { RunJournalStore } = load('src/main/agent/core/RunJournal.ts')
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-durable-mutation-'))
  const originalFetch = global.fetch
  const target = path.join(ws, 'result.txt')
  const events = []
  let release
  const waitForRelease = new Promise(resolve => { release = resolve })
  let entered
  const reachedJournal = new Promise(resolve => { entered = resolve })
  let run
  try {
    await fs.writeFile(target, 'before')
    const journal = new RunJournalStore(path.join(ws, 'journal'))
    const recordToolStart = journal.recordToolStart.bind(journal)
    journal.recordToolStart = async (...args) => {
      if (args[1].toolName === 'write_file') {
        entered()
        await waitForRelease
      }
      return recordToolStart(...args)
    }
    let round = 0
    const makeCall = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
    global.fetch = async () => {
      round++
      if (round > 1) return Response.json({ choices: [{ message: { content: 'Saved.' } }] })
      return Response.json({ choices: [{ message: { content: null, tool_calls: [
        makeCall('plan', 'update_plan', { plan: [{ step: 'Verify result', status: 'in_progress' }], confirmed_facts: ['Plan recorded'] }),
        makeCall('write', 'write_file', { path: 'result.txt', content: 'after' })
      ] } }] })
    }
    const { PluginManager } = load('src/main/agent/plugins/PluginManager.ts')
    new AgentIpcHandler(new PluginManager(ws), undefined, journal).register()
    const sender = { id: 1, isDestroyed: () => false, once() {}, removeListener() {}, send: (_channel, event) => events.push(event) }
    run = listeners.get('agent:chat')({ sender }, {
      sessionId: 'session', requestId: 'request', history: [{ role: 'user', content: 'Save the result' }],
      settings: { model: 'test', stream: false, workspacePath: ws, accessMode: 'unrestricted' }
    })
    assert.equal(await Promise.race([reachedJournal.then(() => 'start'), run.then(() => 'finish')]), 'start', JSON.stringify(events))
    // Wait through the file-operation task queue while the journal write is held.
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(await fs.readFile(target, 'utf8'), 'before')
    release()
    await run

    assert.equal(await fs.readFile(target, 'utf8'), 'after')
    const checkpoint = await journal.load('session')
    const mutation = checkpoint.tools.find(tool => tool.toolName === 'write_file')
    assert.equal(mutation.status, 'completed')
    assert.notEqual(mutation.targetPaths[0].beforeHash, mutation.targetPaths[0].afterHash)
    assert.ok(checkpoint.history.some(message => message.role === 'tool' && message.tool_call_id === 'write'))
    assert.deepEqual(checkpoint.taskState.confirmedFacts, ['Plan recorded'])
    assert.equal(checkpoint.taskState.nextStep, 'Verify result')
  } finally {
    release()
    await run
    global.fetch = originalFetch
    await fs.rm(ws, { recursive: true, force: true })
  }
})

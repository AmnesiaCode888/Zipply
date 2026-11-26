const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

function load(file) {
  const r = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const m = new Module(path.resolve(file), module)
  m.filename = path.resolve(file)
  m.paths = module.paths
  m._compile(r.outputFiles[0].text, m.filename)
  return m.exports
}

test('WriteStdinTool distinguishes read-only polls from mutating stdin/signal writes', async () => {
  const { WriteStdinTool } = load('src/main/agent/tools/WriteStdinTool.ts')
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const tool = new WriteStdinTool()

  assert.equal(tool.getExecutionPolicy({ session_id: 's1' }).mutates, false)
  assert.equal(tool.getExecutionPolicy({ session_id: 's1', chars: '' }).mutates, false)
  assert.equal(tool.getExecutionPolicy({ session_id: 's1', chars: 'yes\n' }).mutates, true)
  assert.equal(tool.getExecutionPolicy({ session_id: 's1', signal: 'SIGINT' }).mutates, true)

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-stdin-poll-'))
  const filePath = path.join(dir, 'sample.txt')
  await fs.writeFile(filePath, 'HELLO_WORLD')

  try {
    let asked = false
    let readCount = 0
    const fakeRead = {
      name: 'read_file',
      validate: () => null,
      getExecutionPolicy: () => ({ mutates: false, parallelSafe: true, cacheable: true }),
      execute: async () => {
        readCount++
        return { formattedContent: `read #${readCount}: HELLO_WORLD`, success: true }
      }
    }
    const fakeWriteStdin = {
      name: 'write_stdin',
      validate: tool.validate.bind(tool),
      getExecutionPolicy: tool.getExecutionPolicy.bind(tool),
      execute: async () => ({ formattedContent: 'running...', data: { terminalSessionId: 's1', status: 'running' }, success: true })
    }
    const agent = {
      getHandler: (name) => (name === 'read_file' ? fakeRead : name === 'write_stdin' ? fakeWriteStdin : undefined)
    }
    const board = new Blackboard()
    board.setArtifact('config', {
      accessMode: 'confirm',
      workspacePath: dir,
      confirmAction: async () => { asked = true; return false }
    })
    const cache = new Map()
    const messages = []

    await ToolExecutor.executeCalls(agent, [{ id: '1', name: 'read_file', argumentsJson: JSON.stringify({ path: 'sample.txt' }) }], messages, board, () => {}, undefined, cache)
    await ToolExecutor.executeCalls(agent, [{ id: '2', name: 'write_stdin', argumentsJson: JSON.stringify({ session_id: 's1', chars: '' }) }], messages, board, () => {}, undefined, cache)
    await ToolExecutor.executeCalls(agent, [{ id: '3', name: 'read_file', argumentsJson: JSON.stringify({ path: 'sample.txt' }) }], messages, board, () => {}, undefined, cache)

    assert.equal(asked, false, 'empty write_stdin poll must not prompt in confirm mode')
    assert.equal(readCount, 1, 'empty write_stdin poll must not clear valid read cache')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('ToolExecutor versioned resultCache invalidates automatically after external file edit on disk', async () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const { ReadFileTool } = load('src/main/agent/tools/ReadFileTool.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-ver-cache-'))
  const target = path.join(dir, 'doc.txt')
  await fs.writeFile(target, 'VERSION_1')

  try {
    let executions = 0
    const realRead = new ReadFileTool()
    const spyRead = {
      name: 'read_file',
      validate: realRead.validate.bind(realRead),
      getExecutionPolicy: realRead.getExecutionPolicy.bind(realRead),
      execute: async (args, board, sig, cb) => {
        executions++
        return realRead.execute(args, board, sig, cb)
      }
    }
    const agent = { getHandler: () => spyRead }
    const board = new Blackboard()
    board.setArtifact('config', { workspacePath: dir, accessMode: 'automatic' })
    const cache = new Map()
    const msgs1 = []
    await ToolExecutor.executeCalls(agent, [{ id: 'c1', name: 'read_file', argumentsJson: JSON.stringify({ path: 'doc.txt' }) }], msgs1, board, () => {}, undefined, cache)
    await ToolExecutor.executeCalls(agent, [{ id: 'c2', name: 'read_file', argumentsJson: JSON.stringify({ path: 'doc.txt' }) }], msgs1, board, () => {}, undefined, cache)
    assert.equal(executions, 1, 'unchanged file should hit versioned cache')

    // Simulate manual external modification (even same length!)
    await fs.writeFile(target, 'VERSION_2')
    const msgs2 = []
    await ToolExecutor.executeCalls(agent, [{ id: 'c3', name: 'read_file', argumentsJson: JSON.stringify({ path: 'doc.txt' }) }], msgs2, board, () => {}, undefined, cache)
    assert.equal(executions, 2, 'external modification must invalidate stale cache')
    assert.match(msgs2[0].content, /VERSION_2/)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('ExecCommandTool returns structured errorCode when command fails', async () => {
  const { ExecCommandTool } = load('src/main/agent/tools/ExecCommandTool.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-exec-struct-'))
  const board = new Blackboard()
  board.setArtifact('config', { workspacePath: dir, accessMode: 'automatic', sandbox: { profile: 'unrestricted', network: 'on' } })
  try {
    const res = await new ExecCommandTool().execute(JSON.stringify({ command: 'node -e "process.exit(7)"' }), board)
    assert.equal(res.error, true)
    assert.equal(res.data.exitCode, 7)
    assert.equal(res.data.errorCode, 'EXIT_7')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('per-model context lengths are used in settings, AgentRunner, and ContextIndicator', () => {
  const { getModelContextLength } = load('src/shared/models.ts')
  const { toChatConfig, loadSettings } = load('src/renderer/src/services/settingsService.ts')
  const { ContextIndicator } = load('src/renderer/src/components/chat-input/ContextIndicator.tsx')

  assert.equal(getModelContextLength('gpt-4o'), 128000)
  assert.equal(getModelContextLength('anthropic/claude-sonnet-4'), 200000)
  assert.equal(getModelContextLength('google/gemini-2.5-pro'), 1000000)
  assert.equal(getModelContextLength('deepseek-v4-1-flash-1017-uncensored'), 500000)
  assert.equal(getModelContextLength('glm-5-3-flash-uncensored'), 500000)

  const prevWindow = global.window
  const prevStorage = global.localStorage
  global.window = {}
  global.localStorage = { getItem: () => null }
  try {
    const base = loadSettings()
    assert.equal(toChatConfig(base, 'anthropic/claude-sonnet-4').contextLength, 200000)
    assert.equal(toChatConfig(base, 'gpt-4o').contextLength, 128000)
  } finally {
    global.window = prevWindow
    global.localStorage = prevStorage
  }

  const html = renderToStaticMarkup(React.createElement(ContextIndicator, {
    status: { estimatedTokens: 10000, limit: 100000, compacted: false },
    compacted: false
  }))
  assert.match(html, /10%/)
})

test('AttachmentResolver resolves zipply-document sizes before compaction and TaskState preserves userCorrections/checksSummary', async () => {
  const { AttachmentResolver } = load('src/main/agent/core/AttachmentResolver.ts')
  const { ContextCompactor } = load('src/main/agent/core/ContextCompactor.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-attach-'))
  const uploadDir = path.join(dir, '.zipply', 'uploads')
  await fs.mkdir(uploadDir, { recursive: true })
  const docId = '11111111-1111-1111-1111-111111111111.txt'
  const docName = `.zipply/uploads/${docId}`
  const bigBody = 'DOCUMENT_LINE_DATA '.repeat(600)
  await fs.writeFile(path.join(uploadDir, docId), bigBody, 'utf8')

  try {
    const history = [
      { role: 'system', content: 'System' },
      { role: 'user', content: [{ type: 'text', text: 'First turn' }, { type: 'text', text: `zipply-document:${docName}` }] },
      { role: 'assistant', content: 'Noted.' },
      { role: 'user', content: 'Latest correction: output JSON only.' }
    ]
    const attachmentMeta = await AttachmentResolver.resolveMessages(history, dir)
    const compact = await ContextCompactor.compactAsync(history, {
      contextLength: 2500,
      maxTokens: 200,
      attachmentMeta,
      taskState: {
        goal: 'Analyze document',
        constraints: [],
        acceptanceCriteria: [],
        confirmedFacts: [],
        userCorrections: ['Output JSON only'],
        checksSummary: ['verify_file doc.txt passed'],
        nextStep: 'Finish'
      },
      summarize: async (msgs) => {
        const serialized = JSON.stringify(msgs)
        assert.match(serialized, /DOCUMENT_LINE_DATA/, 'summarizer must see expanded document text, not raw zipply-document ref')
        return 'Summarized large document.'
      }
    })
    const out = JSON.stringify(compact)
    assert.match(out, /Summarized large document/)
    assert.match(out, /Output JSON only/)
    assert.match(out, /verify_file doc\.txt passed/)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

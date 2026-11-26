const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')

function load(file) {
  const result = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external', loader: { '.svg': 'dataurl', '.css': 'empty' } })
  const mod = new Module(path.resolve(file), module)
  mod.filename = path.resolve(file)
  mod.paths = module.paths
  mod._compile(result.outputFiles[0].text, mod.filename)
  return mod.exports
}

test('edit rejects an empty target before executing', () => {
  const { EditFileTool } = load('src/main/agent/tools/EditFileTool.ts')
  assert.match(new EditFileTool().validate(JSON.stringify({ path: 'a', target: '', replacement: 'x' })), /target/i)
  assert.match(new EditFileTool().validate(JSON.stringify({ path: 'a', target: '  \n ', replacement: 'x' })), /target/i)
})

test('edit rejects ambiguous matches', async () => {
  const { EditFileTool } = load('src/main/agent/tools/EditFileTool.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-test-'))
  try {
    await fs.writeFile(path.join(dir, 'a.txt'), 'same\nsame\n')
    const board = new Blackboard()
    board.setArtifact('config', { workspacePath: dir })
    const result = await new EditFileTool().execute(JSON.stringify({ path: 'a.txt', target: 'same', replacement: 'new' }), board)
    assert.equal(result.error, true)
    assert.equal(await fs.readFile(path.join(dir, 'a.txt'), 'utf8'), 'same\nsame\n')
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('context compaction uses the configured context length', () => {
  const { ContextCompactor } = load('src/main/agent/core/ContextCompactor.ts')
  const messages = [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'old' },
    { role: 'tool', content: 'a'.repeat(8000) },
    { role: 'user', content: 'one' },
    { role: 'user', content: 'two' },
    { role: 'user', content: 'three' },
    { role: 'user', content: 'latest' }
  ]
  const compacted = ContextCompactor.compact(messages, { contextLength: 1000 })
  assert.ok(compacted.reduce((n, msg) => n + (msg.content || '').length, 0) < 5000)
})

test('plan mode exposes only read-only tools', () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const agent = { getTools: () => [
    { name: 'read_file', description: '', parameters: {}, getExecutionPolicy: () => ({ mutates: false }) },
    { name: 'terminal', description: '', parameters: {}, getExecutionPolicy: () => ({ mutates: true }) }
  ] }
  assert.deepEqual(ToolExecutor.buildToolDefs(agent, [], true).map(t => t.function.name), ['read_file'])
})

test('project folder is never used for session metadata', () => {
  const { sessionFilePath } = load('src/main/services/SessionPaths.ts')
  const result = sessionFilePath('C:/data/zipply', 'chat-123')
  assert.equal(result, path.join('C:/data/zipply', 'sessions', 'chat-123.json'))
  assert.throws(() => sessionFilePath('C:/data/zipply', '../session'))
})

test('credentials are stored encrypted and can be cleared', async () => {
  const { SecretStore } = load('src/main/services/SecretStore.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-secret-'))
  try {
    const codec = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value.split('').reverse().join('')), decryptString: data => data.toString().split('').reverse().join('') }
    const store = new SecretStore(dir, codec)
    store.set('apiKey', 'secret-value')
    assert.equal(store.get('apiKey'), 'secret-value')
    assert.equal((await fs.readFile(path.join(dir, 'secrets.json'), 'utf8')).includes('secret-value'), false)
    store.set('apiKey', '')
    assert.equal(store.get('apiKey'), '')
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('critical shell commands are identified for confirmation', () => {
  const { requiresConfirmation } = load('src/main/agent/core/CommandPolicy.ts')
  assert.equal(requiresConfirmation('git push origin main'), true)
  assert.equal(requiresConfirmation('Remove-Item -Recurse -Force src'), true)
  assert.equal(requiresConfirmation('npm test'), false)
})

test('subsequent requests retain the assistant tool protocol', () => {
  const { buildAgentHistory } = load('src/renderer/src/services/agentHistory.ts')
  const transcript = [
    { role: 'user', content: 'Read it' },
    { role: 'assistant', blocks: [], agentHistory: [
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a"}' } }] },
      { role: 'tool', tool_call_id: 'c1', name: 'read_file', content: 'contents' },
      { role: 'assistant', content: 'Done' }
    ] }
  ]
  const result = buildAgentHistory(JSON.parse(JSON.stringify(transcript)))
  assert.deepEqual(result.map(m => m.role), ['user', 'assistant', 'tool', 'assistant'])
  assert.equal(result[2].tool_call_id, 'c1')
})

test('a broken stream is not retried after output has been shown', async () => {
  const { ChatService } = load('src/main/agent/services/ChatService.ts')
  const original = global.fetch
  let requests = 0
  global.fetch = async () => {
    requests++
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n'))
        setTimeout(() => controller.error(new Error('connection lost')), 0)
      }
    }), { status: 200 })
  }
  try {
    await assert.rejects(ChatService.chat({ model: 'test' }, [{ role: 'user', content: 'hi' }], undefined, () => {}), /connection lost/)
    assert.equal(requests, 1)
  } finally { global.fetch = original }
})

test('reading an HTTP error reports a tool error', async () => {
  const { WebTool } = load('src/main/agent/tools/WebTool.ts')
  const original = global.fetch
  global.fetch = async () => new Response('missing', { status: 404 })
  try {
    const result = await new WebTool().execute(JSON.stringify({ url: 'https://example.com/' }), {})
    assert.equal(result.error, true)
  } finally { global.fetch = original }
})

test('project search finds content and file names while ignoring dependencies', async () => {
  const { ProjectSearchTool } = load('src/main/agent/tools/ProjectSearchTool.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-search-'))
  try {
    await fs.mkdir(path.join(dir, 'node_modules'))
    await fs.writeFile(path.join(dir, 'needle.txt'), 'one\nNeedle inside\n')
    await fs.writeFile(path.join(dir, 'node_modules', 'bad.txt'), 'needle')
    const board = new Blackboard(); board.setArtifact('config', { workspacePath: dir })
    const tool = new ProjectSearchTool()
    const content = await tool.execute(JSON.stringify({ query: 'needle', mode: 'content' }), board)
    const files = await tool.execute(JSON.stringify({ query: 'needle', mode: 'files' }), board)
    assert.match(content.formattedContent, /needle\.txt:2/i)
    assert.doesNotMatch(content.formattedContent, /bad\.txt/)
    assert.match(files.formattedContent, /needle\.txt/)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('context compaction removes old turns when they exceed the configured budget', () => {
  const { ContextCompactor } = load('src/main/agent/core/ContextCompactor.ts')
  const old = 'old '.repeat(4000)
  const result = ContextCompactor.compact([{ role: 'system', content: 'rules' }, { role: 'user', content: old }, { role: 'assistant', content: old }, { role: 'user', content: 'current goal' }], { contextLength: 1200 })
  assert.equal(result.at(-1).content, 'current goal')
  assert.ok(JSON.stringify(result).length < 5000)
})

test('reading an oversized file fails without loading the file', async () => {
  const { ReadFileTool } = load('src/main/agent/tools/ReadFileTool.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-read-'))
  try {
    await fs.writeFile(path.join(dir, 'big.txt'), Buffer.alloc(3_000_000, 65))
    const board = new Blackboard(); board.setArtifact('config', { workspacePath: dir })
    const result = await new ReadFileTool().execute(JSON.stringify({ path: 'big.txt' }), board)
    assert.equal(result.error, true)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('agent runs a tool and emits its protocol before the final response', async () => {
  const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts')
  let requests = 0
  const original = global.fetch
  global.fetch = async (_url, options) => {
    requests++
    const body = JSON.parse(options.body)
    if (requests === 2) assert.equal(body.messages.at(-1).role, 'tool')
    const message = requests === 1
      ? { content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{}' } }] }
      : { content: 'finished' }
    return Response.json({ choices: [{ message }] })
  }
  const tool = { name: 'lookup', description: '', parameters: {}, validate: () => null, getExecutionPolicy: () => ({ mutates: false, cacheable: false, parallelSafe: true }), execute: async () => ({ formattedContent: 'result' }) }
  const agent = { id: 'zipply', getTools: () => [tool], getHandler: name => name === 'lookup' ? tool : undefined }
  const events = []
  try {
    await AgentRunner.run(agent, [{ role: 'user', content: 'run it' }], { model: 'test', stream: false }, event => events.push(event))
    assert.equal(requests, 2)
    const history = events.filter(event => event.type === 'history').at(-1).messages
    assert.deepEqual(history.map(message => message.role), ['assistant', 'tool', 'assistant'])
    assert.equal(events.at(-1).type, 'done')
  } finally { global.fetch = original }
})

test('agent continues beyond 50 steps by default', async () => {
  const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts')
  let requests = 0
  const original = global.fetch
  global.fetch = async () => {
    requests++
    const message = requests <= 52
      ? { content: null, tool_calls: [{ id: `call-${requests}`, type: 'function', function: { name: 'lookup', arguments: '{}' } }] }
      : { content: 'finished after 53 turns' }
    return Response.json({ choices: [{ message }] })
  }
  const tool = { name: 'lookup', description: '', parameters: {}, validate: () => null, getExecutionPolicy: () => ({ mutates: false, cacheable: false, parallelSafe: true }), execute: async () => ({ formattedContent: 'ok' }) }
  const agent = { id: 'zipply', getTools: () => [tool], getHandler: (name) => name === 'lookup' ? tool : undefined }
  const events = []
  try {
    await AgentRunner.run(agent, [{ role: 'user', content: 'long run' }], { model: 'test', stream: false }, (event) => events.push(event))
    assert.equal(requests, 53)
    assert.equal(events.at(-1).type, 'done')
  } finally { global.fetch = original }
})

test('legacy step limit settings do not stop the agent', async () => {
  const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts')
  let requests = 0
  const original = global.fetch
  global.fetch = async () => {
    requests++
    const message = requests <= 5 ? { content: null, tool_calls: [{ id: `call-${requests}`, type: 'function', function: { name: 'lookup', arguments: '{}' } }] } : { content: 'done' }
    return Response.json({ choices: [{ message }] })
  }
  const tool = { name: 'lookup', description: '', parameters: {}, validate: () => null, getExecutionPolicy: () => ({ mutates: false, cacheable: false, parallelSafe: true }), execute: async () => ({ formattedContent: 'ok' }) }
  const agent = { id: 'zipply', getTools: () => [tool], getHandler: (name) => name === 'lookup' ? tool : undefined }
  const events = []
  try {
    await AgentRunner.run(agent, [{ role: 'user', content: 'run' }], { model: 'test', stream: false, maxIterations: 5 }, (event) => events.push(event))
    assert.equal(requests, 6)
    assert.equal(events.at(-1).type, 'done')
  } finally { global.fetch = original }
})

test('terminal preserves exit failures and bounds retained output', async () => {
  const { TerminalTool } = load('src/main/agent/tools/TerminalTool.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const tool = new TerminalTool(); const board = new Blackboard()
  const failed = await tool.execute(JSON.stringify({ command: 'exit 3' }), board)
  assert.equal(failed.error, true)
  const command = process.platform === 'win32' ? "Write-Output ('x' * 200000)" : "printf '%0200000d' 0"
  const large = await tool.execute(JSON.stringify({ command }), board)
  assert.equal(large.success, true)
  assert.ok(large.data.stdout.length <= 100000)
})

test('terminal cancels a running process', async () => {
  const { TerminalTool } = load('src/main/agent/tools/TerminalTool.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const controller = new AbortController()
  const command = process.platform === 'win32' ? 'Start-Sleep -Seconds 10' : 'sleep 10'
  const task = new TerminalTool().execute(JSON.stringify({ command }), new Blackboard(), controller.signal)
  setTimeout(() => controller.abort(), 100)
  const result = await task
  assert.equal(result.error, true)
})

test('model configuration uses the fixed context limit even for an older saved value', () => {
  const { toChatConfig } = load('src/renderer/src/services/settingsService.ts')
  const config = toChatConfig({ apiKey: '', baseUrl: '', openRouterModel: 'test', systemPrompt: '', contextLength: 12000 })
  assert.equal(config.contextLength, 500000)
})

test('agent searches, edits and checks a real temporary project via a test provider', async () => {
  const { runAgent } = load('src/main/agent/index.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-e2e-'))
  const original = global.fetch
  let call = 0
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    const steps = [
      { name: 'search_project', arguments: JSON.stringify({ query: 'before' }) },
      { name: 'edit_file', arguments: JSON.stringify({ path: 'example.txt', target: 'before', replacement: 'after' }) },
      { name: 'terminal', arguments: JSON.stringify({ command: process.platform === 'win32' ? 'Get-Content example.txt' : 'cat example.txt' }) },
      { name: 'verify_file', arguments: JSON.stringify({ path: 'example.txt', predicate: 'contains', expected: 'after' }) }
    ]
    if (call > 0) assert.equal(body.messages.at(-1).role, 'tool')
    const step = steps[call++]
    const message = step ? { content: null, tool_calls: [{ id: `call-${call}`, type: 'function', function: step }] } : { content: 'done' }
    return Response.json({ choices: [{ message }] })
  }
  try {
    await fs.writeFile(path.join(dir, 'example.txt'), 'before\n')
    const events = []
    await runAgent('zipply', [{ role: 'user', content: 'edit and verify' }], { model: 'test', stream: false, workspacePath: dir }, event => events.push(event))
    assert.equal(await fs.readFile(path.join(dir, 'example.txt'), 'utf8'), 'after\n')
    assert.equal(events.filter(event => event.type === 'tool_result' && !event.error).length, 4)
    assert.equal(events.at(-1).type, 'done')
  } finally { global.fetch = original; await fs.rm(dir, { recursive: true, force: true }) }
})

test('chat metadata is written and removed only in application storage', async () => {
  const { SessionStore } = load('src/main/services/SessionStore.ts')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-session-'))
  const project = path.join(root, 'project')
  try {
    await fs.mkdir(project)
    await fs.writeFile(path.join(project, 'session.json'), 'user data')
    const store = new SessionStore(path.join(root, 'app'))
    await Promise.all([store.save({ id: 'chat-1', folderPath: project, title: 'first' }), store.save({ id: 'chat-1', folderPath: project, title: 'last' })])
    const saved = JSON.parse(await fs.readFile(path.join(root, 'app', 'sessions', 'chat-1.json'), 'utf8'))
    assert.equal(saved.title, 'last')
    assert.equal(await fs.readFile(path.join(project, 'session.json'), 'utf8'), 'user data')
    await store.remove('chat-1')
    await assert.rejects(fs.access(path.join(root, 'app', 'sessions', 'chat-1.json')))
    assert.equal(await fs.readFile(path.join(project, 'session.json'), 'utf8'), 'user data')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('legacy plaintext API keys are stripped from public settings on load', () => {
  const previousWindow = global.window; const previousStorage = global.localStorage
  const values = new Map([['zipply_app_settings_v1', JSON.stringify({ apiKey: 'old-api', tavilyApiKey: 'old-search', systemPrompt: 'Keep' })]])
  global.localStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) }
  global.window = {}
  try {
    const { loadSettings } = load('src/renderer/src/services/settingsService.ts')
    const settings = loadSettings()
    assert.equal(settings.systemPrompt, 'Keep')
    assert.equal(settings.apiKey, undefined)
    assert.equal(settings.tavilyApiKey, undefined)
  } finally { global.window = previousWindow; global.localStorage = previousStorage }
})

test('agent creates a missing new chat workspace before accessing it', async () => {
  const { runAgent } = load('src/main/agent/index.ts')
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-workspace-'))
  const dir = path.join(parent, 'new-chat')
  const original = global.fetch
  global.fetch = async () => Response.json({ choices: [{ message: { content: 'ok' } }] })
  try {
    await runAgent('zipply', [{ role: 'user', content: 'hi' }], { model: 'test', stream: false, workspacePath: dir }, () => {})
    assert.equal((await fs.stat(dir)).isDirectory(), true)
  } finally { global.fetch = original; await fs.rm(parent, { recursive: true, force: true }) }
})

test('settings save reports failure when storage is unavailable', () => {
  const previousWindow = global.window; const previousStorage = global.localStorage
  global.localStorage = { getItem: () => null, setItem: () => { throw new Error('unavailable') } }
  global.window = {}
  try {
    const { loadSettings, saveSettings } = load('src/renderer/src/services/settingsService.ts')
    const settings = loadSettings()
    assert.equal(saveSettings(settings), false)
  } finally { global.window = previousWindow; global.localStorage = previousStorage }
})

test('network response reader rejects oversized data', async () => {
  const { readResponseText } = load('src/main/agent/tools/responseUtils.ts')
  await assert.rejects(readResponseText(new Response('abcdef'), 4), /лимит/i)
  assert.equal(await readResponseText(new Response('abc'), 4), 'abc')
})

test('plan mode refuses a mutating tool even if a model requests it', async () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  let executed = false
  const tool = { name: 'edit_file', getExecutionPolicy: () => ({ mutates: true }), validate: () => null, execute: async () => { executed = true; return { formattedContent: 'bad' } } }
  const board = new Blackboard(); board.setArtifact('planMode', true)
  const messages = []; const events = []
  await ToolExecutor.executeCalls({ getHandler: () => tool }, [{ id: 'x', name: 'edit_file', argumentsJson: '{}' }], messages, board, e => events.push(e))
  assert.equal(executed, false)
  assert.equal(events.at(-1).error, true)
})

test('developer message remains before user history for reasoning models', () => {
  const { ChatService } = load('src/main/agent/services/ChatService.ts')
  const messages = ChatService.sanitizeMessages([{ role: 'developer', content: 'rules' }, { role: 'user', content: 'hello' }], { model: 'o3' })
  assert.deepEqual(messages.map(message => message.role), ['developer', 'user'])
})

test('terminal aliases cannot bypass command confirmation', async () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  let executed = false
  const tool = { name: 'terminal', getExecutionPolicy: () => ({ mutates: true, cacheable: false }), validate: () => null, execute: async () => { executed = true; return { formattedContent: 'bad' } } }
  const board = new Blackboard(); board.setArtifact('config', { confirmCommand: async () => false })
  const messages = []; const events = []
  await ToolExecutor.executeCalls({ getHandler: () => tool }, [{ id: 'x', name: 'bash', argumentsJson: JSON.stringify({ command: 'git push' }) }], messages, board, e => events.push(e))
  assert.equal(executed, false)
  assert.equal(events.at(-1).error, true)
  await ToolExecutor.executeCalls({ getHandler: () => tool }, [{ id: 'y', name: 'terminal', argumentsJson: JSON.stringify({ command: ['git', 'push'] }) }], messages, board, e => events.push(e))
  assert.equal(executed, false)
  assert.equal(events.at(-1).error, true)
})

test('web search and page reading retain source URLs', async () => {
  const { SearchTool } = load('src/main/agent/tools/SearchTool.ts')
  const { WebTool } = load('src/main/agent/tools/WebTool.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const original = global.fetch
  global.fetch = async url => String(url).includes('bing.com')
    ? new Response('<rss><item><title>Source</title><link>https://example.com/article</link><description>Fact</description></item></rss>')
    : new Response('<html><h1>Source</h1><p>Fact text</p></html>')
  try {
    const search = await new SearchTool().execute(JSON.stringify({ query: 'fact' }), new Blackboard())
    assert.match(search.formattedContent, /https:\/\/example\.com\/article/)
    const page = await new WebTool().execute(JSON.stringify({ url: 'https://example.com/article' }), new Blackboard())
    assert.match(page.formattedContent, /https:\/\/example\.com\/article/)
    assert.match(page.formattedContent, /Fact text/)
  } finally { global.fetch = original }
})

test('file reading limits output for extremely long lines', async () => {
  const { ReadFileTool } = load('src/main/agent/tools/ReadFileTool.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-lines-'))
  try {
    await fs.writeFile(path.join(dir, 'long.txt'), 'x'.repeat(100000))
    const board = new Blackboard(); board.setArtifact('config', { workspacePath: dir })
    const result = await new ReadFileTool().execute(JSON.stringify({ path: 'long.txt' }), board)
    assert.ok(result.formattedContent.length < 40000)
    assert.match(result.formattedContent, /усечен|сокращ|лимит/i)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('tool output is capped even when a tool asks not to truncate', async () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const tool = { name: 'big', getExecutionPolicy: () => ({ mutates: false, cacheable: false }), validate: () => null, execute: async () => ({ formattedContent: 'x'.repeat(100000), noTruncate: true }) }
  const messages = []
  await ToolExecutor.executeCalls({ getHandler: () => tool }, [{ id: 'x', name: 'big', argumentsJson: '{}' }], messages, new Blackboard(), () => {})
  assert.ok(messages[0].content.length < 40000)
})

test('project search falls back when ripgrep is unavailable', async () => {
  const { ProjectSearchTool } = load('src/main/agent/tools/ProjectSearchTool.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-fallback-'))
  const originalPath = process.env.PATH
  try {
    await fs.writeFile(path.join(dir, 'file.txt'), 'hello needle')
    const board = new Blackboard(); board.setArtifact('config', { workspacePath: dir })
    process.env.PATH = ''
    const result = await new ProjectSearchTool().execute(JSON.stringify({ query: 'needle' }), board)
    assert.match(result.formattedContent, /file\.txt:1:hello needle/)
  } finally { process.env.PATH = originalPath; await fs.rm(dir, { recursive: true, force: true }) }
})

test('streaming a file write captures the original before writing', async () => {
  const { runAgent } = load('src/main/agent/index.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-preview-'))
  const original = global.fetch
  let request = 0
  global.fetch = async () => {
    request++
    const delta = request === 1
      ? { tool_calls: [{ index: 0, id: 'preview-call', function: { name: 'write_file', arguments: JSON.stringify({ path: 'file.txt', content: 'new\n' }) } }] }
      : { content: 'done' }
    return new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`)
  }
  try {
    await fs.writeFile(path.join(dir, 'file.txt'), 'old\n')
    const events = []
    await runAgent('zipply', [{ role: 'user', content: 'write' }], { model: 'test', workspacePath: dir }, event => events.push(event))
    const baseline = events.find(event => event.type === 'tool_baseline')
    assert.equal(baseline?.content, 'old\n')
    assert.ok(events.findIndex(event => event.type === 'tool_baseline') < events.findIndex(event => event.type === 'tool_result'))
    assert.equal(await fs.readFile(path.join(dir, 'file.txt'), 'utf8'), 'new\n')
  } finally { global.fetch = original; await fs.rm(dir, { recursive: true, force: true }) }
})

test('file tool arguments stream progressively when the provider repeats the tool name', async () => {
  const { ChatService } = load('src/main/agent/services/ChatService.ts')
  const original = global.fetch
  const events = []
  let release
  const gate = new Promise(resolve => { release = resolve })
  const encoder = new TextEncoder()
  global.fetch = async () => new Response(new ReadableStream({
    async start(controller) {
      const send = delta => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`))
      send({ tool_calls: [{ index: 0, id: 'call-1', function: { name: 'write_file', arguments: '{"path":"a.txt","content":"first' } }] })
      await gate
      send({ tool_calls: [{ index: 0, function: { name: 'write_file', arguments: '\\nsecond"}' } }] })
      controller.close()
    }
  }))
  try {
    const pending = ChatService.chat({ model: 'test' }, [{ role: 'user', content: 'write' }], undefined, undefined, undefined,
      (id, name, _delta, args) => events.push({ id, name, args }))
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(events.length, 1)
    assert.match(events[0].args, /first/)
    release()
    const response = await pending
    assert.equal(events.at(-1).name, 'write_file')
    assert.equal(response.toolCalls[0].name, 'write_file')
    assert.equal(JSON.parse(response.toolCalls[0].argumentsJson).content, 'first\nsecond')
  } finally { release(); global.fetch = original }
})

test('chat shows incremental file content and keeps the card through tool completion', () => {
  const { applyEventToBlocks } = load('src/renderer/src/hooks/useChat.ts')
  const blocks = []
  const message = { id: 'm', role: 'assistant', isStreaming: true }
  applyEventToBlocks({ type: 'tool_call_stream', callId: 'call', toolName: 'write_file', argsBuffer: '{"path":"a.ts","content":"const a' }, blocks, message)
  assert.equal(blocks[0].tool.content, 'const a')
  assert.equal(blocks[0].tool.status, 'running')
  applyEventToBlocks({ type: 'tool_call_stream', callId: 'call', toolName: 'write_file', argsBuffer: '{"path":"a.ts","content":"const a = 1;\\nconst b' }, blocks, message)
  assert.equal(blocks[0].tool.content, 'const a = 1;\nconst b')
  applyEventToBlocks({ type: 'tool_start', callId: 'call', toolName: 'write_file', args: { path: 'a.ts', content: 'const a = 1;\nconst b = 2;' } }, blocks, message)
  assert.equal(blocks[0].tool.content, 'const a = 1;\nconst b = 2;')
  applyEventToBlocks({ type: 'tool_result', callId: 'call', result: '+const a = 1;', data: { diff: { added: 2, removed: 0 } } }, blocks, message)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].tool.status, 'completed')
  assert.equal(blocks[0].tool.diff.added, 2)
})

test('file preview immediately shows provider chunks before the response finishes', async () => {
  const { runAgent } = load('src/main/agent/index.ts')
  const { applyEventToBlocks } = load('src/renderer/src/hooks/useChat.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-live-'))
  const original = global.fetch
  const encoder = new TextEncoder()
  let streamController
  let request = 0
  const content = 'first line\n' + 'remaining content\n'.repeat(100)
  const args = JSON.stringify({ path: 'new.txt', content })
  const split = args.indexOf('first line') + 'first line'.length
  global.fetch = async () => {
    if (++request > 1) return new Response('data: {"choices":[{"delta":{"content":"done"}}]}\n\ndata: [DONE]\n\n')
    return new Response(new ReadableStream({ start(controller) { streamController = controller } }))
  }
  const blocks = []
  const message = { id: 'm', role: 'assistant', isStreaming: true }
  const events = []
  const controller = new AbortController()
  const send = delta => streamController.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`))
  const nextEvent = () => new Promise(resolve => setImmediate(resolve))
  try {
    const pending = runAgent('zipply', [{ role: 'user', content: 'write' }], { model: 'test', workspacePath: dir }, event => {
      events.push(event)
      applyEventToBlocks(event, blocks, message)
    }, controller.signal)
    while (!streamController) await nextEvent()
    send({ tool_calls: [{ index: 0, id: 'live-call', function: { name: 'write_file', arguments: args.slice(0, split) } }] })
    while (!events.some(event => event.type === 'tool_call_stream')) await nextEvent()
    assert.equal(blocks[0].tool.content, 'first line')
    send({ tool_calls: [{ index: 0, function: { arguments: args.slice(split) } }] })
    while (events.filter(event => event.type === 'tool_call_stream').length < 2) await nextEvent()
    assert.equal(blocks[0].tool.content, content)
    assert.equal(events.some(event => event.type === 'tool_start'), false)
    await assert.rejects(fs.access(path.join(dir, 'new.txt')))
    streamController.enqueue(encoder.encode('data: [DONE]\n\n'))
    streamController.close()
    await pending
    assert.equal(await fs.readFile(path.join(dir, 'new.txt'), 'utf8'), content)
  } finally { controller.abort(); if (streamController) { try { streamController.close() } catch {} }; global.fetch = original; await fs.rm(dir, { recursive: true, force: true }) }
})

test('cancelling while receiving file content does not write the file', async () => {
  const { runAgent } = load('src/main/agent/index.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-live-cancel-'))
  const original = global.fetch
  const controller = new AbortController()
  global.fetch = async () => {
    const delta = { tool_calls: [{ index: 0, id: 'cancel-call', function: { name: 'write_file', arguments: JSON.stringify({ path: 'new.txt', content: 'text '.repeat(200) }) } }] }
    return new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`)
  }
  try {
    const events = []
    await runAgent('zipply', [{ role: 'user', content: 'write' }], { model: 'test', workspacePath: dir }, event => {
      events.push(event)
      if (event.type === 'tool_call_stream') controller.abort()
    }, controller.signal)
    assert.equal(events.some(event => event.type === 'tool_start'), false)
    await assert.rejects(fs.access(path.join(dir, 'new.txt')))
  } finally { global.fetch = original; await fs.rm(dir, { recursive: true, force: true }) }
})

test('the file currently receiving preview updates is expanded when calls overlap', () => {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const { ChatMessageItem } = load('src/renderer/src/components/ChatMessageItem.tsx')
  const { applyEventToBlocks } = load('src/renderer/src/hooks/useChat.ts')
  const blocks = []
  const message = { id: 'm', role: 'assistant', isStreaming: true, blocks }
  for (const [id, content] of [['first', ''], ['second', ''], ['first', 'first code'], ['second', 'second code']]) {
    applyEventToBlocks({ type: 'tool_call_stream', callId: id, toolName: 'write_file', argsBuffer: JSON.stringify({ path: `${id}.txt`, content }) }, blocks, message)
  }
  const html = renderToStaticMarkup(React.createElement(ChatMessageItem, { message }))
  const second = html.slice(html.indexOf('second.txt'))
  assert.match(second, /grid-rows-\[1fr\]/)
})

test('markdown code blocks show the language and safely highlight code', () => {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const { MarkdownRenderer } = load('src/renderer/src/components/chat/MarkdownRenderer.tsx')
  const render = content => renderToStaticMarkup(React.createElement(MarkdownRenderer, { content }))
  const python = render('```python\nprint("<hello>")\n```')
  assert.match(python, /Python/)
  assert.match(python, /<img /)
  assert.match(python, /hljs-/)
  assert.match(python, /&lt;hello&gt;/)
  assert.match(render('```\npython script.py --help\n```'), /Shell/)
  const unknown = render('```unknownlang\n<script>alert(1)<\/script>\n```')
  assert.match(unknown, /unknownlang/)
  assert.doesNotMatch(unknown, /<script>/)
})

test('finished terminal cards start closed even after an error or session restore', () => {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const { ToolCallCard } = load('src/renderer/src/components/tools/ToolCallCard.tsx')
  const render = status => renderToStaticMarkup(React.createElement(ToolCallCard, { tool: { id: 'terminal', type: 'terminal', label: 'Терминал', targetName: 'test', content: 'output', status, defaultExpanded: true } }))
  assert.match(render('running'), /grid-rows-\[1fr\]/)
  assert.match(render('completed'), /grid-rows-\[0fr\]/)
  assert.match(render('error'), /grid-rows-\[0fr\]/)
})

test('streaming file cards show live line counts and keep the final diff', () => {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const { ToolCallCard } = load('src/renderer/src/components/tools/ToolCallCard.tsx')
  const render = tool => renderToStaticMarkup(React.createElement(ToolCallCard, { tool, isExpanded: true }))
  const running = render({ id: 'file', type: 'file_edit', label: 'Написал', targetName: 'a.ts', content: 'new line', baseline: '', status: 'running' })
  assert.match(running, /\+<number-flow-react/)
  assert.match(running, /aria-label="1"/)
  assert.match(running, /aria-label="0"/)
  const next = render({ id: 'file', type: 'file_edit', label: 'Написал', targetName: 'a.ts', content: 'new line\nsecond\nthird', baseline: '', status: 'running' })
  assert.match(next, /aria-label="3"/)
  const edit = render({ id: 'edit', type: 'file_edit', label: 'Отредактировал', targetName: 'a.ts', content: 'replacement\nextra', streamTarget: 'old\n', status: 'running' })
  assert.match(edit, /aria-label="2"/)
  assert.match(edit, /aria-label="1"/)
  assert.doesNotMatch(running, /animate-pulse|transition-\[grid-template-rows/)
  const completed = render({ id: 'file', type: 'file_edit', label: 'Написал', targetName: 'a.ts', content: '+new line', diff: { added: 1, removed: 0 }, status: 'completed' })
  assert.match(completed, /aria-label="1"/)
})

test('live line counts handle empty, unchanged and large rewritten files', () => {
  const { computeStreamingDiffCounts } = load('src/renderer/src/components/tools/utils/toolHelpers.ts')
  assert.equal(computeStreamingDiffCounts(undefined, 'content'), null)
  assert.deepEqual(computeStreamingDiffCounts('', ''), { added: 0, removed: 0 })
  assert.deepEqual(computeStreamingDiffCounts('', 'first\nsecond\n'), { added: 2, removed: 0 })
  assert.deepEqual(computeStreamingDiffCounts('same\n', 'same\n'), { added: 0, removed: 0 })
  const oldText = 'before\n'.repeat(300)
  const newText = 'after\n'.repeat(400)
  assert.deepEqual(computeStreamingDiffCounts(oldText, newText), { added: 400, removed: 300 })
})

test('stream panels follow only when the reader is near the bottom', () => {
  const { isNearBottom } = load('src/renderer/src/hooks/useFollowStream.ts')
  assert.equal(isNearBottom({ scrollHeight: 1000, clientHeight: 300, scrollTop: 700 }), true)
  assert.equal(isNearBottom({ scrollHeight: 1000, clientHeight: 300, scrollTop: 500 }), false)
})

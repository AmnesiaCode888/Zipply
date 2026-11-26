const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')

function load(file) {
  const source = path.resolve(file)
  const built = buildSync({ entryPoints: [source], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const mod = new Module(source, module); mod.filename = source; mod.paths = module.paths
  mod._compile(built.outputFiles[0].text, source)
  return mod.exports
}

test('tool schema builder forwards bounds and omits presentation-only activity', () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const tool = {
    name: 'bounded', description: 'test',
    parameters: {
      count: { type: 'integer', description: 'count', minimum: 1, maximum: 5 },
      files: { type: 'array', description: 'files', minItems: 1, maxItems: 3, items: { type: 'string', minLength: 1 } }
    },
    getExecutionPolicy: () => ({ mutates: false })
  }
  const [definition] = ToolExecutor.buildToolDefs({ getTools: () => [tool] })
  const properties = definition.function.parameters.properties
  assert.equal(properties.activity, undefined)
  assert.deepEqual([properties.count.minimum, properties.count.maximum], [1, 5])
  assert.deepEqual([properties.files.minItems, properties.files.maxItems], [1, 3])
})

test('web tools expose their existing output limits and batch schemas describe line ranges', () => {
  const { SearchTool } = load('src/main/agent/tools/SearchTool.ts')
  const { WebTool } = load('src/main/agent/tools/WebTool.ts')
  const { ReadFilesTool } = load('src/main/agent/tools/ReadFilesTool.ts')
  const search = new SearchTool().parameters
  const web = new WebTool().parameters
  const files = new ReadFilesTool().parameters.files

  assert.deepEqual([search.max_results.minimum, search.max_results.maximum, search.max_results.default], [1, 6, 6])
  assert.deepEqual([web.max_chars.minimum, web.max_chars.maximum, web.max_chars.default], [1000, 25000, 25000])
  assert.deepEqual([files.minItems, files.maxItems], [1, 10])
  assert.deepEqual([files.items.properties.start_line.minimum, files.items.properties.line_count.minimum, files.items.properties.line_count.maximum], [1, 1, 600])
})

test('file, process, patch and question schemas advertise runtime bounds', () => {
  const { ApplyPatchTool } = load('src/main/agent/tools/ApplyPatchTool.ts')
  const { AskUserTool } = load('src/main/agent/tools/AskUserTool.ts')
  const { ProcessTool } = load('src/main/agent/tools/ProcessTool.ts')
  const { ProjectSearchTool } = load('src/main/agent/tools/ProjectSearchTool.ts')
  const { FindFilesTool } = load('src/main/agent/tools/FindFilesTool.ts')
  const patch = new ApplyPatchTool().parameters.operations
  const questions = new AskUserTool().parameters
  const poll = new ProcessTool('poll').parameters
  const projectSearch = new ProjectSearchTool().parameters
  const findFiles = new FindFilesTool().parameters

  assert.deepEqual([patch.minItems, patch.maxItems, patch.items.properties.edits.minItems, patch.items.properties.edits.maxItems], [1, 20, 1, 50])
  assert.deepEqual([questions.questions.minItems, questions.questions.maxItems, questions.options.maxItems], [1, 4, 8])
  assert.deepEqual([poll.wait_ms.minimum, poll.wait_ms.maximum, poll.cursor.minimum], [0, 10000, 0])
  assert.deepEqual([projectSearch.context_lines.minimum, projectSearch.context_lines.maximum, projectSearch.limit.minimum, projectSearch.limit.maximum], [0, 5, 1, 200])
  assert.deepEqual([findFiles.limit.minimum, findFiles.limit.maximum], [1, 200])
})

test('tool strategy stays short after routing details move to tool descriptions', () => {
  const { ToolStrategyProvider } = load('src/main/agent/core/PromptProviders.ts')
  const prompt = ToolStrategyProvider.render()
  assert.ok(prompt.length < 1000)
  assert.doesNotMatch(prompt, /activity/)
  assert.match(prompt, /exec_command/)
  assert.match(prompt, /update_plan/)
  assert.match(prompt, /apply_patch/)
})

test('explicitly selected plugins are used directly instead of rediscovering tools and skills', () => {
  const { ToolStrategyProvider, AvailablePluginsProvider } = load('src/main/agent/core/PromptProviders.ts')
  const strategy = ToolStrategyProvider.render()
  const available = AvailablePluginsProvider.render({ availablePluginsSummary: '- SQLite (sqlite): read-only inspection' })
  assert.match(strategy, /явно выбрал плагин/i)
  assert.match(strategy, /без поиска/i)
  assert.match(available, /плагин выбран.*напрямую/i)
})

test('read-only runtime instructions explain blocked creation without asking for a schema', () => {
  const { RuntimeContextProvider } = load('src/main/agent/core/PromptProviders.ts')
  const readOnly = RuntimeContextProvider.render({}, { accessMode: 'read-only' })
  const writable = RuntimeContextProvider.render({}, { accessMode: 'confirm' })
  assert.match(readOnly, /нельзя создавать.*изменять.*удалять файлы/i)
  assert.match(readOnly, /не задавай уточняющих вопросов о содержимом, схеме/i)
  assert.doesNotMatch(writable, /read_only_mode/)
})

test('search_web honors max_results while preserving its default of six', async () => {
  const { SearchTool } = load('src/main/agent/tools/SearchTool.ts')
  const sources = Array.from({ length: 6 }, (_, index) => ({ title: `Title ${index}`, url: `https://example.com/${index}`, domain: 'example.com' }))
  const board = {
    getArtifact: key => key === 'authFetch'
      ? async () => Response.json({ query: 'test', snippets: 'summary', sources })
      : undefined
  }
  const result = await new SearchTool().execute(JSON.stringify({ query: 'test', max_results: 2 }), board)
  assert.equal(result.data.results.length, 2)
  const defaults = await new SearchTool().execute(JSON.stringify({ query: 'test' }), board)
  assert.equal(defaults.data.results.length, 6)
})

test('read_page honors max_chars and keeps 25000 as the default', async () => {
  const { WebTool } = load('src/main/agent/tools/WebTool.ts')
  const originalFetch = global.fetch
  global.fetch = async () => new Response(`<main>${'x'.repeat(30000)}</main>`, { headers: { 'content-type': 'text/html' } })
  try {
    const tool = new WebTool()
    const short = await tool.execute(JSON.stringify({ url: 'https://example.com', max_chars: 1000 }), {})
    assert.ok(short.data.content.startsWith('x'.repeat(1000)))
    assert.ok(short.data.content.length < 1100)
    assert.equal(short.data.truncated, true)
    const defaults = await tool.execute(JSON.stringify({ url: 'https://example.com' }), {})
    assert.ok(defaults.data.content.startsWith('x'.repeat(25000)))
    assert.ok(defaults.data.content.length < 25100)
  } finally { global.fetch = originalFetch }
})

test('read_page rejects malformed URLs and non-HTTP redirect destinations', async () => {
  const { WebTool } = load('src/main/agent/tools/WebTool.ts')
  const tool = new WebTool()
  assert.match(tool.validate(JSON.stringify({ url: 'https://not a URL' })), /корректный полный URL/i)
  const originalFetch = global.fetch
  global.fetch = async () => {
    const response = new Response('<main>must not be read</main>', { headers: { 'content-type': 'text/html' } })
    Object.defineProperty(response, 'url', { value: 'file:///private/page.html' })
    return response
  }
  try {
    const result = await tool.execute(JSON.stringify({ url: 'https://example.com' }), {})
    assert.equal(result.error, true)
    assert.match(result.formattedContent, /конечный URL/i)
  } finally { global.fetch = originalFetch }
})

test('the registry contains only zipply and routes legacy or unknown IDs to it', () => {
  const { agentRegistry } = load('src/main/agent/core/AgentRegistry.ts')
  const zipply = agentRegistry.getAgent('zipply')
  assert.deepEqual(agentRegistry.getAgents().map(agent => agent.id), ['zipply'])
  for (const id of ['web_search', 'yand', 'search', 'web', 'ask', 'unknown']) assert.equal(agentRegistry.getAgent(id), zipply)
})

test('renderer derives a useful activity label when a tool call omits activity', () => {
  const { applyEventToBlocks } = load('src/renderer/src/hooks/useChat.ts')
  const blocks = []
  applyEventToBlocks({ type: 'tool_start', callId: 'read-1', toolName: 'read_file', args: { path: 'src/App.tsx' } }, blocks, { id: 'm', role: 'assistant' })
  assert.equal(blocks[0].tool.activity, 'Читаю файл src/App.tsx')
})

test('list_dir reports a directory read failure instead of presenting an empty folder', async () => {
  const { ListDirTool } = load('src/main/agent/tools/ListDirTool.ts')
  const root = await fs.mkdtemp(path.join(process.cwd(), '.tool-list-dir-'))
  const originalReaddir = fs.readdir
  try {
    const tool = new ListDirTool()
    const board = { getArtifact: () => ({ workspacePath: root }) }
    const empty = await tool.execute('{"path":"."}', board)
    assert.equal(empty.success, true)
    assert.match(empty.formattedContent, /папка пуста/i)

    fs.readdir = async () => { throw new Error('permission denied') }
    const failed = await tool.execute('{"path":"."}', board)
    assert.equal(failed.error, true)
    assert.match(failed.formattedContent, /permission denied/i)
    assert.doesNotMatch(failed.formattedContent, /папка пуста/i)
  } finally {
    fs.readdir = originalReaddir
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('write_file returns summary without unified diff on new file, and unified diff on edit', async () => {
  const { WriteFileTool } = load('src/main/agent/tools/WriteFileTool.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const root = await fs.mkdtemp(path.join(process.cwd(), '.tool-write-file-'))
  try {
    const tool = new WriteFileTool()
    const board = new Blackboard()
    board.setArtifact('config', { workspacePath: root })

    const created = await tool.execute(JSON.stringify({ path: 'new.txt', content: 'hello world\nline 2' }), board)
    assert.equal(created.success, true)
    assert.equal(created.data.isNewFile, true)
    assert.match(created.formattedContent, /успешно создан/i)
    assert.doesNotMatch(created.formattedContent, /@@/)

    const overwritten = await tool.execute(JSON.stringify({ path: 'new.txt', content: 'hello world\nline 2 edited' }), board)
    assert.equal(overwritten.success, true)
    assert.equal(overwritten.data.isNewFile, false)
    assert.match(overwritten.formattedContent, /@@/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('read_page paginates long text with offset_chars', async () => {
  const { WebTool } = load('src/main/agent/tools/WebTool.ts')
  const originalFetch = global.fetch
  global.fetch = async () => new Response('<main>abcdefghijklmnopqrstuvwxyz</main>', { headers: { 'content-type': 'text/html' } })
  try {
    const tool = new WebTool()
    const page1 = await tool.execute(JSON.stringify({ url: 'https://example.com', offset_chars: 0, max_chars: 1000 }), {})
    assert.equal(page1.data.content, 'abcdefghijklmnopqrstuvwxyz')
    assert.equal(page1.data.offset_chars, 0)

    const page2 = await tool.execute(JSON.stringify({ url: 'https://example.com', offset_chars: 10, max_chars: 1000 }), {})
    assert.equal(page2.data.content, 'klmnopqrstuvwxyz')
    assert.equal(page2.data.offset_chars, 10)
  } finally {
    global.fetch = originalFetch
  }
})

test('terminal spawn env contains non-interactive CLI flags', async () => {
  const { TerminalTool } = load('src/main/agent/tools/TerminalTool.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const tool = new TerminalTool()
  const board = new Blackboard()
  board.setArtifact('config', { workspacePath: process.cwd() })
  const command = process.platform === 'win32'
    ? '$env:CI + ";" + $env:TERM + ";" + $env:DEBIAN_FRONTEND + ";" + $env:NO_COLOR'
    : 'echo "$CI;$TERM;$DEBIAN_FRONTEND;$NO_COLOR"'
  const result = await tool.execute(JSON.stringify({ command }), board)
  assert.equal(result.success, true)
  assert.match(result.data.stdout, /true;dumb;noninteractive;1/)
})

test('SandwichReminderProvider returns null when rendered and ToolStrategyProvider stays under 1000 chars', () => {
  const { SandwichReminderProvider, ToolStrategyProvider } = load('src/main/agent/core/PromptProviders.ts')
  assert.equal(SandwichReminderProvider.render(), null)
  const rendered = ToolStrategyProvider.render()
  assert.ok(rendered.length < 1000)
  assert.match(rendered, /exec_command/)
  assert.match(rendered, /spawn_agent/)
  assert.match(rendered, /apply_patch/)
})

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')

function load(file) {
  const result = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const mod = new Module(path.resolve(file), module)
  mod.filename = path.resolve(file)
  mod.paths = module.paths
  mod._compile(result.outputFiles[0].text, mod.filename)
  return mod.exports
}

const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
const { ReadFileTool } = load('src/main/agent/tools/ReadFileTool.ts')
const { ReadFilesTool } = load('src/main/agent/tools/ReadFilesTool.ts')
const { FindFilesTool } = load('src/main/agent/tools/FindFilesTool.ts')
const { ProjectSearchTool } = load('src/main/agent/tools/ProjectSearchTool.ts')
const { ApplyPatchTool } = load('src/main/agent/tools/ApplyPatchTool.ts')
const { ExecCommandTool } = load('src/main/agent/tools/ExecCommandTool.ts')

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-files-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const board = new Blackboard()
  board.setArtifact('config', { workspacePath: dir, accessMode: 'automatic' })
  return { dir, board }
}

async function execute(tool, args, board, cache = new Map()) {
  const messages = []
  const events = []
  await ToolExecutor.executeCalls({ getHandler: () => tool }, [
    { id: 'call', name: tool.name, argumentsJson: JSON.stringify(args) }
  ], messages, board, event => events.push(event), undefined, cache)
  return { content: messages[0].content, result: events.find(event => event.type === 'tool_result') }
}

test('project content search reflects external edits with the same cache and query', async t => {
  const { dir, board } = await fixture(t)
  const file = path.join(dir, 'a.txt')
  const tool = new ProjectSearchTool()
  const args = { query: 'MARKER' }
  const cache = new Map()
  await fs.writeFile(file, 'MARKER: BEFORE')
  assert.match((await execute(tool, args, board, cache)).content, /MARKER: BEFORE/)
  await fs.writeFile(file, 'MARKER: AFTER!')
  const { content } = await execute(tool, args, board, cache)
  assert.match(content, /MARKER: AFTER!/)
  assert.doesNotMatch(content, /BEFORE/)
})

test('file search reflects external changes inside an existing subdirectory', async t => {
  const { dir, board } = await fixture(t)
  const subdir = path.join(dir, 'src')
  const tool = new FindFilesTool()
  const args = { pattern: '**/*.txt' }
  const cache = new Map()
  await fs.mkdir(subdir)
  await fs.writeFile(path.join(subdir, 'one.txt'), '')
  assert.match((await execute(tool, args, board, cache)).content, /one\.txt/)
  await fs.rename(path.join(subdir, 'one.txt'), path.join(subdir, 'two.txt'))
  const { content } = await execute(tool, args, board, cache)
  assert.match(content, /two\.txt/)
  assert.doesNotMatch(content, /one\.txt/)
})

test('repository-wide search discloses its size limit and counts skipped files in a narrow scope', async t => {
  const { dir, board } = await fixture(t)
  await fs.writeFile(path.join(dir, 'large.txt'), 'large only needle\n' + 'a'.repeat(1_100_000))
  const tool = new ProjectSearchTool()
  const { content, result } = await execute(tool, { query: 'large only needle' }, board)
  assert.match(content, /1 МБ/)
  assert.match(content, /пропущ|исключ/i)
  assert.match(content, /"partial":true/)
  assert.equal(result.data.skippedLargeFiles, result.data.engine === 'rg' ? null : 1)
  const scoped = await tool.execute(JSON.stringify({ query: 'large only needle', glob: 'large.txt' }), board)
  assert.equal(scoped.data.skippedLargeFiles, 1)
})

test('batch read reports the ranges actually returned and exposes skipped requests in the model message', async t => {
  const { dir, board } = await fixture(t)
  const files = Array.from({ length: 7 }, (_, index) => ({ path: `large-${index}.txt`, start_line: 11, line_count: 130 }))
  const source = Array.from({ length: 170 }, (_, index) => `ROW_${index + 1}_${'a'.repeat(90)}`).join('\n')
  await Promise.all(files.map(file => fs.writeFile(path.join(dir, file.path), source)))
  const { content, result } = await execute(new ReadFilesTool(), { files }, board)
  const first = result.data.files[0].data
  const firstBlock = content.split('\n\n')[0]
  const lineNumbers = Array.from(firstBlock.matchAll(/^\s*(\d+) \| ROW_\d+_/gm), match => Number(match[1]))
  assert.equal(lineNumbers[0], 11)
  assert.equal(first.endLine, lineNumbers.at(-1))
  assert.equal(first.nextStartLine, first.endLine + 1)
  assert.match(firstBlock, new RegExp(`start_line=${first.nextStartLine}\\b`))
  assert.equal(result.data.files.at(-1).omitted, true)
  assert.equal(result.data.files.at(-1).data.nextStartLine, 11)
  assert.match(content, /(?:пропущ|не прочитан)[^\n]*large-6\.txt/i)
  assert.ok(content.length <= 28_000)
})

test('batch read model output preserves all returned lines within the character budget', async t => {
  const { dir, board } = await fixture(t)
  await fs.writeFile(path.join(dir, 'small.txt'), Array.from({ length: 350 }, (_, index) => `item_${index + 1}`).join('\n'))
  const { content } = await execute(new ReadFilesTool(), { files: [{ path: 'small.txt' }] }, board)
  assert.match(content, /200 \| item_200/)
  assert.match(content, /350 \| item_350/)
  assert.doesNotMatch(content, /ВЫВОД УСЕЧЕН/)
})

test('failed command sends its compact error and exit codes with the model result', async t => {
  const { dir, board } = await fixture(t)
  board.setArtifact('config', { workspacePath: dir, accessMode: 'automatic', sandbox: { profile: 'unrestricted', network: 'on' } })
  const { content, result } = await execute(new ExecCommandTool(), { command: 'node -e "process.exit(7)"' }, board)
  assert.equal(result.error, true)
  assert.match(content, /"errorCode":"EXIT_7"/)
  assert.match(content, /"exitCode":7/)
})

test('patch hunks with ordered @@ anchors edit repeated lines at the intended locations', async t => {
  const { dir, board } = await fixture(t)
  const file = path.join(dir, 'sample.txt')
  await fs.writeFile(file, 'first\r\nrepeat\r\nsecond\r\nrepeat\r\nthird\r\nrepeat\r\n')
  const patch = [
    '*** Begin Patch', '*** Update File: sample.txt',
    '@@ second', '-repeat', '+selected second',
    '@@ third', '-repeat', '+selected third',
    '*** End Patch'
  ].join('\n')
  const result = await new ApplyPatchTool().execute(JSON.stringify({ patch }), board)
  assert.equal(result.success, true, result.formattedContent)
  assert.equal(await fs.readFile(file, 'utf8'), 'first\r\nrepeat\r\nsecond\r\nselected second\r\nthird\r\nselected third\r\n')
})

test('patch with an out-of-order anchor leaves all files unchanged', async t => {
  const { dir, board } = await fixture(t)
  const file = path.join(dir, 'sample.txt')
  const source = 'first\nold first\nsecond\nold second\n'
  await fs.writeFile(file, source)
  const patch = [
    '*** Begin Patch', '*** Add File: untouched.txt', '+created', '*** Update File: sample.txt',
    '@@ second', '-old second', '+new second',
    '@@ first', '-old first', '+new first',
    '*** End Patch'
  ].join('\n')
  const result = await new ApplyPatchTool().execute(JSON.stringify({ patch }), board)
  assert.equal(result.error, true, result.formattedContent)
  assert.equal(await fs.readFile(file, 'utf8'), source)
  await assert.rejects(fs.access(path.join(dir, 'untouched.txt')), { code: 'ENOENT' })
})

test('patch rejects a repeated target when the hunk provides no anchor or context', async t => {
  const { dir, board } = await fixture(t)
  const file = path.join(dir, 'sample.txt')
  const source = 'repeat\nrepeat\n'
  await fs.writeFile(file, source)
  const patch = ['*** Begin Patch', '*** Update File: sample.txt', '@@', '-repeat', '+new', '*** End Patch'].join('\n')
  const result = await new ApplyPatchTool().execute(JSON.stringify({ patch }), board)
  assert.equal(result.error, true, result.formattedContent)
  assert.equal(await fs.readFile(file, 'utf8'), source)
})

test('patch with a valid anchor rejects content changed after the last read', async t => {
  const { dir, board } = await fixture(t)
  const file = path.join(dir, 'sample.txt')
  const source = 'anchor\nold value\n'
  await fs.writeFile(file, source)
  assert.equal((await new ReadFileTool().execute(JSON.stringify({ path: 'sample.txt' }), board)).success, true)
  const edited = `${source}external change\n`
  await fs.writeFile(file, edited)
  const patch = ['*** Begin Patch', '*** Update File: sample.txt', '@@ anchor', '-old value', '+new value', '*** End Patch'].join('\n')
  const result = await new ApplyPatchTool().execute(JSON.stringify({ patch }), board)
  assert.equal(result.error, true, result.formattedContent)
  assert.match(result.formattedContent, /последнего чтения/)
  assert.equal(await fs.readFile(file, 'utf8'), edited)
})

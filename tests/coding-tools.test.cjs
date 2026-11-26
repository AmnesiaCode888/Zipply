const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
function load(file) { const result = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' }); const mod = new Module(path.resolve(file), module); mod.filename = path.resolve(file); mod.paths = module.paths; mod._compile(result.outputFiles[0].text, mod.filename); return mod.exports }
async function fixture(fn) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-coding-')); const { Blackboard } = load('src/main/agent/core/Blackboard.ts'); const board = new Blackboard(); board.setArtifact('config', { workspacePath: dir }); try { await fn(dir, board) } finally { await fs.rm(dir, { recursive: true, force: true }) } }
test('search supports regular expressions, case sensitivity, glob, context and explicit result limits', async () => fixture(async (dir, board) => {
  await fs.writeFile(path.join(dir, 'a.ts'), 'before\nAlpha 42\nafter\nAlpha 44\n')
  await fs.writeFile(path.join(dir, 'b.js'), 'Alpha 42\n')
  const { ProjectSearchTool } = load('src/main/agent/tools/ProjectSearchTool.ts')
  const result = await new ProjectSearchTool().execute(JSON.stringify({ query: 'Alpha \\d+', regex: true, case_sensitive: true, glob: '*.ts', context_lines: 1, limit: 1 }), board)
  assert.equal(result.error, undefined); assert.match(result.formattedContent, /a\.ts:2:Alpha 42/); assert.match(result.formattedContent, /before/); assert.doesNotMatch(result.formattedContent, /b\.js/); assert.match(result.formattedContent, /усеч|огранич/i)
  const absent = await new ProjectSearchTool().execute(JSON.stringify({ query: 'alpha', case_sensitive: true }), board)
  assert.match(absent.formattedContent, /не найден/i)
}))
test('glob file search respects gitignore, including in the fallback without rg', async () => fixture(async (dir, board) => {
  await fs.mkdir(path.join(dir, 'src')); await fs.writeFile(path.join(dir, '.gitignore'), 'src/ignored.ts\n'); await fs.writeFile(path.join(dir, 'src', 'ok.ts'), 'x'); await fs.writeFile(path.join(dir, 'src', 'ignored.ts'), 'x'); await fs.writeFile(path.join(dir, 'src', 'skip.js'), 'x')
  const { FindFilesTool } = load('src/main/agent/tools/FindFilesTool.ts'); const previous = process.env.PATH; process.env.PATH = ''
  try { const result = await new FindFilesTool().execute(JSON.stringify({ pattern: '**/*.ts' }), board); assert.match(result.formattedContent, /src\/ok\.ts/); assert.doesNotMatch(result.formattedContent, /ignored|skip/) } finally { process.env.PATH = previous }
}))
test('batch read returns independent requested ranges and reports missing files', async () => fixture(async (dir, board) => {
  await fs.writeFile(path.join(dir, 'a.txt'), 'one\ntwo\nthree\n'); await fs.writeFile(path.join(dir, 'b.txt'), 'first\nsecond\n')
  const { ReadFilesTool } = load('src/main/agent/tools/ReadFilesTool.ts'); const result = await new ReadFilesTool().execute(JSON.stringify({ files: [{ path: 'a.txt', start_line: 2, line_count: 1 }, { path: 'b.txt', start_line: 1, line_count: 1 }, { path: 'missing.txt' }] }), board)
  assert.match(result.formattedContent, /two/); assert.doesNotMatch(result.formattedContent, /three/); assert.match(result.formattedContent, /first/); assert.doesNotMatch(result.formattedContent, /second/); assert.match(result.formattedContent, /missing\.txt/)
}))
test('multiple replacements are applied together only if all targets are unique', async () => fixture(async (dir, board) => {
  const file = path.join(dir, 'a.txt'); await fs.writeFile(file, 'one\ntwo\nthree\n'); const { EditFileTool } = load('src/main/agent/tools/EditFileTool.ts'); const tool = new EditFileTool()
  const rejected = await tool.execute(JSON.stringify({ path: 'a.txt', edits: [{ target: 'one', replacement: 'ONE' }, { target: 'missing', replacement: 'X' }] }), board)
  assert.equal(rejected.error, true); assert.equal(await fs.readFile(file, 'utf8'), 'one\ntwo\nthree\n')
  const success = await tool.execute(JSON.stringify({ path: 'a.txt', edits: [{ target: 'one', replacement: 'ONE' }, { target: 'three', replacement: 'THREE' }] }), board)
  assert.equal(success.error, undefined); assert.equal(await fs.readFile(file, 'utf8'), 'ONE\ntwo\nTHREE\n')
}))
test('search respects ancestor ignores and later nested negations for a selected subdirectory', async () => fixture(async (dir, board) => {
  await fs.mkdir(path.join(dir, 'src', 'nested'), { recursive: true }); await fs.writeFile(path.join(dir, '.gitignore'), '*.txt\n'); await fs.writeFile(path.join(dir, 'src', '.gitignore'), '!keep.txt\n'); await fs.writeFile(path.join(dir, 'src', 'keep.txt'), 'needle'); await fs.writeFile(path.join(dir, 'src', 'ignored.txt'), 'needle'); await fs.writeFile(path.join(dir, 'src', 'nested', 'skip.txt'), 'needle')
  const { ProjectSearchTool } = load('src/main/agent/tools/ProjectSearchTool.ts'); const result = await new ProjectSearchTool().execute(JSON.stringify({ path: 'src', query: 'needle' }), board)
  assert.match(result.formattedContent, /keep\.txt/); assert.doesNotMatch(result.formattedContent, /ignored\.txt|skip\.txt/)
}))
test('search and glob traversal do not follow symlinks into external directories', async t => fixture(async (dir, board) => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-external-'))
  try {
    await fs.writeFile(path.join(outside, 'private.ts'), 'hidden needle')
    try { await fs.symlink(outside, path.join(dir, 'link'), process.platform === 'win32' ? 'junction' : 'dir') } catch (e) { if (['EPERM', 'EACCES'].includes(e.code)) { t.skip('symlink not available'); return } throw e }
    const { ProjectSearchTool } = load('src/main/agent/tools/ProjectSearchTool.ts'); const { FindFilesTool } = load('src/main/agent/tools/FindFilesTool.ts')
    for (const args of [{ query: 'needle' }, { query: 'needle', glob: '**/*.ts' }]) { const result = await new ProjectSearchTool().execute(JSON.stringify(args), board); assert.doesNotMatch(result.formattedContent, /private|hidden/) }
    const files = await new FindFilesTool().execute(JSON.stringify({ pattern: '**/*.ts' }), board); assert.doesNotMatch(files.formattedContent, /private/)
  } finally { await fs.rm(outside, { recursive: true, force: true }) }
}))
test('fallback preserves regex, Unicode, case sensitivity, context and limits when rg is absent', async () => fixture(async (dir, board) => {
  await fs.writeFile(path.join(dir, 'a.ts'), 'до\nПривет 1\nпосле\nпривет 2\nПривет 3\n')
  const { ProjectSearchTool } = load('src/main/agent/tools/ProjectSearchTool.ts'); const previous = process.env.PATH; process.env.PATH = ''
  try { const result = await new ProjectSearchTool().execute(JSON.stringify({ query: 'Привет [0-9]', regex: true, case_sensitive: true, context_lines: 1, limit: 1 }), board); assert.match(result.formattedContent, /a\.ts:2:Привет 1/); assert.match(result.formattedContent, /до/); assert.match(result.formattedContent, /огранич/); assert.doesNotMatch(result.formattedContent, /Привет 3/) } finally { process.env.PATH = previous }
}))
test('batch read reports partial failures and limits total content', async () => fixture(async (dir, board) => {
  await fs.writeFile(path.join(dir, 'long.txt'), ('x'.repeat(100) + '\n').repeat(150)); const { ReadFilesTool } = load('src/main/agent/tools/ReadFilesTool.ts')
  const result = await new ReadFilesTool().execute(JSON.stringify({ files: [{ path: 'long.txt' }, { path: 'missing.txt' }] }), board)
  assert.equal(result.error, true); assert.equal(result.data.files.length, 2); assert.match(result.formattedContent, /огранич/); assert.match(result.formattedContent, /missing\.txt/); assert.ok(result.formattedContent.length < 12000)
}))
test('multiple replacement rejects an ambiguous later edit without writing earlier changes', async () => fixture(async (dir, board) => {
  const file = path.join(dir, 'a.txt'); await fs.writeFile(file, 'first\nrepeat\nrepeat\n'); const { EditFileTool } = load('src/main/agent/tools/EditFileTool.ts')
  const result = await new EditFileTool().execute(JSON.stringify({ path: 'a.txt', edits: [{ target: 'first', replacement: 'done' }, { target: 'repeat', replacement: 'changed' }] }), board)
  assert.equal(result.error, true); assert.equal(await fs.readFile(file, 'utf8'), 'first\nrepeat\nrepeat\n')
}))

test('batch read metadata does not expose unbounded file content', async () => fixture(async (dir, board) => {
  await fs.writeFile(path.join(dir, 'long.txt'), ('abcdefghij\n').repeat(1000)); const { ReadFilesTool } = load('src/main/agent/tools/ReadFilesTool.ts')
  const result = await new ReadFilesTool().execute(JSON.stringify({ files: [{ path: 'long.txt' }] }), board)
  assert.equal(Object.hasOwn(result.data.files[0].data, 'content'), false); assert.equal(result.data.files[0].data.path, 'long.txt'); assert.equal(result.data.files[0].data.totalLines, 1001)
}))
test('fallback discloses files skipped because they exceed its size limit', async () => fixture(async (dir, board) => {
  await fs.writeFile(path.join(dir, 'large.txt'), 'needle'.repeat(180000)); const { ProjectSearchTool } = load('src/main/agent/tools/ProjectSearchTool.ts')
  const result = await new ProjectSearchTool().execute(JSON.stringify({ query: 'needle', glob: '*.txt' }), board)
  assert.match(result.formattedContent, /1.*(?:файл|пропущ)/i); assert.equal(result.data.skippedLargeFiles, 1)
}))
test('multiple replacement rejects targets that overlap in the original file', async () => fixture(async (dir, board) => {
  const file = path.join(dir, 'a.txt'); await fs.writeFile(file, 'abcde'); const { EditFileTool } = load('src/main/agent/tools/EditFileTool.ts')
  const result = await new EditFileTool().execute(JSON.stringify({ path: 'a.txt', edits: [{ target: 'abc', replacement: 'abc' }, { target: 'bcd', replacement: 'X' }] }), board)
  assert.equal(result.error, true); assert.equal(await fs.readFile(file, 'utf8'), 'abcde')
}))
test('multiple replacement rejects targets created by a previous replacement', async () => fixture(async (dir, board) => {
  const file = path.join(dir, 'a.txt'); await fs.writeFile(file, 'old tail'); const { EditFileTool } = load('src/main/agent/tools/EditFileTool.ts')
  const result = await new EditFileTool().execute(JSON.stringify({ path: 'a.txt', edits: [{ target: 'old', replacement: 'new' }, { target: 'new', replacement: 'done' }] }), board)
  assert.equal(result.error, true); assert.equal(await fs.readFile(file, 'utf8'), 'old tail')
}))

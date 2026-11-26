const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const { createHash } = require('node:crypto')
function load(file) { const r = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' }); const m = new Module(path.resolve(file), module); m.filename = path.resolve(file); m.paths = module.paths; m._compile(r.outputFiles[0].text, m.filename); return m.exports }
async function fixture(fn) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-patch-')); const { Blackboard } = load('src/main/agent/core/Blackboard.ts'); const board = new Blackboard(); board.setArtifact('config', { workspacePath: dir, accessMode: 'automatic' }); try { await fn(dir, board) } finally { await fs.rm(dir, { recursive: true, force: true }) } }
const ops = [{ path: 'a.txt', action: 'update', edits: [{ target: 'one', replacement: 'ONE' }] }, { path: 'b.txt', action: 'update', edits: [{ target: 'two', replacement: 'TWO' }] }]

test('batch prepares every file before applying edits', async () => fixture(async (dir, board) => {
  await fs.writeFile(path.join(dir, 'a.txt'), 'one\r\n'); await fs.writeFile(path.join(dir, 'b.txt'), 'two\n')
  const { ApplyPatchTool } = load('src/main/agent/tools/ApplyPatchTool.ts'); const tool = new ApplyPatchTool()
  const invalid = structuredClone(ops); invalid[1].edits[0].target = 'missing'
  assert.equal((await tool.execute(JSON.stringify({ operations: invalid }), board)).error, true)
  assert.equal(await fs.readFile(path.join(dir, 'a.txt'), 'utf8'), 'one\r\n')
  const result = await tool.execute(JSON.stringify({ operations: ops }), board)
  assert.equal(result.success, true, result.formattedContent)
  assert.equal(await fs.readFile(path.join(dir, 'a.txt'), 'utf8'), 'ONE\r\n')
  assert.equal(await fs.readFile(path.join(dir, 'b.txt'), 'utf8'), 'TWO\n')
}))

test('approval sees both diffs and concurrent edits prevent the entire package', async () => fixture(async (dir, board) => {
  await fs.writeFile(path.join(dir, 'a.txt'), 'one'); await fs.writeFile(path.join(dir, 'b.txt'), 'two')
  let details = ''
  board.setArtifact('config', { workspacePath: dir, accessMode: 'confirm', confirmAction: async action => { details = action.details; await fs.writeFile(path.join(dir, 'b.txt'), 'changed'); return true } })
  const { ApplyPatchTool } = load('src/main/agent/tools/ApplyPatchTool.ts')
  const result = await new ApplyPatchTool().execute(JSON.stringify({ operations: ops }), board)
  assert.equal(result.error, true); assert.match(details, /a\.txt/); assert.match(details, /b\.txt/)
  assert.equal(await fs.readFile(path.join(dir, 'a.txt'), 'utf8'), 'one')
  assert.equal(await fs.readFile(path.join(dir, 'b.txt'), 'utf8'), 'changed')
}))

test('denied package and external paths leave files unchanged', async () => fixture(async (dir, board) => {
  await fs.writeFile(path.join(dir, 'a.txt'), 'one'); await fs.writeFile(path.join(dir, 'b.txt'), 'two')
  board.setArtifact('config', { workspacePath: dir, accessMode: 'confirm', confirmAction: async () => false })
  const { ApplyPatchTool } = load('src/main/agent/tools/ApplyPatchTool.ts'); const tool = new ApplyPatchTool()
  assert.equal((await tool.execute(JSON.stringify({ operations: ops }), board)).error, true)
  assert.equal(await fs.readFile(path.join(dir, 'a.txt'), 'utf8'), 'one')
  assert.equal((await tool.execute(JSON.stringify({ operations: [{ path: '../outside.txt', action: 'create', content: 'x' }] }), board)).error, true)
}))

test('a failure cleaning the temporary link rolls back the created file', async () => fixture(async (dir, board) => {
  const realUnlink = fs.unlink; let injected = false
  fs.unlink = async p => { if (!injected && String(p).endsWith('.tmp')) { injected = true; throw new Error('injected unlink failure') } return realUnlink(p) }
  try {
    const { ApplyPatchTool } = load('src/main/agent/tools/ApplyPatchTool.ts')
    const result = await new ApplyPatchTool().execute(JSON.stringify({ operations: [{ path: 'new.txt', action: 'create', content: 'new' }] }), board)
    assert.equal(result.error, true)
    await assert.rejects(fs.access(path.join(dir, 'new.txt')), { code: 'ENOENT' })
  } finally { fs.unlink = realUnlink }
}))

test('updates preserve UTF-8 BOM and untouched mixed line endings', async () => fixture(async (dir, board) => {
  const file = path.join(dir, 'a.txt'); await fs.writeFile(file, Buffer.from('\ufeffone\r\ntwo\nthree\r\n', 'utf8'))
  const { ApplyPatchTool } = load('src/main/agent/tools/ApplyPatchTool.ts')
  const result = await new ApplyPatchTool().execute(JSON.stringify({ operations: [{ path: 'a.txt', action: 'update', edits: [{ target: 'two', replacement: 'TWO' }] }] }), board)
  assert.equal(result.success, true, result.formattedContent)
  assert.deepEqual(await fs.readFile(file), Buffer.from('\ufeffone\r\nTWO\nthree\r\n', 'utf8'))
}))

test('read_file provides the exact byte hash needed for deleting a file', async () => fixture(async (dir, board) => {
  const bytes = Buffer.from('\ufeffone\r\n', 'utf8'); await fs.writeFile(path.join(dir, 'a.txt'), bytes)
  const { ReadFileTool } = load('src/main/agent/tools/ReadFileTool.ts'); const { ApplyPatchTool } = load('src/main/agent/tools/ApplyPatchTool.ts')
  const result = await new ReadFileTool().execute(JSON.stringify({ path: 'a.txt' }), board)
  const digest = createHash('sha256').update(bytes).digest('hex')
  assert.match(result.formattedContent, new RegExp(digest))
  const removed = await new ApplyPatchTool().execute(JSON.stringify({ operations: [{ path: 'a.txt', action: 'delete', sha256: digest }] }), board)
  assert.equal(removed.success, true, removed.formattedContent)
}))

test('write failure on the second file restores the first file', async () => fixture(async (dir, board) => {
  await fs.writeFile(path.join(dir, 'a.txt'), 'one'); await fs.writeFile(path.join(dir, 'b.txt'), 'two')
  const realRename = fs.rename; let calls = 0
  fs.rename = async (...args) => { if (++calls === 2) throw new Error('injected write failure'); return realRename(...args) }
  try {
    const { ApplyPatchTool } = load('src/main/agent/tools/ApplyPatchTool.ts')
    const result = await new ApplyPatchTool().execute(JSON.stringify({ operations: ops }), board)
    assert.equal(result.error, true); assert.deepEqual(result.data.restored, ['a.txt']); assert.deepEqual(result.data.unrecovered, [])
    assert.equal(await fs.readFile(path.join(dir, 'a.txt'), 'utf8'), 'one'); assert.equal(await fs.readFile(path.join(dir, 'b.txt'), 'utf8'), 'two')
  } finally { fs.rename = realRename }
}))

test('rollback does not overwrite a concurrent external edit', async () => fixture(async (dir, board) => {
  await fs.writeFile(path.join(dir, 'a.txt'), 'one'); await fs.writeFile(path.join(dir, 'b.txt'), 'two')
  const realRename = fs.rename; let calls = 0
  fs.rename = async (...args) => { if (++calls === 2) { await fs.writeFile(path.join(dir, 'a.txt'), 'user edit'); throw new Error('injected write failure') } return realRename(...args) }
  try {
    const { ApplyPatchTool } = load('src/main/agent/tools/ApplyPatchTool.ts')
    const result = await new ApplyPatchTool().execute(JSON.stringify({ operations: ops }), board)
    assert.equal(result.error, true); assert.deepEqual(result.data.unrecovered, ['a.txt'])
    assert.equal(await fs.readFile(path.join(dir, 'a.txt'), 'utf8'), 'user edit')
  } finally { fs.rename = realRename }
}))

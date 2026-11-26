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

test('write does not overwrite existing file when reading it fails with EACCES', async () => {
  const { WriteFileTool } = load('src/main/agent/tools/WriteFileTool.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-read-error-'))
  const target = path.join(dir, 'a.txt')
  const board = new Blackboard()
  board.setArtifact('config', { workspacePath: dir })
  const realRead = fs.readFile
  try {
    await fs.writeFile(target, 'original')
    fs.readFile = async (file, ...rest) => {
      if (file === target) throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      return realRead(file, ...rest)
    }
    const result = await new WriteFileTool().execute(JSON.stringify({ path: 'a.txt', content: 'replacement' }), board)
    assert.equal(result.error, true)
    assert.match(result.formattedContent, /permission denied/)
    assert.equal(await realRead(target, 'utf8'), 'original')
  } finally {
    fs.readFile = realRead
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('write creates a new file when reading returns ENOENT', async () => {
  const { WriteFileTool } = load('src/main/agent/tools/WriteFileTool.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-new-file-'))
  const board = new Blackboard()
  board.setArtifact('config', { workspacePath: dir })
  try {
    const result = await new WriteFileTool().execute(JSON.stringify({ path: 'nested/a.txt', content: 'created' }), board)
    assert.equal(result.success, true)
    assert.equal(result.data.isNewFile, true)
    assert.equal(await fs.readFile(path.join(dir, 'nested/a.txt'), 'utf8'), 'created')
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

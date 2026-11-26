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
  mod.filename = path.resolve(file); mod.paths = module.paths
  mod._compile(result.outputFiles[0].text, mod.filename)
  return mod.exports
}

test('Python semantic analysis locates imports and reports type errors', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-python-'))
  try {
    await fs.writeFile(path.join(dir, 'a.py'), 'def greet(name: str) -> str:\n    return name\n')
    await fs.writeFile(path.join(dir, 'b.py'), 'from a import greet\nresult: int = greet("hello")\n')
    const { CodeIntelligenceTool } = load('src/main/agent/tools/CodeIntelligenceTool.ts')
    const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
    const board = new Blackboard(); board.setArtifact('config', { workspacePath: dir })
    const tool = new CodeIntelligenceTool()
    const definition = await tool.execute(JSON.stringify({ operation: 'definition', path: 'b.py', line: 2, column: 15 }), board)
    assert.equal(definition.error, undefined, definition.formattedContent)
    assert.match(definition.formattedContent, /a\.py:1:/)
    const references = await tool.execute(JSON.stringify({ operation: 'references', path: 'a.py', line: 1, column: 5 }), board)
    assert.equal(references.error, undefined, references.formattedContent)
    assert.match(references.formattedContent, /b\.py:/)
    const diagnostics = await tool.execute(JSON.stringify({ operation: 'diagnostics', path: 'b.py' }), board)
    assert.equal(diagnostics.error, undefined, diagnostics.formattedContent)
    assert.match(diagnostics.formattedContent, /str|int/)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('Python analysis supports cancellation and blocks external files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-python-'))
  try {
    await fs.writeFile(path.join(dir, 'a.py'), 'x = 1\n')
    const { CodeIntelligenceTool } = load('src/main/agent/tools/CodeIntelligenceTool.ts')
    const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
    const board = new Blackboard(); board.setArtifact('config', { workspacePath: dir })
    const tool = new CodeIntelligenceTool()
    const outside = await tool.execute(JSON.stringify({ operation: 'diagnostics', path: '../outside.py' }), board)
    assert.equal(outside.error, true)
    const controller = new AbortController(); controller.abort()
    const aborted = await tool.execute(JSON.stringify({ operation: 'diagnostics', path: 'a.py' }), board, controller.signal)
    assert.equal(aborted.error, true); assert.match(aborted.formattedContent, /отмен/i)
    const during = new AbortController()
    const operation = tool.execute(JSON.stringify({ operation: 'diagnostics', path: 'a.py' }), board, during.signal)
    setTimeout(() => during.abort(), 50)
    const interrupted = await operation
    assert.equal(interrupted.error, true); assert.match(interrupted.formattedContent, /отмен/i)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('Python analysis is blocked in read-only and planning modes but TS stays available', async () => {
  const { CodeIntelligenceTool } = load('src/main/agent/tools/CodeIntelligenceTool.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const tool = new CodeIntelligenceTool()
  assert.equal(tool.getExecutionPolicy({ path: 'a.py' }).mutates, true)
  assert.equal(tool.getExecutionPolicy({ path: 'a.ts' }).mutates, false)
  assert.equal(tool.getExecutionPolicy().mutates, false)
  const board = new Blackboard(); board.setArtifact('config', { workspacePath: process.cwd(), accessMode: 'read-only' })
  const result = await tool.execute(JSON.stringify({ operation: 'diagnostics', path: 'a.py' }), board)
  assert.equal(result.error, true); assert.match(result.formattedContent, /только для чтения|планирован/i)
})

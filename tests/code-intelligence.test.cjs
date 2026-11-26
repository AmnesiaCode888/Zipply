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

test('semantic navigation and diagnostics use actual project files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-analysis-'))
  try {
    await fs.writeFile(path.join(dir, 'tsconfig.json'), '{"compilerOptions":{"strict":true},"include":["*.ts"]}')
    await fs.writeFile(path.join(dir, 'a.ts'), 'export const greeting: string = "hello"\n')
    await fs.writeFile(path.join(dir, 'b.ts'), 'import { greeting } from "./a"\nconst result: number = greeting\n')
    const { CodeIntelligenceTool } = load('src/main/agent/tools/CodeIntelligenceTool.ts')
    const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
    const board = new Blackboard(); board.setArtifact('config', { workspacePath: dir })
    const tool = new CodeIntelligenceTool()
    const definition = await tool.execute(JSON.stringify({ operation: 'definition', path: 'b.ts', line: 2, column: 24 }), board)
    assert.equal(definition.error, undefined, definition.formattedContent)
    assert.match(definition.formattedContent, /a\.ts:1:/)
    const references = await tool.execute(JSON.stringify({ operation: 'references', path: 'a.ts', line: 1, column: 14 }), board)
    assert.match(references.formattedContent, /b\.ts:/)
    const diagnostics = await tool.execute(JSON.stringify({ operation: 'diagnostics', path: 'b.ts' }), board)
    assert.match(diagnostics.formattedContent, /2322/)
    await fs.writeFile(path.join(dir, 'b.ts'), 'const result: number = 1\n')
    const after = await tool.execute(JSON.stringify({ operation: 'diagnostics', path: 'b.ts' }), board)
    assert.doesNotMatch(after.formattedContent, /2322/)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('semantic analysis rejects invalid coordinates and paths outside workspace', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-analysis-'))
  try {
    const { CodeIntelligenceTool } = load('src/main/agent/tools/CodeIntelligenceTool.ts')
    const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
    const board = new Blackboard(); board.setArtifact('config', { workspacePath: dir })
    const tool = new CodeIntelligenceTool()
    assert.match(tool.validate(JSON.stringify({ operation: 'definition', path: 'a.ts', line: 0, column: 1 })), /строк|координат/i)
    const result = await tool.execute(JSON.stringify({ operation: 'diagnostics', path: '../outside.ts' }), board)
    assert.equal(result.error, true)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('agent registry exposes semantic analysis in read-only mode', () => {
  const { toolRegistry } = load('src/main/agent/tools/ToolRegistry.ts')
  const tool = toolRegistry.getTool('code_intelligence')
  assert.equal(tool.getExecutionPolicy().mutates, false)
  assert.equal(tool.getExecutionPolicy().cacheable, false)
})

test('solution references use the matching project JSX configuration', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-tsconfig-'))
  try {
    await fs.writeFile(path.join(dir, 'tsconfig.json'), JSON.stringify({ files: [], references: [{ path: './tsconfig.web.json' }] }))
    await fs.writeFile(path.join(dir, 'tsconfig.web.json'), JSON.stringify({ compilerOptions: { jsx: 'preserve' }, include: ['*.tsx'] }))
    await fs.writeFile(path.join(dir, 'a.tsx'), 'export const A = () => <div />\n')
    const { CodeIntelligenceTool } = load('src/main/agent/tools/CodeIntelligenceTool.ts'); const { Blackboard } = load('src/main/agent/core/Blackboard.ts'); const board = new Blackboard(); board.setArtifact('config', { workspacePath: dir })
    const result = await new CodeIntelligenceTool().execute(JSON.stringify({ operation: 'diagnostics', path: 'a.tsx' }), board)
    assert.equal(result.error, undefined, result.formattedContent); assert.doesNotMatch(result.formattedContent, /17004/)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('invalid configuration is reported instead of producing misleading diagnostics', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-tsconfig-'))
  try {
    await fs.writeFile(path.join(dir, 'tsconfig.json'), '{"extends":"./missing.json"}')
    await fs.writeFile(path.join(dir, 'a.ts'), 'const a = 1\n')
    const { CodeIntelligenceTool } = load('src/main/agent/tools/CodeIntelligenceTool.ts'); const { Blackboard } = load('src/main/agent/core/Blackboard.ts'); const board = new Blackboard(); board.setArtifact('config', { workspacePath: dir })
    const result = await new CodeIntelligenceTool().execute(JSON.stringify({ operation: 'diagnostics', path: 'a.ts' }), board)
    assert.equal(result.error, true); assert.match(result.formattedContent, /missing/)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('fallback supports JSX and discovers workspace type declarations', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-tsconfig-'))
  try {
    await fs.mkdir(path.join(dir, 'node_modules', '@types', 'example'), { recursive: true })
    await fs.writeFile(path.join(dir, 'node_modules', '@types', 'example', 'index.d.ts'), 'declare const AcmeGlobal: number\n')
    await fs.writeFile(path.join(dir, 'a.tsx'), 'export const A = () => <div />\nconst n: number = AcmeGlobal\n')
    const { CodeIntelligenceTool } = load('src/main/agent/tools/CodeIntelligenceTool.ts'); const { Blackboard } = load('src/main/agent/core/Blackboard.ts'); const board = new Blackboard(); board.setArtifact('config', { workspacePath: dir })
    const result = await new CodeIntelligenceTool().execute(JSON.stringify({ operation: 'diagnostics', path: 'a.tsx' }), board)
    assert.equal(result.error, undefined, result.formattedContent); assert.doesNotMatch(result.formattedContent, /17004|2304/)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

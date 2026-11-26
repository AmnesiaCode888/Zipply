const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const { spawn } = require('node:child_process')

const filename = path.resolve('src/main/agent/services/GenericLanguageAnalysis.ts')
function load() {
  const output = buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths
  mod._compile(output.outputFiles[0].text, filename); return mod.exports
}

const fake = String.raw`
let buf = Buffer.alloc(0); const send = m => { const s = JSON.stringify(m); process.stdout.write('Content-Length: ' + Buffer.byteLength(s) + '\r\n\r\n' + s) }
process.stdin.on('data', chunk => { buf = Buffer.concat([buf, chunk]); while (true) {
  let e = buf.indexOf('\r\n\r\n'); if (e < 0) return; let n = Number(/Content-Length: (\d+)/i.exec(buf.subarray(0,e).toString())[1]); if (buf.length < e+4+n) return
  const m = JSON.parse(buf.subarray(e+4,e+4+n)); buf = buf.subarray(e+4+n)
  if (m.method === 'initialize') send({jsonrpc:'2.0', id:m.id, result:{capabilities:{definitionProvider:true,referencesProvider:true,positionEncoding:'utf-16'}}})
  if (m.method === 'textDocument/didOpen') send({jsonrpc:'2.0', method:'textDocument/publishDiagnostics', params:{uri:m.params.textDocument.uri, diagnostics:[{range:{start:{line:0,character:1},end:{line:0,character:2}},severity:1,code:'E1',message:'bad'}]}})
  if (m.method === 'textDocument/definition') send({jsonrpc:'2.0',id:m.id,result:{uri:m.params.textDocument.uri,range:{start:{line:0,character:1},end:{line:0,character:2}}}})
} })
`

test('generic LSP uses matching file and returns diagnostics and definitions', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-lsp-'))
  try {
    const target = path.join(dir, 'a.cpp'), server = path.join(dir, 'fake.cjs')
    await fs.writeFile(target, 'int a;\n'); await fs.writeFile(server, fake)
    const { analyzeGeneric } = load()
    const launch = () => spawn(process.execPath, [server], { stdio: 'pipe' })
    const settings = { executable: process.execPath, args: [], languageId: 'cpp', name: 'test' }
    const definition = await analyzeGeneric({ operation: 'definition', path: target, line: 1, column: 2 }, dir, settings, undefined, launch)
    assert.deepEqual(definition.items, [{ path: 'a.cpp', line: 1, column: 2 }])
    const diagnostics = await analyzeGeneric({ operation: 'diagnostics', path: target }, dir, settings, undefined, launch)
    assert.equal(diagnostics.items[0].code, 'E1'); assert.equal(diagnostics.items[0].message, 'bad')
    assert.equal(diagnostics.items[0].endLine, 1); assert.equal(diagnostics.items[0].endColumn, 3)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('generic analysis rejects missing executables and already cancelled work', async () => {
  const { detectLanguageServer, analyzeGeneric } = load()
  assert.equal(await detectLanguageServer('a.cpp', ''), undefined)
  const abort = new AbortController(); abort.abort()
  const result = await analyzeGeneric({ operation: 'diagnostics', path: 'a.cpp' }, process.cwd(), { executable: 'missing', args: [], languageId: 'cpp', name: 'test' }, abort.signal)
  assert.match(result.error, /отмен/i)
})

test('analysis rejects an external source before starting any process', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-lsp-'))
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-lsp-outside-'))
  try {
    const target = path.join(outside, 'a.c'); await fs.writeFile(target, 'int a;')
    const { analyzeGeneric } = load()
    const result = await analyzeGeneric({ operation: 'diagnostics', path: target }, dir, { executable: 'unused', args: [], languageId: 'c', name: 'test' }, undefined, () => { throw new Error('must not start') })
    assert.match(result.error, /вне рабочей папки/)
  } finally { await fs.rm(dir, { recursive: true, force: true }); await fs.rm(outside, { recursive: true, force: true }) }
})

test('unsupported navigation is reported rather than an empty result', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-lsp-'))
  try {
    const target = path.join(dir, 'a.cpp'), server = path.join(dir, 'fake.cjs')
    await fs.writeFile(target, 'int a;'); await fs.writeFile(server, fake.replace('definitionProvider:true', 'definitionProvider:false'))
    const { analyzeGeneric } = load()
    const result = await analyzeGeneric({ operation: 'definition', path: target, line: 1, column: 2 }, dir, { executable: process.execPath, args: [], languageId: 'cpp', name: 'test' }, undefined, () => spawn(process.execPath, [server], { stdio: 'pipe' }))
    assert.match(result.error, /не поддерживает/)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('code intelligence reports missing language server and blocks read-only mode', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-lsp-'))
  const originalPath = process.env.PATH
  try {
    await fs.writeFile(path.join(dir, 'a.cpp'), 'int a;')
    const entry = path.resolve('src/main/agent/tools/CodeIntelligenceTool.ts')
    const output = buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
    const mod = new Module(entry, module); mod.filename = entry; mod.paths = module.paths; mod._compile(output.outputFiles[0].text, entry)
    const tool = new mod.exports.CodeIntelligenceTool()
    const board = { getArtifact: key => key === 'config' ? { workspacePath: dir } : undefined }
    process.env.PATH = ''
    const args = JSON.stringify({ operation: 'diagnostics', path: 'a.cpp' })
    assert.equal(tool.getExecutionPolicy({ path: 'a.cpp' }).mutates, true)
    const result = await tool.execute(args, board)
    assert.equal(result.error, true); assert.match(result.formattedContent, /clangd|сервер/i)
    const locked = { getArtifact: key => key === 'config' ? { workspacePath: dir, accessMode: 'read-only' } : undefined }
    const denied = await tool.execute(args, locked)
    assert.equal(denied.error, true); assert.match(denied.formattedContent, /только для чтения/i)
  } finally { process.env.PATH = originalPath; await fs.rm(dir, { recursive: true, force: true }) }
})

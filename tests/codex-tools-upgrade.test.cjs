const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')

function load(file) {
  const source = path.resolve(file)
  const result = buildSync({ entryPoints: [source], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const mod = new Module(source, module)
  mod.filename = source
  mod.paths = module.paths
  mod._compile(result.outputFiles[0].text, source)
  return mod.exports
}

test('EditFileTool multi-edits supports indentation fallback, diagnostic snippet, and preserves blank lines in Strategy 2B', async () => {
  const { EditFileTool } = load('src/main/agent/tools/EditFileTool.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-edit-upgrade-'))
  try {
    const file = path.join(dir, 'sample.ts')
    await fs.writeFile(file, 'function demo() {\n  const a = 1\n\n  const b = 2\n}\n')
    const board = new Blackboard()
    board.setArtifact('config', { workspacePath: dir })
    const tool = new EditFileTool()

    // Single edit Strategy 2B with blank line must not add trailing spaces to empty line
    const single = await tool.execute(JSON.stringify({
      path: 'sample.ts',
      target: 'const a = 1\n\nconst b = 2',
      replacement: 'const a = 10\n\nconst b = 20'
    }), board)
    assert.equal(single.success, true, single.formattedContent)
    assert.equal(await fs.readFile(file, 'utf8'), 'function demo() {\n  const a = 10\n\n  const b = 20\n}\n')

    // Multi-edits with indentation difference succeeds via fallback
    const multi = await tool.execute(JSON.stringify({
      path: 'sample.ts',
      edits: [
        { target: 'const a = 10', replacement: 'const a = 11' },
        { target: 'const b = 20', replacement: 'const b = 22' }
      ]
    }), board)
    assert.equal(multi.success, true, multi.formattedContent)
    assert.equal(await fs.readFile(file, 'utf8'), 'function demo() {\n  const a = 11\n\n  const b = 22\n}\n')

    // Multi-edits failure returns helpful nearby snippet
    const bad = await tool.execute(JSON.stringify({
      path: 'sample.ts',
      edits: [{ target: 'const a = 999', replacement: 'x' }]
    }), board)
    assert.equal(bad.error, true)
    assert.match(bad.formattedContent, /Похожее место|const a = 11/i)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('WriteFileTool rejects binary files and preserves CRLF line endings when overwriting', async () => {
  const { WriteFileTool } = load('src/main/agent/tools/WriteFileTool.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-write-upgrade-'))
  try {
    const board = new Blackboard()
    board.setArtifact('config', { workspacePath: dir })
    const tool = new WriteFileTool()

    await fs.writeFile(path.join(dir, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02, 0x03]))
    const binRes = await tool.execute(JSON.stringify({ path: 'bin.dat', content: 'text' }), board)
    assert.equal(binRes.error, true)
    assert.match(binRes.formattedContent, /бинарн/i)

    await fs.writeFile(path.join(dir, 'win.txt'), 'one\r\ntwo\r\n')
    const crlfRes = await tool.execute(JSON.stringify({ path: 'win.txt', content: 'one\nthree\n' }), board)
    assert.equal(crlfRes.success, true)
    assert.equal(await fs.readFile(path.join(dir, 'win.txt'), 'utf8'), 'one\r\nthree\r\n')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('Stale-read guard rejects edits/writes if a read file changed externally on disk', async () => {
  const { ReadFileTool } = load('src/main/agent/tools/ReadFileTool.ts')
  const { EditFileTool } = load('src/main/agent/tools/EditFileTool.ts')
  const { WriteFileTool } = load('src/main/agent/tools/WriteFileTool.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-stale-'))
  try {
    const target = path.join(dir, 'a.txt')
    await fs.writeFile(target, 'alpha\nbeta\n')
    const board = new Blackboard()
    board.setArtifact('config', { workspacePath: dir })

    await new ReadFileTool().execute(JSON.stringify({ path: 'a.txt' }), board)
    await fs.writeFile(target, 'alpha\nexternally_modified\n')

    const editRes = await new EditFileTool().execute(JSON.stringify({ path: 'a.txt', target: 'alpha', replacement: 'ALPHA' }), board)
    assert.equal(editRes.error, true)
    assert.match(editRes.formattedContent, /изменился|прочитай|read_file/i)

    const writeRes = await new WriteFileTool().execute(JSON.stringify({ path: 'a.txt', content: 'overwrite' }), board)
    assert.equal(writeRes.error, true)
    assert.match(writeRes.formattedContent, /изменился|прочитай|read_file/i)
    assert.equal(await fs.readFile(target, 'utf8'), 'alpha\nexternally_modified\n')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('ApplyPatchTool supports Codex text patch format, optional delete sha256, and whitespace-tolerant updates', async () => {
  const { ApplyPatchTool } = load('src/main/agent/tools/ApplyPatchTool.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-codex-patch-'))
  try {
    await fs.writeFile(path.join(dir, 'app.ts'), 'function run() {\n  const x = 1\n  return x\n}\n')
    await fs.writeFile(path.join(dir, 'old.txt'), 'obsolete\n')
    const board = new Blackboard()
    board.setArtifact('config', { workspacePath: dir, accessMode: 'automatic' })
    const tool = new ApplyPatchTool()

    const patchText = [
      '*** Begin Patch',
      '*** Update File: app.ts',
      '@@ function run()',
      '-const x = 1',
      '+const x = 2',
      '*** Add File: extra.ts',
      '+export const ok = true',
      '*** Delete File: old.txt',
      '*** End Patch'
    ].join('\n')

    const res = await tool.execute(JSON.stringify({ patch: patchText }), board)
    assert.equal(res.success, true, res.formattedContent)
    assert.equal(res.noTruncate, true)
    assert.equal(await fs.readFile(path.join(dir, 'app.ts'), 'utf8'), 'function run() {\n  const x = 2\n  return x\n}\n')
    assert.equal(await fs.readFile(path.join(dir, 'extra.ts'), 'utf8'), 'export const ok = true\n')
    await assert.rejects(fs.access(path.join(dir, 'old.txt')), { code: 'ENOENT' })
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('ProjectSearchTool uses ripgrep for regex/glob/subdir when available and respects .gitignore', async () => {
  const { ProjectSearchTool } = load('src/main/agent/tools/ProjectSearchTool.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-rg-upgrade-'))
  try {
    await fs.mkdir(path.join(dir, 'src', 'nested'), { recursive: true })
    await fs.writeFile(path.join(dir, '.gitignore'), '*.log\nsrc/ignored.ts\n')
    await fs.writeFile(path.join(dir, 'src', 'keep.ts'), 'export const value = 123\n')
    await fs.writeFile(path.join(dir, 'src', 'ignored.ts'), 'export const value = 999\n')
    await fs.writeFile(path.join(dir, 'src', 'skip.log'), 'export const value = 777\n')
    const board = new Blackboard()
    board.setArtifact('config', { workspacePath: dir })
    const tool = new ProjectSearchTool()

    const res = await tool.execute(JSON.stringify({ query: 'value = \\d+', regex: true, glob: '**/*.ts', path: 'src' }), board)
    assert.equal(res.success, true, res.formattedContent)
    assert.equal(res.data.engine, 'rg')
    assert.match(res.formattedContent, /src\/keep\.ts:1:/)
    assert.doesNotMatch(res.formattedContent, /ignored\.ts|skip\.log/)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('ListDirTool respects .gitignore and bounds huge directory listings', async () => {
  const { ListDirTool } = load('src/main/agent/tools/ListDirTool.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-listdir-'))
  try {
    await fs.writeFile(path.join(dir, '.gitignore'), 'ignored-dir/\n*.secret\n')
    await fs.mkdir(path.join(dir, 'ignored-dir'))
    await fs.writeFile(path.join(dir, 'ignored-dir', 'hidden.txt'), 'x')
    await fs.writeFile(path.join(dir, 'a.secret'), 'x')
    await fs.writeFile(path.join(dir, 'visible.txt'), 'ok')
    for (let i = 0; i < 320; i++) {
      await fs.writeFile(path.join(dir, `item-${String(i).padStart(3, '0')}.txt`), 'x')
    }
    const board = new Blackboard()
    board.setArtifact('config', { workspacePath: dir })
    const res = await new ListDirTool().execute(JSON.stringify({ path: '.', recursive: true }), board)
    assert.equal(res.success, true)
    assert.doesNotMatch(res.formattedContent, /ignored-dir|a\.secret/)
    assert.match(res.formattedContent, /ограничен|усеч/i)
    assert.ok(res.formattedContent.split('\n').length <= 320)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('ReadFilesTool truncates per-file output on line boundaries without cutting a line in half', async () => {
  const { ReadFilesTool } = load('src/main/agent/tools/ReadFilesTool.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-readfiles-line-'))
  try {
    const lines = Array.from({ length: 200 }, (_, i) => `ROW_${String(i + 1).padStart(3, '0')}_${'z'.repeat(60)}_END`)
    await fs.writeFile(path.join(dir, 'big.txt'), lines.join('\n'))
    const board = new Blackboard()
    board.setArtifact('config', { workspacePath: dir })
    const res = await new ReadFilesTool().execute(JSON.stringify({ files: [{ path: 'big.txt' }] }), board)
    assert.equal(res.success, true)
    const contentLines = res.formattedContent.split('\n').filter(l => /^\s*\d+\s*\|/.test(l))
    assert.ok(contentLines.length > 0)
    assert.ok(contentLines.every(l => l.endsWith('_END')))
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('WebTool blocks localhost, private IPs, metadata endpoints, and SSRF redirects, while parsing nested main/article', async () => {
  const { WebTool } = load('src/main/agent/tools/WebTool.ts')
  const tool = new WebTool()
  for (const blockedUrl of [
    'http://localhost:3000/secret',
    'http://127.0.0.1:8080/admin',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/internal',
    'http://192.168.1.1/',
    'http://[::1]:8000/'
  ]) {
    const res = await tool.execute(JSON.stringify({ url: blockedUrl }), {})
    assert.equal(res.error, true, blockedUrl)
    assert.match(res.formattedContent, /приватн|локальн|запрещ/i)
  }

  const originalFetch = global.fetch
  global.fetch = async () => new Response(
    '<html><body><nav>Menu</nav><main><article><h1>Title</h1><p>Inner paragraph</p></article><section>After article inside main</section></main></body></html>',
    { headers: { 'content-type': 'text/html' } }
  )
  try {
    const res = await tool.execute(JSON.stringify({ url: 'https://example.com/nested' }), {})
    assert.equal(res.error, undefined)
    assert.match(res.formattedContent, /Inner paragraph/)
    assert.match(res.formattedContent, /After article inside main/)
    assert.doesNotMatch(res.formattedContent, /Menu/)
  } finally {
    global.fetch = originalFetch
  }
})

test('CodeIntelligenceTool sets modifiesFiles=false so Python analysis does not mark AgentRunner hasMutations=true', async () => {
  const { CodeIntelligenceTool } = load('src/main/agent/tools/CodeIntelligenceTool.ts')
  const tool = new CodeIntelligenceTool()
  const policy = tool.getExecutionPolicy({ path: 'app.py' })
  assert.equal(policy.mutates, true)
  assert.equal(policy.modifiesFiles, false)
})

test('TypeScriptAnalysis reuses warm worker across requests while reflecting disk edits immediately', async () => {
  const { analyze } = load('src/main/agent/services/TypeScriptAnalysis.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-ts-warm-'))
  try {
    await fs.writeFile(path.join(dir, 'tsconfig.json'), '{"compilerOptions":{"strict":true},"include":["*.ts"]}')
    const file = path.join(dir, 'a.ts')
    await fs.writeFile(file, 'const x: number = "bad"\n')
    const first = await analyze({ operation: 'diagnostics', path: file }, dir)
    assert.equal(first.reused, false)
    assert.ok(first.items.some(i => i.code === 2322))

    await fs.writeFile(file, 'const x: number = 42\n')
    const second = await analyze({ operation: 'diagnostics', path: file }, dir)
    assert.equal(second.reused, true)
    assert.equal(second.items.length, 0)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

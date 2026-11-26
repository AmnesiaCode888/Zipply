const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { buildSync } = require('esbuild')
const Module = require('node:module')
function load(file) {
  const built = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const mod = new Module(path.resolve(file), module); mod.filename = path.resolve(file); mod.paths = module.paths
  mod._compile(built.outputFiles[0].text, mod.filename); return mod.exports
}
test('workspace browser reads sorted directories and text, and rejects escapes and unsupported files', async () => {
  const { listWorkspaceFiles, readWorkspaceText } = load('src/main/services/WorkspaceFiles.ts')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-files-'))
  try {
    await fs.mkdir(path.join(root, 'folder'))
    await fs.writeFile(path.join(root, 'b.txt'), 'Привет')
    await fs.writeFile(path.join(root, 'a.bin'), Buffer.from([0, 1, 2]))
    await fs.writeFile(path.join(root, 'large.txt'), Buffer.alloc(2_000_001, 65))
    const entries = await listWorkspaceFiles(root, '')
    assert.equal(entries[0].name, 'folder')
    assert.equal(await readWorkspaceText(root, 'b.txt'), 'Привет')
    await assert.rejects(() => readWorkspaceText(root, '../outside.txt'))
    await assert.rejects(() => readWorkspaceText(root, 'a.bin'), /бинарн/i)
    await assert.rejects(() => readWorkspaceText(root, 'large.txt'), /2 МБ/)
    try {
      await fs.symlink(os.tmpdir(), path.join(root, 'external'), process.platform === 'win32' ? 'junction' : 'dir')
      await assert.rejects(() => listWorkspaceFiles(root, 'external'))
    } catch (error) { if (!['EPERM', 'EACCES'].includes(error.code)) throw error }
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('diagnostics find TypeScript and JSON errors and report unsupported languages', async () => {
  const { diagnoseWorkspaceFile } = load('src/main/services/WorkspaceFiles.ts')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-diagnostics-'))
  try {
    await fs.writeFile(path.join(root, 'a.ts'), 'const value: number = "wrong"\n')
    await fs.writeFile(path.join(root, 'a.json'), '{\n "value": }')
    await fs.writeFile(path.join(root, 'a.txt'), 'hello')
    await fs.writeFile(path.join(root, 'a.py'), 'def broken(:\n')
    const ts = await diagnoseWorkspaceFile(root, 'a.ts')
    assert.equal(ts.supported, true)
    assert.ok(ts.items.some(item => item.line === 1 && item.code === 2322))
    const json = await diagnoseWorkspaceFile(root, 'a.json')
    assert.equal(json.items[0].line, 2)
    assert.equal((await diagnoseWorkspaceFile(root, 'a.txt')).supported, false)
    assert.equal((await diagnoseWorkspaceFile(root, 'a.py')).needsServer, true)
    const python = await diagnoseWorkspaceFile(root, 'a.py', undefined, true)
    assert.equal(python.supported, true)
    assert.ok(python.items.some(item => item.category === 'Error'))
    await assert.rejects(() => diagnoseWorkspaceFile(root, '../outside.ts'))
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('editing saves files and refuses to overwrite external changes or leave the workspace', async () => {
  const { readWorkspaceText, writeWorkspaceText } = load('src/main/services/WorkspaceFiles.ts')
  const root = await fs.mkdtemp(path.join(process.cwd(), 'zipply-editor-test-'))
  try {
    const file = path.join(root, 'a.txt')
    await fs.writeFile(file, '\ufefffirst\r\n')
    const original = await readWorkspaceText(root, 'a.txt')
    assert.equal(original, '\ufefffirst\r\n')
    await writeWorkspaceText(root, 'a.txt', original, '\ufeffsecond\r\n')
    assert.equal(await fs.readFile(file, 'utf8'), '\ufeffsecond\r\n')
    await fs.writeFile(file, 'external')
    await assert.rejects(() => writeWorkspaceText(root, 'a.txt', '\ufeffsecond\r\n', 'mine'), /измен/i)
    assert.equal(await fs.readFile(file, 'utf8'), 'external')
    await assert.rejects(() => writeWorkspaceText(root, '../outside.txt', '', 'mine'))
    const concurrent = await Promise.allSettled([writeWorkspaceText(root, 'a.txt', 'external', 'one'), writeWorkspaceText(root, 'a.txt', 'external', 'two')])
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('live diagnostics inspect unsaved TypeScript and JSON without writing to disk', async () => {
  const { diagnoseWorkspaceFile } = load('src/main/services/WorkspaceFiles.ts')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-live-'))
  try {
    await fs.writeFile(path.join(root, 'a.ts'), 'const x: number = 1\n')
    await fs.writeFile(path.join(root, 'a.json'), '{}')
    await fs.writeFile(path.join(root, 'a.py'), 'x = 1\n')
    await fs.writeFile(path.join(root, 'a.jsonc'), '{}')
    await fs.writeFile(path.join(root, 'a.css'), 'body {}')
    const ts = await diagnoseWorkspaceFile(root, 'a.ts', undefined, false, 'const x: number = "bad"\n')
    assert.ok(ts.items.some(item => item.line === 1 && item.code === 2322))
    const problem = ts.items.find(item => item.code === 2322)
    assert.equal(problem.endLine, 1)
    assert.ok(problem.endColumn > problem.column)
    const json = await diagnoseWorkspaceFile(root, 'a.json', undefined, false, '{\n "x": }')
    assert.equal(json.items[0].line, 2)
    const jsonc = await diagnoseWorkspaceFile(root, 'a.jsonc', undefined, false, '{\n // note\n "x": }')
    assert.equal(jsonc.items[0].line, 3)
    const css = await diagnoseWorkspaceFile(root, 'a.css', undefined, true, 'body {\n color: red;\n')
    assert.equal(css.supported, true)
    assert.ok(css.items.length > 0)
    const python = await diagnoseWorkspaceFile(root, 'a.py', undefined, true, 'def broken(:\n')
    assert.ok(python.items.some(item => item.line === 1 && item.category === 'Error'))
    assert.equal(await fs.readFile(path.join(root, 'a.py'), 'utf8'), 'x = 1\n')
    assert.equal(await fs.readFile(path.join(root, 'a.ts'), 'utf8'), 'const x: number = 1\n')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('FolderWatcher notifies on nested file changes, ignores filtered paths, and cleans up watchers', async () => {
  const { FolderWatcher } = load('src/main/services/FolderWatcher.ts')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-folder-watch-'))
  const watcher = new FolderWatcher({
    debounceMs: 40,
    notifyDebounceMs: 20,
    shouldIgnore: (name) => Boolean(name && name.replace(/\\/g, '/').endsWith('.tmp'))
  })
  try {
    const sub = path.join(root, 'nested')
    await fs.mkdir(sub, { recursive: true })
    const events = []
    const unwatch = watcher.watch(root, (changedFolder) => {
      events.push(changedFolder)
    })

    await fs.writeFile(path.join(root, 'ignored.tmp'), 'skip')
    await new Promise((r) => setTimeout(r, 120))
    assert.equal(events.length, 0)

    await fs.writeFile(path.join(sub, 'created.txt'), 'hello')
    const deadline = Date.now() + 2000
    while (events.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25))
    }
    assert.ok(events.length >= 1)
    assert.equal(events[0], path.resolve(root))

    unwatch()
    const countAfterUnwatch = events.length
    watcher.notifyChanged(root)
    await new Promise((r) => setTimeout(r, 80))
    assert.equal(events.length, countAfterUnwatch)
  } finally {
    watcher.closeAll()
    await fs.rm(root, { recursive: true, force: true })
  }
})

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')

function load(file) {
  const built = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const mod = new Module(path.resolve(file), module)
  mod.filename = path.resolve(file)
  mod.paths = module.paths
  mod._compile(built.outputFiles[0].text, mod.filename)
  return mod.exports
}

test('batch coding workflow completes the same task with fewer provider requests', async () => {
  const { runAgent } = load('src/main/agent/index.ts')
  const originalFetch = global.fetch
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-coding-efficiency-'))
  const legacy = [
    ['read_file', { path: 'one.ts' }],
    ['read_file', { path: 'two.ts' }],
    ['edit_file', { path: 'one.ts', target: 'const a = 1', replacement: 'const a = 3' }],
    ['edit_file', { path: 'one.ts', target: 'const b = 2', replacement: 'const b = 4' }]
  ]
  const batch = [
    ['read_files', { files: [{ path: 'one.ts' }, { path: 'two.ts' }] }],
    ['edit_file', { path: 'one.ts', edits: [{ target: 'const a = 1', replacement: 'const a = 3' }, { target: 'const b = 2', replacement: 'const b = 4' }] }]
  ]
  async function exercise(name, steps) {
    const workspacePath = path.join(root, name)
    await fs.mkdir(workspacePath)
    await fs.writeFile(path.join(workspacePath, 'one.ts'), 'const a = 1\nconst b = 2\n')
    await fs.writeFile(path.join(workspacePath, 'two.ts'), 'export const c = 3\n')
    let requests = 0
    let requestChars = 0
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body)
      requestChars += JSON.stringify(body).length
      const step = steps[requests++]
      const message = step ? { content: null, tool_calls: [{ id: `call-${requests}`, type: 'function', function: { name: step[0], arguments: JSON.stringify(step[1]) } }] } : { content: 'done' }
      return Response.json({ choices: [{ message }] })
    }
    const events = []
    await runAgent('zipply', [{ role: 'user', content: 'Read the files and update a and b' }], { model: 'test', stream: false, workspacePath }, event => events.push(event))
    assert.equal(events.at(-1).type, 'done')
    assert.ok(events.filter(event => event.type === 'tool_result').every(event => !event.error))
    assert.equal(await fs.readFile(path.join(workspacePath, 'one.ts'), 'utf8'), 'const a = 3\nconst b = 4\n')
    return { requests, requestChars }
  }
  try {
    const before = await exercise('legacy', legacy)
    const after = await exercise('batch', batch)
    assert.equal(before.requests, 6)
    assert.equal(after.requests, 4)
    assert.ok(after.requestChars < before.requestChars)
    console.log(`Mock provider comparison (request characters including schemas, not token counts): ${before.requests} requests / ${before.requestChars} chars -> ${after.requests} requests / ${after.requestChars} chars`)
  } finally {
    global.fetch = originalFetch
    await fs.rm(root, { recursive: true, force: true })
  }
})

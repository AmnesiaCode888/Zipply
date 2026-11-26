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

test('coding tools cooperate through the agent protocol to find, read and edit a project', async () => {
  const { runAgent } = load('src/main/agent/index.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-coding-integration-'))
  const originalFetch = global.fetch
  const calls = [
    { name: 'find_files', arguments: JSON.stringify({ pattern: '**/*.ts' }) },
    { name: 'read_files', arguments: JSON.stringify({ files: [{ path: 'one.ts', start_line: 1, line_count: 2 }, { path: 'two.ts', start_line: 1, line_count: 1 }] }) },
    { name: 'edit_file', arguments: JSON.stringify({ path: 'one.ts', edits: [{ target: 'const first = 1', replacement: 'const first = 3' }, { target: 'const second = 2', replacement: 'const second = 4' }] }) },
    { name: 'verify_file', arguments: JSON.stringify({ path: 'one.ts', predicate: 'contains', expected: 'const second = 4' }) }
  ]
  let request = 0
  let schema
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    schema = body.tools
    if (request > 0) assert.equal(body.messages.at(-1).role, 'tool')
    const next = calls[request++]
    const message = next ? { content: null, tool_calls: [{ id: `call-${request}`, type: 'function', function: next }] } : { content: 'done' }
    return Response.json({ choices: [{ message }] })
  }
  try {
    await fs.writeFile(path.join(dir, 'one.ts'), 'const first = 1\nconst second = 2\n')
    await fs.writeFile(path.join(dir, 'two.ts'), 'export const third = 3\n')
    const events = []
    await runAgent('zipply', [{ role: 'user', content: 'Find, read and update the code' }], { model: 'test', stream: false, workspacePath: dir }, event => events.push(event))
    assert.equal(request, 5)
    assert.equal(events.at(-1).type, 'done')
    const results = events.filter(event => event.type === 'tool_result')
    assert.equal(results.length, 4)
    assert.ok(results.every(result => !result.error))
    assert.match(results[0].result, /one\.ts/)
    assert.match(results[1].result, /two\.ts/)
    assert.equal(await fs.readFile(path.join(dir, 'one.ts'), 'utf8'), 'const first = 3\nconst second = 4\n')
    const readSchema = schema.find(tool => tool.function.name === 'read_files').function.parameters.properties.files
    assert.equal(readSchema.type, 'array')
    assert.equal(readSchema.items.type, 'object')
    const editsSchema = schema.find(tool => tool.function.name === 'edit_file').function.parameters.properties.edits
    assert.equal(editsSchema.items.type, 'object')
    const editRequired = schema.find(tool => tool.function.name === 'edit_file').function.parameters.required || []
    assert.ok(!editRequired.includes('target') && !editRequired.includes('replacement'))
  } finally {
    global.fetch = originalFetch
    await fs.rm(dir, { recursive: true, force: true })
  }
})

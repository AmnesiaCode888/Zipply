const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')

const file = path.resolve('src/main/agent/services/TypeScriptAnalysis.ts')
const output = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
const mod = new Module(file, module)
mod.filename = file; mod.paths = module.paths; mod._compile(output.outputFiles[0].text, file)
const { analyze } = mod.exports

test('symbols lists declarations in the selected file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-symbols-'))
  try {
    const target = path.join(dir, 'a.ts')
    await fs.writeFile(target, 'export function renderCard() {}\nclass Widget {}\n')
    const result = await analyze({ operation: 'symbols', path: target }, dir)
    assert.equal(result.error, undefined)
    assert.ok(result.items.some(item => item.name === 'renderCard' && item.path === 'a.ts' && item.line === 1))
    assert.ok(result.items.some(item => item.name === 'Widget' && item.path === 'a.ts' && item.line === 2))
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('rename preview returns semantic project locations without changing files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-rename-'))
  try {
    await fs.writeFile(path.join(dir, 'tsconfig.json'), '{"include":["*.ts"]}')
    const a = path.join(dir, 'a.ts'), b = path.join(dir, 'b.ts')
    const first = 'export const greeting = 1\n', second = 'import { greeting } from "./a"\nconsole.log(greeting)\n'
    await fs.writeFile(a, first); await fs.writeFile(b, second)
    const result = await analyze({ operation: 'rename', path: a, line: 1, column: 14 }, dir)
    assert.equal(result.error, undefined)
    assert.ok(result.items.some(item => item.path === 'a.ts' && item.line === 1 && item.column === 14 && item.length === 8))
    assert.ok(result.items.some(item => item.path === 'b.ts' && item.line === 2 && item.column === 13 && item.length === 8))
    assert.equal(await fs.readFile(a, 'utf8'), first); assert.equal(await fs.readFile(b, 'utf8'), second)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

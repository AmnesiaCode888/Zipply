const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
function load(file) { const r = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' }); const m = new Module(path.resolve(file), module); m.filename = path.resolve(file); m.paths = module.paths; m._compile(r.outputFiles[0].text, m.filename); return m.exports }

test('ask_user is a noncached, serialized read and returns the answer', async () => {
  const { toolRegistry } = load('src/main/agent/tools/ToolRegistry.ts')
  const tool = toolRegistry.getTool('ask_user')
  assert.deepEqual(tool.getExecutionPolicy(), { mutates: false, parallelSafe: false, cacheable: false })
  const board = { getArtifact: () => ({ askUser: async () => 'Свой вариант' }) }
  const result = await tool.execute(JSON.stringify({ question: 'Какой вариант?', options: ['Один', 'Два'] }), board)
  assert.match(result.formattedContent, /Свой вариант/)
  assert.equal(tool.validate(JSON.stringify({ question: '', options: [] })) !== null, true)
})

test('ask_user validates and sends grouped questions, associating answers with their questions', async () => {
  const tool = load('src/main/agent/tools/ToolRegistry.ts').toolRegistry.getTool('ask_user')
  const questions = [{ question: 'Цвет?', options: ['Белый', 'Чёрный'] }, { question: 'Размер?' }]
  let request
  const board = { getArtifact: () => ({ askUser: async value => { request = value; return ['Белый', 'Большой'] } }) }
  const result = await tool.execute(JSON.stringify({ questions }), board)
  assert.deepEqual(request.questions, [{ question: 'Цвет?', options: ['Белый', 'Чёрный'] }, { question: 'Размер?', options: [] }])
  assert.match(result.formattedContent, /Цвет\?[\s\S]*Белый[\s\S]*Размер\?[\s\S]*Большой/)
  for (const args of [{ questions: [] }, { questions: [...questions, ...questions, ...questions] }, { questions: [{ question: '' }] }, { question: 'x', questions }, { questions: [{ question: 'x', options: [''] }] }]) {
    assert.notEqual(tool.validate(JSON.stringify(args)), null)
  }
  const skipped = await tool.execute(JSON.stringify({ questions }), { getArtifact: () => ({ askUser: async () => null }) })
  assert.equal(skipped.error, undefined)
  assert.match(skipped.formattedContent, /пропустил/i)
  const multiline = await tool.execute(JSON.stringify({ questions }), { getArtifact: () => ({ askUser: async () => ['a\n'.repeat(300), 'конец'] }) })
  assert.ok(multiline.formattedContent.split('\n').length < 10)
})

test('ask_user accepts five options and four questions while keeping limits', async () => {
  const tool = load('src/main/agent/tools/ToolRegistry.ts').toolRegistry.getTool('ask_user')
  const options = ['1', '2', '3', '4', '5']
  const questions = Array.from({ length: 4 }, (_, i) => ({ question: `Вопрос ${i + 1}`, options }))
  assert.equal(tool.validate(JSON.stringify({ question: 'Выбор?', options })), null)
  assert.equal(tool.validate(JSON.stringify({ questions })), null)
  assert.notEqual(tool.validate(JSON.stringify({ questions: [...questions, ...questions] })), null)
  assert.notEqual(tool.validate(JSON.stringify({ question: 'Выбор?', options: Array(9).fill('x') })), null)
  const result = await tool.execute(JSON.stringify({ questions }), { getArtifact: () => ({ askUser: async () => ['1', '2', '3', '4'] }) })
  assert.match(result.formattedContent, /Вопрос 4[\s\S]*4/)
})

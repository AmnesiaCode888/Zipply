const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
function load(file) { const out = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' }); const m = new Module(path.resolve(file), module); m.filename = path.resolve(file); m.paths = module.paths; m._compile(out.outputFiles[0].text, m.filename); return m.exports }

test('generated title replaces only the matching temporary title', () => {
  const { temporaryChatTitle, chooseChatTitle } = load('src/shared/chatTitle.ts')
  const temporary = temporaryChatTitle('Очень длинный вопрос о том, как улучшить интерфейс приложения')
  assert.equal(chooseChatTitle(temporary, 'Улучшение интерфейса', temporary), 'Улучшение интерфейса')
  assert.equal(chooseChatTitle('Моё название', 'Улучшение интерфейса', temporary), 'Моё название')
  assert.equal(chooseChatTitle('Новый чат', temporary), temporary)
})

test('model title is cleaned and rejects unsuitable responses', () => {
  const { cleanGeneratedTitle } = load('src/shared/chatTitle.ts')
  assert.equal(cleanGeneratedTitle('  «Улучшение интерфейса».  '), 'Улучшение интерфейса')
  assert.equal(cleanGeneratedTitle('Первый вариант\nВторой вариант'), null)
  assert.equal(cleanGeneratedTitle('x'.repeat(80)), null)
})

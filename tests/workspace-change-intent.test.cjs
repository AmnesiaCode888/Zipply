const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

function load(file) {
  const result = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const mod = new Module(path.resolve(file), module)
  mod.filename = path.resolve(file)
  mod.paths = module.paths
  mod._compile(result.outputFiles[0].text, mod.filename)
  return mod.exports
}

test('requestsWorkspaceChange detects direct and polite edit requests in EN and RU', () => {
  const { requestsWorkspaceChange } = load('src/main/agent/core/workspaceChangeIntent.ts')

  const positive = [
    'Fix the login bug in src/auth.ts',
    'Please implement dark mode support',
    'Can you fix the button alignment?',
    'Could you refactor UserService.ts?',
    'Help me add a unit test for parser.ts',
    'Write a helper function for formatting dates in utils.ts',
    'Исправь ошибку в форме входа',
    'Пожалуйста, добавь валидацию в LoginForm.tsx',
    'Можешь поправить баг в auth.ts?',
    'Попробуй починить падающие тесты',
    'Давай вынесем парсер в отдельный файл',
    'Напиши тест для parsePartialToolArgs',
    'Сделай компонент карточки профиля'
  ]

  for (const prompt of positive) {
    assert.equal(requestsWorkspaceChange(prompt), true, `expected true for: ${prompt}`)
  }
})

test('requestsWorkspaceChange avoids false positives on read-only, review, and meta prompts', () => {
  const { requestsWorkspaceChange } = load('src/main/agent/core/workspaceChangeIntent.ts')

  const negative = [
    'Сделай ревью кода',
    'Проведи аудит кода и напиши замечания',
    'Напиши, как работает функция authorize',
    'Напиши в чат краткое объяснение бага',
    'Добавь в контекст, почему падает сборка',
    'Измени тон ответа на более краткий',
    'Обнови меня по статусу задачи',
    'Создай краткий план без правки файлов',
    'Do a code review of src/App.tsx',
    'Write a summary of how this function works',
    'Add to your reply why the test failed',
    'Update me on the current status',
    'How do I fix the build error?',
    'Как исправить эту ошибку в tsconfig.json?',
    'Can you explain how to refactor this component?',
    'Исправь баг, но пока не правь код — просто объясни причину',
    'Fix it? No, just explain what happens',
    'Подключи и запусти аудит CyberSec'
  ]

  for (const prompt of negative) {
    assert.equal(requestsWorkspaceChange(prompt), false, `expected false for: ${prompt}`)
  }
})

test('requestsNoEdits and resolveExpectsWorkspaceChange handle steer overrides cleanly', () => {
  const { requestsNoEdits, resolveExpectsWorkspaceChange } = load('src/main/agent/core/workspaceChangeIntent.ts')

  assert.equal(requestsNoEdits('Подожди, сначала просто посмотри логи'), true)
  assert.equal(requestsNoEdits('Just inspect the config without touching files'), true)
  assert.equal(requestsNoEdits('Добавь кнопку сохранения'), false)

  assert.equal(
    resolveExpectsWorkspaceChange('Исправь кнопку', ['Подожди, сначала просто посмотри логи'], true),
    false
  )
  assert.equal(
    resolveExpectsWorkspaceChange('Объясни ошибку', ['Теперь можешь исправить её в коде'], true),
    true
  )
  assert.equal(
    resolveExpectsWorkspaceChange('Исправь кнопку', [], false),
    false
  )
})

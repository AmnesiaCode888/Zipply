const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

function load(file) {
  const source = path.resolve(file)
  const output = buildSync({
    entryPoints: [source],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    packages: 'external',
    loader: { '.svg': 'dataurl', '.css': 'empty' }
  })
  const mod = new Module(source, module)
  mod.filename = source
  mod.paths = module.paths
  mod._compile(output.outputFiles[0].text, source)
  return mod.exports
}

test('ChatMessageItem renders retry button when error block is present and not streaming', () => {
  const { ChatMessageItem } = load('src/renderer/src/components/ChatMessageItem.tsx')
  const message = {
    id: 'msg-1',
    role: 'assistant',
    isStreaming: false,
    blocks: [
      {
        type: 'text',
        id: 'err-123',
        content: '⚠️ Не удалось выполнить резюмирование контекста: модель вернула пустой ответ.',
        isStreaming: false
      }
    ]
  }

  const html = renderToStaticMarkup(
    React.createElement(ChatMessageItem, {
      message,
      onRetry: () => {}
    })
  )

  assert.match(html, /Попробовать еще раз/)
  assert.match(html, /Не удалось выполнить резюмирование контекста/)
})

test('ChatMessageItem does not render retry button while streaming', () => {
  const { ChatMessageItem } = load('src/renderer/src/components/ChatMessageItem.tsx')
  const message = {
    id: 'msg-1',
    role: 'assistant',
    isStreaming: true,
    blocks: [
      {
        type: 'text',
        id: 'err-123',
        content: '⚠️ Не удалось выполнить резюмирование контекста',
        isStreaming: false
      }
    ]
  }

  const html = renderToStaticMarkup(
    React.createElement(ChatMessageItem, {
      message,
      onRetry: () => {}
    })
  )

  assert.doesNotMatch(html, /Попробовать еще раз/)
})

test('ChatMessageItem does not render retry button when there is no error', () => {
  const { ChatMessageItem } = load('src/renderer/src/components/ChatMessageItem.tsx')
  const message = {
    id: 'msg-1',
    role: 'assistant',
    isStreaming: false,
    blocks: [
      {
        type: 'text',
        id: 'text-1',
        content: 'Все готово!',
        isStreaming: false
      }
    ]
  }

  const html = renderToStaticMarkup(
    React.createElement(ChatMessageItem, {
      message,
      onRetry: () => {}
    })
  )

  assert.doesNotMatch(html, /Попробовать еще раз/)
})

test('buildAgentHistory ignores error blocks from assistant text', () => {
  const { buildAgentHistory } = load('src/renderer/src/services/agentHistory.ts')
  const messages = [
    { id: '1', role: 'user', content: 'Привет' },
    {
      id: '2',
      role: 'assistant',
      blocks: [
        { type: 'text', id: 't1', content: 'Частичный ответ' },
        { type: 'text', id: 'err-1', content: '⚠️ Ошибка резюмирования' }
      ]
    }
  ]

  const history = buildAgentHistory(messages)
  assert.equal(history.length, 2)
  assert.equal(history[0].content, 'Привет')
  assert.equal(history[1].content, 'Частичный ответ')
  assert.doesNotMatch(history[1].content, /Ошибка резюмирования/)
})

test('cancelled response uses a quiet status with a continue action', () => {
  const { ChatMessageItem } = load('src/renderer/src/components/ChatMessageItem.tsx')
  const message = { id: 'cancelled', role: 'assistant', isStreaming: false, blocks: [{ type: 'text', id: 'err-1', content: '⚠️ Операция отменена пользователем.' }] }
  const html = renderToStaticMarkup(React.createElement(ChatMessageItem, { message, onRetry: () => {} }))
  assert.match(html, /Ответ остановлен/)
  assert.match(html, /Продолжить/)
  assert.match(html, /role="status"/)
  assert.doesNotMatch(html, /⚠️/)
})

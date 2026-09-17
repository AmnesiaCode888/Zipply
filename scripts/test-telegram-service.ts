import assert from 'assert'
import { TelegramBotService } from '../src/main/services/TelegramBotService'

async function runTests() {
  console.log('[test] Starting TelegramBotService unit tests...')

  // 1. Test token validation helper
  const invalidToken = 'not-a-token'
  const validTokenFormat = '123456789:ABCdefGHIjklMNOpqrsTUVwxyz1234567'
  assert.strictEqual(TelegramBotService.isValidTokenFormat(invalidToken), false)
  assert.strictEqual(TelegramBotService.isValidTokenFormat(validTokenFormat), true)
  assert.strictEqual(TelegramBotService.isValidTokenFormat(''), false)
  console.log('✅ Token format validation works')

  // 2. Test user authorization filter
  const allowedList = ['123456', '@admin_user', '789012']
  assert.strictEqual(TelegramBotService.isUserAllowed(allowedList, 123456, 'someone'), true)
  assert.strictEqual(TelegramBotService.isUserAllowed(allowedList, 999999, 'admin_user'), true)
  assert.strictEqual(TelegramBotService.isUserAllowed(allowedList, 999999, '@admin_user'), true)
  assert.strictEqual(TelegramBotService.isUserAllowed(allowedList, 999999, 'stranger'), false)
  // If allowed list is empty, access is rejected for security
  assert.strictEqual(TelegramBotService.isUserAllowed([], 123456, 'admin'), false)
  console.log('✅ User authorization filter works')

  // 3. Test Markdown escaping / text trimming
  const longText = 'A'.repeat(5000)
  const chunks = TelegramBotService.splitMessage(longText, 4000)
  assert.strictEqual(chunks.length, 2)
  assert.strictEqual(chunks[0].length, 4000)
  assert.strictEqual(chunks[1].length, 1000)
  console.log('✅ Message chunking works')

  // 4. Initial status check
  const status = TelegramBotService.getStatus()
  assert.ok(['stopped', 'starting', 'running', 'error'].includes(status.status))
  console.log('✅ Initial status reporting works:', status.status)

  // 5. Test Markdown to Telegram HTML converter
  const mdSample =
    '# Header\n' +
    'Here is **bold**, *italic*, and `inline_code`.\n' +
    '> quoted line\n' +
    '[Zipply Link](https://zipply.app)\n' +
    '```typescript\nconst x = 42;\n```'
  const htmlOutput = TelegramBotService.formatMarkdownToTelegramHtml(mdSample)
  assert.ok(htmlOutput.includes('<b>Header</b>'))
  assert.ok(htmlOutput.includes('<b>bold</b>'))
  assert.ok(htmlOutput.includes('<i>italic</i>'))
  assert.ok(htmlOutput.includes('<code>inline_code</code>'))
  assert.ok(htmlOutput.includes('<blockquote>quoted line</blockquote>'))
  assert.ok(htmlOutput.includes('<a href="https://zipply.app">Zipply Link</a>'))
  assert.ok(htmlOutput.includes('<pre><code class="language-typescript">const x = 42;\n</code></pre>'))
  console.log('✅ Markdown to Telegram HTML converter works')

  // 6. Test tool emoji and detail extraction
  const webSearchTool = TelegramBotService.getToolEmojiAndAction('search_web', { query: 'TypeScript best practices' })
  assert.strictEqual(webSearchTool.emoji, '🔍')
  assert.ok(webSearchTool.detail.includes('TypeScript best practices'))

  const terminalTool = TelegramBotService.getToolEmojiAndAction('terminal', { command: 'npm test' })
  assert.strictEqual(terminalTool.emoji, '💻')
  assert.ok(terminalTool.detail.includes('npm test'))

  const fileTool = TelegramBotService.getToolEmojiAndAction('file', { action: 'edit', path: '/src/main/index.ts' })
  assert.strictEqual(fileTool.emoji, '✏️')
  assert.ok(fileTool.detail.includes('index.ts'))
  console.log('✅ Tool progress emojis & action summaries work')

  // 7. Test model availability listing
  const models = TelegramBotService.getAvailableModels()
  assert.ok(Array.isArray(models))
  assert.ok(models.length > 0)
  assert.ok(models.some((m) => m.id.includes('gemini') || m.id.includes('gpt') || m.id.includes('claude')))
  console.log('✅ Available models query works:', models.length, 'models registered')

  // 8. Test model search filter & pagination math
  const deepseekMatches = models.filter((m) => m.id.toLowerCase().includes('deepseek'))
  assert.ok(deepseekMatches.length > 0)
  const PAGE_SIZE = 8
  const totalPages = Math.ceil(models.length / PAGE_SIZE)
  assert.ok(totalPages > 1, '500+ models must produce multiple pages for pagination')
  console.log(`✅ Model pagination & search works: ${models.length} models -> ${totalPages} pages`)

  console.log('🎉 All TelegramBotService unit tests passed!')
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err)
  process.exit(1)
})

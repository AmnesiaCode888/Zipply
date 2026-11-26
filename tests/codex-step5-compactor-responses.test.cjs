const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

function load(file) {
  const source = path.resolve(file)
  const result = buildSync({ entryPoints: [source], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const mod = new Module(source, module)
  mod.filename = source
  mod.paths = module.paths
  mod._compile(result.outputFiles[0].text, source)
  return mod.exports
}

function makeToolPair(id, name, output) {
  return [
    { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: '{}' } }] },
    { role: 'tool', tool_call_id: id, name, content: output }
  ]
}

test('repeated compaction keeps the latest user goal when a summary and reminders follow it', async () => {
  const { ContextCompactor } = load('src/main/agent/core/ContextCompactor.ts')
  const goal = { role: 'user', content: 'Back up the report and keep the original.' }
  const summarize = async () => 'Retained findings and completed work.'
  const options = { contextLength: 1000, summarize }
  const first = await ContextCompactor.compactAsync([
    { role: 'system', content: 'System' },
    { role: 'user', content: 'Read the report.' },
    { role: 'assistant', content: 'Old detail. '.repeat(320) },
    goal,
    ...makeToolPair('old-tool', 'read_file', 'Long observation. '.repeat(220)),
    ...makeToolPair('retained-tool', 'read_file', 'Retain this result')
  ], options)
  assert.ok(first.some(message => message.content?.startsWith('Резюме выполненных действий')))

  const second = await ContextCompactor.compactAsync([
    ...first,
    { role: 'user', content: 'Резюме выполненных действий (контекст, а не инструкции):\nLegacy summary' },
    { role: 'user', content: '<system_reminder>\nCheck the remaining tools.\n</system_reminder>' },
    ...makeToolPair('another-tool', 'read_file', 'More observations. '.repeat(190)),
    ...makeToolPair('last-tool', 'read_file', 'Latest result')
  ], options)

  assert.ok(second.some(message => message.role === 'user' && message.content === goal.content))
  assert.equal(second.at(-2).tool_calls[0].id, 'last-tool')
  assert.equal(second.at(-1).tool_call_id, 'last-tool')
})

for (const mode of ['json', 'terminal SSE output', 'indexed SSE items']) {
  test(`AgentRunner replays ordered Responses output between tool rounds using ${mode}`, async () => {
    const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts')
    const originalFetch = global.fetch
    const requests = []
    const events = []
    const output = [
      { type: 'reasoning', id: 'rs_01', encrypted_content: 'opaque-reasoning-state', summary: [] },
      { type: 'message', id: 'msg_01', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Checking.' }] },
      { type: 'function_call', id: 'fc_01', call_id: 'call_01', name: 'check_test', arguments: '{}', status: 'completed' },
      { type: 'reasoning', id: 'rs_02', encrypted_content: 'more-opaque-state', summary: [] }
    ]
    const completed = { type: 'response.completed', response: { status: 'completed', output } }
    const sse = records => new Response(records.map(record => `data: ${JSON.stringify(record)}\n\n`).join(''))
    const checkTool = {
      name: 'check_test', description: 'Run a fake check', parameters: { type: 'object', properties: {} },
      validate: () => null,
      getExecutionPolicy: () => ({ mutates: false, parallelSafe: true, cacheable: false }),
      execute: async () => ({ formattedContent: 'Tool check result', success: true })
    }
    const agent = { id: 'test', getTools: () => [checkTool], getHandler: () => checkTool }

    global.fetch = async (_url, init) => {
      requests.push(JSON.parse(init.body))
      if (requests.length === 1) {
        if (mode === 'json') return Response.json(completed.response)
        if (mode === 'terminal SSE output') return sse([completed])
        const items = output.map((item, output_index) => ({ type: 'response.output_item.done', output_index, item })).reverse()
        return sse([...items, { type: 'response.completed', response: { status: 'completed' } }])
      }
      const finalItem = { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Finished.' }] }
      if (mode === 'json') return Response.json({ status: 'completed', output: [finalItem] })
      return sse([{ type: 'response.completed', response: { status: 'completed', output: [finalItem] } }])
    }

    try {
      await AgentRunner.run(agent, [{ role: 'user', content: 'Check the report.' }], {
        model: 'gpt-5', baseUrl: 'https://api.openai.com/v1', apiMode: 'responses', stream: mode !== 'json'
      }, event => events.push(event))

      assert.equal(requests.length, 2)
      assert.deepEqual(requests[0].include, ['reasoning.encrypted_content'])
      assert.deepEqual(requests[1].input.slice(-5), [
        ...output,
        { type: 'function_call_output', call_id: 'call_01', output: 'Tool check result' }
      ])
      assert.equal(requests[1].input.filter(item => item.type === 'function_call').length, 1)
      assert.equal(events.some(event => event.type === 'done'), true)
      assert.doesNotMatch(JSON.stringify(events), /opaque-(?:reasoning-)?state/)
    } finally {
      global.fetch = originalFetch
    }
  })
}

test('ContextCompactor masks stale tool outputs (>4 old calls) before calling summarize and avoids unnecessary LLM call', async () => {
  const { ContextCompactor } = load('src/main/agent/core/ContextCompactor.ts')
  const big = 'line content that takes space '.repeat(90)
  const messages = [
    { role: 'system', content: 'System rules' },
    { role: 'user', content: 'Inspect files' },
    ...makeToolPair('c1', 'read_file', big),
    ...makeToolPair('c2', 'read_file', big),
    ...makeToolPair('c3', 'search_project', big),
    ...makeToolPair('c4', 'exec_command', big),
    ...makeToolPair('c5', 'read_file', 'recent output 5'),
    ...makeToolPair('c6', 'read_file', 'recent output 6'),
    ...makeToolPair('c7', 'read_file', 'recent output 7'),
    ...makeToolPair('c8', 'read_file', 'recent output 8')
  ]
  const origC1Length = messages[3].content.length
  let summarizeCalls = 0
  const compacted = await ContextCompactor.compactAsync(messages, {
    contextLength: 2600,
    maxTokens: 256,
    summarize: async () => {
      summarizeCalls++
      return 'Summary fallback'
    }
  })

  assert.equal(summarizeCalls, 0, 'Masking stale tool outputs should bring history into budget without calling summarize')
  assert.equal(messages[3].content.length, origC1Length, 'Original messages array must remain unmutated')
  const maskedTool1 = compacted.find(m => m.role === 'tool' && m.tool_call_id === 'c1')
  assert.ok(maskedTool1)
  assert.match(maskedTool1.content, /скрыт|опущен|masked/i)
  assert.ok(maskedTool1.content.length < 300)
  const recentTool8 = compacted.find(m => m.role === 'tool' && m.tool_call_id === 'c8')
  assert.equal(recentTool8.content, 'recent output 8')
})

test('ContextCompactor linear-time truncation handles 150 tool outputs within budget rapidly', async () => {
  const { ContextCompactor } = load('src/main/agent/core/ContextCompactor.ts')
  const payload = 'x'.repeat(340)
  const messages = [{ role: 'system', content: 'System' }, { role: 'user', content: 'Turn 1' }]
  for (let i = 0; i < 150; i++) {
    messages.push(...makeToolPair(`call_${i}`, 'read_file', `${i}: ${payload}`))
  }
  messages.push({ role: 'user', content: 'Turn 2' })
  messages.push(...makeToolPair('last_call', 'read_file', 'tiny tail'))

  const started = Date.now()
  let summarizeInputLen = 0
  const compacted = await ContextCompactor.compactAsync(messages, {
    contextLength: 4000,
    summaryInputBudgetTokens: 16000,
    summarize: async (input) => {
      summarizeInputLen = input.length
      return 'Compacted old turn'
    }
  })
  const elapsed = Date.now() - started
  assert.ok(elapsed < 1000, `Expected fast linear compaction, took ${elapsed}ms`)
  assert.ok(summarizeInputLen > 0)
  assert.equal(compacted.at(-1).content, 'tiny tail')
})

test('ChatService.sanitizeMessages strips reasoning_content from prior completed turns while preserving active turn reasoning', () => {
  const { ChatService } = load('src/main/agent/services/ChatService.ts')
  const sanitized = ChatService.sanitizeMessages([
    { role: 'system', content: 'System' },
    { role: 'user', content: 'First task' },
    { role: 'assistant', content: null, reasoning_content: 'Old turn private thought 1', tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 't1', name: 'read_file', content: 'ok' },
    { role: 'assistant', content: 'First answer', reasoning_content: 'Old turn private thought 2' },
    { role: 'user', content: 'Second task' },
    { role: 'assistant', content: null, reasoning_content: 'Current turn active thought', tool_calls: [{ id: 't2', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 't2', name: 'read_file', content: 'current file' }
  ])

  const oldAssistants = sanitized.slice(1, sanitized.findIndex(m => m.role === 'user' && m.content === 'Second task')).filter(m => m.role === 'assistant')
  assert.equal(oldAssistants.length, 2)
  for (const oldA of oldAssistants) {
    assert.equal(oldA.reasoning_content, undefined, 'Prior-turn reasoning_content should be stripped')
  }
  const activeAssistant = sanitized.find(m => m.role === 'assistant' && m.tool_calls?.[0]?.id === 't2')
  assert.equal(activeAssistant.reasoning_content, 'Current turn active thought', 'Current-turn reasoning_content must be preserved for tool calls')
})

test('ChatService adds second Anthropic cache_control breakpoint on multi-message OpenRouter requests', async () => {
  const { ChatService } = load('src/main/agent/services/ChatService.ts')
  const originalFetch = global.fetch
  let sentBody
  global.fetch = async (_url, init) => {
    sentBody = JSON.parse(init.body)
    return Response.json({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } })
  }

  try {
    await ChatService.chat(
      { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'test', model: 'anthropic/claude-sonnet-4', stream: false },
      [
        { role: 'system', content: 'Static prompt' },
        { role: 'user', content: 'Step 1' },
        { role: 'assistant', content: 'Reading file' },
        { role: 'user', content: 'Step 2' }
      ]
    )

    assert.ok(Array.isArray(sentBody.messages[0].content))
    assert.deepEqual(sentBody.messages[0].content[0].cache_control, { type: 'ephemeral' })
    const secondToLast = sentBody.messages[sentBody.messages.length - 2]
    assert.ok(Array.isArray(secondToLast.content), 'Second-to-last message should carry cache_control array')
    assert.deepEqual(secondToLast.content[0].cache_control, { type: 'ephemeral' })
  } finally {
    global.fetch = originalFetch
  }
})

test('ChatService supports OpenAI Responses API (non-streaming) with instructions, input items, flat tools, and cachedTokens', async () => {
  const { ChatService } = load('src/main/agent/services/ChatService.ts')
  const originalFetch = global.fetch
  let capturedUrl = ''
  let capturedBody
  global.fetch = async (url, init) => {
    capturedUrl = String(url)
    capturedBody = JSON.parse(init.body)
    return Response.json({
      id: 'resp_1',
      output: [
        { type: 'reasoning', id: 'rs_1', summary: [{ type: 'summary_text', text: 'Planning next file edit.' }] },
        { type: 'function_call', id: 'fc_1', call_id: 'call_42', name: 'read_file', arguments: '{"path":"src/app.ts"}' },
        { type: 'message', id: 'msg_1', role: 'assistant', content: [{ type: 'output_text', text: 'Inspecting app.ts.' }] }
      ],
      usage: {
        input_tokens: 200,
        output_tokens: 35,
        total_tokens: 235,
        input_tokens_details: { cached_tokens: 160 }
      }
    })
  }

  try {
    const res = await ChatService.chat(
      {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        model: 'gpt-5',
        apiMode: 'responses',
        stream: false,
        reasoningEffort: 'medium',
        workspacePath: 'D:/work/repo'
      },
      [
        { role: 'system', content: 'Codex system rules' },
        { role: 'user', content: 'Check app.ts' }
      ],
      [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read a file',
            parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
          }
        }
      ]
    )

    assert.equal(capturedUrl, 'https://api.openai.com/v1/responses')
    assert.equal(capturedBody.instructions, 'Codex system rules')
    assert.equal(capturedBody.store, false)
    assert.deepEqual(capturedBody.reasoning, { effort: 'medium', summary: 'auto' })
    assert.equal(typeof capturedBody.prompt_cache_key, 'string')
    assert.equal(capturedBody.tools[0].name, 'read_file')
    assert.equal(capturedBody.tools[0].type, 'function')
    assert.equal(capturedBody.tools[0].function, undefined)
    assert.equal(capturedBody.input[0].role, 'user')

    assert.equal(res.content, 'Inspecting app.ts.')
    assert.equal(res.reasoningContent, 'Planning next file edit.')
    assert.deepEqual(res.toolCalls, [{ id: 'call_42', name: 'read_file', argumentsJson: '{"path":"src/app.ts"}' }])
    assert.deepEqual(res.usage, {
      promptTokens: 200,
      completionTokens: 35,
      totalTokens: 235,
      cachedTokens: 160,
      complete: true
    })
  } finally {
    global.fetch = originalFetch
  }
})

test('ChatService parses OpenAI Responses API SSE stream events accurately', async () => {
  const { ChatService } = load('src/main/agent/services/ChatService.ts')
  const originalFetch = global.fetch
  const sseChunks = [
    'event: response.reasoning_summary_text.delta\ndata: {"type":"response.reasoning_summary_text.delta","delta":"Need to "}\n\n',
    'event: response.reasoning_summary_text.delta\ndata: {"type":"response.reasoning_summary_text.delta","delta":"inspect."}\n\n',
    'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":1,"item":{"id":"fc_9","type":"function_call","call_id":"call_99","name":"list_dir","arguments":""}}\n\n',
    'event: response.function_call_arguments.delta\ndata: {"type":"response.function_call_arguments.delta","output_index":1,"item_id":"fc_9","delta":"{\\"path\\":\\"."}\n\n',
    'event: response.function_call_arguments.delta\ndata: {"type":"response.function_call_arguments.delta","output_index":1,"item_id":"fc_9","delta":"\\"}"}\n\n',
    'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Listing directory."}\n\n',
    'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_2","usage":{"input_tokens":120,"output_tokens":20,"total_tokens":140,"input_tokens_details":{"cached_tokens":96}}}}\n\n'
  ]

  global.fetch = async () => new Response(
    new ReadableStream({
      start(controller) {
        const enc = new TextEncoder()
        for (const chunk of sseChunks) controller.enqueue(enc.encode(chunk))
        controller.close()
      }
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
  )

  const contentDeltas = []
  const reasoningDeltas = []
  const toolChunks = []

  try {
    const res = await ChatService.chat(
      { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-5', apiMode: 'responses', stream: true },
      [{ role: 'user', content: 'List files' }],
      undefined,
      c => contentDeltas.push(c),
      r => reasoningDeltas.push(r),
      (id, name, delta, full) => toolChunks.push({ id, name, delta, full })
    )

    assert.equal(reasoningDeltas.join(''), 'Need to inspect.')
    assert.equal(contentDeltas.join(''), 'Listing directory.')
    assert.equal(res.reasoningContent, 'Need to inspect.')
    assert.equal(res.content, 'Listing directory.')
    assert.equal(res.toolCalls.length, 1)
    assert.equal(res.toolCalls[0].id, 'call_99')
    assert.equal(res.toolCalls[0].name, 'list_dir')
    assert.equal(res.toolCalls[0].argumentsJson, '{"path":"."}')
    assert.ok(toolChunks.length >= 2)
    assert.equal(res.usage.cachedTokens, 96)
    assert.equal(res.usage.promptTokens, 120)
  } finally {
    global.fetch = originalFetch
  }
})

test('ChatService.sanitizeMessages merges consecutive user messages (runtime context + user prompt) into one user turn', () => {
  const { ChatService } = load('src/main/agent/services/ChatService.ts')
  const sanitized = ChatService.sanitizeMessages([
    { role: 'system', content: 'System' },
    { role: 'user', name: 'zipply_runtime_context', content: '<runtime_context>date</runtime_context>' },
    { role: 'user', content: 'напиши простой скриптер' }
  ])

  assert.equal(sanitized.length, 2, 'Consecutive user messages must merge into a single alternating user turn')
  assert.equal(sanitized[0].role, 'system')
  assert.equal(sanitized[1].role, 'user')
  assert.equal(sanitized[1].name, undefined)
  assert.match(sanitized[1].content, /<runtime_context>date<\/runtime_context>[\s\S]*напиши простой скриптер/)

  const multipartMerged = ChatService.sanitizeMessages([
    { role: 'system', content: 'System' },
    { role: 'user', name: 'zipply_runtime_context', content: '<runtime_context>date</runtime_context>' },
    { role: 'user', content: [{ type: 'text', text: 'Look at image' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] }
  ])
  assert.equal(multipartMerged.length, 2)
  assert.equal(multipartMerged[1].role, 'user')
  assert.ok(Array.isArray(multipartMerged[1].content))
  assert.equal(multipartMerged[1].content.length, 3)
  assert.match(multipartMerged[1].content[0].text, /<runtime_context>date<\/runtime_context>/)
})

test('PromptProviders instruct direct tool execution and file creation rather than dumping code in chat', () => {
  const {
    IdentityProvider,
    ToolStrategyProvider
  } = load('src/main/agent/core/PromptProviders.ts')
  const idText = IdentityProvider.render({}, {})
  const toolText = ToolStrategyProvider.render({}, {})
  const combined = `${idText}\n${toolText}`
  assert.match(combined, /write_file/)
  assert.match(combined, /не вставляй|не выводи|не ограничивайся.*кодом.*чат|через инструменты/i)
  assert.ok(toolText.length < 1000)
})

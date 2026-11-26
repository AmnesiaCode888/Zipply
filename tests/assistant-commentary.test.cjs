const test = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

function load(file, options = {}) {
  const source = path.resolve(file)
  const output = buildSync({
    entryPoints: [source],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    packages: 'external',
    logOverride: { 'empty-import-meta': 'silent' },
    loader: { '.svg': 'dataurl', '.css': 'empty' },
    ...options
  })
  const mod = new Module(source, module)
  mod.filename = source
  mod.paths = module.paths
  mod._compile(output.outputFiles[0].text, source)
  return mod.exports
}

function loadWithReactTree(file) {
  const actualReact = require('react')
  const react = {
    ...actualReact,
    memo: component => component,
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: current => ({ current }),
    useEffect: () => {},
    useCallback: callback => callback
  }
  const jsxRuntime = require('react/jsx-runtime')
  const originalLoad = Module._load
  Module._load = function (id, ...args) {
    if (id === 'react') return react
    if (id === 'react/jsx-runtime') return jsxRuntime
    return originalLoad.call(this, id, ...args)
  }
  try { return load(file) }
  finally { Module._load = originalLoad }
}

function loadWithReactHooks(file) {
  const actualReact = require('react')
  const react = {
    ...actualReact,
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: current => ({ current }),
    useEffect: effect => { effect() },
    useCallback: callback => callback
  }
  const originalLoad = Module._load
  Module._load = function (id, ...args) {
    if (id === 'react') return react
    return originalLoad.call(this, id, ...args)
  }
  try { return load(file) }
  finally { Module._load = originalLoad }
}

function findElement(node, predicate) {
  if (!node || typeof node !== 'object') return undefined
  if (predicate(node)) return node
  const children = node.props?.children
  for (const child of Array.isArray(children) ? children : [children]) {
    const match = findElement(child, predicate)
    if (match) return match
  }
  return undefined
}

const response = message => Response.json({ choices: [{ message }], usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } })
const toolCall = { id: 'inspect-1', type: 'function', function: { name: 'inspect', arguments: '{}' } }

test('AgentRunner emits ordinary response text as a separate commentary before tool execution', async () => {
  const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts')
  const originalFetch = global.fetch
  const events = []
  let requests = 0
  const inspect = {
    name: 'inspect', description: 'Inspect the current state', parameters: {}, validate: () => null,
    getExecutionPolicy: () => ({ mutates: false, cacheable: false, parallelSafe: false }),
    execute: async () => ({ formattedContent: 'Confirmed result.' })
  }
  global.fetch = async () => ++requests === 1
    ? response({ content: 'Сейчас проверю текущее состояние.', reasoning_content: 'Скрытая внутренняя мысль.', tool_calls: [toolCall] })
    : response({ content: 'Проверка завершена.' })
  try {
    await AgentRunner.run(
      { id: 'zipply', getTools: () => [inspect], getHandler: name => name === 'inspect' ? inspect : undefined },
      [{ role: 'user', content: 'Проверь состояние.' }],
      { model: 'test', stream: false },
      event => events.push(event)
    )
  } finally { global.fetch = originalFetch }

  assert.deepEqual(events.filter(event => event.type === 'assistant_commentary').map(event => event.content), ['Сейчас проверю текущее состояние.'])
  assert.doesNotMatch(JSON.stringify(events.filter(event => event.type === 'assistant_commentary')), /Скрытая внутренняя мысль/)
  assert.ok(events.findIndex(event => event.type === 'assistant_commentary') < events.findIndex(event => event.type === 'tool_start'))
  assert.ok(events.some(event => event.type === 'token' && event.content === 'Проверка завершена.'))
  const history = events.filter(event => event.type === 'history').at(-1).messages
  assert.ok(history.some(message => message.role === 'assistant' && message.isProgressUpdate))
  assert.equal(history.some(message => message.name === 'zipply_context_snapshot'), false)
})

test('the active system prompt asks for short, meaningful commentary alongside tool calls', async () => {
  const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts')
  const originalFetch = global.fetch
  let body
  global.fetch = async (_url, options) => { body = JSON.parse(options.body); return response({ content: 'Готово.' }) }
  try {
    await AgentRunner.run(
      { id: 'zipply', getTools: () => [], getHandler: () => undefined },
      [{ role: 'user', content: 'Проверь проект.' }],
      { model: 'test', stream: false },
      () => {}
    )
  } finally { global.fetch = originalFetch }

  const prompt = body.messages.find(message => message.role === 'system' || message.role === 'developer')?.content || ''
  assert.match(prompt, /последн[а-я ]*сообщен[а-я ]*пользовател[а-я ]*определяет/i)
  assert.match(prompt, /задай краткий уточняющий вопрос, если неоднозначность меняет результат/i)
  assert.match(prompt, /не повторяй неудачное действие без новых данных/i)

  const progress = /<progress_updates>([\s\S]*?)<\/progress_updates>/.exec(prompt)?.[1] || ''
  assert.match(progress, /одно предложение/i)
  assert.match(progress, /в том же ответе.*вызовами инструментов/i)
  assert.match(progress, /перед существенным изменением или длительной проверкой/i)
  assert.match(progress, /важн[а-я ]*находк/i)
  assert.match(progress, /смен[а-я ]*подход/i)
  assert.match(progress, /пропускай реплику.*рутинн/i)
  assert.match(progress, /не повторяй.*карточек инструментов/i)

  const examples = [...progress.matchAll(/<example>([^\n]+)<\/example>/g)].map(([, example]) => example)
  assert.ok(examples.length >= 3)
  assert.ok(examples.every(example => example.split(/\s+/).length <= 14))
  assert.match(prompt, /<final_answer>[\s\S]*?провер[\s\S]*?<\/final_answer>/i)
})

test('the latest user correction replaces a stale active goal while retaining compatible task constraints', async () => {
  const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts')
  const originalFetch = global.fetch
  let body
  global.fetch = async (_url, options) => {
    body = JSON.parse(options.body)
    return response({ content: 'Проверю только существующую конфигурацию.' })
  }
  try {
    await AgentRunner.run(
      { id: 'zipply', getTools: () => [], getHandler: () => undefined },
      [
        { role: 'user', content: 'Создай файл конфигурации.' },
        { role: 'user', content: 'Поправка: только проверь существующую конфигурацию, ничего не создавай.' }
      ],
      { model: 'test', stream: false, taskState: { goal: 'Создать файл конфигурации.', constraints: ['Не менять формат'], acceptanceCriteria: ['Файл читается'], confirmedFacts: [], nextStep: 'Создать файл' } },
      () => {}
    )
  } finally { global.fetch = originalFetch }

  const allText = body.messages.map(message => typeof message.content === 'string' ? message.content : '').join('\n')
  const state = JSON.parse(/<agent_task_state_json>([\s\S]*?)<\/agent_task_state_json>/.exec(allText)?.[1] || '{}')
  assert.equal(state.goal, 'Поправка: только проверь существующую конфигурацию, ничего не создавай.')
  assert.deepEqual(state.constraints, ['Не менять формат'])
  assert.deepEqual(state.acceptanceCriteria, ['Файл читается'])
})

test('context summaries are instructed to preserve active corrections and failed attempts', async () => {
  const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts')
  const originalFetch = global.fetch
  const requests = []
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    requests.push(body)
    const system = body.messages.find(message => message.role === 'system' || message.role === 'developer')?.content || ''
    return response({ content: /резюме диалога/i.test(system) ? 'Сохрани поправку и неудачный первый способ.' : 'Проверил актуальную цель.' })
  }
  try {
    await AgentRunner.run(
      { id: 'zipply', getTools: () => [], getHandler: () => undefined },
      [
        { role: 'user', content: 'Старое поручение: создать файл.' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'old-call-1', type: 'function', function: { name: 'inspect', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'old-call-1', name: 'inspect', content: 'Результат старой проверки. '.repeat(360) },
        { role: 'user', content: 'Поправка: ничего не создавать, только проверить существующий файл.' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'old-call-2', type: 'function', function: { name: 'inspect', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'old-call-2', name: 'inspect', content: 'Первая проверка завершилась ошибкой; этот путь не сработал. '.repeat(260) },
        { role: 'user', content: 'Следующий шаг: проверь существующий файл другим способом.' }
      ],
      { model: 'test', stream: false, contextLength: 5000, maxTokens: 256 },
      () => {}
    )
  } finally { global.fetch = originalFetch }

  assert.ok(requests.length >= 2, 'long history should be compacted before the provider request')
  const summaryPrompt = requests[0].messages.find(message => message.role === 'system' || message.role === 'developer')?.content || ''
  assert.match(summaryPrompt, /последн[а-я ]*поправк/i)
  assert.match(summaryPrompt, /устаревш/i)
  assert.match(summaryPrompt, /попытки и подходы.*результат каждой.*неудачн/i)
  const latestUser = requests.at(-1).messages.at(-1)
  assert.equal(latestUser.role, 'user')
  assert.ok(latestUser.content.endsWith('Следующий шаг: проверь существующий файл другим способом.'))
})

test('commentary becomes its own assistant message and leaves the final answer separate', () => {
  const { applyEventsToMessages } = load('src/renderer/src/hooks/useChat.ts')
  const messages = applyEventsToMessages([
    { id: 'user-1', role: 'user', content: 'Проверь файл.' },
    { id: 'assistant-1', role: 'assistant', blocks: [], isStreaming: true }
  ], [
    { type: 'token', roundId: 'round-1', content: 'Сейчас прочитаю файл.' },
    { type: 'round_end', roundId: 'round-1', hasToolCalls: true },
    { type: 'assistant_commentary', roundId: 'round-1', content: 'Сейчас прочитаю файл.' },
    { type: 'tool_start', roundId: 'round-1', callId: 'inspect-1', toolName: 'inspect', args: {} },
    { type: 'tool_result', callId: 'inspect-1', result: 'Файл прочитан.' },
    { type: 'token', roundId: 'round-2', content: 'Проверка завершена.' },
    { type: 'done' }
  ], 'assistant-1')

  const visibleAssistants = messages.filter(message => message.role === 'assistant')
  assert.equal(visibleAssistants.length, 2)
  assert.equal(visibleAssistants[0].isProgressUpdate, true)
  assert.equal(visibleAssistants[0].content, 'Сейчас прочитаю файл.')
  assert.equal(visibleAssistants[1].isProgressUpdate, undefined)
  assert.ok(visibleAssistants[1].blocks.some(block => block.type === 'text' && block.content === 'Проверка завершена.'))
  assert.ok(visibleAssistants[1].blocks.some(block => block.type === 'tool' && block.tool.status === 'completed'))
})

test('reasoning events are recorded as thinking blocks and shown via ThinkingBlock', () => {
  const { applyEventToBlocks } = load('src/renderer/src/hooks/useChat.ts')
  const blocks = []
  applyEventToBlocks({ type: 'reasoning', content: 'Внутренняя мысль модели.' }, blocks, { id: 'assistant-1', role: 'assistant', isStreaming: true })
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'thinking')
  assert.equal(blocks[0].content, 'Внутренняя мысль модели.')
})

test('saved thinking blocks are rendered with ThinkingBlock when expanded', () => {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const { ChatMessageItem } = load('src/renderer/src/components/ChatMessageItem.tsx')
  const html = renderToStaticMarkup(React.createElement(ChatMessageItem, {
    message: { id: 'old-1', role: 'assistant', blocks: [{ type: 'thinking', id: 'old-thought', content: 'Сохранённая мысль модели.' }] },
    uiState: { manualToggles: {}, groupToggles: {}, thoughtToggles: { 'old-thought': true } }
  }))
  assert.match(html, /Сохранённая мысль модели/)
})

test('progress messages are omitted from future model history while their tool results remain', () => {
  const { buildAgentHistory } = load('src/renderer/src/services/agentHistory.ts')
  const history = buildAgentHistory([
    { id: 'progress-1', role: 'assistant', content: 'Сейчас проверю файл.', isProgressUpdate: true },
    {
      id: 'assistant-tools', role: 'assistant',
      agentHistory: [
        { role: 'assistant', content: 'Сейчас проверю файл.', isProgressUpdate: true, tool_calls: [toolCall] },
        { role: 'tool', tool_call_id: 'inspect-1', name: 'inspect', content: 'Файл прочитан.' }
      ]
    }
  ])

  assert.deepEqual(history, [
    { role: 'assistant', content: null, tool_calls: [toolCall] },
    { role: 'tool', tool_call_id: 'inspect-1', name: 'inspect', content: 'Файл прочитан.' }
  ])
})

test('progress messages keep their prior agent history when a retry adds a status', () => {
  const { buildAgentHistory } = load('src/renderer/src/services/agentHistory.ts')
  const history = buildAgentHistory([{
    id: 'retry-progress', role: 'assistant', content: 'Сейчас проверю другим способом.', isProgressUpdate: true,
    agentHistory: [
      { role: 'assistant', content: 'Сейчас проверю файл.', isProgressUpdate: true, tool_calls: [{ id: 'read-1', type: 'function', function: { name: 'read_file', arguments: '{"path":"target.txt"}' } }] },
      { role: 'tool', tool_call_id: 'read-1', name: 'read_file', content: 'Предыдущий результат инструмента.' }
    ]
  }])

  assert.deepEqual(history.map(message => message.role), ['assistant', 'tool'])
  assert.equal(history[0].content, null)
  assert.equal(history[1].content, 'Предыдущий результат инструмента.')
})

test('composer offers a correction send action while an assistant response is streaming', () => {
  const { ChatActionRow } = loadWithReactTree('src/renderer/src/components/chat-input/ChatActionRow.tsx')
  const tree = ChatActionRow({
    isMenuOpen: false, onToggleMenu() {}, buttonRef: { current: null }, hasText: true, isStreaming: true,
    onCancel() {}, onSend() {}, onRemovePlan() {}, accessMode: 'confirm', onAccessModeChange: () => true
  })
  const send = findElement(tree, element => element.type === 'button' && element.props['aria-label'] === 'Отправить поправку')
  assert.ok(send)
  assert.match(send.props.className, /bg-accent/)
  assert.doesNotMatch(send.props.className, /#0A84FF|#0071E3/)
})

test('ChatInput forwards a correction while a response is streaming', async () => {
  const originalWindow = global.window
  const originalLocalStorage = global.localStorage
  global.window = { api: { storage: { get: () => ({ exists: false, value: null }), set: () => ({ ok: true }) } } }
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
  try {
    const { ChatInput } = loadWithReactTree('src/renderer/src/components/chat-input/ChatInput.tsx')
    const sent = []
    const tree = ChatInput({
      initialDraft: { value: 'Смени направление', files: [], planMode: false },
      isStreaming: true,
      activeSession: { id: 'chat-1', title: 'Чат', folderPath: 'workspace', messages: [], createdAt: 1, updatedAt: 1 },
      onSend: (...args) => sent.push(args)
    })
    const row = findElement(tree, element => element.type?.name === 'ChatActionRow')
    assert.ok(row)
    await row.props.onSend()
    assert.deepEqual(sent, [['Смени направление', false, []]])
  } finally {
    global.window = originalWindow
    global.localStorage = originalLocalStorage
  }
})

test('a correction sent during a run cancels it and resumes with prior tool results', () => {
  const old = { load: Module._load, window: global.window, localStorage: global.localStorage, raf: global.requestAnimationFrame, cancelRaf: global.cancelAnimationFrame, timeout: global.setTimeout, clearTimeout: global.clearTimeout }
  const session = { id: 'chat-1', title: 'Chat', folderPath: 'workspace', messages: [], createdAt: 1, updatedAt: 1 }
  const values = new Map([['zipply_app_settings_v1', JSON.stringify({ apiKey: 'test-key' })]])
  let listener
  let frame
  const calls = []
  const cancelled = []
  const updates = []
  global.setTimeout = () => 1
  global.clearTimeout = () => {}
  global.requestAnimationFrame = callback => { frame = callback; return 1 }
  global.cancelAnimationFrame = () => { frame = null }
  global.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  }
  global.window = {
    addEventListener() {}, removeEventListener() {},
    api: {
      storage: {
        get: key => ({ exists: values.has(key), value: values.get(key) ?? null }),
        set: (key, value) => { if (value === null) values.delete(key); else values.set(key, value); return { ok: true } }
      },
      workspace: { saveSession: () => Promise.resolve({ success: true }) },
      agent: {
        onEvent: callback => { listener = callback; return () => {} },
        chat: (history, config, requestId) => calls.push({ history, config, requestId }),
        cancel: requestId => cancelled.push(requestId)
      }
    }
  }

  try {
    const { useChat } = loadWithReactHooks('src/renderer/src/hooks/useChat.ts')
    const hook = useChat({ activeSession: session, sessions: [session], onUpdateSessionMessages: (_id, messages) => updates.push(messages) })
    hook.sendMessage('Создай файл.')
    const firstRequest = calls[0].requestId
    listener({ type: 'history', requestId: firstRequest, messages: [
      { role: 'assistant', content: 'Сейчас проверю файл.', isProgressUpdate: true, tool_calls: [toolCall] },
      { role: 'tool', tool_call_id: 'inspect-1', name: 'inspect', content: 'Файл уже существует.' }
    ] })
    if (frame) { const callback = frame; frame = undefined; callback() }

    hook.sendMessage('Не создавай файл. Сначала проверь его содержимое.')
    assert.deepEqual(cancelled, [firstRequest])
    assert.equal(updates.at(-1).at(-1).content, 'Не создавай файл. Сначала проверь его содержимое.')

    listener({ type: 'run_summary', requestId: firstRequest, summary: { reason: 'cancelled', rounds: 1, usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 }, elapsedMs: 1, checks: [], verificationStatus: 'unverified', unverifiedCriteria: [] } })
    listener({ type: 'error', requestId: firstRequest, message: 'Операция отменена пользователем.' })

    assert.equal(calls.length, 2)
    assert.ok(calls[1].history.some(message => message.role === 'user' && message.content === 'Не создавай файл. Сначала проверь его содержимое.'))
    assert.ok(calls[1].history.some(message => message.role === 'tool' && message.content === 'Файл уже существует.'))
    assert.ok(calls[1].history.some(message => message.role === 'assistant' && message.content === null && message.tool_calls?.length))
    listener({ type: 'token', requestId: firstRequest, content: 'Поздний текст старого запуска.' })
    assert.doesNotMatch(JSON.stringify(updates.at(-1)), /Поздний текст старого запуска/)
  } finally {
    Module._load = old.load
    global.window = old.window
    global.localStorage = old.localStorage
    global.requestAnimationFrame = old.raf
    global.cancelAnimationFrame = old.cancelRaf
    global.setTimeout = old.timeout
    global.clearTimeout = old.clearTimeout
  }
})

test('Retry resumes an interrupted journal and sends the legacy history when the journal is unavailable', async () => {
  const old = { window: global.window, localStorage: global.localStorage }
  const calls = []
  let journal
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
  global.window = {
    addEventListener() {}, removeEventListener() {},
    api: {
      workspace: { saveSession: async () => ({ success: true }) },
      agent: {
        getJournal: async () => journal,
        resume: (sessionId, config, requestId) => calls.push({ method: 'resume', sessionId, config, requestId }),
        chat: (history, config, requestId, _agentId, sessionId) => calls.push({ method: 'chat', history, config, requestId, sessionId })
      }
    }
  }
  try {
    const { useChat } = loadWithReactHooks('src/renderer/src/hooks/useChat.ts')
    for (const status of ['interrupted', 'completed', 'missing']) {
      journal = status === 'missing' ? null : { status, canResume: status === 'interrupted' }
      const sessionId = `chat-${status}`
      const session = {
        id: sessionId, title: 'Test session', createdAt: 1, updatedAt: 1,
        messages: [
          { id: 'request', role: 'user', content: 'Save the file', planMode: true },
          { id: 'failure', role: 'assistant', content: '⚠️ Interrupted' }
        ]
      }
      const hook = useChat({ activeSession: session, sessions: [session] })
      await hook.retry()
      assert.equal(calls.at(-1).sessionId, sessionId)
      assert.equal(calls.at(-1).config.planMode, true)
      assert.equal(calls.at(-1).method, status === 'interrupted' ? 'resume' : 'chat')
      if (status !== 'interrupted') assert.ok(calls.at(-1).history.some(message => message.content === 'Save the file'))
    }
  } finally {
    global.window = old.window
    global.localStorage = old.localStorage
  }
})

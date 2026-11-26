const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
function load(file) { const source = path.resolve(file); const built = buildSync({ entryPoints: [source], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external', loader: { '.svg': 'dataurl', '.css': 'empty' } }); const mod = new Module(source, module); mod.filename = source; mod.paths = module.paths; mod._compile(built.outputFiles[0].text, source); return mod.exports }
const action = (id, activity, type = 'file_read', status = 'completed') => ({ id, type: 'tool', tool: { id, type, activity, status, label: type === 'file_edit' ? 'Написал' : type === 'search' ? 'Поиск' : 'Прочитал', targetName: `${id}.txt`, content: `результат ${id}` } })
const thought = id => ({ id, type: 'thinking', content: `мысль ${id}` })

test('questions have their own label in the feed and activity group', () => {
  const { applyEventToBlocks } = load('src/renderer/src/hooks/useChat.ts')
  const { ChatMessageItem } = load('src/renderer/src/components/ChatMessageItem.tsx')
  const message = { id: 'm', role: 'assistant', isStreaming: true }, blocks = []
  applyEventToBlocks({ type: 'tool_call_stream', callId: 'q', toolName: 'ask_user', argsBuffer: '{"question":"Как?"}' }, blocks, message)
  assert.equal(blocks[0].tool.label, 'Уточнение')
  applyEventToBlocks({ type: 'tool_start', callId: 'q', toolName: 'ask_user', args: { question: 'Как?' } }, blocks, message)
  assert.equal(blocks[0].tool.label, 'Уточнение')
  assert.match(renderToStaticMarkup(React.createElement(ChatMessageItem, { message: { ...message, blocks } })), /Уточняю/)
  applyEventToBlocks({ type: 'tool_result', callId: 'q', result: 'Ответ пользователя: да' }, blocks, message)
  assert.match(renderToStaticMarkup(React.createElement(ChatMessageItem, { message: { ...message, blocks } })), /Уточнение/)
})

test('agent keeps presentation-only activity out of tool schemas and retains legacy labels in history', () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const defs = ToolExecutor.buildToolDefs({ getTools: () => [{ name: 'read', description: 'read', parameters: { path: { type: 'string', description: 'path', required: true } }, getExecutionPolicy: () => ({ mutates: false }) }] })
  assert.equal(defs[0].function.parameters.properties.activity, undefined)
  const { applyEventToBlocks } = load('src/renderer/src/hooks/useChat.ts')
  const message = { id: 'm', role: 'assistant' }, blocks = []
  applyEventToBlocks({ type: 'tool_call_stream', callId: 'a', toolName: 'read_file', argsBuffer: '{"path":"a.txt","activity":"Ищу изображение"}' }, blocks, message)
  assert.equal(blocks[0].tool.activity, 'Ищу изображение')
  applyEventToBlocks({ type: 'tool_start', callId: 'a', toolName: 'read_file', args: { path: 'a.txt', activity: 'Ищу изображение' } }, blocks, message)
  applyEventToBlocks({ type: 'tool_result', callId: 'a', result: 'ok' }, blocks, message)
  assert.equal(JSON.parse(JSON.stringify(blocks))[0].tool.activity, 'Ищу изображение')
})

test('groups thoughts with matching goals and starts a new stage at a goal or text boundary', () => {
  const { buildActivityItems } = load('src/renderer/src/components/chat/activityStages.ts')
  const blocks = [thought('t1'), action('a','Ищу изображение'), thought('t2'), action('b','Ищу изображение','search'), thought('t3'), action('c','Анализирую изображение'), { id:'txt',type:'text',content:'Ответ' }, action('d',undefined)]
  const items = buildActivityItems(blocks)
  assert.deepEqual(items.map(item => item.kind === 'activity' ? [item.title, item.blocks.map(b => b.id)] : [item.block.id]), [
    ['Работа над задачей',['t1','a','t2','b','t3','c']], ['txt'], ['Работа над задачей',['d']]
  ])
})

test('collapsed stages keep current actions and errors visible and preserve file edit previews', () => {
  const { ChatMessageItem } = load('src/renderer/src/components/ChatMessageItem.tsx')
  const blocks = [thought('t'), action('a', undefined), action('bad', undefined, 'search', 'error'), action('live', undefined, 'file_read', 'running'), action('edit', undefined, 'file_edit', 'running')]
  const html = renderToStaticMarkup(React.createElement(ChatMessageItem, { message: { id: 'm', role: 'assistant', blocks, isStreaming: true, activeFileToolId: 'edit' } }))
  assert.match(html, /Читаю файлы/)
  assert.match(html, /bad\.txt/); assert.match(html, /ошибка/)
  assert.doesNotMatch(html, /live\.txt/)
  assert.match(html, /edit\.txt/); assert.match(html, /результат edit/)
  assert.doesNotMatch(html, /мысль t/)
})

test('stage expansion keeps its contents in order and stays open as events arrive', () => {
  const originalLoad = Module._load
  const state = []
  let index = 0, stageButton
  const wrapped = { ...React, createElement(type, props, ...children) {
    if (type === 'button' && props?.['aria-expanded'] !== undefined && !stageButton) stageButton = props
    return React.createElement(type, props, ...children)
  }, useState(initial) {
    const position = index++
    if (position >= 2) return React.useState(initial)
    if (!(position in state)) state[position] = typeof initial === 'function' ? initial() : initial
    return [state[position], value => { state[position] = typeof value === 'function' ? value(state[position]) : value }]
  } }
  let ChatMessageItem
  try { Module._load = function(id, ...args) { return id === 'react' ? wrapped : originalLoad.call(this, id, ...args) }; ({ ChatMessageItem } = load('src/renderer/src/components/ChatMessageItem.tsx')) }
  finally { Module._load = originalLoad }
  const blocks = [thought('t1'), action('a', 'Ищу изображение'), thought('t2'), action('b', 'Ищу изображение', 'search')]
  const render = () => { index = 0; stageButton = undefined; return renderToStaticMarkup(React.createElement(ChatMessageItem, { message: { id:'m', role:'assistant', blocks, isStreaming:true } })) }
  assert.match(render(), /aria-expanded="false"/)
  stageButton.onClick()
  let html = render()
  assert.match(html, /aria-expanded="true"/)
  assert.ok(html.indexOf('a.txt') < html.indexOf('b.txt'))
  assert.doesNotMatch(html, /мысль t[12]/)
  blocks.push(action('c', 'Ищу изображение', 'file_read', 'running'))
  html = render()
  assert.match(html, /aria-expanded="true"/); assert.match(html, /c\.txt/); assert.match(html, /выполняется/)
})

test('group identities do not depend on a late arriving activity label', () => {
  const { buildActivityItems } = load('src/renderer/src/components/chat/activityStages.ts')
  const blocks = [thought('t'), action('a', undefined, 'file_read', 'running')]
  const before = buildActivityItems(blocks, true)[0]
  blocks[1].tool.activity = 'Ищу изображение'
  const after = buildActivityItems(blocks, true)[0]
  assert.equal(after.id, before.id)
  assert.equal(after.title, 'Работа над задачей')
})

test('streamed activity survives split arguments and a retry checkpoint', () => {
  const { applyEventsToMessages } = load('src/renderer/src/hooks/useChat.ts')
  const first = [{ id:'m', role:'assistant', blocks:[], isStreaming:true }]
  const started = applyEventsToMessages(first, [
    { type:'tool_call_stream', callId:'a', toolName:'read_file', argsDelta:'{"path":"a.txt",' },
    { type:'tool_call_stream', callId:'a', toolName:'read_file', argsDelta:'"activity":"Ищу файл"}' },
    { type:'tool_start', callId:'a', toolName:'read_file', args:{ path:'a.txt', activity:'Ищу файл' } },
    { type:'tool_result', callId:'a', result:'ok' },
    { type:'error', message:'Операция отменена пользователем.' }
  ])
  const restored = JSON.parse(JSON.stringify(started))
  assert.equal(restored[0].blocks.find(block => block.id === 'a').tool.activity, 'Ищу файл')
  const items = load('src/renderer/src/components/chat/activityStages.ts').buildActivityItems(restored[0].blocks)
  assert.equal(items[0].title, 'Работа над задачей')
  assert.equal(items.at(-1).block.type, 'text')
})

test('activity labels are normalized and not inferred from nested file contents', () => {
  const { applyEventToBlocks } = load('src/renderer/src/hooks/useChat.ts')
  const blocks = [], message = { id:'m', role:'assistant' }
  applyEventToBlocks({ type:'tool_start', callId:'a', toolName:'read_file', args:{ path:'a.txt', activity:'   Ищу\n  файл   ' } }, blocks, message)
  applyEventToBlocks({ type:'tool_start', callId:'b', toolName:'read_file', args:{ path:'b.txt', nested:{ activity:'Подмена' } } }, blocks, message)
  assert.equal(blocks[0].tool.activity, 'Ищу файл')
  assert.equal(blocks[1].tool.activity, 'Читаю файл b.txt')
})

test('agent rounds retain activity while executing real tools and emitting their history', async () => {
  const fs = require('node:fs/promises'), os = require('node:os')
  const { runAgent } = load('src/main/agent/index.ts')
  const { applyEventToBlocks } = load('src/renderer/src/hooks/useChat.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-stage-'))
  const previousFetch = global.fetch, requests = [], events = [], blocks = []
  const message = { id:'m', role:'assistant', isStreaming:true }
  try {
    await fs.writeFile(path.join(dir, 'a.txt'), 'hello')
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body); requests.push(body)
      const answer = requests.length === 1
        ? { content:null, tool_calls:[{ id:'call', type:'function', function:{ name:'read_file', arguments:JSON.stringify({ path:'a.txt', activity:'Изучаю проект' }) } }] }
        : { content:'Готово' }
      return new Response(JSON.stringify({ choices:[{ message:answer }] }))
    }
    await runAgent('zipply', [{ role:'user', content:'Прочитай файл' }], { model:'test', stream:false, workspacePath:dir }, event => { events.push(event); applyEventToBlocks(event, blocks, message) })
    assert.equal(requests.length, 2)
    const toolDef = requests[0].tools.find(tool => tool.function.name === 'read_file')
    assert.equal(toolDef.function.parameters.properties.activity, undefined)
    assert.doesNotMatch(requests[0].messages[0].content, /activity/)
    const read = blocks.find(block => block.type === 'tool')
    assert.equal(read.tool.activity, 'Изучаю проект')
    assert.match(read.tool.content, /hello/)
    assert.equal(read.tool.status, 'completed')
    const history = events.filter(event => event.type === 'history').at(-1).messages
    const rounds = events.filter(event => event.type === 'round_end')
    assert.deepEqual(rounds.map(event => event.hasToolCalls), [true, false])
    assert.notEqual(rounds[0].roundId, rounds[1].roundId)
    assert.match(JSON.stringify(history), /Изучаю проект/)
    assert.match(JSON.stringify(requests[1].messages), /Изучаю проект/)
  } finally { global.fetch = previousFetch; await fs.rm(dir, { recursive:true, force:true }) }
})

test('a running terminal stays visible without automatically expanding its output', () => {
  const { ChatMessageItem } = load('src/renderer/src/components/ChatMessageItem.tsx')
  const blocks = [action('cmd', 'Ищу файл', 'terminal', 'running')]
  blocks[0].tool.label = 'Терминал'
  const html = renderToStaticMarkup(React.createElement(ChatMessageItem, { message:{ id:'m', role:'assistant', blocks, isStreaming:true } }))
  assert.match(html, /Ищу файл/); assert.doesNotMatch(html, /cmd\.txt/)
  assert.match(html, /aria-expanded="false"/)
})

test('parallel tool completions keep their separate labels and original display order', () => {
  const { applyEventsToMessages } = load('src/renderer/src/hooks/useChat.ts')
  const { buildActivityItems } = load('src/renderer/src/components/chat/activityStages.ts')
  const messages = applyEventsToMessages([{ id:'m', role:'assistant', isStreaming:true, blocks:[] }], [
    { type:'tool_start', callId:'first', toolName:'read_file', args:{ path:'a', activity:'Изучаю проект' } },
    { type:'tool_start', callId:'second', toolName:'read_file', args:{ path:'b', activity:'Изучаю проект' } },
    { type:'tool_result', callId:'second', result:'b' },
    { type:'tool_result', callId:'first', result:'a' },
    { type:'done' }
  ])
  const [stage] = buildActivityItems(messages[0].blocks)
  assert.equal(stage.title, 'Работа над задачей')
  assert.deepEqual(stage.blocks.map(block => [block.id, block.tool.content]), [['first', 'a'], ['second', 'b']])
})

test('switching chats remounts the feed so stage controls cannot leak between chats', () => {
  const { ChatCanvas } = load('src/renderer/src/components/chat/ChatCanvas.tsx')
  const props = { messages:[], drafts: new Map(), onSendMessage:() => {} }
  const feedKey = id => ChatCanvas({ ...props, activeSession:{ id, title:'Chat', createdAt:1, updatedAt:1, messages:[] } }).props.children[0].key
  assert.equal(feedKey('chat-a'), 'chat-a')
  assert.equal(feedKey('chat-b'), 'chat-b')
})

test('import preserves valid activity labels and rejects invalid ones', async () => {
  const { importChatsFromJson } = load('src/renderer/src/services/settingsService.ts')
  const previous = global.FileReader
  global.FileReader = class { readAsText(file) { this.onload({ target:{ result:JSON.stringify(file) } }) } }
  const session = activity => [{ id:'chat-1', title:'Chat', createdAt:1, updatedAt:2, messages:[{ id:'m', role:'assistant', blocks:[action('a', activity)] }] }]
  try {
    const restored = await importChatsFromJson(session('Ищу файл'))
    assert.equal(restored[0].messages[0].blocks[0].tool.activity, 'Ищу файл')
    await assert.rejects(importChatsFromJson(session({ unsafe:true })), /формат|идентификатор/i)
  } finally { global.FileReader = previous }
})

test('same activity absorbs short progress updates while preserving the final answer', () => {
  const { buildActivityItems } = load('src/renderer/src/components/chat/activityStages.ts')
  const status = (id, content) => ({ id, type:'text', content, ...(id === 'answer' ? {} : { isActivity:true }) })
  const blocks = [thought('t1'), status('s1', 'Ищу проект на диске.'), action('a','Ищу проект Zipply на ПК'), thought('t2'), status('s2', 'Текущая папка пуста. Расширяю поиск.'), action('b','Ищу проект Zipply на ПК','search'), status('answer', 'Проект найден в D:/Zipply.')]
  const items = buildActivityItems(blocks)
  assert.equal(items.length, 2)
  assert.equal(items[0].title, 'Работа над задачей')
  assert.deepEqual(items[0].blocks.map(block => block.id), ['t1','s1','a','t2','s2','b'])
  assert.equal(items[1].block.id, 'answer')
})

test('questions and error messages do not disappear inside activity stages', () => {
  const { buildActivityItems } = load('src/renderer/src/components/chat/activityStages.ts')
  const blocks = [action('a','Поиск'), { id:'question', type:'text', content:'Какую папку использовать?' }, action('b','Поиск'), { id:'err-1', type:'text', content:'⚠️ Нет доступа.' }, action('c','Поиск')]
  const items = buildActivityItems(blocks)
  assert.deepEqual(items.map(item => item.kind === 'activity' ? item.blocks.map(b => b.id) : [item.block.id]), [['a'], ['question'], ['b'], ['err-1'], ['c']])
})

test('open stage keeps its identity when streamed activity absorbs preceding progress text', () => {
  const { buildActivityItems } = load('src/renderer/src/components/chat/activityStages.ts')
  const blocks = [thought('thinking'), { id:'status', type:'text', content:'Ищу проект.', isActivity:true }, action('tool', undefined, 'file_read', 'running')]
  const before = buildActivityItems(blocks, true).find(item => item.kind === 'activity')
  blocks[2].tool.activity = 'Ищу проект'
  const after = buildActivityItems(blocks, true).find(item => item.kind === 'activity')
  assert.equal(after.id, before.id)
  assert.deepEqual(after.blocks.map(block => block.id), ['thinking', 'status', 'tool'])
})

test('progress text is shown inside the expanded stage and final text remains outside', () => {
  const originalLoad = Module._load
  let stageButton, hookIndex = 0
  const state = []
  const wrapped = { ...React, createElement(type, props, ...children) {
    if (type === 'button' && props?.['aria-expanded'] !== undefined && !stageButton) stageButton = props
    return React.createElement(type, props, ...children)
  }, useState(initial) {
    const index = hookIndex++
    if (index >= 2) return React.useState(initial)
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
    return [state[index], next => { state[index] = typeof next === 'function' ? next(state[index]) : next }]
  } }
  let ChatMessageItem
  try { Module._load = function(id, ...args) { return id === 'react' ? wrapped : originalLoad.call(this,id,...args) }; ({ ChatMessageItem } = load('src/renderer/src/components/ChatMessageItem.tsx')) }
  finally { Module._load = originalLoad }
  const blocks = [{ id:'start', type:'text', content:'Ищу проект.', isActivity:true }, action('a','Ищу проект'), { id:'progress', type:'text', content:'Расширяю поиск.', isActivity:true }, action('b','Ищу проект'), { id:'answer', type:'text', content:'Проект найден.' }]
  const render = () => { hookIndex = 0; stageButton = undefined; return renderToStaticMarkup(React.createElement(ChatMessageItem,{ message:{ id:'m', role:'assistant', blocks } })) }
  const closed = render()
  assert.match(closed, /Ищу проект/); assert.doesNotMatch(closed, /Расширяю поиск/); assert.match(closed, /Проект найден/)
  stageButton.onClick()
  const open = render()
  assert.ok(open.indexOf('Ищу проект.') < open.indexOf('a.txt'))
  assert.ok(open.indexOf('a.txt') < open.indexOf('Расширяю поиск.') && open.indexOf('Расширяю поиск.') < open.indexOf('b.txt'))
  assert.ok(open.indexOf('b.txt') < open.indexOf('Проект найден.'))
})

test('round completion marks only intermediate text and groups changing activity labels without hiding the final answer', () => {
  const { applyEventsToMessages } = load('src/renderer/src/hooks/useChat.ts')
  const { buildActivityItems } = load('src/renderer/src/components/chat/activityStages.ts')
  const messages = applyEventsToMessages([{ id:'m', role:'assistant', blocks:[], isStreaming:true }], [
    { type:'token', content:'Ищу проект!\nПроверяю папки.', roundId:'r1' },
    { type:'tool_start', callId:'a', toolName:'read_file', args:{ path:'a', activity:'Ищу проект' }, roundId:'r1' },
    { type:'round_end', roundId:'r1', hasToolCalls:true },
    { type:'tool_result', callId:'a', result:'ok' },
    { type:'token', content:'Продолжаю поиск?', roundId:'r2' },
    { type:'tool_start', callId:'b', toolName:'read_file', args:{ path:'b', activity:'Проверяю папки' }, roundId:'r2' },
    { type:'round_end', roundId:'r2', hasToolCalls:true },
    { type:'tool_result', callId:'b', result:'ok' },
    { type:'token', content:'Проект найден.', roundId:'r3' },
    { type:'round_end', roundId:'r3', hasToolCalls:false },
    { type:'done' }
  ])
  const blocks = messages[0].blocks
  assert.equal(blocks[0].isActivity, true)
  assert.equal(blocks[2].isActivity, true)
  assert.notEqual(blocks.at(-1).isActivity, true)
  const items = buildActivityItems(blocks)
  assert.equal(items.length, 2)
  assert.equal(items[0].kind, 'activity')
  assert.equal(items[0].blocks.filter(b => b.type === 'tool').length, 2)
  assert.equal(items[1].block.content, 'Проект найден.')
})

test('legacy text is never hidden using punctuation heuristics', () => {
  const { buildActivityItems } = load('src/renderer/src/components/chat/activityStages.ts')
  const items = buildActivityItems([{ id:'status', type:'text', content:'Важное сообщение.' }, action('a','Поиск')])
  assert.equal(items[0].block.content, 'Важное сообщение.')
})

test('activity metadata neither reaches tool execution nor defeats the read cache', async () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const board = new Blackboard(), executed = [], validated = [], messages = [], events = []
  const tool = { name:'custom_read', validate: raw => { validated.push(JSON.parse(raw)); return null }, getExecutionPolicy: () => ({ mutates:false, parallelSafe:true, cacheable:true }), execute: async raw => { executed.push(JSON.parse(raw)); return { formattedContent:'ok' } } }
  const agent = { getHandler: () => tool }
  const cache = new Map()
  for (const [id, activity] of [['a','Первая цель'],['b','Другая цель']]) {
    await ToolExecutor.executeCalls(agent, [{ id, name:'custom_read', argumentsJson:JSON.stringify({ path:'same', activity }) }], messages, board, event => events.push(event), undefined, cache)
  }
  assert.deepEqual(executed, [{ path:'same' }])
  assert.deepEqual(validated, [{ path:'same' }, { path:'same' }])
  assert.equal(events.filter(event => event.type === 'tool_start')[1].args.activity, 'Другая цель')
})

test('collapsed activity describes its goal and kinds of completed actions', () => {
  const { ChatMessageItem } = load('src/renderer/src/components/ChatMessageItem.tsx')
  const blocks = [action('a','Ищу проект','file_read'), action('b','Ищу проект','file_read'), action('c','Ищу проект','terminal')]
  blocks[2].tool.label = 'Терминал'
  const html = renderToStaticMarkup(React.createElement(ChatMessageItem, { message:{ id:'m', role:'assistant', blocks } }))
  assert.match(html, /Ищу проект/)
  assert.doesNotMatch(html, /2 чтения|1 команда/)
  assert.doesNotMatch(html, /Работа над задачей/)
})

test('collapsed running activity shows only its current description and hides command details', () => {
  const { ChatMessageItem } = load('src/renderer/src/components/ChatMessageItem.tsx')
  const blocks = [action('cmd', 'Ищу проект на диске', 'terminal', 'running')]
  blocks[0].tool.label = 'Терминал'
  const html = renderToStaticMarkup(React.createElement(ChatMessageItem, { message:{ id:'m', role:'assistant', blocks, isStreaming:true } }))
  assert.match(html, /Ищу проект на диске/)
  assert.doesNotMatch(html, /Работа над задачей|1 действие|Терминал|cmd\.txt/)
})

test('activity removes the generic work prefix and uses clear fallback text', () => {
  const { ChatMessageItem } = load('src/renderer/src/components/ChatMessageItem.tsx')
  const render = block => renderToStaticMarkup(React.createElement(ChatMessageItem, { message:{ id:'m', role:'assistant', blocks:[block], isStreaming:true } }))
  const named = render(action('a', 'Работа над файлами — Читаю настройки', 'file_read', 'running'))
  assert.match(named, /Читаю настройки/)
  assert.doesNotMatch(named, /Работа над файлами/)
  const unnamed = render(action('b', undefined, 'search', 'running'))
  assert.match(unnamed, /Ищу информацию/)
})

test('an earlier failed command stays inside the collapsed activity group without popping out', () => {
  const { ChatMessageItem } = load('src/renderer/src/components/ChatMessageItem.tsx')
  const blocks = [action('failed', 'Проверяю окружение', 'terminal', 'error'), action('success', 'Устанавливаю pytest', 'terminal', 'completed')]
  blocks.forEach(block => { block.tool.label = 'Терминал' })
  const html = renderToStaticMarkup(React.createElement(ChatMessageItem, { message:{ id:'m', role:'assistant', blocks } }))
  const stageButton = html.match(/<button[^>]*aria-label="Устанавливаю pytest[^>]*>[\s\S]*?<\/button>/)?.[0]
  assert.ok(stageButton)
  assert.doesNotMatch(stageButton, /· ошибка/)
  assert.doesNotMatch(html, /failed\.txt/)
})

test('completed file preview closes while the agent continues another action', () => {
  const { ChatMessageItem } = load('src/renderer/src/components/ChatMessageItem.tsx')
  const file = action('edit', 'Изменяю файл', 'file_edit', 'completed')
  const running = action('search', 'Проверяю работу', 'search', 'running')
  const html = renderToStaticMarkup(React.createElement(ChatMessageItem, { message:{ id:'m', role:'assistant', blocks:[file, running], isStreaming:true, activeFileToolId:'edit' } }))
  assert.match(html, /aria-expanded="false"/)
  assert.doesNotMatch(html, /grid-rows-\[1fr\]/)
})

test('file preview can be closed during streaming and opened or closed again after completion', () => {
  const originalLoad = Module._load, state = []
  let hookIndex = 0, header
  const wrapped = { ...React, createElement(type, props, ...children) {
    if (type === 'div' && props?.role === 'button') header = props
    return React.createElement(type, props, ...children)
  }, useState(initial) {
    const index = hookIndex++
    if (index >= 2) return React.useState(initial)
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
    return [state[index], next => { state[index] = typeof next === 'function' ? next(state[index]) : next }]
  } }
  let ChatMessageItem
  try { Module._load = function(id, ...args) { return id === 'react' ? wrapped : originalLoad.call(this, id, ...args) }; ({ ChatMessageItem } = load('src/renderer/src/components/ChatMessageItem.tsx')) }
  finally { Module._load = originalLoad }
  const file = action('edit', undefined, 'file_edit', 'running')
  const message = { id:'m', role:'assistant', blocks:[file], isStreaming:true, activeFileToolId:'edit' }
  const render = () => { hookIndex = 0; header = undefined; return renderToStaticMarkup(React.createElement(ChatMessageItem, { message })) }
  assert.match(render(), /grid-rows-\[1fr\]/)
  header.onClick(); assert.match(render(), /grid-rows-\[0fr\]/)
  file.tool.status = 'completed'; message.blocks = [file]
  assert.match(render(), /grid-rows-\[0fr\]/)
  header.onClick(); assert.match(render(), /grid-rows-\[1fr\]/)
  header.onClick(); assert.match(render(), /grid-rows-\[0fr\]/)
})

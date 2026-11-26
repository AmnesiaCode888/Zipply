const test = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

const source = path.resolve('src/main/agent/services/ChatService.ts')
const built = buildSync({ entryPoints: [source], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
const mod = new Module(source, module)
mod.filename = source
mod.paths = module.paths
mod._compile(built.outputFiles[0].text, source)
const { ChatService } = mod.exports

async function parseChunks(chunks) {
  const original = global.fetch
  const events = []
  global.fetch = async () => new Response(chunks.map(content =>
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
  ).join('') + 'data: [DONE]\n\n')
  try {
    const response = await ChatService.chat({ model: 'test' }, [{ role: 'user', content: 'hi' }], undefined,
      content => events.push({ type: 'content', content }),
      content => events.push({ type: 'reasoning', content }))
    return { response, events }
  } finally { global.fetch = original }
}

function coalesce(events) {
  const result = []
  for (const event of events) {
    const last = result.at(-1)
    if (last?.type === event.type) last.content += event.content
    else result.push({ ...event })
  }
  return result
}

test('split think tags keep reasoning and answer in order across every boundary', async () => {
  const open = '<think>'
  const close = '</think>'
  for (let a = 0; a <= open.length; a++) {
    for (let b = 0; b <= close.length; b++) {
      const { response, events } = await parseChunks(['before' + open.slice(0, a), open.slice(a) + 'thought' + close.slice(0, b), close.slice(b) + 'after'])
      assert.equal(response.content, 'beforeafter', `open=${a}, close=${b}`)
      assert.equal(response.reasoningContent, 'thought', `open=${a}, close=${b}`)
      assert.deepEqual(coalesce(events), [
        { type: 'content', content: 'before' },
        { type: 'reasoning', content: 'thought' },
        { type: 'content', content: 'after' }
      ], `open=${a}, close=${b}`)
    }
  }
})

test('single-character chunks and multiple think sections preserve callback order', async () => {
  const { response, events } = await parseChunks(Array.from('a<think>b</think>c<think>d</think>e'))
  assert.equal(response.content, 'ace')
  assert.equal(response.reasoningContent, 'bd')
  assert.deepEqual(coalesce(events), [
    { type: 'content', content: 'a' }, { type: 'reasoning', content: 'b' },
    { type: 'content', content: 'c' }, { type: 'reasoning', content: 'd' },
    { type: 'content', content: 'e' }
  ])
})

test('incomplete and non-matching tag prefixes remain in their current channel', async () => {
  for (const [chunks, content, reasoning] of [
    [['text<thi'], 'text<thi', ''],
    [['text<thi', 's is literal'], 'text<this is literal', ''],
    [['<think>thought</thi'], '', 'thought</thi'],
    [['<think>thought</thi', 's is literal'], '', 'thought</this is literal']
  ]) {
    const { response, events } = await parseChunks(chunks)
    assert.equal(response.content, content)
    assert.equal(response.reasoningContent, reasoning)
    assert.equal(events.filter(event => event.type === 'content').map(event => event.content).join(''), content)
    assert.equal(events.filter(event => event.type === 'reasoning').map(event => event.content).join(''), reasoning)
  }
})

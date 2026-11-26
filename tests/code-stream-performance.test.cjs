const { test } = require('node:test')
const assert = require('node:assert/strict')
const { transformSync, buildSync } = require('esbuild')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const source = path.resolve('src/renderer/src/components/chat/codeHighlightQueue.ts')
const compiled = transformSync(fs.readFileSync(source, 'utf8'), { loader: 'ts', format: 'cjs' }).code
const mod = new Module(source, module)
mod.filename = source
mod.paths = module.paths
mod._compile(compiled, source)
const { CodeHighlightQueue } = mod.exports

function fakeWorker() {
  return {
    sent: [], terminated: false, onmessage: null, onerror: null, onmessageerror: null,
    postMessage(value) { this.sent.push(value) },
    terminate() { this.terminated = true },
    reply(id, grammar = 'javascript', html = '<span>code</span>') { this.onmessage({ data: { id, grammar, html } }) }
  }
}
const request = code => ({ code, grammar: 'javascript', detect: false, highlight: true })

test('one worker serializes jobs and discards cancelled results', () => {
  const worker = fakeWorker(), results = []
  let created = 0
  const queue = new CodeHighlightQueue(() => { created++; return worker })
  const cancel = queue.request(request('old'), result => results.push(['old', result]))
  queue.request(request('new'), result => results.push(['new', result]))
  assert.equal(worker.sent.length, 1)
  cancel()
  worker.reply(worker.sent[0].id)
  assert.equal(worker.sent.length, 2)
  worker.reply(worker.sent[1].id)
  assert.equal(created, 1)
  assert.deepEqual(results, [['new', { grammar: 'javascript', html: '<span>code</span>' }]])
})

test('a full queue asks new work to retry without dropping pending requests', () => {
  const worker = fakeWorker(), results = []
  const queue = new CodeHighlightQueue(() => worker, 1)
  queue.request(request('first'), value => results.push(['first', value]))
  queue.request(request('second'), value => results.push(['second', value]))
  queue.request(request('third'), value => results.push(['third', value]))
  assert.deepEqual(results, [['third', 'retry']])
  worker.reply(worker.sent[0].id)
  worker.reply(worker.sent[1].id)
  queue.request(request('third'), value => results.push(['third-retry', value]))
  worker.reply(worker.sent[2].id)
  assert.deepEqual(worker.sent.map(item => item.code), ['first', 'second', 'third'])
  assert.ok(results.find(([name, value]) => name === 'third-retry' && value))
})

test('more than 64 live blocks can retry and all receive highlighting', () => {
  const worker = fakeWorker(), queue = new CodeHighlightQueue(() => worker)
  const retry = [], completed = new Set()
  const submit = index => queue.request(request(String(index)), value => {
    if (value === 'retry') retry.push(index)
    else if (value) completed.add(index)
  })
  for (let i = 0; i < 70; i++) submit(i)
  for (let i = 0; i < 70; i++) {
    worker.reply(worker.sent[i].id)
    if (retry.length) submit(retry.shift())
  }
  assert.equal(completed.size, 70)
})

test('worker errors release queued requests and keep plain-text fallback', () => {
  const worker = fakeWorker(), results = []
  const queue = new CodeHighlightQueue(() => worker)
  queue.request(request('one'), value => results.push(value))
  queue.request(request('two'), value => results.push(value))
  worker.onerror(new Error('worker failed'))
  queue.request(request('three'), value => results.push(value))
  assert.equal(worker.terminated, true)
  assert.deepEqual(results, [null, null, null])
})

test('rendering code displays plain text without synchronous highlighting or detection', () => {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const hljs = require('highlight.js/lib/common')
  const originalHighlight = hljs.highlight, originalAuto = hljs.highlightAuto
  let calls = 0
  const codeSource = path.resolve('src/renderer/src/components/chat/CodeBlock.tsx')
  const output = buildSync({ entryPoints: [codeSource], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external', loader: { '.svg': 'dataurl' }, logLevel: 'silent' })
  const codeModule = new Module(codeSource, module)
  codeModule.filename = codeSource
  codeModule.paths = module.paths
  try {
    hljs.highlight = (...args) => { calls++; return originalHighlight(...args) }
    hljs.highlightAuto = (...args) => { calls++; return originalAuto(...args) }
    codeModule._compile(output.outputFiles[0].text, codeSource)
    const code = 'const value = 123;\n'.repeat(1000)
    for (const options of [{ language: '', isStreaming: true }, { language: '', isStreaming: false }, { language: 'javascript', isStreaming: false }]) {
      const html = renderToStaticMarkup(React.createElement(codeModule.exports.CodeBlock, { ...options, code }))
      assert.match(html, /const value = 123/)
    }
    assert.equal(calls, 0)
  } finally { hljs.highlight = originalHighlight; hljs.highlightAuto = originalAuto }
})

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

function load(file) {
  const filename = path.resolve(file)
  const result = buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false })
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths; mod._compile(result.outputFiles[0].text, filename); return mod.exports
}

function setup() {
  const { registerRendererSecretIpc } = load('src/main/ipc/RendererSecretIpc.ts')
  const handlers = new Map()
  const values = new Map([['mcp-server:linear:headers', 'private-header']])
  const secrets = {
    get: key => values.get(key) || '',
    set: (key, value) => value ? values.set(key, value) : values.delete(key)
  }
  registerRendererSecretIpc(secrets, (channel, listener) => handlers.set(channel, listener))
  const mainFrame = {}
  const event = (frame = mainFrame) => ({ sender: { mainFrame }, senderFrame: frame, returnValue: undefined })
  return { handlers, values, event, secrets }
}

test('renderer can access only the legacy settings migration secrets', () => {
  const { handlers, values, event, secrets } = setup()
  const allowedGet = event()
  handlers.get('secrets:get')(allowedGet, 'apiKey')
  assert.deepEqual(allowedGet.returnValue, { value: '' })
  const allowedSet = event()
  handlers.get('secrets:set')(allowedSet, { key: 'tavilyApiKey', value: 'search-key' })
  assert.deepEqual(allowedSet.returnValue, { ok: true })
  assert.equal(values.get('tavilyApiKey'), 'search-key')

  let reads = 0
  const originalGet = secrets.get
  secrets.get = key => { reads++; return originalGet(key) }
  const deniedGet = event()
  handlers.get('secrets:get')(deniedGet, 'mcp-server:linear:headers')
  assert.equal(deniedGet.returnValue.error, 'Недопустимый ключ защищённого хранилища.')
  assert.equal(reads, 0)

  const deniedSet = event()
  handlers.get('secrets:set')(deniedSet, { key: 'mcp-server:linear:headers', value: 'attacker-value' })
  assert.equal(deniedSet.returnValue.error, 'Недопустимый ключ защищённого хранилища.')
  assert.equal(values.get('mcp-server:linear:headers'), 'private-header')
})

test('renderer secret IPC rejects subframes and malformed or oversized payloads', () => {
  const { handlers, event } = setup()
  const subframe = event({})
  handlers.get('secrets:get')(subframe, 'apiKey')
  assert.ok(subframe.returnValue.error)

  const malformed = event()
  handlers.get('secrets:set')(malformed, { key: 'apiKey', value: 'x', extra: 'field' })
  assert.ok(malformed.returnValue.error)

  const oversized = event()
  handlers.get('secrets:set')(oversized, { key: 'apiKey', value: 'x'.repeat(16_385) })
  assert.ok(oversized.returnValue.error)
})

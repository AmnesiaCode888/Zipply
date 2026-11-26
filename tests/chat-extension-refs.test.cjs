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

const baseSession = () => ({ id: 'chat-1', title: 'Chat', createdAt: 1, updatedAt: 1, messages: [{ id: 'user-1', role: 'user', content: 'Review this design' }] })

test('chat history persists valid turn extension refs and remains compatible with legacy messages', () => {
  const { isValidChatSessions } = load('src/shared/chatValidation.ts')
  const session = baseSession()
  session.messages[0].extensionRefs = [{ kind: 'skill', id: 'user/design-review', label: 'Design review', revision: 'sha256:abc123' }]
  assert.equal(isValidChatSessions([session]), true)
  assert.equal(isValidChatSessions([baseSession()]), true)
})

test('chat history rejects malformed extension refs rather than dropping the selected behavior', () => {
  const { isValidChatSessions } = load('src/shared/chatValidation.ts')
  const session = baseSession()
  session.messages[0].extensionRefs = [{ kind: 'mcp_server', id: 'linear', label: 'Linear', token: 'not allowed' }]
  assert.equal(isValidChatSessions([session]), false)
})

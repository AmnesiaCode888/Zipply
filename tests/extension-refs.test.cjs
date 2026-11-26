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

test('extension refs accept typed one-turn capabilities without serializing their expanded content', () => {
  const { isExtensionRef, isExtensionRefs } = load('src/shared/extensions.ts')
  const refs = [
    { kind: 'skill', id: 'user/brand-design', label: 'Brand design', revision: 'sha256:abc123', arguments: 'landing page' },
    { kind: 'plugin', id: 'cybersec', label: 'CyberSec' },
    { kind: 'mcp_server', id: 'linear', label: 'Linear' },
    { kind: 'mcp_prompt', id: 'linear:issue-summary', serverId: 'linear', promptName: 'issue-summary', label: 'Issue summary', arguments: { id: 'ZP-42' } },
    { kind: 'mcp_resource', id: 'linear:project://web', serverId: 'linear', uri: 'project://web', label: 'Web project' }
  ]
  assert.ok(refs.every(isExtensionRef))
  assert.ok(isExtensionRefs(refs))
})

test('extension refs reject unknown kinds, unbounded strings, duplicate identities and embedded secrets', () => {
  const { isExtensionRef, isExtensionRefs } = load('src/shared/extensions.ts')
  assert.equal(isExtensionRef({ kind: 'script', id: 'run', label: 'Run' }), false)
  assert.equal(isExtensionRef({ kind: '__proto__', id: 'x', label: 'X' }), false)
  assert.equal(isExtensionRef({ kind: 'constructor', id: 'x', label: 'X' }), false)
  assert.equal(isExtensionRef({ kind: 'mcp_server', id: 'x', label: 'X', token: 'secret' }), false)
  assert.equal(isExtensionRef({ kind: 'skill', id: 'x', label: 'X', revision: 'r'.repeat(300) }), false)
  assert.equal(isExtensionRefs([
    { kind: 'plugin', id: 'cybersec', label: 'CyberSec' },
    { kind: 'plugin', id: 'cybersec', label: 'Duplicate' }
  ]), false)
  assert.equal(isExtensionRefs(new Array(40).fill({ kind: 'plugin', id: 'p', label: 'P' })), false)
})

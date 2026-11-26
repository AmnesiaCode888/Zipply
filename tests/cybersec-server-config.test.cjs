const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')

function load(file) {
  const filename = path.resolve(file)
  const result = buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false })
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths; mod._compile(result.outputFiles[0].text, filename); return mod.exports
}

const { CyberSecServerConfig } = load('src/main/agent/plugins/cybersec/ServerConfig.ts')
const { Blackboard } = load('src/main/agent/core/Blackboard.ts')

test('server config audit reports active nginx and apache risks but ignores comments and secrets', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-server-config-'))
  try {
    await fs.writeFile(path.join(dir, 'nginx.conf'), '# autoindex on;\nserver {\n  autoindex on;\n  server_tokens on;\n}\n')
    await fs.writeFile(path.join(dir, '.htaccess'), '# Options +Indexes\nOptions +Indexes\nTraceEnable On\n')
    await fs.writeFile(path.join(dir, '.env'), 'autoindex on\n')
    await fs.writeFile(path.join(dir, 'unrelated.js'), 'server_tokens on\n')
    const board = new Blackboard(); board.setArtifact('config', { workspacePath: dir })
    const result = await new CyberSecServerConfig().execute('{}', board)
    assert.equal(result.success, true)
    assert.deepEqual(result.data.findings.map(({ rule, path: file, line }) => [rule, file, line]).sort((a, b) => a[1].localeCompare(b[1]) || a[2] - b[2]), [
      ['apache-indexes', '.htaccess', 2],
      ['apache-trace', '.htaccess', 3],
      ['nginx-autoindex', 'nginx.conf', 3],
      ['nginx-server-tokens', 'nginx.conf', 4]
    ])
    assert.match(result.formattedContent, /nginx\.conf:3/)
    assert.doesNotMatch(result.formattedContent, /\.env|unrelated\.js/)
    assert.match(result.formattedContent, /ручной проверки/)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('server config audit handles missing workspace and cancellation', async () => {
  const noWorkspace = new Blackboard()
  assert.match((await new CyberSecServerConfig().execute('{}', noWorkspace)).formattedContent, /выберите папку проекта/i)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-server-config-'))
  try {
    const board = new Blackboard(); board.setArtifact('config', { workspacePath: dir })
    const aborted = new AbortController(); aborted.abort()
    const result = await new CyberSecServerConfig().execute('{}', board, aborted.signal)
    assert.equal(result.error, true)
    assert.match(result.formattedContent, /отменён/i)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

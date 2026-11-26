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

const { CyberSecSecrets } = load('src/main/agent/plugins/cybersec/Secrets.ts')
const { Blackboard } = load('src/main/agent/core/Blackboard.ts')

test('secret scan reports redacted candidates and skips .env, dependencies, and symlinks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-secrets-'))
  const external = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-secret-external-'))
  const githubToken = 'ghp_' + 'a'.repeat(36)
  const awsKey = 'AKIA' + 'A'.repeat(16)
  try {
    await fs.writeFile(path.join(root, 'settings.ts'), `const gh = '${githubToken}'\nconst accessKey = '${awsKey}'\n// -----BEGIN PRIVATE KEY-----\n`)
    await fs.writeFile(path.join(root, '.env'), `TOKEN=${githubToken}\n`)
    await fs.mkdir(path.join(root, 'node_modules'))
    await fs.writeFile(path.join(root, 'node_modules', 'dependency.js'), `const token = '${githubToken}'\n`)
    await fs.writeFile(path.join(external, 'outside.ts'), `const token = '${githubToken}'\n`)
    try { await fs.symlink(external, path.join(root, 'linked'), 'dir') } catch {}
    const board = new Blackboard(); board.setArtifact('config', { workspacePath: root })
    const tool = new CyberSecSecrets()
    const result = await tool.execute('{}', board)
    assert.equal(result.success, true)
    assert.equal(result.data.findings.length, 3)
    assert.deepEqual(result.data.findings.map(item => item.kind), ['GitHub token', 'AWS access key', 'Private key'])
    assert.deepEqual(result.data.findings.map(item => item.line), [1, 2, 3])
    assert.ok(result.data.findings.every(item => item.path === 'settings.ts'))
    assert.doesNotMatch(result.formattedContent, new RegExp(githubToken))
    assert.doesNotMatch(JSON.stringify(result.data), new RegExp(githubToken))
    assert.doesNotMatch(result.formattedContent, new RegExp(awsKey))
    assert.doesNotMatch(JSON.stringify(result.data), new RegExp(awsKey))
    assert.doesNotMatch(result.formattedContent, /outside\.ts|dependency\.js|\.env/)
    assert.equal(tool.getExecutionPolicy().mutates, false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(external, { recursive: true, force: true })
  }
})

test('secret scan requires a workspace and honors cancellation', async () => {
  const tool = new CyberSecSecrets()
  const noWorkspace = new Blackboard()
  assert.equal((await tool.execute('{}', noWorkspace)).error, true)
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-secrets-cancel-'))
  try {
    const board = new Blackboard(); board.setArtifact('config', { workspacePath: root })
    const controller = new AbortController(); controller.abort()
    assert.equal((await tool.execute('{}', board, controller.signal)).error, true)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const { promisify } = require('node:util')
const { buildSync } = require('esbuild')
const Module = require('node:module')

const execFileAsync = promisify(execFile)

function load(file) {
  const r = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const m = new Module(path.resolve(file), module)
  m.filename = path.resolve(file)
  m.paths = module.paths
  m._compile(r.outputFiles[0].text, m.filename)
  return m.exports
}

test('headless CLI runs runAgent against mock OpenAI endpoint and outputs structured JSON summary', async () => {
  const { runSingleHeadless } = load('src/main/agent/cli.ts')
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-cli-ws-'))
  await fs.writeFile(path.join(ws, 'hello.txt'), 'WORLD_42')

  let round = 0
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      round++
      res.writeHead(200, { 'Content-Type': 'application/json' })
      if (round === 1) {
        res.end(JSON.stringify({
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          choices: [{
            message: {
              content: null,
              tool_calls: [{
                id: 'v1',
                type: 'function',
                function: {
                  name: 'verify_file',
                  arguments: JSON.stringify({ path: 'hello.txt', predicate: 'contains', expected: 'WORLD_42' })
                }
              }]
            }
          }]
        }))
        return
      }
      res.end(JSON.stringify({
        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
        choices: [{ message: { content: 'Confirmed WORLD_42.' } }]
      }))
    })
  })

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    const result = await runSingleHeadless({
      prompt: 'Check hello.txt contains WORLD_42',
      workspace: ws,
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: 'test-model',
      accessMode: 'automatic',
      stream: false
    })
    assert.equal(result.reason, 'completed')
    assert.equal(result.verificationStatus, 'verified')
    assert.equal(result.falseVerified, false)
    assert.equal(result.usage.totalTokens, 31)
    assert.equal(result.rounds, 2)
  } finally {
    server.close()
    await fs.rm(ws, { recursive: true, force: true })
  }
})

test('runEvalSuite passes all harness regression fixtures with zero false verified', async () => {
  const { runEvalSuite } = load('src/main/agent/cli.ts')
  const report = await runEvalSuite(path.resolve('tests/fixtures/harness'))
  assert.ok(report.total >= 5, `expected at least 5 fixtures, got ${report.total}`)
  assert.equal(report.failed, 0, JSON.stringify(report.results.filter(r => !r.passed), null, 2))
  assert.equal(report.falseVerifiedCount, 0)
  assert.equal(report.passed, report.total)
})

test('empty fixture directories fail fast without a passing rate', async () => {
  const { runEvalSuite } = load('src/main/agent/cli.ts')
  const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-empty-eval-'))
  try {
    await assert.rejects(runEvalSuite(empty), /нет.*фикстур|no.*fixtures/i)
  } finally {
    await fs.rmdir(empty)
  }
})

test('headless exit codes distinguish unverified or interrupted work from completed answers', () => {
  const { headlessExitCode } = load('src/main/agent/cli.ts')
  assert.equal(headlessExitCode({ reason: 'completed', taskOutcome: 'answered' }), 0)
  assert.equal(headlessExitCode({ reason: 'completed', taskOutcome: 'verified' }), 0)
  assert.notEqual(headlessExitCode({ reason: 'completed', taskOutcome: 'unverified' }), 0)
  assert.notEqual(headlessExitCode({ reason: 'incomplete' }), 0)
  assert.notEqual(headlessExitCode({ reason: 'limit_rounds' }), 0)
})

test('built out/cli/zipply-agent.cjs runs --eval cleanly via node process', async () => {
  await execFileAsync('npm', ['run', 'build:cli'], { cwd: process.cwd(), shell: process.platform === 'win32' })
  const outPath = path.resolve('out/cli/zipply-agent.cjs')
  const { stdout } = await execFileAsync(process.execPath, [outPath, '--eval', path.resolve('tests/fixtures/harness'), '--json'], {
    cwd: process.cwd()
  })
  const report = JSON.parse(stdout)
  assert.equal(report.failed, 0, stdout)
  assert.ok(report.passed >= 5)
})

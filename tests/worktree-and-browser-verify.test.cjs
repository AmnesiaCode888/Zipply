const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { execFile } = require('node:child_process')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const { promisify } = require('node:util')
const { pathToFileURL } = require('node:url')

const execFileAsync = promisify(execFile)

function load(file) {
  const r = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const m = new Module(path.resolve(file), module)
  m.filename = path.resolve(file)
  m.paths = module.paths
  m._compile(r.outputFiles[0].text, m.filename)
  return m.exports
}

test('WorktreeManager creates isolated git worktree, computes diff, leaves main workspace clean, and removes cleanly', async () => {
  const { WorktreeManager } = load('src/main/agent/services/WorktreeManager.ts')
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-wt-repo-'))

  try {
    await execFileAsync('git', ['init'], { cwd: repoDir })
    await execFileAsync('git', ['config', 'user.email', 'test@zipply.local'], { cwd: repoDir })
    await execFileAsync('git', ['config', 'user.name', 'Zipply Test'], { cwd: repoDir })
    await execFileAsync('git', ['config', 'core.autocrlf', 'false'], { cwd: repoDir })
    await fs.writeFile(path.join(repoDir, 'app.txt'), 'main-version\n')
    await fs.writeFile(path.join(repoDir, '.gitignore'), 'node_modules/\n')
    await fs.mkdir(path.join(repoDir, 'node_modules'), { recursive: true })
    await fs.writeFile(path.join(repoDir, 'node_modules', 'fixture.txt'), 'shared read-only dependency\n')
    await execFileAsync('git', ['add', 'app.txt', '.gitignore'], { cwd: repoDir })
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repoDir })

    await fs.writeFile(path.join(repoDir, 'app.txt'), 'user-uncommitted-version\n')
    await fs.writeFile(path.join(repoDir, 'existing.txt'), 'user-untracked-file\n')
    const wt = await WorktreeManager.create(repoDir, 'worker-1')
    let summary
    try {
      assert.deepEqual(wt.dependencyPaths, [path.join(repoDir, 'node_modules')])
      if (wt.linkedDependencyPaths.length) {
        assert.equal(await fs.readFile(path.join(wt.linkedDependencyPaths[0], 'fixture.txt'), 'utf8'), 'shared read-only dependency\n')
      }
      assert.equal(await fs.readFile(path.join(wt.worktreePath, 'app.txt'), 'utf8'), 'user-uncommitted-version\n')
      assert.equal(await fs.readFile(path.join(wt.worktreePath, 'existing.txt'), 'utf8'), 'user-untracked-file\n')
      await fs.writeFile(path.join(wt.worktreePath, 'app.txt'), 'isolated-change\n')
      await execFileAsync('git', ['add', 'app.txt'], { cwd: wt.worktreePath })
      await fs.writeFile(path.join(wt.worktreePath, 'extra.txt'), 'new-file\n'.repeat(2000))

      assert.equal(await fs.readFile(path.join(repoDir, 'app.txt'), 'utf8'), 'user-uncommitted-version\n')
      await assert.rejects(() => fs.stat(path.join(repoDir, 'extra.txt')))

      summary = await WorktreeManager.summarize(wt.worktreePath, wt.baseTree)
      assert.match(summary.statusText, /app\.txt/)
      assert.match(summary.statusText, /extra\.txt/)
      assert.equal(summary.retainedPath, undefined, 'the linked node_modules directory should not retain an otherwise clean worktree')
      assert.match(summary.diffText, /isolated-change/)
      assert.doesNotMatch(summary.statusText, /existing\.txt/)
    } finally {
      await wt.cleanup()
    }

    await assert.rejects(() => fs.stat(wt.worktreePath))
    try {
      const patch = await fs.readFile(summary.patchPath, 'utf8')
      assert.ok(patch.length > 12000)
      assert.match(patch, /\+new-file/)
      await execFileAsync('git', ['apply', '--check', summary.patchPath], { cwd: repoDir })
    } finally {
      if (summary?.patchPath) await fs.rm(summary.patchPath, { force: true })
    }
  } finally {
    await fs.rm(repoDir, { recursive: true, force: true })
  }
})

test('DependencyEnvironment exposes parent workspace packages and script binaries to isolated workers', () => {
  const { applyDependencyEnvironment } = load('src/main/agent/services/DependencyEnvironment.ts')
  const dependencyRoot = path.join(os.tmpdir(), 'zipply-shared-dependencies')
  const env = { PATH: 'existing-bin', NODE_PATH: 'existing-node-path' }
  applyDependencyEnvironment(env, [dependencyRoot, dependencyRoot, 'relative/path'])
  assert.match(env.NODE_PATH, new RegExp(dependencyRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(env.PATH, new RegExp(path.join(dependencyRoot, '.bin').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.ok(env.PATH.endsWith(`existing-bin`))
})

test('BrowserVerifyTool verifies interactive local web page via playwright-core, blocks offline external URLs, and updates AgentRunner verification', async () => {
  const { BrowserVerifyTool } = load('src/main/agent/tools/BrowserVerifyTool.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const { runAgent } = load('src/main/agent/index.ts')

  const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-browser-verify-'))
  const tool = new BrowserVerifyTool()
  const board = new Blackboard()
  board.setArtifact('config', { workspacePath: ws, accessMode: 'automatic' })

  // 1. Offline sandbox policy refuses external internet URLs
  const blocked = await tool.execute(
    JSON.stringify({ url: 'https://example.com', assert_text: 'Example' }),
    board
  )
  assert.equal(blocked.error, true)
  assert.match(blocked.formattedContent, /localhost|127\.0\.0\.1|сеть|network/i)

  // 2. Interactive local page passes assertions and produces screenshot + fails on console error or missing text
  const pagePath = path.join(ws, 'index.html')
  await fs.writeFile(pagePath, `<!doctype html><html><body>
      <input id="name" />
      <button id="go" onclick="document.getElementById('out').textContent='HELLO_' + document.getElementById('name').value">Go</button>
      <div id="out">IDLE</div>
    </body></html>`)
  const url = pathToFileURL(pagePath).href

  const originalFetch = global.fetch
  const screenshotPaths = []
  try {
    const failRes = await tool.execute(
      JSON.stringify({ url, assert_text: 'HELLO_MISSING', capture_screenshot: false }),
      board
    )
    assert.equal(failRes.error, true)
    assert.equal(failRes.data.screenshotPath, undefined)

    const passRes = await tool.execute(
      JSON.stringify({
        url,
        actions: [
          { type: 'fill', selector: '#name', value: 'ZIPPLY' },
          { type: 'click', selector: '#go' }
        ],
        assert_selector: '#out',
        assert_text: 'HELLO_ZIPPLY',
        capture_screenshot: true
      }),
      board
    )
    assert.equal(passRes.error, undefined, passRes.formattedContent)
    assert.equal(passRes.data.passed, true)
    assert.ok(passRes.data.screenshotPath)
    screenshotPaths.push(passRes.data.screenshotPath)
    const shotStat = await fs.stat(passRes.data.screenshotPath)
    assert.ok(shotStat.size > 100)

    for (const apiMode of ['chat_completions', 'responses']) {
      const requests = []
      const callArgs = JSON.stringify({
        url,
        actions: [
          { type: 'fill', selector: '#name', value: 'E2E' },
          { type: 'click', selector: '#go' }
        ],
        assert_text: 'HELLO_E2E',
        criterion_id: 'c_1'
      })
      global.fetch = async (_url, init) => {
        requests.push(JSON.parse(init.body))
        if (apiMode === 'responses') {
          const output = requests.length === 1
            ? [{ type: 'function_call', call_id: 'bv1', name: 'browser_verify', arguments: callArgs }]
            : [{ type: 'message', content: [{ type: 'output_text', text: 'UI flow verified.' }] }]
          return Response.json({ status: 'completed', output })
        }
        const message = requests.length === 1
          ? { content: null, tool_calls: [{ id: 'bv1', type: 'function', function: { name: 'browser_verify', arguments: callArgs } }] }
          : { content: 'UI flow verified.' }
        return Response.json({ choices: [{ message }] })
      }
      const events = []
      await runAgent(
        'zipply',
        [{ role: 'user', content: 'Verify greeting UI renders HELLO_E2E' }],
        {
          model: 'test',
          apiMode,
          stream: false,
          workspacePath: ws,
          accessMode: 'automatic',
          taskState: { goal: 'Verify UI', constraints: [], acceptanceCriteria: ['Greeting displays HELLO_E2E'], confirmedFacts: [], nextStep: '' }
        },
        e => events.push(e)
      )
      const summary = events.find(e => e.type === 'run_summary')?.summary
      assert.equal(summary.verificationStatus, 'verified')
      assert.equal(summary.checks[0].toolName, 'browser_verify')
      assert.equal(summary.checks[0].criterionId, 'c_1')
      assert.equal(requests.length, 2)
      const screenshotPath = events.find(event => event.type === 'tool_result' && event.data?.screenshotPath)?.data.screenshotPath
      assert.ok(screenshotPath)
      screenshotPaths.push(screenshotPath)
      const parts = (requests[1].input || requests[1].messages).flatMap(item => Array.isArray(item.content) ? item.content : [])
      const screenshot = parts.find(part => part.type === 'input_image' || part.type === 'image_url')
      const dataUrl = apiMode === 'responses' ? screenshot?.image_url : screenshot?.image_url?.url
      assert.match(dataUrl || '', /^data:image\/png;base64,iVBORw0KGgo/)
      assert.deepEqual(Buffer.from(dataUrl.split(',')[1], 'base64'), await fs.readFile(screenshotPath))
      assert.ok(!JSON.stringify(requests[1]).includes(JSON.stringify(screenshotPath).slice(1, -1)))
      assert.doesNotMatch(JSON.stringify(events), /data:image\/png;base64|zipply-generated-image:/)
    }
  } finally {
    global.fetch = originalFetch
    await Promise.all(screenshotPaths.map(screenshotPath => fs.unlink(screenshotPath)))
    await fs.rm(ws, { recursive: true, force: true })
  }
})

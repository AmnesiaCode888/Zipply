const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')

function load(file) {
  const r = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const m = new Module(path.resolve(file), module)
  m.filename = path.resolve(file)
  m.paths = module.paths
  m._compile(r.outputFiles[0].text, m.filename)
  return m.exports
}

test('resolveSandboxPolicy maps accessMode and explicit overrides deterministically', () => {
  const { resolveSandboxPolicy } = load('src/shared/sandbox.ts')
  const ws = path.resolve(os.tmpdir(), 'zipply-policy-ws')

  assert.deepEqual(resolveSandboxPolicy({ accessMode: 'read-only' }, ws), {
    profile: 'read-only',
    network: 'off',
    writableRoots: []
  })
  assert.deepEqual(resolveSandboxPolicy({ accessMode: 'automatic', planMode: true }, ws), {
    profile: 'read-only',
    network: 'off',
    writableRoots: []
  })
  assert.deepEqual(resolveSandboxPolicy({ accessMode: 'confirm' }, ws), {
    profile: 'workspace-write',
    network: 'off',
    writableRoots: [ws]
  })
  assert.deepEqual(resolveSandboxPolicy({ accessMode: 'automatic' }, ws), {
    profile: 'workspace-write',
    network: 'off',
    writableRoots: [ws]
  })
  assert.deepEqual(resolveSandboxPolicy({ accessMode: 'unrestricted' }, ws), {
    profile: 'unrestricted',
    network: 'on',
    writableRoots: [ws]
  })
  assert.deepEqual(resolveSandboxPolicy({
    accessMode: 'automatic',
    sandbox: { profile: 'read-only', network: 'off', writableRoots: [] }
  }, ws), {
    profile: 'read-only',
    network: 'off',
    writableRoots: []
  })
})

test('read-only OS sandbox physically blocks writes inside workspace while allowing reads', async () => {
  const { TerminalSessionManager } = load('src/main/agent/services/TerminalSessionManager.ts')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-sbx-ro-'))
  const ws = path.join(root, 'ws')
  await fs.mkdir(ws)
  await fs.writeFile(path.join(ws, 'existing.txt'), 'initial')
  const mgr = new TerminalSessionManager({ forceSpawnFallback: true })
  const owner = { senderId: 1, sessionId: 'sbx-ro', workspace: ws }

  try {
    const script = [
      'const fs = require("fs");',
      'const read = fs.readFileSync("existing.txt", "utf8");',
      'let writeExistingErr = "NONE";',
      'try { fs.writeFileSync("existing.txt", "tampered"); } catch (e) { writeExistingErr = e.code; }',
      'let createNewErr = "NONE";',
      'try { fs.writeFileSync("created.txt", "evil"); } catch (e) { createNewErr = e.code; }',
      'console.log(JSON.stringify({ read, writeExistingErr, createNewErr }));'
    ].join('\n')
    const scriptPath = path.join(root, 'probe_ro.cjs')
    await fs.writeFile(scriptPath, script)

    const res = await mgr.startCommand({
      owner,
      command: `node "${scriptPath}"`,
      cwd: ws,
      yieldTimeMs: 15000,
      sandbox: { profile: 'read-only', network: 'off', writableRoots: [] }
    })

    assert.equal(res.session.status, 'exited', res.output)
    assert.equal(res.session.exitCode, 0, res.output)
    assert.equal(res.session.sandboxProfile, 'read-only')
    const match = res.output.match(/\{.*"writeExistingErr".*\}/)
    assert.ok(match, `expected JSON output, got: ${res.output}`)
    const parsed = JSON.parse(match[0])
    assert.equal(parsed.read, 'initial')
    assert.notEqual(parsed.writeExistingErr, 'NONE', 'existing file write should be blocked by OS sandbox')
    assert.notEqual(parsed.createNewErr, 'NONE', 'new file create should be blocked by OS sandbox')
    assert.equal(await fs.readFile(path.join(ws, 'existing.txt'), 'utf8'), 'initial')
    await assert.rejects(() => fs.stat(path.join(ws, 'created.txt')))
  } finally {
    await mgr.shutdown()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('workspace-write OS sandbox allows writes inside workspace but blocks writes outside workspace', async () => {
  const { TerminalSessionManager } = load('src/main/agent/services/TerminalSessionManager.ts')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-sbx-rw-'))
  const ws = path.join(root, 'ws')
  const outside = path.join(root, 'outside.txt')
  await fs.mkdir(ws)
  await fs.writeFile(outside, 'secret')
  const mgr = new TerminalSessionManager({ forceSpawnFallback: true })
  const owner = { senderId: 1, sessionId: 'sbx-rw', workspace: ws }

  try {
    const script = [
      'const fs = require("fs"); const path = require("path");',
      'fs.writeFileSync("inside.txt", "written-inside");',
      'let outsideErr = "NONE";',
      'try { fs.writeFileSync(path.join("..", "outside.txt"), "pwned"); } catch (e) { outsideErr = e.code; }',
      'console.log(JSON.stringify({ outsideErr }));'
    ].join('\n')
    const scriptPath = path.join(root, 'probe_rw.cjs')
    await fs.writeFile(scriptPath, script)

    const res = await mgr.startCommand({
      owner,
      command: `node "${scriptPath}"`,
      cwd: ws,
      yieldTimeMs: 15000,
      sandbox: { profile: 'workspace-write', network: 'off', writableRoots: [ws] }
    })

    assert.equal(res.session.status, 'exited', res.output)
    assert.equal(res.session.exitCode, 0, res.output)
    assert.equal(res.session.sandboxProfile, 'workspace-write')
    const match = res.output.match(/\{.*"outsideErr".*\}/)
    assert.ok(match, `expected JSON output, got: ${res.output}`)
    const parsed = JSON.parse(match[0])
    assert.notEqual(parsed.outsideErr, 'NONE', 'outside workspace write should be blocked by OS sandbox')
    assert.equal(await fs.readFile(path.join(ws, 'inside.txt'), 'utf8'), 'written-inside')
    assert.equal(await fs.readFile(outside, 'utf8'), 'secret')
  } finally {
    await mgr.shutdown()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('ProcessSandbox fails closed when backend is unavailable in restricted profile', async () => {
  const { ProcessSandbox, SandboxUnavailableError } = load('src/main/agent/services/ProcessSandbox.ts')
  const sbx = new ProcessSandbox({ forceBackendUnavailable: true })

  await assert.rejects(
    () => sbx.prepareSpawn({
      shell: 'cmd.exe',
      args: ['/c', 'echo should-not-run'],
      cwd: process.cwd(),
      env: { ...process.env },
      policy: { profile: 'workspace-write', network: 'off', writableRoots: [process.cwd()] }
    }),
    err => err instanceof SandboxUnavailableError || /SandboxUnavailableError/i.test(String(err.name))
  )

  const unrestricted = await sbx.prepareSpawn({
    shell: 'cmd.exe',
    args: ['/c', 'echo ok'],
    cwd: process.cwd(),
    env: { ...process.env },
    policy: { profile: 'unrestricted', network: 'on', writableRoots: [process.cwd()] }
  })
  assert.equal(unrestricted.sandboxed, false)
})

test('CommandPolicy flags network commands and ToolExecutor asks confirmation before escalating network access', async () => {
  const { classifyCommand } = load('src/main/agent/core/CommandPolicy.ts')
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')

  assert.equal(classifyCommand('curl https://example.com').requiresNetwork, true)
  assert.equal(classifyCommand('npm install left-pad').requiresNetwork, true)
  assert.equal(classifyCommand('npm test').requiresNetwork, false)

  let askedAction = null
  let executedPolicy = null
  const fakeTool = {
    name: 'exec_command',
    validate: () => null,
    getExecutionPolicy: () => ({ mutates: true, parallelSafe: false, cacheable: false }),
    execute: async (_args, board) => {
      executedPolicy = board.getArtifact('config')?.sandbox
      return { formattedContent: 'ok', success: true }
    }
  }

  const boardDenied = new Blackboard()
  boardDenied.setArtifact('config', {
    accessMode: 'automatic',
    workspacePath: process.cwd(),
    confirmAction: async (action) => { askedAction = action; return false }
  })
  const deniedMessages = []
  await ToolExecutor.executeCalls({ getHandler: () => fakeTool }, [
    { id: 'net-1', name: 'exec_command', argumentsJson: JSON.stringify({ command: 'curl https://example.com' }) }
  ], deniedMessages, boardDenied, () => {})
  assert.equal(askedAction?.kind, 'network')
  assert.equal(executedPolicy, null)
  assert.match(deniedMessages[0].content, /отклон/i)

  const boardApproved = new Blackboard()
  boardApproved.setArtifact('config', {
    accessMode: 'automatic',
    workspacePath: process.cwd(),
    confirmAction: async () => true
  })
  const approvedMessages = []
  await ToolExecutor.executeCalls({ getHandler: () => fakeTool }, [
    { id: 'net-2', name: 'exec_command', argumentsJson: JSON.stringify({ command: 'curl https://example.com' }) }
  ], approvedMessages, boardApproved, () => {})
  assert.equal(executedPolicy?.network, 'on')
  // Wait: escalation must NOT leak onto the main config after the single call completes
  assert.equal(boardApproved.getArtifact('config')?.sandbox, undefined)
})

test('user interactive shell remains separate and unsandboxed', async () => {
  const { TerminalSessionManager } = load('src/main/agent/services/TerminalSessionManager.ts')
  const mgr = new TerminalSessionManager({ forceSpawnFallback: true })
  const owner = { senderId: 7, sessionId: 'user-shell', workspace: process.cwd() }
  try {
    const snap = await mgr.startInteractiveShell(owner, process.cwd())
    assert.equal(snap.origin, 'user')
    assert.equal(snap.sandboxProfile, undefined)
  } finally {
    await mgr.shutdown()
  }
})

test('ToolExecutor asks single-use escalation when sandbox blocks a command at runtime', async () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const board = new Blackboard()
  const calls = []
  let retryAsked = false
  board.setArtifact('config', {
    accessMode: 'automatic',
    workspacePath: process.cwd(),
    confirmAction: async (action) => {
      retryAsked = true
      assert.match(action.details || '', /sandbox/i)
      return true
    }
  })

  const fakeTool = {
    name: 'exec_command',
    validate: () => null,
    getExecutionPolicy: () => ({ mutates: true, parallelSafe: false, cacheable: false }),
    execute: async (_args, scopedBoard) => {
      const sbx = scopedBoard.getArtifact('config')?.sandbox
      calls.push(sbx?.profile || 'default')
      if (calls.length === 1) {
        return { formattedContent: 'Error: EPERM: operation not permitted', error: true }
      }
      return { formattedContent: 'escalated ok', success: true }
    }
  }

  const messages = []
  await ToolExecutor.executeCalls(
    { getHandler: () => fakeTool },
    [{ id: 'esc-1', name: 'exec_command', argumentsJson: JSON.stringify({ command: 'node script.js' }) }],
    messages,
    board,
    () => {}
  )

  assert.equal(retryAsked, true)
  assert.deepEqual(calls, ['default', 'unrestricted'])
  assert.match(messages[0].content, /escalated ok/)
  assert.equal(board.getArtifact('config')?.sandbox, undefined)
})

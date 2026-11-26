const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

function load(file) {
  const r = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const m = new Module(path.resolve(file), module)
  m.filename = path.resolve(file); m.paths = module.paths
  m._compile(r.outputFiles[0].text, m.filename)
  return m.exports
}

test('startCommand returns immediately when command finishes within yieldTimeMs', async () => {
  const { TerminalSessionManager } = load('src/main/agent/services/TerminalSessionManager.ts')
  const mgr = new TerminalSessionManager({ forceSpawnFallback: true })
  const owner = { senderId: 1, sessionId: 'chat-1', workspace: process.cwd() }
  try {
    const res = await mgr.startCommand({
      owner,
      command: 'node -e "console.log(\'hello-zipply\')"',
      cwd: process.cwd(),
      yieldTimeMs: 5000
    })
    assert.equal(res.session.status, 'exited')
    assert.equal(res.session.exitCode, 0)
    assert.match(res.output, /hello-zipply/)
  } finally {
    await mgr.shutdown()
  }
})

test('startCommand preserves non-zero exit codes', async () => {
  const { TerminalSessionManager } = load('src/main/agent/services/TerminalSessionManager.ts')
  const mgr = new TerminalSessionManager({ forceSpawnFallback: true })
  const owner = { senderId: 1, sessionId: 'chat-exit', workspace: process.cwd() }
  try {
    const res = await mgr.startCommand({
      owner,
      command: 'node -e "console.error(\'boom\'); process.exit(7)"',
      cwd: process.cwd(),
      yieldTimeMs: 5000
    })
    assert.equal(res.session.status, 'exited')
    assert.equal(res.session.exitCode, 7)
    assert.match(res.output, /boom/)
  } finally {
    await mgr.shutdown()
  }
})

test('startCommand auto-backgrounds long commands and writeInput can interact & stop them', async () => {
  const { TerminalSessionManager } = load('src/main/agent/services/TerminalSessionManager.ts')
  const mgr = new TerminalSessionManager({ forceSpawnFallback: true })
  const owner = { senderId: 1, sessionId: 'chat-2', workspace: process.cwd() }
  const stranger = { senderId: 1, sessionId: 'chat-other', workspace: process.cwd() }
  const events = []
  mgr.on('terminal_event', (_owner, evt) => events.push(evt.type))
  try {
    const started = await mgr.startCommand({
      owner,
      command: 'node -e "console.log(\'ready\'); process.stdin.on(\'data\', d => { console.log(\'GOT:\' + d.toString().trim()); process.exit(0) })"',
      cwd: process.cwd(),
      yieldTimeMs: 800,
      tty: false
    })
    assert.equal(started.session.status, 'running')
    assert.ok(events.includes('session_created'))
    assert.ok(events.includes('session_output'))
    assert.equal(mgr.list(stranger).length, 0)
    assert.throws(() => mgr.attach(stranger, started.session.id), /не найден/i)

    const replied = await mgr.writeInput(owner, started.session.id, 'ping\n', { yieldTimeMs: 3000 })
    assert.equal(replied.session.status, 'exited')
    assert.match(replied.output, /GOT:ping/)
  } finally {
    await mgr.shutdown()
  }
})

test('sanitizeEnv strips sensitive API keys and tokens', () => {
  const { sanitizeEnv } = load('src/main/agent/services/TerminalSessionManager.ts')
  const env = sanitizeEnv({ PATH: '/bin', OPENAI_API_KEY: 'sk-123', ZIPPLY_TOKEN: 'secret', HOME: '/home/u' }, true)
  assert.equal(env.OPENAI_API_KEY, undefined)
  assert.equal(env.ZIPPLY_TOKEN, undefined)
  assert.equal(env.TERM, 'xterm-256color')
  assert.equal(env.HOME, '/home/u')
})

test('background tasks are identified at creation or promoted when a command yields', async () => {
  const { TerminalSessionManager } = load('src/main/agent/services/TerminalSessionManager.ts')
  const manager = new TerminalSessionManager({ forceSpawnFallback: true })
  const owner = { senderId: 1, sessionId: 'background-test', workspace: process.cwd() }
  const options = {
    owner, cwd: owner.workspace, command: 'node -e "setTimeout(() => {}, 1500)"',
    sandbox: { profile: 'unrestricted', network: 'off', writableRoots: [] }
  }
  const events = []
  manager.on('terminal_event', (_owner, event) => events.push(event))
  try {
    const explicit = await manager.startCommand({ ...options, background: true, title: 'Dev server' })
    assert.equal(events.find(event => event.type === 'session_created').session.background, true)
    assert.equal(explicit.session.title, 'Dev server')
    const promoted = await manager.startCommand({ ...options, autoBackground: true, yieldTimeMs: 50 })
    assert.equal(promoted.session.background, true)
    assert.ok(events.some(event => event.type === 'session_state' && event.terminalId === promoted.session.id && event.background))
    await manager.sendSignal(owner, promoted.session.id, 'SIGKILL')
    assert.equal(manager.attach(owner, promoted.session.id).background, true)
  } finally {
    await manager.shutdown()
  }
})

test('the configured shell evaluates commands using its native syntax', async () => {
  const { TerminalSessionManager } = load('src/main/agent/services/TerminalSessionManager.ts')
  const manager = new TerminalSessionManager({ forceSpawnFallback: true })
  const owner = { senderId: 1, sessionId: 'shell-test', workspace: process.cwd() }
  const windows = process.platform === 'win32'
  try {
    const result = await manager.startCommand({
      owner, cwd: owner.workspace,
      shellPreference: windows ? 'cmd' : 'sh',
      command: windows ? 'echo Привет && node -e "console.log(42)"' : 'printf "%s\\n" "$0" && node -e "console.log(42)"',
      sandbox: { profile: 'unrestricted', network: 'off', writableRoots: [] }
    })
    assert.equal(result.session.shell, windows ? 'Командная строка' : 'sh')
    assert.equal(result.session.exitCode, 0, result.output)
    if (windows) assert.match(result.output, /Привет/)
    assert.match(result.output, /^42\s*$/m)
  } finally {
    await manager.shutdown()
  }
})

test('Enter submits input in the interactive pipe fallback', { skip: process.platform !== 'win32' }, async () => {
  const { TerminalSessionManager } = load('src/main/agent/services/TerminalSessionManager.ts')
  const manager = new TerminalSessionManager({ forceSpawnFallback: true })
  const owner = { senderId: 1, sessionId: 'manual-shell', workspace: process.cwd() }
  try {
    const started = await manager.startInteractiveShell(owner, owner.workspace, 80, 24, 'cmd')
    assert.equal(started.shell, 'Командная строка')
    let output = ''
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(output)), 3000)
      manager.on('terminal_event', (_owner, event) => {
        if (event.type !== 'session_output' || event.terminalId !== started.id) return
        output += event.chunk
        if (!/^user-terminal-ready\s*$/m.test(output)) return
        clearTimeout(timer)
        resolve(output)
      })
    })
    manager.writeUserInput(owner, started.id, 'echo user-terminal-ready\r')
    assert.match(await result, /^user-terminal-ready\s*$/m)
  } finally {
    await manager.shutdown()
  }
})

test('persists AI terminal log across manager restarts', async () => {
  const fs = require('node:fs/promises')
  const os = require('node:os')
  const { TerminalSessionManager } = load('src/main/agent/services/TerminalSessionManager.ts')
  const logDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-term-log-'))
  const owner = { senderId: 1, sessionId: 'chat-persist', workspace: process.cwd() }
  try {
    const mgr1 = new TerminalSessionManager({ forceSpawnFallback: true, logDir })
    await mgr1.startCommand({
      owner,
      command: 'node -e "console.log(\'persisted-line-1\')"',
      cwd: process.cwd(),
      yieldTimeMs: 5000
    })
    await mgr1.shutdown()

    const mgr2 = new TerminalSessionManager({ forceSpawnFallback: true, logDir })
    const log = await mgr2.getAiLog('chat-persist')
    assert.match(log, /persisted-line-1/)
    assert.match(log, /\[код 0\]/)
    await mgr2.shutdown()
  } finally {
    await fs.rm(logDir, { recursive: true, force: true })
  }
})

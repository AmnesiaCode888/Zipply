const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')

function load(file) {
  const source = path.resolve(file)
  const result = buildSync({ entryPoints: [source], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const mod = new Module(source, module)
  mod.filename = source
  mod.paths = module.paths
  mod._compile(result.outputFiles[0].text, source)
  return mod.exports
}

test('AgentRunner verifies backgrounded exec_command completed via write_stdin and ignores grep as validation', async () => {
  const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts')
  const originalFetch = global.fetch
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-verify-stdin-'))
  let step = 0
  global.fetch = async () => {
    step++
    if (step === 1) {
      return Response.json({
        choices: [{
          message: {
            content: null,
            tool_calls: [{ id: 'c1', type: 'function', function: { name: 'edit_file', arguments: JSON.stringify({ path: 'a.txt', target: 'old', replacement: 'new' }) } }]
          }
        }]
      })
    }
    if (step === 2) {
      return Response.json({
        choices: [{
          message: {
            content: null,
            tool_calls: [{ id: 'c2', type: 'function', function: { name: 'exec_command', arguments: JSON.stringify({ command: 'npm test' }) } }]
          }
        }]
      })
    }
    if (step === 3) {
      return Response.json({
        choices: [{
          message: {
            content: null,
            tool_calls: [{ id: 'c3', type: 'function', function: { name: 'write_stdin', arguments: JSON.stringify({ session_id: 'term-1', chars: '' }) } }]
          }
        }]
      })
    }
    return Response.json({ choices: [{ message: { content: 'All tests passed.' } }] })
  }

  const tools = [
    {
      name: 'edit_file',
      description: 'edit',
      parameters: {},
      validate: () => null,
      getExecutionPolicy: () => ({ mutates: true, parallelSafe: false, cacheable: false }),
      execute: async () => ({ formattedContent: 'edited' })
    },
    {
      name: 'exec_command',
      description: 'exec',
      parameters: {},
      validate: () => null,
      getExecutionPolicy: () => ({ mutates: true, parallelSafe: false, cacheable: false }),
      execute: async () => ({
        formattedContent: '$ npm test\n\nrunning...\n\n(команда продолжает работу в фоне; session_id: term-1)',
        data: { terminalSessionId: 'term-1', status: 'running', exitCode: null, command: 'npm test' },
        success: true
      })
    },
    {
      name: 'write_stdin',
      description: 'stdin',
      parameters: {},
      validate: () => null,
      getExecutionPolicy: () => ({ mutates: true, parallelSafe: false, cacheable: false }),
      execute: async () => ({
        formattedContent: 'PASS 5/5\n\n(сессия term-1 завершена (exited, код 0))',
        data: { terminalSessionId: 'term-1', status: 'exited', exitCode: 0, command: 'npm test' },
        success: true
      })
    }
  ]

  const events = []
  try {
    await AgentRunner.run(
      { id: 'zipply', getTools: () => tools, getHandler: name => tools.find(t => t.name === name) },
      [{ role: 'user', content: 'Update and run npm test' }],
      { model: 'test', stream: false, workspacePath: dir, accessMode: 'automatic' },
      e => events.push(e)
    )
    const summary = events.findLast(e => e.type === 'run_summary')?.summary
    assert.equal(summary.verificationStatus, 'verified')
    assert.equal(summary.checks.length, 1)
    assert.equal(summary.checks[0].passed, true)
  } finally {
    global.fetch = originalFetch
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('AgentRunner does not count grep via exec_command as passing verification', async () => {
  const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts')
  const originalFetch = global.fetch
  let step = 0
  global.fetch = async () => {
    step++
    if (step === 1) {
      return Response.json({
        choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'edit_file', arguments: '{}' } }] } }]
      })
    }
    if (step === 2) {
      return Response.json({
        choices: [{ message: { content: null, tool_calls: [{ id: 'c2', type: 'function', function: { name: 'exec_command', arguments: JSON.stringify({ command: 'grep foo src/a.ts' }) } }] } }]
      })
    }
    return Response.json({ choices: [{ message: { content: 'Done' } }] })
  }
  const tools = [
    { name: 'edit_file', description: 'e', parameters: {}, validate: () => null, getExecutionPolicy: () => ({ mutates: true, parallelSafe: false, cacheable: false }), execute: async () => ({ formattedContent: 'ok' }) },
    { name: 'exec_command', description: 'x', parameters: {}, validate: () => null, getExecutionPolicy: () => ({ mutates: false, parallelSafe: true, cacheable: false }), execute: async () => ({ formattedContent: 'foo', data: { status: 'exited', exitCode: 0, command: 'grep foo src/a.ts' }, success: true }) }
  ]
  const events = []
  try {
    await AgentRunner.run(
      { id: 'zipply', getTools: () => tools, getHandler: name => tools.find(t => t.name === name) },
      [{ role: 'user', content: 'Edit file' }],
      { model: 'test', stream: false, accessMode: 'automatic' },
      e => events.push(e)
    )
    const summary = events.findLast(e => e.type === 'run_summary')?.summary
    assert.equal(summary.verificationStatus, 'unverified')
  } finally {
    global.fetch = originalFetch
  }
})

test('AgentRunner allows waiting on a running background session via write_stdin without triggering no_progress on 5 silent polls', async () => {
  const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts')
  const originalFetch = global.fetch
  let step = 0
  global.fetch = async () => {
    step++
    if (step <= 6) {
      return Response.json({
        choices: [{ message: { content: null, tool_calls: [{ id: `p${step}`, type: 'function', function: { name: 'write_stdin', arguments: JSON.stringify({ session_id: 's1', chars: '' }) } }] } }]
      })
    }
    return Response.json({ choices: [{ message: { content: 'Build finished!' } }] })
  }
  let polls = 0
  const writeStdin = {
    name: 'write_stdin',
    description: 'poll',
    parameters: {},
    validate: () => null,
    getExecutionPolicy: () => ({ mutates: true, parallelSafe: false, cacheable: false }),
    execute: async () => {
      polls++
      if (polls < 6) {
        return {
          formattedContent: '(нет нового вывода)\n\n(сессия s1 продолжает работу)',
          data: { terminalSessionId: 's1', status: 'running', exitCode: null },
          success: true
        }
      }
      return {
        formattedContent: 'Compiled successfully\n\n(сессия s1 завершена (exited, код 0))',
        data: { terminalSessionId: 's1', status: 'exited', exitCode: 0 },
        success: true
      }
    }
  }
  const events = []
  try {
    await AgentRunner.run(
      { id: 'zipply', getTools: () => [writeStdin], getHandler: () => writeStdin },
      [{ role: 'user', content: 'Wait for build' }],
      { model: 'test', stream: false, accessMode: 'automatic' },
      e => events.push(e)
    )
    assert.equal(events.at(-1).type, 'done')
    assert.equal(events.findLast(e => e.type === 'run_summary')?.summary?.reason, 'completed')
  } finally {
    global.fetch = originalFetch
  }
})

test('ToolExecutor.buildToolDefs preserves declared parameter order so path comes before content/edits', () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const { WriteFileTool } = load('src/main/agent/tools/WriteFileTool.ts')
  const { EditFileTool } = load('src/main/agent/tools/EditFileTool.ts')
  const { ApplyPatchTool } = load('src/main/agent/tools/ApplyPatchTool.ts')
  const defs = ToolExecutor.buildToolDefs({ getTools: () => [new WriteFileTool(), new EditFileTool(), new ApplyPatchTool()] })
  const writeKeys = Object.keys(defs[0].function.parameters.properties)
  const editKeys = Object.keys(defs[1].function.parameters.properties)
  assert.equal(writeKeys[0], 'path')
  assert.equal(editKeys[0], 'path')
  const opProps = Object.keys(defs[2].function.parameters.properties.operations.items.properties)
  assert.equal(opProps[0], 'path')
})

test('ToolExecutor executes read-only exec_command with external cwd serially through confirmation', async () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const { ExecCommandTool } = load('src/main/agent/tools/ExecCommandTool.ts')
  const tool = new ExecCommandTool()
  const board = new Blackboard()
  let concurrent = 0
  let maxConcurrent = 0
  board.setArtifact('config', {
    workspacePath: process.cwd(),
    accessMode: 'automatic',
    confirmAction: async () => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise(r => setTimeout(r, 20))
      concurrent--
      return false
    }
  })
  const calls = [
    { id: '1', name: 'exec_command', argumentsJson: JSON.stringify({ command: 'ls', cwd: '..' }) },
    { id: '2', name: 'exec_command', argumentsJson: JSON.stringify({ command: 'pwd', cwd: '..' }) }
  ]
  const messages = []
  await ToolExecutor.executeCalls({ getHandler: () => tool }, calls, messages, board, () => {})
  assert.equal(maxConcurrent, 1)
  assert.equal(messages.length, 2)
  assert.ok(messages.every(m => /отклонена/i.test(m.content)))
})

test('ToolExecutor allows read_file on spill logs produced by exec_command without external confirmation', async () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const { ReadFileTool } = load('src/main/agent/tools/ReadFileTool.ts')
  const tmpLogDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-spill-perm-'))
  const logFile = path.join(tmpLogDir, 'cmd-1.log')
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-ws-perm-'))
  try {
    await fs.writeFile(logFile, 'line1\nline2\n')
    const board = new Blackboard()
    let asked = false
    board.setArtifact('config', { workspacePath: workspace, accessMode: 'confirm', confirmAction: async () => { asked = true; return false } })
    const cmdTool = {
      name: 'exec_command',
      validate: () => null,
      getExecutionPolicy: () => ({ mutates: false, parallelSafe: true, cacheable: false }),
      execute: async () => ({ formattedContent: 'truncated', data: { logPath: logFile }, success: true })
    }
    const readTool = new ReadFileTool()
    const agent = { getHandler: name => name === 'exec_command' ? cmdTool : readTool }
    const messages = []
    await ToolExecutor.executeCalls(agent, [{ id: '1', name: 'exec_command', argumentsJson: JSON.stringify({ command: 'ls' }) }], messages, board, () => {})
    await ToolExecutor.executeCalls(agent, [{ id: '2', name: 'read_file', argumentsJson: JSON.stringify({ path: logFile }) }], messages, board, () => {})
    assert.equal(asked, false)
    assert.match(messages[1].content, /line1/)
  } finally {
    await fs.rm(tmpLogDir, { recursive: true, force: true })
    await fs.rm(workspace, { recursive: true, force: true })
  }
})

test('CommandPolicy handles quoted arguments, detects dangerous script/git commands, and blocks external read-only paths without confirmation', () => {
  const { classifyCommand } = load('src/main/agent/core/CommandPolicy.ts')
  assert.equal(classifyCommand('git commit -m "avoid rm -rf and git push"').risk, 'workspace_write')
  assert.equal(classifyCommand('rg "git push" src/').risk, 'read_only')
  assert.equal(classifyCommand('git checkout -- .').requiresConfirmation, true)
  assert.equal(classifyCommand('git restore .').requiresConfirmation, true)
  assert.equal(classifyCommand('python -c "import shutil; shutil.rmtree(\'.\')"').requiresConfirmation, true)
  assert.equal(classifyCommand('node -e "require(\'fs\').rmSync(\'.\', {recursive:true})"').requiresConfirmation, true)
  assert.equal(classifyCommand('cat /etc/passwd', process.cwd()).requiresConfirmation, true)
  assert.equal(classifyCommand('cat ../secret.env', process.cwd()).requiresConfirmation, true)
})

test('ExecCommandTool defaults to tty=false and yield_time_ms=10000 and accepts workdir alias', async () => {
  const { ExecCommandTool } = load('src/main/agent/tools/ExecCommandTool.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const tool = new ExecCommandTool()
  assert.equal(tool.parameters.tty.default, false)
  assert.equal(tool.parameters.yield_time_ms.default, 10000)
  const board = new Blackboard()
  board.setArtifact('config', { workspacePath: process.cwd() })
  const res = await tool.execute(JSON.stringify({ command: 'node -e "console.log(process.stdout.isTTY ? \'TTY\' : \'PIPE\')"', workdir: 'src' }), board)
  assert.equal(res.success, true)
  assert.match(res.formattedContent, /PIPE/)
  assert.equal(res.data.cwd, 'src')
})

test('WriteStdinTool honors tail_lines up to 500 without clipping at 220 lines', async () => {
  const { toolRegistry } = load('src/main/agent/tools/ToolRegistry.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const board = new Blackboard()
  board.setArtifact('config', { workspacePath: process.cwd(), processOwner: { senderId: 99, sessionId: 'tail-test', workspace: process.cwd() } })
  const execTool = toolRegistry.getTool('exec_command')
  const stdinTool = toolRegistry.getTool('write_stdin')
  const start = await execTool.execute(JSON.stringify({
    command: 'node -e "for (let i = 1; i <= 320; i++) console.log(\'L\' + i); setTimeout(() => {}, 1500)"',
    yield_time_ms: 400,
    tty: false
  }), board)
  assert.equal(start.data.status, 'running')
  const tail = await stdinTool.execute(JSON.stringify({ session_id: start.data.terminalSessionId, tail_lines: 350, yield_time_ms: 2000 }), board)
  assert.match(tail.formattedContent, /L1\b/)
  assert.match(tail.formattedContent, /L100\b/)
  assert.match(tail.formattedContent, /L320\b/)
  await stdinTool.execute(JSON.stringify({ session_id: start.data.terminalSessionId, signal: 'SIGKILL' }), board)
})

test('ToolExecutor blocks read-only shell commands that access external paths in read-only mode or without approval', async () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const { ExecCommandTool } = load('src/main/agent/tools/ExecCommandTool.ts')
  const tool = new ExecCommandTool()
  const board = new Blackboard()
  let asked = false
  board.setArtifact('config', { workspacePath: process.cwd(), accessMode: 'automatic', confirmAction: async () => { asked = true; return false } })
  const messages = []
  await ToolExecutor.executeCalls({ getHandler: () => tool }, [{ id: '1', name: 'exec_command', argumentsJson: JSON.stringify({ command: 'cat ../secret.env' }) }], messages, board, () => {})
  assert.equal(asked, true)
  assert.match(messages[0].content, /отклон/i)
})

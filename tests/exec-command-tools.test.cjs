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

test('ExecCommandTool policy marks read-only commands as non-mutating and parallelSafe', () => {
  const { ExecCommandTool } = load('src/main/agent/tools/ExecCommandTool.ts')
  const tool = new ExecCommandTool()
  assert.deepEqual(tool.getExecutionPolicy({ command: 'git status' }), { mutates: false, parallelSafe: true, cacheable: false })
  assert.deepEqual(tool.getExecutionPolicy({ command: 'npm test' }), { mutates: true, parallelSafe: false, cacheable: false })
})

test('ToolExecutor respects toolRes.noTruncate and does not truncate 400-line file reads', async () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const bigOutput = Array.from({ length: 400 }, (_, i) => `${i + 1} | line`).join('\n')
  const fakeTool = {
    name: 'read_file',
    description: 'test',
    parameters: {},
    validate: () => null,
    getExecutionPolicy: () => ({ mutates: false, parallelSafe: true, cacheable: true }),
    execute: async () => ({ formattedContent: bigOutput, noTruncate: true, success: true })
  }
  const fakeAgent = { getHandler: () => fakeTool, getTools: () => [fakeTool] }
  const messages = []
  const board = new Blackboard()
  board.setArtifact('config', { workspacePath: process.cwd() })
  await ToolExecutor.executeCalls(fakeAgent, [{ id: 'c1', name: 'read_file', argumentsJson: JSON.stringify({ path: 'package.json' }) }], messages, board, () => {})
  assert.equal(messages[0].content.split('\n').length, 400)
})

test('ToolExecutor blocks external cwd on exec_command when confirmation is denied', async () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const { ExecCommandTool } = load('src/main/agent/tools/ExecCommandTool.ts')
  const tool = new ExecCommandTool()
  const fakeAgent = { getHandler: () => tool, getTools: () => [tool] }
  const messages = []
  const board = new Blackboard()
  let asked = false
  board.setArtifact('config', {
    workspacePath: process.cwd(),
    confirmAction: async () => { asked = true; return false }
  })
  await ToolExecutor.executeCalls(
    fakeAgent,
    [{ id: 'c2', name: 'exec_command', argumentsJson: JSON.stringify({ command: 'echo hi', cwd: '..' }) }],
    messages,
    board,
    () => {}
  )
  assert.equal(asked, true)
  assert.match(messages[0].content, /отклонена/i)
})

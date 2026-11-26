const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
function load(file) { const r = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' }); const m = new Module(path.resolve(file), module); m.filename = path.resolve(file); m.paths = module.paths; m._compile(r.outputFiles[0].text, m.filename); return m.exports }
test('executor shows one approval with prepared diffs and blocks patch in read-only mode', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-patch-approval-'))
  try {
    await fs.writeFile(path.join(dir, 'a.txt'), 'before')
    const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts'); const { ApplyPatchTool } = load('src/main/agent/tools/ApplyPatchTool.ts'); const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
    const board = new Blackboard(); const tool = new ApplyPatchTool(); const approvals = []
    board.setArtifact('config', { workspacePath: dir, accessMode: 'confirm', confirmAction: async action => { approvals.push(action); return true } })
    const calls = [{ id: '1', name: 'apply_patch', argumentsJson: JSON.stringify({ operations: [{ path: 'a.txt', action: 'update', edits: [{ target: 'before', replacement: 'after' }] }] }) }]
    await ToolExecutor.executeCalls({ getHandler: () => tool }, calls, [], board, () => {})
    assert.equal(approvals.length, 1); assert.match(approvals[0].details, /-before/); assert.match(approvals[0].details, /\+after/)
    board.setArtifact('config', { workspacePath: dir, accessMode: 'read-only' }); const messages = []
    await ToolExecutor.executeCalls({ getHandler: () => tool }, calls, messages, board, () => {})
    assert.match(messages[0].content, /недоступен/)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const Module = require('node:module')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { buildSync } = require('esbuild')

const filename = path.join(__dirname, 'codex-skills-harness.bundle.cjs')
const { outputFiles } = buildSync({
  stdin: {
    contents: `
      export { runAgent, AgentRunner, Blackboard, ToolExecutor, ChatService } from '../src/main/agent/index'
      export { SkillRepository } from '../src/main/agent/skills/SkillRepository'
      export { InstallSkillTool } from '../src/main/agent/skills/InstallSkillTool'
      export { SkillImportService } from '../src/main/agent/skills/SkillImportService'
    `,
    resolveDir: __dirname
  },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false
})
const bundle = new Module(filename, module)
bundle.paths = module.paths
bundle._compile(outputFiles[0].text, filename)
const {
  runAgent, AgentRunner, Blackboard, ToolExecutor, ChatService,
  SkillRepository, InstallSkillTool, SkillImportService
} = bundle.exports

async function writeSkill(root, folder, content, extraFiles = {}) {
  const dir = path.join(root, folder)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'SKILL.md'), content, 'utf8')
  for (const [rel, body] of Object.entries(extraFiles)) {
    const target = path.join(dir, ...rel.split('/'))
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, body, 'utf8')
  }
  return dir
}

test('injects <available_skills> into runtime context and loads skill by name + support files without confirmation', async t => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-codex-skills-'))
  t.after(() => fs.rm(tmp, { recursive: true, force: true }))
  const workspace = path.join(tmp, 'workspace')
  const userSkills = path.join(tmp, 'user-skills')
  const projectSkills = path.join(workspace, '.agents', 'skills')
  await fs.mkdir(workspace, { recursive: true })

  await writeSkill(userSkills, 'review-code', '---\nname: review-code\ndescription: User-level code review.\n---\nUser instructions.\n', {
    'references/checklist.md': 'Check edge cases.'
  })
  const projectDir = await writeSkill(projectSkills, 'review-code', '---\nname: review-code\ndescription: Project-specific code review.\n---\nProject instructions.\n', {
    'references/checklist.md': 'Check project invariants.',
    'scripts/check.sh': 'echo ok\n'
  })

  const repo = new SkillRepository([
    { path: userSkills, scope: 'user', source: 'codex' },
    { path: projectSkills, scope: 'project', source: 'codex', boundaryPath: workspace }
  ])

  let capturedAgent
  let capturedSettings
  t.mock.method(AgentRunner, 'run', async (agent, _history, settings) => {
    capturedAgent = agent
    capturedSettings = settings
  })

  await runAgent('zipply', [{ role: 'user', content: 'Review my changes' }], {
    workspacePath: workspace,
    accessMode: 'confirm'
  }, () => {}, undefined, [], { skills: repo, userSkillsRoot: userSkills })

  assert.match(capturedSettings.extensionRuntimeContext, /<available_skills>/)
  assert.match(capturedSettings.extensionRuntimeContext, /\*\*review-code\*\*/)
  assert.match(capturedSettings.extensionRuntimeContext, /Project-specific code review\./)

  let approvals = 0
  const board = new Blackboard()
  board.setArtifact('config', {
    workspacePath: workspace,
    accessMode: 'confirm',
    confirmAction: async () => { approvals++; return false }
  })
  const messages = []
  await ToolExecutor.executeCalls(capturedAgent, [
    { id: 'call-1', name: 'load_skill', argumentsJson: JSON.stringify({ skillId: 'review-code' }) }
  ], messages, board, () => {})

  const loaded = messages.at(-1).content
  assert.match(loaded, /Project instructions\./)
  assert.match(loaded, /<skill_files>/)
  assert.match(loaded, /references\/checklist\.md/)
  assert.match(loaded, /scripts\/check\.sh/)
  assert.doesNotMatch(loaded, /Не запускай скрипты/)

  // Reading a file from an external user-level skill directory after loading it must not prompt confirmAction
  await ToolExecutor.executeCalls(capturedAgent, [
    { id: 'call-2', name: 'load_skill', argumentsJson: JSON.stringify({ skillId: (await repo.discover()).find(s => s.scope === 'user').id }) }
  ], messages, board, () => {})
  const userChecklist = path.join(userSkills, 'review-code', 'references', 'checklist.md')
  await ToolExecutor.executeCalls(capturedAgent, [
    { id: 'call-3', name: 'read_file', argumentsJson: JSON.stringify({ path: userChecklist }) }
  ], messages, board, () => {})
  assert.equal(approvals, 0)
  assert.match(messages.at(-1).content, /Check edge cases\./)
  assert.equal(await fs.realpath(projectDir) !== undefined, true)
})

test('save_skill writes directly without approval modal and is immediately active, while respecting read-only mode', async t => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-save-skill-'))
  t.after(() => fs.rm(tmp, { recursive: true, force: true }))
  const workspace = path.join(tmp, 'workspace')
  const userSkills = path.join(tmp, 'user-skills')
  await fs.mkdir(workspace, { recursive: true })
  const repo = new SkillRepository([
    { path: userSkills, scope: 'user', source: 'codex' },
    { path: path.join(workspace, '.agents', 'skills'), scope: 'project', source: 'codex', boundaryPath: workspace }
  ])

  let capturedAgent
  t.mock.method(AgentRunner, 'run', async (agent) => { capturedAgent = agent })
  await runAgent('zipply', [{ role: 'user', content: 'Create a skill' }], {
    workspacePath: workspace,
    accessMode: 'confirm'
  }, () => {}, undefined, [], { skills: repo, userSkillsRoot: userSkills })

  let approvals = 0
  const board = new Blackboard()
  board.setArtifact('config', {
    workspacePath: workspace,
    accessMode: 'confirm',
    confirmAction: async () => { approvals++; return false }
  })
  const messages = []
  const skillMd = '---\nname: deploy-check\ndescription: Runs pre-deploy checks.\n---\n1. Run tests.\n'
  await ToolExecutor.executeCalls(capturedAgent, [
    { id: 'save-1', name: 'save_skill', argumentsJson: JSON.stringify({ markdown: skillMd }) }
  ], messages, board, () => {})

  assert.equal(approvals, 0)
  assert.match(messages.at(-1).content, /сразу активен/)
  const savedOnDisk = await fs.readFile(path.join(workspace, '.agents', 'skills', 'deploy-check', 'SKILL.md'), 'utf8')
  assert.equal(savedOnDisk, skillMd)

  // Immediately loadable in the same run
  await ToolExecutor.executeCalls(capturedAgent, [
    { id: 'load-1', name: 'load_skill', argumentsJson: JSON.stringify({ skillId: 'deploy-check' }) }
  ], messages, board, () => {})
  assert.match(messages.at(-1).content, /1\. Run tests\./)

  // Blocked in read-only mode
  const roBoard = new Blackboard()
  roBoard.setArtifact('config', { workspacePath: workspace, accessMode: 'read-only' })
  const roMessages = []
  await ToolExecutor.executeCalls(capturedAgent, [
    { id: 'save-ro', name: 'save_skill', argumentsJson: JSON.stringify({ markdown: skillMd }) }
  ], roMessages, roBoard, () => {})
  assert.match(roMessages.at(-1).content, /недоступен в режиме только для чтения/)
})

test('install_skill skips confirmation modal in confirm mode and reports non-file mutation policy', async t => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-install-skill-'))
  t.after(() => fs.rm(tmp, { recursive: true, force: true }))
  const userData = path.join(tmp, 'userData')
  const skillsDest = path.join(tmp, 'home-skills')
  await fs.mkdir(userData, { recursive: true })
  const importer = new SkillImportService(userData, skillsDest)
  const marketplace = {
    search: async () => [{ slug: 'org/repo/lint-skill', name: 'lint-skill', source: 'org/repo', installs: 10 }],
    download: async () => ({
      skill: { slug: 'org/repo/lint-skill', name: 'lint-skill', source: 'org/repo', installs: 10 },
      commit: 'a'.repeat(40),
      files: [{ path: 'SKILL.md', content: Buffer.from('---\nname: lint-skill\ndescription: Lint project.\n---\nRun lint.\n', 'utf8') }]
    })
  }
  const tool = new InstallSkillTool(marketplace, importer)
  const policy = tool.getExecutionPolicy({ action: 'install' })
  assert.equal(policy.mutates, true)
  assert.equal(policy.modifiesFiles, false)
  assert.equal(policy.skipApproval, true)

  const fakeAgent = { getHandler: (name) => name === 'install_skill' ? tool : undefined }
  let approvals = 0
  const board = new Blackboard()
  board.setArtifact('config', {
    workspacePath: tmp,
    accessMode: 'confirm',
    confirmAction: async () => { approvals++; return false }
  })
  const messages = []
  await ToolExecutor.executeCalls(fakeAgent, [
    { id: 'inst-1', name: 'install_skill', argumentsJson: JSON.stringify({ action: 'install', slug: 'org/repo/lint-skill' }) }
  ], messages, board, () => {})
  assert.equal(approvals, 0)
  assert.match(messages.at(-1).content, /load_skill\(skillId="lint-skill"\)/)
})

test('AgentRunner preserves load_skill calls and loaded instructions in saved chat history', async t => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-history-skill-'))
  t.after(() => fs.rm(tmp, { recursive: true, force: true }))
  const skillsRoot = path.join(tmp, '.agents', 'skills')
  await writeSkill(skillsRoot, 'my-skill', '---\nname: my-skill\ndescription: Persistent skill.\n---\nFollow rule X.\n')
  const repo = new SkillRepository([{ path: skillsRoot, scope: 'project', source: 'codex', boundaryPath: tmp }])

  let turn = 0
  t.mock.method(ChatService, 'chat', async () => {
    turn++
    if (turn === 1) {
      return {
        content: '',
        toolCalls: [{ id: 'tc-skill', name: 'load_skill', argumentsJson: JSON.stringify({ skillId: 'my-skill' }) }]
      }
    }
    return { content: 'Done following rule X.', toolCalls: [] }
  })

  const events = []
  await runAgent('zipply', [{ role: 'user', content: 'Do task' }], {
    workspacePath: tmp,
    accessMode: 'confirm',
    model: 'test-model'
  }, evt => events.push(evt), undefined, [], { skills: repo, userSkillsRoot: path.join(tmp, 'user-skills') })

  const historyEvents = events.filter(e => e.type === 'history')
  assert.ok(historyEvents.length > 0)
  const finalHistory = historyEvents.at(-1).messages
  assert.ok(finalHistory.some(m => m.role === 'tool' && m.name === 'load_skill' && String(m.content).includes('Follow rule X.')))
})

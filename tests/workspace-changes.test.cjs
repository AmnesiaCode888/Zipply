const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const { buildSync } = require('esbuild')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

function load(file) {
  const built = buildSync({
    entryPoints: [file],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    packages: 'external',
    loader: { '.svg': 'dataurl' }
  })
  const mod = new Module(path.resolve(file), module)
  mod.filename = path.resolve(file)
  mod.paths = module.paths
  mod._compile(built.outputFiles[0].text, mod.filename)
  return mod.exports
}

test('SessionBaselineDriver tracks edits, supports hunk revert and full discard without git', async () => {
  const { WorkspaceChangesService } = load('src/main/services/changes/WorkspaceChangesService.ts')
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-changes-session-'))
  const userData = path.join(tmpRoot, 'userdata')
  const workspace = path.join(tmpRoot, 'workspace')
  await fs.mkdir(workspace, { recursive: true })

  const originalLines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
  const appFile = path.join(workspace, 'app.ts')
  await fs.writeFile(appFile, originalLines, 'utf8')

  const service = new WorkspaceChangesService(userData)
  const sessionId = 'chat-session-1'

  try {
    await service.ensureSessionBaseline(sessionId, workspace)

    // Pre-edit hook for agent modification + create new file
    await service.capturePreEdit(sessionId, workspace, appFile, 'agent')
    const edited = originalLines
      .replace('line 2', 'line 2 edited')
      .replace('line 18', 'line 18 edited')
    await fs.writeFile(appFile, edited, 'utf8')

    const newFile = path.join(workspace, 'helper.ts')
    await service.capturePreEdit(sessionId, workspace, newFile, 'agent')
    await fs.writeFile(newFile, 'export const ok = true\n', 'utf8')

    const summary = await service.getSummary(sessionId, workspace)
    assert.equal(summary.mode, 'session')
    assert.equal(summary.totals.files, 2)
    const appEntry = summary.entries.find((e) => e.path === 'app.ts')
    const helperEntry = summary.entries.find((e) => e.path === 'helper.ts')
    assert.ok(appEntry)
    assert.ok(helperEntry)
    assert.equal(appEntry.status, 'modified')
    assert.equal(appEntry.touchedByChat, true)
    assert.equal(helperEntry.status, 'added')

    const diff = await service.getFileDiff(sessionId, workspace, 'app.ts', 'session', 'modified')
    assert.equal(diff.kind, 'text')
    assert.equal(diff.hunks.length, 2)

    // Revert only the first hunk (line 2), keep line 18 edited
    await service.revertHunk(sessionId, workspace, 'app.ts', 'session', 0)
    const afterHunk = await fs.readFile(appFile, 'utf8')
    assert.match(afterHunk, /^line 2$/m)
    assert.match(afterHunk, /^line 18 edited$/m)

    // Discard whole file + new file
    await service.discardFile(sessionId, workspace, 'app.ts', 'session', 'modified')
    await service.discardFile(sessionId, workspace, 'helper.ts', 'session', 'added')
    assert.equal(await fs.readFile(appFile, 'utf8'), originalLines)
    await assert.rejects(fs.stat(newFile))

    const cleanSummary = await service.getSummary(sessionId, workspace)
    assert.equal(cleanSummary.entries.length, 0)

    await service.deleteSession(sessionId)
    await assert.rejects(fs.stat(path.join(userData, 'changes-sessions', sessionId)))
  } finally {
    service.closeAllWatchers()
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {})
  }
})

test('GitChangesDriver supports status, stage, unstage, hunk revert, discard and commit', async () => {
  const { WorkspaceChangesService } = load('src/main/services/changes/WorkspaceChangesService.ts')
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-changes-git-'))
  const userData = path.join(tmpRoot, 'userdata')
  const repo = path.join(tmpRoot, 'repo')
  await fs.mkdir(repo, { recursive: true })

  const service = new WorkspaceChangesService(userData)
  const gitInstalled = await service.git.isGitInstalled()
  if (!gitInstalled) {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {})
    return
  }

  try {
    await service.initRepo(repo)
    execFileSync('git', ['config', 'user.email', 'test@zipply.local'], { cwd: repo, windowsHide: true })
    execFileSync('git', ['config', 'user.name', 'Zipply Test'], { cwd: repo, windowsHide: true })

    const mainFile = path.join(repo, 'index.ts')
    const baseText = Array.from({ length: 16 }, (_, i) => `const v${i + 1} = ${i + 1}`).join('\n') + '\n'
    await fs.writeFile(mainFile, baseText, 'utf8')
    await service.stage(repo, ['index.ts'])
    const initCommit = await service.commit(repo, 'initial commit')
    assert.ok(initCommit.sha)

    // Modify tracked file + add untracked file
    const updatedText = baseText
      .replace('const v2 = 2', 'const v2 = 200')
      .replace('const v15 = 15', 'const v15 = 1500')
    await fs.writeFile(mainFile, updatedText, 'utf8')
    await fs.writeFile(path.join(repo, 'extra.txt'), 'hello\n', 'utf8')

    const summary = await service.getSummary('s1', repo)
    assert.equal(summary.mode, 'git')
    assert.equal(summary.totals.files, 2)

    // Revert first hunk only
    await service.revertHunk('s1', repo, 'index.ts', 'unstaged', 0)
    const afterHunk = await fs.readFile(mainFile, 'utf8')
    assert.match(afterHunk, /const v2 = 2\b/)
    assert.match(afterHunk, /const v15 = 1500\b/)

    // Stage and unstage
    await service.stage(repo, ['index.ts'])
    let stagedSummary = await service.getSummary('s1', repo)
    assert.ok(stagedSummary.entries.some((e) => e.path === 'index.ts' && e.scope === 'staged'))

    await service.unstage(repo, ['index.ts'])
    stagedSummary = await service.getSummary('s1', repo)
    assert.ok(stagedSummary.entries.some((e) => e.path === 'index.ts' && e.scope === 'unstaged'))

    // Stage and commit
    await service.stage(repo, ['index.ts'])
    const nextCommit = await service.commit(repo, 'update v15')
    assert.ok(nextCommit.sha)

    // Discard untracked file
    await service.discardFile('s1', repo, 'extra.txt', 'unstaged', 'untracked')
    await assert.rejects(fs.stat(path.join(repo, 'extra.txt')))

    const clean = await service.getSummary('s1', repo)
    assert.equal(clean.entries.length, 0)
  } finally {
    service.closeAllWatchers()
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {})
  }
})

test('WorkspacePanel enables Изменения tab and loadTabs restores changes tabs', () => {
  const { loadTabs } = load('src/renderer/src/hooks/useWorkspaceTabs.ts')
  const state = {
    tabs: [{ id: '1', title: 'Изменения', type: 'changes' }],
    activeTabId: '1',
    nextId: 2
  }
  global.localStorage = { getItem: () => JSON.stringify(state) }
  try {
    assert.deepEqual(loadTabs(), state)
  } finally {
    delete global.localStorage
  }

  const { WorkspacePanel } = load('src/renderer/src/components/layout/WorkspacePanel.tsx')
  const emptyHtml = renderToStaticMarkup(
    React.createElement(WorkspacePanel, {
      width: 440,
      maxWidth: 600,
      tabs: [{ id: '1', title: 'Новая вкладка', type: 'empty' }],
      activeTabId: '1'
    })
  )
  assert.match(emptyHtml, /Изменения/)
  assert.doesNotMatch(emptyHtml, /Скоро/)

  const changesHtml = renderToStaticMarkup(
    React.createElement(WorkspacePanel, {
      width: 680,
      maxWidth: 900,
      tabs: [{ id: '1', title: 'Изменения', type: 'changes' }],
      activeTabId: '1',
      folderPath: 'd:/tmp/project',
      sessionId: 'chat-1'
    })
  )
  assert.match(changesHtml, /Список изменённых файлов/)
})

test('ChangesDiffViewer renders unified and split diff modes with hunk revert', () => {
  const { ChangesDiffViewer } = load('src/renderer/src/components/layout/ChangesDiffViewer.tsx')
  const sampleDiff = {
    path: 'src/app.ts',
    scope: 'unstaged',
    status: 'modified',
    kind: 'text',
    hunks: [
      {
        id: 'hunk-0',
        index: 0,
        header: '@@ -1,3 +1,3 @@',
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 3,
        lines: [
          { type: 'context', oldLine: 1, newLine: 1, text: 'const a = 1' },
          { type: 'del', oldLine: 2, text: 'const b = 2' },
          { type: 'add', newLine: 2, text: 'const b = 42' },
          { type: 'context', oldLine: 3, newLine: 3, text: 'const c = 3' }
        ]
      }
    ]
  }

  const unifiedHtml = renderToStaticMarkup(
    React.createElement(ChangesDiffViewer, { diff: sampleDiff, viewMode: 'unified', onRevertHunk: () => {} })
  )
  assert.match(unifiedHtml, /Откатить блок/)
  assert.match(unifiedHtml, /diff-line-added/)
  assert.match(unifiedHtml, /diff-line-removed/)

  const splitHtml = renderToStaticMarkup(
    React.createElement(ChangesDiffViewer, { diff: sampleDiff, viewMode: 'split', onRevertHunk: () => {} })
  )
  assert.match(splitHtml, /grid-cols-2/)
  assert.match(splitHtml, /Откатить блок/)
  assert.match(splitHtml, /diff-word-added/)
  assert.match(splitHtml, /diff-word-removed/)
})

test('Noise filter hides .venv, custom pyvenv.cfg envs and __pycache__ while prioritizing AI-touched files', async () => {
  const { WorkspaceChangesService } = load('src/main/services/changes/WorkspaceChangesService.ts')
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-changes-noise-'))
  const userData = path.join(tmpRoot, 'userdata')
  const workspace = path.join(tmpRoot, 'workspace')
  await fs.mkdir(workspace, { recursive: true })

  const service = new WorkspaceChangesService(userData)
  const sessionId = 'chat-noise-1'

  try {
    await service.ensureSessionBaseline(sessionId, workspace)

    // Agent creates bot.py
    const botFile = path.join(workspace, 'bot.py')
    await service.capturePreEdit(sessionId, workspace, botFile, 'agent')
    await fs.writeFile(botFile, 'print("hello bot")\n', 'utf8')

    // Terminal creates .venv, custom python env with pyvenv.cfg, and __pycache__/*.pyc
    await fs.mkdir(path.join(workspace, '.venv', 'Lib', 'site-packages'), { recursive: true })
    await fs.writeFile(path.join(workspace, '.venv', 'Lib', 'site-packages', 'pkg.py'), 'x = 1\n', 'utf8')
    await fs.mkdir(path.join(workspace, 'my_custom_env', 'lib'), { recursive: true })
    await fs.writeFile(path.join(workspace, 'my_custom_env', 'pyvenv.cfg'), 'home = /usr/bin\n', 'utf8')
    await fs.writeFile(path.join(workspace, 'my_custom_env', 'lib', 'mod.py'), 'y = 2\n', 'utf8')
    await fs.mkdir(path.join(workspace, '__pycache__'), { recursive: true })
    await fs.writeFile(path.join(workspace, '__pycache__', 'bot.cpython-311.pyc'), 'pyc', 'utf8')

    const summary = await service.getSummary(sessionId, workspace, false)
    assert.equal(summary.mode, 'session')
    assert.equal(summary.entries.length, 1)
    assert.equal(summary.entries[0].path, 'bot.py')
    assert.equal(summary.entries[0].touchedByChat, true)
    assert.ok((summary.hiddenNoiseCount || 0) >= 3)

    // Explicit includeNoise reveals generated files
    const fullSummary = await service.getSummary(sessionId, workspace, true)
    assert.ok(fullSummary.entries.length > 1)
    assert.equal(fullSummary.entries[0].path, 'bot.py')

    // discardAll cleans up bot.py
    const discarded = await service.discardAll(sessionId, workspace, true)
    assert.equal(discarded.discarded, 1)
    await assert.rejects(fs.stat(botFile))
  } finally {
    service.closeAllWatchers()
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {})
  }
})

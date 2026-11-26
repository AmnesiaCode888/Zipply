const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs/promises')
const Module = require('node:module')
const os = require('node:os')
const path = require('node:path')
const { buildSync } = require('esbuild')

let Repository

function loadRepository() {
  if (Repository) return Repository
  const file = path.resolve(__dirname, '../src/main/agent/skills/SkillRepository.ts')
  const built = buildSync({
    entryPoints: [file],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    packages: 'external',
    logLevel: 'silent'
  })
  const mod = new Module(file, module)
  mod.filename = file
  mod.paths = module.paths
  mod._compile(built.outputFiles[0].text, file)
  Repository = mod.exports.SkillRepository
  return Repository
}

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-skills-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  return dir
}

async function writeSkill(root, folder, content) {
  const dir = path.join(root, folder)
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, 'SKILL.md')
  await fs.writeFile(file, content)
  return file
}

test('discovers only direct child folders containing SKILL.md', async (t) => {
  const SkillRepository = loadRepository()
  const root = await fixture(t)
  const content = '---\nname: tidy\ndescription: Tidy a project.\n---\nClean up the workspace.\n'
  const file = await writeSkill(root, 'tidy-folder', content)
  await writeSkill(root, 'container/nested', content)
  await fs.writeFile(path.join(root, 'SKILL.md'), content)
  await fs.mkdir(path.join(root, 'different-file', 'SKILL.md'), { recursive: true })

  const repo = new SkillRepository([
    { path: root, scope: 'project', source: 'workspace' },
    { path: path.join(root, 'missing'), scope: 'user', source: 'personal' }
  ])
  const descriptors = await repo.discover()
  assert.equal(descriptors.length, 1)
  const [descriptor] = descriptors
  assert.equal(descriptor.name, 'tidy')
  assert.equal(descriptor.description, 'Tidy a project.')
  assert.equal(descriptor.scope, 'project')
  assert.equal(descriptor.source, 'workspace')
  assert.equal(descriptor.bodyPath, await fs.realpath(file))
  assert.equal(descriptor.revision, createHash('sha256').update(content).digest('hex'))
  assert.equal(descriptor.disableModelInvocation, false)
  assert.equal(descriptor.userInvocable, true)
})

test('parses YAML descriptions, invocation flags and additional fields', async (t) => {
  const SkillRepository = loadRepository()
  const root = await fixture(t)
  await writeSkill(root, 'format', [
    '\uFEFF---',
    'name: "format: docs"',
    'description: >-',
    '  Formats project',
    '  documentation.',
    'disable-model-invocation: true',
    'user-invocable: false',
    'allowed-tools: [Shell, Edit]',
    'custom: { tier: 2 }',
    '---',
    '# Instructions'
  ].join('\r\n'))
  const repo = new SkillRepository([{ path: root, scope: 'package', source: 'source-package' }])

  const [descriptor] = await repo.discover()
  assert.equal(descriptor.name, 'format: docs')
  assert.equal(descriptor.description, 'Formats project documentation.')
  assert.equal(descriptor.disableModelInvocation, true)
  assert.equal(descriptor.userInvocable, false)
  assert.deepEqual(descriptor.metadata, { 'allowed-tools': ['Shell', 'Edit'], custom: { tier: 2 } })
  assert.equal(await repo.loadBody(descriptor), '# Instructions')
})

test('returns metadata during discovery and reads only SKILL.md body on demand', async (t) => {
  const SkillRepository = loadRepository()
  const root = await fixture(t)
  const header = '---\nname: tidy\ndescription: Tidy a project.\n---\n'
  const file = await writeSkill(root, 'tidy', `${header}First revision.\n`)
  await fs.writeFile(path.join(path.dirname(file), 'helper.cjs'), 'throw Error("do not execute")')
  const repo = new SkillRepository([{ path: root, scope: 'project', source: 'workspace' }])
  const [descriptor] = await repo.discover()

  assert.doesNotMatch(JSON.stringify(descriptor), /First revision/)
  await fs.writeFile(file, `${header}\nNew body.\n---\n`)
  assert.equal(await repo.loadBody(descriptor), '\nNew body.\n---\n')
})

test('preserves stable distinct IDs when short names collide', async (t) => {
  const SkillRepository = loadRepository()
  const dir = await fixture(t)
  const content = '---\nname: shared\ndescription: First revision.\n---\nRun the chosen skill.\n'
  const user = path.join(dir, 'personal')
  const project = path.join(dir, 'workspace')
  const userFile = await writeSkill(user, 'shared', content)
  await writeSkill(project, 'shared', content)
  await writeSkill(project, 'another-folder', content)
  const roots = [
    { path: user, scope: 'user', source: 'personal' },
    { path: project, scope: 'project', source: 'workspace' }
  ]
  const discovered = await new SkillRepository(roots).discover()
  assert.equal(discovered.length, 3)
  assert.equal(new Set(discovered.map(({ id }) => id)).size, 3)
  assert.ok(discovered.every(({ name }) => name === 'shared'))

  await fs.writeFile(userFile, content.replace('First revision.', 'Revised description.'))
  const rescanned = await new SkillRepository(roots.reverse()).discover()
  assert.deepEqual(rescanned.map(({ id }) => id).sort(), discovered.map(({ id }) => id).sort())
})

test('skips malformed frontmatter while retaining adjacent valid skills', async (t) => {
  const SkillRepository = loadRepository()
  const root = await fixture(t)
  const malformed = [
    '# No frontmatter',
    '---\nname: no-end\ndescription: valid\n',
    '---\nname: " "\ndescription: valid\n---\n',
    '---\nname: missing-description\n---\n',
    '---\nname: wrong-description-type\ndescription: [one, two]\n---\n',
    '---\nname: duplicate\nname: other\ndescription: valid\n---\n',
    '---\nname: bad-yaml\ndescription: [unterminated\n---\n',
    '---\nname: wrong-flag\ndescription: valid\nuser-invocable: "false"\n---\n'
  ]
  for (const [index, content] of malformed.entries()) {
    await writeSkill(root, String(index), content)
  }
  await writeSkill(root, 'valid', '---\nname: valid\ndescription: valid\n---')
  const repo = new SkillRepository([{ path: root, scope: 'user', source: 'personal' }])

  assert.deepEqual((await repo.discover()).map(({ name }) => name), ['valid'])
})

test('rejects oversized skill descriptions before they reach the runtime context', async t => {
  const SkillRepository = loadRepository()
  const root = await fixture(t)
  await writeSkill(root, 'oversized', `---\nname: oversized\ndescription: ${'x'.repeat(2001)}\n---\nBody\n`)
  assert.deepEqual(await new SkillRepository([{ path: root, scope: 'user', source: 'personal' }]).discover(), [])
})

test('rejects forged paths and descriptor identities outside a configured root', async (t) => {
  const SkillRepository = loadRepository()
  const dir = await fixture(t)
  const root = path.join(dir, 'skills')
  const content = '---\nname: tidy\ndescription: Tidy a project.\n---\nBody\n'
  const outside = await writeSkill(dir, 'skills-outside/tidy', content)
  await writeSkill(root, 'tidy', content)
  const repo = new SkillRepository([{ path: root, scope: 'project', source: 'workspace' }])
  const [descriptor] = await repo.discover()

  await assert.rejects(repo.loadBody({ ...descriptor, bodyPath: outside }), { code: 'INVALID_SKILL_PATH' })
  const traversal = [await fs.realpath(root), '..', 'skills-outside', 'tidy', 'SKILL.md'].join(path.sep)
  await assert.rejects(repo.loadBody({ ...descriptor, bodyPath: traversal }), { code: 'INVALID_SKILL_PATH' })
  await assert.rejects(repo.loadBody({ ...descriptor, id: 'other-id' }), { code: 'INVALID_SKILL_PATH' })
})

test('rejects skill folder links pointing outside a root during discovery and load', async (t) => {
  const SkillRepository = loadRepository()
  const dir = await fixture(t)
  const root = path.join(dir, 'skills')
  const content = '---\nname: tidy\ndescription: Tidy a project.\n---\nBody\n'
  const externalFile = await writeSkill(dir, 'external', content)
  const internalFile = await writeSkill(root, 'tidy', content)
  const externalFolder = path.dirname(externalFile)
  const internalFolder = path.dirname(internalFile)
  const repo = new SkillRepository([{ path: root, scope: 'project', source: 'workspace' }])
  const [descriptor] = await repo.discover()

  await fs.unlink(internalFile)
  await fs.rmdir(internalFolder)
  try {
    await fs.symlink(externalFolder, internalFolder, 'dir')
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(error.code)) throw error
    return t.skip(`Directory links unavailable (${error.code})`)
  }

  assert.deepEqual(await repo.discover(), [])
  await assert.rejects(repo.loadBody(descriptor), { code: 'INVALID_SKILL_PATH' })
})

test('rejects project skill roots redirected outside the workspace', async (t) => {
  const SkillRepository = loadRepository()
  const dir = await fixture(t)
  const workspace = path.join(dir, 'workspace')
  const outside = path.join(dir, 'private-skills')
  await fs.mkdir(workspace)
  const outsideFile = await writeSkill(outside, 'private', '---\nname: private\ndescription: Private instructions.\n---\nBody\n')
  const redirectedRoot = path.join(workspace, '.agents', 'skills')
  await fs.mkdir(path.dirname(redirectedRoot), { recursive: true })
  try {
    await fs.symlink(outside, redirectedRoot, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(error.code)) throw error
    return t.skip(`Directory links unavailable (${error.code})`)
  }

  const repo = new SkillRepository([{ path: redirectedRoot, scope: 'project', source: 'codex', boundaryPath: workspace }])
  assert.deepEqual(await repo.discover(), [])
  const externalRepo = new SkillRepository([{ path: redirectedRoot, scope: 'project', source: 'codex', boundaryPath: workspace }])
  await assert.rejects(externalRepo.loadBody({
    id: `skill:${createHash('sha256').update(JSON.stringify(['project', 'codex', await fs.realpath(outsideFile)])).digest('hex')}`,
    name: 'private', description: 'Private instructions.', scope: 'project', source: 'codex', bodyPath: await fs.realpath(outsideFile),
    revision: createHash('sha256').update(await fs.readFile(outsideFile)).digest('hex'), disableModelInvocation: false, userInvocable: true, metadata: {}
  }), { code: 'INVALID_SKILL_PATH' })
})

test('rejects SKILL.md file links pointing outside a root during discovery and load', async (t) => {
  const SkillRepository = loadRepository()
  const dir = await fixture(t)
  const root = path.join(dir, 'skills')
  const content = '---\nname: tidy\ndescription: Tidy a project.\n---\nBody\n'
  const externalFile = await writeSkill(dir, 'external', content)
  const internalFile = await writeSkill(root, 'tidy', content)
  const repo = new SkillRepository([{ path: root, scope: 'project', source: 'workspace' }])
  const [descriptor] = await repo.discover()

  await fs.unlink(internalFile)
  try {
    await fs.symlink(externalFile, internalFile, 'file')
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(error.code)) throw error
    return t.skip(`File links unavailable (${error.code})`)
  }

  assert.deepEqual(await repo.discover(), [])
  await assert.rejects(repo.loadBody(descriptor), { code: 'INVALID_SKILL_PATH' })
})

test('rejects a changed skill when the caller pins the original revision', async (t) => {
  const SkillRepository = loadRepository()
  const root = await fixture(t)
  const header = '---\nname: tidy\ndescription: Tidy a project.\n---\n'
  const file = await writeSkill(root, 'tidy', `${header}First revision.\n`)
  const repo = new SkillRepository([{ path: root, scope: 'project', source: 'workspace' }])
  const [descriptor] = await repo.discover()
  assert.equal(await repo.loadBody(descriptor, descriptor.revision), 'First revision.\n')

  await fs.writeFile(file, `${header}Second revision.\n`)
  await assert.rejects(repo.loadBody(descriptor, descriptor.revision), { code: 'STALE_SKILL_REVISION' })
  const [updated] = await repo.discover()
  assert.equal(updated.id, descriptor.id)
  assert.notEqual(updated.revision, descriptor.revision)
  assert.equal(await repo.loadBody(updated, updated.revision), 'Second revision.\n')
})

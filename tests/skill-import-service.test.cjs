const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { zipSync } = require('fflate')
const { buildSync } = require('esbuild')
const Module = require('node:module')

function load(file) {
  const filename = path.resolve(file)
  const result = buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false })
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths; mod._compile(result.outputFiles[0].text, filename); return mod.exports
}

const body = name => `---\nname: ${name}\ndescription: A test skill.\n---\nUse this skill carefully.\n`
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-skill-import-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const { SkillImportService } = load('src/main/agent/skills/SkillImportService.ts')
  return { directory, service: new SkillImportService(directory) }
}
async function write(t, name, content) {
  const { directory, service } = await fixture(t)
  const source = path.join(directory, name)
  await fs.writeFile(source, content)
  return { directory, source, service }
}

test('imports one standalone SKILL.md as a user skill and only returns safe catalog metadata', async t => {
  const { directory, source, service } = await write(t, 'SKILL.md', body('Readable skill'))
  const imported = await service.importFile(source)
  assert.equal(imported.name, 'Readable skill')
  assert.equal(imported.scope, 'user')
  assert.equal(imported.source, 'zipply')
  assert.equal('bodyPath' in imported, false)
  assert.equal('metadata' in imported, false)
  const all = await fs.readdir(path.join(directory, 'skills'))
  assert.equal(all.length, 1)
  assert.deepEqual(await fs.readdir(path.join(directory, 'skills', all[0])), ['SKILL.md'])
})

test('imports exactly one valid skill from a nested zip and ignores every sidecar file', async t => {
  const { directory, service } = await fixture(t)
  const archivePath = path.join(directory, 'skill.zip')
  const archive = zipSync({
    'bundle/frontend/SKILL.md': new TextEncoder().encode(body('Frontend skill')),
    'bundle/frontend/install.sh': new TextEncoder().encode('echo do not install'),
    'bundle/frontend/hooks/on-start.js': new TextEncoder().encode('throw new Error()'),
    'bundle/agents/reviewer.md': new TextEncoder().encode('not a skill')
  })
  await fs.writeFile(archivePath, archive)
  const imported = await service.importFile(archivePath)
  assert.equal(imported.name, 'Frontend skill')
  const installedRoot = path.join(directory, 'skills')
  const folders = await fs.readdir(installedRoot)
  assert.equal(folders.length, 1)
  assert.deepEqual(await fs.readdir(path.join(installedRoot, folders[0])), ['SKILL.md'])
})

test('rejects malformed or missing frontmatter without installing a partial skill', async t => {
  const { directory, source, service } = await write(t, 'SKILL.md', 'No metadata here')
  await assert.rejects(service.importFile(source), /skill|frontmatter|metadata/i)
  const skills = await fs.readdir(path.join(directory, 'skills')).catch(() => [])
  assert.equal(skills.length, 0)
})

test('rejects a selected SKILL.md symlink', async t => {
  const { directory, service } = await fixture(t)
  const actual = path.join(directory, 'actual.md')
  const link = path.join(directory, 'SKILL.md')
  await fs.writeFile(actual, body('Linked skill'))
  await fs.symlink(actual, link)
  await assert.rejects(service.importFile(link), /обычным файлом/i)
})

test('rejects ZIP traversal paths before extracting content', async t => {
  const { directory, service } = await fixture(t)
  const archivePath = path.join(directory, 'traversal.zip')
  await fs.writeFile(archivePath, zipSync({ '../escape/SKILL.md': new TextEncoder().encode(body('Escape')) }))
  await assert.rejects(service.importFile(archivePath), /недопустимый путь|путь вне архива/i)
  await assert.rejects(fs.access(path.join(directory, 'skills')))
})

test('rejects ZIPs containing more than one SKILL.md candidate', async t => {
  const { directory, service } = await fixture(t)
  const archivePath = path.join(directory, 'two-skills.zip')
  await fs.writeFile(archivePath, zipSync({
    'one/SKILL.md': new TextEncoder().encode(body('One')),
    'two/SKILL.md': new TextEncoder().encode(body('Two'))
  }))
  await assert.rejects(service.importFile(archivePath), /ровно один файл SKILL/i)
})

test('rejects a ZIP symlink entry even when its name is SKILL.md', async t => {
  const { directory, service } = await fixture(t)
  const archivePath = path.join(directory, 'symlink.zip')
  const archive = zipSync({ 'SKILL.md': new TextEncoder().encode(body('Symlink skill')) })
  const bytes = new Uint8Array(archive)
  for (let i = 0; i + 46 <= bytes.length; i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x01 && bytes[i + 3] === 0x02) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      view.setUint32(i + 38, (0o120777 << 16) >>> 0, true)
      break
    }
  }
  await fs.writeFile(archivePath, bytes)
  await assert.rejects(service.importFile(archivePath), /символьные ссылки|специальные файлы/i)
})

test('rejects oversized archives and declared decompression bombs before unzipping', async t => {
  const { directory, service } = await fixture(t)
  const archivePath = path.join(directory, 'bomb.zip')
  const bytes = new Uint8Array(zipSync({ 'SKILL.md': new TextEncoder().encode(body('Bomb')) }))
  for (let i = 0; i + 46 <= bytes.length; i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x01 && bytes[i + 3] === 0x02) {
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(i + 24, 50 * 1024 * 1024, true)
      break
    }
  }
  await fs.writeFile(archivePath, bytes)
  await assert.rejects(service.importFile(archivePath), /размер ZIP превышает|размер ZIP/i)
})

test('caps the actual streamed output even when ZIP metadata understates its size', async t => {
  const { directory, service } = await fixture(t)
  const archivePath = path.join(directory, 'understated.zip')
  const payload = new Uint8Array(2 * 1024 * 1024).fill(0x41)
  const bytes = new Uint8Array(zipSync({ 'SKILL.md': payload }))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let central = -1
  let local = -1
  for (let i = 0; i + 46 <= bytes.length; i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x01 && bytes[i + 3] === 0x02) { central = i; break }
  }
  assert.notEqual(central, -1)
  const localOffset = view.getUint32(central + 42, true)
  local = localOffset
  view.setUint32(central + 24, 100, true)
  view.setUint32(local + 22, 100, true)
  await fs.writeFile(archivePath, bytes)
  await assert.rejects(service.importFile(archivePath), /распакованный SKILL.md|распаковать/i)
})

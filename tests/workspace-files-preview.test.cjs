const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

function load(file) {
  const built = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const mod = new Module(path.resolve(file), module)
  mod.filename = path.resolve(file); mod.paths = module.paths
  mod._compile(built.outputFiles[0].text, mod.filename)
  return mod.exports
}

test('readWorkspacePreview handles text, safe image/video, too-large, binary and blocks traversal', async () => {
  const { readWorkspacePreview, resolveWorkspaceRevealPath } = load('src/main/services/WorkspaceFiles.ts')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zipply-preview-'))
  try {
    fs.writeFileSync(path.join(tmp, 'hello.ts'), 'export const x = 1\n', 'utf8')
    fs.writeFileSync(path.join(tmp, 'photo.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    fs.writeFileSync(path.join(tmp, 'clip.mp4'), Buffer.from([0, 0, 0, 24, 102, 116, 121, 112]))
    fs.writeFileSync(path.join(tmp, 'data.bin'), Buffer.from([1, 2, 0, 4]))
    fs.writeFileSync(path.join(tmp, 'huge.log'), Buffer.alloc(2_100_000, 65))

    const txt = await readWorkspacePreview(tmp, 'hello.ts')
    assert.equal(txt.kind, 'text')
    assert.equal(txt.text, 'export const x = 1\n')

    const img = await readWorkspacePreview(tmp, 'photo.png')
    assert.equal(img.kind, 'image')
    assert.equal(img.mime, 'image/png')

    const vid = await readWorkspacePreview(tmp, 'clip.mp4')
    assert.equal(vid.kind, 'video')
    assert.equal(vid.mime, 'video/mp4')

    const bin = await readWorkspacePreview(tmp, 'data.bin')
    assert.equal(bin.kind, 'binary')

    const large = await readWorkspacePreview(tmp, 'huge.log')
    assert.equal(large.kind, 'too-large')
    assert.equal(large.mediaType, 'text')

    const revealed = await resolveWorkspaceRevealPath(tmp, 'huge.log')
    assert.equal(revealed, fs.realpathSync(path.join(tmp, 'huge.log')))

    await assert.rejects(() => readWorkspacePreview(tmp, '..'), /вне рабочей папки/)
    await assert.rejects(() => resolveWorkspaceRevealPath(tmp, '..'), /вне рабочей папки/)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

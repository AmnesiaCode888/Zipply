const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const { zipSync, strToU8 } = require('fflate')
function load(file) { const result = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' }); const mod = new Module(path.resolve(file), module); mod.filename = path.resolve(file); mod.paths = module.paths; mod._compile(result.outputFiles[0].text, mod.filename); return mod.exports }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

test('archive restores image bytes and model history after the original workspace disappears', async () => {
  const { saveImage, readImage } = load('src/main/services/ImageUploads.ts')
  const { createChatArchive, restoreChatArchive } = load('src/main/services/ChatArchive.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-archive-'))
  try {
    const original = path.join(dir, 'original'); await fs.mkdir(original)
    const attachment = await saveImage(original, 'photo.png', png)
    const sessions = [{ id: 'chat-1', title: 'Photo', createdAt: 1, updatedAt: 2, folderPath: original, messages: [
      { id: 'm1', role: 'user', content: 'Look', attachments: [attachment] },
      { id: 'm2', role: 'assistant', agentHistory: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `zipply-upload:${attachment.path}` } }] }] }
    ] }]
    const archive = await createChatArchive(sessions)
    await fs.rm(original, { recursive: true })
    const restored = await restoreChatArchive(archive, path.join(dir, 'restored'))
    assert.notEqual(restored[0].folderPath, original)
    assert.equal(await readImage(restored[0].folderPath, attachment.path), `data:image/png;base64,${png.toString('base64')}`)
    assert.equal(restored[0].messages[1].agentHistory[0].content[0].image_url.url, `zipply-upload:${attachment.path}`)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('archive import rejects missing images and traversal without touching existing data', async () => {
  const { restoreChatArchive } = load('src/main/services/ChatArchive.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-archive-'))
  try {
    const target = path.join(dir, 'restored')
    const session = { id: 'chat-1', title: 'Photo', createdAt: 1, updatedAt: 2, messages: [{ id: 'm1', role: 'user', attachments: [{ name: 'x.png', path: '.zipply/uploads/12345678-1234-1234-1234-123456789012.png' }] }] }
    const missing = zipSync({ 'manifest.json': strToU8(JSON.stringify({ version: 1, sessions: [session] })) })
    await assert.rejects(restoreChatArchive(missing, target), /изображен/i)
    const traversal = zipSync({ 'manifest.json': strToU8(JSON.stringify({ version: 1, sessions: [session] })), '../escape': strToU8('bad') })
    await assert.rejects(restoreChatArchive(traversal, target))
    await assert.rejects(fs.access(path.join(dir, 'escape')))
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('modified image bytes are rejected instead of silently restoring a corrupted backup', async () => {
  const { saveImage } = load('src/main/services/ImageUploads.ts')
  const { createChatArchive, restoreChatArchive } = load('src/main/services/ChatArchive.ts')
  const { unzipSync } = require('fflate')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-archive-'))
  try {
    const original = path.join(dir, 'original'); await fs.mkdir(original)
    const attachment = await saveImage(original, 'photo.png', png)
    const archive = await createChatArchive([{ id: 'chat', title: 'x', createdAt: 1, updatedAt: 2, folderPath: original, messages: [{ id: 'm', role: 'user', attachments: [attachment] }] }])
    const files = unzipSync(archive)
    const image = Object.keys(files).find(name => name.startsWith('images/'))
    files[image][files[image].length - 1] ^= 1
    await assert.rejects(restoreChatArchive(zipSync(files), path.join(dir, 'restore')), /поврежден|повреждён/i)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('export fails if an attached image is missing instead of creating an incomplete backup', async () => {
  const { createChatArchive } = load('src/main/services/ChatArchive.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-archive-'))
  try {
    const session = { id: 'chat', title: 'x', createdAt: 1, updatedAt: 2, folderPath: dir, messages: [{ id: 'm', role: 'user', attachments: [{ name: 'lost.png', path: '.zipply/uploads/12345678-1234-1234-1234-123456789012.png' }] }] }
    await assert.rejects(createChatArchive([session]))
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

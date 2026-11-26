const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
function load(file) { const result = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' }); const mod = new Module(path.resolve(file), module); mod.filename = path.resolve(file); mod.paths = module.paths; mod._compile(result.outputFiles[0].text, mod.filename); return mod.exports }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

test('uploads keep unique copies inside the workspace and reject non-images', async () => {
  const { saveImage, readImage } = load('src/main/services/ImageUploads.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-images-'))
  try {
    const one = await saveImage(dir, '../picture.png', png)
    const two = await saveImage(dir, 'picture.png', png)
    assert.notEqual(one.path, two.path)
    assert.match(one.path, /^\.zipply\/uploads\/[^/]+\.png$/)
    assert.deepEqual(await fs.readFile(path.join(dir, one.path)), png)
    assert.equal(await readImage(dir, one.path), `data:image/png;base64,${png.toString('base64')}`)
    await assert.rejects(saveImage(dir, 'bad.png', Buffer.from('not an image')))
    await assert.rejects(readImage(dir, '../../secret.png'))
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('history references saved images and the provider receives their actual bytes', async () => {
  const { saveImage } = load('src/main/services/ImageUploads.ts')
  const { buildAgentHistory } = load('src/renderer/src/services/agentHistory.ts')
  const { ChatService } = load('src/main/agent/services/ChatService.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-images-'))
  const original = global.fetch
  try {
    const attachment = await saveImage(dir, 'cat.png', png)
    const history = buildAgentHistory([{ id: '1', role: 'user', content: 'Что здесь?', attachments: [attachment] }])
    assert.equal(history[0].content[2].image_url.url, `zipply-upload:${attachment.path}`)
    let request
    global.fetch = async (_url, options) => { request = JSON.parse(options.body); return new Response(JSON.stringify({ choices: [{ message: { content: 'cat' } }] })) }
    await ChatService.chat({ model: 'vision', stream: false, workspacePath: dir }, history)
    assert.equal(request.messages[0].content[2].image_url.url, `data:image/png;base64,${png.toString('base64')}`)
    assert.match(history[0].content[2].image_url.url, /^zipply-upload:/)
  } finally { global.fetch = original; await fs.rm(dir, { recursive: true, force: true }) }
})

test('image-only messages preserve their attachment in history', () => {
  const { buildAgentHistory } = load('src/renderer/src/services/agentHistory.ts')
  const attachment = { name: 'cat.png', path: '.zipply/uploads/12345678-1234-1234-1234-123456789012.png' }
  const history = buildAgentHistory([{ id: '1', role: 'user', attachments: [attachment] }])
  assert.equal(history.length, 1)
  assert.equal(history[0].content[1].image_url.url, `zipply-upload:${attachment.path}`)
})

test('a missing image returns an error without sending a request', async () => {
  const { ChatService } = load('src/main/agent/services/ChatService.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-images-'))
  const original = global.fetch
  let requests = 0
  global.fetch = async () => { requests++; throw new Error('unexpected request') }
  try {
    await assert.rejects(ChatService.chat({ workspacePath: dir, stream: false }, [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'zipply-upload:.zipply/uploads/12345678-1234-1234-1234-123456789012.png' } }] }]), /прикреплённое изображение/)
    assert.equal(requests, 0)
  } finally { global.fetch = original; await fs.rm(dir, { recursive: true, force: true }) }
})

test('agent can inspect an image in the workspace using read_file', async () => {
  const { runAgent } = load('src/main/agent/index.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-vision-tool-'))
  const original = global.fetch
  const requests = []
  const events = []
  try {
    await fs.writeFile(path.join(dir, 'image.png'), png)
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body)
      requests.push(body)
      const message = requests.length === 1
        ? { content: null, tool_calls: [{ id: 'read-image', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'image.png' }) } }] }
        : { content: 'Изображение получено.' }
      return new Response(JSON.stringify({ choices: [{ message }] }))
    }
    await runAgent('zipply', [{ role: 'user', content: 'Прочитай image.png' }], { model: 'vision', stream: false, workspacePath: dir }, event => events.push(event))
    assert.equal(requests.length, 2)
    const toolResult = events.find(event => event.type === 'tool_result' && event.callId.endsWith('read-image'))
    assert.equal(Boolean(toolResult.error), false)
    const sent = requests[1].messages
    const imageMessage = sent.find(message => Array.isArray(message.content) && message.content.some(part => part.image_url))
    assert.equal(imageMessage.content.find(part => part.image_url).image_url.url, `data:image/png;base64,${png.toString('base64')}`)
    assert.ok(sent.findIndex(message => message.role === 'tool') < sent.indexOf(imageMessage))
    assert.doesNotMatch(JSON.stringify(events), /data:image\/png;base64/)
  } finally { global.fetch = original; await fs.rm(dir, { recursive: true, force: true }) }
})

test('a batch returns readable images even if another file is missing', async () => {
  const { runAgent } = load('src/main/agent/index.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-vision-batch-'))
  const original = global.fetch
  const requests = []
  try {
    await fs.writeFile(path.join(dir, 'image.png'), png)
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body); requests.push(body)
      const message = requests.length === 1
        ? { content: null, tool_calls: [
            { id: 'batch', type: 'function', function: { name: 'read_files', arguments: JSON.stringify({ files: [{ path: 'image.png' }, { path: 'missing.txt' }] }) } },
            { id: 'other', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'image.png' }) } }
          ] }
        : { content: 'ok' }
      return new Response(JSON.stringify({ choices: [{ message }] }))
    }
    await runAgent('zipply', [{ role: 'user', content: 'Прочитай' }], { model: 'vision', stream: false, workspacePath: dir }, () => {})
    const messages = requests[1].messages
    const toolMessages = messages.filter(message => message.role === 'tool')
    assert.equal(toolMessages.length, 2)
    const imageIndex = messages.findIndex(message => Array.isArray(message.content) && message.content.some(part => part.image_url))
    assert.ok(imageIndex > messages.lastIndexOf(toolMessages[1]))
    assert.equal(messages[imageIndex].content.filter(part => part.image_url).length, 2)
  } finally { global.fetch = original; await fs.rm(dir, { recursive: true, force: true }) }
})

test('workspace image reads reject files outside the workspace', async () => {
  const { readWorkspaceImage } = load('src/main/services/ImageUploads.ts')
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-vision-path-'))
  const dir = path.join(parent, 'project')
  try {
    await fs.mkdir(dir)
    await fs.writeFile(path.join(parent, 'secret.png'), png)
    await assert.rejects(readWorkspaceImage(dir, '../secret.png'), /вне рабочей папки/)
    await assert.rejects(readWorkspaceImage(dir, path.join(parent, 'secret.png')), /Недопустимый путь/)
  } finally { await fs.rm(parent, { recursive: true, force: true }) }
})

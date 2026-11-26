const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')

function load(file) {
  const filename = path.resolve(file)
  const result = buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false })
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths; mod._compile(result.outputFiles[0].text, filename); return mod.exports
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-pdf-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const sample = await fs.readFile(require.resolve('pdf-parse/test/data/04-valid.pdf'))
  await fs.writeFile(path.join(root, 'report.pdf'), sample)
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const board = new Blackboard()
  board.setArtifact('config', { workspacePath: root })
  const { PdfAnalyzeDocument } = load('src/main/agent/plugins/pdf/AnalyzeDocument.ts')
  return { board, root, tool: new PdfAnalyzeDocument(), sample }
}

test('PDF analyzer extracts text and safe document metadata', async t => {
  const { tool, board } = await fixture(t)
  const result = await tool.execute(JSON.stringify({ path: 'report.pdf' }), board)
  assert.equal(result.success, true)
  assert.equal(result.data.totalPages, 5)
  assert.equal(result.data.metadata.author, 'tubitak')
  assert.match(result.data.text, /footballers/i)
  assert.ok(result.data.wordCount > 100)
  assert.match(result.formattedContent, /ORIGINAL ARTICLE/)
})

test('PDF analyzer rejects paths outside the workspace and invalid PDF data', async t => {
  const { tool, board, root, sample } = await fixture(t)
  const outsidePath = path.join(path.dirname(root), `outside-${path.basename(root)}.pdf`)
  await fs.writeFile(outsidePath, sample)
  t.after(() => fs.rm(outsidePath, { force: true }))
  assert.equal((await tool.execute(JSON.stringify({ path: outsidePath }), board)).error, true)

  await fs.writeFile(path.join(root, 'broken.pdf'), Buffer.from('%PDF-not-valid'))
  assert.equal((await tool.execute(JSON.stringify({ path: 'broken.pdf' }), board)).error, true)
})

test('PDF analyzer reports cancellation and refuses unsupported inputs', async t => {
  const { tool, board, root } = await fixture(t)
  const controller = new AbortController()
  controller.abort()
  const result = await tool.execute(JSON.stringify({ path: 'report.pdf' }), board, controller.signal)
  assert.equal(result.error, true)
  assert.match(result.formattedContent, /отмен/i)

  await fs.writeFile(path.join(root, 'report.txt'), Buffer.from('not a PDF'))
  assert.equal((await tool.execute(JSON.stringify({ path: 'report.txt' }), board)).error, true)
})

test('PDF analyzer explains that textless scans need OCR and enforces the file size limit', async t => {
  const { board, root } = await fixture(t)
  const { PdfAnalyzeDocument } = load('src/main/agent/plugins/pdf/AnalyzeDocument.ts')
  const noTextTool = new PdfAnalyzeDocument(async () => ({ numpages: 1, numrender: 1, text: '  ' }))
  const textless = await noTextTool.execute(JSON.stringify({ path: 'report.pdf' }), board)
  assert.equal(textless.error, true)
  assert.match(textless.formattedContent, /без OCR/i)

  const tooLarge = path.join(root, 'too-large.pdf')
  const handle = await fs.open(tooLarge, 'w')
  await handle.truncate(20 * 1024 * 1024 + 1)
  await handle.close()
  const oversized = await noTextTool.execute(JSON.stringify({ path: 'too-large.pdf' }), board)
  assert.equal(oversized.error, true)
  assert.match(oversized.formattedContent, /20 МБ/)
})

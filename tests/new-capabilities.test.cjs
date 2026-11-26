const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
function load(file) { const result = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' }); const mod = new Module(path.resolve(file), module); mod.filename = path.resolve(file); mod.paths = module.paths; mod._compile(result.outputFiles[0].text, mod.filename); return mod.exports }

test('documents are stored safely and included in the model request', async () => {
  const { saveDocument } = load('src/main/services/DocumentUploads.ts')
  const { buildAgentHistory } = load('src/renderer/src/services/agentHistory.ts')
  const { ChatService } = load('src/main/agent/services/ChatService.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-doc-'))
  const original = global.fetch
  try {
    const attachment = await saveDocument(dir, '../notes.txt', Buffer.from('Important project information'))
    assert.equal(attachment.name, 'notes.txt')
    const history = buildAgentHistory([{ id: '1', role: 'user', content: 'Read this', attachments: [attachment] }])
    let request
    global.fetch = async (_url, options) => { request = JSON.parse(options.body); return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })) }
    await ChatService.chat({ workspacePath: dir, stream: false }, history)
    assert.match(JSON.stringify(request.messages), /Important project information/)
    await assert.rejects(saveDocument(dir, 'program.exe', Buffer.from('hello')))
  } finally { global.fetch = original; await fs.rm(dir, { recursive: true, force: true }) }
})

test('scheduled occurrences are claimed once and missed runs are skipped on startup', () => {
  const { claimDueSchedules, nextOccurrence } = load('src/renderer/src/services/schedules.ts')
  const now = new Date(2026, 10, 4, 12, 0).getTime()
  const task = { id: 'x', prompt: 'Check tests', folderPath: 'project', frequency: 'daily', nextRun: now, enabled: true }
  const first = claimDueSchedules([task], now, now - 1000)
  assert.equal(first.due.length, 1)
  assert.equal(first.tasks[0].nextRun, nextOccurrence(now, 'daily'))
  assert.equal(claimDueSchedules(first.tasks, now, now - 1000).due.length, 0)
  const missed = claimDueSchedules([task], now + 300000, now + 300000)
  assert.equal(missed.due.length, 0)
  assert.ok(missed.tasks[0].nextRun > now + 300000)
})

test('document attachments survive chat archive export and import', async () => {
  const { saveDocument, extractDocument } = load('src/main/services/DocumentUploads.ts')
  const { createChatArchive, restoreChatArchive } = load('src/main/services/ChatArchive.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-doc-archive-'))
  try {
    const attachment = await saveDocument(dir, 'notes.txt', Buffer.from('archive document'))
    const session = { id: 'abc', title: 'Test', createdAt: 1, updatedAt: 1, folderPath: dir, messages: [{ id: '1', role: 'user', content: '', attachments: [attachment] }] }
    const archive = await createChatArchive([session])
    const restored = await restoreChatArchive(archive, path.join(dir, 'restored'))
    assert.equal(await extractDocument(restored[0].folderPath, attachment.path), 'archive document')
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('DOCX and XLSX attachments extract readable text and reject malformed documents', async () => {
  const { zipSync, strToU8 } = require('fflate')
  const ExcelJS = require('exceljs')
  const { saveDocument, extractDocument } = load('src/main/services/DocumentUploads.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-office-'))
  try {
    const xml = s => strToU8(s)
    const doc = zipSync({
      '[Content_Types].xml': xml('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
      '_rels/.rels': xml('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
      'word/document.xml': xml('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Word document content</w:t></w:r></w:p></w:body></w:document>')
    })
    const document = await saveDocument(dir, 'report.docx', doc)
    assert.match(await extractDocument(dir, document.path), /Word document content/)
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Sales'); sheet.addRow(['Product', 'Value']); sheet.addRow(['Apples', 42])
    const spreadsheet = await saveDocument(dir, 'sales.xlsx', new Uint8Array(await workbook.xlsx.writeBuffer()))
    assert.match(await extractDocument(dir, spreadsheet.path), /Sales[\s\S]*Apples\s+42/)
    await assert.rejects(saveDocument(dir, 'bad.docx', Buffer.from('not a document')))
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

test('PDF attachment extracts searchable text', async () => {
  const { saveDocument, extractDocument } = load('src/main/services/DocumentUploads.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-pdf-'))
  try {
    const pdf = await fs.readFile(require.resolve('pdf-parse/test/data/04-valid.pdf'))
    const attachment = await saveDocument(dir, 'report.pdf', pdf)
    assert.match(await extractDocument(dir, attachment.path), /footballers/)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
})

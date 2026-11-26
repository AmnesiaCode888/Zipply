const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const initSqlJs = require('sql.js')

function load(file) {
  const filename = path.resolve(file)
  const result = buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false })
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths; mod._compile(result.outputFiles[0].text, filename); return mod.exports
}

async function fixture(t, { rows = 2 } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-sqlite-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const SQL = await initSqlJs()
  const db = new SQL.Database()
  db.run('CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT NOT NULL, body BLOB)')
  const insert = db.prepare('INSERT INTO notes (title, body) VALUES (?, ?)')
  for (let i = 1; i <= rows; i++) insert.run([`note-${i}`, Uint8Array.from([0, i, 255])])
  insert.free()
  const databasePath = path.join(root, 'notes.sqlite')
  await fs.writeFile(databasePath, db.export())
  db.close()
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const board = new Blackboard()
  board.setArtifact('config', { workspacePath: root })
  const { SqliteInspectDatabase } = load('src/main/agent/plugins/sqlite/InspectDatabase.ts')
  return { board, databasePath, root, tool: new SqliteInspectDatabase() }
}

test('SQLite plugin lists tables, describes columns, and returns bounded SELECT results', async t => {
  const { tool, board } = await fixture(t)
  const tables = await tool.execute(JSON.stringify({ path: 'notes.sqlite', operation: 'tables' }), board)
  assert.equal(tables.success, true)
  assert.deepEqual(tables.data.tables.map(table => table.name), ['notes'])

  const schema = await tool.execute(JSON.stringify({ path: 'notes.sqlite', operation: 'describe', table: 'notes' }), board)
  assert.deepEqual(schema.data.columns.map(column => column.name), ['id', 'title', 'body'])

  const rows = await tool.execute(JSON.stringify({ path: 'notes.sqlite', operation: 'query', sql: 'SELECT id, title, body FROM notes ORDER BY id' }), board)
  assert.equal(rows.success, true)
  assert.equal(rows.data.rowCount, 2)
  assert.deepEqual(rows.data.rows.map(row => row.title), ['note-1', 'note-2'])
  assert.deepEqual(rows.data.rows[0].body, { type: 'blob', bytes: 3, previewHex: '0001ff' })
})

test('SQLite plugin rejects writes, stacked SQL, paths outside the workspace, and non-SQLite files', async t => {
  const { tool, board, databasePath, root } = await fixture(t)
  const before = await fs.readFile(databasePath)
  for (const sql of ['DELETE FROM notes', 'SELECT 1; DELETE FROM notes']) {
    const result = await tool.execute(JSON.stringify({ path: 'notes.sqlite', operation: 'query', sql }), board)
    assert.equal(result.error, true)
  }
  assert.deepEqual(await fs.readFile(databasePath), before)

  const outsidePath = path.join(path.dirname(root), `outside-${path.basename(root)}.db`)
  await fs.writeFile(outsidePath, before)
  t.after(() => fs.rm(outsidePath, { force: true }))
  assert.equal((await tool.execute(JSON.stringify({ path: outsidePath, operation: 'tables' }), board)).error, true)

  await fs.writeFile(path.join(root, 'broken.db'), Buffer.from('not a database'))
  assert.equal((await tool.execute(JSON.stringify({ path: 'broken.db', operation: 'tables' }), board)).error, true)
})

test('SQLite plugin rejects an active WAL sidecar and cancelled operations', async t => {
  const { tool, board, databasePath } = await fixture(t)
  await fs.writeFile(`${databasePath}-wal`, Buffer.from('pending WAL data'))
  assert.equal((await tool.execute(JSON.stringify({ path: 'notes.sqlite', operation: 'tables' }), board)).error, true)
  await fs.rm(`${databasePath}-wal`)

  const controller = new AbortController()
  controller.abort()
  const cancelled = await tool.execute(JSON.stringify({ path: 'notes.sqlite', operation: 'tables' }), board, controller.signal)
  assert.equal(cancelled.error, true)
  assert.match(cancelled.formattedContent, /отмен/i)
})

test('SQLite plugin clamps result rows and truncates oversized cells', async t => {
  const { tool, board } = await fixture(t, { rows: 205 })
  const result = await tool.execute(JSON.stringify({ path: 'notes.sqlite', operation: 'query', sql: 'SELECT id, title FROM notes ORDER BY id', maxRows: 500 }), board)
  assert.equal(result.success, true)
  assert.equal(result.data.rowCount, 200)
  assert.equal(result.data.truncated, true)
  const oversized = await tool.execute(JSON.stringify({ path: 'notes.sqlite', operation: 'query', sql: "SELECT printf('%10000s', 'x') AS oversized FROM notes LIMIT 1" }), board)
  assert.equal(oversized.success, true)
  assert.equal(oversized.data.rows[0].oversized.length, 8_001)
  assert.equal(oversized.data.truncated, true)
})

test('SQLite plugin rejects files over the documented size limit before parsing', async t => {
  const { tool, board, root } = await fixture(t)
  const tooLarge = path.join(root, 'too-large.db')
  const handle = await fs.open(tooLarge, 'w')
  await handle.truncate(32 * 1024 * 1024 + 1)
  await handle.close()
  const result = await tool.execute(JSON.stringify({ path: 'too-large.db', operation: 'tables' }), board)
  assert.equal(result.error, true)
  assert.match(result.formattedContent, /32 МБ/)
})

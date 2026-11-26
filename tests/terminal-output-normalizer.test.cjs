const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')

function load(file) {
  const r = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const m = new Module(path.resolve(file), module)
  m.filename = path.resolve(file); m.paths = module.paths
  m._compile(r.outputFiles[0].text, m.filename)
  return m.exports
}

test('normalizeTerminalText strips ANSI escapes and collapses carriage-return progress bars', () => {
  const { normalizeTerminalText } = load('src/main/agent/services/TerminalOutputNormalizer.ts')
  const raw = '\x1b[32mBuilding\x1b[0m\r\n10%\r50%\r100% done\n\x1b]0;Window Title\x07OK'
  assert.equal(normalizeTerminalText(raw), 'Building\n100% done\nOK')
})

test('formatForLlm preserves head+tail and spills full log to disk when oversized', async () => {
  const { formatForLlm } = load('src/main/agent/services/TerminalOutputNormalizer.ts')
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-norm-'))
  try {
    const lines = Array.from({ length: 400 }, (_, i) => `line-${i + 1}: payload`)
    const res = await formatForLlm(lines.join('\n'), { maxLines: 100, maxChars: 10000, spillDir: tmpDir, sessionId: 'term-1' })
    assert.equal(res.truncated, true)
    assert.ok(res.logPath)
    assert.match(res.text, /line-1: payload/)
    assert.match(res.text, /line-400: payload/)
    assert.match(res.text, /Полный лог сохранён:/)
    const full = await fs.readFile(res.logPath, 'utf8')
    assert.equal(full.split('\n').length, 400)
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
})

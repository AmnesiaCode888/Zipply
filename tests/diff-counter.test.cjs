const test = require('node:test')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')
const path = require('node:path')

function load(file) {
  const result = esbuild.buildSync({
    entryPoints: [path.resolve(file)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false
  })
  const exports = {}
  const module = { exports }
  const fn = new Function('module', 'exports', 'require', '__dirname', result.outputFiles[0].text)
  fn(module, exports, require, path.dirname(path.resolve(file)))
  return module.exports
}

test('computeStreamingDiffCounts counts lines when baseline is empty string during new file generation', () => {
  const { computeStreamingDiffCounts } = load('src/renderer/src/components/tools/utils/toolHelpers.ts')

  // When writing a new file with empty baseline, lines written should be counted
  const result = computeStreamingDiffCounts('', 'line1\nline2\nline3\nline4\n')
  assert.deepEqual(result, { added: 4, removed: 0 })

  // Large rewrite or new file
  const largeContent = Array.from({ length: 196 }, (_, i) => `line ${i + 1}`).join('\n')
  const largeResult = computeStreamingDiffCounts('', largeContent)
  assert.deepEqual(largeResult, { added: 196, removed: 0 })

  // When baseline is undefined, computeStreamingDiffCounts returns null
  assert.equal(computeStreamingDiffCounts(undefined, 'content'), null)
})

test('computeStreamingDiffCounts computes accurate diff when baseline exists', () => {
  const { computeStreamingDiffCounts } = load('src/renderer/src/components/tools/utils/toolHelpers.ts')

  const baseline = 'line1\nline2\nline3\n'
  const current = 'line1\nline2-mod\nline3\nline4\n'
  const result = computeStreamingDiffCounts(baseline, current)
  assert.ok(result !== null)
  assert.equal(result.added, 2)
  assert.equal(result.removed, 1)
})

test('computeDiffCounts falls back to line count if no diff markers and diff object is absent', () => {
  const { computeDiffCounts } = load('src/renderer/src/components/tools/utils/toolHelpers.ts')

  // Normal diff object
  assert.deepEqual(computeDiffCounts({ added: 10, removed: 2 }), { added: 10, removed: 2 })

  // Plain content without diff markers (+/-)
  const plainCode = 'async function foo() {\n  return 1;\n}'
  assert.deepEqual(computeDiffCounts(undefined, undefined, plainCode), { added: 3, removed: 0 })
})

test('parsePartialToolArgs extracts path even with aliases or when content is streamed first', () => {
  const { applyEventToBlocks } = load('src/renderer/src/hooks/useChat.ts')

  // Test applyEventToBlocks with tool_call_stream containing file_path alias
  const blocks = []
  const lastMsg = { role: 'assistant', blocks }

  applyEventToBlocks({
    type: 'tool_call_stream',
    callId: 'call_1',
    toolName: 'write_file',
    argsDelta: '{"file_path": "src/api.js", "content": "export const a = 1;"}'
  }, blocks, lastMsg)

  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'tool')
  assert.equal(blocks[0].tool.targetName, 'src/api.js')
  assert.equal(blocks[0].tool.content, 'export const a = 1;')

  // Test that targetName is not hardcoded to 'файл...' when path is pending
  const blocks2 = []
  const lastMsg2 = { role: 'assistant', blocks: blocks2 }

  applyEventToBlocks({
    type: 'tool_call_stream',
    callId: 'call_2',
    toolName: 'write_file',
    argsDelta: '{"content": "line1\\nline2"}'
  }, blocks2, lastMsg2)

  assert.equal(blocks2.length, 1)
  assert.notEqual(blocks2[0].tool.targetName, 'файл...')
})

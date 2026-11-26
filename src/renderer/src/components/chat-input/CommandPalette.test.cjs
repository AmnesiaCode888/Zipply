const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

function loadCommands() {
  const filename = path.join(__dirname, 'CommandPalette.tsx')
  const result = buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false })
  const compiled = new Module(filename, module)
  compiled.filename = filename
  compiled.paths = module.paths
  compiled._compile(result.outputFiles[0].text, filename)
  return compiled.exports
}

const skill = { kind: 'skill', id: 'user/review', label: 'Review', revision: 'sha256:abc123' }
const plugin = { kind: 'plugin', id: 'organize', label: 'Organize' }
const server = { kind: 'mcp_server', id: 'tracker', label: 'Tracker' }
const prompt = { kind: 'mcp_prompt', id: 'tracker:summary', serverId: 'tracker', promptName: 'summary', label: 'Issue summary' }
const resource = { kind: 'mcp_resource', id: 'tracker:project', serverId: 'tracker', uri: 'project://issues', label: 'Issues' }
const options = [skill, plugin, server, prompt, resource].map(ref => ({ ref }))

test('selecting a slash command consumes the complete token beside the caret and leaves prose untouched', () => {
  const { readCommandToken, applyCommandChoice } = loadCommands()
  const value = 'Draft /review follow-up\nKeep this line.'
  const token = readCommandToken(value, 'Draft /rev'.length)
  assert.deepEqual(applyCommandChoice(value, token, { ref: skill }, []), {
    value: 'Draft  follow-up\nKeep this line.',
    caret: 6,
    extensionRefs: [skill]
  })
})

test('slash commands include every non-resource kind and all extension destinations', () => {
  const { readCommandToken, getCommandChoices } = loadCommands()
  const choices = getCommandChoices(readCommandToken('/', 1), options, true)
  assert.deepEqual(choices.flatMap(choice => choice.ref ? [choice.ref.kind] : []), ['skill', 'plugin', 'mcp_server', 'mcp_prompt'])
  assert.deepEqual(choices.flatMap(choice => choice.page ? [choice.page] : []), ['all', 'skills', 'plugins', 'mcp'])
})

test('the extensions alias opens the unified catalog', () => {
  const { readCommandToken, getCommandChoices } = loadCommands()
  const choices = getCommandChoices(readCommandToken('/расширения', 11), options, true)
  assert.deepEqual(choices.map(choice => choice.page), ['all'])
})

test('the resource alias and mentions both match only MCP resources', () => {
  const { readCommandToken, getCommandChoices } = loadCommands()
  for (const value of ['@Iss', '/resource Iss']) {
    assert.deepEqual(getCommandChoices(readCommandToken(value, value.length), options, true), [{ ref: resource }])
  }
})

test('unknown slash text, email addresses and websites do not offer a command', () => {
  const { readCommandToken, getCommandChoices } = loadCommands()
  assert.deepEqual(getCommandChoices(readCommandToken('/no-such-command', 16), options, true), [])
  assert.equal(readCommandToken('me@example.org', 14), null)
  assert.equal(readCommandToken('https://example.org', 19), null)
})

test('management selections consume the command while preserving selected references', () => {
  const { readCommandToken, getCommandChoices, applyCommandChoice } = loadCommands()
  const value = 'Note /skills'
  const token = readCommandToken(value, value.length)
  const [choice] = getCommandChoices(token, options, true)
  assert.equal(choice.page, 'skills')
  assert.deepEqual(applyCommandChoice(value, token, choice, [prompt]), { value: 'Note ', caret: 5, extensionRefs: [prompt] })
})

test('selecting the same reference twice does not duplicate the chip', () => {
  const { applyCommandChoice } = loadCommands()
  assert.deepEqual(applyCommandChoice('Draft', null, { ref: plugin }, [plugin]), { value: 'Draft', caret: null, extensionRefs: [plugin] })
})

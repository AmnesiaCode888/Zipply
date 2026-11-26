const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

function load(file) {
  const result = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', write: false, packages: 'external', loader: { '.svg': 'dataurl', '.css': 'empty' } })
  const mod = new Module(path.resolve(file), module); mod.filename = path.resolve(file); mod.paths = module.paths
  mod._compile(result.outputFiles[0].text, mod.filename); return mod.exports
}

test('CyberSec DNS results render as compact structured rows instead of terminal text', () => {
  const { ToolCallCard } = load('src/renderer/src/components/tools/ToolCallCard.tsx')
  const html = renderToStaticMarkup(React.createElement(ToolCallCard, { isExpanded: true, tool: {
    id: 'dns', toolName: 'cybersec_dns_records', type: 'terminal', label: 'CyberSec · DNS', targetName: 'example.com', status: 'completed', content: 'raw DNS output',
    toolData: { host: 'example.com', records: { A: [{ address: '203.0.113.1', ttl: 60 }], MX: [{ exchange: 'mail.example.com', priority: 10, ttl: 300 }] }, errors: {}, truncated: false }
  } }))
  assert.match(html, /CyberSec · DNS example\.com/)
  assert.match(html, /example\.com/)
  assert.match(html, /203\.0\.113\.1/)
  assert.match(html, /mail\.example\.com/)
  assert.doesNotMatch(html, /font-mono[^>]*>raw DNS output/)
})

test('CyberSec CAA rows display the fields returned by the DNS resolver', () => {
  const { ToolCallCard } = load('src/renderer/src/components/tools/ToolCallCard.tsx')
  const html = renderToStaticMarkup(React.createElement(ToolCallCard, { isExpanded: true, tool: {
    id: 'caa', toolName: 'cybersec_dns_records', type: 'terminal', label: 'CyberSec · DNS', targetName: 'example.com', status: 'completed',
    toolData: { host: 'example.com', records: { CAA: [{ critical: 0, issue: 'letsencrypt.org', iodef: 'mailto:security@example.com' }] } }
  } }))
  assert.match(html, /letsencrypt\.org/)
  assert.match(html, /mailto:security@example\.com/)
})

test('CyberSec scan results show severity counts and redacted findings', () => {
  const { ToolCallCard } = load('src/renderer/src/components/tools/ToolCallCard.tsx')
  const html = renderToStaticMarkup(React.createElement(ToolCallCard, { isExpanded: true, tool: {
    id: 'secrets', toolName: 'cybersec_scan_secrets', type: 'terminal', label: 'CyberSec · Секреты', targetName: 'проект', status: 'completed', content: 'Есть кандидаты',
    toolData: { scanned: 8, skipped: 1, limited: false, findings: [{ kind: 'AWS access key', path: 'src/config.ts', line: 4 }] }
  } }))
  assert.match(html, /Совпадений: 1/)
  assert.match(html, /src\/config\.ts:4/)
  assert.match(html, /AWS access key/)
})

test('CyberSec tool result data survives event mapping for structured rendering', () => {
  const { applyEventToBlocks } = load('src/renderer/src/hooks/useChat.ts')
  const blocks = [], message = { id: 'm', role: 'assistant' }
  applyEventToBlocks({ type: 'tool_start', callId: 'tls', toolName: 'cybersec_check_tls', args: { host: 'example.com' } }, blocks, message)
  applyEventToBlocks({ type: 'tool_result', callId: 'tls', result: 'TLS result', data: { certificate: { validTo: '2030-01-01' }, protocol: 'TLSv1.3' } }, blocks, message)
  assert.deepEqual(blocks[0].tool.toolData, { certificate: { validTo: '2030-01-01' }, protocol: 'TLSv1.3' })
})

test('CyberSec tools use the same inline row styling as native chat tools', () => {
  const { ToolCallCard } = load('src/renderer/src/components/tools/ToolCallCard.tsx')
  const dns = renderToStaticMarkup(React.createElement(ToolCallCard, { tool: { id: 'dns', toolName: 'cybersec_dns_records', type: 'terminal', label: 'CyberSec · DNS', targetName: 'example.com', status: 'completed', toolData: { host: 'example.com', records: {} } } }))
  const tls = renderToStaticMarkup(React.createElement(ToolCallCard, { tool: { id: 'tls', toolName: 'cybersec_check_tls', type: 'terminal', label: 'CyberSec · TLS', targetName: 'example.com', status: 'completed', toolData: { host: 'example.com', certificate: {} } } }))
  assert.match(dns, /text-\[15px\].*text-secondary/)
  assert.match(tls, /CyberSec · TLS example\.com/)
  assert.match(dns, /cybersec-inline-plugin-icon/)
  assert.match(tls, /cybersec-inline-plugin-icon/)
  assert.doesNotMatch(dns, /rounded-\[16px\] bg-surface|CYBERSEC|bg-\[#18243A\]|lucide-globe/)
  assert.doesNotMatch(tls, /rounded-\[16px\] bg-surface|CYBERSEC|bg-\[#18243A\]|lucide-lock-keyhole/)
  assert.doesNotMatch(dns, /Завершено/)
})

test('CyberSec card distinguishes running and failed states without exposing raw structures', () => {
  const { ToolCallCard } = load('src/renderer/src/components/tools/ToolCallCard.tsx')
  const running = renderToStaticMarkup(React.createElement(ToolCallCard, { tool: { id: 'run', toolName: 'cybersec_dns_records', type: 'terminal', label: 'CyberSec · DNS', targetName: 'example.com', status: 'running' } }))
  const failed = renderToStaticMarkup(React.createElement(ToolCallCard, { isExpanded: true, tool: { id: 'failed', toolName: 'cybersec_check_tls', type: 'terminal', label: 'CyberSec · TLS', targetName: 'example.com', status: 'error', content: 'Не удалось проверить TLS: сертификат недействителен' } }))
  assert.match(running, /aria-label="Выполняется"/)
  assert.match(failed, /aria-label="Не удалось выполнить"/)
  assert.match(failed, /сертификат недействителен/)
})

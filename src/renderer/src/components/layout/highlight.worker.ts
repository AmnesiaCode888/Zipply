/// <reference lib="webworker" />
import hljs from 'highlight.js'

const languages: Record<string, string> = { ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', py: 'python', pyi: 'python', rs: 'rust', go: 'go', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', java: 'java', json: 'json', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', css: 'css', scss: 'scss', md: 'markdown', yml: 'yaml', yaml: 'yaml', sh: 'bash', bash: 'bash', sql: 'sql', lua: 'lua', rb: 'ruby', php: 'php', kt: 'kotlin', swift: 'swift' }

const scope = self as unknown as DedicatedWorkerGlobalScope
scope.onmessage = (event: MessageEvent<{ id: number; file: string; text: string }>) => {
  const { id, file, text } = event.data
  const ext = file.split('.').pop()?.toLowerCase() || ''
  const language = languages[ext] || (hljs.getLanguage(ext) ? ext : '')
  let html: string | null = null
  try {
    if (language && hljs.getLanguage(language)) html = hljs.highlight(text, { language, ignoreIllegals: true }).value
  } catch { /* The editor continues to show the plain text. */ }
  scope.postMessage({ id, text, html })
}

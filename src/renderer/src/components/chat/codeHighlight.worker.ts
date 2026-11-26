/// <reference lib="webworker" />
import hljs from 'highlight.js/lib/common'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import powershell from 'highlight.js/lib/languages/powershell'

hljs.registerLanguage('dockerfile', dockerfile)
hljs.registerLanguage('powershell', powershell)

const scope = self as unknown as DedicatedWorkerGlobalScope
scope.onmessage = (event: MessageEvent<{ id: number; code: string; grammar: string; detect: boolean; highlight: boolean }>) => {
  const { id, code, detect, highlight } = event.data
  let grammar = event.data.grammar
  let html: string | null = null
  try {
    if (detect && code.length <= 50_000) {
      const detected = hljs.highlightAuto(code, ['javascript', 'typescript', 'python', 'json', 'yaml', 'bash', 'sql', 'xml', 'css', 'cpp', 'go', 'rust', 'csharp'])
      if (detected.language && detected.relevance > 4) grammar = detected.language
    }
    if (highlight && code.length <= 100_000 && grammar !== 'plaintext' && hljs.getLanguage(grammar)) {
      html = hljs.highlight(code, { language: grammar, ignoreIllegals: true }).value
    }
  } catch { /* Show plain text if the grammar fails. */ }
  scope.postMessage({ id, grammar, html })
}

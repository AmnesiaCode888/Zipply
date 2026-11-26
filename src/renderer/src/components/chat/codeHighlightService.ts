import { CodeHighlightQueue } from './codeHighlightQueue'

export const codeHighlightQueue = new CodeHighlightQueue(() => new Worker(new URL('./codeHighlight.worker.ts', import.meta.url), { type: 'module' }))

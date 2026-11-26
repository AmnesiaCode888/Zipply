import React, { useEffect, useRef, useState, useMemo } from 'react'
import { Check, Code2, Copy } from '../../icons'
import hljs from 'highlight.js/lib/common'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import powershell from 'highlight.js/lib/languages/powershell'
import { codeHighlightQueue } from './codeHighlightService'

hljs.registerLanguage('dockerfile', dockerfile)
hljs.registerLanguage('powershell', powershell)
import pythonIcon from '../../assets/language-icons/python.svg'
import javascriptIcon from '../../assets/language-icons/javascript.svg'
import typescriptIcon from '../../assets/language-icons/typescript.svg'
import reactIcon from '../../assets/language-icons/react.svg'
import csharpIcon from '../../assets/language-icons/csharp.svg'
import cppIcon from '../../assets/language-icons/cpp.svg'
import cIcon from '../../assets/language-icons/c.svg'
import goIcon from '../../assets/language-icons/go.svg'
import rustIcon from '../../assets/language-icons/rust.svg'
import javaIcon from '../../assets/language-icons/java.svg'
import phpIcon from '../../assets/language-icons/php.svg'
import htmlIcon from '../../assets/language-icons/html.svg'
import cssIcon from '../../assets/language-icons/css.svg'
import jsonIcon from '../../assets/language-icons/json.svg'
import yamlIcon from '../../assets/language-icons/yaml.svg'
import consoleIcon from '../../assets/language-icons/console.svg'
import powershellIcon from '../../assets/language-icons/powershell.svg'
import databaseIcon from '../../assets/language-icons/database.svg'
import dockerIcon from '../../assets/language-icons/docker.svg'
import gitIcon from '../../assets/language-icons/git.svg'
import markdownIcon from '../../assets/language-icons/markdown.svg'
import folderIcon from '../../assets/language-icons/folder.svg'

type Language = { label: string; grammar: string; icon?: string }
const languages: Record<string, Language> = {}
function addLanguage(names: string[], label: string, grammar: string, icon?: string): void {
  for (const name of names) languages[name] = { label, grammar, icon }
}
addLanguage(['python', 'py'], 'Python', 'python', pythonIcon)
addLanguage(['javascript', 'js', 'mjs', 'cjs'], 'JavaScript', 'javascript', javascriptIcon)
addLanguage(['typescript', 'ts'], 'TypeScript', 'typescript', typescriptIcon)
addLanguage(['jsx'], 'React JSX', 'javascript', reactIcon)
addLanguage(['tsx'], 'React TSX', 'typescript', reactIcon)
addLanguage(['csharp', 'c#', 'cs'], 'C#', 'csharp', csharpIcon)
addLanguage(['cpp', 'c++'], 'C++', 'cpp', cppIcon)
addLanguage(['c'], 'C', 'c', cIcon)
addLanguage(['go', 'golang'], 'Go', 'go', goIcon)
addLanguage(['rust', 'rs'], 'Rust', 'rust', rustIcon)
addLanguage(['java'], 'Java', 'java', javaIcon)
addLanguage(['php'], 'PHP', 'php', phpIcon)
addLanguage(['html', 'xml', 'svg'], 'HTML', 'xml', htmlIcon)
addLanguage(['css', 'scss', 'sass'], 'CSS', 'css', cssIcon)
addLanguage(['json', 'jsonc'], 'JSON', 'json', jsonIcon)
addLanguage(['yaml', 'yml'], 'YAML', 'yaml', yamlIcon)
addLanguage(['bash', 'sh', 'shell', 'zsh'], 'Shell', 'bash', consoleIcon)
addLanguage(['powershell', 'ps1'], 'PowerShell', 'powershell', powershellIcon)
addLanguage(['sql'], 'SQL', 'sql', databaseIcon)
addLanguage(['docker', 'dockerfile'], 'Docker', 'dockerfile', dockerIcon)
addLanguage(['diff'], 'Diff', 'diff', gitIcon)
addLanguage(['markdown', 'md'], 'Markdown', 'markdown', markdownIcon)
addLanguage(['tree'], 'Структура файлов', 'plaintext', folderIcon)
addLanguage(['text', 'txt', 'plaintext'], 'Текст', 'plaintext')

export function getCodeLanguage(language: string, code: string): Language {
  const name = language.trim().toLowerCase().replace(/^language-/, '')
  if (languages[name]) return languages[name]
  if (name && name !== 'code') return { label: name, grammar: name }
  if (/[├└│─]/.test(code)) return languages.tree
  if (/^\s*(?:\$\s+|(?:python\d*|pip\d*|npm|npx|yarn|pnpm|git|cd|mkdir|curl|docker)\s)/m.test(code)) return languages.shell
  return { label: 'Код', grammar: 'plaintext' }
}

const CodeBlockView: React.FC<{ language: string; code: string; isStreaming?: boolean }> = ({ language, code, isStreaming }) => {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const [result, setResult] = useState<{ language: string; code: string; streaming: boolean; grammar: string; html: string | null } | null>(null)
  const name = language.trim().toLowerCase().replace(/^language-/, '')
  const detectionRef = useRef<{ language: string; length: number; next: number; meta: Language } | null>(null)
  let baseMeta: Language
  const previous = detectionRef.current
  if (isStreaming && (!name || name === 'code') && previous && previous.language === language && code.length >= previous.length && code.length < previous.next) {
    previous.length = code.length
    baseMeta = previous.meta
  } else {
    baseMeta = getCodeLanguage(language, code)
    detectionRef.current = isStreaming ? { language, length: code.length, next: Math.max(256, code.length * 2), meta: baseMeta } : null
  }
  const detect = (!name || name === 'code') && baseMeta.label === 'Код' && code.length <= 50_000
  useEffect(() => {
    if (!code || (!detect && (isStreaming || baseMeta.grammar === 'plaintext')) || (!isStreaming && code.length > 100_000 && !detect)) return
    let cancel = (): void => {}
    let timer = 0
    let active = true
    const submit = (): void => {
      cancel = codeHighlightQueue.request({ code, grammar: baseMeta.grammar, detect, highlight: !isStreaming }, value => {
        if (!active) return
        if (value === 'retry') timer = window.setTimeout(submit, 100)
        else if (value) setResult({ language, code, streaming: Boolean(isStreaming), ...value })
      })
    }
    timer = window.setTimeout(submit, isStreaming ? 250 : 0)
    return () => { active = false; window.clearTimeout(timer); cancel() }
  }, [language, code, isStreaming, baseMeta.grammar, detect])
  const current = result?.language === language && result.code === code && result.streaming === Boolean(isStreaming) ? result : null
  const meta = current && detect && languages[current.grammar] ? languages[current.grammar] : baseMeta
  const syncHighlighted = useMemo(() => {
    if (typeof Worker !== 'undefined' || isStreaming || code.length > 1000 || baseMeta.grammar === 'plaintext' || !hljs.getLanguage(baseMeta.grammar)) return null
    try { return hljs.highlight(code, { language: baseMeta.grammar, ignoreIllegals: true }).value } catch { return null }
  }, [code, baseMeta.grammar, isStreaming])
  const highlighted = current?.html ?? syncHighlighted

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code)
      setCopyError(false)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { setCopied(false); setCopyError(true) }
  }

  return (
    <div className="w-full my-2.5 rounded-[16px] bg-surface overflow-hidden select-text border-none shadow-none">
      <div className="flex items-center justify-end gap-1.5 px-2.5 pt-2.5 select-none">
        <span className="h-7 inline-flex items-center gap-1.5 px-2.5 rounded-full bg-hover text-secondary text-[12px] font-medium" title={meta.label}>
          {meta.icon ? <img src={meta.icon} alt="" className="w-3.5 h-3.5 object-contain" /> : <Code2 size={14} />}
          {meta.label}
        </span>
        <button type="button" onClick={() => void copy()} aria-label={copied ? 'Код скопирован' : 'Копировать код'} title={copied ? 'Скопировано' : 'Копировать код'} className="w-7 h-7 rounded-full flex items-center justify-center bg-hover hover:bg-hover-strong text-secondary hover:text-primary transition-colors active:scale-95 border-none shadow-none cursor-pointer">
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
      {copyError && <p role="alert" className="px-4 pt-2 text-[13px] text-secondary">Не удалось скопировать код. Выделите и скопируйте его вручную.</p>}
      <pre className="px-4 pb-4 pt-1 overflow-x-auto code-scrollbar text-[14.5px] font-mono leading-[24px] text-primary m-0 select-text">
        {highlighted === null ? <code>{code}</code> : <code dangerouslySetInnerHTML={{ __html: highlighted }} />}
        {isStreaming && <span className="inline-block w-1.5 h-4 bg-primary ml-1 align-middle" aria-hidden="true" />}
      </pre>
    </div>
  )
}

export const CodeBlock = React.memo(CodeBlockView)
CodeBlock.displayName = 'CodeBlock'

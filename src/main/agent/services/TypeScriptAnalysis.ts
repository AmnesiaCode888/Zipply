import { Worker } from 'worker_threads'
import * as fs from 'fs'
import * as path from 'path'

export interface AnalysisRequest {
  operation: 'definition' | 'references' | 'diagnostics' | 'symbols' | 'rename'
  path: string
  line?: number
  column?: number
  sourceText?: string
}

export type AnalysisResult = {
  items?: Array<Record<string, unknown>>
  truncated?: boolean
  fallback?: boolean
  reused?: boolean
  error?: string
}

// Persistent worker stays warm across requests in the same workspace, avoiding
// repeated TypeScript compiler + lib.*.d.ts + tsconfig reloads.
const workerSource = String.raw`
const { parentPort, workerData } = require('worker_threads')
const fs = require('fs')
const path = require('path')
const ts = require(workerData.typescript)

const root = fs.realpathSync(workerData.root)
const libDir = fs.realpathSync(path.dirname(workerData.typescript))
const contains = (base, p) => { const r = path.relative(base, p); return r === '' || (!r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r)) }
const allowed = (p) => { try { const real = fs.realpathSync(p); return contains(root, real) || contains(libDir, real) } catch { return false } }
const inProject = (p) => { try { return contains(root, fs.realpathSync(p)) } catch { return false } }

let cachedConfigFile = null
let cachedConfigStamp = ''
let cachedOptions = null
let cachedFallback = false
let cachedFiles = []
let cachedService = null
const fileSnapshots = new Map() // realPath -> { version: number, content: string | undefined }
let activeOverride = null // { target: string, text: string } | null

function readFileRaw(p) {
  if (!allowed(p)) return undefined
  let real
  try { real = fs.realpathSync(p) } catch { return undefined }
  if (activeOverride && real === activeOverride.target) return activeOverride.text
  return ts.sys.readFile(p)
}

function fileExists(p) { return allowed(p) && ts.sys.fileExists(p) }

function findConfigFor(target) {
  let dir = path.dirname(target)
  while (contains(root, dir)) {
    for (const name of ['tsconfig.json', 'jsconfig.json']) {
      const p = path.join(dir, name)
      if (fileExists(p)) return p
    }
    if (dir === root) break
    dir = path.dirname(dir)
  }
  return null
}

function loadProject(target) {
  const configFile = findConfigFor(target)
  let configStamp = configFile || 'none'
  if (configFile) {
    try { configStamp += ':' + fs.statSync(configFile).mtimeMs } catch {}
  }

  const needsRebuild = !cachedService || cachedConfigFile !== configFile || cachedConfigStamp !== configStamp || !cachedFiles.some(p => {
    try { return fs.realpathSync(p) === target } catch { return false }
  })

  if (needsRebuild) {
    if (cachedService) { try { cachedService.dispose() } catch {} cachedService = null }
    fileSnapshots.clear()
    let files = [target]
    let options = { allowJs: true, checkJs: true, noEmit: true, jsx: ts.JsxEmit.Preserve }
    const fallback = !configFile
    if (configFile) {
      const host = { useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames, readDirectory: (p, ...args) => allowed(p) ? ts.sys.readDirectory(p, ...args).filter(inProject) : [], fileExists, readFile: readFileRaw }
      const visited = new Set()
      const findProject = file => {
        if (!fileExists(file)) throw new Error('Конфигурация недоступна: ' + file)
        const real = fs.realpathSync(file)
        if (visited.has(real)) return null
        visited.add(real)
        const config = ts.readConfigFile(real, readFileRaw)
        if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
        const parsed = ts.parseJsonConfigFileContent(config.config, host, path.dirname(real), { noEmit: true }, real)
        const errors = parsed.errors.filter(e => e.code !== 18003)
        if (errors.length) throw new Error(errors.map(e => ts.flattenDiagnosticMessageText(e.messageText, '\n')).join('\n'))
        if (parsed.fileNames.some(p => path.resolve(p) === target)) return parsed
        for (const ref of parsed.projectReferences || []) {
          const found = findProject(ts.resolveProjectReferencePath(ref))
          if (found) return found
        }
        return null
      }
      const parsed = findProject(configFile)
      if (!parsed) throw new Error('Файл не входит в найденную конфигурацию проекта или её references.')
      options = { ...parsed.options, noEmit: true, plugins: undefined }
      files = parsed.fileNames.filter(inProject)
      if (!files.some(p => path.resolve(p) === target)) files.push(target)
    }
    if (files.length > 5000) throw new Error('Превышен лимит: проект содержит более 5000 файлов.')

    cachedConfigFile = configFile
    cachedConfigStamp = configStamp
    cachedOptions = options
    cachedFallback = fallback
    cachedFiles = files

    const serviceHost = {
      getScriptFileNames: () => cachedFiles,
      getScriptVersion: p => {
        try {
          const real = fs.realpathSync(p)
          return String(fileSnapshots.get(real)?.version ?? 0)
        } catch { return '0' }
      },
      getScriptSnapshot: p => {
        const s = readFileRaw(p)
        return s === undefined ? undefined : ts.ScriptSnapshot.fromString(s)
      },
      getCurrentDirectory: () => root,
      getCompilationSettings: () => cachedOptions,
      getDefaultLibFileName: o => ts.getDefaultLibFilePath(o),
      fileExists,
      readFile: readFileRaw,
      readDirectory: (p, ...args) => allowed(p) ? ts.sys.readDirectory(p, ...args).filter(allowed) : [],
      directoryExists: p => allowed(p) && ts.sys.directoryExists(p),
      getDirectories: p => allowed(p) ? ts.sys.getDirectories(p).filter(name => allowed(path.join(p, name))) : [],
      realpath: p => allowed(p) ? fs.realpathSync(p) : p,
      useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames
    }
    cachedService = ts.createLanguageService(serviceHost)
    return { reused: false }
  }

  // Refresh versions for any modified project files so LanguageService drops stale ASTs
  for (const f of cachedFiles) {
    try {
      const real = fs.realpathSync(f)
      const content = readFileRaw(real)
      const prev = fileSnapshots.get(real)
      if (!prev) {
        fileSnapshots.set(real, { version: 1, content })
      } else if (prev.content !== content) {
        prev.version += 1
        prev.content = content
      }
    } catch {}
  }
  return { reused: true }
}

parentPort.on('message', ({ seq, req }) => {
  try {
    const target = fs.realpathSync(req.path)
    if (!inProject(target)) throw new Error('Файл находится вне рабочей папки.')
    activeOverride = typeof req.sourceText === 'string' ? { target, text: req.sourceText } : null
    const { reused } = loadProject(target)
    // Ensure target snapshot reflects activeOverride if any
    const targetContent = readFileRaw(target)
    const prevTarget = fileSnapshots.get(target)
    if (!prevTarget) fileSnapshots.set(target, { version: 1, content: targetContent })
    else if (prevTarget.content !== targetContent) { prevTarget.version += 1; prevTarget.content = targetContent }

    const program = cachedService.getProgram()
    const source = program && program.getSourceFile(target)
    if (!source) throw new Error('Не удалось открыть файл для анализа.')

    const location = (file, start) => { const p = file.getLineAndCharacterOfPosition(start); return { path: path.relative(root, file.fileName).replace(/\\/g, '/'), line: p.line + 1, column: p.character + 1 } }
    let items = []
    if (req.operation === 'diagnostics') {
      items = [...cachedService.getSyntacticDiagnostics(target), ...cachedService.getSemanticDiagnostics(target)]
        .filter(d => d.file && inProject(d.file.fileName))
        .map(d => { const end = location(d.file, Math.min(d.file.end, (d.start || 0) + (d.length || 1))); return { ...location(d.file, d.start || 0), endLine: end.line, endColumn: end.column, code: d.code, category: ts.DiagnosticCategory[d.category], message: ts.flattenDiagnosticMessageText(d.messageText, '\n') } })
    } else if (req.operation === 'symbols') {
      const collect = node => {
        for (const item of node.childItems || []) {
          const span = item.nameSpan || item.spans && item.spans[0]
          if (span && item.text && item.text !== '<function>') items.push({ ...location(source, span.start), name: item.text, kind: item.kind })
          collect(item)
        }
      }
      collect(cachedService.getNavigationTree(target))
    } else {
      if (req.line > source.getLineAndCharacterOfPosition(source.end).line + 1) throw new Error('Строка за пределами файла.')
      const start = source.getPositionOfLineAndCharacter(req.line - 1, 0)
      const end = req.line < source.getLineAndCharacterOfPosition(source.end).line + 1 ? source.getPositionOfLineAndCharacter(req.line, 0) : source.end
      const pos = start + req.column - 1
      if (pos > end) throw new Error('Столбец за пределами строки.')
      if (req.operation === 'rename') {
        const info = cachedService.getRenameInfo(target, pos, { allowRenameOfImportPath: false })
        if (!info.canRename) throw new Error(info.localizedErrorMessage || 'Этот символ нельзя переименовать.')
        const matches = cachedService.findRenameLocations(target, pos, false, false, true) || []
        if (matches.some(x => !inProject(x.fileName))) throw new Error('Переименование затрагивает файлы вне рабочей папки; предпросмотр отменён.')
        items = matches.map(x => { const f = program.getSourceFile(x.fileName); return f && { ...location(f, x.textSpan.start), length: x.textSpan.length, text: f.text.slice(x.textSpan.start, x.textSpan.start + x.textSpan.length), prefix: x.prefixText || '', suffix: x.suffixText || '' } }).filter(Boolean)
      } else {
        const matches = req.operation === 'definition' ? cachedService.getDefinitionAtPosition(target, pos) : cachedService.getReferencesAtPosition(target, pos)
        items = (matches || []).filter(x => inProject(x.fileName)).map(x => { const f = program.getSourceFile(x.fileName); return f && location(f, x.textSpan.start) }).filter(Boolean)
      }
    }
    parentPort.postMessage({ seq, items: items.slice(0, 100), truncated: items.length > 100, fallback: cachedFallback, reused })
  } catch (error) {
    parentPort.postMessage({ seq, error: error && error.message || String(error) })
  } finally {
    activeOverride = null
  }
})
`

interface WorkerPoolEntry {
  worker: Worker
  idleTimer: NodeJS.Timeout
  queue: Promise<void>
}

const workerPool = new Map<string, WorkerPoolEntry>()
const IDLE_TTL_MS = 120_000
let seqCounter = 0

function evictWorker(key: string): void {
  const entry = workerPool.get(key)
  if (!entry) return
  clearTimeout(entry.idleTimer)
  workerPool.delete(key)
  void entry.worker.terminate()
}

function getOrCreateEntry(rootKey: string): WorkerPoolEntry {
  const existing = workerPool.get(rootKey)
  if (existing) {
    clearTimeout(existing.idleTimer)
    existing.idleTimer = setTimeout(() => evictWorker(rootKey), IDLE_TTL_MS)
    existing.idleTimer.unref()
    return existing
  }
  const worker = new Worker(workerSource, {
    eval: true,
    workerData: { root: rootKey, typescript: require.resolve('typescript') }
  })
  worker.unref()
  const idleTimer = setTimeout(() => evictWorker(rootKey), IDLE_TTL_MS)
  idleTimer.unref()
  const entry: WorkerPoolEntry = { worker, idleTimer, queue: Promise.resolve() }
  worker.once('exit', () => {
    if (workerPool.get(rootKey) === entry) {
      clearTimeout(entry.idleTimer)
      workerPool.delete(rootKey)
    }
  })
  workerPool.set(rootKey, entry)
  return entry
}

export async function analyze(request: AnalysisRequest, root: string, signal?: AbortSignal): Promise<AnalysisResult> {
  if (signal?.aborted) return { error: 'Анализ отменён.' }
  let rootKey: string
  try { rootKey = fs.realpathSync(root) } catch { rootKey = path.resolve(root) }

  const entry = getOrCreateEntry(rootKey)
  const runRequest = async (): Promise<AnalysisResult> => {
    if (signal?.aborted) return { error: 'Анализ отменён.' }
    const activeEntry = getOrCreateEntry(rootKey)
    const seq = ++seqCounter
    return new Promise((resolve) => {
      let settled = false
      const finish = (result: AnalysisResult, dropWorker = false): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        activeEntry.worker.removeListener('message', onMessage)
        activeEntry.worker.removeListener('error', onError)
        activeEntry.worker.removeListener('exit', onExit)
        signal?.removeEventListener('abort', cancel)
        if (dropWorker) evictWorker(rootKey)
        resolve(result)
      }
      const onMessage = (msg: AnalysisResult & { seq?: number }): void => {
        if (msg.seq !== seq) return
        const { seq: _seq, ...rest } = msg
        finish(rest)
      }
      const onError = (error: Error): void => finish({ error: error.message }, true)
      const onExit = (code: number): void => finish({ error: `Анализ завершился с кодом ${code}.` }, true)
      const cancel = (): void => finish({ error: 'Анализ отменён.' }, true)
      const timer = setTimeout(() => finish({ error: 'Превышено время анализа (15 секунд).' }, true), 15000)

      activeEntry.worker.on('message', onMessage)
      activeEntry.worker.once('error', onError)
      activeEntry.worker.once('exit', onExit)
      signal?.addEventListener('abort', cancel, { once: true })
      activeEntry.worker.postMessage({ seq, req: request })
    })
  }

  const next = entry.queue.then(runRequest, runRequest)
  entry.queue = next.then(() => undefined, () => undefined)
  return next
}

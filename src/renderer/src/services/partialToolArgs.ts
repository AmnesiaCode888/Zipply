export interface ParsedPartialToolArgs {
  path?: string
  content?: string
  command?: string
  target?: string
  query?: string
  files?: string
  filePaths?: string[]
}

const PATH_KEYS = new Set(['path', 'filePath', 'file_path', 'filepath', 'filename', 'file'])
const COMMAND_KEYS = new Set(['command', 'cmd'])
const QUERY_KEYS = new Set(['query', 'pattern'])

/**
 * Extracts structured display fields from an already-parsed tool arguments record.
 */
export function extractToolArgsFromRecord(parsed: Record<string, unknown> | undefined): ParsedPartialToolArgs {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

  let path: string | undefined
  let content: string | undefined
  let command: string | undefined
  let target: string | undefined
  let query: string | undefined
  let files: string | undefined
  let filePaths: string[] | undefined

  const rawPath = parsed.path || parsed.filePath || parsed.file_path || parsed.filepath || parsed.filename || parsed.file
  if (rawPath) path = String(rawPath)

  const rawQuery = parsed.query ?? parsed.pattern
  if (typeof rawQuery === 'string') query = rawQuery

  if (Array.isArray(parsed.files)) {
    filePaths = parsed.files
      .map((file) => (file && typeof file === 'object' && typeof (file as { path?: unknown }).path === 'string' ? (file as { path: string }).path : ''))
      .filter(Boolean)
    files = filePaths.join(', ')
  }

  if (parsed.command) command = String(parsed.command)
  else if (parsed.cmd) command = String(parsed.cmd)

  if (typeof parsed.target === 'string') target = parsed.target

  if (parsed.content !== undefined) content = String(parsed.content)
  else if (parsed.replacement !== undefined) content = String(parsed.replacement)

  if (Array.isArray(parsed.edits)) {
    const edits = parsed.edits.filter(
      (edit): edit is { target?: unknown; replacement?: unknown } => Boolean(edit) && typeof edit === 'object'
    )
    target = edits.map((edit) => (typeof edit.target === 'string' ? edit.target : '')).join('\n\n')
    content = edits.map((edit) => (typeof edit.replacement === 'string' ? edit.replacement : '')).join('\n\n')
  }

  return { path, content, command, target, query, files, filePaths }
}

function skipWhitespace(input: string, index: number): number {
  let i = index
  while (i < input.length && (input[i] === ' ' || input[i] === '\t' || input[i] === '\r' || input[i] === '\n')) i++
  return i
}

function readJsonString(input: string, quoteIndex: number): { value: string; nextIndex: number; closed: boolean } {
  let value = ''
  let i = quoteIndex + 1
  while (i < input.length) {
    const ch = input[i]
    if (ch === '"') {
      return { value, nextIndex: i + 1, closed: true }
    }
    if (ch === '\\') {
      if (i + 1 >= input.length) {
        return { value, nextIndex: input.length, closed: false }
      }
      const esc = input[i + 1]
      if (esc === 'n') { value += '\n'; i += 2 }
      else if (esc === 'r') { value += '\r'; i += 2 }
      else if (esc === 't') { value += '\t'; i += 2 }
      else if (esc === 'b') { value += '\b'; i += 2 }
      else if (esc === 'f') { value += '\f'; i += 2 }
      else if (esc === '"' || esc === '\\' || esc === '/') { value += esc; i += 2 }
      else if (esc === 'u') {
        const hex = input.slice(i + 2, i + 6)
        if (hex.length < 4) {
          return { value, nextIndex: input.length, closed: false }
        }
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          value += String.fromCharCode(parseInt(hex, 16))
        } else {
          value += `\\u${hex}`
        }
        i += 6
      } else {
        value += esc
        i += 2
      }
      continue
    }
    value += ch
    i++
  }
  return { value, nextIndex: input.length, closed: false }
}

function skipJsonValue(input: string, start: number): number {
  let i = skipWhitespace(input, start)
  if (i >= input.length) return input.length
  const first = input[i]
  if (first === '"') {
    return readJsonString(input, i).nextIndex
  }
  if (first === '{' || first === '[') {
    const stack = [first === '{' ? '}' : ']']
    i++
    while (i < input.length && stack.length > 0) {
      const ch = input[i]
      if (ch === '"') {
        i = readJsonString(input, i).nextIndex
        continue
      }
      if (ch === '{') stack.push('}')
      else if (ch === '[') stack.push(']')
      else if (ch === stack[stack.length - 1]) stack.pop()
      i++
    }
    return i
  }
  while (i < input.length && input[i] !== ',' && input[i] !== '}' && input[i] !== ']') i++
  return i
}

function scanObjectFields(
  input: string,
  startBrace: number,
  onField: (key: string, valueStart: number) => number
): number {
  let i = skipWhitespace(input, startBrace + 1)
  while (i < input.length) {
    i = skipWhitespace(input, i)
    if (i >= input.length) break
    if (input[i] === '}') return i + 1
    if (input[i] === ',') { i++; continue }
    if (input[i] !== '"') {
      i++
      continue
    }
    const keyToken = readJsonString(input, i)
    if (!keyToken.closed) return input.length
    i = skipWhitespace(input, keyToken.nextIndex)
    if (i >= input.length || input[i] !== ':') break
    i = skipWhitespace(input, i + 1)
    if (i >= input.length) break
    i = onField(keyToken.value, i)
  }
  return i
}

function scanArrayOfObjects(
  input: string,
  startBracket: number,
  onItem: (item: Record<string, string>) => void
): number {
  let i = skipWhitespace(input, startBracket + 1)
  while (i < input.length) {
    i = skipWhitespace(input, i)
    if (i >= input.length) break
    if (input[i] === ']') return i + 1
    if (input[i] === ',') { i++; continue }
    if (input[i] === '{') {
      const item: Record<string, string> = {}
      i = scanObjectFields(input, i, (key, valueStart) => {
        if (input[valueStart] === '"') {
          const str = readJsonString(input, valueStart)
          item[key] = str.value
          return str.nextIndex
        }
        return skipJsonValue(input, valueStart)
      })
      onItem(item)
      continue
    }
    i = skipJsonValue(input, i)
  }
  return i
}

/**
 * Parses tool-call JSON arguments incrementally during streaming, safely ignoring nested keys inside string values.
 */
export function parsePartialToolArgs(rawJson?: string): ParsedPartialToolArgs {
  if (!rawJson) return {}

  try {
    const parsed = JSON.parse(rawJson)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return extractToolArgsFromRecord(parsed as Record<string, unknown>)
    }
  } catch { /* Fall back to incremental top-level JSON scanning while streaming. */ }

  const objStart = rawJson.indexOf('{')
  if (objStart === -1) return {}

  const result: ParsedPartialToolArgs = {}

  scanObjectFields(rawJson, objStart, (key, valueStart) => {
    const lowerKey = key.toLowerCase()

    if (PATH_KEYS.has(key) && rawJson[valueStart] === '"') {
      const str = readJsonString(rawJson, valueStart)
      result.path = str.value
      return str.nextIndex
    }
    if (COMMAND_KEYS.has(key) && rawJson[valueStart] === '"') {
      const str = readJsonString(rawJson, valueStart)
      result.command = str.value
      return str.nextIndex
    }
    if (QUERY_KEYS.has(key) && rawJson[valueStart] === '"') {
      const str = readJsonString(rawJson, valueStart)
      if (str.closed) result.query = str.value
      return str.nextIndex
    }
    if ((lowerKey === 'content' || lowerKey === 'replacement') && rawJson[valueStart] === '"') {
      const str = readJsonString(rawJson, valueStart)
      result.content = str.value
      return str.nextIndex
    }
    if (key === 'target' && rawJson[valueStart] === '"') {
      const str = readJsonString(rawJson, valueStart)
      if (str.closed) result.target = str.value
      return str.nextIndex
    }
    if (key === 'files' && rawJson[valueStart] === '[') {
      const paths: string[] = []
      const next = scanArrayOfObjects(rawJson, valueStart, (item) => {
        if (item.path) paths.push(item.path)
      })
      if (paths.length) {
        result.filePaths = paths
        result.files = paths.join(', ')
      }
      return next
    }
    if (key === 'edits' && rawJson[valueStart] === '[') {
      const replacements: string[] = []
      const targets: string[] = []
      const next = scanArrayOfObjects(rawJson, valueStart, (item) => {
        if (item.replacement !== undefined) replacements.push(item.replacement)
        if (item.target !== undefined) targets.push(item.target)
      })
      if (replacements.length) result.content = replacements.join('\n\n')
      if (targets.length) result.target = targets.join('\n\n')
      return next
    }

    return skipJsonValue(rawJson, valueStart)
  })

  return result
}

import { createHash } from 'crypto'
import * as fs from 'fs/promises'
import { Blackboard } from '../core/Blackboard'
import { fileAssertionCoversCriterion, MISSING_FILE_HASH } from '../core/VerificationEvidence'
import { inspectWorkspacePath, resolveWorkspacePath } from './pathUtils'
import { ToolBase, ToolExecutionPolicy, ToolParameterDef, ToolResult } from './ToolBase'

type VerifyPredicate = 'exists' | 'contains' | 'equals' | 'not_contains'
const VALID_PREDICATES = new Set<VerifyPredicate>(['exists', 'contains', 'equals', 'not_contains'])

export class VerifyFileTool extends ToolBase {
  get name(): string {
    return 'verify_file'
  }

  get description(): string {
    return 'Проверяет фактическое состояние файла на диске (exists, contains, equals, not_contains) с вычислением SHA-256 и привязкой к критерию приёмки.'
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      path: {
        type: 'string',
        description: 'Относительный путь к проверяемому файлу в рабочей директории.',
        required: true,
        minLength: 1
      },
      predicate: {
        type: 'string',
        description: 'Условие проверки файла: exists, contains, equals или not_contains.',
        required: true,
        enum: ['exists', 'contains', 'equals', 'not_contains']
      },
      expected: {
        type: 'string',
        description: 'Ожидаемый текст для предикатов contains, equals и not_contains.'
      },
      criterion_id: {
        type: 'string',
        description: 'Необязательный ID из update_plan. Критерий должен точно задавать путь и предикат, например: "result.txt contains READY".'
      }
    }
  }

  getExecutionPolicy(): ToolExecutionPolicy {
    return {
      mutates: false,
      parallelSafe: true,
      cacheable: false
    }
  }

  validate(raw: string): string | null {
    try {
      const args = JSON.parse(raw || '{}') as Record<string, unknown>
      if (typeof args.path !== 'string' || !args.path.trim()) {
        return 'Ошибка: параметр "path" обязателен и должен быть непустой строкой.'
      }
      if (typeof args.predicate !== 'string' || !VALID_PREDICATES.has(args.predicate as VerifyPredicate)) {
        return 'Ошибка: параметр "predicate" должен быть exists, contains, equals или not_contains.'
      }
      if (args.predicate !== 'exists' && typeof args.expected !== 'string') {
        return `Ошибка: предикат "${args.predicate}" требует строковый параметр "expected".`
      }
      if (args.criterion_id !== undefined && (typeof args.criterion_id !== 'string' || !args.criterion_id.trim())) {
        return 'Ошибка: параметр "criterion_id" должен быть непустой строкой.'
      }
      return null
    } catch {
      return 'Ошибка: некорректный JSON аргументов verify_file.'
    }
  }

  async execute(raw: string, blackboard: Blackboard): Promise<ToolResult> {
    const valErr = this.validate(raw)
    if (valErr) return { formattedContent: valErr, error: true }

    const args = JSON.parse(raw) as {
      path: string
      predicate: VerifyPredicate
      expected?: string
      criterion_id?: string
    }

    const resolved = resolveWorkspacePath(blackboard, args.path)
    const inspected = await inspectWorkspacePath(blackboard, args.path)
    const actualPath = inspected.actualPath
    const relPath = resolved.relPath
    const criterionId = args.criterion_id?.trim() || undefined
    const matchedCriterion = criterionId ? blackboard.getCriterionRecords().find((c) => c.id === criterionId) : undefined
    if (criterionId && (!matchedCriterion || !fileAssertionCoversCriterion({ ...args, path: relPath }, matchedCriterion))) {
      return {
        formattedContent: matchedCriterion
          ? `Проверка не соответствует критерию ${criterionId}: ${matchedCriterion.text}. Укажи соответствующие путь, предикат и ожидаемый текст.`
          : `Критерий ${criterionId} отсутствует в актуальном плане.`,
        error: true
      }
    }
    const bytes = await fs.readFile(actualPath).catch(error => {
      if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return null
      throw error
    })
    const scopeHash = bytes ? createHash('sha256').update(bytes).digest('hex') : MISSING_FILE_HASH

    let passed = false
    let detail = ''

    if (!bytes) {
      passed = false
      detail = `Файл '${relPath}' отсутствует на диске (маркер: ${MISSING_FILE_HASH}).`
    } else if (args.predicate === 'exists') {
      passed = true
      detail = `Файл '${relPath}' существует (SHA-256: ${scopeHash}).`
    } else {
      if (bytes.subarray(0, 1024).includes(0)) {
        return {
          formattedContent: `Проверка не пройдена: файл '${relPath}' является бинарным.`,
          data: {
            path: relPath,
            absPath: actualPath,
            requestedPath: resolved.absPath,
            predicate: args.predicate,
            criterionId,
            criterionRevision: matchedCriterion?.revision,
            passed: false,
            scopeHash
          },
          error: true
        }
      }
      const text = bytes.toString('utf8').replace(/\r\n/g, '\n')
      const expected = (args.expected ?? '').replace(/\r\n/g, '\n')
      if (args.predicate === 'contains') {
        passed = text.includes(expected)
        detail = passed
          ? `Файл '${relPath}' содержит ожидаемый фрагмент (SHA-256: ${scopeHash}).`
          : `Файл '${relPath}' НЕ содержит ожидаемый фрагмент (SHA-256: ${scopeHash}).`
      } else if (args.predicate === 'equals') {
        passed = text === expected
        detail = passed
          ? `Файл '${relPath}' точно совпадает с ожидаемым содержимым (SHA-256: ${scopeHash}).`
          : `Файл '${relPath}' НЕ совпадает с ожидаемым содержимым (SHA-256: ${scopeHash}).`
      } else {
        passed = !text.includes(expected)
        detail = passed
          ? `Файл '${relPath}' не содержит запрещённый фрагмент (SHA-256: ${scopeHash}).`
          : `Файл '${relPath}' содержит запрещённый фрагмент (SHA-256: ${scopeHash}).`
      }
    }

    const prefix = passed ? 'CHECK PASSED' : 'CHECK FAILED'
    const critSuffix = criterionId ? ` [criterion=${criterionId}${matchedCriterion ? `@r${matchedCriterion.revision}` : ''}]` : ''
    return {
      success: passed,
      error: !passed,
      formattedContent: `${prefix}${critSuffix}: ${detail}`,
      data: {
        path: relPath,
        absPath: actualPath,
        requestedPath: resolved.absPath,
        predicate: args.predicate,
        criterionId,
        criterionRevision: matchedCriterion?.revision,
        passed,
        scopeHash
      }
    }
  }
}

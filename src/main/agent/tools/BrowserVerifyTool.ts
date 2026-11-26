import { createHash, randomUUID } from 'crypto'
import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'
import type * as PlaywrightCore from 'playwright-core'
import { resolveSandboxPolicy, type SandboxPolicy } from '../../../shared/sandbox'
import { Blackboard } from '../core/Blackboard'
import { AttachmentResolver, type AttachmentResolutionMap } from '../core/AttachmentResolver'
import type { CriterionRecord } from '../core/VerificationEvidence'
import { resolveWorkspacePath } from './pathUtils'
import { ToolBase, ToolExecutionPolicy, ToolParameterDef, ToolResult } from './ToolBase'

function loadPlaywright(): typeof PlaywrightCore | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('playwright-core') as typeof PlaywrightCore
  } catch {
    return null
  }
}

interface BrowserAction {
  type: 'click' | 'fill' | 'wait_for_selector'
  selector: string
  value?: string
}

function findChromiumExecutable(pw?: typeof PlaywrightCore | null): string | undefined {
  if (pw) {
    try {
      const pwExe = pw.chromium.executablePath()
      if (pwExe && fsSync.existsSync(pwExe)) return pwExe
    } catch {
      // Check OS browser fallbacks below.
    }
  }
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ]
  return candidates.find((p) => p && fsSync.existsSync(p))
}

function isAllowedOfflineUrl(rawUrl: string, workspaceRoot: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      const host = parsed.hostname.toLowerCase()
      return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'
    }
    if (parsed.protocol === 'file:') {
      const target = path.resolve(fileURLToPath(parsed))
      const rel = path.relative(path.resolve(workspaceRoot), target)
      return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
    }
    return false
  } catch {
    return false
  }
}

export class BrowserVerifyTool extends ToolBase {
  get name(): string {
    return 'browser_verify'
  }

  get description(): string {
    return 'Проверяет веб-интерфейс в headless Chromium (playwright-core): выполняет клики/ввод, проверяет текст, селекторы, ошибки консоли и сохраняет скриншот.'
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      url: {
        type: 'string',
        description: 'URL проверяемой страницы (localhost/127.0.0.1 или file:// внутри проекта).',
        required: true
      },
      actions: {
        type: 'array',
        description: 'Необязательный список шагов: { type: "click"|"fill"|"wait_for_selector", selector, value? }.',
        items: { type: 'object' }
      },
      assert_selector: {
        type: 'string',
        description: 'CSS-селектор, который должен присутствовать и быть видимым.'
      },
      assert_text: {
        type: 'string',
        description: 'Текст, который должен присутствовать на странице после действий.'
      },
      capture_screenshot: {
        type: 'boolean',
        description: 'Сохранить PNG-скриншот после проверки (по умолчанию true).',
        default: true
      },
      criterion_id: {
        type: 'string',
        description: 'Необязательный ID критерия приёмки из update_plan (например, "c_1").'
      }
    }
  }

  getExecutionPolicy(): ToolExecutionPolicy {
    return {
      mutates: false,
      parallelSafe: false,
      cacheable: false
    }
  }

  validate(raw: string): string | null {
    try {
      const args = JSON.parse(raw || '{}') as Record<string, unknown>
      if (typeof args.url !== 'string' || !args.url.trim()) {
        return 'Ошибка: параметр "url" обязателен.'
      }
      if (args.actions !== undefined) {
        if (!Array.isArray(args.actions)) return 'Ошибка: actions должен быть массивом.'
        for (const a of args.actions) {
          if (!a || typeof a !== 'object') return 'Ошибка: некорректный элемент actions.'
          const item = a as Record<string, unknown>
          if (!['click', 'fill', 'wait_for_selector'].includes(String(item.type)) || typeof item.selector !== 'string' || !item.selector.trim()) {
            return 'Ошибка: каждый action требует type (click|fill|wait_for_selector) и selector.'
          }
        }
      }
      return null
    } catch {
      return 'Ошибка: некорректный JSON аргументов browser_verify.'
    }
  }

  async execute(raw: string, blackboard: Blackboard, abortSignal?: AbortSignal): Promise<ToolResult> {
    const valErr = this.validate(raw)
    if (valErr) return { formattedContent: valErr, error: true }

    const args = JSON.parse(raw) as {
      url: string
      actions?: BrowserAction[]
      assert_selector?: string
      assert_text?: string
      capture_screenshot?: boolean
      criterion_id?: string
    }

    const wsRoot = resolveWorkspacePath(blackboard, '.').absPath
    const config = blackboard.getArtifact('config') as { accessMode?: string; planMode?: boolean; sandbox?: Partial<SandboxPolicy> } | undefined
    const sandbox = resolveSandboxPolicy(
      { accessMode: config?.accessMode, planMode: config?.planMode ?? Boolean(blackboard.getArtifact('planMode')), sandbox: config?.sandbox },
      wsRoot
    )

    if (sandbox.network === 'off' && !isAllowedOfflineUrl(args.url, wsRoot)) {
      return {
        formattedContent: `Ошибка browser_verify: при политике сети network=off разрешены только localhost/127.0.0.1 и локальные file:// в рабочей папке (получен ${args.url}).`,
        error: true
      }
    }

    const pw = loadPlaywright()
    if (!pw) {
      return { formattedContent: 'Ошибка browser_verify: пакет playwright-core недоступен в текущей сборке.', error: true }
    }

    const executablePath = findChromiumExecutable(pw)
    if (!executablePath) {
      return { formattedContent: 'Ошибка browser_verify: Chromium/Chrome/Edge не найден для headless-проверки.', error: true }
    }

    const criterionId = typeof args.criterion_id === 'string' && args.criterion_id.trim() ? args.criterion_id.trim() : undefined
    const criteria = blackboard.getCriterionRecords() as CriterionRecord[]
    const criterionRecord = criterionId ? criteria.find((c) => c.id === criterionId) : undefined

    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    const httpErrors: string[] = []
    const browser = await pw.chromium.launch({ headless: true, executablePath })

    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text())
      })
      page.on('pageerror', (err) => pageErrors.push(err.message))
      page.on('response', (resp) => {
        if (resp.status() >= 400) httpErrors.push(`${resp.status()} ${resp.url()}`)
      })

      if (abortSignal?.aborted) throw new Error('Проверка отменена.')
      await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 15000 })

      for (const action of args.actions || []) {
        if (abortSignal?.aborted) throw new Error('Проверка отменена.')
        if (action.type === 'wait_for_selector') {
          await page.waitForSelector(action.selector, { state: 'visible', timeout: 5000 })
        } else if (action.type === 'fill') {
          await page.fill(action.selector, action.value ?? '', { timeout: 5000 })
        } else if (action.type === 'click') {
          await page.click(action.selector, { timeout: 5000 })
        }
      }

      const failures: string[] = []
      if (args.assert_selector) {
        const visible = await page.locator(args.assert_selector).first().isVisible().catch(() => false)
        if (!visible) failures.push(`селектор '${args.assert_selector}' не найден или скрыт`)
      }

      const bodyText = await page.evaluate(() => document.body?.innerText || '')
      if (args.assert_text && !bodyText.includes(args.assert_text)) {
        failures.push(`на странице отсутствует текст '${args.assert_text}'`)
      }
      if (pageErrors.length > 0) failures.push(`ошибки страницы: ${pageErrors.join('; ')}`)
      if (consoleErrors.length > 0) failures.push(`ошибки консоли: ${consoleErrors.join('; ')}`)
      if (httpErrors.length > 0) failures.push(`HTTP ошибки: ${httpErrors.join('; ')}`)

      let screenshotPath: string | undefined
      let screenshotRef: string | undefined
      let screenshotHash = 'none'
      if (args.capture_screenshot !== false) {
        const artifactDir = path.join(os.tmpdir(), 'zipply-browser-artifacts')
        await fs.mkdir(artifactDir, { recursive: true })
        screenshotPath = path.join(artifactDir, `verify-${randomUUID()}.png`)
        const shotBytes = await page.screenshot({ path: screenshotPath, type: 'png', fullPage: true })
        screenshotHash = createHash('sha256').update(shotBytes).digest('hex').slice(0, 16)
        const attachments = blackboard.getArtifact('attachmentMeta') as AttachmentResolutionMap | undefined
        if (attachments) {
          screenshotRef = AttachmentResolver.registerGeneratedPng(attachments, shotBytes)
          if (!screenshotRef) {
            const viewport = await page.screenshot({ type: 'png' }).catch(() => undefined)
            if (viewport) screenshotRef = AttachmentResolver.registerGeneratedPng(attachments, viewport)
          }
        }
      }

      const passed = failures.length === 0
      const scopeHash = `browser:${createHash('sha256').update(`${args.url}:${args.assert_selector || ''}:${args.assert_text || ''}:${screenshotHash}`).digest('hex').slice(0, 16)}`
      const title = await page.title().catch(() => '')

      const data = {
        passed,
        url: args.url,
        finalUrl: page.url(),
        title,
        scopeHash,
        consoleErrors,
        pageErrors,
        httpErrors,
        ...(screenshotPath ? { screenshotPath } : {}),
        ...(criterionId ? { criterionId } : {}),
        ...(criterionRecord ? { criterionRevision: criterionRecord.revision } : {})
      }

      if (!passed) {
        return {
          error: true,
          formattedContent: `FAIL: browser_verify (${args.url})\nПричины: ${failures.join('; ')}`,
          ...(screenshotRef ? { images: [screenshotRef] } : {}),
          data
        }
      }

      return {
        success: true,
        formattedContent: `PASS: browser_verify (${args.url})${args.assert_text ? ` — найден текст "${args.assert_text}"` : ''}`,
        ...(screenshotRef ? { images: [screenshotRef] } : {}),
        data
      }
    } catch (err) {
      return {
        error: true,
        formattedContent: `Ошибка browser_verify: ${err instanceof Error ? err.message : String(err)}`
      }
    } finally {
      await browser.close().catch(() => {})
    }
  }
}

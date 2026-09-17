import { ToolBase, ToolParameterDef, ToolResult } from './ToolBase'
import { Blackboard } from '../core/Blackboard'
import { BrowserSessionManager, BrowserActionRequest } from '../../services/BrowserSessionManager'

/**
 * BrowserTool — Interactive browser automation tool in Zipply.
 * Allows AI models to open web pages, inspect DOM, click buttons, type text, take screenshots,
 * and navigate tabs in the right side panel's built-in browser.
 *
 * SOTA Dual-Mode Compatibility:
 * 1. Multimodal Models (Gemini, GPT-4o, Claude): Receives high-res screenshots and layout details.
 * 2. Non-Multimodal Models (DeepSeek, Llama, Qwen, Mistral): Receives structured hierarchy of
 *    interactive elements (buttons, links, inputs with CSS selectors and text) and clean text summaries.
 */
export class BrowserTool extends ToolBase {
  get name(): string {
    return 'browser'
  }

  get description(): string {
    return 'Control and inspect the built-in desktop browser in the right panel. Navigate to URLs, take screenshots, click buttons/links, fill form inputs, scroll, extract interactive DOM elements and text, and manage tabs. Supports both multimodal models (screenshots) and text-only models (interactive elements with CSS selectors).'
  }

  getExecutionPolicy(): { mutates: boolean; parallelSafe: boolean; cacheable: boolean } {
    return { mutates: true, parallelSafe: false, cacheable: false }
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      description: {
        type: 'string',
        description: 'Краткое действие (2-4 слова, напр. "Переход на страницу", "Клик по кнопке")',
        required: false
      },
      action: {
        type: 'string',
        description:
          'Browser action: navigate (open URL in active tab), screenshot (capture visible page), click (click button/link by selector or text), type (enter text into input/textarea), scroll (scroll page up/down), get_content (extract DOM elements and text), new_tab (open new tab), close_tab (close tab), list_tabs (list open tabs), switch_tab (switch active tab). Default: navigate',
        required: false,
        enum: [
          'navigate',
          'screenshot',
          'click',
          'type',
          'scroll',
          'get_content',
          'new_tab',
          'close_tab',
          'list_tabs',
          'switch_tab'
        ]
      },
      url: {
        type: 'string',
        description: '[Required for navigate, new_tab] Full URL to navigate to (e.g. "https://example.com" or "http://localhost:3000")',
        required: false
      },
      selector: {
        type: 'string',
        description: '[For click, type] CSS selector of target element (e.g. "#submit-btn", "input[name=\'email\']", "a.nav-link")',
        required: false
      },
      text: {
        type: 'string',
        description: '[For type: string to enter; for click: visible button/link text to locate target]',
        required: false
      },
      direction: {
        type: 'string',
        description: '[For scroll] Direction: "up" or "down" (default: "down")',
        required: false,
        enum: ['up', 'down']
      },
      amount: {
        type: 'integer',
        description: '[For scroll] Distance in pixels to scroll (default: 400)',
        required: false
      },
      tab_id: {
        type: 'string',
        description: '[For switch_tab, close_tab] Target tab ID',
        required: false
      }
    }
  }

  validate(argumentsJson: string): string | null {
    try {
      const args = JSON.parse(argumentsJson || '{}')
      const action = (args.action || 'navigate').toLowerCase()
      if ((action === 'navigate' || action === 'new_tab') && !args.url?.trim()) {
        return 'Error: "url" parameter is required for navigate and new_tab actions.'
      }
      if (action === 'type' && args.text === undefined) {
        return 'Error: "text" parameter is required for type action.'
      }
      if (action === 'click' && !args.selector?.trim() && !args.text?.trim()) {
        return 'Error: either "selector" or "text" parameter is required for click action.'
      }
    } catch {
      return 'Error: invalid JSON arguments.'
    }
    return null
  }

  async execute(
    argumentsJson: string,
    _blackboard: Blackboard,
    abortSignal?: AbortSignal
  ): Promise<ToolResult> {
    let args: any
    try {
      args = JSON.parse(argumentsJson || '{}')
    } catch {
      return { formattedContent: 'Error: invalid JSON arguments.' }
    }

    const action = (args.action || 'navigate').toLowerCase() as BrowserActionRequest['action']
    let url = args.url?.trim()
    if (url && !/^https?:\/\//i.test(url) && !url.startsWith('about:') && !url.startsWith('file:')) {
      url = 'https://' + url
    }

    if (abortSignal?.aborted) {
      return { formattedContent: 'Browser action cancelled by user.' }
    }

    try {
      const manager = BrowserSessionManager.getInstance()
      const response = await manager.executeAction(
        action,
        {
          url,
          selector: args.selector?.trim(),
          text: args.text,
          direction: args.direction === 'up' ? 'up' : 'down',
          amount: typeof args.amount === 'number' ? args.amount : 400,
          tabId: args.tab_id?.trim()
        },
        35000
      )

      if (!response.success) {
        return {
          formattedContent: `Browser error [${action}]: ${response.error || 'Unknown error occurred in browser.'}`,
          data: { action, error: response.error }
        }
      }

      const data = response.data || {}

      switch (action) {
        case 'navigate':
        case 'new_tab':
        case 'get_content': {
          let output = `🌐 Page: ${data.title || '(Untitled)'}\nURL: ${data.url || url || ''}\n`
          if (data.status) {
            output += `Status: ${data.status}\n`
          }

          if (Array.isArray(data.interactiveElements) && data.interactiveElements.length > 0) {
            output += `\nInteractive Elements (${data.interactiveElements.length}):\n`
            for (const el of data.interactiveElements.slice(0, 40)) {
              const label = el.text ? `"${el.text}"` : (el.value ? `value="${el.value}"` : '(no text)')
              const sel = el.selector ? ` [selector: ${el.selector}]` : ''
              const href = el.href ? ` [href: ${el.href}]` : ''
              const type = el.type ? ` (${el.type})` : ''
              output += `• [${el.id}] <${el.tag}${type}>: ${label}${sel}${href}\n`
            }
            if (data.interactiveElements.length > 40) {
              output += `[... and ${data.interactiveElements.length - 40} more elements]\n`
            }
          }

          if (data.textSummary) {
            output += `\nPage Text Excerpt:\n${data.textSummary.slice(0, 3000)}\n`
          }

          if (data.screenshot) {
            output += `\n[Screenshot captured: ${data.screenshot.length > 50 ? 'Available in data payload' : data.screenshot}]`
          }

          return {
            formattedContent: output.trim(),
            data: {
              action,
              title: data.title,
              url: data.url || url,
              interactiveElements: data.interactiveElements || [],
              interactiveElementsCount: data.interactiveElements?.length || 0,
              screenshot: data.screenshot || undefined
            }
          }
        }

        case 'screenshot': {
          let output = `📸 Screenshot taken successfully for: ${data.title || 'current page'}\nURL: ${data.url || ''}\n`
          if (Array.isArray(data.interactiveElements) && data.interactiveElements.length > 0) {
            output += `\nKey Interactive Elements:\n`
            for (const el of data.interactiveElements.slice(0, 20)) {
              const label = el.text ? `"${el.text}"` : ''
              output += `• [${el.id}] <${el.tag}>: ${label} [selector: ${el.selector}]\n`
            }
          }
          if (data.textSummary) {
            output += `\nPage Text Summary:\n${data.textSummary.slice(0, 1000)}\n`
          }
          return {
            formattedContent: output.trim(),
            data: {
              action: 'screenshot',
              url: data.url,
              title: data.title,
              interactiveElements: data.interactiveElements || [],
              screenshot: data.screenshot
            }
          }
        }

        case 'click': {
          const clickedInfo = data.clicked || args.selector || args.text || 'element'
          let out = `Clicked: ${clickedInfo}. Current page: "${data.title || ''}" (${data.url || ''})`
          if (data.interactiveElements && data.interactiveElements.length > 0) {
            out += `\nUpdated Interactive Elements (${data.interactiveElements.length}):\n`
            for (const el of data.interactiveElements.slice(0, 15)) {
              out += `• <${el.tag}>: "${el.text || ''}" [${el.selector}]\n`
            }
          }
          return {
            formattedContent: out.trim(),
            data: {
              action: 'click',
              clicked: clickedInfo,
              url: data.url,
              title: data.title,
              interactiveElements: data.interactiveElements || []
            }
          }
        }

        case 'type': {
          const target = args.selector || 'active input'
          return {
            formattedContent: `Successfully typed text into ${target}. Current value: "${data.value ?? args.text}"`,
            data: { selector: args.selector, value: data.value ?? args.text }
          }
        }

        case 'scroll': {
          return {
            formattedContent: `Scrolled ${args.direction || 'down'} by ${args.amount || 400}px. Page scroll position: ${data.scrollY ?? 'updated'}px.`,
            data: { scrollY: data.scrollY, direction: args.direction, amount: args.amount }
          }
        }

        case 'list_tabs': {
          const tabs = Array.isArray(data.tabs) ? data.tabs : []
          if (tabs.length === 0) {
            return { formattedContent: 'No open browser tabs.' }
          }
          let out = `Open Browser Tabs (${tabs.length}):\n`
          for (const t of tabs) {
            const activeMark = t.isActive ? ' [ACTIVE]' : ''
            out += `• Tab ID: ${t.id}${activeMark} | "${t.title || 'Untitled'}" (${t.url || 'about:blank'})\n`
          }
          return { formattedContent: out.trim(), data: { tabs } }
        }

        case 'switch_tab': {
          return {
            formattedContent: `Switched to tab '${args.tab_id}'. Page: "${data.title || ''}" (${data.url || ''})`,
            data: { activeTabId: args.tab_id, title: data.title, url: data.url }
          }
        }

        case 'close_tab': {
          return {
            formattedContent: `Closed tab '${args.tab_id || 'active'}'. Remaining tabs: ${data.remainingCount ?? 'updated'}.`,
            data: { closedTabId: args.tab_id, remainingCount: data.remainingCount }
          }
        }

        default:
          return {
            formattedContent: `Browser action '${action}' completed successfully.`,
            data
          }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        formattedContent: `Browser tool execution error: ${msg}`,
        data: { error: msg }
      }
    }
  }
}

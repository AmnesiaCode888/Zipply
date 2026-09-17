import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  X,
  Plus,
  Globe,
  ExternalLink,
  Search,
  Lock,
  Compass,
  Sparkles
} from 'lucide-react'
import './BrowserView.css'

export interface BrowserTab {
  id: string
  url: string
  title: string
  favicon?: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export interface BrowserViewProps {
  initialUrl?: string
}

const EXTRACT_DOM_SCRIPT = `
(() => {
  try {
    const result = {
      title: document.title || '',
      url: window.location.href || '',
      interactiveElements: [],
      textSummary: '',
      scrollY: window.scrollY || 0
    };

    const elements = document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="link"], [onclick]');
    let idCounter = 1;
    const seen = new Set();

    elements.forEach(el => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (rect.width === 0 || rect.height === 0 || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute('type') || '';
      let text = (el.innerText || el.textContent || el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
      text = text.replace(/\\s+/g, ' ').slice(0, 80);

      let selector = '';
      if (el.id) {
        selector = '#' + el.id;
      } else if (el.name) {
        selector = tag + '[name="' + el.name + '"]';
      } else if (el.className && typeof el.className === 'string') {
        const firstClass = el.className.split(' ').filter(c => c.trim() && !c.includes(':'))[0];
        if (firstClass) selector = tag + '.' + firstClass;
      }
      if (!selector) selector = tag;

      const key = tag + ':' + type + ':' + text + ':' + selector;
      if (seen.has(key)) return;
      seen.add(key);

      result.interactiveElements.push({
        id: idCounter++,
        tag,
        type: type || undefined,
        text: text || undefined,
        selector,
        href: el.getAttribute('href') || undefined,
        value: (el.value !== undefined && tag !== 'button') ? String(el.value) : undefined
      });
    });

    const bodyClone = document.body.cloneNode(true);
    bodyClone.querySelectorAll('script, style, noscript, svg').forEach(s => s.remove());
    result.textSummary = (bodyClone.innerText || bodyClone.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 3500);

    return result;
  } catch (err) {
    return { title: document.title, url: window.location.href, interactiveElements: [], textSummary: '', error: String(err) };
  }
})()
`

async function safeExecuteJs<T = any>(wv: any, script: string, timeoutMs = 4000): Promise<T | null> {
  if (!wv || typeof wv.executeJavaScript !== 'function') return null
  try {
    const res = await Promise.race([
      wv.executeJavaScript(script),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('executeJavaScript timed out')), timeoutMs)
      )
    ])
    return res as T
  } catch (err) {
    console.warn('[BrowserView] safeExecuteJs error or timeout:', err)
    return null
  }
}

function isBlankUrl(url?: string): boolean {
  if (!url) return true
  const clean = url.trim().toLowerCase()
  return clean === '' || clean === 'about:blank' || clean === 'about:blank/'
}

export const BrowserView: React.FC<BrowserViewProps> = ({ initialUrl = '' }) => {
  const [tabs, setTabs] = useState<BrowserTab[]>(() => [
    {
      id: 'tab_1',
      url: initialUrl || '',
      title: initialUrl ? initialUrl.replace(/https?:\/\//, '').replace(/\/.*$/, '') : 'Новая вкладка',
      isLoading: false,
      canGoBack: false,
      canGoForward: false
    }
  ])
  const [activeTabId, setActiveTabId] = useState<string>('tab_1')
  const [urlInput, setUrlInput] = useState<string>(initialUrl || '')
  const [aiStatus, setAiStatus] = useState<string | null>(null)

  const tabCounterRef = useRef<number>(2)
  const webviewRefs = useRef<Record<string, any>>({})
  const tabsListRef = useRef<HTMLDivElement>(null)

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0]

  // Sync url input when active tab changes (clearing about:blank)
  useEffect(() => {
    if (activeTab) {
      setUrlInput(isBlankUrl(activeTab.url) ? '' : (activeTab.url || ''))
    }
  }, [activeTab?.id, activeTab?.url])

  // Create new tab
  const handleNewTab = useCallback((url = ''): string => {
    const newId = `tab_${tabCounterRef.current++}`
    const newTab: BrowserTab = {
      id: newId,
      url,
      title: url ? url.replace(/https?:\/\//, '').replace(/\/.*$/, '') : 'Новая вкладка',
      isLoading: Boolean(url),
      canGoBack: false,
      canGoForward: false
    }
    setTabs((prev) => [...prev, newTab])
    setActiveTabId(newId)
    setUrlInput(url)
    return newId
  }, [])

  // Close tab
  const handleCloseTab = useCallback((tabId: string, e?: React.MouseEvent): void => {
    e?.stopPropagation()
    setTabs((prev) => {
      if (prev.length <= 1) {
        // Keep at least one blank tab
        const fresh: BrowserTab = {
          id: `tab_${tabCounterRef.current++}`,
          url: '',
          title: 'Новая вкладка',
          isLoading: false,
          canGoBack: false,
          canGoForward: false
        }
        setActiveTabId(fresh.id)
        setUrlInput('')
        return [fresh]
      }

      const idx = prev.findIndex((t) => t.id === tabId)
      const nextTabs = prev.filter((t) => t.id !== tabId)
      if (activeTabId === tabId) {
        const nextActive = nextTabs[Math.max(0, idx - 1)] || nextTabs[0]
        setActiveTabId(nextActive.id)
        setUrlInput(nextActive.url || '')
      }
      return nextTabs
    })
    delete webviewRefs.current[tabId]
  }, [activeTabId])

  // Navigate active webview
  const navigateActiveTab = useCallback((rawUrl: string): void => {
    const trimmed = rawUrl.trim()
    if (!trimmed || isBlankUrl(trimmed)) return

    let finalUrl = trimmed
    if (/^(localhost|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?(\/.*)?$/i.test(trimmed)) {
      finalUrl = `http://${trimmed}`
    } else if (!/^https?:\/\//i.test(trimmed) && !trimmed.startsWith('about:') && !trimmed.startsWith('file:')) {
      if (trimmed.includes('.') && !trimmed.includes(' ')) {
        finalUrl = `https://${trimmed}`
      } else {
        // Search query via Google
        finalUrl = `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
      }
    }

    setUrlInput(finalUrl)
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, url: finalUrl, isLoading: true } : t))
    )

    const wv = webviewRefs.current[activeTabId]
    if (wv && typeof wv.loadURL === 'function') {
      try {
        wv.loadURL(finalUrl)
      } catch (err) {
        console.warn('[BrowserView] loadURL error:', err)
      }
    }
  }, [activeTabId])

  const handleSubmitUrl = (e: React.FormEvent): void => {
    e.preventDefault()
    navigateActiveTab(urlInput)
  }

  // 3 Classic Navigation Buttons: Back, Forward, Reload
  const handleGoBack = (): void => {
    const wv = webviewRefs.current[activeTabId]
    if (wv && typeof wv.goBack === 'function' && activeTab?.canGoBack) {
      wv.goBack()
    }
  }

  const handleGoForward = (): void => {
    const wv = webviewRefs.current[activeTabId]
    if (wv && typeof wv.goForward === 'function' && activeTab?.canGoForward) {
      wv.goForward()
    }
  }

  const handleReload = (): void => {
    const wv = webviewRefs.current[activeTabId]
    if (wv) {
      if (activeTab?.isLoading && typeof wv.stop === 'function') {
        wv.stop()
      } else if (typeof wv.reload === 'function') {
        wv.reload()
      }
    }
  }

  const handleOpenExternal = (): void => {
    if (activeTab?.url) {
      try {
        window.open(activeTab.url, '_blank')
      } catch {}
    }
  }

  // Setup Webview Event Handlers for a given tab
  const attachWebviewListeners = useCallback((tabId: string, wv: any): void => {
    if (!wv) return

    const updateTabMeta = (): void => {
      try {
        const canBack = typeof wv.canGoBack === 'function' ? wv.canGoBack() : false
        const canFwd = typeof wv.canGoForward === 'function' ? wv.canGoForward() : false
        const currentUrl = typeof wv.getURL === 'function' ? wv.getURL() : ''
        const currentTitle = typeof wv.getTitle === 'function' ? wv.getTitle() : ''

        if (isBlankUrl(currentUrl)) return

        setTabs((prev) =>
          prev.map((t) => {
            if (t.id === tabId) {
              return {
                ...t,
                url: currentUrl || t.url,
                title: (!isBlankUrl(currentTitle) && currentTitle) ? currentTitle : (t.title || 'Новая вкладка'),
                canGoBack: canBack,
                canGoForward: canFwd
              }
            }
            return t
          })
        )
      } catch {}
    }

    const onStartLoading = (): void => {
      setTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, isLoading: true } : t))
      )
    }

    const onStopLoading = (): void => {
      setTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, isLoading: false } : t))
      )
      updateTabMeta()
    }

    const onNavigate = (e: any): void => {
      const url = e.url || ''
      if (isBlankUrl(url)) return
      setTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, url } : t))
      )
      if (tabId === activeTabId) {
        setUrlInput(url)
      }
      updateTabMeta()
    }

    const onTitleUpdated = (e: any): void => {
      const title = e.title || ''
      if (isBlankUrl(title)) return
      setTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, title } : t))
      )
    }

    const onFaviconUpdated = (e: any): void => {
      if (Array.isArray(e.favicons) && e.favicons[0]) {
        setTabs((prev) =>
          prev.map((t) => (t.id === tabId ? { ...t, favicon: e.favicons[0] } : t))
        )
      }
    }

    wv.addEventListener('did-start-loading', onStartLoading)
    wv.addEventListener('did-stop-loading', onStopLoading)
    wv.addEventListener('did-navigate', onNavigate)
    wv.addEventListener('did-navigate-in-page', onNavigate)
    wv.addEventListener('page-title-updated', onTitleUpdated)
    wv.addEventListener('page-favicon-updated', onFaviconUpdated)

    // Handle new-window requests by opening inside our tabs instead of external popups
    wv.addEventListener('new-window', (e: any) => {
      if (e.url) {
        handleNewTab(e.url)
      }
    })
  }, [activeTabId, handleNewTab])

  // Listen to Agent Browser Action Requests via IPC
  useEffect(() => {
    if (!window.api?.browser?.onAction) return

    const unsub = window.api.browser.onAction(async (request: any) => {
      const { requestId, action, url, selector, text, direction, amount, tabId } = request
      const targetTabId = tabId || activeTabId
      let targetWv = webviewRefs.current[targetTabId]

      setAiStatus(`🤖 ИИ выполняет: ${action}${url ? ` (${url})` : ''}...`)

      const sendSuccess = (data: any = {}): void => {
        setAiStatus(null)
        window.api?.browser?.sendResponse?.({
          requestId,
          success: true,
          data
        })
      }

      const sendError = (errMsg: string): void => {
        setAiStatus(null)
        window.api?.browser?.sendResponse?.({
          requestId,
          success: false,
          error: errMsg
        })
      }

      try {
        switch (action) {
          case 'list_tabs': {
            sendSuccess({
              tabs: tabs.map((t) => ({
                id: t.id,
                title: t.title,
                url: t.url,
                isActive: t.id === activeTabId
              }))
            })
            return
          }

          case 'new_tab': {
            const freshTabId = handleNewTab(url || '')
            // Wait brief moment for webview DOM mount
            await new Promise((r) => setTimeout(r, 400))
            const newWv = webviewRefs.current[freshTabId]
            if (newWv && url) {
              await new Promise<void>((resolve) => {
                let done = false
                const finish = () => {
                  if (!done) {
                    done = true
                    cleanup()
                    resolve()
                  }
                }
                const timer = setTimeout(finish, 6000)
                const cleanup = () => {
                  clearTimeout(timer)
                  newWv.removeEventListener('did-stop-loading', finish)
                  newWv.removeEventListener('did-fail-load', finish)
                  newWv.removeEventListener('dom-ready', finish)
                }
                newWv.addEventListener('did-stop-loading', finish, { once: true })
                newWv.addEventListener('did-fail-load', finish, { once: true })
                newWv.addEventListener('dom-ready', finish, { once: true })
                try {
                  newWv.loadURL(url)
                } catch {
                  cleanup()
                  resolve()
                }
              })
              await new Promise((r) => setTimeout(r, 400))
              const pageData = await safeExecuteJs(newWv, EXTRACT_DOM_SCRIPT, 4000)
              let screenshotDataUrl: string | undefined = undefined
              try {
                if (typeof newWv.capturePage === 'function') {
                  const nativeImg = await newWv.capturePage()
                  screenshotDataUrl = nativeImg?.toDataURL?.()
                }
              } catch {}
              sendSuccess({
                tabId: freshTabId,
                title: pageData?.title || newWv.getTitle?.() || '',
                url: pageData?.url || newWv.getURL?.() || url,
                interactiveElements: pageData?.interactiveElements || [],
                textSummary: pageData?.textSummary || '',
                screenshot: screenshotDataUrl
              })
            } else {
              sendSuccess({ tabId: freshTabId })
            }
            return
          }

          case 'close_tab': {
            const closeId = tabId || activeTabId
            handleCloseTab(closeId)
            sendSuccess({ closedTabId: closeId, remainingCount: tabs.length - 1 })
            return
          }

          case 'switch_tab': {
            if (tabId && tabs.some((t) => t.id === tabId)) {
              setActiveTabId(tabId)
              const switchedWv = webviewRefs.current[tabId]
              const pageData = await safeExecuteJs(switchedWv, EXTRACT_DOM_SCRIPT, 3000)
              sendSuccess({
                activeTabId: tabId,
                title: pageData?.title || '',
                url: pageData?.url || '',
                interactiveElements: pageData?.interactiveElements || []
              })
            } else {
              sendError(`Tab with id '${tabId}' not found.`)
            }
            return
          }

          case 'navigate': {
            if (!url) {
              sendError('URL parameter is required for navigate action.')
              return
            }

            let finalUrl = url.trim()
            if (/^(localhost|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?(\/.*)?$/i.test(finalUrl)) {
              finalUrl = `http://${finalUrl}`
            } else if (!/^https?:\/\//i.test(finalUrl) && !finalUrl.startsWith('about:') && !finalUrl.startsWith('file:')) {
              finalUrl = `https://${finalUrl}`
            }

            // Update UI state
            setTabs((prev) =>
              prev.map((t) => (t.id === targetTabId ? { ...t, url: finalUrl, isLoading: true } : t))
            )
            if (targetTabId === activeTabId) {
              setUrlInput(finalUrl)
            }

            targetWv = webviewRefs.current[targetTabId]
            if (!targetWv) {
              await new Promise((r) => setTimeout(r, 250))
              targetWv = webviewRefs.current[targetTabId]
            }

            if (!targetWv) {
              sendError('Failed to locate webview for navigation.')
              return
            }

            // Wait for navigation event or timeout (up to 6s)
            await new Promise<void>((resolve) => {
              let done = false
              const finish = () => {
                if (!done) {
                  done = true
                  cleanup()
                  resolve()
                }
              }
              const timer = setTimeout(finish, 6000)
              const cleanup = () => {
                clearTimeout(timer)
                targetWv.removeEventListener('did-stop-loading', finish)
                targetWv.removeEventListener('did-fail-load', finish)
                targetWv.removeEventListener('dom-ready', finish)
              }
              targetWv.addEventListener('did-stop-loading', finish, { once: true })
              targetWv.addEventListener('did-fail-load', finish, { once: true })
              targetWv.addEventListener('dom-ready', finish, { once: true })

              try {
                targetWv.loadURL(finalUrl)
              } catch (err) {
                console.warn('[BrowserView] loadURL error:', err)
                cleanup()
                resolve()
              }
            })

            // Short pause for DOM and scripts to settle
            await new Promise((r) => setTimeout(r, 400))

            // Safely extract DOM with 4s timeout
            const pageData = await safeExecuteJs(targetWv, EXTRACT_DOM_SCRIPT, 4000)

            // Capture screenshot if possible
            let screenshotDataUrl: string | undefined = undefined
            try {
              if (typeof targetWv.capturePage === 'function') {
                const nativeImg = await targetWv.capturePage()
                screenshotDataUrl = nativeImg?.toDataURL?.()
              }
            } catch {}

            sendSuccess({
              title: pageData?.title || targetWv.getTitle?.() || '',
              url: pageData?.url || targetWv.getURL?.() || finalUrl,
              interactiveElements: pageData?.interactiveElements || [],
              textSummary: pageData?.textSummary || '',
              screenshot: screenshotDataUrl
            })
            return
          }

          case 'screenshot': {
            if (!targetWv) {
              sendError('No active browser tab found to take screenshot.')
              return
            }
            let screenshotDataUrl: string | undefined = undefined
            try {
              if (typeof targetWv.capturePage === 'function') {
                const nativeImg = await targetWv.capturePage()
                screenshotDataUrl = nativeImg?.toDataURL?.()
              }
            } catch (err) {
              console.warn('[BrowserView] capturePage failed:', err)
            }

            const pageData = await safeExecuteJs(targetWv, EXTRACT_DOM_SCRIPT, 3000)

            sendSuccess({
              title: pageData?.title || targetWv.getTitle?.() || '',
              url: pageData?.url || targetWv.getURL?.() || '',
              interactiveElements: pageData?.interactiveElements || [],
              textSummary: pageData?.textSummary || '',
              screenshot: screenshotDataUrl
            })
            return
          }

          case 'click': {
            if (!targetWv) {
              sendError('No active browser tab found to perform click.')
              return
            }

            const clickScript = `
              (() => {
                let target = null;
                const selector = ${JSON.stringify(selector || '')};
                const text = ${JSON.stringify(text || '')};

                if (selector) {
                  try { target = document.querySelector(selector); } catch {}
                }
                if (!target && text) {
                  const all = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"], span, div'));
                  target = all.find(el => el.textContent && el.textContent.trim().toLowerCase().includes(text.toLowerCase()));
                }

                if (!target) return { success: false, error: 'Element not found for selector="' + selector + '" or text="' + text + '"' };

                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                target.focus();
                try {
                  target.click();
                } catch (e) {
                  const evt = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
                  target.dispatchEvent(evt);
                }
                return {
                  success: true,
                  clicked: target.tagName + (target.id ? '#' + target.id : (target.className ? '.' + target.className.split(' ')[0] : ''))
                };
              })()
            `

            const clickResult = await safeExecuteJs(targetWv, clickScript, 3000)
            if (!clickResult || !clickResult.success) {
              sendError(clickResult?.error || 'Failed to click element.')
              return
            }

            // Wait brief moment for page update
            await new Promise((r) => setTimeout(r, 600))
            const pageData = await safeExecuteJs(targetWv, EXTRACT_DOM_SCRIPT, 3000)

            sendSuccess({
              clicked: clickResult.clicked,
              title: pageData?.title || targetWv.getTitle?.() || '',
              url: pageData?.url || targetWv.getURL?.() || '',
              interactiveElements: pageData?.interactiveElements || []
            })
            return
          }

          case 'type': {
            if (!targetWv) {
              sendError('No active browser tab found to type text.')
              return
            }

            const typeScript = `
              (() => {
                let target = null;
                const selector = ${JSON.stringify(selector || '')};
                const val = ${JSON.stringify(text || '')};

                if (selector) {
                  try { target = document.querySelector(selector); } catch {}
                }
                if (!target) {
                  const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]), textarea'));
                  target = inputs[0];
                }

                if (!target) return { success: false, error: 'No input field found.' };

                target.focus();
                target.value = val;
                target.dispatchEvent(new Event('input', { bubbles: true }));
                target.dispatchEvent(new Event('change', { bubbles: true }));
                return { success: true, value: target.value };
              })()
            `

            const typeResult = await safeExecuteJs(targetWv, typeScript, 3000)
            if (!typeResult || !typeResult.success) {
              sendError(typeResult?.error || 'Failed to type into input.')
              return
            }

            sendSuccess({ value: typeResult.value })
            return
          }

          case 'scroll': {
            if (!targetWv) {
              sendError('No active browser tab found to scroll.')
              return
            }

            const scrollDistance = (direction === 'up' ? -1 : 1) * (Number(amount) || 400)
            const scrollScript = `
              (() => {
                window.scrollBy({ top: ${scrollDistance}, behavior: 'smooth' });
                return { scrollY: window.scrollY };
              })()
            `
            const scrollResult = await safeExecuteJs(targetWv, scrollScript, 3000)
            sendSuccess({ scrollY: scrollResult?.scrollY })
            return
          }

          case 'get_content': {
            if (!targetWv) {
              sendError('No active browser tab found to extract content.')
              return
            }

            const pageData = await safeExecuteJs(targetWv, EXTRACT_DOM_SCRIPT, 4000)
            if (!pageData) {
              sendError('Failed to extract page content or execution timed out.')
              return
            }

            sendSuccess({
              title: pageData?.title || targetWv.getTitle?.() || '',
              url: pageData?.url || targetWv.getURL?.() || '',
              interactiveElements: pageData?.interactiveElements || [],
              textSummary: pageData?.textSummary || ''
            })
            return
          }

          default:
            sendError(`Unsupported browser action '${action}'.`)
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        sendError(msg)
      }
    })

    return () => unsub()
  }, [tabs, activeTabId, handleNewTab, handleCloseTab, navigateActiveTab])

  return (
    <div className="embedded-browser-container">
      {/* Top Tab Strip */}
      <div className="browser-tabs-strip">
        <div className="browser-tabs-scroll" ref={tabsListRef}>
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId
            return (
              <button
                key={tab.id}
                type="button"
                className={`browser-tab-item ${isActive ? 'active' : ''}`}
                onClick={() => setActiveTabId(tab.id)}
                title={`${tab.title}\n${tab.url || 'Новая вкладка'}`}
              >
                <span className="browser-tab-icon">
                  {tab.isLoading ? (
                    <RotateCw size={11} className="browser-tab-spinner" />
                  ) : (
                    <Globe size={11} />
                  )}
                </span>
                <span className="browser-tab-title">{tab.title || 'Вкладка'}</span>
                <span
                  className="browser-tab-close"
                  onClick={(e) => handleCloseTab(tab.id, e)}
                  title="Закрыть вкладку"
                >
                  <X size={10} strokeWidth={2} />
                </span>
              </button>
            )
          })}
        </div>

        <button
          type="button"
          className="browser-new-tab-btn"
          onClick={() => handleNewTab()}
          title="Новая вкладка"
          aria-label="Новая вкладка"
        >
          <Plus size={13} strokeWidth={2} />
        </button>
      </div>

      {/* Navigation Toolbar (3 Classic Buttons + URL input) */}
      <div className="browser-toolbar">
        <div className="browser-nav-group">
          {/* Button 1: Back */}
          <button
            type="button"
            className="browser-nav-btn"
            disabled={!activeTab?.canGoBack}
            onClick={handleGoBack}
            title="Назад"
            aria-label="Назад"
          >
            <ArrowLeft size={14} strokeWidth={2} />
          </button>

          {/* Button 2: Forward */}
          <button
            type="button"
            className="browser-nav-btn"
            disabled={!activeTab?.canGoForward}
            onClick={handleGoForward}
            title="Вперёд"
            aria-label="Вперёд"
          >
            <ArrowRight size={14} strokeWidth={2} />
          </button>

          {/* Button 3: Reload / Stop */}
          <button
            type="button"
            className="browser-nav-btn"
            onClick={handleReload}
            title={activeTab?.isLoading ? 'Остановить' : 'Обновить (F5)'}
            aria-label="Обновить"
          >
            {activeTab?.isLoading ? (
              <X size={14} strokeWidth={2} />
            ) : (
              <RotateCw size={13} strokeWidth={2} />
            )}
          </button>
        </div>

        {/* Address Bar */}
        <form className="browser-address-form" onSubmit={handleSubmitUrl}>
          <span className="browser-address-icon">
            {activeTab?.url?.startsWith('https:') ? (
              <Lock size={12} color="#10B981" />
            ) : (
              <Search size={12} />
            )}
          </span>
          <input
            type="text"
            className="browser-address-input"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Введите URL адрес или поисковый запрос..."
            spellCheck={false}
            autoComplete="off"
          />
        </form>

        {activeTab?.url && (
          <button
            type="button"
            className="browser-action-btn"
            onClick={handleOpenExternal}
            title="Открыть во внешнем браузере"
            aria-label="Открыть во внешнем браузере"
          >
            <ExternalLink size={13} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* AI banner when agent is executing actions */}
      {aiStatus && (
        <div className="browser-ai-banner">
          <div className="browser-ai-banner-left">
            <Sparkles size={13} color="#A855F7" />
            <span>{aiStatus}</span>
          </div>
          <span className="browser-ai-badge">AI Agent</span>
        </div>
      )}

      {/* Webview Viewport */}
      <div className="browser-viewport-container">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          const isBlank = isBlankUrl(tab.url)

          return (
            <div
              key={tab.id}
              className={`browser-webview-tab-content ${isActive ? '' : 'hidden'}`}
            >
              {isBlank && (
                <div className="browser-start-page">
                  <div className="browser-start-logo">
                    <Compass size={28} strokeWidth={1.5} />
                  </div>
                  <h2 className="browser-start-title">Встроенный браузер</h2>
                  <p className="browser-start-subtitle">
                    Просматривайте веб-страницы, локальные серверы и тестируйте интерфейсы вместе с ИИ.
                  </p>

                  <div className="browser-start-shortcuts">
                    <button
                      type="button"
                      className="browser-start-shortcut-btn"
                      onClick={() => navigateActiveTab('http://localhost:3000')}
                    >
                      <Globe size={13} />
                      <span>localhost:3000</span>
                    </button>
                    <button
                      type="button"
                      className="browser-start-shortcut-btn"
                      onClick={() => navigateActiveTab('http://localhost:5173')}
                    >
                      <Globe size={13} />
                      <span>localhost:5173</span>
                    </button>
                    <button
                      type="button"
                      className="browser-start-shortcut-btn"
                      onClick={() => navigateActiveTab('https://www.google.com')}
                    >
                      <Search size={13} />
                      <span>Google</span>
                    </button>
                    <button
                      type="button"
                      className="browser-start-shortcut-btn"
                      onClick={() => navigateActiveTab('https://github.com')}
                    >
                      <Globe size={13} />
                      <span>GitHub</span>
                    </button>
                  </div>
                </div>
              )}

              <webview
                ref={(el) => {
                  webviewRefs.current[tab.id] = el
                  if (el) {
                    attachWebviewListeners(tab.id, el)
                  }
                }}
                src={tab.url || 'about:blank'}
                className={`browser-webview-element ${isBlank ? 'invisible-blank' : ''}`}
                allowpopups={true}
                webpreferences="contextIsolation=true, sandbox=false"
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default BrowserView

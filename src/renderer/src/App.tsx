import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import type { ChatDraft, ExtensionCommandOption, ExtensionManagementPage } from './components/chat-input/ChatInput'
import { Sidebar } from './components/sidebar'
import { MainSettingsView, SettingsTab } from './components/settings'
import { AppLayout } from './components/layout'
import { ChatCanvas, UncensoredModeConfirm } from './components/chat'
import { plugins } from './components/plugins/PluginLibrary'
import { clearLegacyInstalledPlugins, loadInstalledPlugins } from './services/pluginStorage'
import { applyTheme, loadSettings } from './services/settingsService'
import { useChat } from './hooks/useChat'
import { useChatSessions } from './hooks/useChatSessions'
import { useSidebarResize } from './hooks/useSidebarResize'
import { useAppShortcuts } from './hooks/useAppShortcuts'
import { useAuth } from './hooks/useAuth'
import { useUpdates } from './hooks/useUpdates'
import { AuthScreen } from './components/auth/AuthScreen'
import { TitleBar } from './components/TitleBar'
import { getStorageError, reportStorageError } from './services/chatStorageService'
import type { NavigationView } from './components/layout/NavigationRail'
import { Clock3 } from 'lucide-react'
import { createNewSession } from './services/chatStorageService'
import type { ExtensionRef } from '../../shared/extensions'
import { isExtensionRef } from '../../shared/extensions'
import type { ExtensionCatalog } from '../../shared/extensionCatalog'
import { ExtensionsManagementView } from './components/extensions/ExtensionsManagementView'
import { FreePlanPrompt } from './components/subscription/FreePlanPrompt'
import { getFreePlanConsentKey, getSubscriptionInfo, hasAcceptedFreePlan, rememberFreePlanAcceptance } from './services/subscription'
import type { ImageAttachment } from './types/chat'

const emptyExtensionCatalog: ExtensionCatalog = { skills: [], servers: [], tools: [], resources: [], prompts: [], trustedMcpTools: [] }

function mcpResourceRefId(serverId: string, uri: string): string {
  let hash = 14695981039346656037n
  for (const character of `${serverId}\0${uri}`) hash = BigInt.asUintN(64, (hash ^ BigInt(character.codePointAt(0) || 0)) * 1099511628211n)
  return `${serverId}:resource:${hash.toString(16).padStart(16, '0')}`
}

function extensionLabel(value: string, fallback: string): string { return (value || fallback).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 180) }

export const App: React.FC = () => {
  const { auth, ready: authReady, busy: authBusy, login, cancelLogin, refresh } = useAuth()
  const { updateState, checkUpdates, openDownload } = useUpdates()
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(null)
  const sidebarUpdate = updateState.status === 'available' &&
    updateState.latestVersion &&
    dismissedUpdateVersion !== updateState.latestVersion
    ? { version: updateState.latestVersion, releaseUrl: updateState.releaseUrl }
    : null
  const subscription = useMemo(() => getSubscriptionInfo(auth.profile, auth.usage), [auth.profile, auth.usage])
  const freePlanConsentKey = useMemo(() => getFreePlanConsentKey(auth.profile), [auth.profile])
  const [acceptedFreePlanKey, setAcceptedFreePlanKey] = useState<string | null>(() =>
    hasAcceptedFreePlan(freePlanConsentKey) ? freePlanConsentKey : null
  )
  const [acceptedFreePlanWithoutIdentity, setAcceptedFreePlanWithoutIdentity] = useState(false)
  const acceptedAccountKey = useRef(freePlanConsentKey)
  const [freePlanPromptOpen, setFreePlanPromptOpen] = useState(false)
  const pendingFreePlanAction = useRef<(() => void) | null>(null)
  const plansOpenedRef = useRef(false)
  const [planNoticeDismissed, setPlanNoticeDismissed] = useState(false)
  const drafts = useRef(new Map<string, ChatDraft>())
  const {
    sessions,
    activeChatId,
    activeSession,
    commitDraftChat,
    selectChat,
    enableUncensoredMode,
    renameChat,
    selectAndSetChatFolder,
    openChatFolder,
    deleteChat,
    updateSessionMessages,
    clearAllChats,
    importSessions
  } = useChatSessions()

  const [mainView, setMainView] = useState<NavigationView>('chat')
  const [installedPluginIds, setInstalledPluginIds] = useState<string[]>([])
  const [pluginsBusy, setPluginsBusy] = useState(true)
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null)
  const [extensionPage, setExtensionPage] = useState<ExtensionManagementPage>('all')
  const [extensionCatalog, setExtensionCatalog] = useState<ExtensionCatalog>(emptyExtensionCatalog)
  const [extensionsBusy, setExtensionsBusy] = useState(false)
  const [extensionsError, setExtensionsError] = useState('')
  const [draftChat, setDraftChat] = useState<import('./types/chat').ChatSession | null>(null)
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>('themes')
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [storageError, setStorageError] = useState(() => getStorageError())
  const [historyRevision, setHistoryRevision] = useState(0)
  const [searchTarget, setSearchTarget] = useState<{ chatId: string; messageId: string; sequence: number } | null>(null)

  const installedPlugins = useMemo(() => installedPluginIds.flatMap(id => {
    const plugin = plugins.find(item => item.id === id)
    return plugin ? [plugin] : []
  }), [installedPluginIds])
  const updateInstalledPlugin = async (id: string, installed: boolean) => {
    setPluginsBusy(true)
    try { setInstalledPluginIds(await window.api.plugins.setInstalled(id, installed)); return true }
    catch { reportStorageError('Не удалось сохранить список плагинов.'); return false }
    finally { setPluginsBusy(false) }
  }

  useEffect(() => {
    let active = true
    const bridge = window.api?.plugins
    if (!bridge) { reportStorageError('Сервис плагинов недоступен.'); setPluginsBusy(false); return () => { active = false } }
    void bridge.list(loadInstalledPlugins()).then(ids => { clearLegacyInstalledPlugins(); if (active) setInstalledPluginIds(ids) })
      .catch(() => { if (active) reportStorageError('Не удалось загрузить список плагинов.') })
      .finally(() => { if (active) setPluginsBusy(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const onStorageError = (event: Event): void => setStorageError((event as CustomEvent<string>).detail)
    window.addEventListener('zipply:storage-error', onStorageError)
    const current = getStorageError()
    if (current) setStorageError(current)
    return () => window.removeEventListener('zipply:storage-error', onStorageError)
  }, [])

  const { sidebarWidth, isResizing, startResizing, resetWidth } = useSidebarResize()

  // Apply stored theme on mount
  useEffect(() => {
    const current = loadSettings()
    applyTheme(current.theme, current.customTheme)
  }, [])

  const displayedSession = draftChat || activeSession
  const chatContextSession = useMemo(
    () => displayedSession,
    [displayedSession?.id, displayedSession?.folderPath, displayedSession?.uncensoredMode]
  )
  const refreshExtensions = useCallback(async (): Promise<void> => {
    const api = window.api?.extensions
    if (!api) { setExtensionsError('Каталог расширений недоступен.'); return }
    setExtensionsBusy(true)
    setExtensionsError('')
    try {
      setExtensionCatalog(await api.list(chatContextSession?.folderPath))
    } catch (error) {
      setExtensionsError(error instanceof Error ? error.message : 'Не удалось загрузить навыки и MCP-серверы.')
    } finally {
      setExtensionsBusy(false)
    }
  }, [chatContextSession?.folderPath])
  useEffect(() => { void refreshExtensions() }, [refreshExtensions])

  const extensionOptions = useMemo<ExtensionCommandOption[]>(() => [
    ...extensionCatalog.skills.filter(skill => skill.userInvocable).map(skill => ({
      ref: { kind: 'skill' as const, id: skill.id, label: extensionLabel(skill.name, 'Навык'), revision: skill.revision },
      description: skill.description,
      keywords: [skill.source, skill.scope, ...(skill.toolRefs ?? [])]
    })),
    ...installedPlugins.map(plugin => ({
      ref: { kind: 'plugin' as const, id: plugin.id, label: plugin.name },
      description: plugin.summary,
      keywords: plugin.capabilities.map(capability => capability.title)
    })),
    ...extensionCatalog.servers.map(server => ({
      ref: { kind: 'mcp_server' as const, id: server.id, label: server.id, revision: String(server.revision) },
      description: `${server.transport === 'stdio' ? 'stdio' : 'Streamable HTTP'} · ${server.state === 'connected' ? 'подключён' : 'подключится для этого сообщения'}`,
      keywords: ['mcp', server.transport]
    })),
    ...extensionCatalog.prompts.filter(prompt => prompt.name.length <= 256 && !/[\u0000-\u001f\u007f]/.test(prompt.name) && !prompt.arguments?.some(argument => argument.required)).map(prompt => ({
      ref: { kind: 'mcp_prompt' as const, id: `${prompt.serverId}:${prompt.name}`, serverId: prompt.serverId, promptName: prompt.name, label: extensionLabel(prompt.title || prompt.name, prompt.name) },
      description: prompt.description || `Промпт MCP-сервера ${prompt.serverId}`,
      keywords: ['mcp', prompt.serverId, ...(prompt.arguments ?? []).map(argument => argument.name)]
    })),
    ...extensionCatalog.resources.filter(resource => resource.uri.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(resource.uri)).map(resource => ({
      ref: { kind: 'mcp_resource' as const, id: mcpResourceRefId(resource.serverId, resource.uri), serverId: resource.serverId, uri: resource.uri, label: extensionLabel(resource.title || resource.name || resource.uri, resource.uri) },
      description: resource.description || `Ресурс MCP-сервера ${resource.serverId}`,
      keywords: ['mcp', resource.serverId, resource.mimeType || '']
    }))
  ], [extensionCatalog, installedPlugins])

  const addExtensionToDraft = useCallback((ref: ExtensionRef): void => {
    if (!isExtensionRef(ref)) { setExtensionsError('Это расширение нельзя прикрепить к сообщению. Обновите список и попробуйте ещё раз.'); return }
    const session = displayedSession
    if (!session) return
    const draft = drafts.current.get(session.id) ?? { value: '', files: [], planMode: false }
    const refs = (draft.extensionRefs ?? []).filter(item => !(item.kind === ref.kind && item.id === ref.id))
    refs.push(ref)
    drafts.current.set(session.id, { ...draft, extensionRefs: refs })
    setMainView('chat')
  }, [displayedSession])

  const updateMcp = useCallback(async (action: () => Promise<unknown>): Promise<void> => {
    setExtensionsBusy(true)
    setExtensionsError('')
    try {
      await action()
      const api = window.api?.extensions
      if (api) setExtensionCatalog(await api.list(chatContextSession?.folderPath))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось обновить MCP-настройки.'
      setExtensionsError(message)
      throw error instanceof Error ? error : new Error(message)
    } finally {
      setExtensionsBusy(false)
    }
  }, [chatContextSession?.folderPath])
  const chatSessions = draftChat ? [draftChat, ...sessions] : sessions
  const handleEnableUncensoredMode = useCallback((sessionId: string): void => {
    if (draftChat?.id === sessionId) {
      setDraftChat(current => current?.id === sessionId ? { ...current, uncensoredMode: true } : current)
      return
    }
    enableUncensoredMode(sessionId)
  }, [draftChat?.id, enableUncensoredMode])
  const handleEnableActiveUncensoredMode = useCallback(() => {
    if (displayedSession?.id) handleEnableUncensoredMode(displayedSession.id)
  }, [displayedSession?.id, handleEnableUncensoredMode])

  const { messages, isStreaming, sendMessage, sendMessageForSession, retry, cancelStream, discardChat, discardForHistoryReplacement, approval, question, uncensoredPrompt, approvalChatIds, generatingTitleChatIds, respondToApproval, respondToQuestion, respondToUncensoredPrompt } = useChat({
    activeSession: displayedSession,
    sessions: chatSessions,
    onUpdateSessionMessages: updateSessionMessages,
    onEnableUncensoredMode: handleEnableUncensoredMode,
    historyRevision
  })

  const wasStreamingRef = useRef(false)
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) void refreshExtensions()
    wasStreamingRef.current = isStreaming
  }, [isStreaming, refreshExtensions])

  const handleImportSessions = useCallback((imported: typeof sessions) => {
    if (!importSessions(imported)) return false
    drafts.current.clear()
    discardForHistoryReplacement()
    setHistoryRevision((previous) => previous + 1)
    return true
  }, [importSessions, discardForHistoryReplacement])

  const handleClearChats = useCallback(() => {
    if (!clearAllChats()) return
    drafts.current.clear()
    discardForHistoryReplacement()
    setHistoryRevision((previous) => previous + 1)
  }, [clearAllChats, discardForHistoryReplacement])

  const handleDeleteChat = useCallback((id: string) => {
    deleteChat(id, () => { drafts.current.delete(id); discardChat(id) })
  }, [deleteChat, discardChat])

  const handleCreateChat = useCallback((folderPath?: string) => {
    const session = createNewSession(undefined, folderPath)
    setDraftChat(session)
    void window.api?.workspace?.create(session.id, session.title, session.folderPath).then(result => {
      if (result?.success && result.folderPath) {
        setDraftChat(current => current?.id === session.id ? { ...current, folderPath: result.folderPath } : current)
      }
    }).catch(error => console.warn('[App] Failed to create workspace for new chat:', error))
    setMainView('chat')
  }, [])

  const freePlanAccepted = acceptedFreePlanWithoutIdentity || Boolean(
    freePlanConsentKey && (acceptedFreePlanKey === freePlanConsentKey || hasAcceptedFreePlan(freePlanConsentKey))
  )

  useEffect(() => {
    if (acceptedAccountKey.current === freePlanConsentKey) return
    acceptedAccountKey.current = freePlanConsentKey
    setAcceptedFreePlanKey(hasAcceptedFreePlan(freePlanConsentKey) ? freePlanConsentKey : null)
    setAcceptedFreePlanWithoutIdentity(false)
  }, [freePlanConsentKey])

  useEffect(() => {
    setPlanNoticeDismissed(false)
  }, [freePlanConsentKey, subscription.category, subscription.planCode])

  useEffect(() => {
    if (auth.status !== 'authenticated') {
      setFreePlanPromptOpen(false)
      pendingFreePlanAction.current = null
      plansOpenedRef.current = false
      return
    }
    if (subscription.category === 'free') return
    setFreePlanPromptOpen(false)
    plansOpenedRef.current = false
    const action = pendingFreePlanAction.current
    pendingFreePlanAction.current = null
    action?.()
  }, [auth.status, subscription.category])

  useEffect(() => {
    const refreshAfterPlansVisit = (): void => {
      if (!plansOpenedRef.current) return
      plansOpenedRef.current = false
      void refresh().catch(() => {})
    }
    window.addEventListener('focus', refreshAfterPlansVisit)
    return () => window.removeEventListener('focus', refreshAfterPlansVisit)
  }, [refresh])

  const requireFreePlanConfirmation = useCallback((action: () => void) => {
    if (subscription.category === 'free' && !freePlanAccepted) {
      pendingFreePlanAction.current = action
      setFreePlanPromptOpen(true)
      return
    }
    action()
  }, [freePlanAccepted, subscription.category])

  const sendMessageNow = useCallback((text: string, planMode: boolean, attachments: ImageAttachment[], extensionRefs: ExtensionRef[]) => {
    if (draftChat) {
      commitDraftChat(draftChat)
      setDraftChat(null)
      sendMessageForSession(draftChat, text, planMode, attachments, true, false, false, extensionRefs)
      return
    }
    sendMessage(text, planMode, attachments, extensionRefs)
  }, [draftChat, commitDraftChat, sendMessageForSession, sendMessage])

  const handleSendMessage = useCallback((text: string, planMode = false, attachments: ImageAttachment[] = [], extensionRefs: ExtensionRef[] = []) => {
    requireFreePlanConfirmation(() => sendMessageNow(text, planMode, attachments, extensionRefs))
  }, [requireFreePlanConfirmation, sendMessageNow])

  const handleContinueWithFree = useCallback(() => {
    if (freePlanConsentKey) {
      rememberFreePlanAcceptance(freePlanConsentKey)
      setAcceptedFreePlanKey(freePlanConsentKey)
    } else {
      setAcceptedFreePlanWithoutIdentity(true)
    }
    setPlanNoticeDismissed(false)
    setFreePlanPromptOpen(false)
    const action = pendingFreePlanAction.current
    pendingFreePlanAction.current = null
    action?.()
  }, [freePlanConsentKey])

  const handleOpenPlans = useCallback(() => {
    plansOpenedRef.current = true
  }, [])

  const handleRetry = useCallback(() => {
    requireFreePlanConfirmation(() => retry())
  }, [requireFreePlanConfirmation, retry])

  const planNoticeLabel = subscription.category === 'limited'
    ? subscription.label || 'Ваш тариф'
    : subscription.category === 'free' && freePlanAccepted
      ? 'Free'
      : null
  const planNotice = planNoticeLabel && !planNoticeDismissed
    ? { planLabel: planNoticeLabel, onDismiss: () => setPlanNoticeDismissed(true), onOpenPlans: handleOpenPlans }
    : null

  const handleManageExtensions = useCallback((page: ExtensionManagementPage): void => {
    setExtensionPage(page)
    setSelectedPluginId(null)
    setMainView('plugins')
    void refreshExtensions()
  }, [refreshExtensions])

  const handleSelectExtensionPage = useCallback((page: ExtensionManagementPage): void => {
    setExtensionPage(page)
    setSelectedPluginId(null)
  }, [])

  const handleSelectSidebarPlugin = useCallback((id: string): void => {
    setSelectedPluginId(id)
    setExtensionPage('plugins')
  }, [])

  // Global shortcut: Cmd/Ctrl + N
  useAppShortcuts({ onNewChat: handleCreateChat })

  const handleSelectChat = useCallback(
    (id: string) => {
      setDraftChat(null)
      selectChat(id)
      setSearchTarget(null)
      setMainView('chat')
    },
    [selectChat]
  )

  const handleSelectSearchResult = useCallback((chatId: string, messageId?: string) => {
    handleSelectChat(chatId)
    setSearchTarget(previous => messageId ? { chatId, messageId, sequence: (previous?.sequence || 0) + 1 } : null)
  }, [handleSelectChat])

  const handleSelectSettingsTab = useCallback((tab: SettingsTab) => {
    setActiveSettingsTab(tab)
    setMainView('settings')
  }, [])

  const handleToggleSidebar = useCallback(() => setIsSidebarOpen(previous => !previous), [])
  const handleNavigate = useCallback((view: NavigationView) => {
    if (view === 'plugins') { setSelectedPluginId(null); setExtensionPage('plugins'); void refreshExtensions() }
    setMainView(view)
  }, [refreshExtensions])
  const handleOpenSettings = useCallback((tab: SettingsTab = 'themes') => handleSelectSettingsTab(tab), [handleSelectSettingsTab])
  const handleBackToChat = useCallback(() => setMainView('chat'), [])

  const handleChangeActiveChatFolder = useCallback(() => {
    if (activeSession?.id) {
      selectAndSetChatFolder(activeSession.id)
    }
  }, [activeSession?.id, selectAndSetChatFolder])

  const handleOpenActiveChatFolder = useCallback(() => {
    if (activeSession?.folderPath) {
      openChatFolder(activeSession.folderPath)
    }
  }, [activeSession?.folderPath, openChatFolder])

  if (!authReady || (auth.status === 'authenticated' && !auth.subscriptionReady)) {
    return (
      <div className="flex flex-col h-screen w-screen bg-sidebar overflow-hidden select-none font-sans">
        <TitleBar isSidebarOpen={true} sidebarWidth={200} />
        <div className="flex-1 min-h-0 px-2 pb-2 flex">
          <div className="flex flex-1 items-center justify-center rounded-[18px] bg-canvas text-[15px] leading-[22px] text-secondary">
            Загружаем профиль и тариф…
          </div>
        </div>
      </div>
    )
  }

  if (auth.status !== 'authenticated') {
    return (
      <AuthScreen
        auth={auth}
        busy={authBusy}
        onLogin={login}
        onCancelLogin={cancelLogin}
      />
    )
  }

  return (
    <AppLayout
      isSidebarOpen={isSidebarOpen}
      sidebarWidth={sidebarWidth}
      isResizing={isResizing}
      onToggleSidebar={handleToggleSidebar}
      onCreateChat={handleCreateChat}
      startResizing={startResizing}
      resetWidth={resetWidth}
      mainView={mainView}
      onNavigate={handleNavigate}
      onOpenSettings={handleOpenSettings}
      activeSession={chatContextSession}
      onChangeFolder={handleChangeActiveChatFolder}
      onOpenFolder={handleOpenActiveChatFolder}
      sidebar={
        <Sidebar
          onCreateChat={handleCreateChat}
          sessions={sessions}
          activeChatId={activeChatId}
          approvalChatIds={approvalChatIds}
          generatingTitleChatIds={generatingTitleChatIds}
          onSelectChat={handleSelectChat}
          onSelectSearchResult={handleSelectSearchResult}
          onRenameChat={renameChat}
          onDeleteChat={handleDeleteChat}
          mainView={mainView === 'settings' ? 'settings' : mainView === 'plugins' ? 'plugins' : 'chat'}
          extensionPage={extensionPage}
          installedPlugins={installedPlugins}
          selectedPluginId={selectedPluginId}
          activeSettingsTab={activeSettingsTab}
          onSelectSettingsTab={handleSelectSettingsTab}
          onSelectExtensionPage={handleSelectExtensionPage}
          onSelectPlugin={handleSelectSidebarPlugin}
          onBackToChat={handleBackToChat}
          updateAvailable={sidebarUpdate}
          onOpenUpdateDownload={() => { void openDownload() }}
          onDismissUpdate={() => {
            if (updateState.latestVersion) setDismissedUpdateVersion(updateState.latestVersion)
          }}
        />
      }
    >
      {freePlanPromptOpen && <FreePlanPrompt onContinue={handleContinueWithFree} onOpenPlans={handleOpenPlans} />}
      {uncensoredPrompt && <UncensoredModeConfirm
        key={uncensoredPrompt.promptId}
        chatTitle={chatSessions.find(session => session.id === uncensoredPrompt.sessionId)?.title || 'Новый чат'}
        onContinue={() => respondToUncensoredPrompt(uncensoredPrompt, false)}
        onEnable={() => respondToUncensoredPrompt(uncensoredPrompt, true)}
      />}
      {storageError && <div role="alert" className="absolute top-4 left-1/2 -translate-x-1/2 z-50 w-[min(90%,640px)] rounded-[20px] bg-control p-4 text-[15px] leading-[22px] text-primary border-none shadow-none"><span>{storageError}</span><button type="button" onClick={() => setStorageError('')} className="ml-3 rounded-full px-3 py-1 bg-control-hover text-primary border-none shadow-none">Закрыть</button></div>}
      {mainView === 'settings' ? (
        <MainSettingsView
          activeTab={activeSettingsTab}
          onClose={() => setMainView('chat')}
          sessions={sessions}
          onClearChats={handleClearChats}
          onImportChats={handleImportSessions}
          updateState={updateState}
          onCheckUpdates={() => { void checkUpdates() }}
          onOpenUpdateDownload={() => { void openDownload() }}
        />
      ) : mainView === 'schedules' ? (
        <main className="flex h-full w-full flex-col items-center justify-center bg-canvas px-6 text-center">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-surface text-secondary"><Clock3 size={25} strokeWidth={1.6} aria-hidden="true" /></div>
          <h1 className="text-[22px] font-semibold text-primary">Запланировано</h1>
          <p className="mt-2 text-[15px] leading-[22px] text-secondary">Скоро появится</p>
        </main>
      ) : mainView === 'plugins' ? (
        <ExtensionsManagementView
          page={extensionPage}
          onPageChange={handleSelectExtensionPage}
          plugins={plugins}
          installedPluginIds={installedPluginIds}
          selectedPluginId={selectedPluginId}
          pluginBusy={pluginsBusy}
          onInstallPlugin={id => { if (!installedPluginIds.includes(id)) void updateInstalledPlugin(id, true) }}
          onRemovePlugin={id => { void updateInstalledPlugin(id, false).then(success => { if (success) setSelectedPluginId(null) }) }}
          onSelectPlugin={setSelectedPluginId}
          onUsePlugin={plugin => addExtensionToDraft({ kind: 'plugin', id: plugin.id, label: plugin.name })}
          skills={extensionCatalog.skills}
          servers={extensionCatalog.servers}
          tools={extensionCatalog.tools}
          resources={extensionCatalog.resources}
          prompts={extensionCatalog.prompts}
          trustedTools={extensionCatalog.trustedMcpTools}
          busy={extensionsBusy}
          error={extensionsError}
          onRefresh={() => { void refreshExtensions() }}
          onImportSkill={() => updateMcp(async () => { await window.api.extensions.importSkill() })}
          onSelectSkill={skill => addExtensionToDraft({ kind: 'skill', id: skill.id, label: skill.name, revision: skill.revision })}
          onAddServer={(definition, auth) => updateMcp(() => window.api.mcp.addServer(definition, auth))}
          onSetServerAuth={(serverId, headerName, headerValue) => updateMcp(() => window.api.mcp.setAuth(serverId, headerName, headerValue))}
          onConnectServer={serverId => updateMcp(() => window.api.mcp.connect(serverId))}
          onDisconnectServer={serverId => updateMcp(() => window.api.mcp.disconnect(serverId))}
          onRemoveServer={serverId => updateMcp(() => window.api.mcp.removeServer(serverId))}
          onSelectServer={server => addExtensionToDraft({ kind: 'mcp_server', id: server.id, label: server.id, revision: String(server.revision ?? 0) })}
          onRevokeToolTrust={(serverId, toolId) => updateMcp(() => window.api.mcp.revokeToolTrust(serverId, toolId))}
          onSelectResource={resource => addExtensionToDraft({ kind: 'mcp_resource', id: mcpResourceRefId(resource.serverId, resource.uri), serverId: resource.serverId, uri: resource.uri, label: extensionLabel(resource.title || resource.name || resource.uri, resource.uri) })}
          onSelectPrompt={(prompt, args) => addExtensionToDraft({ kind: 'mcp_prompt', id: `${prompt.serverId}:${prompt.name}`, serverId: prompt.serverId, promptName: prompt.name, label: extensionLabel(prompt.title || prompt.name, prompt.name), arguments: Object.fromEntries(Object.entries(args).filter(([, value]) => value.trim())) })}
        />
      ) : (
        <ChatCanvas
          drafts={drafts.current}
          messages={messages}
          searchTarget={searchTarget?.chatId === activeChatId ? searchTarget : null}
          activeSession={chatContextSession}
          uncensoredMode={displayedSession?.uncensoredMode === true}
          onEnableUncensoredMode={displayedSession ? handleEnableActiveUncensoredMode : undefined}
          onChangeFolder={handleChangeActiveChatFolder}
          onOpenFolder={handleOpenActiveChatFolder}
          onSendMessage={handleSendMessage}
          extensionOptions={extensionOptions}
          onManageExtensions={handleManageExtensions}
          isStreaming={isStreaming}
          onCancelStream={cancelStream}
          approval={approval}
          onApproval={respondToApproval}
          question={question}
          onAnswer={respondToQuestion}
          onRetry={handleRetry}
          planNotice={planNotice}
        />
      )}
    </AppLayout>
  )
}

export default App

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { transformSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

function renderApp({ settings = false, clearSuccess = true, deleteSuccess = true } = {}) {
  const captured = { discarded: 0, deletedRuns: [], sessions: [{ id: 'first', title: 'First', messages: [] }, { id: 'second', title: 'Second', messages: [] }] }
  const component = (name) => function Component(props) {
    captured[name] = props
    return name === 'layout' ? React.createElement(React.Fragment, null, props.sidebar, props.children) : null
  }
  const mocks = {
    react: { ...React, useState: initial => React.useState(settings && initial === 'chat' ? 'settings' : initial) },
    './components/sidebar': { Sidebar: component('sidebar') },
    './components/settings': { MainSettingsView: component('settings') },
    './components/layout': { AppLayout: component('layout') },
    './components/chat': { ChatCanvas: component('canvas'), UncensoredModeConfirm: component('uncensoredConfirm') },
    './components/plugins/PluginLibrary': { PluginLibrary: component('plugins'), plugins: [] },
    './components/plugins/PluginDetails': { PluginDetails: component('pluginDetails') },
    './services/pluginStorage': { clearLegacyInstalledPlugins() {}, loadInstalledPlugins: () => [] },
    './services/settingsService': { applyTheme() {}, loadSettings: () => ({ theme: 'dark' }) },
    './services/chatStorageService': { getStorageError: () => '' },
    './services/schedules': { loadSchedules: () => [], saveSchedules: () => true, claimDueSchedules: tasks => ({ tasks, due: [] }) },
    './hooks/useChatSessions': { useChatSessions: () => ({
      sessions: captured.sessions, activeChatId: 'first', activeSession: captured.sessions[0],
      createChat() {}, selectChat() {}, renameChat() {}, selectAndSetChatFolder() {}, openChatFolder() {}, deleteChat(_id, onDeleted) { if (deleteSuccess) onDeleted() }, updateSessionMessages() {},
      clearAllChats: () => clearSuccess, importSessions: () => false
    }) },
    './hooks/useChat': { useChat: props => { captured.chatProps = props; return {
      messages: [], isStreaming: false, sendMessage() {}, cancelStream() {},
      discardChat(id) { captured.deletedRuns.push(id) }, discardForHistoryReplacement() { captured.discarded++ }, approval: null, approvalChatIds: ['second'], respondToApproval() {}
    } } },
    './hooks/useSidebarResize': { useSidebarResize: () => ({ sidebarWidth: 200, isResizing: false, startResizing() {}, resetWidth() {} }) },
    './hooks/useAppShortcuts': { useAppShortcuts() {} },
    './hooks/useAuth': { useAuth: () => ({ auth: { status: 'authenticated', profile: null, avatarDataUrl: null, usage: null, history: null, error: null, scope: null }, ready: true, busy: false, login() {}, cancelLogin() {}, refresh() {}, logout() {} }) },
    './components/auth/AuthScreen': { AuthScreen: component('authScreen') },
    './components/TitleBar': { TitleBar: component('titleBar') }
  }
  const file = path.resolve('src/renderer/src/App.tsx')
  const code = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'tsx', format: 'cjs' }).code
  const previous = Module._load
  const mod = new Module(file, module)
  mod.filename = file; mod.paths = module.paths
  try {
    Module._load = function (id, ...args) { return Object.hasOwn(mocks, id) ? mocks[id] : previous.call(this, id, ...args) }
    mod._compile(code, file)
    renderToStaticMarkup(React.createElement(mod.exports.App))
  } finally { Module._load = previous }
  return captured
}

test('App connects every live session and background approval indicators', () => {
  const captured = renderApp()
  assert.deepEqual(captured.chatProps.sessions, captured.sessions)
  assert.deepEqual(captured.sidebar.approvalChatIds, ['second'])
})

test('App discards background requests only after history was cleared successfully', () => {
  const failed = renderApp({ settings: true, clearSuccess: false })
  failed.settings.onClearChats()
  assert.equal(failed.discarded, 0)
  const succeeded = renderApp({ settings: true, clearSuccess: true })
  succeeded.settings.onClearChats()
  assert.equal(succeeded.discarded, 1)
})

test('App cancels only the chat whose deletion succeeds', () => {
  const failed = renderApp({ deleteSuccess: false })
  failed.sidebar.onDeleteChat('second')
  assert.deepEqual(failed.deletedRuns, [])
  const succeeded = renderApp({ deleteSuccess: true })
  succeeded.sidebar.onDeleteChat('second')
  assert.deepEqual(succeeded.deletedRuns, ['second'])
})

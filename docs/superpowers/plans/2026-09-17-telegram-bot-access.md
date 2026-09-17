# Telegram Bot Remote Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a self-hosted Telegram Bot inside Zipply (Electron Main Process) with remote agent execution, dynamic inline buttons, history inspection, and a dedicated 'Доступ' section in Settings.

**Architecture:** A native-fetch long-polling `TelegramBotService` in the Electron main process interacts with `AgentRunner` and `LocalStorageService`, exposed via IPC and preload to a dedicated `AccessSettings` component in the React renderer.

**Tech Stack:** Electron 33, TypeScript, React 18, Vite, Telegram Bot API (HTTPS Long Polling), Lucide Icons.

**Spec:** `docs/superpowers/specs/2026-09-17-telegram-bot-access-design.md`

## Global Constraints

- Zero external npm dependencies added: use native `fetch` available in Electron 33 / Node 20+.
- All settings must persist in `LocalStorageService.getStore('telegram_config')`.
- Cross-platform compatibility: Windows, Linux (AppImage/deb/xbps), macOS.
- Strict security: whitelist filtering for Telegram User IDs / usernames.
- In Settings, the 'Доступ' tab must only present the Telegram Bot integration as requested.

---

### Task 1: Implement `TelegramBotService` in Main Process

**Files:**
- Create: `src/main/services/TelegramBotService.ts`
- Test: `scripts/test-telegram-service.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface TelegramConfig {
    token: string
    enabled: boolean
    allowedUsers: string[]
    autoStart: boolean
    defaultWorkspace?: string
  }

  export interface TelegramBotStatus {
    status: 'stopped' | 'starting' | 'running' | 'error'
    botInfo?: { id: number; username: string; firstName: string }
    error?: string
    lastActiveAt?: string
  }

  export class TelegramBotService {
    static init(): Promise<void>
    static getConfig(): TelegramConfig
    static saveConfig(config: Partial<TelegramConfig>): Promise<TelegramConfig>
    static getStatus(): TelegramBotStatus
    static start(): Promise<TelegramBotStatus>
    static stop(): Promise<void>
    static testToken(token: string): Promise<{ valid: boolean; botInfo?: any; error?: string }>
  }
  ```

- [ ] **Step 1: Write unit test script for `TelegramBotService`**
  Create `scripts/test-telegram-service.ts` to test token validation, user authorization filtering, markdown escaping, and command routing.

- [ ] **Step 2: Run test script to verify failure prior to implementation**
  Run: `npx tsx scripts/test-telegram-service.ts`
  Expected: FAIL with module not found.

- [ ] **Step 3: Implement `TelegramBotService.ts`**
  - Implement Telegram API client methods (`getMe`, `getUpdates`, `sendMessage`, `editMessageText`, `editMessageReplyMarkup`, `answerCallbackQuery`, `sendChatAction`).
  - Implement polling loop with backoff and AbortController.
  - Implement security whitelist verification for `from.id` and `from.username`.
  - Implement commands (`/start`, `/help`, `/newchat`, `/projects`, `/history`, `/stop`, `/status`).
  - Implement message agent runner invocation with `runAgent('zipply', history, config, onEvent, abortSignal)`.
  - Implement dynamic inline keyboard with real-time update and button consumption.
  - Persist conversation turns into `LocalStorageService.getStore('chats')`.

- [ ] **Step 4: Run test script to verify it passes**
  Run: `npx tsx scripts/test-telegram-service.ts`
  Expected: PASS.

---

### Task 2: Wire IPC Handlers in Main Process & Preload

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: `TelegramBotService`
- Produces: `window.api.telegram` in renderer

- [ ] **Step 1: Add IPC handlers in `src/main/index.ts`**
  Register:
  - `telegram:getConfig`
  - `telegram:saveConfig`
  - `telegram:start`
  - `telegram:stop`
  - `telegram:getStatus`
  - `telegram:testToken`
  Call `TelegramBotService.init()` in `app.whenReady()` to support autostart.
  Call `TelegramBotService.stop()` on app quit.

- [ ] **Step 2: Expose `api.telegram` in `src/preload/index.ts`**
  Add `telegram` object with typed invoke calls and status event subscription.

---

### Task 3: Update Settings Types and Navigation Components

**Files:**
- Modify: `src/renderer/src/types/settings.ts`
- Modify: `src/renderer/src/components/Sidebar.tsx`
- Modify: `src/renderer/src/components/TitleBar.tsx`
- Modify: `src/renderer/src/components/settings/SettingsView.tsx`

**Interfaces:**
- Extends: `SettingsTab = 'models' | 'mcp' | 'appearance' | 'shortcuts' | 'storage' | 'access'`
- Adds: `SETTINGS_TAB_NAMES.access = 'Доступ'`

- [ ] **Step 1: Update `src/renderer/src/types/settings.ts`**
  Add `'access'` to `SettingsTab` union and define `TelegramConfig` interface.

- [ ] **Step 2: Update `Sidebar.tsx`**
  Add `{ id: 'access', label: 'Доступ', icon: <Bot size={17} strokeWidth={1.8} /> }` to `settingsCategories`.

- [ ] **Step 3: Update `TitleBar.tsx`**
  Add `access: 'Доступ'` to `SETTINGS_TAB_NAMES`.

- [ ] **Step 4: Update `SettingsView.tsx`**
  Import and render `<AccessSettings />` when `activeTab === 'access'`.

---

### Task 4: Implement `AccessSettings.tsx` and `AccessSettings.css`

**Files:**
- Create: `src/renderer/src/components/settings/AccessSettings.tsx`
- Create: `src/renderer/src/components/settings/AccessSettings.css`

- [ ] **Step 1: Implement `AccessSettings.tsx`**
  - Exclusively display Telegram Bot configuration.
  - Status card with badge (Online / Connecting / Offline / Error).
  - Enable / Disable switch button.
  - Test token button.
  - Password-masked token input with reveal button.
  - Allowed Telegram IDs input with explanation and copy ID hint.
  - Autostart toggle.
  - Default project folder dropdown.
  - Quick instructions card for BotFather.

- [ ] **Step 2: Implement `AccessSettings.css`**
  Theme-consistent CSS matching Zipply's dark UI, sleek gradients, status badges, and responsive form controls.

---

### Task 5: End-to-End Verification & Typecheck

**Files:**
- Verify: whole project

- [ ] **Step 1: Run TypeScript typecheck**
  Run: `npm run typecheck`
  Expected: Clean exit code 0 without type errors.

- [ ] **Step 2: Verify desktop UI and bot integration**
  Verify that opening Settings -> 'Доступ' displays only the Telegram-бот view, inputs work, toggle works, and status updates.

# Classifier-driven uncensored visual mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the configured classifier offer a one-way, visual-only uncensored mode for a chat before an eligible response starts.

**Architecture:** Run the existing non-streaming classifier from `AgentRunner` before the normal model call, and reuse the existing `askUser` question flow for consent. Persist an optional `uncensoredMode` flag on each chat session; acceptance or the composer switch sets it to true, and no path sets it back to false. The configured provider model remains unchanged.

**Tech Stack:** TypeScript, React, Electron IPC, existing `ChatService.classify` helper and chat-session storage.

**Spec:** `docs/superpowers/specs/2026-11-06-uncensored-classifier-design.md`

## Global Constraints

- The uncensored mode is visual only; do not change provider model, system prompt, or response behavior.
- The mode belongs to one chat and is one-way; once true, it cannot become false.
- Use the existing `classifierModel`, API key, and Base URL; if classification is unavailable or unclear, continue the normal response without prompting.
- Classify only the latest user text, not full history or attachments.
- Do not add or run tests for this task; use `npm run typecheck` for compile verification.
- Follow `AGENTS.md`: no control borders, focus glow, or shadows; use rounded controls and accessible labels/disabled state.

## Review Focus

- Empty or invalid classifier output must fail open to the normal response; check the classifier helper's strict response parser and the catch path in `AgentRunner`.
- A classifier API error must not abort the chat; inspect that the exception is contained before the normal generation loop.
- Accepting the prompt must persist uncensored mode for the correct session; trace the request ID to its `ChatRuntime.sessionId` and the session update callback.
- Declining the prompt must leave the mode false and continue the same user request; inspect the answer comparison and that the agent does not restart or drop history.
- A restored legacy session without `uncensoredMode` must behave as false, while a true session cannot be disabled; check defaults, validation, and the disabled composer switch.

---

## File Map

- `src/renderer/src/types/chat.ts`: optional persisted `ChatSession.uncensoredMode` flag.
- `src/shared/chatValidation.ts`: validate the optional flag without rejecting old sessions.
- `src/renderer/src/hooks/useChatSessions.ts`: persist one-way enablement for committed sessions.
- `src/renderer/src/App.tsx`: apply enablement to either the current draft or a committed session, and provide the latest session state to `useChat`.
- `src/renderer/src/components/chat/ChatCanvas.tsx`, `src/renderer/src/components/chat-input/ChatInput.tsx`, `src/renderer/src/components/chat-input/ChatActionRow.tsx`, and `src/renderer/src/components/mode-selector/*`: bind the existing switch to the active chat and make it one-way.
- `src/main/agent/services/UncensoredModeClassifier.ts` (new): classify a single user message using the configured classifier and a strict result format.
- `src/main/agent/services/ChatService.ts`: type the visual-mode flags on `ChatConfig`.
- `src/main/agent/core/AgentRunner.ts`: ask for consent before the main response only when the classifier recommends uncensored and the chat is still regular.
- `src/shared/agentEvents.ts`: add the typed event emitted after user acceptance.
- `src/renderer/src/hooks/useChat.ts`: pass the session flag to the agent, skip reclassification for retries, and persist the acceptance event to the matching session.

## Task 1: Persist and bind the one-way visual mode

**Files:**
- Modify: `src/renderer/src/types/chat.ts`
- Modify: `src/shared/chatValidation.ts`
- Modify: `src/renderer/src/hooks/useChatSessions.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/chat/ChatCanvas.tsx`
- Modify: `src/renderer/src/components/chat-input/ChatInput.tsx`
- Modify: `src/renderer/src/components/chat-input/ChatActionRow.tsx`
- Modify: `src/renderer/src/components/mode-selector/types.ts`
- Modify: `src/renderer/src/components/mode-selector/ModeSelector.tsx`
- Modify: `src/renderer/src/components/mode-selector/ModePopover.tsx`

**Interfaces:**
- `ChatSession.uncensoredMode?: boolean`; missing means false.
- `useChatSessions.enableUncensoredMode(sessionId: string): void`; it only writes `true`, persists the session, and leaves other session fields/messages intact.
- `ModeSelectorProps` gains `uncensoredMode?: boolean` and `onEnableUncensoredMode?: () => void`; it never exposes a path to set false.

- [x] **Step 1: Add the optional session flag and one-way persistence method.** Validate `uncensoredMode` only when present, default missing values to false, and update both app storage and the session backup when enabling a committed session.
- [x] **Step 2: Bind the composer switch to the displayed chat.** Thread `uncensoredMode` and `onEnableUncensoredMode` through `App` → `ChatCanvas` → `ChatInput` → `ChatActionRow` → `ModeSelector`; update draft state when the displayed chat has not yet been committed.
- [x] **Step 3: Make the switch one-way and accessible.** When false, allow enabling; when true, show it checked and disabled with a title/accessible description that it stays enabled for this chat. Keep existing red/orange visual treatment.
- [x] **Step 4: Run `npm run typecheck:web`.** Expected: exit code 0.

## Task 2: Classify the latest user message and ask before enabling

**Files:**
- Create: `src/main/agent/services/UncensoredModeClassifier.ts`
- Modify: `src/main/agent/services/ChatService.ts`
- Modify: `src/main/agent/core/AgentRunner.ts`
- Modify: `src/shared/agentEvents.ts`

**Interfaces:**
- `classifyUncensoredRequest(config: ChatConfig, message: string, abortSignal?: AbortSignal): Promise<'uncensored' | 'regular' | null>`; `null` means unconfigured or unclear output.
- The classifier accepts exactly `UNCENSORED` or `REGULAR` (case-insensitive, trimmed) from the configured classifier; any other text is unclear.
- Add `ChatConfig.uncensoredMode?: boolean` and `ChatConfig.classifyUncensoredMode?: boolean`.
- Add `{ type: 'uncensored_mode_enabled'; requestId?: string }` to `AgentEvent`.

- [x] **Step 1: Add the classifier helper.** Send only the latest user text, ask whether it is centered on cybersecurity, vulnerability discovery/testing, penetration testing, or hacking, request one exact label, and return `null` for missing configuration or unrecognized output.
- [x] **Step 2: Add the typed mode event.** Define `uncensored_mode_enabled` in `AgentEvent`; it carries no model ID or message content.
- [x] **Step 3: Add the consent branch before normal generation in `AgentRunner.run`.** Skip when `uncensoredMode === true` or `classifyUncensoredMode === false`; on classifier errors or `regular`/`null`, continue normally. On `uncensored`, use `config.askUser` with options `Включить uncensored в этом чате (только визуально)` and `Продолжить в обычном режиме`; if the first exact option is selected, emit `uncensored_mode_enabled`. In all cases, leave `config.model` unchanged and continue the same request.
- [x] **Step 4: Run `npm run typecheck:node`.** Expected: exit code 0.

## Task 3: Connect runtime events to chat-session state

**Files:**
- Modify: `src/renderer/src/hooks/useChat.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/hooks/useChatSessions.ts`

**Interfaces:**
- `useChat` gains `onEnableUncensoredMode?: (sessionId: string) => void`.
- Initial sends pass `uncensoredMode: session.uncensoredMode === true`; retries pass the same flag and `classifyUncensoredMode: false`.

- [x] **Step 1: Pass per-session state into every initial chat request.** Add the boolean to the config built by `sendMessageForSession`; do not add an uncensored model ID or change `model`.
- [x] **Step 2: Handle mode acceptance separately from message blocks.** In the `agent:event` listener, map `uncensored_mode_enabled` through the request's runtime session ID to the latest `onEnableUncensoredMode` callback, then return without appending an assistant block.
- [x] **Step 3: Persist acceptance for the right chat and draft.** Wire the callback through `App`; route committed sessions to `enableUncensoredMode` and update `draftChat` directly when IDs match.
- [x] **Step 4: Prevent retry prompts while allowing new messages to classify.** Mark retry configs `classifyUncensoredMode: false`; initial user sends classify unless the session is already uncensored.
- [x] **Step 5: Run `npm run typecheck`.** Expected: exit code 0 for both Node and renderer projects.

## Manual review checklist

- In a regular chat with a configured classifier, an uncensored-category result pauses before the answer and presents explicit choices; accepting enables the visual mode, declining continues normally.
- An unconfigured classifier, API error, ambiguous output, or ordinary result produces a normal response without a prompt.
- Manually enabling the switch or accepting the prompt updates only the current chat; switching chats and restarting preserves each chat's state.
- An already uncensored chat keeps its mode and presents no path to disable it; the provider model remains the configured regular model in all cases.
- A retry does not repeat the classifier prompt.

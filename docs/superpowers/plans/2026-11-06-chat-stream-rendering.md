# Плавный стриминг ответа — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make streamed answers update smoothly without repeatedly parsing completed Markdown or repainting a sweeping status gradient.

**Architecture:** Keep provider events and the existing `requestAnimationFrame` batching unchanged. Cache completed Markdown output per streamed text block and update only the mutable tail; memoize expensive unchanged chat siblings so the root stream update does not rerender the sidebar, composer, and workspace. Render active statuses as static neutral text.

**Tech Stack:** React 18, TypeScript, Electron renderer, CSS, existing Node test suite.

**Spec:** `docs/superpowers/specs/2026-11-06-chat-stream-rendering-design.md`

## Global Constraints

- Do not add dependencies or delay provider token events.
- Preserve current final Markdown formatting, live text updates, manual-scroll behavior, auto-scroll, and cancellation.
- Keep active status text monochrome and static; no gradient sweep, glow, or shadow.
- Reset stream-render caches when a message is replaced, retried, restored, or stops being an append-only stream.

## Review Focus

- An open fenced code block must keep appending raw code, then receive the normal final syntax highlighting once closed (`tests/code-stream-performance.test.cjs`).
- Partial `<think>` and `<thought>` markers must not leak into visible text or corrupt cached output (`tests/think-stream.test.cjs`).
- A table header must remain provisional until its divider arrives, and list groups must preserve spacing and order (`tests/agent.test.cjs`).
- Running activity labels must remain readable and stable while showing no frame-to-frame sweep (`tests/e2e/shining-tools.test.cjs`, `tests/e2e/shining-text.test.cjs`).
- When the user scrolls above the bottom, incoming text must not pull the viewport back down (`tests/e2e/chat-height.test.cjs`).

---

### Task 1: Remove the repaint-heavy status sweep

**Files:**
- Modify: `src/renderer/src/assets/main.css`
- Modify: `tests/e2e/shining-tools.test.cjs`
- Modify: `tests/e2e/shining-text.test.cjs`

**Interfaces:**
- Keep the current `shining-text` class and `data-shining-text` marker so existing status selectors remain stable.
- Change only the active visual treatment: the class resolves to static secondary text and has no animation.

- [x] Replace the gradient/background-position animation with static neutral text styling and remove its keyframes.
- [x] Update the existing E2E assertions to expect no animation or gradient while still checking that active labels stay visible.
- [x] Keep status text on the existing secondary text token for all themes.

### Task 2: Cache completed streamed Markdown

**Files:**
- Modify: `src/renderer/src/components/chat/MarkdownRenderer.tsx`
- Modify: `src/renderer/src/components/ChatMessageItem.tsx`
- Modify: `src/renderer/src/components/chat/CodeBlock.tsx`

**Interfaces:**
- Keep `MarkdownRenderer({ content, isStreaming })` and its exported default/named exports unchanged.
- Add an internal per-instance streaming cache. It retains rendered output through the last stable Markdown boundary and returns the active tail separately for each update.
- Invalidate the cache when content ceases to be an append of the previous content or when streaming finishes.

- [x] Extract stable-boundary detection for paragraphs, lists, quotes, tables, and fenced code; keep ambiguous table headers and open fences in the mutable tail, with thought-tag segmentation cached separately.
- [x] Render completed content from the cache and parse only the mutable tail; keep the streaming cursor on that tail only.
- [x] Finalize closed code blocks once and render open streamed fences without re-splitting the full block.
- [x] Memoize `CodeBlock` so previously completed code blocks do not rerender when the tail changes.
- [x] Preserve the non-streaming Markdown path and `parseTextAndThoughts` behavior for incomplete thought markers.

### Task 3: Keep unchanged chat surfaces out of token updates

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/hooks/useChat.ts`
- Modify: `src/renderer/src/components/chat/ChatCanvas.tsx`
- Modify: `src/renderer/src/components/chat-input/ChatInput.tsx`
- Modify: `src/renderer/src/components/sidebar/Sidebar.tsx`
- Modify: `src/renderer/src/components/layout/WorkspacePanel.tsx`
- Modify: `src/renderer/src/components/TitleBar.tsx`
- Modify: `src/renderer/src/components/layout/NavigationRail.tsx`

**Interfaces:**
- Keep the current props and behavior of each surface.
- Keep `useChat` event application and checkpoint semantics unchanged; only stabilize derived status lists between status changes.

- [x] Memoize the composer, sidebar, workspace panel, title bar, and navigation rail so they skip renders when their visible props have not changed.
- [x] Stabilize `approvalChatIds`, `generatingTitleChatIds`, installed plugin lists, and callbacks passed from `App` and `ChatCanvas` so React memoization can hold during token updates.
- [x] Leave `MessageFeed` and the active assistant item subscribed to the changing message snapshot.
- [x] Keep the active message subscribed to changing content while stable sibling props retain their references during token updates.

### Task 4: Compile and review stream behavior

**Files:**
- Verify: all modified renderer files.

- [x] Run `npm run typecheck` and resolve any renderer type errors.
- [ ] Exercise a live long response and compare its final render with the static Markdown path.
- [ ] Exercise a running tool status and a scrolled-up chat to inspect live streaming and manual scroll preservation.

Automated tests are not added or run as part of this plan unless explicitly requested; the existing UI assertions are updated only where their expected animation behavior changes.

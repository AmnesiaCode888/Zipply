# План доработки и внедрения харнеса Zipply (P0 → P1 → P2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Цель.** Устранить разрывы надёжности coding-харнеса Zipply до уровня Codex: исключить выполнение инструментов после оборванного или `incomplete` ответа провайдера, убрать ложный `verified`, изолировать процессы агента OS-sandbox'ом, подгружать вложенные `AGENTS.md` до записи в файлы (включая текстовый `apply_patch`), починить дерево субагентов (роли в prompt pipeline и единый бюджет/дедлайн), прогнать все регрессии через единый `runAgent` в headless CLI и затем построить поверх журнала операций в main возобновление (`thread/resume`), коррекции на лету (`turn/steer`), предсказуемые инструменты, точный учёт контекста и Playwright-проверку UI.

**Архитектура.** Electron IPC (`AgentIpcHandler`) и headless CLI (`src/main/agent/cli.ts`) вызывают один и тот же `runAgent` (`src/main/agent/index.ts`). В **P0** закрываются базовые инварианты исполнения: статусы потока провайдера (`ChatService`), привязка доказательств проверки к критерию и SHA‑256 (`VerificationEvidence` + `verify_file`), пре-загрузка вложенных правил до мутаций, OS-sandbox (`ProcessSandbox`) для AI-команд и LSP отдельно от терминала пользователя, общий `RunBudget` и доставка ролей субагентов через `SystemPromptPipeline`. В **P1** добавляются долговечный журнал операций в main, `resume`/`steer`, разделение опроса и ввода в stdin, версионируемый кеш чтений, модельный лимит контекста с подсчётом вложений после разворачивания и Playwright-проверка. В **P2** проводится сравнительный бенчмарк из 30 реальных задач против Codex.

**Стек.** TypeScript 5.9, Electron 33, Node `node:test`, `esbuild`, `playwright-core` (уже в `devDependencies`), `node-pty` / `child_process.spawn`, существующие `SystemPromptPipeline`, `ProjectRulesLoader`, `TerminalSessionManager`, `ApplyPatchTool`.

**Основание.** Аудит кодовой базы от 24.11.2026 (подтверждены: `AgentRunner.ts:45, 545-614, 703-733`, `ChatService.ts:647-1040`, `ToolExecutor.ts:339-430`, `TerminalSessionManager.ts:381-535`, `SpawnAgentTool.ts:100-191`, `WriteStdinTool.ts:50-52`, `useChat.ts:919-1089`, `settingsService.ts:42-94`, `ContextIndicator.tsx:17-20`, `ContextCompactor.ts:234-262`).

---

## Global Constraints

- **Единый runtime:** Electron (`src/main/ipc/AgentIpcHandler.ts`) и headless CLI (`src/main/agent/cli.ts`) обязаны вызывать один и тот же `runAgent` из `src/main/agent/index.ts`.
- **KV-cache стабильность:** Не мутировать `messages[0]` (`system` / `developer`) в середине запуска; вложенные правила `AGENTS.md`, `taskState`, поправки пользователя и reminders инжектируются только в хвост (`runtime_dynamic` / `<system_reminder>`).
- **Обратная совместимость:** Сохранять совместимость с существующими форматами `AgentTaskState` (`acceptanceCriteria: string[]` в wire/checkpoint контрактах для `tests/agent-task-state.test.cjs`), старыми именами инструментов (`terminal`, `run_command`, `process_*`), обоими форматами `apply_patch` (`patch` и `operations`) и подписчиками IPC.
- **Безопасность fail-closed:** В профилях `read-only` и `workspace-write` при отказе инициализации OS-sandbox запрещено молча запускать процесс с правами приложения; допустим только явный отказ или одноразовая эскалация через `confirmAction`. Интерактивный терминал пользователя (`origin: 'user'`) остаётся отдельным и не ограничивается AI-sandbox'ом.
- **Дизайн-система (`AGENTS.md`):** Любые изменения UI в P1 строго без теней (`shadow-none`), без резких белых рамок и focus-подсветки (`border-none` или статичный `border-[0.5px] border-white/[0.03]`), со скруглениями Apple-scale и монохромной палитрой Obsidian.
- **Кроссплатформенность и тесты:** P0-сценарии должны работать на Windows и Linux с имитацией провайдера и временным workspace; перед закрытием каждой задачи прогонять `npm run typecheck` и профильные `node --test`.

---

## Verified Audit Summary (подтверждённые факты и дополнительные находки)

1. **Ложный `verified` (`AgentRunner.ts:45-56, 90-105, 468-496, 609-614`):** `read_file` и `read_files` добавляют записи в `checks`, а `checkCoversCriterion` засчитывает их по совпадению слов. Последующие `write_file` / `edit_file` / `apply_patch` не инвалидируют старые проверки. В тестах `AgentTaskState` (`tests/agent-task-state.test.cjs:28, 57, 82`) проверяется точное равенство объекта `AgentTaskState` и `bodies.length === 2` при передаче `acceptanceCriteria` без мутаций — это учтено в контракте метаданных критериев и условии триггера recovery-раунда.
2. **Незавершённый ответ модели исполняет тулки (`ChatService.ts:647-1040`, `AgentRunner.ts:428-540`):** `_parseResponsesStream` не обрабатывает `response.incomplete` и выход по EOF без `response.completed`/`response.done`; `_parseStream` игнорирует `choice.finish_reason` (включая `length` и чанки без `delta`) и завершение потока без `data: [DONE]`; пустые аргументы превращаются в `'{}'`, из-за чего `list_dir` с необязательным `path` проходит `validate()` и выполняется.
3. **Отсутствует OS-sandbox (`ToolExecutor.ts:339`, `TerminalSessionManager.ts:381-535`, `ProcessManager.ts:31-38`, `CodeIntelligenceTool.ts:40-46`):** `CommandPolicy` классифицирует команду лишь синтаксически. `TerminalSessionManager` запускает AI-команды тем же `spawnBackend`, что и пользовательский shell (и даже без `WindowsProcessJob`, который есть только в `ProcessManager`).
4. **Поздний `AGENTS.md` (`AgentRunner.ts:532, 703-733`, `ProjectRulesLoader.ts:242-246`):** Загрузка правил стоит *после* `ToolExecutor.executeCalls` и не парсит текстовый `patch` (`*** Begin Patch`). Дополнительно выявлен баг в `ProjectRulesLoader.ts:244`: для несуществующих файлов без расширения (например `sub/Makefile`) `path.extname(...) === ''`, из-за чего папка `sub` не проверяется, пока не передан флаг `targetIsFile`.
5. **Субагенты (`SpawnAgentTool.ts:100-191`, `AgentRunner.ts:84, 167-175`):** `AgentRunner` вызывает `SystemPromptPipeline.compile`, игнорируя `SubAgent.getSystemPrompt()`, поэтому `ROLE_INSTRUCTIONS` не попадают в запрос; `totalUsage` локален в `AgentRunner.run` и не агрегируется от дочерних запусков (`24` вместо `36`); `childConfig.runLimits` теряет `tokens` и сбрасывает отсчёт `timeMs`.
6. **Baseline тестов (`tests/agent-ipc-concurrency.test.cjs:14-27`):** `npm run typecheck` проходит (`0` ошибок). Профильные тесты агента и терминала проходят за исключением 9 тестов в `tests/agent-ipc-concurrency.test.cjs` (падают на `Cannot find module '../agent/services/TerminalSessionManager'` после добавления импорта в `AgentIpcHandler.ts:8`) и чувствительности к `EPERM`/`EACCES` при создании `junction` в некоторых тестах (`agent-efficiency.test.cjs`, `universal-agent.test.cjs`, `workspace-files.test.cjs`) в ограниченных средах.
7. **P1-факты (`useChat.ts:919-1089`, `WriteStdinTool.ts:50-52`, `ToolExecutor.ts:350-430`, `settingsService.ts:42-94`, `ContextIndicator.tsx:17-20`, `ContextCompactor.ts:234-262`):** Mid-run поправка сейчас жёстко отменяет run и убивает процессы (`restartAfterCorrection`); пустой `write_stdin` имеет `mutates: true` (спрашивает подтверждение в `confirm`, чистит `resultCache`, выставляет `hasMutations = true`); `resultCache` не проверяет версию файла; `ContextIndicator` игнорирует `status.limit` и делит на `256000`; `ContextCompactor._messageChars` считает строку-заглушку `zipply-document:...` (49 символов) до её разворачивания в `ChatService._sendRequest` (до 120 000 символов).

---

## File Map

**Create (P0):**
- `src/main/agent/core/VerificationEvidence.ts` — Модель критериев с ревизиями, хеш-снимки файлов, привязка проверок и инвалидация при мутациях.
- `src/main/agent/tools/VerifyFileTool.ts` — Инструмент явной проверки файла (`exists`, `contains`, `equals`, `not_contains`) с привязкой к критерию и SHA‑256.
- `src/main/agent/core/ToolPathExtractor.ts` — Единый pre-execution парсер целевых путей (включая `parseCodexPatch` и JSON `operations`).
- `src/shared/sandbox.ts` — Типы профилей OS-sandbox (`SandboxProfile`, `NetworkPolicy`, `SandboxEscalationRequest`).
- `src/main/agent/services/ProcessSandbox.ts` — Кроссплатформенный launcher/wrapper изоляции процессов (Windows Restricted Token/AppContainer + Job, Linux `bwrap`, macOS `sandbox-exec`).
- `src/main/agent/core/RunBudget.ts` — Потокобезопасный (async-safe) общий бюджет токенов, резерваций и дедлайна дерева запуска.
- `src/main/agent/cli.ts` — Headless CLI-обёртка над `runAgent` с JSONL-выводом событий и exit-кодами проверок.
- `tests/agent-headless.test.cjs` — Сквозные CLI-тесты с фикстурами в `tests/fixtures/harness/*.json`.

**Modify (P0):**
- `tests/agent-ipc-concurrency.test.cjs`, `tests/agent-efficiency.test.cjs`, `tests/universal-agent.test.cjs`, `tests/workspace-files.test.cjs` — Починка CI-baseline.
- `src/main/agent/services/ChatService.ts` — Явные статусы завершения потока/ответа и валидация JSON tool calls.
- `src/shared/agentEvents.ts` — Расширение `AgentRunReason` (`'incomplete'`), `AgentRunCheck` (criterion/hash/stale metadata), события/типы эскалации sandbox.
- `src/main/agent/core/AgentRunner.ts` — Блокировка тулов на `incomplete`/`truncated_stream`, pre-load `AGENTS.md` до мутаций, `VerificationEvidence` + 1 recovery round, интеграция `RunBudget` и `roleInstructions`.
- `src/main/agent/core/ProjectRulesLoader.ts` — Корректное разрешение `targetIsFile` для файлов без расширения.
- `src/main/agent/core/Blackboard.ts`, `src/main/agent/tools/UpdatePlanTool.ts`, `src/main/agent/tools/ToolRegistry.ts`, `src/main/agent/index.ts` — Критерии, `verify_file`, бюджет.
- `src/main/agent/core/AgentBase.ts`, `src/main/agent/core/PromptProviders.ts`, `src/main/agent/tools/SpawnAgentTool.ts` — Доставка роли в pipeline и структурированный отчёт субагента.
- `src/main/agent/services/TerminalSessionManager.ts`, `src/main/agent/services/ProcessManager.ts`, `src/main/agent/core/ToolExecutor.ts`, `src/main/agent/tools/ExecCommandTool.ts`, `src/main/agent/tools/CodeIntelligenceTool.ts` — Принудительный OS-sandbox для AI и LSP.
- `package.json` — Скрипт `agent:eval` через `esbuild`.

**Create & Modify (P1 — после P0):**
- `src/main/agent/core/RunJournal.ts`, `src/main/ipc/AgentIpcHandler.ts`, `src/preload/index.ts`, `src/renderer/src/hooks/useChat.ts` — Журнал операций, `agent:resume`, `agent:steer`.
- `src/main/agent/tools/WriteStdinTool.ts`, `src/main/agent/core/ToolExecutor.ts`, `src/main/agent/services/TerminalOutputNormalizer.ts` — Разделение опроса/ввода, версионированный `resultCache`, структурированные метаданные ошибок и логов.
- `src/shared/models.ts`, `src/renderer/src/components/mode-selector/constants.ts`, `src/renderer/src/services/settingsService.ts`, `src/renderer/src/components/chat-input/ContextIndicator.tsx`, `src/main/agent/core/AttachmentResolver.ts`, `src/main/agent/core/ContextCompactor.ts` — Модельный контекст, подсчёт после разворачивания вложений, отдельный state-блок.
- `src/main/agent/tools/BrowserVerifyTool.ts`, `src/main/agent/core/WorktreeManager.ts` — Playwright-инструмент проверки UI и worktree-изоляция для `worker`.

---

## P0 — Корректность, безопасность и измерение

### Task 0: Починка базового CI-прогона (IPC mock и junction guard)

**Files:**
- Modify: `tests/agent-ipc-concurrency.test.cjs:14-31`
- Modify: `tests/agent-efficiency.test.cjs:47-58`
- Modify: `tests/universal-agent.test.cjs:44-51`
- Modify: `tests/workspace-files.test.cjs:26-34`

**Interfaces:**
- Consumes: `AgentIpcHandler` из `src/main/ipc/AgentIpcHandler.ts` (импортирует `../agent/services/TerminalSessionManager`).
- Produces: Зелёный baseline для всех 9 тестов `tests/agent-ipc-concurrency.test.cjs` и безопасный `t.skip` при `EPERM`/`EACCES` в junction-тестах.

- [ ] **Step 1: Зафиксировать текущее падение IPC-тестов**

Run: `node --test tests/agent-ipc-concurrency.test.cjs`
Expected: FAIL 9 tests с ошибкой `Cannot find module '../agent/services/TerminalSessionManager'`.

- [ ] **Step 2: Добавить mock `TerminalSessionManager` в `tests/agent-ipc-concurrency.test.cjs`**

В `Module._load` (`tests/agent-ipc-concurrency.test.cjs:25`) добавить мок рядом с `ProcessManager`, а также пробросить `stopSession` в `processManager`:

```js
if (id === '../agent/services/ProcessManager') return { processManager: { stopSender: async () => {}, stopSenderRequest: async () => {}, stopSession: async () => {} } }
if (id === '../agent/services/TerminalSessionManager') return { terminalSessionManager: { stopRequest: async () => {}, stopSession: async () => {} } }
```

- [ ] **Step 3: Добавить единый helper обработки `EPERM`/`EACCES` для `fs.symlink(..., 'junction')`**

В `tests/agent-efficiency.test.cjs:47-58`, `tests/universal-agent.test.cjs:44-51` и `tests/workspace-files.test.cjs:26-34` обернуть вызовы `fs.symlink`:

```js
try {
  await fs.symlink(targetDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
} catch (err) {
  if (err && ['EPERM', 'EACCES'].includes(err.code)) {
    t.skip('junction/symlink is not permitted in this environment')
    return
  }
  throw err
}
```
(Не забыть передать параметр `t` в коллбэк `test(..., async (t) => ...)` и гарантировать `finally` cleanup временной папки.)

- [ ] **Step 4: Проверить прохождение baseline-тестов**

Run: `node --test tests/agent-ipc-concurrency.test.cjs tests/agent-efficiency.test.cjs tests/universal-agent.test.cjs tests/workspace-files.test.cjs`
Expected: PASS (или `skipped` только для junction при реальном `EPERM` среды), `0` failed.

- [ ] **Step 5: Commit**

```bash
git add tests/agent-ipc-concurrency.test.cjs tests/agent-efficiency.test.cjs tests/universal-agent.test.cjs tests/workspace-files.test.cjs
git commit -m "test: mock TerminalSessionManager in IPC suite and guard junction tests"
```

---

### Task 1: Явные статусы завершения провайдера и защита от исполнения битых tool calls

**Files:**
- Modify: `src/main/agent/services/ChatService.ts:79-85, 116-172, 647-1040`
- Modify: `src/shared/agentEvents.ts:15`
- Modify: `src/main/agent/core/AgentRunner.ts:428-540`
- Test: `tests/stream-completion.test.cjs`
- Test: `tests/provider-stream-error.test.cjs`

**Interfaces:**
- Produces:
  - `export type ChatResponseStatus = 'completed' | 'incomplete' | 'truncated_stream'` в `src/main/agent/services/ChatService.ts`
  - Расширенный `ChatResponse`: `{ content: string; reasoningContent: string; toolCalls: ToolCallChunk[]; usage?: ChatResponseUsage; status: ChatResponseStatus; finishReason?: string; incompleteReason?: string }`
  - Расширенный `AgentRunReason`: `'completed' | 'incomplete' | 'cancelled' | 'error' | 'no_progress' | 'limit_rounds' | 'limit_tokens' | 'limit_time'` в `src/shared/agentEvents.ts`

- [ ] **Step 1: Написать падающие тесты на оборванный SSE и `response.incomplete` с `list_dir`**

Добавить в `tests/stream-completion.test.cjs` и `tests/provider-stream-error.test.cjs`:
1. Chat Completions SSE поток обрывается по EOF без `data: [DONE]` и без `finish_reason`, содержа частично сгенерированный `tool_calls` (`list_dir` с пустыми `arguments: ""`). Проверка: `ChatService.chat` возвращает `status: 'truncated_stream'`; `AgentRunner.run` НЕ вызывает `list_dir`, сохраняет частичный текст, завершается без `done` и с `summary.reason === 'incomplete'`.
2. Responses SSE поток присылает `response.output_item.added` (`list_dir`), затем `response.incomplete` (`incomplete_details: { reason: 'max_output_tokens' }`). Проверка: `ChatService.chat` возвращает `status: 'incomplete'`, `incompleteReason: 'max_output_tokens'`; `AgentRunner.run` НЕ вызывает `list_dir` и не продолжает цикл.
3. Chat Completions SSE с `delta: {}` и `finish_reason: 'length'` (даже при последующем `data: [DONE]`): возвращает `status: 'incomplete'`, `finishReason: 'length'`.
4. Chat Completions / Responses при валидном `response.completed` или `[DONE]` с `finish_reason: 'tool_calls'` но невалидным JSON в `argumentsJson` (`'{"path":'`): вызов не передаётся на исполнение как валидный.

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

Run: `node --test tests/stream-completion.test.cjs tests/provider-stream-error.test.cjs`
Expected: FAIL (`list_dir` исполнился или `res.status === undefined`).

- [ ] **Step 3: Реализовать статусы адаптера в `ChatService.ts`**

1. В `_parseResponsesJson` (`ChatService.ts:647-693`):
   - Читать `json?.status`: если `'failed'` / `'cancelled'` — бросать ошибку провайдера с текстом `json?.error?.message || json.status`.
   - Если `json?.status === 'incomplete'` — возвращать `status: 'incomplete'`, `incompleteReason: json?.incomplete_details?.reason || 'incomplete'`.
   - Иначе `status: 'completed'`.
2. В `_parseResponsesStream` (`ChatService.ts:695-834`):
   - Завести `let completionStatus: ChatResponseStatus = 'truncated_stream'`, `let incompleteReason: string | undefined`.
   - Обработать `event.type === 'response.incomplete'`:
     ```ts
     } else if (event.type === 'response.incomplete') {
       completionStatus = 'incomplete'
       incompleteReason = event.response?.incomplete_details?.reason || 'incomplete'
       if (event.response?.usage) usage = normalizeUsage(event.response.usage)
       void reader.cancel().catch(() => {})
       break readStream
     }
     ```
   - На `event.type === 'response.completed' || event.type === 'response.done'`: проверять `event.response?.status === 'incomplete'` (тогда `completionStatus = 'incomplete'`), иначе `completionStatus = 'completed'`.
   - На `trimmed === 'data: [DONE]'`: если `completionStatus === 'truncated_stream'` (не было terminal event от Responses), оставлять `truncated_stream` (или если были только текстовые дельты без terminal event, считать `truncated_stream` для защиты tool calls).
   - Не подставлять молча `'{}'` в `argumentsJson: tc.argumentsJson || '{}'` (строка 824): оставлять фактический `tc.argumentsJson`, чтобы вызывающий слой видел пустую/оборванную строку.
3. В `_parseResponse` non-streaming (`ChatService.ts:843-877`):
   - Читать `const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined`.
   - Если `finishReason === 'length' || finishReason === 'content_filter'`, возвращать `status: 'incomplete'`, `finishReason`. Иначе `status: 'completed'`, `finishReason`.
4. В `_parseStream` (`ChatService.ts:882-1040`):
   - Завести `let seenDone = false`, `let finishReason: string | undefined`.
   - Перенести чтение `choice.finish_reason` ДО `if (!delta) continue` (строка 954), так как финальный чанк OpenAI/OpenRouter часто приходит с `delta: {}` и `finish_reason: 'stop' | 'tool_calls' | 'length'`!
   - После выхода из `readStream`:
     - Если `finishReason === 'length' || finishReason === 'content_filter'` → `status = 'incomplete'`.
     - Else if `!seenDone && !finishReason` → `status = 'truncated_stream'`.
     - Else if `!seenDone && finishReason && !['stop', 'tool_calls', 'function_call'].includes(finishReason)` → `status = 'truncated_stream'`.
     - Else `status = 'completed'`.
5. В `ChatService.chat` (`ChatService.ts:135`):
   - Если поток упал или вернулся с `emitted === true`, повторный retry не выполняется (текущее поведение `if (emitted) throw error` сохраняется; при `status !== 'completed'` метод возвращает `ChatResponse` со статусом, не делая скрытого повтора с потерей частичного вывода).

- [ ] **Step 4: Добавить проверку статуса и аргументов в `AgentRunner.ts` (и рендеринг частичного результата)**

В `AgentRunner.ts` сразу после `recordUsage(response.usage, ...)` (строка 428):
1. Проверить `const responseIncomplete = response.status && response.status !== 'completed'`:
   - Если `responseIncomplete`:
     - **Немедленно** не передавать `response.toolCalls` ни в `skipToolCalls`, ни в `ToolExecutor.executeCalls`!
     - Если уже был `response.content?.trim()` или `response.reasoningContent?.trim()`, сохранить его в `messages` как обычный (без `tool_calls`) или частичный ответ ассистента и отправить `safeEmit({ type: 'history', messages: historySinceStart() })` (не дублируя токены, если они уже стримились).
     - Завершить раннер с `finish('incomplete', ...)` (при `reason === 'incomplete'` `finish` отправляет `run_summary` и `{ type: 'error', message }` — не `{ type: 'done' }`, чтобы UI не помечал оборванный ответ как успешно завершённый!).
2. Перед блоком исполнения `response.toolCalls` (строки 498-540):
   - Добавить helper `validateToolCallArguments(calls)`:
     - Проверяет, что `call.name` непустой и `call.argumentsJson` (если не пуст, либо `argumentsJson.trim() === ''` — допускать `'{}'` только при `response.status === 'completed'` и только когда у инструмента нет обязательных параметров, иначе — либо явная ошибка конкретного tool call, но при битом JSON от модели на завершённом ответе — если все `toolCalls` с битым JSON, фиксировать protocol-safe ошибку в `tool_result` или `incomplete`). Конкретно: если `response.status === 'completed'` и конкретный `call.argumentsJson` не парсится как JSON-объект (кроме пустой строки для tool без required args), передаём его в `ToolExecutor`, который вернёт ошибку протокола без исполнения инструмента; но при `status !== 'completed'` ни один tool call вообще не запускается.

- [ ] **Step 5: Прогнать тесты**

Run: `npm run typecheck && node --test tests/stream-completion.test.cjs tests/provider-stream-error.test.cjs tests/codex-step5-compactor-responses.test.cjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/services/ChatService.ts src/shared/agentEvents.ts src/main/agent/core/AgentRunner.ts tests/stream-completion.test.cjs tests/provider-stream-error.test.cjs
git commit -m "fix(harness): enforce provider completion status and block tool execution on incomplete streams"
```

---

### Task 2: Достоверная верификация, `verify_file` и инвалидация устаревших проверок

**Files:**
- Create: `src/main/agent/core/VerificationEvidence.ts`
- Create: `src/main/agent/tools/VerifyFileTool.ts`
- Modify: `src/shared/agentEvents.ts:17-32`
- Modify: `src/main/agent/core/Blackboard.ts:11-28, 74-147`
- Modify: `src/main/agent/tools/UpdatePlanTool.ts:79-121`
- Modify: `src/main/agent/core/AgentRunner.ts:27-120, 468-496, 544-631`
- Modify: `src/main/agent/tools/ToolRegistry.ts:1-74`
- Modify: `src/main/agent/index.ts:18-34`
- Test: `tests/agent-quality-eval.test.cjs`
- Test: `tests/agent-task-state.test.cjs`
- Test: `tests/codex-harness-fixes.test.cjs`
- Test: `tests/agent-run-summary-renderer.test.cjs`

**Interfaces:**
- Produces (`VerificationEvidence.ts`):
  - `export const MISSING_FILE_HASH = '__MISSING__'`
  - `export interface CriterionRecord { id: string; text: string; revision: number }`
  - `export interface VerificationAttempt { criterionId?: string; criterionRevision?: number; sourceCallId: string; toolName: string; command?: string; targetPath?: string; scopeHash: string; passed: boolean; stale: boolean; staleReason?: string; result: string; createdAt: number }`
  - `export async function computeFileSnapshotHash(absPath: string): Promise<string>`
  - `export async function computeWorkspaceSnapshotHash(workspaceRoot: string, trackedPaths: readonly string[]): Promise<string>`
  - `export class VerificationTracker`: `syncCriteria(criteriaTexts: string[])`, `recordAttempt(...)`, `invalidatePaths(changedPaths: string[])`, `invalidateWorkspace(reason: string)`, `recheckLiveFiles()`, `computeStatus(hasMutations: boolean)`
- Produces (`VerifyFileTool.ts`):
  - `verify_file({ criterion_id?: string, path: string, predicate: 'exists' | 'contains' | 'equals' | 'not_contains', expected?: string })`

- [ ] **Step 1: Написать падающие регрессии (`ORCHID → GONE`, `verify_file`, провал проверки, `exit 0` без артефакта)**

В `tests/agent-quality-eval.test.cjs` и `tests/agent-task-state.test.cjs` добавить тесты:
1. `ORCHID → GONE`: `update_plan` задаёт критерий `["target.txt contains ORCHID"]` → `read_file` видит `ORCHID` → `write_file` перезаписывает на `GONE` → модель пытается завершиться без проверки → раннер даёт 1 recovery-попытку; если модель всё равно не прошла проверку, итоговый `run_summary.verificationStatus !== 'verified'` (а `unverifiedCriteria` непуст).
2. `verify_file(ORCHID) → ручная правка на диске GONE → final`: первая проверка проходит (`passed: true`), затем внешний `fs.writeFile` меняет файл на `GONE`, после чего при финализации раннер пересчитывает хеш целевого файла, помечает проверку устаревшей (`stale: true`) и выдаёт `verificationStatus !== 'verified'`. На контрольном прогоне с неизменённым файлом итог `verified`.
3. `update_plan` смена критерия при продолжении чата: изменение 1-го из 2 критериев инкрементирует `revision` только изменённого критерия, а старая проверка с прошлой ревизией не засчитывается.
4. `exit 0` без артефакта + `verify_file({ predicate: 'exists', path: 'expected.txt' })` → `passed: false`, статус `failed`.
5. `failed` при исчерпании бюджета: `runLimits: { rounds: 2 }` или `tokens`, проверка провалилась → recovery-раунд не превышает бюджет, итог `verificationStatus === 'failed'`.

- [ ] **Step 2: Запустить тесты и убедиться, что новые кейсы падают**

Run: `node --test tests/agent-quality-eval.test.cjs tests/agent-task-state.test.cjs`
Expected: FAIL на `ORCHID → GONE` (ложный `verified`) и отсутствии `verify_file`.

- [ ] **Step 3: Реализовать `VerificationEvidence.ts` и `VerifyFileTool.ts`**

1. В `VerificationEvidence.ts`:
   - `computeFileSnapshotHash(absPath)`: возвращает SHA‑256 содержимого файла, либо `MISSING_FILE_HASH` при `ENOENT`.
   - `CriterionRecord` хранится на `Blackboard` под отдельным артефактом `'criterionRecords'` (это позволяет **не менять** сериализацию `AgentTaskState.acceptanceCriteria: string[]`, чтобы существующий `tests/agent-task-state.test.cjs:28, 57` оставался совместимым!).
   - При `syncCriteria(texts)`: сопоставляет по `id` или нормализованному тексту; новым критериям выдаёт стабильный `c_1`, `c_2`, ... (`revision: 1`), при изменении текста на позиции/по ID поднимает `revision++`.
   - `VerificationTracker.invalidatePaths(paths)`: помечает `stale = true` все попытки, у которых `targetPath` совпадает с изменённым путём или `scopeHash` привязан к workspace-снимку.
   - `VerificationTracker.invalidateWorkspace(reason)`: помечает `stale = true` все shell/workspace-проверки после любой мутации.
   - `VerificationTracker.recheckLiveFiles()`: перед финальным `verificationStatus()` перечитывает на диске каждый `targetPath` у не-`stale` файловых проверок (`verify_file`) и при несовпадении SHA‑256 с `scopeHash` помечает попытку `stale = true`.
2. В `VerifyFileTool.ts`:
   - `getExecutionPolicy(): { mutates: false, parallelSafe: true, cacheable: false }` (никогда не кешировать проверки!).
   - Поддерживает `predicate`: `'exists' | 'contains' | 'equals' | 'not_contains'`.
   - Возвращает `data: { path: relPath, absPath, predicate, criterionId, passed, scopeHash, actualSha256 }` и `error: !passed`.

- [ ] **Step 4: Интегрировать `VerificationTracker` и 1 recovery-раунд в `AgentRunner.ts`, `UpdatePlanTool.ts`, `ToolRegistry.ts`, `index.ts`**

1. В `AgentRunner.ts`:
   - **Удалить** добавление `read_file` и `read_files` в `checks` (убрать строки 609-614)! Обычное чтение — только наблюдение.
   - **Удалить** эвристический word-matching (`CRITERION_STOP_WORDS`, `checkCoversCriterion`) как способ объявления критерия пройденным. Критерий закрывается только актуальной (не `stale`) попыткой, привязанной к `(criterionId, criterionRevision, scopeHash)` (через `verify_file` или явную shell-проверку, если у задачи нет критериев или команда привязана к критерию и после неё не было мутаций и её `scopeHash` актуален).
   - При любой мутации (`write_file`, `edit_file`, `apply_patch`, или mutating `exec_command`/`terminal`/`run_command`/`process_start`/`write_stdin`) вызывать `tracker.invalidatePaths(...)` / `tracker.invalidateWorkspace(...)`.
   - В `AgentRunner.ts:468-496` (при `!response.toolCalls?.length`):
     - Сначала `await tracker.recheckLiveFiles()`.
     - Вычислить `status` и `missingCriteria`.
     - Триггер recovery-попытки: `const shouldRecover = !recoveryUsed && (hasMutations || planUpdatedCriteriaInRun) && status !== 'verified'`, если хватает бюджета раундов (`iteration < maxRounds`), токенов и времени!
     - Важно: `planUpdatedCriteriaInRun` (выставляется при вызове `update_plan` с критериями, а при `hasMutations === false` и статическом `config.taskState` без `update_plan` не ломает существующий тест `tests/agent-task-state.test.cjs:82`).
     - Если `shouldRecover`: `recoveryUsed = true`, добавить `response.content` как `assistant` сообщение, добавить `<system_reminder>` со списком неподтверждённых критериев/правок и инструкцией проверить через `verify_file` или команду тестирования, и сделать `continue` (ровно 1 попытка!).
   - Если после recovery (или без него) статус всё ещё `failed` или `unverified`, вывести честный `run_summary` с `verificationStatus: 'failed' | 'unverified'`, `unverifiedCriteria` и `checks` (включая `criterionId`, `stale`, `scopeHash` опциональными полями в `AgentRunCheck`).

- [ ] **Step 5: Зарегистрировать `VerifyFileTool` и обновить `tests/`**

Добавить `VerifyFileTool` в `ToolRegistry.ts` и `zipplyAgent.addTool(toolRegistry.getTool('verify_file'))` в `src/main/agent/index.ts`.

Run: `npm run typecheck && node --test tests/agent-quality-eval.test.cjs tests/agent-task-state.test.cjs tests/codex-harness-fixes.test.cjs tests/agent-run-summary-renderer.test.cjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/core/VerificationEvidence.ts src/main/agent/tools/VerifyFileTool.ts src/shared/agentEvents.ts src/main/agent/core/Blackboard.ts src/main/agent/tools/UpdatePlanTool.ts src/main/agent/core/AgentRunner.ts src/main/agent/tools/ToolRegistry.ts src/main/agent/index.ts tests/agent-quality-eval.test.cjs tests/agent-task-state.test.cjs tests/codex-harness-fixes.test.cjs tests/agent-run-summary-renderer.test.cjs
git commit -m "feat(harness): bind verification evidence to criterion revisions and file hashes"
```

---

### Task 3: Предварительная загрузка вложенных `AGENTS.md` до записи (оба формата патча)

**Files:**
- Create: `src/main/agent/core/ToolPathExtractor.ts`
- Modify: `src/main/agent/core/ProjectRulesLoader.ts:220-267`
- Modify: `src/main/agent/core/AgentRunner.ts:504-542, 703-733`
- Test: `tests/prompt-caching-and-harness.test.cjs`
- Test: `tests/apply-patch.test.cjs`

**Interfaces:**
- Produces (`ToolPathExtractor.ts`):
  - `export interface ExtractedToolTarget { path: string; isFile: boolean; isMutation: boolean }`
  - `export function extractToolTargetPaths(toolName: string, rawArgumentsJson: string, agent: AgentBase): ExtractedToolTarget[]`
- Consumes: `parseCodexPatch` из `src/main/agent/tools/ApplyPatchTool.ts:37`.

- [ ] **Step 1: Написать падающие тесты на `write_file`, текстовый `apply_patch`, JSON `apply_patch` и файл без расширения**

Добавить в `tests/prompt-caching-and-harness.test.cjs`:
1. Вложенный `packages/sub/AGENTS.md` содержит `SUBDIR_RULE_MUST_UPPERCASE`. Первым ответом модель вызывает `write_file({ path: 'packages/sub/Makefile', content: 'draft' })` (файл без расширения!). До доставки правила файл `packages/sub/Makefile` НЕ должен создаваться на диске; вызов откладывается, правила попадают в хвост второго запроса (`messages[0]` остаётся идентичным!), и второй вызов создаёт файл с учётом правил.
2. Аналогичный сценарий для текстового `apply_patch` (`*** Begin Patch\n*** Add File: packages/sub/a.ts\n+const x = 1\n*** End Patch`) и JSON `apply_patch` (`operations`).
3. Пакет из нескольких подкаталогов + повреждённый `patch` (не должен ронять парсер, должен дойти до обычной валидации инструмента).
4. После доставки правил повторный вызов в тот же каталог выполняется без откладывания.

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

Run: `node --test tests/prompt-caching-and-harness.test.cjs tests/apply-patch.test.cjs`
Expected: FAIL (файл создаётся до загрузки правил; текстовый `apply_patch` вообще не загружает правила; файл `Makefile` не резолвит директорию).

- [ ] **Step 3: Реализовать `ToolPathExtractor.ts` и поправить `ProjectRulesLoader.ts`**

1. В `ToolPathExtractor.ts`:
   - Для `apply_patch`:
     - Если `typeof parsed.patch === 'string'`: вызывать `parseCodexPatch(parsed.patch)` (в `try/catch`, при ошибке возвращать `[]` — пусть `ApplyPatchTool.validate` вернёт стандартную ошибку). Каждая `op.path` даёт `{ path: op.path, isFile: true, isMutation: true }`.
     - Если `Array.isArray(parsed.operations)`: каждая `op.path` даёт `{ path: op.path, isFile: true, isMutation: true }`.
   - Для `write_file`, `edit_file`: `args.path || args.filePath || args.file_path || args.filepath || args.filename || args.file` → `isFile: true, isMutation: true`.
   - Для `read_file`, `verify_file`, `code_intelligence`: `isFile: true, isMutation: false` (или `agent.getHandler(toolName)?.getExecutionPolicy(args).mutates`).
   - Для `read_files`: каждый элемент `args.files[].path` → `isFile: true, isMutation: false`.
   - Для `list_dir`, `search_project`, `find_files`: `args.path` → `isFile: false, isMutation: false`.
   - Для `exec_command`, `terminal`, `run_command`, `process_start`: `args.cwd || args.workdir` → `isFile: false`, `isMutation: policy.mutates`.
2. В `ProjectRulesLoader.ts`:
   - Добавить перегрузку или нормализацию аргумента в `loadForPaths`: принимать `(string | { path: string; isFile?: boolean })[]`.
   - При определении `targetDir`: если `entry.isFile === true`, сразу брать `path.dirname(inspected.actualPath)` без опоры на `path.extname(...)`!

- [ ] **Step 4: Перенести `loadForPaths` в `AgentRunner.ts` ДО `ToolExecutor.executeCalls`**

В `AgentRunner.ts` после формирования `assistant` сообщения с `tool_calls` (строка 513) и до `ToolExecutor.executeCalls` (строка 532):
1. Извлечь `targets = response.toolCalls.flatMap(call => extractToolTargetPaths(call.name, call.argumentsJson, agent))`.
2. Если `rulesSession.workspaceRoot && rulesSession.remainingBytes > 0 && targets.length > 0`:
   - Вызвать `const subdirRules = await ProjectRulesLoader.loadForPaths(rulesSession, blackboard, targets, config)`.
   - Если `subdirRules` непустой И `targets.some(t => t.isMutation)` (или любой вызов в пакете имеет `policy.mutates`):
     - **Отложить весь пакет** без записи на диск:
       ```ts
       const deferredMsg = 'Вызов отложен: обнаружены новые правила подкаталога проекта (AGENTS.md). Ознакомься с правилами ниже и при необходимости скорректируй действие перед повтором.'
       for (const call of response.toolCalls) {
         messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: deferredMsg })
         safeEmit({ type: 'tool_result', callId: uiCallId(call.streamId || call.id), result: deferredMsg, error: true, data: { deferredForRules: true } })
       }
       messages.push({
         role: 'user',
         content: `<system_reminder>\nПравила подкаталога проекта (AGENTS.md):\n${subdirRules}\n</system_reminder>`
       })
       safeEmit({ type: 'history', messages: historySinceStart() })
       continue
       ```
   - Если мутаций не было (`!hasMutatingCalls`) и `subdirRules` непустой: выполнить пакет штатно и добавить `<system_reminder>` в хвост `messages` после `ToolExecutor.executeCalls`.
3. Удалить старый дублирующийся блок загрузки из строк 703-733.

- [ ] **Step 5: Прогнать тесты**

Run: `npm run typecheck && node --test tests/prompt-caching-and-harness.test.cjs tests/apply-patch.test.cjs tests/codex-tools-upgrade.test.cjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/core/ToolPathExtractor.ts src/main/agent/core/ProjectRulesLoader.ts src/main/agent/core/AgentRunner.ts tests/prompt-caching-and-harness.test.cjs
git commit -m "fix(harness): load nested AGENTS.md rules before mutating writes and text patches"
```

---

### Task 4: OS Sandbox для процессов агента и изоляция от пользовательского терминала

**Files:**
- Create: `src/shared/sandbox.ts`
- Create: `src/main/agent/services/ProcessSandbox.ts`
- Modify: `src/shared/agentEvents.ts:66`
- Modify: `src/main/agent/services/ChatService.ts:9-34`
- Modify: `src/main/agent/services/TerminalSessionManager.ts:62-77, 161-187, 381-574`
- Modify: `src/main/agent/services/ProcessManager.ts:31-50`
- Modify: `src/main/agent/core/ToolExecutor.ts:271-399`
- Modify: `src/main/agent/tools/ExecCommandTool.ts:128-147`
- Modify: `src/main/agent/tools/CodeIntelligenceTool.ts:31-48`
- Test: `tests/process-sandbox.test.cjs`
- Test: `tests/exec-command-tools.test.cjs`
- Test: `tests/terminal-session-manager.test.cjs`

**Interfaces:**
- Produces (`src/shared/sandbox.ts`):
  - `export type SandboxProfile = 'read-only' | 'workspace-write' | 'unrestricted'`
  - `export type SandboxNetworkPolicy = 'off' | 'on'`
  - `export interface SandboxPolicy { profile: SandboxProfile; network: SandboxNetworkPolicy; workspaceRoot: string; tempDir: string; allowEscalationPrompt?: boolean }`
- Produces (`src/main/agent/services/ProcessSandbox.ts`):
  - `export interface SandboxedSpawnSpec { command: string; args: string[]; cwd: string; env: Record<string, string>; cleanup?: () => Promise<void>; driver: 'windows-restricted' | 'linux-bwrap' | 'macos-seatbelt' | 'host-unrestricted' }`
  - `export class ProcessSandbox`: `static resolvePolicy(config: ChatConfig | undefined, workspaceRoot: string): SandboxPolicy`, `static async prepareSpawn(shell: string, shellArgs: string[], baseEnv: Record<string, string>, cwd: string, policy: SandboxPolicy): Promise<SandboxedSpawnSpec>`

- [ ] **Step 1: Написать падающие тесты на OS sandbox (`read-only`, `workspace-write`, эскалацию и user-терминал)**

Создать `tests/process-sandbox.test.cjs`:
1. `ProcessSandbox.resolvePolicy`: `planMode: true` и `accessMode: 'read-only'` → `{ profile: 'read-only', network: 'off' }`; `accessMode: 'confirm' | 'automatic'` → `{ profile: 'workspace-write', network: 'off' }`; `accessMode: 'unrestricted'` → `{ profile: 'unrestricted', network: 'on' }`.
2. В профиле `read-only` попытка записи внутри workspace через `exec_command` (`node -e "require('fs').writeFileSync('pwned.txt', '1')"`) физически блокируется ОС (файл `pwned.txt` не создаётся, процесс завершается с ненулевым кодом ошибки), даже если `CommandPolicy` не распознал команду или обёрнут скрипт.
3. В профиле `workspace-write` запись в `workspace/allowed.txt` разрешена, а запись в `outside/escape.txt` (вне workspace) физически блокируется ОС и при отказе `confirmAction` не происходит.
4. При `network: 'off'` сетевой запрос к локальному HTTP-серверу/внешнему хосту из AI-процесса блокируется (или при недоступности драйвера sandbox fail-closed возвращает ошибку, не запуская процесс без изоляции).
5. `TerminalSessionManager.startInteractiveShell` (`origin: 'user'`) запускается без AI-ограничений (проверка через `origin === 'user'` и наличие записи вне sandbox).

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

Run: `node --test tests/process-sandbox.test.cjs`
Expected: FAIL (`ProcessSandbox` не существует / запись в `read-only` проходит на диск).

- [ ] **Step 3: Реализовать `src/shared/sandbox.ts` и `src/main/agent/services/ProcessSandbox.ts`**

1. **Профили и fail-closed:**
   - При `policy.profile === 'unrestricted'` возвращается прямой `host-unrestricted` spawn (но с обязательным `WindowsProcessJob` на Windows / process-group на POSIX).
   - **Windows (`windows-restricted`):**
     - Создавать изолированный AppContainer profile (или Restricted Token с Low Integrity `S-1-16-4096` + `DISABLE_MAX_PRIVILEGE` + `JOBOBJECT_BASIC_UI_RESTRICTIONS` + `ActiveProcessLimit`/`KillOnJobClose`), без capability `internetClient` / `internetClientServer` / `privateNetworkClientServer` при `network === 'off'`, и временный ACE на `policy.workspaceRoot` (`RX` для `read-only`, `RWXD` для `workspace-write`) + изолированный `tempDir` (`%TEMP%/zipply-sandbox-<id>`).
     - Откат: в AI-процессах при активном sandbox использовать pipe-режим (`preferPty = false`, так как ConPTY на Windows требует совпадения сессии/прав, либо отдельный sandbox runner с передачей `TEMP`/`TMP` в `env`). При ошибке подготовки токена/AppContainer/ACL — **бросать явную ошибку sandbox** (никогда не откатываться в незащищённый host-spawn!).
   - **Linux (`linux-bwrap`):**
     - Проверка `bwrap` (`bubblewrap`): `--die-with-parent`, `--new-session`, `--unshare-net` (если `network === 'off'`), `--ro-bind / /`, `--dev /dev`, `--proc /proc`, `--tmpfs /tmp` (и отдельный `--bind tempDir /tmp`), для `workspace-write` `--bind workspaceRoot workspaceRoot`, для `read-only` оставлять `--ro-bind`. Если `bwrap` отсутствует — fail-closed ошибка с понятным сообщением (или запрашивать подтверждение эскалации через `confirmAction`, если разрешено).
   - **macOS (`macos-seatbelt`):**
     - `sandbox-exec -p <profile>`: `(version 1) (deny default) (allow process*) (allow sysctl-read) (allow file-read*)`, для `workspace-write` `(allow file-write* (subpath "<workspaceRoot>") (subpath "<tempDir>"))`, при `network === 'on'` `(allow network*)`, при `network === 'off'` запрет сети.
2. **Cleanup:** `cleanup()` снимает временный AppContainer/ACL/tempDir по завершении сессии.

- [ ] **Step 4: Подключить `ProcessSandbox` в `TerminalSessionManager.ts`, `ProcessManager.ts`, `ToolExecutor.ts`, `ExecCommandTool.ts`, `CodeIntelligenceTool.ts`**

1. `TerminalSessionManager.startCommand` (`origin: 'ai'`) принимает `sandbox?: SandboxPolicy`:
   - Вызывает `ProcessSandbox.prepareSpawn(...)` и использует `spec.command`, `spec.args`, `spec.env`, `spec.cwd`.
   - По завершении в `finalizeEntry` вызывает `spec.cleanup?.()`.
   - `startInteractiveShell` (`origin: 'user'`) **НЕ** использует `ProcessSandbox`.
2. `ProcessManager.start` также принимает `sandbox?: SandboxPolicy` и прогоняет запуск через `ProcessSandbox.prepareSpawn`.
3. `ExecCommandTool`, `TerminalTool` и `ProcessTool` берут `config` из `blackboard.getArtifact('config')`, вычисляют `ProcessSandbox.resolvePolicy(config, resolved.workspaceRoot)` и передают в `startCommand` / `start`.
   - При наличии `sandbox` (кроме `'unrestricted'`) в `planMode` / `read-only` read-only команды исполняются внутри `read-only` sandbox, а мутирующие команды отклоняются на уровне `ToolExecutor` как и раньше.
   - Если пользователь подтвердил эскалацию через `confirmAction({ kind: 'command', ... })` (например, команда требует сеть при `network: 'off'` или внешний путь), для этого конкретного вызова может передаваться явный `escalatedPolicy` (ограниченный одной командой, без изменения режима чата).
4. `CodeIntelligenceTool` при внешнем LSP (`PythonAnalysis` / `GenericLanguageAnalysis`) передаёт `read-only` + `network: 'off'` sandbox-параметры (или запускается под тем же sandbox-профилем).

- [ ] **Step 5: Прогнать тесты**

Run: `npm run typecheck && node --test tests/process-sandbox.test.cjs tests/exec-command-tools.test.cjs tests/terminal-session-manager.test.cjs tests/command-policy.test.cjs tests/process-tool.test.cjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/sandbox.ts src/main/agent/services/ProcessSandbox.ts src/shared/agentEvents.ts src/main/agent/services/ChatService.ts src/main/agent/services/TerminalSessionManager.ts src/main/agent/services/ProcessManager.ts src/main/agent/core/ToolExecutor.ts src/main/agent/tools/ExecCommandTool.ts src/main/agent/tools/TerminalTool.ts src/main/agent/tools/ProcessTool.ts src/main/agent/tools/CodeIntelligenceTool.ts tests/process-sandbox.test.cjs
git commit -m "feat(security): enforce OS-level read-only and workspace-write process sandbox"
```

---

### Task 5: Роли субагентов в `SystemPromptPipeline`, общий `RunBudget` и структурированные отчёты

**Files:**
- Create: `src/main/agent/core/RunBudget.ts`
- Modify: `src/main/agent/core/AgentBase.ts:6-27`
- Modify: `src/main/agent/core/PromptProviders.ts:1-224`
- Modify: `src/main/agent/core/AgentRunner.ts:74-180, 220-345, 428-466`
- Modify: `src/main/agent/core/Blackboard.ts:34-73`
- Modify: `src/main/agent/tools/SpawnAgentTool.ts:1-193`
- Test: `tests/codex-step4-plan-subagent.test.cjs`
- Test: `tests/agent-quality-eval.test.cjs`

**Interfaces:**
- Produces (`RunBudget.ts`):
  - `export class RunBudget`: `constructor(options: { maxTokens?: number; deadlineAt?: number })`
  - `reserve(estimatedTokens: number): string` (бросает/возвращает статус отказа, если лимит или дедлайн уже достигнут)
  - `commit(reservationId: string, usage?: ChatResponseUsage, estimate?: ChatResponseUsage): void`
  - `release(reservationId: string): void`
  - `isExhausted(): { exhausted: boolean; reason?: 'limit_tokens' | 'limit_time'; message?: string }`
  - `snapshot(): AgentUsage`
- Produces (`AgentBase.ts`):
  - `AgentContext`: добавить `role?: string; roleInstructions?: string`
  - `AgentBase`: опциональный метод `getRoleInstructions?(): string`

- [ ] **Step 1: Написать падающие тесты на `reviewer` prompt и `3 × 12 = 36` токенов + параллельный лимит**

Добавить в `tests/codex-step4-plan-subagent.test.cjs`:
1. Сравнение `explorer` и `reviewer`: в `system` / `developer` сообщении запроса дочернего агента `reviewer` обязательно присутствуют инструкции роли `reviewer` (`ROLE_INSTRUCTIONS.reviewer`), у `explorer` — инструкции `explorer`, и у обоих отсутствуют мутирующие инструменты.
2. Учёт расхода в дереве (`24 + 12 = 36`): родитель делает 2 запроса по 12 токенов, ребёнок `spawn_agent` делает 1 запрос на 12 токенов. В итоговом `run_summary.usage.totalTokens` и `done.usage.totalTokens` родителя ровно `36`, в `spawn_agent` `data.usage.totalTokens === 12`.
3. Два параллельных ребёнка (`explorer` + `reviewer`) с общим `runLimits: { tokens: 20 }`: после резервации/исчерпания общего лимита второй запрос не стартует; при отмене родителя через `abortSignal` дочерний агент останавливается; при отсутствующем `usage` от провайдера ставится `estimated: true` / `complete: false`.
4. Дедлайн `runLimits.timeMs` общий для родителя и ребёнка (`deadlineAt` не сбрасывается при старте ребёнка).
5. `SpawnAgentTool` возвращает `status`, `usage`, `verificationStatus`, `checks`, `unverifiedCriteria` (и `error: true`, если ребёнок упал с ошибкой/отменой).

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

Run: `node --test tests/codex-step4-plan-subagent.test.cjs`
Expected: FAIL (инструкции `reviewer` не попадают в запрос; родитель показывает `24` вместо `36`).

- [ ] **Step 3: Реализовать `RunBudget.ts` и `RoleInstructionsProvider`**

1. В `RunBudget.ts`:
   - Хранить общие счётчики `promptTokens`, `completionTokens`, `totalTokens`, `cachedTokens`, `complete`, `estimated`, `reservedByCall: Map<string, number>`, `deadlineAt?: number`, `maxTokens?: number`.
   - `canStartRequest()` проверяет `Date.now() >= deadlineAt` (`limit_time`) и `(totalTokens + totalReserved) >= maxTokens` (`limit_tokens`).
   - `reserve(estimatedPromptTokens)` добавляет запись в `reservedByCall`; `commit(id, usage, estimate)` удаляет резерв, суммирует фактический `usage` (или `estimate` при его отсутствии с пометкой `complete = false, estimated = true`), обновляет `softLimitExceeded` если факт превысил потолок.
   - `release(id)` снимает резерв при исключении/отмене.
2. В `PromptProviders.ts`:
   - Добавить `RoleInstructionsProvider` (`id: 'role_instructions'`, `isStatic: true`, `tier: 'session_static'`): если `context.roleInstructions` непустой, рендерит `<role_instructions role="${context.role}">\n${context.roleInstructions}\n</role_instructions>`.
   - Зарегистрировать `RoleInstructionsProvider` в `AgentRunner.ts` сразу после `IdentityProvider`.

- [ ] **Step 4: Подключить `RunBudget` и `roleInstructions` в `AgentRunner.ts` и `SpawnAgentTool.ts`**

1. В `AgentRunner.ts`:
   - При старте: проверить `const sharedBudget = blackboard.getArtifact<RunBudget>('runBudget')`. Если нет (корневой запуск), создать `new RunBudget({ maxTokens: config.runLimits?.tokens, deadlineAt: config.runLimits?.timeMs ? runStartedAt + config.runLimits.timeMs : undefined })` и положить в `blackboard.setArtifact('runBudget', sharedBudget, false)`.
   - Передавать `role: agent.id.startsWith('subagent_') ? agent.id.slice('subagent_'.length) : undefined` и `roleInstructions: agent.getRoleInstructions?.()` в `agentContext` для `SystemPromptPipeline.compile`.
   - Для каждого LLM-запроса (и основного, и `summarize` в компакторе!): проверять `sharedBudget.isExhausted()`, вызывать `reserve(...)` до `ChatService.chat(...)`, `commit(...)` при получении ответа и `release(...)` в `finally` при ошибке.
   - Вести локальный `localUsage` для `AgentRunner.run`: для корневого запуска в `run_summary` и `done` отдавать `sharedBudget.snapshot()` (весь расход дерева!), а для дочернего (`parentBlackboard !== null`) отдавать `localUsage` (чтобы отчёт ребёнка знал собственный расход, пока корень видит всё дерево!).
   - Также проверять общий `deadlineAt` в цикле `while (true)` вместо локального `runStartedAt` при наличии `sharedBudget.deadlineAt`.
2. В `SpawnAgentTool.ts`:
   - Наследовать `SubAgent` с `getRoleInstructions(): string` (возвращает `ROLE_INSTRUCTIONS[role]` + правило строгой опоры на факты) и делегировать `getSystemPrompt(ctx)` в `SystemPromptPipeline.compile(this.id, { ...ctx, role, roleInstructions: this.getRoleInstructions() }).systemPromptPrefix`.
   - В `childBoard` автоматически унаследуется `runBudget` родителя!
   - В `onChildEvent` сохранять полный `childSummary` из `evt.summary` (`reason`, `usage`, `rounds`, `verificationStatus`, `checks`, `unverifiedCriteria`).
   - Возвращать в `formattedContent` и `data`: `{ role, status: childSummary?.reason || 'unknown', rounds, toolCallsCount, usage: childSummary?.usage, verificationStatus: childSummary?.verificationStatus, checks: childSummary?.checks || [], unverifiedCriteria: childSummary?.unverifiedCriteria || [], summary: body }` и выставлять `error: childSummary?.reason === 'error' || childSummary?.reason === 'cancelled'`.

- [ ] **Step 5: Прогнать тесты**

Run: `npm run typecheck && node --test tests/codex-step4-plan-subagent.test.cjs tests/agent-quality-eval.test.cjs tests/codex-step5-compactor-responses.test.cjs tests/prompt-caching-and-harness.test.cjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/core/RunBudget.ts src/main/agent/core/AgentBase.ts src/main/agent/core/PromptProviders.ts src/main/agent/core/AgentRunner.ts src/main/agent/core/Blackboard.ts src/main/agent/tools/SpawnAgentTool.ts tests/codex-step4-plan-subagent.test.cjs
git commit -m "feat(subagents): wire role prompts into pipeline and share RunBudget across tree"
```

---

### Task 6: Headless Eval CLI (`npm run agent:eval`) и регрессии через единый `runAgent`

**Files:**
- Create: `src/main/agent/cli.ts`
- Create: `tests/fixtures/harness/orchid-gone.json`
- Create: `tests/fixtures/harness/incomplete-stream.json`
- Create: `tests/fixtures/harness/nested-agents-patch.json`
- Create: `tests/fixtures/harness/subagent-reviewer-budget.json`
- Create: `tests/fixtures/harness/sandbox-readonly.json`
- Create: `tests/agent-headless.test.cjs`
- Modify: `package.json:7-16`

**Interfaces:**
- CLI command: `npm run agent:eval -- --fixture <path> --workspace <path> [--access-mode automatic] [--api-mode chat_completions|responses] [--abort-after-ms <n>]`
- Output: построчный JSONL (`{ schemaVersion: 1, seq, ts, event: AgentEvent }`) в `stdout`, завершается `run_summary`.
- Exit codes: `0` если фактический итог (`reason`, `verificationStatus`, `usage.totalTokens` / `oracleFiles`) совпадает с ожиданиями фикстуры; ненулевой код при расхождении или ошибке раннера.

- [ ] **Step 1: Написать падающий тест `tests/agent-headless.test.cjs`**

Тест собирает (или вызывает `npm run agent:eval`) CLI и запускает 6 сквозных фикстур на изолированных временных workspace:
1. `orchid-gone.json` — `read_file(ORCHID)` → `write_file(GONE)` → попытка финала → recovery → ожидаемый `verificationStatus !== 'verified'` (exit `0`, так как ожидание фикстуры `expectedVerification: ['unverified', 'failed']`).
2. `incomplete-stream.json` — оборванный SSE + `response.incomplete` (`apiMode: 'responses'`) с `list_dir` → `list_dir` не вызывался, `reason === 'incomplete'`.
3. `sandbox-readonly.json` — `accessMode: 'read-only'` + `exec_command` на запись файла → файл на диске не создан.
4. `nested-agents-patch.json` — текстовый `apply_patch` в `sub/` с вложенным `AGENTS.md` → правила попали в запрос модели до записи, итоговый файл содержит правку по правилу.
5. `subagent-reviewer-budget.json` — вызов `spawn_agent({ role: 'reviewer' })`, `3 × 12 = 36` токенов, инструкции `reviewer` зафиксированы в запросе.
6. Отмена (`--abort-after-tool` или abort trigger в фикстуре) с запущенным дочерним процессом → в JSONL есть `reason === 'cancelled'`, процесс CLI завершается без зависания.

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `node --test tests/agent-headless.test.cjs`
Expected: FAIL (`src/main/agent/cli.ts` отсутствует).

- [ ] **Step 3: Реализовать `src/main/agent/cli.ts` и скрипт в `package.json`**

1. В `src/main/agent/cli.ts`:
   - Парсить флаги `--fixture`, `--workspace`, `--access-mode`, `--api-mode`.
   - Загружать фикстуру (`{ history, config, responses, expected: { reason, verificationStatus, totalTokens?, filesMustContain?, filesMustNotExist? } }`).
   - Подменять `global.fetch` локальным scripted-handler'ом из фикстуры (поддерживающим и JSON, и raw SSE строки/чанки для имитации обрывов и `response.incomplete`!).
   - Вызывать **тот же `runAgent`** из `./index.ts` с `AbortController`.
   - Печатать в `process.stdout` валидный JSONL (`JSON.stringify({ schemaVersion: 1, seq: ++seq, ts: Date.now(), event }) + '\n'`).
   - Независимо проверять `expected` (читая файлы на диске отдельно от событий агента!) и выставлять `process.exitCode = ok ? 0 : 1`, гарантируя завершение `terminalSessionManager.shutdown()` и `processManager.shutdown()` в `finally`.
2. В `package.json`:
   - Добавить скрипт `"build:cli": "esbuild src/main/agent/cli.ts --bundle --platform=node --format=cjs --packages=external --outfile=out/main/agent-cli.cjs"` и `"agent:eval": "npm run build:cli && node out/main/agent-cli.cjs"`.

- [ ] **Step 4: Добавить 5 JSON-фикстур и прогнать полный прогон P0**

Run:
```bash
npm run typecheck
node --test tests/agent-headless.test.cjs tests/agent-quality-eval.test.cjs tests/agent-task-state.test.cjs tests/codex-harness-fixes.test.cjs tests/prompt-caching-and-harness.test.cjs tests/codex-step4-plan-subagent.test.cjs tests/stream-completion.test.cjs tests/provider-stream-error.test.cjs tests/process-sandbox.test.cjs tests/agent-ipc-concurrency.test.cjs
```
Expected: ALL PASS, exit code `0`. Зафиксировать baseline-отчёт в `docs/superpowers/baselines/2026-11-24-harness-p0.json` (версии харнеса, фикстур, результаты проверок).

- [ ] **Step 5: Commit**

```bash
git add package.json src/main/agent/cli.ts tests/agent-headless.test.cjs tests/fixtures/harness/
git commit -m "feat(ci): add headless agent:eval CLI and P0 harness regression fixtures"
```

---

## P1 — Возобновление, предсказуемые инструменты, контекст и Playwright

### Task 7 (P1.1): Журнал операций в main, `thread/resume` и `turn/steer`

**Files:**
- Create: `src/main/agent/core/RunJournal.ts`
- Modify: `src/shared/agentEvents.ts`
- Modify: `src/main/agent/core/AgentRunner.ts`
- Modify: `src/main/ipc/AgentIpcHandler.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/hooks/useChat.ts:915-1089`
- Test: `tests/run-journal-resume-steer.test.cjs`

**Контракт и поведение:**
- `RunJournal` пишет append-only JSONL в `path.join(userData, 'run-journals', `${sessionId}.jsonl`)` с монотонным `seq`, `runId`, `turnId`, `callId`, `toolName`, `argsHash`, `preFileHashes` (`path -> sha256 | '__MISSING__'`), `status: 'planned' | 'running' | 'completed' | 'failed' | 'unknown' | 'cancelled'`, `result`, `taskState`, `criteriaMeta`, `checks`.
- **Reconciliation при `agent:resume`:** если предыдущий запуск оборвался в статусе `running` / `unknown` (например, между записью файла и сохранением `tool_result`), перед повторным вызовом инструмента раннер сверяет актуальный SHA‑256 файла на диске с `preFileHashes` и ожидаемым результатом. Если запись уже физически произошла на диск — фиксирует результат сверки без слепой повторной перезаписи; если были ручные правки пользователя после падения — явно сообщает модели diff/конфликт.
- **Mid-run `turn/steer` (`agent:steer`):** заменить в `useChat.ts:919-948` деструктивную схему `restartAfterCorrection` (которая сейчас вызывает `agent:cancel` и убивает активные терминальные процессы!). Поправка пользователя доставляется через `ipcMain.on('agent:steer', ...)` в очередь `steeringQueue` активного `AgentRunner`: на границе между текущим инструментом и следующим запросом модели поправка инжектируется в `messages` как актуальный `user`-ход и обновляет `taskState.userCorrections` без убийства живых процессов и потери журнала.

- [ ] **Step 1:** Написать падающие тесты на `RunJournal` (восстановление после сбоя между записью файла и фиксацией `tool_result`, обнаружение ручной правки, mid-run `steer` без убийства процесса).
- [ ] **Step 2:** Реализовать `RunJournal.ts` и интеграцию в `AgentRunner.ts` + `AgentIpcHandler.ts` + `preload/index.ts`.
- [ ] **Step 3:** Перевести `useChat.ts` (`retry` и mid-run correction) на `agent:resume` / `agent:steer` (сохранив fallback для старых чатов без журнала).
- [ ] **Step 4:** Проверить `npm run typecheck && node --test tests/run-journal-resume-steer.test.cjs tests/agent-ipc-concurrency.test.cjs`.

---

### Task 8 (P1.2): Предсказуемые инструменты — разделение опроса и ввода, версионируемый кеш, структурированный выход

**Files:**
- Modify: `src/main/agent/tools/WriteStdinTool.ts:50-128`
- Modify: `src/main/agent/core/ToolExecutor.ts:350-447`
- Modify: `src/main/agent/core/AgentRunner.ts:554-608`
- Modify: `src/main/agent/services/TerminalSessionManager.ts:621-647`
- Modify: `src/main/agent/services/TerminalOutputNormalizer.ts:41-88`
- Test: `tests/codex-harness-fixes.test.cjs`
- Test: `tests/agent-efficiency.test.cjs`

**Контракт и поведение:**
- **`write_stdin` без мутации при опросе (и опциональный `poll_process` / argument-aware policy):**
  - В `WriteStdinTool.getExecutionPolicy(args)`: если `!args.chars && !args.signal`, возвращать `{ mutates: false, parallelSafe: false, cacheable: false, modifiesFiles: false }`.
  - Эффект: пустой опрос вывода больше НЕ спрашивает подтверждение в режиме `confirm`, НЕ очищает `resultCache` (`ToolExecutor.ts:421`) и НЕ выставляет `hasMutations = true` (`AgentRunner.ts:554`) в чисто read-only сессиях. При наличии `chars` или `signal` `mutates: true`, но `modifiesFiles: false` (или отслеживать через sandbox/git status), если команда не меняет файлы.
- **Версионируемый `resultCache` (`ToolExecutor.ts:350-430`):**
  - Вместе с результатом чтения (`read_file`, `read_files`, `list_dir`) сохранять снимок версий затронутых путей (`Array<{ absPath: string; mtimeMs: number; size: number; sha256?: string }>`).
  - Перед выдачей значения из `resultCache` делать быстрый `fs.stat` (и при изменении `mtimeMs`/`size` — пересчёт `sha256` или сброс записи кэша), чтобы ручная правка пользователем между шагами мгновенно инвалидировала кэш!
- **Структурированный результат команд для модели:**
  - В `TerminalSessionManager.collectLlmOutput` всегда возвращать `logPath` (используя существующий `aiLogPath` или файл лога, даже без усечения для длительных сессий) и добавлять в текстовый/структурированный хвост ответа тулки единый JSON-блок или поля `status`, `exitCode`, `errorCode`, `logPath`, чтобы модель и раннер опирались на них без парсинга русских фраз вроде `(завершено с кодом 0)`.

- [ ] **Step 1:** Написать тесты: пустой `write_stdin` в `confirm` не зовёт `confirmAction` и не сбрасывает `resultCache`; ручное изменение файла на диске после `read_file` пробивает `resultCache`.
- [ ] **Step 2:** Обновить `WriteStdinTool.ts`, `ToolExecutor.ts`, `AgentRunner.ts`, `TerminalSessionManager.ts`.
- [ ] **Step 3:** Запустить `npm run typecheck && node --test tests/codex-harness-fixes.test.cjs tests/agent-efficiency.test.cjs tests/exec-command-tools.test.cjs`.

---

### Task 9 (P1.3): Модельные лимиты контекста, подсчёт вложений после разворачивания и раздельный state

**Files:**
- Create: `src/shared/models.ts`
- Create: `src/main/agent/core/AttachmentResolver.ts`
- Modify: `src/renderer/src/components/mode-selector/constants.ts:6-28`
- Modify: `src/renderer/src/services/settingsService.ts:42-94`
- Modify: `src/renderer/src/components/chat-input/ContextIndicator.tsx:11-21`
- Modify: `src/main/agent/core/ContextCompactor.ts:19-160, 234-262`
- Modify: `src/main/agent/core/AgentRunner.ts:300-420`
- Modify: `src/main/agent/services/ChatService.ts:388-407`
- Test: `tests/codex-step5-compactor-responses.test.cjs`
- Test: `tests/image-attachments.test.cjs`

**Контракт и поведение:**
- **Модельный лимит контекста:** Перенести каталог моделей и их `contextLength` / `maxOutputTokens` в `src/shared/models.ts`; `settingsService.toChatConfig` берёт лимит выбранной модели (а не глобальные `256000`), `ContextIndicator.tsx:17,20` использует `status.limit` (вместо `DEFAULT_CONTEXT_LENGTH`).
- **Подсчёт вложений после разворачивания:** `AttachmentResolver` разворачивает и кеширует на `Blackboard` содержимое `zipply-document:` (PDF/DOCX/XLSX до 120 000 симв.) и размеры изображений `zipply-upload:` / `zipply-workspace:` **до** вызова `ContextCompactor.compactAsync` и `reportContext` в `AgentRunner.ts`. `ChatService._sendRequest` переиспользует уже развёрнутые данные.
- **Отдельный state от сжатой истории:** Выделить в runtime-якоре `goal`, `userCorrections` (массив активных поправок) и краткий `checksSummary` (отдельно от `AgentTaskState` в `tests/agent-task-state.test.cjs` или через опциональное расширение, сохраняющее совместимость). Поддержать сохранение нативных `output` items при работе с Responses API и фоновую пре-компакцию (сравнить задержку и стоимость с синхронной).

- [ ] **Step 1:** Написать тесты на модельный `contextLength` в `toChatConfig` и `ContextIndicator`, точный подсчёт PDF-вложения на 80 000 символов в `reportContext`/`compactAsync`, и сохранение `userCorrections` + `checksSummary` после компакции.
- [ ] **Step 2:** Реализовать `src/shared/models.ts`, `AttachmentResolver.ts`, обновить `ContextIndicator.tsx`, `ContextCompactor.ts`, `AgentRunner.ts`, `ChatService.ts`.
- [ ] **Step 3:** Запустить `npm run typecheck && node --test tests/codex-step5-compactor-responses.test.cjs tests/image-attachments.test.cjs tests/model-selector.test.cjs`.

---

### Task 10 (P1.4): Изолированные worktree для `worker` и Playwright-проверка UI

**Files:**
- Create: `src/main/agent/core/WorktreeManager.ts`
- Create: `src/main/agent/tools/BrowserVerifyTool.ts`
- Modify: `src/main/agent/tools/SpawnAgentTool.ts`
- Modify: `src/main/agent/tools/ToolRegistry.ts`
- Modify: `src/main/agent/index.ts`
- Test: `tests/worktree-and-browser-verify.test.cjs`

**Контракт и поведение:**
- **Worktree для параллельных `worker`:** При `spawn_agent({ role: 'worker', isolated: true })` (или при наличии параллельных `worker`) `WorktreeManager` создаёт отдельный `git worktree` (в `.zipply/worktrees/<id>`), запускает ребёнка в этом каталоге, а при возврате собирает `diff` и результаты проверок без перезаписи ручных правок родителя (итоговое применение/merge контролирует родитель/пользователь).
- **`browser_verify` на базе `playwright-core`:** Инструмент с параметрами `{ url, actions?: Array<{ type: 'click' | 'fill' | 'wait' | 'assert_text'; selector?: string; value?: string }>, captureTrace?: boolean }`. Политика: разрешён на `localhost` / `127.0.0.1` (для внешних URL — `confirmAction`), сохраняет скриншот и `trace.zip` в `.zipply/artifacts/`, возвращает список ошибок консоли/страницы (`console.error`, `pageerror`), DOM-проверки и `images: [screenshotRelPath]` для визуальной оценки моделью.
- **E2E-проверка Electron-цепочки:** Добавить тест, воспроизводящий реальную связку `useChat` → IPC → `runAgent` → UI, чтобы ловить разрывы цепочки, которые пропускает `tsc --noEmit`.

- [ ] **Step 1:** Написать тесты на `WorktreeManager` (два `worker` не конфликтуют, ручные правки в основном дереве целы) и `BrowserVerifyTool` (локальный HTTP-сервер, скриншот, `trace.zip`, отлов `pageerror`).
- [ ] **Step 2:** Реализовать `WorktreeManager.ts` и `BrowserVerifyTool.ts`, подключить к `SpawnAgentTool` и `ToolRegistry`.
- [ ] **Step 3:** Прогнать `npm run typecheck && node --test tests/worktree-and-browser-verify.test.cjs`.

---

### Task 11 (P1.5): Единый каталог расширяемости (MCP, ленивые `SKILL.md`, hooks и редактируемая память)

**Files:**
- Modify: `src/main/agent/plugins/BuiltInPlugins.ts`, `src/main/agent/plugins/PluginManagerTool.ts`
- Create: `src/main/agent/core/SkillsLoader.ts`, `src/main/agent/core/ProjectMemoryStore.ts`
- Test: `tests/plugin-lazy-loading.test.cjs`

**Контракт и поведение:**
- Объединить встроенные плагины, MCP-серверы и локальные `SKILL.md` под единым ленивым каталогом: в `messages[0]` попадают только компактные метаданные, а полные схемы и текст `SKILL.md` догружаются по требованию в хвост контекста.
- `ProjectMemoryStore` хранит редактируемые пользователем факты с полями `{ id, fact, source, scope, updatedAt }` в `.zipply/memory.json` (доступно и из Electron, и из CLI/CI).

---

## P2 — Контролируемые эксперименты на живых моделях

- [ ] **Набор из 30 реальных задач:** Зафиксировать 30 снимков репозиториев (`git commit` + независимые тесты-оракулы). Запускать Zipply (`npm run agent:eval`) и Codex CLI на одинаковых снимках, с одной моделью и `reasoningEffort`, по 3 повтора на конфигурацию.
- [ ] **Метрики сравнения:**
  - Доля принятых решений по независимому оракулу (`pass@1`, `pass^3`).
  - Число ложных `verified` (ожидается `0`).
  - Время (`p50` / `p95`), коэффициент кеша (`cachedTokens / promptTokens`) и стоимость одного принятого исправления.
  - Раздельная таблица: ошибки инфраструктуры (сеть, провайдер, таймаут sandbox) vs провалы задачи агентом.
- [ ] **Итерация по одной переменной:** На основе метрик поочерёдно проверять маршрутизацию дешёвой модели для `explorer`/сумм, AST-карту поверх `rg`/LSP, гибридный индекс и программные вызовы MCP; оставлять в основном конфиге только изменения с измеримым выигрышем по времени/стоимости без просадки качества.

---

## Источники для решений

- [Протокол streaming events Responses API](https://developers.openai.com/api/reference/resources/responses/streaming-events)
- [Sandboxing и approvals в Codex](https://learn.chatgpt.com/docs/agent-approvals-security)
- [Codex App Server (`thread/resume`, `turn/steer`)](https://learn.chatgpt.com/docs/app-server)
- [Harness engineering & browser verification (OpenAI)](https://openai.com/index/harness-engineering/)
- [Evals methodology (OpenAI)](https://developers.openai.com/blog/eval-skills)
- [Верификация Claude Code](https://claude.dev/blog/how-the-claude-code-team-thinks-about-verification/)

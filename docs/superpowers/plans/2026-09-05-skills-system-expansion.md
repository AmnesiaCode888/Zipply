# Расширение системы навыков и когнитивного протокола Zipply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать богатую библиотеку встроенных навыков для всех инструментов Zipply, сценариев выхода из тупика («запуталась / не знаю, что делать») и типовых инженерных задач, а также внедрить в системный промпт когнитивный рефлекс самопомощи.

**Architecture:** Выделение встроенных навыков в структурированный модуль `DefaultSkillsData.ts`, интеграция автоматического сидинга и версионирования в `SkillService.ts`, внедрение директив выхода из тупика (Two-Tier Cognitive Protocol) в `PromptProviders.ts`, покрытие тестами.

**Tech Stack:** TypeScript, Node.js, Vitest, Electron.

**Spec:** `docs/superpowers/specs/2026-09-05-skills-system-expansion-design.md`

## Global Constraints
- Сохранение обратной совместимости с существующими пользовательскими навыками.
- Модульность: не раздувать `SkillService.ts`, хранить шаблоны навыков в отдельном файле `DefaultSkillsData.ts`.
- Все навыки должны содержать валидный Frontmatter с `name`, `description`, `triggers`, `tags`, `tools` и при необходимости `globs`.
- Когнитивный протокол в промпте должен быть лаконичным, четким и бескомпромиссным.

---

### Task 1: Создание модуля встроенных навыков `DefaultSkillsData.ts`

**Files:**
- Create: `src/main/agent/services/DefaultSkillsData.ts`
- Test: `tests/agent/default-skills.test.ts`

**Interfaces:**
- Produces: `DEFAULT_SKILLS: Array<{ fileName: string; content: string }>` и `DEFAULT_SKILLS_VERSION: number`

- [ ] **Step 1: Написать тест проверки структуры встроенных навыков**
Проверяет наличие всех навыков по инструментам, навыка `when-stuck`, `systematic-debugging`, `web-research-troubleshooting` и корректность Frontmatter.

- [ ] **Step 2: Запустить тест и убедиться, что он падает до создания файла**

- [ ] **Step 3: Реализовать `DefaultSkillsData.ts` со всеми навыками**
Включает:
- `tool-file-mastery.md`
- `tool-terminal-mastery.md`
- `tool-grep-mastery.md`
- `tool-web-intelligence.md`
- `tool-subagents-swarm.md`
- `tool-skills-and-learning.md`
- `tool-memory-compass.md`
- `tool-mcp-integration.md`
- `tool-schedule-automation.md`
- `when-stuck.md`
- `systematic-debugging.md`
- `web-research-troubleshooting.md`
- `test-driven-development.md`
- `frontend-modern-web.md`
- `backend-api-architecture.md`
- `database-migrations-sql.md`
- `performance-profiling.md`
- Актуализированные `code-standards.md`, `git-workflows.md`, `docker-management.md`, `mcp-builder.md`.

- [ ] **Step 4: Запустить тест и убедиться в успешном прохождении**

---

### Task 2: Интеграция сидинга и версионирования в `SkillService.ts`

**Files:**
- Modify: `src/main/agent/services/SkillService.ts`
- Test: `tests/agent/default-skills.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_SKILLS`, `DEFAULT_SKILLS_VERSION` из `DefaultSkillsData.ts`
- Modifies: `SkillService.init()` и `SkillService._seedDefaultSkills()`

- [ ] **Step 1: Добавить тест сидинга и обновления навыков в `SkillService`**
- [ ] **Step 2: Убедиться в падении теста**
- [ ] **Step 3: Обновить `SkillService._seedDefaultSkills()`**
Записывать или обновлять системные дефолты при несовпадении версий или отсутствии файлов в `extraDir`.
- [ ] **Step 4: Прогнать тесты и подтвердить прохождение**

---

### Task 3: Внедрение когнитивного протокола в `PromptProviders.ts`

**Files:**
- Modify: `src/main/agent/core/PromptProviders.ts`
- Test: `tests/agent/prompt-providers.test.ts`

**Interfaces:**
- Modifies: `IdentityProvider.render()`, `SkillsProvider.render()`

- [ ] **Step 1: Написать тест на наличие инструкций протокола неопределенности в системном промпте**
- [ ] **Step 2: Запустить тест и зафиксировать failure**
- [ ] **Step 3: Модифицировать `IdentityProvider` и `SkillsProvider`**
Добавить блок «Uncertainty & Troubleshooting Protocol»:
- Если агент запутался или возникла неизвестная ошибка:
  1) `search_skills`
  2) `web_search`
  3) `read_terminal`
  4) Делегирование ресерча `ask_agent`
- Запрет на слепые догадки и повторение неудачных правок.
- [ ] **Step 4: Прогнать тесты и убедиться в успехе**

---

### Task 4: Сквозное тестирование и проверка в Zipply

**Files:**
- Test: `tests/agent/skills-expansion.test.ts`

- [ ] **Step 1: Запуск полного тестового набора vitest**
- [ ] **Step 2: Проверка компиляции TypeScript (`npm run typecheck` или `npx tsc --noEmit`)**
- [ ] **Step 3: Финальный отчет и демонстрация изменений**

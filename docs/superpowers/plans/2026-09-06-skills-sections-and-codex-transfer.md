# План реализации: Разделы скиллов, миграция Codex и улучшение когнитивного слоя ИИ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Разбить библиотеку скиллов на папки/разделы с возможностью массового включения/отключения раздела, создать модальное окно переноса скиллов из раздела Codex в Zipply с сохранением структуры, и обучить ИИ лучше ориентироваться в разделах через онтологию промпта и гибридный поиск.

**Architecture:** 
- Двухуровневое хранилище в `skills/extra/<category>/` с автоматической классификацией внешних навыков (Codex, Workspace, Claude) и 100% обратной совместимостью.
- Массовое управление разделом через `disabled_skills.json` и `disabled_categories.json`.
- Модальное окно `CodexTransferModal` для безопасного копирования файлов и папок навыков со всеми подресурсами.
- Когнитивный слой в системном промпте (`<skills_ontology>`) и прокачанные инструменты `search_skills` и `list_skills(category="...")`.

**Tech Stack:** TypeScript, React, Electron IPC, Node.js fs/path.

**Spec:** `docs/superpowers/specs/2026-09-06-skills-sections-and-codex-transfer-design.md`

## Global Constraints
- Сохранить 100% обратную совместимость для всех внешних навыков (`~/.codex/skills`, `.agents/skills`, `.claude/skills`, Cursor rules).
- Ни один существующий навык пользователя не должен потеряться.

---

### Task 1: Расширение модели данных и категорий в `SkillService.ts`

**Files:**
- Modify: `src/main/agent/services/SkillService.ts`
- Modify: `src/main/agent/services/DefaultSkillsData.ts` (при необходимости)
- Test: `scripts/test-skills-sections.ts`

**Interfaces:**
- Consumes: `SkillItem`, `DEFAULT_SKILLS`
- Produces: `SkillItem.category`, `SkillItem.categoryLabel`, `SkillService.toggleCategoryEnabled`, `SkillService.transferSkills`

- [ ] **Step 1: Написать тест для категорий скиллов**
  Создать `scripts/test-skills-sections.ts`, проверяющий сканирование категорий, классификацию внешних навыков и массовое отключение раздела.
- [ ] **Step 2: Расширить интерфейс `SkillItem`**
  Добавить `category?: string`, `categoryLabel?: string`, `categoryIcon?: string`.
- [ ] **Step 3: Обновить логику обнаружения и сидинга в `SkillService`**
  Поддержать подпапки `skills/extra/<category>/`, автоклассификацию для Codex (`codex`), Workspace (`workspace`), встроенных (`system`, `tools`, `engineering`).
- [ ] **Step 4: Реализовать `toggleCategoryEnabled` и `transferSkills`**
  Реализовать массовое переключение активности категории и метод безопасного копирования навыков из внешней папки (например Codex) в локальную библиотеку Zipply.
- [ ] **Step 5: Запустить скрипт тестирования и убедиться в успехе**

---

### Task 2: Улучшение системного промпта и инструментов ИИ (`PromptProviders` & `SkillTool`)

**Files:**
- Modify: `src/main/agent/services/SkillService.ts` (`getStableSkillsCatalogPrompt`, `searchSkillsAsync`)
- Modify: `src/main/agent/tools/SkillTool.ts` (`SearchSkillTool`, `ListSkillsTool`)

- [ ] **Step 1: Обновить `getStableSkillsCatalogPrompt`**
  Генерировать структурированную онтологию по разделам `<skills_ontology>` с пояснением для модели о назначении каждого раздела.
- [ ] **Step 2: Обновить `ListSkillsTool`**
  Добавить параметр `category` в `list_skills(category="tools")`, чтобы агент мог просматривать конкретные разделы.
- [ ] **Step 3: Улучшить `SearchSkillTool`**
  Добавить совпадение по категориям, повысить вес триггеров и тегов, возвращать категорию в результатах поиска.
- [ ] **Step 4: Проверить работу через скрипт `scripts/test-skills-sections.ts`**

---

### Task 3: IPC мост в Electron Main и Preload

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`
- Modify: `src/renderer/src/env.d.ts`

- [ ] **Step 1: Добавить IPC хэндлеры в `src/main/index.ts`**
  `skills:toggleCategory`, `skills:transfer`.
- [ ] **Step 2: Пробросить методы через `src/preload/index.ts` и типы в `env.d.ts`**

---

### Task 4: Компонент `CodexTransferModal` для переноса скиллов

**Files:**
- Create: `src/renderer/src/components/skills/CodexTransferModal.tsx`
- Create: `src/renderer/src/components/skills/CodexTransferModal.css`

- [ ] **Step 1: Сверстать модальное окно выбора скиллов из Codex**
  Список скиллов с чекбоксами, значками файлов/папок, выбором целевого раздела Zipply и кнопкой «Перенести в Zipply».
- [ ] **Step 2: Интегрировать вызов `window.api.skills.transfer`**
  Отображение прогресса переноса, обработка ошибок и вызов `onSuccess`.

---

### Task 5: Обновление интерфейса `SkillsView.tsx` (Группировка по разделам и массовые переключатели)

**Files:**
- Modify: `src/renderer/src/components/skills/SkillsView.tsx`
- Modify: `src/renderer/src/components/skills/SkillsView.css`

- [ ] **Step 1: Реализовать группировку по категориям**
  Отображение секций-аккордеонов для каждого раздела («Системные», «Инструменты Zipply», «Разработка и архитектура», «Codex», «Текущий проект», «Пользовательские»).
- [ ] **Step 2: Добавить переключатель «Вкл / Выкл весь раздел» в шапку каждой секции**
- [ ] **Step 3: Добавить кнопку «Перенести в Zipply» в секцию Codex**
  Интегрировать открытие `CodexTransferModal`.
- [ ] **Step 4: Стилизация и полировка интерфейса**

---

### Task 6: Финальная валидация и проверка сборки

- [ ] **Step 1: Запустить компиляцию TypeScript (`npm run build` или `npx tsc --noEmit`)**
- [ ] **Step 2: Запустить скрипты тестов**
- [ ] **Step 3: Финальная проверка работоспособности**

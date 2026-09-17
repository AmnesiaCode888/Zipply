---
name: tool-skills-and-learning
description: Навигация по каталогу навыков, загрузка правил через read_skill, семантический поиск и сохранение опыта через save_skill
category: tools
triggers: ["навык", "навыки", "каталог навыков", "read_skill", "search_skills", "save_skill", "обучение", "скилл"]
tags: ["tools", "skills", "self-learning", "procedural-memory"]
tools: ["read_skill", "search_skills", "save_skill", "list_skills"]
---

# Мастерство работы с навыками и самообучения

Система навыков Zipply — это процедурная память агента, позволяющая мгновенно загружать экспертные инструкции по требованию.

## 1. Поиск навыка: `search_skills`
- Если задача требует специфического стека (Docker, MCP, SQLite, Prisma, Git) или ты столкнулся с нетипичной проблемой:
  `search_skills(query="миграция базы данных prisma")`
- Поиск использует семантические эмбеддинги и ключевые триггеры, возвращая процент совпадения и краткое описание.

## 2. Чтение полного руководства: `read_skill`
- В каталоге системного промпта содержатся только краткие саммари навыков (для экономии токенов и кеша).
- Чтобы получить пошаговую инструкцию, шаблоны кода и правила:
  `read_skill(skill_name="mcp-builder")`
- Если у навыка есть вложенные скрипты или справочники:
  `read_skill(skill_name="mcp-builder", resource_path="examples/config.json")`

## 3. Сохранение новых навыков: `save_skill` (Самообучение)
- Если ты успешно решил нетривиальную задачу, настроил сложный пайплайн или создал уникальный алгоритм для проекта — упакуй это знание в навык!
```json
save_skill({
  "skill_name": "electron-ipc-streaming",
  "skill_description": "Паттерн потоковой передачи данных из main в renderer через webContents.send",
  "instructions": "## Шаги реализации:\n1. В main процессе...",
  "triggers": ["ipc stream", "поток данных", "webContents send"],
  "tags": ["electron", "ipc", "streaming"],
  "is_core": false
})
```

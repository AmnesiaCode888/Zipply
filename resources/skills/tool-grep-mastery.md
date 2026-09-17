---
name: tool-grep-mastery
description: Сверхбыстрый поиск кода и символов через ripgrep: точечные регулярные выражения, фильтрация по маскам и поиск определений
category: tools
triggers: ["grep", "поиск по коду", "найти функцию", "ripgrep", "поиск в файлах", "где объявлен", "символ"]
tags: ["tools", "grep", "search", "navigation"]
tools: ["grep_search", "file"]
---

# Мастерство поиска через `grep_search`

Инструмент `grep_search` работает на базе высокоскоростного движка ripgrep и позволяет мгновенно находить фрагменты кода, вызовы функций и зависимости.

## 1. Режимы работы:
- **Буквенный поиск (Literal)**: По умолчанию `is_regex=false`. Идеально для поиска импортов, названий переменных, точных строк ошибок.
- **Регулярные выражения**: Устанавливай `is_regex=true` для поиска паттернов (например, `function\s+[A-Za-z0-9_]+\s*\(` или `export\s+(const|type|interface)\s+User`).

## 2. Фильтрация путей через `includes`:
- Не сканируй весь проект без необходимости. Ограничивай поиск расширениями:
  - `includes="*.tsx"` — только React TSX компоненты.
  - `includes="src/**/*.ts"` — только исходники TypeScript.
  - `includes="!**/*.test.ts"` — исключить тесты.

## 3. Типовые паттерны эффективного поиска:
1. **Поиск объявления компонента/класса**:
   `grep_search(query="class SkillService", path="src")`
2. **Поиск использования функции/метода**:
   `grep_search(query="getStableSkillsCatalogPrompt", path="src")`
3. **Поиск маршрутов API или IPC каналов**:
   `grep_search(query="ipcMain.handle", path="src/main")`
4. **Поиск констант и конфигураций**:
   `grep_search(query="DEFAULT_SKILLS", path="src")`

## 4. Что делать после grep:
- По результатам grep открывай конкретный диапазон строк через `file(action="read", path="...", start_line=..., end_line=...)`. Не пытайся угадать окружающий код по одной строке!

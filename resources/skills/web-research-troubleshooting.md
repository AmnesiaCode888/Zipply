---
name: web-research-troubleshooting
description: Техники результативного веб-поиска при возникновении багов, ошибок компилятора, несовместимостей версий и поломок сборки
category: system
triggers: ["поиск бага в гугле", "github issue поиск", "ошибка сборки", "peer dependencies", "версионный конфликт", "web research"]
tags: ["system", "web", "search", "troubleshooting", "errors"]
tools: ["web_search", "web_fetch"]
---

# Мастерство поиска багов в интернете (Web Research Troubleshooting)

Когда локальные навыки и кодовая база не дают ответа на редкую или новую ошибку, спасает точный веб-поиск.

## 1. Анатомия идеального поискового запроса:
`[Название инструмента/библиотеки] [Версия фреймворка] "[Точный фрагмент ошибки]" [Контекст]`

Примеры:
- `"vite" 6 react "Cannot read properties of undefined (reading 'default')"`
- `"prisma" "PrismaClientKnownRequestError" P2002 unique constraint`
- `"electron-builder" "NSIS" "exit code 1" windows`
- `"typescript" TS2742 "The inferred type of this node cannot be named"`

## 2. Что исключать из запроса:
- Локальные пути к файлам пользователя (`C:\Users\username\...` или `/home/user/...`).
- Динамические таймстампы и хэши памяти (`at 0x00007ff...`).
- Эмодзи и локализованные системные сообщения на русском, если библиотека международная (переведи суть ошибки на английский).

## 3. Чтение результатов:
- Приоритет источникам:
  1. Официальные GitHub Issues репозитория (закрытые issues с бейджем `resolved` или реакциями `👍`).
  2. Официальная документация / раздел Migration Guides.
  3. StackOverflow с принятым ответом (зеленая галочка).
- Всегда проверяй дату ответа! Решение 2018 года для React 16 сломает React 18/19.

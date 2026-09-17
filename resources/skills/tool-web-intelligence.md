---
name: tool-web-intelligence
description: Онлайн-разведка, поиск документации, свежих решений на GitHub/StackOverflow и проверка актуальных версий библиотек через web_search и web_fetch
category: tools
triggers: ["web search", "поиск в интернете", "документация", "github issue", "актуальная версия", "web_fetch", "гуглить"]
tags: ["tools", "web", "research", "documentation", "intelligence"]
tools: ["web_search", "web_fetch"]
---

# Мастерство веб-разведки: `web_search` и `web_fetch`

Знания языковой модели ограничены датой обучения (knowledge cutoff). Для всех современных библиотек, версий фреймворков и свежих багов используй интернет!

## 1. Когда ОБЯЗАТЕЛЬНО идти в веб:
1. Ты встретил ошибку сборщика или рантайма, которой нет в твоей базе знаний.
2. Пользователь просит подключить или обновить свежую библиотеку (Next.js 15, Vite 6, Tailwind v4, Prisma v6, Electron 33+).
3. Изменились сигнатуры API или методы объявлены deprecated.
4. Нужна актуальная документация по REST API или стороннему SDK.

## 2. Как формулировать поисковый запрос в `web_search`:
- **Хорошо**: `"electron-vite" "out/main/index.js" "cannot find module"`
- **Хорошо**: `"vite" 6 react swc "failed to load config"`
- **Хорошо**: `fastmcp python tool decorator examples`
- **Плохо**: *«почему у меня ничего не работает в проекте»* (слишком размыто).

## 3. Чтение документации через `web_fetch`:
- Найдя релевантную ссылку в результатах `web_search`, передай её URL в `web_fetch(url="https://...")`.
- `web_fetch` автоматически очистит HTML от мусора и вернет чистый Markdown.
- Цитируй проверенные параметры и код из официальной документации, а не выдумывай несуществующие ключи конфигурации.

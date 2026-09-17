---
name: backend-api-architecture
description: Проектирование надежного бэкенда: Node.js, Express/Fastify, REST API, WebSocket, валидация входных данных, обработка ошибок и безопасность
category: engineering
triggers: ["backend", "api", "rest", "node", "express", "fastify", "маршрут", "контроллер", "сервер"]
tags: ["engineering", "backend", "api", "architecture", "node", "security"]
tools: ["file", "terminal", "grep_search"]
---

# Архитектура бэкенда и API

## 1. Слоистая архитектура:
1. **Transport / Route Layer**: Принимает HTTP/IPC запрос, валидирует схему входных данных (Zod / JSON Schema) и передает вызов в сервис.
2. **Service / Business Logic Layer**: Чистая бизнес-логика, не зависящая от конкретного веб-фреймворка.
3. **Data Access / Repository Layer**: Работа с базой данных (Prisma, SQLite, TypeORM) или внешними API.

## 2. Безопасность и валидация:
- **Никогда не доверяй входным данным**: Валидируй типы, границы чисел и длину строк на входе.
- **Обработка ошибок**: Все асинхронные обработчики должны перехватывать исключения (`try/catch`) и отдавать клиенту унифицированный ответ с понятным кодом ошибки, не раскрывая внутренних путей сервера.
- **Безопасные заголовки**: Настройка CORS, Helmet, rate limiting.

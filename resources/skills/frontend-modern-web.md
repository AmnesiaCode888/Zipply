---
name: frontend-modern-web
description: Разработка современного фронтенда: React 18/19, TypeScript, хуки, компонентная архитектура, Vite, управление состоянием и отзывчивый CSS
category: engineering
triggers: ["frontend", "react", "компонент", "хук", "vite", "css", "state", "ui", "интерфейс", "tsx"]
tags: ["engineering", "frontend", "react", "typescript", "vite", "ui", "css"]
tools: ["file", "terminal", "grep_search"]
---

# Современный фронтенд на React & TypeScript

## 1. Архитектура компонентов:
- **Один компонент — одна ответственность**: Выноси сложную бизнес-логику в кастомные хуки (`useSkills`, `useTerminalSession`).
- **Чистые пропсы**: Определяй строгие TypeScript интерфейсы для пропсов (`interface ButtonProps { ... }`). Избегай `any`.
- **Мемоизация по делу**: Используй `useMemo` и `useCallback` только для тяжелых вычислений или для предотвращения лишних ререндеров дочерних списков с большим числом элементов.

## 2. Управление состоянием:
- Локальный стейт (`useState`) — для UI-состояний (открыто/закрыто, фокус, введенный текст).
- Поднятие состояния (Lifting State Up) или Context API / Zustand — для разделяемых между панелями данных.
- Всегда следи за очисткой эффектов (`useEffect` cleanup function) при подписке на события или таймеры.

## 3. Стилизация:
- Используй семантические CSS переменные для поддержки темной/светлой темы (`var(--bg-primary)`, `var(--border-subtle)`).
- Обеспечивай плавные переходы (`transition: background 0.15s ease`) и читаемую типографику.

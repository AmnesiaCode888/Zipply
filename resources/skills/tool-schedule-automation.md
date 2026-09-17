---
name: tool-schedule-automation
description: Автоматизация по расписанию: создание фоновых таймеров, cron-задач, напоминаний и мониторинга через schedule_task
category: tools
triggers: ["таймер", "расписание", "cron", "напоминание", "через 10 минут", "schedule_task", "мониторинг"]
tags: ["tools", "schedule", "automation", "cron", "timer"]
tools: ["schedule_task"]
---

# Мастерство фоновых задач и расписаний (`schedule_task`)

Инструмент `schedule_task` позволяет агенту просыпаться в заданное время, выполнять регламентные проверки, мониторить фоновые процессы или напоминать о событиях.

## 1. Одноразовый таймер:
```json
schedule_task({
  "action": "schedule_timer",
  "duration_seconds": 300,
  "prompt": "Проверь статус сборки проекта и наличие ошибок в логах"
})
```

## 2. Регулярная cron-задача:
```json
schedule_task({
  "action": "schedule_cron",
  "cron_expression": "*/15 * * * *",
  "prompt": "Проверь состояние фонового dev-сервера через read_terminal",
  "max_iterations": 8
})
```

## 3. Отмена и статус:
- `schedule_task(action="list_tasks")` — список активных задач.
- `schedule_task(action="cancel_task", task_id="...")` — отмена таймера или расписания.

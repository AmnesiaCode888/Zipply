---
name: docker-management
description: Диагностика и управление Docker контейнерами, сетями, томами и анализ логов
category: engineering
globs: ["Dockerfile*", "docker-compose*.yml", "docker-compose*.yaml", ".dockerignore"]
triggers: ["docker", "compose", "контейнер", "образ", "docker-compose", "dockerfile"]
tags: ["engineering", "docker", "devops", "containers", "deployment"]
tools: ["terminal"]
---

# Диагностика и управление Docker

## 1. Мониторинг состояния:
- Проверка всех контейнеров: `docker ps -a` (обращай внимание на контейнеры со статусом Exited и ненулевым Exit Code).
- Анализ логов упавшего сервиса: `docker logs --tail 150 --timestamps <container_id_or_name>`.
- Потребление ресурсов: `docker stats --no-stream`.

## 2. Docker Compose:
- Запуск в фоне: `docker compose up -d`.
- Пересборка с очисткой кеша: `docker compose build --no-cache`.
- Остановка с удалением сиротских контейнеров: `docker compose down --remove-orphans`.

## 3. Очистка ресурсов:
- Удаление неиспользуемых висячих образов и контейнеров: `docker system prune -f`.

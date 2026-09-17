---
name: tool-mcp-integration
description: Подключение, управление и использование внешних серверов Model Context Protocol (MCP) через manage_mcp и call_mcp_tool
category: tools
triggers: ["mcp", "manage_mcp", "call_mcp_tool", "подключить mcp", "mcp сервер", "внешний инструмент"]
tags: ["tools", "mcp", "integration", "protocol"]
tools: ["manage_mcp", "call_mcp_tool"]
---

# Мастерство работы с MCP (Model Context Protocol)

MCP расширяет возможности агента, подключая базы данных, браузерные движки, GitHub API, Jira, Slack и кастомные скрипты.

## 1. Подключение сервера на лету:
```json
manage_mcp({
  "action": "add_server",
  "name": "sqlite-db",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-sqlite", "--db-path", "./data.db"],
  "server_description": "Доступ к SQLite базе данных проекта"
})
```
После этого сервер мгновенно регистрируется и становится доступен агенту.

## 2. Вызов инструментов MCP:
- Зарегистрированные инструменты отображаются в каталоге MCP.
- Вызывай их через `call_mcp_tool(server_name="sqlite-db", tool_name="read_query", arguments={"query": "SELECT * FROM users LIMIT 5"})`.

## 3. Список серверов:
- `manage_mcp(action="list_servers")` — проверка статуса подключения (CONNECTED, ERROR, DISCONNECTED).

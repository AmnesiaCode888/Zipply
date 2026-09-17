---
name: mcp-builder
description: Создание, разработка, отладка и интеграция MCP серверов (Model Context Protocol) на Node.js/TypeScript и Python с автоматическим подключением в Zipply
category: engineering
globs: ["*mcp*", "mcp.json", "*.mcp.*", "claude_desktop_config.json", "src/mcp/**", "mcp/**"]
triggers: ["mcp", "мсп", "mcp сервер", "создать mcp", "написать mcp", "создание mcp", "разработка mcp", "model context protocol", "mcp tool", "подключи mcp", "добавить mcp"]
tags: ["engineering", "mcp", "protocol", "tools", "agent-extension", "developer"]
tools: ["terminal", "file", "grep_search", "call_mcp_tool", "manage_mcp"]
---

# Разработка и подключение MCP (Model Context Protocol) серверов

Model Context Protocol (MCP) — открытый стандарт для расширения возможностей ИИ внешними инструментами.

## 1. КРИТИЧЕСКОЕ ПРАВИЛО ДЛЯ ТРАНСПОРТА STDIO:
- **НИКОГДА не выводить произвольный текст или `console.log()` в stdout!**
- Любой вывод кроме валидных сообщений JSON-RPC 2.0 ломает транспорт протокола.
- Для отладки ВСЕГДА используй `console.error(...)` (Node.js) или `sys.stderr.write(...)` (Python).

## 2. Подключение готового MCP сервера через ИИ:
Используй инструмент `manage_mcp`:
```json
manage_mcp({
  "action": "add_server",
  "name": "sqlite",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-sqlite", "--db-path", "app.db"],
  "server_description": "SQLite база данных проекта"
})
```

## 3. Шаблон сервера на TypeScript (Node.js):
```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "my-server", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_info",
      description: "Получение информации по объекту",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"]
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "get_info") {
    return { content: [{ type: "text", text: `Info for ${request.params.arguments?.id}` }] };
  }
  throw new Error("Tool not found");
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("MCP server running on stdio");
```

## 4. Шаблон FastMCP (Python):
```python
import sys
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("python-mcp-server")

@mcp.tool()
def calculate(a: int, b: int) -> int:
    """Выполняет расчет суммы двух чисел"""
    sys.stderr.write(f"Calculating {a} + {b}\n")
    return a + b

if __name__ == "__main__":
    mcp.run(transport="stdio")
```

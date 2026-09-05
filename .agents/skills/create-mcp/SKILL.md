---
name: create-mcp
description: Руководство и шаблоны по разработке, тестированию и интеграции серверов MCP (Model Context Protocol) на TypeScript/Node.js и Python (FastMCP) с автоматическим подключением в Zipply
globs: ["*mcp*", "mcp.json", "*.mcp.*", "claude_desktop_config.json", "src/mcp/**", "mcp/**"]
triggers: ["mcp", "мсп", "mcp сервер", "создать mcp", "написать mcp", "создание mcp", "model context protocol", "mcp tool", "mcp tools", "создай инструмент mcp", "создать сервер mcp", "подключи mcp", "добавить mcp"]
tags: ["mcp", "protocol", "tools", "agent-extension", "developer"]
tools: ["terminal", "file", "grep_search", "call_mcp_tool", "manage_mcp"]
---

# Разработка и интеграция MCP серверов (Model Context Protocol)

Model Context Protocol (MCP) — открытый протокол от Anthropic для подключения внешних инструментов, баз данных, контекстных ресурсов и API к ИИ-ассистентам.

Данный навык содержит архитектурные стандарты, готовые шаблоны и правила интеграции MCP серверов в Zipply.

---

## 1. Фундаментальные правила архитектуры

1. **Протокол**: JSON-RPC 2.0 по стандарту Model Context Protocol.
2. **Транспорт**:
   - `stdio` (основной для локальных серверов): запуск как дочерний процесс через стандартные потоки `stdin`/`stdout`.
   - `sse / http`: для удаленных или веб-серверов.
3. ⚠️ **ГЛАВНОЕ ПРАВИЛО ДЛЯ STDIO ТРАНСПОРТА**:
   - **НИКОГДА НЕ ПИСАТЬ В `stdout` НИЧЕГО, КРОМЕ ВАЛИДНЫХ JSON-RPC СООБЩЕНИЙ!**
   - Любой вывод `console.log(...)`, `print(...)`, служебные баннеры библиотек ломают JSON-RPC парсер клиента.
   - Любое логирование или отладочный вывод **ОБЯЗАТЕЛЬНО** направлять в `stderr`:
     - Node.js / TypeScript: `console.error(...)`
     - Python: `sys.stderr.write(...)` или модуль `logging`

---

## 2. Подключение готового MCP сервера через инструмент `manage_mcp`

Если требуется подключить существующий MCP сервер (например, SQLite, Filesystem, GitHub, PostgreSQL), используй инструмент **`manage_mcp`**:

```json
manage_mcp({
  "action": "add_server",
  "name": "sqlite-db",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-sqlite", "--db-path", "./data.db"],
  "server_description": "База данных SQLite проекта"
})
```

### Доступные действия `manage_mcp`:
- `"action": "list_servers"` — получить список всех подключенных MCP серверов и их статус.
- `"action": "add_server"` — добавить и мгновенно активировать сервер.
- `"action": "remove_server"` — удалить MCP сервер по имени (`server_name`).
- `"action": "toggle_server"` — включить/выключить сервер (`server_name`, `enabled: true/false`).
- `"action": "test_connection"` — протестировать подключение к серверу и запросить список инструментов.
- `"action": "list_tools"` — вывести список всех инструментов активных MCP серверов.

---

## 3. Шаблон MCP сервера на TypeScript / Node.js

### Инициализация проекта:
```bash
mkdir mcp-server && cd mcp-server
npm init -y
npm install @modelcontextprotocol/sdk zod
npm install -D typescript @types/node tsx
npx tsc --init
```

### Настройка `package.json`:
```json
{
  "name": "custom-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

### Исходный код сервера (`src/index.ts`):
```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// 1. Создание экземпляра MCP сервера
const server = new Server(
  {
    name: "custom-mcp-server",
    version: "1.0.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// 2. Определение списка инструментов
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "process_data",
        description: "Выполняет обработку переданных данных с заданными параметрами",
        inputSchema: {
          type: "object",
          properties: {
            input: {
              type: "string",
              description: "Входной текст или данные для обработки"
            },
            mode: {
              type: "string",
              description: "Режим обработки: 'fast' | 'detailed'"
            }
          },
          required: ["input"]
        }
      }
    ]
  };
});

// 3. Обработка вызовов инструментов
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "process_data") {
    const input = String(args?.input || "");
    const mode = String(args?.mode || "fast");

    try {
      // Логика работы инструмента (логирование только в console.error!)
      console.error(`[MCP] Выполнение process_data для: ${input.slice(0, 50)}...`);

      const result = `Обработано [${mode}]: ${input.toUpperCase()}`;

      return {
        content: [
          {
            type: "text",
            text: result
          }
        ]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Ошибка при обработке: ${err.message || String(err)}`
          }
        ]
      };
    }
  }

  throw new McpError(ErrorCode.MethodNotFound, `Неизвестный инструмент: ${name}`);
});

// 4. Запуск через stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP Server] Успешно подключен и слушает stdio...");
}

main().catch((err) => {
  console.error("[MCP Server] Критическая ошибка запуска:", err);
  process.exit(1);
});
```

---

## 4. Шаблон MCP сервера на Python (FastMCP)

### Установка зависимостей:
```bash
pip install "mcp[cli]"
```

### Код сервера (`server.py`):
```python
import sys
from mcp.server.fastmcp import FastMCP

# Создаем сервер FastMCP
mcp = FastMCP("python-custom-mcp")

@mcp.tool()
def search_local_data(query: str, max_results: int = 5) -> str:
    """
    Выполняет поиск локальных данных по заданному запросу.
    
    Args:
        query: Строка поискового запроса
        max_results: Максимальное количество записей в ответе
    """
    try:
        # Логирование строго в stderr!
        sys.stderr.write(f"[MCP Python] Поиск: {query} (лимит: {max_results})\n")
        
        # Логика поиска
        results = [f"Результат #{i+1} для '{query}'" for i in range(max_results)]
        return "\n".join(results)
    except Exception as e:
        return f"Ошибка выполнения: {str(e)}"

if __name__ == "__main__":
    mcp.run(transport="stdio")
```

---

## 5. Полный цикл создания и подключения нового MCP сервера для ИИ-ассистента

Когда пользователь просит создать MCP инструмент или сервер:

1. **Создание структуры**:
   - Создай каталог для сервера (например, `.mcp/my-server/` или `mcp-servers/my-server/`).
   - Напиши файлы исходного кода (`src/index.ts` или `server.py`), `package.json` и `tsconfig.json`.
2. **Сборка и проверка**:
   - Выполни `npm install && npm run build` (для Node.js) или `pip install mcp` (для Python).
3. **Регистрация в Zipply**:
   - Вызови инструмент `manage_mcp`:
     ```json
     manage_mcp({
       "action": "add_server",
       "name": "my-server",
       "command": "node",
       "args": ["d:/path/to/project/.mcp/my-server/dist/index.js"],
       "cwd": "d:/path/to/project/.mcp/my-server",
       "server_description": "Пользовательский MCP сервер"
     })
     ```
4. **Верификация**:
   - Проверь подключение через `manage_mcp({ "action": "test_connection", "server_name": "my-server" })` или `manage_mcp({ "action": "list_tools" })`.
   - Новые инструменты сразу становятся доступны агенту для решения задач!

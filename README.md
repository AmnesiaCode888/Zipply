<div align="center">

# ⚡ Zipply

**Zipply - Simple Ai Agent**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg?logo=typescript)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-33-47848F.svg?logo=electron)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB.svg?logo=react)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF.svg?logo=vite)](https://vitejs.dev/)
[![License: BSL 1.1](https://img.shields.io/badge/License-BSL%201.1-orange.svg)](LICENSE)
[![Telegram](https://img.shields.io/badge/Telegram-@zipplyai-2CA5E0.svg?logo=telegram)](https://t.me/zipplyai)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux-lightgrey.svg)]()

*Zipply — это автономный, простой и производительный desktop AI-агент и среда разработки с мультиагентной архитектурой, поддержкой протокола MCP (Model Context Protocol), расширяемыми навыками (Skills), долгосрочной памятью и подключением любых LLM моделей.*

---

</div>

## ✨ Ключевые особенности / Features

### 🤖 Мультиагентная система (Multi-Agent Swarm)
Zipply координирует работу специализированных агентов через общую архитектуру Blackboard:
- **ZipplyAgent** — Главный автономный агент-разработчик с доступом к файловой системе и терминалу.
- **ArchitectAgent** — Системный архитектор: выполняет аудит репозитория, строит AST-карту архитектуры и проектирует пошаговый план работ без преждевременных правок.
- **WorkerAgent** — Специалист точечного исполнения задач: хирургические правки кода, сборки и тесты.
- **AskAgent** — Безопасный режим исследования: быстрые ответы на вопросы по коду без изменения файлов.
- **TerminalAgent** — Эксперт по консоли: выполнение shell-команд с потоковым выводом и умным сокращением логов.
- **WebSearchAgent** — Онлайн-поиск документации и свежей информации в реальном времени.

### 🔌 Model Context Protocol (MCP)
- Встроенный клиент **Model Context Protocol (MCP)** через `stdio`.
- **Ленивая загрузка схем инструментов**: минимальная нагрузка на контекст LLM.
- **Импорт в 1 клик**: полная совместимость с конфигами Cursor, Claude Desktop и Antigravity.
- Удобное визуальное управление серверами, переменными окружения и логами.

### 🧠 Динамические навыки (Skills Framework)
- Навыки в формате Markdown с YAML-метаданными и триггерами.
- **Векторный семантический поиск** (Embeddings) для автоматического нахождения нужного навыка по смыслу задачи.
- **Шлюз автоактивации (Turn-1 Auto-Enforcement)**: гарантирует загрузку профильных инструкций до начала изменений.
- Встроенный в приложение редактор навыков с подсветкой синтаксиса.

### 💾 Долгосрочная память (Long-Term Memory & Scratchpad)
- **Умное разрешение противоречий (Conflict Invalidation)**: новые факты и решения о проекте автоматически обновляют устаревшие записи.
- **Рабочий блокнот (Blackboard Scratchpad)**: сохраняет проверенные гипотезы и контекст между раундами работы агентов.

### 🌐 Поддержка любых провайдеров LLM
Подключайте напрямую любые API без посредников и комиссий:
- **Google Gemini** (`gemini-2.0-flash`, `gemini-2.0-pro`, `gemini-1.5-pro`)
- **Anthropic Claude** (`claude-3-5-sonnet`, `claude-3-5-haiku`)
- **OpenAI** (`gpt-4o`, `gpt-4o-mini`, `o1`, `o3-mini`)
- **Groq** (`llama-3.3-70b`, `deepseek-r1-distill-llama-70b`)
- **Ollama** (Локальные нейросети)
- **OpenRouter** и любые совместимые OpenAI-эндпоинты.

### 🛡️ Надёжность и отказоустойчивость
- **4-уровневый нечёткий дифференциальный движок (Fuzzy Diff Engine)**: устойчив к небольшим расхождениям строк, строго сохраняет отступы.
- **Классификация фатальных синтаксических ошибок**: автоматический откат правок, если модель допустила синтаксический сбой.
- **Smart Head/Tail Log Truncation**: сохраняет начало вывода, код завершения и stack trace, предотвращая переполнение контекста.

---

## 🚀 Быстрый старт / Getting Started

### Требования
- **Node.js** >= 18.0.0
- **npm** >= 9.0.0
- Git

### Установка и запуск

1. Клонируйте репозиторий:
   ```bash
   git clone https://github.com/AmnesiaCode888/zipply.git
   cd zipply
   ```

2. Установите зависимости:
   ```bash
   npm install
   ```

3. Запустите приложение в режиме разработки:
   ```bash
   npm run dev
   ```

---

## 📦 Сборка дистрибутивов / Packaging

Zipply поддерживает нативную сборку установщиков для Windows и Linux:

```bash
# Проверка типов и сборка бандлов
npm run build

# Windows инсталлятор NSIS (.exe)
npm run build:win

# Linux AppImage
npm run build:appimage

# Пакет Debian / Ubuntu (.deb)
npm run build:deb

# Пакет Void Linux (.xbps)
npm run build:xbps

# Собрать все дистрибутивы
npm run build:all
```

Готовые файлы создаются в каталоге `dist/`.

---

## 🧪 Тестирование / Verification

Запуск автоматических тестов:

```bash
# Проверка типов TypeScript
npm run typecheck

# Тесты компонентов агентов
npm run test:agent

# Тесты Skills, MCP и Memory
npm run test:skills

# Запуск всех тестов
npm test
```

---

## 📬 Сообщество и контакты / Community & Contacts

- 💬 **Telegram-канал и чат**: [https://t.me/zipplyai](https://t.me/zipplyai)
- ✉️ **Email для связи**: [amnesiacoder@gmail.com](mailto:amnesiacoder@gmail.com)
- 💼 **Коммерческое лицензирование и сотрудничество**: свяжитесь по почте или в Telegram.

---

## 📄 Лицензия / License

Проект распространяется под лицензией **Business Source License 1.1 (BSL 1.1)**:
- **Некоммерческое и личное использование**: Разрешено бесплатно для личных, академических и ознакомительных целей.
- **Коммерческое использование**: Использование в коммерческих проектах, коммерческих организациях или предоставление коммерческих сервисов требует получения коммерческой лицензии от правообладателя.

Подробности смотрите в файле [LICENSE](LICENSE).

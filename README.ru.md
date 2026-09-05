<div align="center">

  <p>
    <a href="README.md">English</a> &nbsp;|&nbsp; <strong>Русский</strong>
  </p>

  <img src="resources/icon.png" width="108" height="108" alt="Логотип Zipply" style="border-radius: 22px; box-shadow: 0 10px 30px rgba(0,0,0,0.4);" />

  # Zipply

  **Simple AI Agent**

  [![Release](https://img.shields.io/github/v/release/AmnesiaCode888/Zipply?include_prereleases&label=Релиз&logo=github&color=2563EB)](https://github.com/AmnesiaCode888/Zipply/releases)
  [![License](https://img.shields.io/badge/Лицензия-BSL%201.1-1E293B?logo=open-source-initiative&logoColor=white)](LICENSE)
  [![Telegram](https://img.shields.io/badge/Telegram-@zipplyai-229ED9?logo=telegram&logoColor=white)](https://t.me/zipplyai)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Electron](https://img.shields.io/badge/Electron-33-1E293B?logo=electron&logoColor=white)](https://www.electronjs.org/)
  [![React](https://img.shields.io/badge/React-18-1E293B?logo=react&logoColor=61DAFB)](https://reactjs.org/)

  <p>
    Автономный десктопный AI-ассистент разработчика и мультиагентная рабочая среда.<br/>
    Нативная интеграция Model Context Protocol (MCP), динамические навыки и долгосрочная память проекта.
  </p>

  <p>
    <a href="https://github.com/AmnesiaCode888/Zipply/releases/download/v0.4.0-beta/Zipply-0.4.0-win-x64.exe">
      <img src="https://img.shields.io/badge/Скачать_для_Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Скачать для Windows" />
    </a>
    &nbsp;
    <a href="https://github.com/AmnesiaCode888/Zipply/releases/download/v0.4.0-beta/Zipply-0.4.0-linux-x86_64.AppImage">
      <img src="https://img.shields.io/badge/Скачать_для_Linux-1E293B?style=for-the-badge&logo=linux&logoColor=white" alt="Скачать для Linux" />
    </a>
  </p>

</div>

---

## <img src="resources/icons/blue/bot.svg" width="22" height="22" /> Интерфейс рабочей среды

<div align="center">
  <img src="resources/demo.png" width="100%" alt="Интерфейс Zipply" style="border-radius: 12px; border: 1px solid rgba(255,255,255,0.12); box-shadow: 0 16px 48px rgba(0,0,0,0.5);" />
</div>

---

## <img src="resources/icons/blue/sparkles.svg" width="22" height="22" /> Мультиагентный рой

Zipply координирует специализированных агентов через общую архитектуру доски задач (Blackboard):

| Агент | Роль | Зона ответственности и возможности |
| :--- | :--- | :--- |
| <img src="resources/icons/blue/bot.svg" width="18" height="18" /> **ZipplyAgent** | Ведущий инженер | Полный доступ к файловой системе, выполнение CLI-команд, многошаговое исправление ошибок |
| <img src="resources/icons/blue/compass.svg" width="18" height="18" /> **ArchitectAgent** | Системный архитектор | Анализ AST без мутации кода, проектирование архитектурных планов, аудит связей |
| <img src="resources/icons/blue/hammer.svg" width="18" height="18" /> **WorkerAgent** | Точечный исполнитель | Быстрое внесение диффов в код, сборка и верификация тестами |
| <img src="resources/icons/blue/search.svg" width="18" height="18" /> **AskAgent** | Исследователь кода | Семантический поиск по кодовой базе, быстрые ответы на вопросы без изменения файлов |
| <img src="resources/icons/blue/terminal.svg" width="18" height="18" /> **TerminalAgent** | Оператор консоли | Стриминговое выполнение шелл-команд, умная обрезка логов, фильтрация ошибок |
| <img src="resources/icons/blue/globe.svg" width="18" height="18" /> **WebSearchAgent** | Онлайн-исследователь | Поиск актуальной информации и документации в интернете в реальном времени |

---

## <img src="resources/icons/blue/cpu.svg" width="22" height="22" /> Поддерживаемые AI-провайдеры

Прямое подключение к API передовых моделей без обязательных подписок или сторонних прокси:

<div align="center">

[![Gemini](https://img.shields.io/badge/Google_Gemini-3.8_Flash_%7C_3.1_Pro-2563EB?style=flat-square&logo=googlegemini&logoColor=white)](https://ai.google.dev/)
[![Anthropic](https://img.shields.io/badge/Anthropic-Claude_Fable_5.1_%7C_Opus_5-1E293B?style=flat-square&logo=anthropic&logoColor=white)](https://anthropic.com/)
[![OpenAI](https://img.shields.io/badge/OpenAI-GPT--6_Astra_%7C_5.6_Luna-1E293B?style=flat-square&logo=openai&logoColor=white)](https://openai.com/)
[![DeepSeek](https://img.shields.io/badge/DeepSeek-V4_Flash_%7C_V4_Pro-2563EB?style=flat-square&logo=deepseek&logoColor=white)](https://deepseek.com/)
[![Ollama](https://img.shields.io/badge/Ollama-Local_Self--Hosted_Models-1E293B?style=flat-square&logo=ollama&logoColor=white)](https://ollama.ai/)
[![OpenRouter](https://img.shields.io/badge/OpenRouter-Universal_API-1E293B?style=flat-square&logo=openrouter&logoColor=white)](https://openrouter.ai/)

</div>

* **Google Gemini** — Gemini 3.8 Flash, Gemini 3.7 Flash, Gemini 3.1 Pro
* **Anthropic Claude** — Claude Fable 5.1, Claude Opus 5, Claude Sonnet 5
* **OpenAI** — GPT-6 Astra, GPT-5.6 Luna, GPT-5.6 Terra
* **DeepSeek** — DeepSeek-V4 Flash, DeepSeek-V4 Pro, DeepSeek-V3.2
* **Ollama** — Локальные self-hosted модели (DeepSeek-V4, Llama 4, Qwen 3)
* **OpenRouter** и любые совместимые OpenAI API эндпоинты

---

## <img src="resources/icons/blue/puzzle.svg" width="22" height="22" /> Ключевые возможности

### <img src="resources/icons/blue/puzzle.svg" width="18" height="18" /> Model Context Protocol (MCP)
* Нативный stdio-клиент MCP.
* Кэширование схем инструментов на диске для экономии контекста нейросети.
* Импорт конфигов серверов из Cursor, Claude Desktop и Antigravity в один клик.
* Управление статусом серверов, переменными окружения и правами доступа прямо в приложении.

### <img src="resources/icons/blue/sparkles.svg" width="18" height="18" /> Динамическая система навыков (Skills)
* Навыки на основе Markdown с фронтматтером условий запуска и строгими директивами.
* Семантический векторный поиск (эмбеддинги) для релевантной активации навыков по контексту задачи.
* Встроенный редактор навыков с подсветкой синтаксиса и валидацией схем.

### <img src="resources/icons/blue/brain.svg" width="18" height="18" /> Долгосрочная память и Blackboard
* Тематическое разрешение конфликтов: новые решения архитектора автоматически замещают устаревшие предположения.
* Рабочая память Blackboard для отслеживания текущих гипотез и промежуточных результатов между сабагентами.

### <img src="resources/icons/blue/shield-check.svg" width="18" height="18" /> Движок надёжности и устойчивости
* 4-уровневый fuzzy diff engine с алгоритмом Левенштейна и сохранением отступов.
* Классификация критических синтаксических ошибок с автоматическим откатом некорректных правок.
* Интеллектуальная обрезка логов (head/tail), сохраняющая ключевые трассировки ошибок и коды завершения.

---

## <img src="resources/icons/blue/download.svg" width="22" height="22" /> Готовые сборки (v0.4.0-beta)

| Платформа | Формат | Архитектура | Прямая ссылка |
| :--- | :--- | :--- | :--- |
| **Windows** | Установщик NSIS (`.exe`) | x64 | [`Zipply-0.4.0-win-x64.exe`](https://github.com/AmnesiaCode888/Zipply/releases/download/v0.4.0-beta/Zipply-0.4.0-win-x64.exe) |
| **Linux (Портативный)** | AppImage | x86_64 | [`Zipply-0.4.0-linux-x86_64.AppImage`](https://github.com/AmnesiaCode888/Zipply/releases/download/v0.4.0-beta/Zipply-0.4.0-linux-x86_64.AppImage) |
| **Debian / Ubuntu** | Пакет (`.deb`) | amd64 | [`zipply-0.4.0-linux-amd64.deb`](https://github.com/AmnesiaCode888/Zipply/releases/download/v0.4.0-beta/zipply-0.4.0-linux-amd64.deb) |
| **Void Linux** | Пакет (`.xbps`) | x86_64 | [`zipply-0.4.0_1.x86_64.xbps`](https://github.com/AmnesiaCode888/Zipply/releases/download/v0.4.0-beta/zipply-0.4.0_1.x86_64.xbps) |

> [!TIP]
> Все установочные пакеты, контрольные суммы SHA256 и список изменений доступны на вкладке [GitHub Releases](https://github.com/AmnesiaCode888/Zipply/releases).

---

## <img src="resources/icons/blue/zap.svg" width="22" height="22" /> Разработка и сборка

### Предварительные требования
* Node.js >= 18.0.0
* npm >= 9.0.0
* Git

### Быстрый старт
```bash
# Клонирование репозитория
git clone https://github.com/AmnesiaCode888/Zipply.git
cd Zipply

# Установка зависимостей и запуск в режиме разработки
npm install
npm run dev
```

### Команды сборки пакетов
```bash
# Сборка исходного кода
npm run build

# Сборка установщиков для платформ
npm run build:win       # Windows NSIS (.exe)
npm run build:appimage  # Linux AppImage
npm run build:deb       # Debian / Ubuntu (.deb)
npm run build:xbps      # Void Linux (.xbps)
npm run build:all       # Сборка под все поддерживаемые ОС
```

### Верификация и тесты
```bash
npm run typecheck       # Проверка типов TypeScript (Main, Renderer, Preload)
npm run test:agent      # Тесты оркестрации автономных агентов
npm run test:skills     # Тесты навыков, MCP и долгосрочной памяти
npm test                # Полный запуск всех наборов тестов
```

---

## <img src="resources/icons/blue/users.svg" width="22" height="22" /> Сообщество и контакты

* **Telegram**: [@zipplyai](https://t.me/zipplyai)
* **Email**: [amnesiacoder@gmail.com](mailto:amnesiacoder@gmail.com)
* **Коммерческие вопросы**: Свяжитесь по email или в Telegram для получения коммерческой лицензии, индивидуальных доработок и корпоративного внедрения.

---

## <img src="resources/icons/blue/file-text.svg" width="22" height="22" /> Лицензия

Проект распространяется по лицензии **Business Source License 1.1 (BSL 1.1)**:
* **Некоммерческое и ознакомительное использование**: Полностью бесплатно для личных целей, обучения и тестирования.
* **Коммерческое использование**: Применение в коммерческих организациях, продакшене или коммерческих сервисах требует получения письменной коммерческой лицензии от автора.

Полный текст условий смотрите в файле [LICENSE](LICENSE).

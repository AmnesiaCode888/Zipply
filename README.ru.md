<div align="center">

  <p>
    <a href="README.md">English</a> &nbsp;|&nbsp; <strong>Русский</strong>
  </p>

  <img src="resources/icon.png" width="108" height="108" alt="Логотип Zipply" />

  # Zipply

  **Автономная десктопная AI-среда разработки**

  [![Website](https://img.shields.io/badge/Сайт-zipply.my-2563EB?style=flat-square&logo=googlechrome&logoColor=white)](https://zipply.my)
  [![Version](https://img.shields.io/badge/Версия-0.1.0-1E293B?style=flat-square&logo=github&logoColor=white)](https://github.com/AmnesiaCode888/Zipply/releases)
  [![Telegram](https://img.shields.io/badge/Telegram-@zipplyai-229ED9?style=flat-square&logo=telegram&logoColor=white)](https://t.me/zipplyai)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Electron](https://img.shields.io/badge/Electron-33-1E293B?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
  [![React](https://img.shields.io/badge/React-18-1E293B?style=flat-square&logo=react&logoColor=61DAFB)](https://reactjs.org/)

  <p>
    Десктопный AI-ассистент разработчика с оркестрацией субагентов, гибкими уровнями доступа,<br/>
    поддержкой Model Context Protocol (MCP), динамическими навыками и встроенными плагинами.
  </p>

  <p>
    <a href="https://zipply.my">
      <img src="https://img.shields.io/badge/Скачать_на-zipply.my-2563EB?style=for-the-badge&logo=windows&logoColor=white" alt="Скачать на zipply.my" />
    </a>
    &nbsp;
    <a href="https://github.com/AmnesiaCode888/Zipply/releases">
      <img src="https://img.shields.io/badge/GitHub-Релизы-1E293B?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Релизы" />
    </a>
  </p>

</div>

---

## Мультиагентная архитектура и модели

Zipply объединяет основного инженера (`ZipplyAgent`) со специализированными субагентами, которые координируются через общую рабочую память (`Blackboard`) и могут работать в изолированных Git worktree:

| Компонент | Роль | Возможности |
| :--- | :--- | :--- |
| **ZipplyAgent** | Ведущий инженер | Планирование, редактирование файлов, патчи, запуск команд и верификация результата |
| **Explorer** | Исследователь кода | Быстрая навигация по проекту, поиск символов и анализ архитектуры без правок |
| **Reviewer** | Ревьюер изменений | Аудит диффов, проверка тестов/сборки и поиск проблем |
| **Worker** | Параллельный исполнитель | Выполнение изолированных подзадач (в том числе в отдельном Git worktree) |

### Доступные модели и уровни рассуждений

| Модель | Контекстное окно | Уровни рассуждений | Примечание |
| :--- | :--- | :--- | :--- |
| **Zipply Pro** | `500K` токенов | `off` · `low` · `high` · `max` | Основная модель для сложных задач разработки |
| **Zipply Lite** | `500K` токенов | `off` · `low` · `high` · `max` | Лёгкая и быстрая модель для повседневных задач |
| **Zipply Ultra** | `500K` токенов | — | Готовится к запуску |

---

## Ключевые возможности

### Инструменты агента и анализ кода
* **Точная работа с кодом**: `read_file`, `read_files`, `write_file`, `edit_file`, `apply_patch`, `find_files`, `search_project` и `verify_file`.
* **Code Intelligence**: встроенный анализ TypeScript-проектов, Python (`pyright`) и универсальный поиск символов/ссылок.
* **Веб-поиск и проверка в браузере**: `search_web`, `read_page` и `browser_verify` на базе `playwright-core`.
* **Терминал и процессы**: выполнение команд (`exec_command`, `write_stdin`) и встроенный терминал в боковой панели на `xterm.js` + `node-pty`.

### Режимы доступа и безопасность
Для каждого диалога можно выбрать уровень автономности агента:
* **Только чтение** (`read-only`) — изучение кода и ответы на вопросы без изменений.
* **С подтверждением** (`confirm`) — запрос разрешения перед правками и командами.
* **Автоматически** (`automatic`) — агент работает сам, но запрашивает подтверждение для опасных команд.
* **Полный доступ** (`unrestricted`) — выполнение задач без подтверждений с защитой путей за пределами рабочей папки.

### Встроенные плагины (подключаются через `plugin_manager`)
* **CyberSec** — аудит кода и конфигов (Nginx/Apache) на секреты и рискованные настройки, проверки DNS, TLS, HTTP-заголовков и TCP-портов.
* **SQLite** — безопасный read-only просмотр таблиц, схем и ограниченных `SELECT`-запросов.
* **Анализатор PDF** — извлечение текстового слоя, числа страниц и метаданных PDF-документов внутри рабочей папки.

### Model Context Protocol (MCP) и динамические навыки
* **MCP-клиент**: поддержка `stdio` и `http` серверов с гранулярным доверием к инструментам (`McpTrustStore`).
* **Навыки (`Skills`)**: загрузка, поиск, создание и импорт переиспользуемых инструкций `SKILL.md` на уровне проекта, пользователя и пакетов.

### Рабочая среда и надёжность
* **Боковая панель проекта**: дерево файлов, просмотр изменений (`WorkspaceChangesService`) и вкладки терминала.
* **Сохранение состояния**: чекпоинты диалогов, журнал запусков (`RunJournal`), автоматическое сжатие контекста (`ContextCompactor`) и экспорт/импорт чатов в `.zip` и `.json`.
* **Шифрование секретов**: хранение OAuth-токенов и ключей через системный `safeStorage` (`SecretStore`).

---

## Над чем мы сейчас работаем

Основные направления, которые мы сейчас активно развиваем и улучшаем:

* **Сабагентная система** — более точное распределение параллельных задач, слаженная координация `Explorer`, `Reviewer` и `Worker` и наглядное отображение их работы в реальном времени.
* **Удобный интерфейс** — ещё более плавные сценарии работы, понятное отображение активности и диффов и дальнейшая шлифовка минималистичного интерфейса.

---

## Скачивание

Текущая версия: **`v0.1.0`**. Готовые сборки для **Windows** (установщик `.exe` NSIS) и **Linux** (`.AppImage`, `.deb`, `.pkg.tar.zst`) доступны на официальных страницах:

* **Официальный сайт**: [zipply.my](https://zipply.my)
* **GitHub Releases**: [github.com/AmnesiaCode888/Zipply/releases](https://github.com/AmnesiaCode888/Zipply/releases)

> [!NOTE]
> Ранние сборки `v0.5.0-beta` из предыдущей кодовой базы отмечены как pre-release на странице [Релизов](https://github.com/AmnesiaCode888/Zipply/releases).

---

## Разработка и сборка

### Требования
* **Node.js** >= 18.0.0
* **npm** >= 9.0.0
* **Git**

### Быстрый старт
```bash
# Клонирование репозитория
git clone https://github.com/AmnesiaCode888/Zipply.git
cd Zipply

# Установка зависимостей и запуск в режиме разработки
npm install
npm run dev
```

### Сборка и CLI
```bash
npm run typecheck       # Проверка типов TypeScript (Node + Web)
npm run build           # Проверка типов и сборка Main, Preload и Renderer
npm run start           # Предпросмотр собранного Electron-приложения
npm run build:cli       # Сборка автономного CLI агента (out/cli/zipply-agent.cjs)
```

### Тестирование
```bash
npm test                # Запуск unit- и интеграционных тестов
npm run test:e2e        # Сборка и запуск E2E-тестов (Playwright)
npm run agent:eval      # Сборка CLI и прогон harness-оценки агента
```

---

## Сообщество и контакты

* **Сайт**: [zipply.my](https://zipply.my)
* **Telegram**: [@zipplyai](https://t.me/zipplyai)
* **Email**: [support@zipply.my](mailto:support@zipply.my)

---

## Лицензия

Проект распространяется по лицензии **Business Source License 1.1 (BSL 1.1)** (см. [LICENSE](LICENSE)):
* **Некоммерческое и ознакомительное использование**: бесплатно для личных целей, обучения и тестирования.
* **Коммерческое использование**: применение в коммерческих организациях, продакшене или SaaS требует письменной коммерческой лицензии от автора (`support@zipply.my` / [@zipplyai](https://t.me/zipplyai)).

# Zipply: план доведения навыков, MCP, плагинов и самообучения

**Статус:** исследование и целевая архитектура; реализация начата, но ещё не завершена.

**Срез реализации на 2026-11-26:** подключён registry client MCP; разнесены сохранение, соединение и загрузка схем; поиск инструментов ограничивает автоматическое соединение тремя подходящими HTTP-серверами и не запускает stdio; grants MCP привязаны к конфигурации сервера и fingerprint схемы, отзываются при смене авторизации, а ожидающее подтверждение отменяется; `search_skills` и `load_skill` доступны при пустой библиотеке и обновляют каталог в текущем запуске; связанные MCP tool refs навыка могут подключить только уже настроенный удалённый HTTP-сервер; добавлены поиск/установка навыков skills.sh по точному slug и закреплённому Git commit, полная установка package directory в `~/.agents/skills`, загрузка текстовых support-файлов и app-owned provenance manifest. Запуск скриптов навыка не добавлен. Тесты, typecheck и сборка в этой реализации не запускались.

**Что ещё остаётся:** подключить дополнительные provider-ы и определить fallback для каталога; UI для provenance, версий, обновления, отключения и rollback; исполняемые скрипты навыка как отдельные ограниченные tool providers; оценка предложений самообучения, версии и откат. Нынешний `propose_skill` остаётся черновиком, который активируется после решения пользователя.

**Цель:** сделать расширения понятными модели и человеку, доступными между чатами в выбранной области, совместимыми с открытым форматом Agent Skills и предсказуемыми по разрешениям. Фраза «найди и установи навык» должна запускать настоящий поиск и установщик; поиск MCP-инструмента должен отдавать схему подходящего инструмента без ручной цепочки обходных команд; самообучение должно иметь версии, доказательства пользы и откат.

## Решение в одном абзаце

Оставить навыки, MCP и плагины разными типами возможностей, но дать им общий каталог и один центральный движок разрешений. Навык — пакет инструкций и файлов; MCP — соединение с удалённым или локальным сервером, который публикует инструменты; плагин — пакет, который объединяет навыки и подключения, а исполняемый код плагина — отдельный более строгий класс. Модель сначала видит компактные метаданные, затем раскрывает только выбранный текст или схему. Установка текстового навыка по прямой просьбе не должна вызывать дополнительное окно подтверждения. Доступ к новому внешнему серверу, OAuth, секретам, локальному процессу и инструментам с существенными последствиями оформляется отдельным, узким решением. Автообучение включается только после ручного режима, истории версий, отката и оценки кандидатов.

## 1. Что показало исследование других систем

Исследованы публичные исходники и официальные документы Codex, Hermes Agent, OpenClaw, Gemini CLI, OpenCode и Pi. Для Claude Code исходник runtime не публичен, поэтому его поведение ниже основано на официальной документации, а не на догадках об устройстве кода.

| Система | Как модель находит и загружает возможности | Разрешения и подключения | Что стоит взять в Zipply |
|---|---|---|---|
| **Codex** | Компактный список skills по имени, описанию и пути; полное тело читается при выборе. Для большого каталога MCP используется отложенный `tool_search`, который раскрывает точные схемы выбранных инструментов. Встроенный `skill-installer` — сам skill с инструкциями и helper-скриптами, а не особая магическая команда. | Sandbox и approval policy раздельны. Настроенный MCP, проектное доверие, OAuth, вызов MCP-инструмента и локальная сеть имеют отдельные настройки. | Реальный tool discovery, progressive disclosure и явное различение «разрешено запустить команду» и «MCP подключён/одобрен». Codex skill-installer для неопределённого запроса может показать варианты; Zipply должен использовать делегированную пользователем свободу выбора, если он прямо сказал «любой подходящий». |
| **Claude Code** | Описание skill доступно для автоматического выбора; тело читается при вызове. MCP tools по умолчанию могут загружаться отложенно через ToolSearch. Публичной универсальной команды для скачивания отдельного SKILL.md нет; каталог и установка в основном идут через плагины. | `bypassPermissions` снимает обычные локальные запросы, но не все project trust, per-tool `ask` и специальные требования взаимодействия MCP. | Не путать полный доступ к workspace с доверием к новому серверу или аккаунту. Один запрос пользователя должен авторизовать конкретное действие, а не все будущие интеграции. |
| **Hermes Agent** | Раздельные `skills_list` и `skill_view`; установка из Hub/Git/URL — отдельный путь; агент пишет и обновляет skills через `skill_manage`. MCP-discovery вынесен из импорта tool registry и управляется своим lifecycle. | MCP-каталог показывает источник, transport, setup, auth и возможный список инструментов. Установка MCP и выбор доступных инструментов разделены. Запись агентских skills может иметь отдельный переключатель review; background review сканируется строже. | Полный lifecycle навыка и интеграции, явный источник, выбор tools на сервере, возможность управлять установкой и загрузкой без ручного редактирования JSON. Approval должен быть настраиваемым policy, а не скрытой логикой каждого Tool. |
| **OpenClaw** | ClawHub/Git/local install отделён от Skill Workshop, где агент создаёт и обновляет свои процедурные skills. `/learn` работает как явная команда; Workshop отдельно умеет фоновое обучение в `off / propose / auto`. Сохраняется предыдущая версия, есть undo. | Состояние, агентские skills, пользовательская библиотека, проектные skills и Workshop — разные источники и области. Фоновый review использует контекст разговора и вызывает модель повторно, поэтому имеет стоимость и последствия для приватности. | Разделить установку чужих skills и обучение своим; хранить историю, diff и undo; отделять процедуры от фактов/памяти и знаний конкретного репозитория. Не переносить auto-review без измерений и понятного управления приватностью. |
| **OpenCode** | Список ID/имён/описаний; отдельный skill tool загружает выбранный текст и даёт корневую папку для чтения соседних файлов. | Общие правила `allow / ask / deny` по типу действия и ресурсу; последнее совпавшее правило имеет приоритет. «Allow always» сохраняет грант конкретному действию/ресурсу; hard deny остаётся сильнее. MCP tools имеют отдельные идентификаторы и права. | Единая декларативная policy-модель с конкретными ресурсами, а не набор исключений в ToolExecutor; сохранённые разрешения должны быть видны, ограничены и отзываемы. |
| **Gemini CLI** | Skills устанавливаются из Git/URL/path; MCP-серверы обнаруживают опубликованные схемы и поддерживают include/exclude. Схема не равна разрешению на вызов. | Настройки могут явно ограничить серверы и tools; чувствительные переменные окружения не передаются локальному MCP-процессу автоматически. Отдельные approval modes и per-tool policy управляют вызовами. | Allowlist инструментов, разделение установщика от активации/исполнения, минимальная передача секретов в stdio. |
| **Pi** | Несколько режимов экспозиции MCP: direct, deferred, code mode и hidden; общий pipeline вызова. Пакеты могут объединять skills, MCP и executable extensions. | Политика строится вокруг конкретного tool и источника; аннотации сервера не считаются надёжным правом. | Позже можно добавить режимы экспозиции и составные пакеты; сейчас сначала сделать один хороший deferred search и безопасную границу executable-кода. |

### Повторяющиеся зрелые практики

1. **Каталог не является установщиком и не является разрешением.** Найти, загрузить, установить, подключить сервер, получить OAuth и вызвать инструмент — разные состояния.
2. **Модель видит метаданные раньше содержимого.** Инструкции skill и MCP schemas добавляются только после выбора релевантного результата.
3. **Tools выбираются конкретно.** Большой MCP-сервер не должен без необходимости отправлять модели все свои схемы.
4. **Подтверждения зависят от класса операции.** Загрузка безвредного текста, запись в проект, старт локального процесса, новый внешний сервер, секреты, публикация и необратимое действие не являются одним уровнем риска.
5. **Самообучение — редактирование версионируемых артефактов, а не обучение весов модели.** Нужны базовая версия, причина, diff, история, проверка и откат.

## 2. Текущая архитектура Zipply и подтверждённые пробелы

Проект уже содержит полезные основания: `SkillRepository` сканирует обычные корни `.agents/skills` и `.claude/skills`, может читать `metadata.zipply_tools`, проверяет ревизию и containment путей; `McpRuntimeManager` поддерживает stdio и Streamable HTTP, отмену соединения и обновление каталога; `McpConfigStore` хранит конфигурацию профиля, а HTTP-заголовки уходит в `SecretStore`; `PluginManagerTool` умеет показывать плагины и лениво подгружать один инструмент. Встроенный каталог плагинов сейчас содержит CyberSec.

Ниже описан аудит текущих файлов. MCP- и skill-файлы с датой 26 ноября и часть IPC/agent-файлов в этом рабочем дереве находятся в состоянии незавершённого WIP. Они не должны считаться согласованным или проверенным поведением.

### Skills

- `src/main/agent/index.ts` добавляет `search_skills` и `load_skill` только если уже найдён хотя бы один model-invocable skill. Пустая библиотека означает, что у модели нет даже инструмента поиска и нет естественного маршрута «найди/установи навык».
- `search_skills` ищет только установленные локальные метаданные. Инструмента `install_skill` и удалённого поиска каталога для agent runtime нет.
- `SkillImportService.importFile()` принимает `SKILL.md` или ZIP с одним `SKILL.md`, но извлекает только этот Markdown. Соседние `references/`, `scripts/` и `assets/` отбрасываются. `SkillRepository.loadBody()` тоже возвращает только текст инструкции.
- `propose_skill` создаёт только новый неактивный черновик. `getApprovalRequest()` принудителен независимо от `accessMode`; затем UI ещё отдельно требует принять черновик. Нет правки существующего навыка, diff активной версии, истории версий и rollback.
- `metadata.zipply_tools` связывает навык с уже существующими core/plugin/MCP инструментами. Это полезное основание, но сама ссылка не устанавливает плагин, не подключает MCP и не выдаёт инструменту право на вызов. При отсутствии зависимости UI/модель должна видеть точный статус и способ исправить его.
- Есть общие roots, но нужно свести их к одному resolver с понятной областью и приоритетом. Плановый user-level install должен по умолчанию идти в стандартный `~/.agents/skills`, project-level — в `.agents/skills`; Zipply userData skill-root сохраняется как совместимый legacy/source до миграции.

### MCP и инструменты

- `search_tools` ищет только среди инструментов, уже допущенных к текущему запуску. Для MCP сначала нужно выбрать/подключить сервер, затем искать метаданные, затем отдельно вызвать `manage_mcp(load)`, чтобы добавить схему. Текущий текст об успехе установки обещает более короткий маршрут, чем реализован.
- `McpToolAdapter.getApprovalRequest()` всегда создаёт approval; в `ToolExecutor` `explicitApproval` безусловно включает этот путь даже при `accessMode === 'unrestricted'`. Для доверенного tool `AgentIpcHandler` может обойти prompt по сохранённому `serverId + toolId`.
- `McpTrustStore` не привязывает разрешение к конфигурации сервера, проекту/профилю и ревизии схемы. Если тот же `toolId` позже меняет `description` или `inputSchema`, старый trust может остаться действительным.
- MCP profile сервер не гарантированно доступен всем chats в выбранной области: есть текущая per-chat механика, но внедрённые методы `listChatServers`, `grantChatAccess`, `clearChat`, `add` не совпадают с текущим интерфейсом `McpConnectionService`.
- `main/index.ts` не передаёт в `McpConnectionService` созданный `McpRegistryClient`; `runAgent` вызывает `connectCatalog(serverId, signal)`, когда текущая реализация ожидает registry `serverName`, подтверждённый endpoint и сигнал. `connectConfigured()` при бездумном использовании может стартовать все локальные stdio процессы. Сначала нужно определить контракт и фильтр по типу транспорта.
- Интеграционные тесты MCP, IPC и renderer присутствуют в дереве, но текущие untracked файлы и незакоммиченные изменения широкие. После завершения P0 нужно зафиксировать фактическую компиляцию и профильные тесты как отдельную работу.

### Plugins и самостоятельное обучение

- `PluginManager` принимает только IDs из встроенного списка; сейчас это один исполняемый CyberSec пакет. Публичного общего install/update/rollback API для пакетов нет.
- `SearchExtensionToolsTool` не является единым поиском возможностей: он ищет описания в доступном на этот запуск каталоге, а `search_skills` ищет другую локальную базу.
- `SkillProposalStore` сохраняет evidence `sourceRunId`, что пригодится для обучения, но сейчас нет типизированного `RunLearningEvidence`, обновления существующих skills, независимого replay/eval и состояния «candidate failed / candidate improved».
- Любая версия самообучения должна различать «создать навык из проверенной процедуры» и «сохранить факт/предпочтение»; проектные знания должны оставаться в документации репозитория/AGENTS.md, а не загрязнять личную библиотеку процедур.

## 3. Целевая продуктовая модель

Ввести общий `ExtensionCatalogService` в main process и нормализованный capability record:

```ts
type CapabilityKind = 'skill' | 'plugin' | 'mcp_server' | 'mcp_tool' | 'mcp_resource' | 'mcp_prompt'
type Availability = 'installed' | 'configured' | 'disabled' | 'needs_auth' | 'connecting' | 'available' | 'missing_dependency' | 'failed'
type Scope = 'profile' | 'project' | 'session'

interface CapabilityRecord {
  kind: CapabilityKind
  id: string
  name: string
  description: string
  source: string
  scope: Scope
  revision: string
  availability: Availability
  dependencies?: string[]
  riskSummary?: string[]
}
```

Каждый запуск получает snapshot конкретной области. Операции записи каталога и разрешений проходят через main process; renderer и модель не могут подделать scope, fingerprint или статус доверия.

### Термины, которые UI и модель используют одинаково

- **Найти:** получить метаданные от выбранного каталога или локального repository.
- **Установить:** сохранить пакет в user/project root и записать происхождение. Установка text-only skill не исполняет файлы.
- **Подключить:** сохранить/включить MCP server и настроить auth. Происхождение каталога не означает доверие к удалённому сервису.
- **Загрузить:** добавить выбранные инструкции или schema в модельный контекст/набор инструментов текущего запуска.
- **Вызвать:** передать конкретные аргументы выбранному инструменту с применением централизованной policy.
- **Научиться:** сформировать собственный candidate из повторяемой процедуры и фактов текущей работы; обновление active skill создаёт новую revision.

Общий поиск возвращает однообразные карточки с видом возможности, областью, источником, статусом и доступным следующим действием. Для навыка он грузит один выбранный `SKILL.md`; для MCP — раскрывает только одну или несколько наиболее релевантных схем; для плагина — показывает один конкретный tool. Поиск сам ничего не устанавливает, не запускает и не вызывает.

## 4. Целевая политика полномочий и подтверждений

### Почему full access сейчас не снимает prompts

В Zipply `unrestricted` применяется внутри общего `ToolExecutor` к части локальных команд. Но отдельное `getApprovalRequest()` всегда имеет приоритет, а MCP adapter и `ProposeSkillTool` такие запросы задают безусловно. Поэтому текущая настройка разрешает одни операции и не влияет на другие. Это не «одна сломанная кнопка», а неполная модель политик.

### Один центральный policy decision

Реализовать `AuthorizationService.evaluate(request) -> allow | ask | deny` на стороне main. Решение учитывает action, scope, intent текущей пользовательской просьбы, происхождение capability, локальную policy, сохранённый грант и fingerprint. Hard deny и недоступность sandbox имеют приоритет над остальными правилами; модель сама не может изменить policy.

Минимальные scopes для сохранённых решений:

- один вызов;
- конкретный MCP tool на конкретном сервере;
- профиль пользователя или конкретный проект;
- расширенное доверие серверу — отдельное решение, не выбранное по умолчанию.

MCP tool grant связывается как минимум с `serverId + normalized endpoint/config hash + toolId + remoteName + description hash + inputSchema hash + scope`. Дрейф конфигурации или схемы автоматически отзывает соответствующий grant и показывает причину. Trust не должен привязываться только к стабильному ID.

### Ожидаемое поведение режимов

| Операция | Read-only | Workspace-write | Full access |
|---|---|---|---|
| Поиск, чтение каталога, чтение локального skill | Разрешить | Разрешить | Разрешить |
| Прочитать выбранный skill и его reference | Разрешить | Разрешить | Разрешить |
| Установить text-only skill после прямой просьбы пользователя | Запретить установку | Установить в явно выбранную область без второго prompt; сообщить источник/версию | Установить выбранный подходящий skill без второго prompt; сообщить источник/версию |
| Записать/обновить skill проекта | Запретить | Создать candidate; active update требует review policy | Разрешить обновление по явному запросу; фиксировать revision/diff и дать undo |
| Подключить MCP, прямо названный пользователем | Заблокировать мутацию состояния либо запросить смену режима | Один предметный шаг для нового внешнего ресурса, если намерение/цель неоднозначны | Прямое указание пользователя позволяет выполнить названное подключение без повторного окна; OAuth и provider consent остаются отдельным внешним шагом |
| Установить MCP server с локальным процессом/package install | Запретить | Отдельный обзор команды/источника и один узкий prompt | Один prompt только когда запускается неизвестный локальный код или ставятся зависимости; не повторять на каждое подключение с тем же fingerprint |
| Вызвать уже разрешённый MCP tool | Запретить внешние действия | Использовать сохранённый точный tool grant; иначе разовый prompt только при выходе за scope/передаче новых данных/существенном риске | Использовать сохранённый точный tool grant; user request авторизует конкретное требуемое действие; не спрашивать заново без изменения риска, scope или fingerprint |
| Необратимое действие, передача секретов, удаление/публикация/платёж | Запретить или требовать отдельный explicit request | Всегда отдельная policy/confirmation | Сохранённый общий trust не отменяет явное подтверждение необратимой операции |

«Без второго окна» не означает скрытого действия: в transcript остаётся, что установлено или подключено, откуда, в какой scope и что доступно агенту. Если текст каталога не даёт безопасно выбрать один навык или источник, модель может спросить о предпочтении — это вопрос о недостающем выборе, а не подтверждение уже запрошенного действия.

MCP-аннотации `readOnlyHint`, `destructiveHint` и описания — недоверенные подсказки. На них можно построить risk review только совместно с provenance, локальной policy и возможными side effects; они сами не выдают права.

## 5. Поэтапный план реализации

### P0 — зафиксировать контракты и убрать рассинхронизацию WIP

**Область:** `src/main/index.ts`, `src/main/agent/index.ts`, `McpConnectionService.ts`, `ManageMcpTool.ts`, `AgentIpcHandler.ts`, `McpRegistryClient.ts`, тесты MCP.

- Определить понятные методы сервиса: `add`, `connectSaved`, `searchRegistry`, `installRegistryEntry`, `connect`, `remove`, `list`, `clearSessionAccess` либо заменить временную per-chat access модель согласованной profile/project scope моделью.
- В main создавать один `McpRegistryClient` и внедрять его в сервис. Registry-операции должны принимать точное registry name, resolver endpoint/revision и `AbortSignal` раздельно.
- Сохранить различие `configured / connected / authenticated / tools discovered`. При отмене нового install удалить временную регистрацию и не сохранять конфиг.
- Отделить поиск каталога от соединения. Discovery по общим метаданным не должно стартовать все stdio сервера.
- Поправить описания инструментов так, чтобы они отражали реально выполняемый следующий шаг. Не говорить, что `search_tools` активирует schema, пока это не реализовано.
- Установить интерфейсный контракт между desktop UI, IPC и agent runtime для списков расширений и одних и тех же операций управления.

**Приёмка P0:** нет несовпадений параметров между caller/callee; registry search доступен из единого инстанса; существующий settings UI сохраняет/подключает серверы; отмена не оставляет зомби; проблема одного сервера не мешает списку остальных. После этого зафиксировать typecheck, профильные MCP/IPC тесты и baseline тестового набора. Код текущего состояния нельзя маркировать завершённым до этого этапа.

### P1 — общее разрешение и управление довериями

**Область:** `ToolExecutor`, `ToolBase`, `AgentIpcHandler.confirmAction`, `McpToolAdapter`, `McpTrustStore`, approval UI, settings.

- Вынести условие `explicitApproval || external || accessMode ...` в единый `AuthorizationService`; удалить безусловные prompts из отдельных tool классов и объявлять у них действия/risk/features.
- Различать `allow / ask / deny`, причины решения, разрешённые scope и `userIntent`. Отказ не превращать в бесконечную повторную просьбу; deny должен возвращаться модели как инструментальный результат с предложенным безопасным продолжением.
- Добавить «разрешить один раз», «разрешить этот инструмент в этом scope» и отзыв/список активных grants в Extensions settings. Доверие сервера целиком — отдельный расширенный выбор.
- При полном доступе не показывать второе подтверждение для прямо заказанной установки text-only skill, изменения файлов в разрешённой области и вызова уже допущенного low/medium-risk tool в запрошенной задаче.
- Оставить один предметный prompt для нового неизвестного executable MCP source, неизвестной передачи credentials, выхода за область, опасного/необратимого действия и изменения fingerprint.
- Привязать persisted MCP grants к fingerprint схемы, transport/configuration и scope; иметь понятный механизм revoke и безопасную миграцию старых grants. Старые записи не нужно молча расширять до более широкого доверия.

**Приёмка P1:** одна и та же разрешённая операция не показывает повторный prompt; после изменения input schema старый grant больше не действует; hard deny нельзя обойти через trust; полный доступ к локальному workspace не создаёт автоматическое доверие новому MCP; пользователь может увидеть и отозвать каждый сохранённый грант.

### P2 — навыки как реальные стандартные пакеты и «установи мне навык»

**Область:** `SkillImportService`, `SkillRepository`, `LoadSkillTool`, `SearchSkillsTool`, новый `InstallSkillTool`/`SkillCatalogProvider`, Extensions UI.

- Всегда добавлять агенту `search_skills`/`search_extensions` и настоящий `install_skill`, даже если локальная библиотека пустая. Явное русское/английское намерение install/learn должно включать эти маршруты в model prompt.
- Сделать `SkillSourceProvider` API. Для первой версии поддержать project/user folder, `.skill`/ZIP и GitHub owner/repo/path с branch/tag/commit. Добавлять новые каталоги источников через provider, а не hardcode API одной коммерческой площадки.
- Не считать MCP Registry источником skills. Не закреплять недокументированный endpoint (`skills.sh /api/search`) как стабильный API; официальный MCP Registry — каталог MCP server metadata, а не safety authority.
- Сохранять полный directory bundle: `SKILL.md`, references, scripts, assets и допустимые вложенные материалы. Санитайзить архивы, traversal, symlink/hardlink entries, duplicate names, максимальное число файлов, uncompressed size и compression ratio; писать staging directory атомарно.
- На install не запускать скрипты, lifecycle hooks, pip/npm setup или внешний MCP. Text-only skill активируется как инструкция, а его script можно запускать только обычным tool-execution policy после запроса пользователя.
- Записывать source, commit/version, SHA-256 manifest, install scope, время и warnings в приложение-owned metadata внутри skill directory, не раскрывая секреты в lock file. Обновление всегда сравнивается с существующей версией и может быть отменено.
- Читать references как отдельные bounded files с containment проверки. В model context сначала даётся index доступных файлов, полное содержимое по запросу.
- По умолчанию устанавливать в пользовательскую `~/.agents/skills/<name>`; project install — в `<project>/.agents/skills/<name>`. Legacy roots (`.claude/skills`, userData skills) остаются читаемыми с отображением источника и конфликтов. Для skills одинакового ID показывать, какая версия победила.
- Добавить каталог установленных/доступных/неактивных skills, provenance, version, disable/uninstall/update/rollback и предупреждения по зависимости от отсутствующих toolRefs.
- При формулировке «скачай себе какой-нибудь навык для X» разрешить агенту найти подходящий низкорисковый text-only skill и установить его в user scope без повторного подтверждения. Если каталог вернул много равнозначных вариантов, спросить только предпочтение, если оно materially affects the choice.

**Решение runtime:** проект работает на Electron 33 / Node 20. Официальный `vercel-labs/skills` CLI — полезный reference, но текущая версия заявляет Node floor `>=22.20`. Не вызывать `npx skills` из agent loop и не встраивать package без compatibility spike. Сначала проверить, можно ли использовать его как build-time/source reference либо вынести в корректно поставляемый helper; если нет — реализовать узкий `SkillSourceProvider` на используемом runtime, проверяя совместимость по официальной CLI/reference behaviors.

**Приёмка P2:** пустая library может выполнить search->install->load; задача «скачай подходящий навык» завершается без ручного копирования; после установки новый runtime discover-ит его сразу (текущий snapshot тоже обновляется безопасно); ZIP сохраняет supporting files; install не выполняет код; источник и digest видны в библиотеке; сбой источника/валидации не оставляет полупакет.

### P3 — один поиск возможностей и отложенные MCP schemas

**Область:** `ExtensionCatalogService`, `search_extensions`, `SearchExtensionToolsTool`, `ManageMcpTool`, `McpConnectionService`, `McpRuntimeManager`, `McpToolAdapter`.

- Перевести `search_tools` в общий каталог: навыки, встроенные/установленные плагины, сохранённые MCP servers и их tools, resources/prompts. Сохранить алиасы старых tool IDs на миграционный период.
- Точный стабильный ID отделить от remote `name`; всегда namespace-ить MCP tools по серверу для устранения collisions.
- Настроенный profile MCP виден в новых чатах, в scope пользователя или проекта. Подключение сервера и загрузка schema должны быть доступны через одну agent call, когда user request подразумевает это.
- Для MCP-сервера модель сначала видит его название/summary и короткий каталог. Tool search ранжирует по запросу и добавляет только выбранную schema (и, при близких результатах, небольшой top-k) в следующий model request. Схему поиска начать с лексического BM25/field scoring, затем измерять пропуски прежде чем добавлять embeddings.
- Не показывать второй `manage_mcp(load)` после удачного schema search; оставить отдельный load только для явной ручной диагностики.
- После connection/catalog refresh синхронизировать model-visible tool snapshot в том же run, удалять снятые tools, инвалидировать описания и trust fingerprints.
- HTTP server connection допускается только для указанного/одобренного profile resource. Local stdio start проходит отдельный маршрут, проверяет command/args/cwd и не запускается фоновым поиском.
- `MCP Registry` использовать как слой metadata discovery. Показать publisher, package/remote transport, endpoint и версию; проверять active/deprecated status. Реестр саморепортируемый, не гарантия безопасности, uptime или полномочий. Registry entry не должен автоматически запускать registry package scripts.
- OAuth/headers хранить только в `SecretStore`; browser-based OAuth, app credential, required scopes и login state должны иметь явные состояния.
- Политика на tool call опирается на локальный trust, профиль/проект, fingerprint и user intent; серверные аннотации остаются hint.

**Приёмка P3:** user подключил MCP в settings → новый чат сразу видит его статус; user просит инструмент → одна операция поиска возвращает точную schema; ни один невыбранный tool не добавлен в model request; поиск не вызывает внешний tool; schema drift отзывает старое доверие; server disconnect синхронно убирает недействительные schemas.

### P4 — декларативные packages и привязка навыка к своим инструментам

**Область:** новый package manifest, catalog index, `metadata.zipply_tools`, plugin UI/API, install/uninstall/upgrade.

- Определить декларативный `zipply-extension.json` (или другой финально выбранный manifest) с `id`, `version`, `skills[]`, `mcpServers[]`, dependencies, capabilities/risk declarations, source pin и optional UI metadata.
- Пакет может содержать стандартные навыки и декларативное подключение remote MCP без выполнения произвольного JavaScript в main process.
- Skill links к tools валидировать по catalog; показывать `available`, `missing`, `needs_auth`, `not_granted`, `disabled`. Подгрузка skill может подгрузить связанную tool schema, но не создать server connection и не подарить право.
- Развести install package (files) и activation (capabilities). При установке показывать состав пакета, user/project scope, source/ref и присутствие scripts/MCP.
- Нативный executable plugin не запускать в Electron main. Если понадобится, отдельное исследование для plugin host process, IPC surface, OS sandbox, resource quotas и kill semantics.

**Приёмка P4:** можно установить единый пакет с несколькими skills плюс optional MCP references; все component statuses точны; отсутствующий tool не делает skill невидимым; skill activation не вызывает MCP самопроизвольно; обновление одного компонента не ломает/не заменяет другие без явного diff.

### P5 — Skill Workshop: ручное обучение, update active skill и rollback

**Область:** `SkillProposalStore`, новый `SkillVersionStore`/`SkillWorkshopService`, `ProposeSkillTool`, `/learn`/chat flow, library UI.

- Создать один авторский API: `create`, `propose_update`, `patch`, `view`, `history`, `diff`, `approve`, `reject`, `undo`, `archive/restore`.
- Обновление всегда содержит `baseRevision`; если активный skill поменялся после начала предложения, не перезаписывать его, а показать conflict и новый diff.
- Маршрут `learn`: повторяемая инструкция → skill; факт/предпочтение → memory; знание о конкретной базе кода → проектная документация/AGENTS.md; одноразовый ответ → ничего не сохранять.
- Candidate должен включать причину, ссылку на исходный run/коррекцию, scope, названия затронутых файлов и выборку typed verification evidence; не записывать transcript целиком в skill.
- В ранней версии любое изменение активного skill создаёт reviewable proposal; прямой явный запрос «обнови навык X» не должен приводить к двум одинаковым подтверждениям. Один понятный review с diff достаточен.
- Каждое изменение хранит полную предыдущую версию и даёт «undo»/rollback. Архив вместо удаления для learned skills; hard delete через library требует отдельного явного действия.
- Skills, установленные извне, по умолчанию read-only для Workshop. `source=learned` и приложение-owned skills можно исправлять; чужой package обновляется только из источника/с разрешением владельца.

**Приёмка P5:** пользователь может попросить «запомни наш способ X» или «поправь навык Y»; в library виден diff + основание; новая версия активируется после принятия policy; undo возвращает предыдущее содержимое; чужой skill не изменён самовольно.

### P6 — самостоятельное улучшение с режимами и evals

**Область:** typed run outcomes, background review worker, eval dataset/runner, learning settings.

- Первая поставка: `off / propose / auto`; по умолчанию `propose` только после явного включения. `off` останавливает фоновое review, но оставляет пользовательский `/learn`.
- Обучающийся reviewer читает минимальное доказательство: пользовательская коррекция, успешный проверенный путь, трудный найденный edge case или существующий skill, который привёл к ошибке. Он не перечитывает полный journal без необходимости.
- Background worker изолировать в allowlist `view_skill`, `read_evidence`, `propose_skill`; без `terminal`, `exec`, `message`, generic file write и tools с внешними side effects. Время и дополнительные provider calls ограничить настройками; прозрачность приватности обязательна.
- Для auto применить только candidate text changes к Zipply-owned skills, если независимая eval suite показывает улучшение или отсутствие регрессии. Исполняемые файлы, сторонние skills, config, MCP и plugin install автоматом не менять.
- Eval skill по отдельному набору задач: точность активации, выполнение workflow, повторяемость, token/cost/latency, ложные срабатывания, пользовательские исправления, safety regressions. Сравнить baseline (skill absent/current revision) с candidate.
- Возможность выключить background review, посмотреть отчёт и отменить конкретную группу изменений.

**Приёмка P6:** плохой/непроверенный урок не публикуется автоматически; auto режим включается человеком отдельно и только для text-only Zipply-authored skills; изменение можно восстановить после перезапуска; стоимость и источник контекста видны; candidate проходит независимые evals.

## 6. План проверок будущей реализации

Проверки добавляются вместе с каждой фазой, но в этом документе они являются критериями будущей реализации, а не утверждением о проверенном коде.

- **Policy unit tests:** mode × action × scope × provenance × direct user intent; hard deny; per-tool remember; revoke; old-format migration; fingerprint drift.
- **Skill archive tests:** valid full package, nested SKILL.md, zip slip, duplicate path, symlink, zip bomb, invalid frontmatter, same-name update, atomic rollback, support file read bounds.
- **Skill lifecycle integration:** empty library -> search -> install -> discover -> load -> read reference; no script executed during install; user/project scope separation; userdata legacy path conflict handling.
- **MCP integration:** Registry result vs configured server, unsupported template variables, stdio never starts on metadata search, connect cancellation, OAuth/secret storage, one schema loaded, tool call policy, schema refresh/removal, replay after server restart.
- **Snapshot consistency:** new install or MCP connection updates the current run safely; suspended/resumed chats do not reuse expired schema revision or stale approval.
- **Learning evaluations:** correction becomes narrow patch; one-off fact not stored as skill; candidate must not leak secrets; conflict on changed `baseRevision`; undo restores bytes; eval reports baseline/candidate.
- **Compatibility:** `skills-ref validate` against official Agent Skills rules, plus Codex/Claude/Gemini/OpenCode/OpenClaw folders and multi-root precedence fixture.
- **UI:** extension search, source/revision, loaded/available/needs-auth/disabled states, active grants, diff, and undo. Project `AGENTS.md` governs visual acceptance: monochrome Obsidian palette, no shadows/glows, static neutral focus, rounded controls, readable text.

## 7. Источники и новые подходы

### Форматы и интеграции

- [Agent Skills specification](https://github.com/agentskills/agentskills/blob/main/docs/specification.mdx) — стандартный каталог с `SKILL.md`, `scripts/`, `references/`, `assets/` и progressive disclosure.
- [Codex public source: skill roots](https://github.com/openai/codex/blob/af71942309704997f4bdc86c020717646423c080/codex-rs/ext/skills/src/host_roots.rs), [skill catalog rendering](https://github.com/openai/codex/blob/af71942309704997f4bdc86c020717646423c080/codex-rs/ext/skills/src/render.rs), [tool search](https://github.com/openai/codex/blob/af71942309704997f4bdc86c020717646423c080/codex-rs/core/src/tools/handlers/tool_search.rs).
- [Codex built-in `skill-installer`](https://github.com/openai/codex/blob/af71942309704997f4bdc86c020717646423c080/codex-rs/skills/src/assets/samples/skill-installer/SKILL.md) — install pattern и осторожность при неопределённом поисковом запросе.
- [Hermes Agent `v0.23.4`](https://github.com/NousResearch/hermes-agent/releases/tag/v0.23.4): [skill listing/view](https://github.com/NousResearch/hermes-agent/blob/v0.23.4/tools/skills_tool.py), [skill hub install](https://github.com/NousResearch/hermes-agent/blob/v0.23.4/tools/skills_hub_install.py), [skill manager](https://github.com/NousResearch/hermes-agent/blob/v0.23.4/tools/skill_manager_tool.py), [MCP tools](https://github.com/NousResearch/hermes-agent/blob/v0.23.4/tools/mcp_tool.py).
- [OpenClaw `v2026.11.10`: skills](https://github.com/openclaw/openclaw/blob/v2026.11.10/docs/tools/skills.md), [Skill Workshop](https://github.com/openclaw/openclaw/blob/v2026.11.10/docs/tools/skill-workshop.md), [self-learning](https://docs.openclaw.ai/tools/self-learning).
- [OpenCode skills](https://opencode.ai/docs/skills/), [MCP servers](https://opencode.ai/docs/mcp-servers/), [permissions](https://opencode.ai/docs/permissions/).
- [Gemini CLI skill install](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md), [MCP discovery/security](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md).
- [Pi MCP modes](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md), [skill packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md).
- [Claude Code skills](https://code.claude.com/docs/en/skills), [MCP tool search/trust](https://code.claude.com/docs/en/mcp), [permissions](https://code.claude.com/docs/en/permissions). Runtime source is not public; conclusions are document-backed only.

### MCP Registry и доверие

- [MCP official Registry API](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/official-registry-api.md): `GET /v0.1/servers`, substring search, cursor pages, `version=latest`, `active/deprecated/deleted` status. Registry — metadata/discovery, не подтверждение безопасности или надёжности. Необходимо сохранять pagination filters и проверять server status.
- [MCP tool annotations risk vocabulary](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/): аннотации полезны для policy hints, но untrusted server может лгать; hard guarantees требуют sandbox/network enforcement.
- [MCP Skills extension beta](https://skills.extensions.modelcontextprotocol.io/specification/beta/skills): server can expose `skills/list`/`skills/get`, но MCP-served skill всё равно untrusted input и не заменяет локальную библиотеку/installer.

### Текущая экосистема установки и защиты skills

- [OpenAI Agent Skills format and runtime](https://developers.openai.com/api/docs/guides/tools-skills), [plugin package with skills and MCP](https://developers.openai.com/api/docs/guides/agents-api/tools/plugins).
- [Vercel `skills` CLI source](https://github.com/vercel-labs/skills/blob/main/docs/commands.md) показывает portable install, Git/source refs, lock/provenance, user/project scope и поддержку полного folder bundle. Его runtime floor сейчас `Node >=22.20`; Zipply использует Electron 33 / Node 20, поэтому напрямую встраивать CLI без совместимости нельзя.
- [ClawHub security audit model](https://github.com/openclaw/clawhub/blob/main/docs/security-audits.md) анализирует инструкции, метаданные, заявленные capabilities, files и сигнализаторы. Скан — диагностическая мера, а не гарантия безопасности.
- [Исследование Agent Skills in the Wild](https://arxiv.org/abs/2601.10338) анализирует большой набор skills и описывает prompt injection, exfiltration, privilege escalation и supply chain как четыре семейства риска. Этот результат обосновывает provenance, скан и policy, но не предполагает, что scanner способен гарантировать безопасность natural-language instructions.

### Разрешения и автономия

- [OpenAI Codex approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security) отделяет sandbox от approval policy, MCP/tool approval, network и skill-script approvals.
- [Claude Code auto mode](https://claude.com/resources/articles/auto-mode) использует отдельный classifier для риска, как middle-ground между частыми prompts и полным bypass; это снижает friction, но не заменяет OS isolation.
- [OpenClaw self-learning](https://docs.openclaw.ai/tools/self-learning) документирует `off / propose / auto`, thresholded reviews, versioning, undo, дополнительные model calls и отправку контекста provider-у.
- [Hermes skills write approval](https://hermes-agent.nousresearch.com/docs/user-guide/configuration) показывает отдельный optional approval gate для skill writes и более строгий scan background writes.

## 8. Порядок работ и границы первой поставки

Первая полноценная версия должна остановиться после P3: пользователь может найти, установить, обнаружить и использовать text-only skill; настроенный MCP виден в выбранной области; поиск подгружает одну точную schema; policy объясняет каждое разрешение и не дублирует пользовательское согласие. После этого P4 добавит декларативные bundles, P5 — reviewed Skill Workshop, P6 — измеренное самообучение.

Не включать в первую поставку: автоматическое выполнение skill scripts при install; произвольный JS plugin в Electron main; автоматическое подключение любого найденного MCP; доверие на основе только имени/аннотации сервера; скрытый background review полного transcript; недокументированные marketplace API как критический dependency.

**Следующий engineering action:** перед UX-полировкой сделать P0 контрактов MCP и базовый typecheck, после чего зафиксировать baseline. Затем реализовать P1, чтобы последующие install/search flows не добавили новую отдельную ветку подтверждений.

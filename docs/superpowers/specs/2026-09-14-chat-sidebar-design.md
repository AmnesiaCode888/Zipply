# Дизайн-спецификация: Левая панель управления чатами (Chat Sidebar)

## 1. Обзор и цели
Добавление левой навигационной панели для управления множественными сессиями чатов в приложении Zipply. Панель сохраняет историю диалогов в LocalStorage, позволяет создавать новые чаты, переключаться между ними, переименовывать и удалять их, а также плавно сворачивать/разворачивать боковую панель.

Дизайн строго следует Apple Design Guidelines ([`DESIGN.md`](file:///d:/0%20%D0%9F%D0%A0%D0%9E%D0%95%D0%9A%D0%A2%D0%AB/Zipply/DESIGN.md)):
- Парящий островной лейаут (`rounded-[26px]`, фон `#141416`, сверхтонкий кант `border-[0.5px] border-white/[0.06]`).
- Отсутствие ярких цветных рамок, неона и теней-свечений.
- Сдержанные микроанимации нажатий и сжатий (`active:scale-[0.98]`).
- Нулевые отступы системного скроллбара (невидимый Apple-скроллбар).

---

## 2. Модель данных (`src/renderer/src/types/chat.ts`)

```typescript
export interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: Message[]
}
```

---

## 3. Сервис хранения (`src/renderer/src/services/chatStorageService.ts`)

- **Ключи LocalStorage**:
  - `zipply_chat_sessions_v1`
  - `zipply_active_chat_id_v1`
- **Методы**:
  - `loadSessions(): ChatSession[]` — читает сессии, восстанавливает структуры, при первом запуске создает дефолтный чат («Новый чат»).
  - `saveSessions(sessions: ChatSession[]): void` — сериализует с обработкой исключений квоты.
  - `loadActiveChatId(): string | null`
  - `saveActiveChatId(id: string): void`

---

## 4. Управление состоянием (`hooks/`)

### 4.1. `useChatSessions` (`src/renderer/src/hooks/useChatSessions.ts`)
- Отвечает за коллекцию сессий и текущий `activeChatId`.
- **API**:
  - `sessions`: `ChatSession[]`
  - `activeChatId`: `string`
  - `activeSession`: `ChatSession | undefined`
  - `createChat(title?: string): string` — создает новый чат с ID `chat-${Date.now()}`, устанавливает его активным.
  - `selectChat(id: string): void` — переключает активный чат.
  - `renameChat(id: string, newTitle: string): void` — обновляет заголовок чата.
  - `deleteChat(id: string): void` — удаляет сессию; если удален активный чат, переключает на следующий или создает новый.
  - `updateSessionMessages(sessionId: string, messages: Message[]): void` — обновляет сообщения сессии.

### 4.2. Адаптация `useChat` (`src/renderer/src/hooks/useChat.ts`)
- Принимает `activeSession` и колбэк синхронизации `onUpdateMessages`.
- При переключении сессии отменяет текущий активный стрим (`activeStreamRef.current?.cancel()`) и загружает сообщения новой сессии.
- При отправке первого сообщения в сессии («Новый чат») автоматически задает информативный заголовок чата из текста пользователя (первые 28 символов).

---

## 5. Компоненты интерфейса (`components/sidebar/`)

### 5.1. `Sidebar.tsx`
- **Контейнер**: `w-[260px] h-full flex flex-col justify-between p-2.5 bg-[#141416] rounded-[26px] border-[0.5px] border-white/[0.06]`.
- **Шапка (Header)**:
  - Заголовок раздела «Чаты» (`text-[13px] font-semibold text-[#8E8E93] uppercase tracking-wider`).
  - Кнопка «+ Новый» (`rounded-full bg-[#242426] hover:bg-[#2E2E32] text-[#F5F5F7] px-2.5 py-1 text-xs flex items-center gap-1.5 transition-all active:scale-95`).
- **Центральная зона (`ChatList.tsx`)**:
  - Список `ChatItem.tsx` с плавной вертикальной прокруткой без видимой полосы скролла.
- **Нижняя зона (`UserProfileCard.tsx`)**:
  - Капсула пользователя `Daniel Pyatin`, `PRO`, шкала лимита.

### 5.2. `ChatItem.tsx`
- Интерактивный элемент списка чата со скруглением `rounded-[14px]`.
- Состояния:
  - **Обычное**: цвет текста `#8E8E93`, при ховере плавная подложка `hover:bg-white/[0.04]` и цвет текста `#F5F5F7`.
  - **Активное**: подложка `bg-white/[0.08]`, текст `#F5F5F7`, `font-medium`.
  - **Редактирование (Inline Rename)**: активируется по клику на иконку карандаша или двойному клику. Текстовое поле ввода `#18181A` с подтверждением по Enter/Blur и отменой по Escape.
  - **Действия при ховере**: кнопки переименования (карандаш) и удаления (корзина, ховер `#FF453A`).

### 5.3. Переключатель сайдбара (`TitleBar.tsx`)
- В левой части `TitleBar` размещается аккуратная кнопка с иконкой `PanelLeft` (`w-7 h-7 rounded-lg text-[#8E8E93] hover:text-[#F5F5F7] hover:bg-white/[0.06]`).
- Плавная кинематика раскрытия/сворачивания сайдбара (`w-[260px]` ↔ `w-0`, `opacity-100` ↔ `opacity-0`, `duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]`).

---

## 6. План тестирования и верификации
1. Проверка типов TypeScript (`npm run typecheck:web && npm run typecheck:node`).
2. Создание нового чата: появление в сайдбаре, очистка экрана сообщений, фокус.
3. Отправка сообщений в разных чатах: независимость историй сообщений.
4. Автоматическое переименование нового чата при первом сообщении.
5. Ручное переименование (inline edit): сохранение по Enter, отмена по Escape.
6. Удаление чата: корректное переключение на оставшийся чат или создание чистого, если удален последний.
7. LocalStorage: сохранение структуры сессий и активного чата при перезагрузке страницы.
8. Сворачивание и разворачивание сайдбара: плавная анимация, отсутствие скачков макета и горизонтального скролла.

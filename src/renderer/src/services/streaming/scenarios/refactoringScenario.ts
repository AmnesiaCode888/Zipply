import { MockScenario } from '../types'

export const refactoringScenario: MockScenario = {
  id: 'solid-refactoring',
  title: 'SOLID Architectural Refactoring & Modularization',
  steps: [
    {
      type: 'thinking',
      id: 'think-4',
      content:
        'Провожу анализ архитектурного разделения приложения. Разделяю монолитные файлы на специализированные модули: выношу хуки для скролла и горячих клавиш, декомпозирую селектор режимов и шторку ввода, отделяю вкладки настроек по принципу SRP.',
      durationSec: 2
    },
    {
      type: 'text',
      id: 'speech-4-1',
      content: 'Сканирую кодовую базу на предмет крупных монолитных компонентов.'
    },
    {
      type: 'tool',
      id: 'tool-search-4',
      tool: {
        id: 'tool-search-4',
        type: 'search',
        label: 'Search',
        targetName: 'SOLID architecture decomposition',
        content:
          'src/renderer/src/App.tsx: 228 lines\nsrc/renderer/src/components/ModeSelector.tsx: 392 lines\nsrc/renderer/src/components/ChatInput.tsx: 292 lines\nsrc/renderer/src/components/settings/MainSettingsView.tsx: 417 lines\nsrc/renderer/src/services/mockStreamService.ts: 551 lines',
        defaultExpanded: false
      },
      executionDurationMs: 800
    },
    {
      type: 'text',
      id: 'speech-4-2',
      content: 'Изучаю контракт взаимодействия между селектором режимов и полем ввода.'
    },
    {
      type: 'tool',
      id: 'tool-read-4',
      tool: {
        id: 'tool-read-4',
        type: 'file_read',
        label: 'Read',
        targetName: 'src/renderer/src/components/mode-selector/types.ts',
        content:
          'export type AiMode = \'low\' | \'base\' | \'pro\' | \'max\' | \'ultra\'\nexport interface ModeInfo { label: string; sublabel: string }',
        defaultExpanded: false
      },
      executionDurationMs: 700
    },
    {
      type: 'text',
      id: 'speech-4-3',
      content: 'Декомпозирую корневой App.tsx: выношу компоновку в AppLayout, а управление скроллом в useChatScroll.'
    },
    {
      type: 'tool',
      id: 'tool-edit-4',
      tool: {
        id: 'tool-edit-4',
        type: 'file_edit',
        label: 'Написал',
        targetName: 'src/renderer/src/App.tsx',
        diff: { added: 38, removed: 175 },
        content: ` export const App: React.FC = () => {
-  // 228 lines of mixed scroll, resize, layout, and session handlers
+  const { sessions, activeChatId, ... } = useChatSessions()
+  const { messages, sendMessage } = useChat(...)
+  useAppShortcuts({ onNewChat: handleNewChat })
+
+  return (
+    <AppLayout ...>
+      {mainView === 'settings' ? <MainSettingsView ... /> : <ChatCanvas ... />}
+    </AppLayout>
+  )
 }`,
        defaultExpanded: true
      },
      executionDurationMs: 1000
    },
    {
      type: 'text',
      id: 'speech-4-4',
      content: 'Запускаю проверку типов для верификации модульной структуры.'
    },
    {
      type: 'tool',
      id: 'tool-term-4',
      tool: {
        id: 'tool-term-4',
        type: 'terminal',
        label: 'Терминал',
        targetName: 'npm run typecheck',
        content:
          '> zipply@1.0.0 typecheck\n> tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json\n✓ 0 errors found in 38 compilation units.\nDone in 0.94s.',
        defaultExpanded: false
      },
      executionDurationMs: 1100
    },
    {
      type: 'text',
      id: 'speech-4-5',
      content:
        'Рефакторинг завершен: все компоненты следуют SOLID, подпапки изолированы по доменам, а монолитные файлы декомпозированы в легко поддерживаемые модули.'
    }
  ]
}

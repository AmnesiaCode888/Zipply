import { MockScenario } from '../types'

export const memoryOptScenario: MockScenario = {
  id: 'memory-opt',
  title: 'Memory Optimization & Stream Lifecycle',
  steps: [
    {
      type: 'thinking',
      id: 'think-2',
      content:
        'Задача касается оптимизации работы со стримами и жизненным циклом компонентов. Нужно удостовериться, что активные подписки и таймеры очищаются при размонтировании, а переключение статусов тулов происходит с мягкой задержкой без резких рывков.',
      durationSec: 3
    },
    {
      type: 'text',
      id: 'speech-2-1',
      content: 'Проверю текущее управление ссылками активного потока в хуке useChat.'
    },
    {
      type: 'tool',
      id: 'tool-search-2',
      tool: {
        id: 'tool-search-2',
        type: 'search',
        label: 'Search',
        targetName: 'activeStreamRef',
        content:
          'src/renderer/src/hooks/useChat.ts:10\n  const activeStreamRef = useRef<StreamController | null>(null)\n\nsrc/renderer/src/hooks/useChat.ts:24\n  activeStreamRef.current?.cancel()',
        defaultExpanded: false
      },
      executionDurationMs: 850
    },
    {
      type: 'text',
      id: 'speech-2-2',
      content: 'Читаю контракт структуры сообщений и блока рассуждений.'
    },
    {
      type: 'tool',
      id: 'tool-read-2',
      tool: {
        id: 'tool-read-2',
        type: 'file_read',
        label: 'Read',
        targetName: 'src/renderer/src/types/chat.ts',
        content:
          'export type MessageBlock =\n  | { type: \'thinking\'; id: string; content: string; durationSec?: number; isStreaming?: boolean }\n  | { type: \'text\'; id: string; content: string; isStreaming?: boolean }\n  | { type: \'tool\'; id: string; tool: ToolCall }',
        defaultExpanded: false
      },
      executionDurationMs: 750
    },
    {
      type: 'text',
      id: 'speech-2-3',
      content: 'Внедряю чередующиеся блоки (thinking → речь → тулы → речь) и плавные тайминги смены статусов.'
    },
    {
      type: 'tool',
      id: 'tool-edit-2',
      tool: {
        id: 'tool-edit-2',
        type: 'file_edit',
        label: 'Написал',
        targetName: 'src/renderer/src/services/mockStreamService.ts',
        diff: { added: 42, removed: 15 },
        content: ` export function streamAgentWorkflow(
   scenario: MockScenario,
-  onTools: (tools: ToolCall[]) => void,
-  onText: (text: string, done: boolean) => void
+  onUpdate: (blocks: MessageBlock[], isFinished: boolean) => void
 ) {
+  // Fluid step orchestration with gentle pauses between actions
+  executeStep(0)
 }`,
        defaultExpanded: true
      },
      executionDurationMs: 1050
    },
    {
      type: 'text',
      id: 'speech-2-4',
      content: 'Выполняю сборку продакшен-бандла для проверки размера и отсутствия циклических зависимостей.'
    },
    {
      type: 'tool',
      id: 'tool-term-2',
      tool: {
        id: 'tool-term-2',
        type: 'terminal',
        label: 'Терминал',
        targetName: 'npm run build',
        content:
          '> zipply@1.0.0 build\n> electron-vite build\n\nvite v5.4.11 building for production...\n✓ 48 modules transformed.\nout/renderer/index.html         0.84 kB\nout/renderer/assets/index.js    152.40 kB\nout/renderer/assets/index.css   19.60 kB\n✓ built in 276ms',
        defaultExpanded: false
      },
      executionDurationMs: 1250
    },
    {
      type: 'text',
      id: 'speech-2-5',
      content:
        'Оптимизация завершена: память очищается без утечек, анимация аккордеонов сглажена, а чередование реплик и действий создает ощущение естественной автономной работы.'
    }
  ]
}

import { MockScenario } from '../types'

export const syntaxScenario: MockScenario = {
  id: 'syntax-design',
  title: 'Design System & Micro-animations',
  steps: [
    {
      type: 'thinking',
      id: 'think-3',
      content:
        'Анализирую визуальную плавность интерфейса. Предыдущие переходы закрытия карточек выглядели резковато из-за скачка внешних отступов и отсутствия плавной кривой замедления. Нужно проверить стили в main.css, внедрить анимацию smoothFadeIn и сгладить аккордеон с помощью min-h-0.',
      durationSec: 2
    },
    {
      type: 'text',
      id: 'speech-3-1',
      content: 'Проверяю параметры анимаций и стилей в файле main.css.'
    },
    {
      type: 'tool',
      id: 'tool-read-3',
      tool: {
        id: 'tool-read-3',
        type: 'file_read',
        label: 'Read',
        targetName: 'src/renderer/src/assets/main.css',
        content:
          '@keyframes smoothFadeIn {\n  0% { opacity: 0; transform: translateY(6px); }\n  100% { opacity: 1; transform: translateY(0); }\n}\n.animate-smooth-in {\n  animation: smoothFadeIn 0.38s cubic-bezier(0.16, 1, 0.3, 1) forwards;\n}',
        defaultExpanded: false
      },
      executionDurationMs: 800
    },
    {
      type: 'text',
      id: 'speech-3-2',
      content: 'Обновляю компонент ToolCallCard: добавляю мягкое схлопывание через внутренние отступы и min-h-0.'
    },
    {
      type: 'tool',
      id: 'tool-edit-3',
      tool: {
        id: 'tool-edit-3',
        type: 'file_edit',
        label: 'Написал',
        targetName: 'src/renderer/src/components/tools/ToolCallCard.tsx',
        diff: { added: 12, removed: 4 },
        content: `       {hasBody && (
         <div
-          className="grid transition-all duration-300 mt-2"
+          className="grid transition-all duration-350 ease-[cubic-bezier(0.16,1,0.3,1)]"
         >
-          <div className="overflow-hidden">
+          <div className="min-h-0 overflow-hidden">
+            <div className="pt-2">`,
        defaultExpanded: true
      },
      executionDurationMs: 1100
    },
    {
      type: 'text',
      id: 'speech-3-3',
      content: 'Проверяю целостность компонентов через линтер.'
    },
    {
      type: 'tool',
      id: 'tool-term-3',
      tool: {
        id: 'tool-term-3',
        type: 'terminal',
        label: 'Терминал',
        targetName: 'npx eslint src/renderer/src/components/tools --ext .ts,.tsx',
        content:
          '> eslint src/renderer/src/components/tools --ext .ts,.tsx\n✓ 0 warnings, 0 errors in 10 files.',
        defaultExpanded: false
      },
      executionDurationMs: 1150
    },
    {
      type: 'text',
      id: 'speech-3-4',
      content:
        'Физика анимаций обновлена: теперь все блоки появляются мягко, аккордеоны скользят без рывков с нативной физикой Apple, а рассуждения компактно сворачиваются после генерации.'
    }
  ]
}

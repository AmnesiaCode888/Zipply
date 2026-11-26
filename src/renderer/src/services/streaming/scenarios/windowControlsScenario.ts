import { MockScenario } from '../types'

export const windowControlsScenario: MockScenario = {
  id: 'window-controls',
  title: 'Window Controls & TitleBar Refactoring',
  steps: [
    {
      type: 'thinking',
      id: 'think-1',
      content:
        'Пользователь просит проверить и оптимизировать оконные сервисы. Сначала проанализирую структуру вызовов useWindowControls, изучу контракты IPC-моста в главном процессе Electron, затем внесу необходимые правки в TitleBar.tsx и выполню компиляцию TypeScript для подтверждения корректности типов.',
      durationSec: 2
    },
    {
      type: 'text',
      id: 'speech-1',
      content: 'Сначала найду все вхождения управления окном и контракты сервисов в кодовой базе.'
    },
    {
      type: 'tool',
      id: 'tool-search-1',
      tool: {
        id: 'tool-search-1',
        type: 'search',
        label: 'Search',
        targetName: 'useWindowControls',
        content:
          'src/renderer/src/components/TitleBar.tsx:8\n  const { isGroupHovered, close, minimize, maximize } = useWindowControls()\n\nsrc/renderer/src/hooks/useWindowControls.ts:13\n  export function useWindowControls(): WindowControls',
        defaultExpanded: false
      },
      executionDurationMs: 900
    },
    {
      type: 'text',
      id: 'speech-2',
      content: 'Изучаю реализацию нативного IPC хендлера в главном процессе Electron.'
    },
    {
      type: 'tool',
      id: 'tool-read-1',
      tool: {
        id: 'tool-read-1',
        type: 'file_read',
        label: 'Read',
        targetName: 'src/main/ipc/WindowIpcHandler.ts',
        content:
          'export class WindowIpcHandler {\n  public register(): void {\n    ipcMain.handle(\'window:minimize\', () => this.window.minimize())\n    ipcMain.handle(\'window:maximize\', () => this.toggleMaximize())\n    ipcMain.handle(\'window:close\', () => this.window.close())\n  }\n}',
        defaultExpanded: false
      },
      executionDurationMs: 850
    },
    {
      type: 'text',
      id: 'speech-3',
      content: 'Добавляю поддержку нативного ховера группы кнопок светофора и корректное переключение состояния окна.'
    },
    {
      type: 'tool',
      id: 'tool-edit-1',
      tool: {
        id: 'tool-edit-1',
        type: 'file_edit',
        label: 'Написал',
        targetName: 'src/renderer/src/components/TitleBar.tsx',
        diff: { added: 14, removed: 4 },
        content: ` export const TitleBar: React.FC = () => {
-  const { close, minimize, maximize } = useWindowControls()
+  const { isGroupHovered, setIsGroupHovered, close, minimize, maximize } = useWindowControls()
+  const [isMaximized, setIsMaximized] = useState(false)
 
   return (
-    <header className="h-[38px] w-full flex items-center bg-[#101010]">
+    <header className="h-[38px] w-full flex items-center bg-[#101010] select-none drag-region">
       <div 
         className="flex items-center gap-[7px] px-[14px]"
+        onMouseEnter={() => setIsGroupHovered(true)}
+        onMouseLeave={() => setIsGroupHovered(false)}
       >`,
        defaultExpanded: true
      },
      executionDurationMs: 1100
    },
    {
      type: 'text',
      id: 'speech-4',
      content: 'Запускаю валидацию типов TypeScript через компилятор терминала.'
    },
    {
      type: 'tool',
      id: 'tool-term-1',
      tool: {
        id: 'tool-term-1',
        type: 'terminal',
        label: 'Терминал',
        targetName: 'npm run typecheck',
        content:
          '> zipply@1.0.0 typecheck\n> tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json\n✓ 0 errors found in 24 compilation units.\nDone in 1.08s.',
        defaultExpanded: false
      },
      executionDurationMs: 1200
    },
    {
      type: 'text',
      id: 'speech-5',
      content:
        'Все изменения успешно применены! Оконный сервис синхронизирован с главным процессом Electron, кнопки светофора macOS реагируют на наведение группы, а сборка и проверка типов прошли без предупреждений и ошибок.'
    }
  ]
}

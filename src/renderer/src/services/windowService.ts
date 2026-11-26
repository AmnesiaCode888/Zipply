import { IWindowService } from '../types/window'

// DIP: UI components depend on this abstraction, not on window.api directly.
// LSP: Works safely in both Electron and browser environments.
const noOp = (): void => {}

export const windowService: IWindowService = {
  minimize: () => window.api?.minimize() ?? noOp(),
  maximize: () => window.api?.maximize() ?? noOp(),
  close: () => window.api?.close() ?? noOp()
}

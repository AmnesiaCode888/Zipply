import { windowService } from '../services/windowService'

interface WindowControls {
  minimize: () => void
  maximize: () => void
  close: () => void
}

// SRP: This hook owns window control logic only.
// DIP: Depends on windowService abstraction, not on window.api directly.
export function useWindowControls(): WindowControls {
  return {
    minimize: windowService.minimize,
    maximize: windowService.maximize,
    close: windowService.close
  }
}

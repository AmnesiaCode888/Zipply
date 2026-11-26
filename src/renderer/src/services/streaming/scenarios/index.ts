import { MockScenario } from '../types'
import { windowControlsScenario } from './windowControlsScenario'
import { memoryOptScenario } from './memoryOptScenario'
import { syntaxScenario } from './syntaxScenario'
import { refactoringScenario } from './refactoringScenario'

export const MOCK_SCENARIOS: readonly MockScenario[] = [
  windowControlsScenario,
  memoryOptScenario,
  syntaxScenario,
  refactoringScenario
]

let currentScenarioIndex = 0

export function getNextScenario(): MockScenario {
  const scenario = MOCK_SCENARIOS[currentScenarioIndex % MOCK_SCENARIOS.length]
  currentScenarioIndex++
  return scenario
}

export function resetScenarioIndex(): void {
  currentScenarioIndex = 0
}

export {
  windowControlsScenario,
  memoryOptScenario,
  syntaxScenario,
  refactoringScenario
}

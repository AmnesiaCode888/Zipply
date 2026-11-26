import { MessageBlock } from '../../types/chat'
import { MockScenario, StreamController, StreamUpdateCallback, IStreamEngine } from './types'

/**
 * Orchestrates a complete autonomous agent lifecycle with:
 * - Chain-of-thought thinking block with live stream & timer
 * - Natural interleaved conversational speech between tool calls
 * - Progressive tool execution with active spinner and automatic smooth collapse
 * - Gentle pauses between actions to eliminate any abrupt layout jumps
 */
export function streamAgentWorkflow(
  scenario: MockScenario,
  onUpdate: StreamUpdateCallback
): StreamController {
  let isCancelled = false
  let currentTimer: ReturnType<typeof setTimeout> | null = null

  const activeBlocks: MessageBlock[] = []

  const setSafeTimeout = (fn: () => void, delay: number) => {
    if (isCancelled) return
    currentTimer = setTimeout(() => {
      if (!isCancelled) {
        fn()
      }
    }, delay)
  }

  const executeStep = (stepIdx: number) => {
    if (isCancelled) return

    if (stepIdx >= scenario.steps.length) {
      // Entire scenario completed
      onUpdate([...activeBlocks], true)
      return
    }

    const step = scenario.steps[stepIdx]

    if (step.type === 'thinking') {
      // 1. Initialize thinking block in active streaming mode
      const thinkingBlockIndex = activeBlocks.length
      activeBlocks.push({
        type: 'thinking',
        id: step.id,
        content: '',
        durationSec: step.durationSec ?? 2,
        isStreaming: true
      })
      onUpdate([...activeBlocks], false)

      // 2. Stream thoughts character by character with brisk natural cadence
      const characters = Array.from(step.content)
      let charIdx = 0
      let currentText = ''

      const tickThoughtChar = () => {
        if (isCancelled) return

        if (charIdx >= characters.length) {
          // Thought finished typing
          setSafeTimeout(() => {
            if (isCancelled) return
            activeBlocks[thinkingBlockIndex] = {
              type: 'thinking',
              id: step.id,
              content: currentText,
              durationSec: step.durationSec,
              isStreaming: false
            }
            onUpdate([...activeBlocks], false)

            // Gentle breath pause (850ms: 400ms pause + 400ms smooth collapse + 50ms buffer)
            setSafeTimeout(() => {
              executeStep(stepIdx + 1)
            }, 850)
          }, 450)
          return
        }

        currentText += characters[charIdx]
        charIdx++

        activeBlocks[thinkingBlockIndex] = {
          type: 'thinking',
          id: step.id,
          content: currentText,
          durationSec: step.durationSec,
          isStreaming: true
        }
        onUpdate([...activeBlocks], false)

        let delay = 11
        const char = characters[charIdx - 1]
        if (char === '.' || char === '!' || char === '?') {
          delay = 45
        } else if (char === ',') {
          delay = 25
        }

        setSafeTimeout(tickThoughtChar, delay)
      }

      setSafeTimeout(tickThoughtChar, 180)
    } else if (step.type === 'text') {
      // 1. Initialize text block in streaming mode
      const textBlockIndex = activeBlocks.length
      activeBlocks.push({
        type: 'text',
        id: step.id,
        content: '',
        isStreaming: true
      })
      onUpdate([...activeBlocks], false)

      // 2. Stream speech text
      const characters = Array.from(step.content)
      let charIdx = 0
      let currentText = ''

      const tickSpeechChar = () => {
        if (isCancelled) return

        if (charIdx >= characters.length) {
          // Speech finished
          activeBlocks[textBlockIndex] = {
            type: 'text',
            id: step.id,
            content: currentText,
            isStreaming: false
          }
          onUpdate([...activeBlocks], false)

          // Calm pause (260ms) before next step
          setSafeTimeout(() => {
            executeStep(stepIdx + 1)
          }, 260)
          return
        }

        currentText += characters[charIdx]
        charIdx++

        activeBlocks[textBlockIndex] = {
          type: 'text',
          id: step.id,
          content: currentText,
          isStreaming: true
        }
        onUpdate([...activeBlocks], false)

        let delay = 14
        const char = characters[charIdx - 1]
        if (char === '.' || char === '!' || char === '?') {
          delay = 60
        } else if (char === ',') {
          delay = 35
        } else if (char === ' ') {
          delay = 12
        }

        setSafeTimeout(tickSpeechChar, delay)
      }

      setSafeTimeout(tickSpeechChar, 140)
    } else if (step.type === 'tool') {
      // 1. Add tool in running status
      const toolBlockIndex = activeBlocks.length
      activeBlocks.push({
        type: 'tool',
        id: step.id,
        tool: {
          ...step.tool,
          status: 'running'
        }
      })
      onUpdate([...activeBlocks], false)

      const executionDuration = step.executionDurationMs ?? 950

      // 2. Transition tool to completed after execution duration
      setSafeTimeout(() => {
        if (isCancelled) return

        activeBlocks[toolBlockIndex] = {
          type: 'tool',
          id: step.id,
          tool: {
            ...step.tool,
            status: 'completed'
          }
        }
        onUpdate([...activeBlocks], false)

        // 3. Stagger delay (950ms: 450ms pause + 500ms smooth collapse) before next step
        setSafeTimeout(() => {
          executeStep(stepIdx + 1)
        }, 950)
      }, executionDuration)
    }
  }

  // Initial gentle breath pause
  setSafeTimeout(() => {
    executeStep(0)
  }, 160)

  return {
    cancel: () => {
      isCancelled = true
      if (currentTimer) {
        clearTimeout(currentTimer)
        currentTimer = null
      }
    }
  }
}

export class MockStreamEngine implements IStreamEngine {
  public stream(scenario: MockScenario, onUpdate: StreamUpdateCallback): StreamController {
    return streamAgentWorkflow(scenario, onUpdate)
  }
}

export const defaultStreamEngine = new MockStreamEngine()

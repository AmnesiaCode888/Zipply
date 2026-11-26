import { TerminalTool } from './TerminalTool'

/**
 * RunCommandTool — Alias for TerminalTool supporting the 'run_command' name.
 */
export class RunCommandTool extends TerminalTool {
  override get name(): string {
    return 'run_command'
  }
}

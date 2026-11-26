import * as os from 'node:os'
import * as path from 'node:path'
import { realpath } from 'node:fs/promises'
import { SkillRepository, type SkillRoot } from './SkillRepository'

/** Create repositories for conventional Codex, Claude and Zipply skill locations. */
export async function createSkillRepository(workspacePath?: string, userDataPath?: string): Promise<SkillRepository> {
  const home = os.homedir()
  const roots: SkillRoot[] = [
    { path: path.join(home, '.agents', 'skills'), scope: 'user', source: 'codex' },
    { path: path.join(home, '.claude', 'skills'), scope: 'user', source: 'claude' },
    { path: userDataPath ? path.join(userDataPath, 'skills') : path.join(home, '.zipply', 'skills'), scope: 'user', source: 'zipply' }
  ]

  if (workspacePath) {
    // Resolve symlinked workspaces before deriving roots, so a project root cannot
    // silently redirect its .agents/.claude skill directories outside the project.
    const canonicalWorkspace = await realpath(path.resolve(workspacePath)).catch(() => undefined)
    if (canonicalWorkspace) {
      roots.push(
        { path: path.join(canonicalWorkspace, '.agents', 'skills'), scope: 'project', source: 'codex', boundaryPath: canonicalWorkspace },
        { path: path.join(canonicalWorkspace, '.claude', 'skills'), scope: 'project', source: 'claude', boundaryPath: canonicalWorkspace }
      )
    }
  }
  return new SkillRepository(roots)
}

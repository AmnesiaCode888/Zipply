<div align="center">

  <p>
    <strong>English</strong> &nbsp;|&nbsp; <a href="README.ru.md">Русский</a>
  </p>

  <img src="resources/icon.png" width="108" height="108" alt="Zipply Logo" />

  # Zipply

  **Autonomous Desktop AI Coding Workspace**

  [![Website](https://img.shields.io/badge/Website-zipply.my-2563EB?style=flat-square&logo=googlechrome&logoColor=white)](https://zipply.my)
  [![Version](https://img.shields.io/badge/Version-0.1.0-1E293B?style=flat-square&logo=github&logoColor=white)](https://github.com/AmnesiaCode888/Zipply/releases)
  [![Telegram](https://img.shields.io/badge/Telegram-@zipplyai-229ED9?style=flat-square&logo=telegram&logoColor=white)](https://t.me/zipplyai)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Electron](https://img.shields.io/badge/Electron-33-1E293B?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
  [![React](https://img.shields.io/badge/React-18-1E293B?style=flat-square&logo=react&logoColor=61DAFB)](https://reactjs.org/)

  <p>
    Desktop AI coding partner with autonomous subagent orchestration, granular execution safety,<br/>
    Model Context Protocol (MCP), dynamic skills, built-in plugins, and an integrated workspace.
  </p>

  <p>
    <a href="https://zipply.my">
      <img src="https://img.shields.io/badge/Download_at-zipply.my-2563EB?style=for-the-badge&logo=windows&logoColor=white" alt="Download at zipply.my" />
    </a>
    &nbsp;
    <a href="https://github.com/AmnesiaCode888/Zipply/releases">
      <img src="https://img.shields.io/badge/GitHub-Releases-1E293B?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Releases" />
    </a>
  </p>

</div>

---

## Multi-Agent Architecture & Reasoning

Zipply pairs a primary coding agent (`ZipplyAgent`) with specialized subagents coordinated via a shared `Blackboard` and optional isolated Git worktrees:

| Component | Role | Capabilities |
| :--- | :--- | :--- |
| **ZipplyAgent** | Primary Engineer | End-to-end planning, file edits, patching, command execution, and verification |
| **Explorer** | Read-Only Researcher | Fast codebase navigation, symbol inspection, and architecture discovery |
| **Reviewer** | Quality & Diff Reviewer | Change auditing, check verification, and issue detection |
| **Worker** | Parallel Implementer | Isolated task execution with optional Git worktree isolation |

### Available Models & Reasoning

| Model | Context Window | Reasoning Levels | Notes |
| :--- | :--- | :--- | :--- |
| **Zipply Pro** | `500K` tokens | `off` · `low` · `high` · `max` | Primary high-capability coding & agentic model |
| **Zipply Lite** | `500K` tokens | `off` · `low` · `high` · `max` | Fast lightweight model for quick tasks |
| **Zipply Ultra** | `500K` tokens | — | Upcoming tier |

---

## Core Capabilities

### Agentic Tooling & Code Intelligence
* **Precision Editing**: `read_file`, `read_files`, `write_file`, `edit_file`, `apply_patch`, `find_files`, `search_project`, and `verify_file`.
* **Language Analysis**: Built-in `code_intelligence` with TypeScript compiler checks, Python analysis (`pyright`), and generic symbol/reference scanning.
* **Web & Browser Verification**: `search_web`, `read_page`, and live `browser_verify` powered by `playwright-core`.
* **Integrated Terminal & Processes**: Interactive `exec_command` / `write_stdin` runtime plus an embedded `xterm.js` + `node-pty` workspace terminal.

### Granular Access Modes & Safety
Control exactly how much autonomy the agent has in every chat:
* **Read-Only** — inspection and Q&A without modifying project files.
* **Confirm** — prompts before applying edits or running commands.
* **Automatic** — acts autonomously while requesting confirmation for detected high-risk commands.
* **Unrestricted** — executes project changes without prompts while still guarding paths outside the workspace.

### Built-in Plugins (On-Demand via `plugin_manager`)
* **CyberSec** — scans code and configs for secrets and risky patterns, checks Nginx/Apache directives, and inspects DNS, TLS, HTTP security headers, and TCP ports.
* **SQLite** — read-only database explorer for listing tables, inspecting schemas, and running bounded `SELECT` queries.
* **PDF Analyzer** — extracts text layers, page counts, word counts, and document metadata inside the workspace.

### Model Context Protocol (MCP) & Dynamic Skills
* **MCP Client**: Supports both `stdio` and `http` MCP servers with per-tool trust approvals (`McpTrustStore`) and registry discovery.
* **Dynamic Skills**: Load, search, create, and import reusable `SKILL.md` workflows across project, user, and package scopes.

### Desktop Workspace & Reliability
* **Integrated Side Panel**: Live file tree, diff viewer (`WorkspaceChangesService`), and tabbed terminal sessions.
* **Resilient Persistence**: Conversation checkpoints, `RunJournal` tracking, automatic context compaction (`ContextCompactor`), and `.zip` / `.json` chat archive import & export.
* **Encrypted Credentials**: OAuth session tokens and secrets stored via OS-level `safeStorage` (`SecretStore`).

---

## What We're Working On

Current focus areas we are actively improving:

* **Subagent System** — smarter parallel task delegation, tighter coordination across `Explorer`, `Reviewer`, and `Worker` subagents, and clearer live execution visibility.
* **Clean & Convenient Interface** — smoother everyday workflows, clearer activity and diff presentation, and ongoing minimalist UI/UX polish across the workspace.

---

## Downloads

Current version: **`v0.1.0`**. Pre-built packages for **Windows** (`.exe` NSIS installer) and **Linux** (`.AppImage`, `.deb`) are distributed via:

* **Official Website**: [zipply.my](https://zipply.my)
* **GitHub Releases**: [github.com/AmnesiaCode888/Zipply/releases](https://github.com/AmnesiaCode888/Zipply/releases)

> [!NOTE]
> Previous `v0.5.0-beta` builds from the earlier codebase are marked as pre-releases on the [Releases](https://github.com/AmnesiaCode888/Zipply/releases) page.

---

## Development & Build

### Prerequisites
* **Node.js** >= 18.0.0
* **npm** >= 9.0.0
* **Git**

### Quickstart
```bash
# Clone the repository
git clone https://github.com/AmnesiaCode888/Zipply.git
cd Zipply

# Install dependencies and start in development mode
npm install
npm run dev
```

### Build & CLI Scripts
```bash
npm run typecheck       # TypeScript checks (Node + Web)
npm run build           # Typecheck and bundle Main, Preload, and Renderer
npm run start           # Preview the built Electron app
npm run build:cli       # Bundle the standalone agent CLI (out/cli/zipply-agent.cjs)
```

### Verification & Tests
```bash
npm test                # Run unit and integration test suites
npm run test:e2e        # Build app and run Playwright E2E tests
npm run agent:eval      # Build CLI and evaluate agent harness fixtures
```

---

## Community & Contacts

* **Website**: [zipply.my](https://zipply.my)
* **Telegram**: [@zipplyai](https://t.me/zipplyai)
* **Email**: [support@zipply.my](mailto:support@zipply.my)

---

## License

This project is distributed under the **Business Source License 1.1 (BSL 1.1)** (see [LICENSE](LICENSE)):
* **Non-Commercial & Evaluation Use**: Free for personal, academic, and evaluation purposes.
* **Commercial Use**: Production, SaaS, or commercial deployment requires a commercial license from the author (`support@zipply.my` / [@zipplyai](https://t.me/zipplyai)).

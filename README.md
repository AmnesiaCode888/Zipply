<div align="center">

  <p>
    <strong>English</strong> &nbsp;|&nbsp; <a href="README.ru.md">Русский</a>
  </p>

  <img src="resources/icon.png" width="108" height="108" alt="Zipply Logo" style="border-radius: 22px; box-shadow: 0 10px 30px rgba(0,0,0,0.4);" />

  # Zipply

  **Simple AI Agent**

  [![Release](https://img.shields.io/github/v/release/AmnesiaCode888/Zipply?include_prereleases&label=Release&logo=github&color=2563EB)](https://github.com/AmnesiaCode888/Zipply/releases)
  [![License](https://img.shields.io/badge/License-BSL%201.1-1E293B?logo=open-source-initiative&logoColor=white)](LICENSE)
  [![Telegram](https://img.shields.io/badge/Telegram-@zipplyai-229ED9?logo=telegram&logoColor=white)](https://t.me/zipplyai)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Electron](https://img.shields.io/badge/Electron-33-1E293B?logo=electron&logoColor=white)](https://www.electronjs.org/)
  [![React](https://img.shields.io/badge/React-18-1E293B?logo=react&logoColor=61DAFB)](https://reactjs.org/)

  <p>
    Autonomous desktop AI coding partner & multi-agent workspace.<br/>
    Native Model Context Protocol (MCP) integration, dynamic skills, and long-term project memory.
  </p>

  <p>
    <a href="https://github.com/AmnesiaCode888/Zipply/releases/download/v0.4.0-beta/Zipply-0.4.0-win-x64.exe">
      <img src="https://img.shields.io/badge/Download_for_Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Download Windows" />
    </a>
    &nbsp;
    <a href="https://github.com/AmnesiaCode888/Zipply/releases/download/v0.4.0-beta/Zipply-0.4.0-linux-x86_64.AppImage">
      <img src="https://img.shields.io/badge/Download_for_Linux-1E293B?style=for-the-badge&logo=linux&logoColor=white" alt="Download Linux" />
    </a>
  </p>

</div>

---

## <img src="resources/icons/blue/bot.svg" width="22" height="22" /> Workspace Preview

<div align="center">
  <img src="resources/demo.png" width="100%" alt="Zipply Workspace Preview" style="border-radius: 12px; border: 1px solid rgba(255,255,255,0.12); box-shadow: 0 16px 48px rgba(0,0,0,0.5);" />
</div>

---

##  <img src="resources/icons/blue/terminal.svg" width="18" height="18" /> Multi-Agent Swarm

Zipply orchestrates specialized agents cooperating across a shared Blackboard architecture:

| Agent | Role | Scope & Capabilities |
| :--- | :--- | :--- |
| **ZipplyAgent** | Primary Engineer | Full filesystem read/write, CLI tool execution, multi-step self-correction |
| **ArchitectAgent** | System Architect | Read-only AST analysis, multi-file blueprints, dependency boundary mapping |
| **WorkerAgent** | Surgical Implementer | Fast localized diff edits, incremental builds, and test verification |
| **AskAgent** | Codebase Explorer | Semantic code navigation, codebase Q&A without modifying project state |
| **TerminalAgent** | Shell Specialist | Streaming command execution, smart log truncation, and error triage |
| **WebSearchAgent** | Online Researcher | Real-time web search and documentation retrieval |

---

## <img src="resources/icons/blue/cpu.svg" width="22" height="22" /> Supported AI Providers

Direct connection to state-of-the-art model APIs without mandatory subscriptions or proxies:

<div align="center">

[![Gemini](https://img.shields.io/badge/Google_Gemini-3.8_Flash_%7C_3.1_Pro-2563EB?style=flat-square&logo=googlegemini&logoColor=white)](https://ai.google.dev/)
[![Anthropic](https://img.shields.io/badge/Anthropic-Claude_Fable_5.1_%7C_Opus_5-1E293B?style=flat-square&logo=anthropic&logoColor=white)](https://anthropic.com/)
[![OpenAI](https://img.shields.io/badge/OpenAI-GPT--6_Astra_%7C_5.6_Luna-1E293B?style=flat-square&logo=openai&logoColor=white)](https://openai.com/)
[![DeepSeek](https://img.shields.io/badge/DeepSeek-V4_Flash_%7C_V4_Pro-2563EB?style=flat-square&logo=deepseek&logoColor=white)](https://deepseek.com/)
[![Ollama](https://img.shields.io/badge/Ollama-Local_Self--Hosted_Models-1E293B?style=flat-square&logo=ollama&logoColor=white)](https://ollama.ai/)
[![OpenRouter](https://img.shields.io/badge/OpenRouter-Universal_API-1E293B?style=flat-square&logo=openrouter&logoColor=white)](https://openrouter.ai/)

</div>

* **Google Gemini** — Gemini 3.8 Flash, Gemini 3.7 Flash, Gemini 3.1 Pro
* **Anthropic Claude** — Claude Fable 5.1, Claude Opus 5, Claude Sonnet 5
* **OpenAI** — GPT-6 Astra, GPT-5.6 Luna, GPT-5.6 Terra
* **DeepSeek** — DeepSeek-V4 Flash, DeepSeek-V4 Pro, DeepSeek-V3.2
* **Ollama** — Local self-hosted LLMs (DeepSeek-V4, Llama 4, Qwen 3)
* **OpenRouter** & OpenAI-compatible unified endpoints

---

## <img src="resources/icons/blue/puzzle.svg" width="22" height="22" /> Core Capabilities

### Model Context Protocol (MCP)
* Native stdio MCP client implementation.
* On-disk tool schema caching for minimal LLM context window overhead.
* 1-click import compatible with Cursor, Claude Desktop, and Antigravity configs.
* In-app server status management, environment variable controls, and tool authorization.

### Dynamic Skills Framework
* Markdown-based skills with frontmatter triggers and auto-enforcement directives.
* Semantic vector embeddings for automatic context-based skill retrieval.
* Integrated in-app Skill Editor with live preview and validation.

### Long-Term Memory & Blackboard
* Subject-based conflict invalidation: new architectural decisions automatically supersede outdated assumptions.
* Blackboard working memory tracking active hypotheses and execution context across subagent lifecycles.

### Reliability & Error Recovery
* 4-level fuzzy diff engine with Levenshtein fallback and indentation preservation.
* Fatal syntax error classification with automatic edit rollback.
* Smart head/tail log truncation preserving critical command outputs, exit codes, and stack traces.

---

## <img src="resources/icons/blue/download.svg" width="22" height="22" /> Pre-built Downloads (v0.4.0-beta)

| Platform | Format | Architecture | Direct Download |
| :--- | :--- | :--- | :--- |
| **Windows** | NSIS Installer (`.exe`) | x64 | [`Zipply-0.4.0-win-x64.exe`](https://github.com/AmnesiaCode888/Zipply/releases/download/v0.4.0-beta/Zipply-0.4.0-win-x64.exe) |
| **Linux (Portable)** | AppImage | x86_64 | [`Zipply-0.4.0-linux-x86_64.AppImage`](https://github.com/AmnesiaCode888/Zipply/releases/download/v0.4.0-beta/Zipply-0.4.0-linux-x86_64.AppImage) |
| **Debian / Ubuntu** | Package (`.deb`) | amd64 | [`zipply-0.4.0-linux-amd64.deb`](https://github.com/AmnesiaCode888/Zipply/releases/download/v0.4.0-beta/zipply-0.4.0-linux-amd64.deb) |
| **Void Linux** | Package (`.xbps`) | x86_64 | [`zipply-0.4.0_1.x86_64.xbps`](https://github.com/AmnesiaCode888/Zipply/releases/download/v0.4.0-beta/zipply-0.4.0_1.x86_64.xbps) |

> [!TIP]
> All build artifacts, SHA256 checksums, and release notes are available on the [GitHub Releases](https://github.com/AmnesiaCode888/Zipply/releases) page.

---

## <img src="resources/icons/blue/zap.svg" width="22" height="22" /> Development & Build

### Prerequisites
* Node.js >= 18.0.0
* npm >= 9.0.0
* Git

### Quickstart
```bash
# Clone the repository
git clone https://github.com/AmnesiaCode888/Zipply.git
cd Zipply

# Install dependencies and launch development mode
npm install
npm run dev
```

### Packaging Commands
```bash
# Build desktop packages
npm run build:win       # Windows NSIS (.exe)
npm run build:appimage  # Linux AppImage
npm run build:deb       # Debian / Ubuntu (.deb)
npm run build:xbps      # Void Linux (.xbps)
npm run build:all       # All release targets
```

### Verification & Test Suites
```bash
npm run typecheck       # TypeScript verification (Main, Renderer, Preload)
npm run test:agent      # Autonomous agent orchestration tests
npm run test:skills     # Skills, MCP & Memory verification suite
npm test                # Run complete test suite
```

---

## <img src="resources/icons/blue/users.svg" width="22" height="22" /> Community & Contacts

* **Telegram**: [@zipplyai](https://t.me/zipplyai)
* **Email**: [amnesiacoder@gmail.com](mailto:amnesiacoder@gmail.com)
* **Commercial Inquiries**: Contact via email or Telegram for commercial licensing, proprietary customization, and enterprise partnerships.

---

## <img src="resources/icons/blue/file-text.svg" width="22" height="22" /> License

This project is licensed under the **Business Source License 1.1 (BSL 1.1)**:
* **Non-Commercial & Evaluation Use**: Free for personal, academic, and evaluation purposes.
* **Commercial Use**: Use in commercial entities, production environments, or revenue-generating services requires a commercial license from the author.

See [LICENSE](LICENSE) for complete terms.

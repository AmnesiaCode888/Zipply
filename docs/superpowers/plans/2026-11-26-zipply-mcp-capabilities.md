# Zipply MCP Capabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make configured MCP tools discoverable in every new chat and let the agent search/install supported servers through a standard catalog, with explicit approval at external boundaries.

**Architecture:** Add a main-process client for the official MCP Registry. Persist user-approved connections in the existing profile config, connect configured servers on demand from the unified tool search, and load only a few matching schemas into the current agent snapshot. Preserve per-call approval and bind remembered trust to a stable tool-schema fingerprint.

**Tech Stack:** Electron main process, TypeScript, existing MCP SDK, Node fetch, existing IPC/ToolExecutor approval flow, Node test runner.

**Spec:** docs/superpowers/specs/2026-11-26-zipply-mcp-capabilities-design.md

## Global Constraints

- MCP configuration stays in userData; credentials stay in the OS-backed secret store.
- An MCP connection from chat must show the exact server and endpoint before it connects.
- Registry metadata is untrusted and never changes tool permissions.
- Search activates at most three matching MCP schemas; tool execution remains a separate action.
- Full access does not auto-trust a remote MCP server or tool.
- Local stdio setup remains an explicit action in the Extensions UI.
- Preserve existing extension references, resource/prompt attachment, cancellation, and parallel-chat isolation.

## Review Focus

- Registry JSON is malformed, oversized, rate limited, or returns deleted/unsupported entries; fail closed with a useful message.
- The registry endpoint changes between search and connection; approval must display the exact endpoint actually used.
- Two tools share a server/name prefix or a tool schema changes after trust; do not load or trust the wrong descriptor.
- One configured server fails or times out while others are usable; do not abort the whole run.
- A canceled install must not leave a persisted or registered server behind.

---

### Task 1: Search the Official MCP Registry

**Files:**
- Create: src/main/agent/mcp/McpRegistryClient.ts
- Modify: src/shared/extensionCatalog.ts
- Test: tests/mcp-registry-client.test.cjs

**Interfaces:**
- Produces an injectable registry client with search(query, signal) and lookup(serverName, signal).
- Returns only validated metadata and supported remote endpoint details; never returns secrets.

- [ ] Add failing tests for valid latest results, name-only search, invalid JSON shape, oversized fields, deleted entries, unsupported transport, and abort/timeout.
- [ ] Run the new test file and confirm the feature cases fail before implementation.
- [ ] Implement bounded fetch against https://registry.modelcontextprotocol.io/v0.1/servers with version=latest. Cache repeated query results briefly in memory. Validate response size, server identity/status, and HTTPS Streamable HTTP transport.
- [ ] Run tests/mcp-registry-client.test.cjs and confirm all cases pass.

### Task 2: Persist and Connect a User-Approved MCP Server

**Files:**
- Modify: src/main/agent/mcp/McpConnectionService.ts
- Modify: src/main/agent/mcp/McpConfigStore.ts only if a compatible migration is required
- Modify: src/main/agent/mcp/ManageMcpTool.ts
- Modify: src/main/ipc/AgentIpcHandler.ts
- Modify: src/renderer/src/components/chat/CommandApproval.tsx
- Test: tests/mcp-chat-connection.test.cjs

**Interfaces:**
- McpConnectionService installs a remote definition by registering a temporary runtime, connecting with no model-supplied credentials, and persisting only after a successful handshake.
- ManageMcpTool exposes registry search, configured-server listing, and connection by a validated registry record or explicit HTTP URL.
- Existing MCP confirmation IPC carries and displays the exact endpoint used by the connection operation.

- [ ] Add failing tests for registry search output, custom HTTP URL validation, explicit endpoint approval, successful save-after-handshake, rollback on failure/cancel, and duplicate IDs.
- [ ] Run the targeted tests and confirm those cases fail before implementation.
- [ ] Replace the single-entry static catalog with the injected registry client and general remote connection path. Keep stdio addition in the existing settings UI.
- [ ] Ensure the pending approval identifies the exact server and exact URL, and that only the approved descriptor is persisted.
- [ ] Run tests/mcp-chat-connection.test.cjs and tests/mcp-config-store.test.cjs.

### Task 3: Make One Search Expose the Needed MCP Schema

**Files:**
- Modify: src/main/agent/index.ts
- Modify: src/main/agent/skills/SearchExtensionToolsTool.ts
- Modify: src/main/agent/skills/SkillToolBindings.ts
- Modify: src/main/agent/mcp/ManageMcpTool.ts
- Modify: src/main/ipc/AgentIpcHandler.ts only for runtime injection changes
- Test: tests/mcp-chat-connection.test.cjs
- Test: tests/plugin-lazy-loading.test.cjs

**Interfaces:**
- SearchExtensionToolsTool receives an async callback for connecting configured servers on demand and a callback that activates one exact MCP descriptor.
- Search returns the activated schema identifiers so the next provider request can call them directly.
- Existing load action remains a compatibility fallback but is no longer needed for the normal search path.

- [ ] Add failing tests proving search_tools returns/activates the single best MCP descriptor and a new session can discover it without extensionRefs.
- [ ] Add a test proving failed configured servers do not prevent another server's tools from being found.
- [ ] Implement on-demand connection of saved profile servers with bounded concurrency and isolated failures. Remove per-chat MCP access grants for configured servers.
- [ ] Load no more than three exact ranked schemas into the current AgentBase snapshot. Keep all other schemas out of provider tool definitions.
- [ ] Bind remembered MCP trust to a stable fingerprint of the server ID, tool ID, remote name, description, and input schema; require new approval after any fingerprint change.
- [ ] Run the targeted MCP discovery and trust tests, including existing two-chat isolation cases.

### Task 4: Verify the MCP User Flow

**Files:**
- Modify: docs/agent-skills.md
- Modify: docs/superpowers/plans/2026-11-26-zipply-agent-learning.md

- [ ] Document the Registry search, install confirmation, profile-level availability, one-search schema activation, and remembered per-tool trust behavior.
- [ ] Run npm run typecheck and npm run build.
- [ ] Run the focused MCP, extension-reference, tool-search, and trust tests. Report any sandbox or loopback limitation separately from product failures.
- [ ] Confirm the UI follows AGENTS.md: neutral focus, no sharp borders or shadows, and rounded controls.

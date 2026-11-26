# Plugin Registry Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make built-in plugin metadata, runtime tool factories, AI discovery, and plugin UI follow one validated catalog and registry.

**Architecture:** A renderer-safe shared catalog owns plugin identity, version, descriptions, capabilities, examples, and icon key. A main-process registry binds each catalog ID to its trusted tool factory and validates plugin/tool uniqueness. The plugin manager tool and renderer UI consume the catalog instead of maintaining their own CyberSec metadata copies.

**Tech Stack:** TypeScript, Electron IPC, React, Node test runner, esbuild test loader.

**Spec:** User-approved built-in-first architecture in the conversation on 2026-11-06. External executable packages remain out of scope.

## Global Constraints

- Preserve per-chat lazy tool loading and its persistent `sessionId` state.
- Keep all tool schemas out of the initial prompt; expose only compact installed-plugin summaries.
- Keep network and mutating tool confirmations unchanged.
- Follow the Zipply Apple minimalist design rules in AGENTS.md.
- Do not install dependencies or execute code from external plugin packages.

## Review Focus

- A catalog entry without a runtime factory must fail validation instead of appearing installable.
- Duplicate tool IDs across plugins must be rejected before ambiguous loading.
- An installed plugin's loaded tool list must not include IDs from another plugin.
- Search and details UI must use the same metadata as the AI manager.
- Legacy installed plugin IDs and persisted per-chat tool IDs must remain readable.

### Task 1: Shared plugin catalog and runtime registry

**Files:**
- Create: `src/shared/plugins/catalog.ts`
- Modify: `src/main/agent/plugins/BuiltInPlugins.ts`
- Test: `tests/plugin-catalog.test.cjs`

**Interfaces:**
- `pluginCatalog: readonly PluginCatalogEntry[]` owns display metadata.
- `builtInPackages` binds catalog entries to `createTools()` factories.
- `validatePluginRegistry(): string[]` reports missing factories, empty tool descriptions, duplicate plugin IDs, and duplicate tool IDs.

- [x] Write contract tests for catalog metadata and registry invariants.
- [x] Run the tests and confirm the missing catalog/validator failures.
- [x] Add the shared catalog and bind the CyberSec tool factory to its manifest.
- [x] Run the focused tests and ensure they pass.

### Task 2: Manifest-driven plugin manager

**Files:**
- Modify: `src/main/agent/plugins/PluginManagerTool.ts`
- Modify: `src/main/agent/plugins/PluginManager.ts`
- Modify: `src/main/agent/plugins/BuiltInPlugins.ts`
- Test: `tests/plugin-catalog.test.cjs`, `tests/plugin-lazy-loading.test.cjs`

**Interfaces:**
- `PluginManagerTool` receives `plugins: readonly PluginCatalogEntry[]` and a per-plugin tool factory callback.
- State validation derives installable IDs from `pluginCatalog` and valid tool IDs from the runtime registry.

- [x] Test manager listing and tool descriptions with a second in-memory manifest entry.
- [x] Run the focused tests and confirm the current hard-coded CyberSec list fails them.
- [x] Make list/describe/load use injected catalog metadata and filter loaded IDs per plugin.
- [x] Run plugin state, lazy-loading, and runtime registry tests.

### Task 3: Catalog-driven renderer and final verification

**Files:**
- Modify: `src/renderer/src/components/plugins/PluginLibrary.tsx`
- Modify: `src/renderer/src/components/plugins/PluginDetails.tsx`
- Test: `tests/plugin-catalog.test.cjs`, `tests/plugin-artwork.test.cjs`

- [x] Test that library and detail content reflect the shared manifest fields.
- [x] Replace duplicated CyberSec text/category/features with shared catalog values while keeping the existing artwork and layout.
- [x] Run plugin, CyberSec, and plugin UI tests plus `npm run typecheck`.
- [x] Review the final diff and ensure existing unrelated working-tree changes are preserved.

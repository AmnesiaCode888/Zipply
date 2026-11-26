# CyberSec cleanup and SQLite/PDF plugins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce CyberSec to its seven core checks and add registered, read-only SQLite and PDF plugins.

**Architecture:** Keep the existing main-process ToolBase and shared catalog/factory architecture. Use sql.js WebAssembly to inspect database bytes in memory, and the existing pdf-parse service capability for local PDF text extraction. Renderer changes are limited to catalog icons, tool names/activity, and current CyberSec result display.

**Tech Stack:** TypeScript, Electron 33 / Node 20, sql.js WebAssembly, existing pdf-parse, node:test, esbuild.

**Spec:** [2026-11-26-cybersec-sqlite-pdf-design.md](../specs/2026-11-26-cybersec-sqlite-pdf-design.md)

## Global Constraints

- All new tools are read-only and restricted to the selected workspace.
- SQLite: `.db`, `.sqlite`, `.sqlite3`; 32 MiB input maximum; one SELECT; at most 200 rows; reject a non-empty adjacent WAL.
- PDF: `.pdf`; 20 MiB input maximum; extracted text at most 120,000 characters; no OCR.
- Preserve all existing unrelated working-tree changes; do not commit or publish.
- Follow the Zipply UI rules in `AGENTS.md`.

## Review Focus

- A symlink or traversal path must not escape the selected workspace — test both database and PDF reads.
- SQLite query strings must not execute a second or mutating statement — test DML and multiple statements.
- A live SQLite WAL must not produce a misleading stale result — test non-empty adjacent WAL rejection.
- Large PDF/database inputs must fail clearly before loading into memory — test the stated size boundaries.
- Image-only PDFs must produce a clear no-text/OCR message — test an empty-text PDF fixture if available.

---

### Task 1: Curate CyberSec and repair result presentation

**Files:**
- Modify: `src/main/agent/plugins/CyberSecTools.ts`
- Modify: `src/main/agent/plugins/BuiltInPlugins.ts`
- Delete: `src/main/agent/plugins/cybersec/Headers.ts`
- Delete: `src/main/agent/plugins/cybersec/SshFingerprint.ts`
- Delete: `src/main/agent/plugins/cybersec/NpmAudit.ts`
- Delete: `src/main/agent/plugins/cybersec/ServiceProbe.ts`
- Modify: `src/shared/plugins/catalog.ts`
- Modify: `src/renderer/src/components/tools/CyberSecToolCard.tsx`
- Modify: `src/shared/toolPresentation.ts` when reconciling current in-progress UI refactor
- Modify: `src/shared/activity.ts`
- Modify: `tests/cybersec-plugin.test.cjs`, `tests/cybersec-tool-ui.test.cjs`, `tests/e2e/cybersec-network.test.cjs`
- Delete: `tests/cybersec-npm-audit.test.cjs`, `tests/cybersec-ssh-fingerprint.test.cjs`, `tests/cybersec-service-probe.test.cjs`

**Interfaces:**
- Retain tool IDs: `cybersec_audit_project`, `cybersec_scan_secrets`, `cybersec_audit_server_config`, `cybersec_dns_records`, `cybersec_check_tls`, `cybersec_check_http_posture`, `cybersec_check_ports`.
- `cybersec_check_http_posture` is the sole HTTP posture tool; `cybersec_check_ports` remains backed by `TcpScanner.ts`.

- [x] Add behavior tests for the exact retained tool list, CAA value rendering, and accessible running/error state; update integration tests to exercise only retained tools.
- [x] Run the focused CyberSec tests and confirm the new assertions fail against the current registry/UI.
- [x] Remove the four excluded implementations and registrations, update manifest copy and active tool labels/activity, and implement CAA/accessibility fixes. Preserve legacy result rendering for saved conversations.
- [x] Run the focused CyberSec suite and the local network E2E test; record any environment-only E2E failure.

### Task 2: Add the read-only SQLite inspector

**Files:**
- Create: `src/main/agent/plugins/sqlite/InspectDatabase.ts`
- Create: `tests/sqlite-plugin.test.cjs`
- Modify: `package.json`, `package-lock.json` to add `sql.js`

**Interfaces:**
- Export `SqliteInspectDatabase extends ToolBase` with tool name `sqlite_inspect_database`.
- Input: `{ path: string, operation: 'tables' | 'describe' | 'query', table?: string, sql?: string, maxRows?: number }`.
- Resolve and canonicalize the path with existing workspace-path helpers; reject external, non-regular, unsupported-extension, oversized, and live-WAL files.
- Return safe table metadata or query columns/rows, cap at 200 rows, and never write/export the in-memory database.

- [x] Write tests for table listing, schema description, SELECT output, DML/multiple-statement rejection, unchanged source bytes, workspace escape rejection, and WAL rejection.
- [x] Run the new tests and confirm expected failures before implementation.
- [x] Add sql.js and implement bounded in-memory inspection.
- [x] Run the SQLite plugin tests and typecheck the main-process project.

### Task 3: Add the PDF analyzer

**Files:**
- Create: `src/main/agent/plugins/pdf/AnalyzeDocument.ts`
- Create: `tests/pdf-plugin.test.cjs`

**Interfaces:**
- Export `PdfAnalyzeDocument extends ToolBase` with tool name `pdf_analyze_document`.
- Input: `{ path: string }`, resolved inside the selected workspace.
- Reuse `pdf-parse`, return selected metadata and up to 120,000 text characters, and clearly report invalid, oversized, or textless files.

- [x] Write tests for local text extraction/metadata, path escape, invalid PDF, and no-text output.
- [x] Run the new tests and confirm expected failures before implementation.
- [x] Implement the analyzer using the existing pdf-parse dependency.
- [x] Run the PDF plugin tests and typecheck the main-process project.

### Task 4: Register and expose SQLite/PDF plugins

**Files:**
- Modify: `src/shared/plugins/catalog.ts`
- Modify: `src/main/agent/plugins/SqliteTools.ts`, `src/main/agent/plugins/PdfTools.ts`, `src/main/agent/plugins/BuiltInPlugins.ts`
- Modify: `src/renderer/src/components/plugins/PluginLibrary.tsx`
- Modify: `src/renderer/src/hooks/useChat.ts`, `src/shared/activity.ts`
- Modify: `tests/plugin-catalog.test.cjs` and targeted lazy-loading/UI tests

**Interfaces:**
- Plugin IDs: `sqlite` and `pdf`.
- Factories each return one tool; icon keys map to `Database` and `FileText`.
- Chat uses localized labels and stable activity text for `sqlite_inspect_database` and `pdf_analyze_document`.

- [x] Add catalog/lazy-loading tests proving both plugin IDs are listable, describable, and load only their tool.
- [x] Run the new registry tests and confirm failure before wiring the plugin factories and UI metadata.
- [x] Register both plugins and render their catalog entries/tool activity.
- [x] Run focused catalog/lazy-loading/UI tests and Node/web typechecks.

### Task 5: Whole-scope verification and review

**Files:** no new files.

- [x] Run all plugin-related unit tests and the full unit suite; full suite result: 611/647 passed, 36 failed in broader activity/chat/MCP areas outside these plugin changes. The checkout already contained extensive unrelated uncommitted work, so no clean baseline comparison was available.
- [x] Run `npm run typecheck` and `npm run build` (both pass).
- [x] Review the plugin diffs, registrations, removed CyberSec implementations, and user-owned changes; no unrelated edits were reverted.
- [x] Complete a self-review; no separate reviewer tool was available in this workflow.

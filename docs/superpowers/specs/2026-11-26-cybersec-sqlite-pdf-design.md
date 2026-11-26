# CyberSec cleanup and local data plugins

## Intent

Keep the useful, bounded CyberSec checks and add local SQLite and PDF analysis plugins. All three remain read-only and operate on the selected chat workspace.

## Goals

- Keep CyberSec project-pattern audit, secret candidates, Nginx/Apache config checks, DNS records, TLS certificate checks, HTTP posture, and selected TCP port checks.
- Remove duplicate HTTP headers, SSH through an optional executable, npm registry audit, and service-banner probing.
- Add SQLite table/schema inspection and one bounded `SELECT` query at a time.
- Add PDF metadata and text extraction using the existing PDF parser.
- Register all plugins through the shared catalog and lazy-loading registry; show useful names and activity labels in chat.
- Fix the known CAA display and CyberSec tool state accessibility issues.

## Non-goals and constraints

- No OCR for scanned PDFs; PDFs without a text layer report that clearly.
- No persistent SQLite writes or file changes. SQLite operates on an in-memory copy; queries are limited to one `SELECT` statement and 200 returned rows.
- Do not read files outside the selected workspace. Reject database/PDF files larger than 32 MiB/20 MiB respectively. PDF extracted text is capped at 120,000 characters.
- Use `sql.js` WebAssembly rather than the host's experimental `node:sqlite` API or a native binding, because the application runs on Electron 33 / Node 20.18.
- Preserve the user's unrelated uncommitted changes.

## Approaches

1. **Curated, read-only set (chosen):** retain seven reliable CyberSec tools and add SQLite/PDF read-only tools. This removes overlapping or environment-dependent features and keeps the feature surface understandable.
2. **Keep all CyberSec tools:** repair UI/test drift and retain all 11 checks. This preserves breadth but keeps duplicate and optional-executable features.
3. **Add SQLite/PDF only:** defer CyberSec cleanup. This is the smallest change but leaves the requested cleanup undone.

The user said to proceed without further discussion after the recommended option was presented, so approach 1 is the working choice. If that assumption is wrong, the removed SSH, npm audit, service-banner, and standalone header tools can be restored from the current conversation/repository history.

## Design

- SQLite plugin ID: `sqlite`; tool ID: `sqlite_inspect_database`. Accept `.db`, `.sqlite`, and `.sqlite3` paths relative to the selected workspace. Use `sql.js`'s inline WebAssembly build to open file bytes in memory. Support listing tables, describing one table, and a single read-only `SELECT`; return at most 200 rows and bounded cell text. Reject non-empty adjacent WAL files rather than silently returning a stale view.
- PDF plugin ID: `pdf`; tool ID: `pdf_analyze_document`. Accept `.pdf` paths in the selected workspace, parse with installed `pdf-parse`, and return a small safe metadata subset plus at most 120,000 text characters. Enforce a 20 MiB source limit and explain that image-only scans need OCR.
- Add both plugin manifests and factories to the existing catalog/registry. Use Lucide `Database` and `FileText` icons and localized tool/activity labels. Generic tool result rendering is sufficient for the first version.
- Remove the four excluded CyberSec tool implementations and their tests/renderer mappings. Keep `TcpScanner.ts` because the retained port checker uses it.
- Correct CAA display to render `critical`, `issue`, `issuewild`, and `iodef`; expose running/error states to assistive technology.

## Verification

- Add failing-first behavior tests for the curated CyberSec registry and UI results, SQLite path/query safety and result bounds, and PDF extraction/limits.
- Run focused CyberSec/SQLite/PDF/catalog tests, Node and web typechecks, and the full existing unit suite. Run the existing CyberSec loopback E2E test where the environment allows it.

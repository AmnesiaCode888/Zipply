# Large Chat Performance Implementation Plan

**Goal:** Keep long chats responsive while preserving navigation and chat data.

**Architecture:** Measure the existing Electron renderer on a synthetic history. Render a measured window of messages, preserving interactive state and scroll anchors outside mounted rows. Replace synchronous whole-history checkpoints with ordered asynchronous per-session persistence and safe migration. Evaluate WebAssembly only against a measured CPU-bound workload.

**Tech stack:** Electron, React, TypeScript, existing Node and Playwright tests.

## Constraints

- Preserve current uncommitted changes, session history, backups, import/export and the Zipply interface rules.
- Do not lose expanded controls, focused elements, search navigation, selection, or user scroll position when rows leave the viewport.
- Do not claim a performance gain without comparable measurements.

## Tasks

1. Record a repeatable baseline for a large history: frame delays during scrolling and panel resizing, mounted message count, and checkpoint time.
2. Implement measured virtual message rows with stable IDs and overscan. Persist interaction state independently of mounted rows; keep focused/selected content accessible. Restore bottom following, dynamic heights and search navigation. Verify short and long chats, streamed updates, resize, images, expanded controls and search targets.
3. Implement ordered asynchronous per-session checkpoint writes. Migrate legacy storage only after a durable verified copy exists; preserve recovery, delete, import, and concurrent chat ordering. Exercise write failures, interrupted migrations and stale writes.
4. Re-run the baseline, investigate remaining long tasks, and compare a WebAssembly implementation with the existing implementation only for a demonstrated CPU-bound candidate. Retain it only if end-to-end measurements justify it.
5. Run relevant unit and Electron checks, report existing failures separately and review all changes for data loss or regressions.

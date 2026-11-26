# Delete All Chats Button Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing history-clearing action explicit by labeling it “Удалить все чаты” in Settings → Data.

**Architecture:** Keep the existing `DataTab` confirmation state and `onClearAll` callback. Change only the button's visible text and tooltip; preserve its placement and clear behavior.

**Tech Stack:** React 18, TypeScript, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-11-06-sidebar-delete-all-chats-design.md`

## Global Constraints

- The action remains only in Settings → Data.
- Preserve the existing confirmation flow and clearing behavior.
- Do not delete files from chat workspace folders.
- Follow Zipply's monochrome, rounded, borderless, shadowless interface rules.

## Review Focus

- Narrow settings layouts: confirm the longer button label still fits or wraps cleanly in the existing flex layout.
- Before confirmation: the button must only open the existing cancel/confirm controls.
- Cancel: must close confirmation without clearing history.
- Confirm: must keep invoking the existing `onClearAll` handler.
- Accessibility: the visible button label and title must both say “Удалить все чаты”.

---

### Task 1: Clarify the existing clear-history button

**Files:**
- Modify: `src/renderer/src/components/settings/tabs/DataTab.tsx:73-83`

**Interfaces:**
- Consumes the existing `onClearAll: () => void` callback. No interface changes.

- [x] Update the action button's title and visible label to “Удалить все чаты”; leave `isConfirmingClear`, `handleConfirmClear`, and `onClearAll` unchanged.
- [x] Review the diff to confirm it changes only the button copy and title.

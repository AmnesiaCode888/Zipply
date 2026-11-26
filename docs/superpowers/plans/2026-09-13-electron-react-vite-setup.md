# Electron + React + Vite Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create an Electron + React + Vite desktop app with a custom frameless window (#101010 background, #202020 border, rounded corners) and macOS-style window controls in the top-right corner.

**Architecture:** Electron main process handles window creation with frameless transparent configuration and window action IPCs (`minimize`, `maximize`, `close`). Preload bridge exposes safe API. React renderer using Vite and Tailwind CSS renders the full-screen container and titlebar controls.

**Tech Stack:** Electron, React, Vite, TypeScript, Tailwind CSS, electron-vite / electron-builder.

**Spec:** `docs/superpowers/specs/2026-09-13-electron-react-vite-setup-design.md`

## Global Constraints
- Window background: `#101010`
- Window border: `#202020`
- Window corner radius: `rounded-2xl` (~16px)
- macOS-style control buttons (Close, Minimize, Maximize) placed at the top-right
- Functional IPC window control handlers

---

### Task 1: Initialize Project Scaffolding with electron-vite, React, TypeScript, and Tailwind CSS

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `tailwind.config.js`, `postcss.config.js`
- Test: `npm run build`

- [ ] **Step 1: Scaffold package.json with dependencies**
- [ ] **Step 2: Install dependencies (electron, electron-vite, react, react-dom, tailwindcss, etc.)**
- [ ] **Step 3: Setup configuration files (electron.vite.config.ts, tsconfig.json, tailwind.config.js, postcss.config.js)**
- [ ] **Step 4: Verify build works**

### Task 2: Implement Main Process and Preload with IPC Handlers

**Files:**
- Create: `src/main/index.ts`
- Create: `src/preload/index.ts`
- Create: `src/preload/index.d.ts`

- [ ] **Step 1: Implement window creation with `frame: false`, `transparent: true` in `src/main/index.ts`**
- [ ] **Step 2: Register IPC handlers for `window:minimize`, `window:maximize`, `window:close`**
- [ ] **Step 3: Expose IPC methods in `src/preload/index.ts` and types in `src/preload/index.d.ts`**

### Task 3: Implement Renderer with #101010 Background, #202020 Border, and macOS-style Controls

**Files:**
- Create: `src/renderer/index.html`
- Create: `src/renderer/src/main.tsx`
- Create: `src/renderer/src/App.tsx`
- Create: `src/renderer/src/components/TitleBar.tsx`
- Create: `src/renderer/src/assets/main.css`

- [ ] **Step 1: Create Tailwind entry point and base styles**
- [ ] **Step 2: Build `TitleBar` with macOS traffic light buttons in the top-right corner**
- [ ] **Step 3: Build `App` layout with `#101010` background, `#202020` border, and rounded corners**
- [ ] **Step 4: Verify dev and build execution**

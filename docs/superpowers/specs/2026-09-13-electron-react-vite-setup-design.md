# Design Document: Electron + React + Vite Minimal Window

## Overview
Create a boilerplate Electron + React + Vite application with TypeScript and Tailwind CSS.
The initial screen is minimalist:
- Background color: `#101010`
- Full window border: `1px solid #202020`
- Window border-radius: `rounded-2xl` (~16px) with smooth transparent background frame
- macOS-style traffic light window control buttons located at the top-right corner (Close, Minimize, Maximize/Restore) with smooth hover states and working IPC handlers.

## Architecture

### 1. Main Process (`src/main/index.ts`)
- Configures `BrowserWindow` with:
  - `frame: false`
  - `transparent: true`
  - `backgroundColor: '#00000000'`
  - `resizable: true`
  - Standard default size (1000x700), minimum size (400x300)
- Exposes IPC handlers:
  - `window:minimize`: minimizes the window
  - `window:maximize`: toggles maximize / restore
  - `window:close`: closes the window

### 2. Preload (`src/preload/index.ts`)
- Exposes `window.api`:
  ```ts
  interface WindowApi {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
  }
  ```

### 3. Renderer (`src/renderer`)
- React 18 / 19 + TypeScript + Vite + Tailwind CSS
- Root container:
  - Full screen `h-screen w-screen p-0 m-0 select-none overflow-hidden`
  - Border `border border-[#202020]`
  - Background `bg-[#101010]`
  - Rounded corners `rounded-2xl`
- Titlebar component:
  - Height: `h-10`
  - Drag region: `-webkit-app-region: drag`
  - Controls container in top-right: `-webkit-app-region: no-drag`
  - macOS buttons:
    - Red (`#FF5F56`), Yellow (`#FFBD2E`), Green (`#27C93F`)
    - Subtle hover icon indicators

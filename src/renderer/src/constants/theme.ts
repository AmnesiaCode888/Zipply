/**
 * Zipply Canonical Theme Architecture (Apple Minimalist Design)
 * 
 * Strict Zero Chroma & Pure Neutral Obsidian Hierarchy:
 * - 0 Borders across controls and surfaces (border-none)
 * - 0 Shadows / 0 Glows across all components (shadow-none)
 * - Contrast established purely through dark tonal layers (#0A0A0A -> #0E0E0E -> #161616 -> #222222)
 */

export const THEME_COLORS = {
  // Background surfaces
  canvas: '#0A0A0A',           // Main chat canvas
  sidebar: '#0E0E0E',          // App sidebar & titlebar
  surface: '#161616',          // Cards, tool containers, input field
  surfaceElevated: '#1C1C1C',  // Action drawer, popovers, dropdowns
  surfaceSecondary: '#121214', // Inner consoles, code blocks, thinking body
  control: '#222222',          // User message bubble, button bases
  controlHover: '#2C2C2C',     // Button hover state

  // Typography hierarchy
  textPrimary: '#EDEDED',      // Main message text, titles, headings
  textSecondary: '#8A8A8A',    // Metadata (Read, Search, Thought, Folder, Terminal), labels
  textMuted: '#666666',        // Placeholders, disabled states
  textWhite: '#FFFFFF',        // Pure white accents (active buttons, cursors)

  // Code Diff / Status accents
  diffAdd: '#30D158',          // Green for additions (+5)
  diffAddBg: 'rgba(48, 209, 88, 0.12)',
  diffRemove: '#FF453A',       // Red for removals (-2)
  diffRemoveBg: 'rgba(255, 69, 58, 0.12)',

  // Overlays
  hoverOverlay: 'rgba(255, 255, 255, 0.04)',
  activeOverlay: 'rgba(255, 255, 255, 0.08)'
} as const

export type ThemeColors = typeof THEME_COLORS

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      transitionDuration: {
        '250': '250ms',
        '360': '360ms',
        '450': '450ms'
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['"SF Mono"', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', '"Liberation Mono"', 'monospace']
      },
      colors: {
        background: 'var(--bg-canvas, #0A0A0A)',
        canvas: 'var(--bg-canvas, #0A0A0A)',
        sidebar: 'var(--bg-sidebar, #0E0E0E)',
        surface: {
          DEFAULT: 'var(--bg-surface, #161616)',
          elevated: 'var(--bg-surface-elevated, #1C1C1C)',
          secondary: 'var(--bg-surface-secondary, #141414)'
        },
        control: {
          DEFAULT: 'var(--bg-control, #222222)',
          hover: 'var(--bg-control-hover, #2C2C2C)'
        },
        hover: {
          DEFAULT: 'var(--bg-hover, rgba(255, 255, 255, 0.045))',
          strong: 'var(--bg-hover-strong, rgba(255, 255, 255, 0.08))'
        },
        track: 'var(--bg-track, #242424)',
        subtle: 'var(--border-subtle, rgba(255, 255, 255, 0.07))',
        hairline: 'var(--border-hairline, rgba(255, 255, 255, 0.04))',
        divider: 'var(--border-subtle, rgba(255, 255, 255, 0.07))',
        primary: 'var(--text-primary, #EDEDED)',
        secondary: 'var(--text-secondary, #8A8A8A)',
        muted: 'var(--text-muted, #666666)',
        strong: 'var(--text-strong, #FFFFFF)',
        accent: {
          DEFAULT: 'var(--accent, #0A84FF)',
          hover: 'var(--accent-hover, #0071E3)',
          soft: 'var(--accent-soft, rgba(10, 132, 255, 0.16))'
        },
        'on-accent': 'var(--text-on-accent, #FFFFFF)',
        'diff-add': 'var(--diff-add, #30D158)',
        'diff-remove': 'var(--diff-remove, #FF453A)'
      }
    }
  },
  plugins: []
}

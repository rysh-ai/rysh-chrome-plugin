/** @type {import('tailwindcss').Config} */
export default {
  content: ['./popup.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:         '#0f0f13',
        surface:    '#1a1a24',
        surface2:   '#222232',
        surface3:   '#2a2a3d',
        border:     '#2e2e42',
        primary:    '#4f46e5',
        'primary-hover': '#4338ca',
        'primary-light': '#6366f1',
        text:       '#e8e8f0',
        muted:      '#8888a8',
        dim:        '#5a5a7a',
        error:      '#f87171',
        'error-bg': '#2a1a1a',
        success:    '#34d399',
        // Terminal colours (ANSI-compatible)
        cyan:       '#00d7d7',
        'term-bg':  '#1e1e1e',
        'term-fg':  '#d4d4d4',
        'term-blue':'#5fafff',
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', '"Cascadia Code"', '"SF Mono"', 'Menlo', 'Monaco', '"Courier New"', 'monospace'],
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

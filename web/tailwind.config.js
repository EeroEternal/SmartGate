/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['Menlo', 'Consolas', 'Courier New', 'monospace'],
      },
      colors: {
        primary: '#8178E8',
        'primary-hover': '#7067D4',
        background: '#F2F1ED',
        foreground: '#26251E',
        surface: {
          100: '#F7F7F4',
          200: '#F2F1ED',
          300: '#EBEAE5',
          400: '#E6E5E0',
        },
      }
    },
  },
  plugins: [],
}

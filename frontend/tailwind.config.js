/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Share Tech Mono"', 'monospace'],
        display: ['"Share Tech Mono"', '"JetBrains Mono"', 'monospace'],
      },
      colors: {
        'neon-green': 'rgb(var(--neon-green) / <alpha-value>)',
        'neon-green-dim': 'rgb(var(--neon-green-dim) / <alpha-value>)',
        'cyber-black': 'rgb(var(--cyber-black) / <alpha-value>)',
        'cyber-surface': 'rgb(var(--cyber-surface) / <alpha-value>)',
        'cyber-darkgray': 'rgb(var(--cyber-darkgray) / <alpha-value>)',
        'cyber-gray': 'rgb(var(--cyber-gray) / <alpha-value>)',
        'cyber-light': 'rgb(var(--cyber-light) / <alpha-value>)',
        'neon-cyan': 'rgb(var(--neon-cyan) / <alpha-value>)',
        'neon-red': 'rgb(var(--neon-red) / <alpha-value>)',
        'neon-amber': 'rgb(var(--neon-amber) / <alpha-value>)',
      },
      boxShadow: {
        'neon': '0 0 10px rgb(var(--neon-green) / 0.3), 0 0 30px rgb(var(--neon-green) / 0.1)',
        'neon-strong': '0 0 15px rgb(var(--neon-green) / 0.5), 0 0 40px rgb(var(--neon-green) / 0.2), 0 0 80px rgb(var(--neon-green) / 0.1)',
        'neon-cyan': '0 0 10px rgb(var(--neon-cyan) / 0.3), 0 0 30px rgb(var(--neon-cyan) / 0.1)',
        'neon-red': '0 0 10px rgb(var(--neon-red) / 0.3), 0 0 30px rgb(var(--neon-red) / 0.1)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-up': 'slideUp 0.4s ease-out',
        'fade-in': 'fadeIn 0.5s ease-out',
        'flicker': 'flicker 4s infinite',
        'scan': 'scan 8s linear infinite',
        'type': 'type 2s steps(20) forwards',
      },
      keyframes: {
        slideUp: {
          '0%': { transform: 'translateY(12px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        flicker: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.95' },
          '52%': { opacity: '0.85' },
          '54%': { opacity: '1' },
        },
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
        type: {
          '0%': { width: '0' },
          '100%': { width: '100%' },
        },
      },
    },
  },
  plugins: [],
};

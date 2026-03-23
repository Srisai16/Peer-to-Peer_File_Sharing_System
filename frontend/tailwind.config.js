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
        'neon-green': '#39ff14',
        'neon-green-dim': '#1a7a0a',
        'cyber-black': '#0b0b0b',
        'cyber-surface': '#111111',
        'cyber-darkgray': '#2a2a2a',
        'cyber-gray': '#8a8a8a',
        'cyber-light': '#c0c0c0',
        'neon-cyan': '#00fff5',
        'neon-red': '#ff3c3c',
        'neon-amber': '#ffaa00',
      },
      boxShadow: {
        'neon': '0 0 10px rgba(57, 255, 20, 0.3), 0 0 30px rgba(57, 255, 20, 0.1)',
        'neon-strong': '0 0 15px rgba(57, 255, 20, 0.5), 0 0 40px rgba(57, 255, 20, 0.2), 0 0 80px rgba(57, 255, 20, 0.1)',
        'neon-cyan': '0 0 10px rgba(0, 255, 245, 0.3), 0 0 30px rgba(0, 255, 245, 0.1)',
        'neon-red': '0 0 10px rgba(255, 60, 60, 0.3), 0 0 30px rgba(255, 60, 60, 0.1)',
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

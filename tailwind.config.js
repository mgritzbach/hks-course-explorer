/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg:       '#0f0f17',
        surface:  '#151521',
        card:     '#1a1a28',
        border:   '#2a2a3e',
        accent:   '#38bdf8',
        pink:     '#e879a0',
        blue:     '#60a5fa',
        muted:    '#8888aa',
        label:    '#c0c0d8',
      },
    },
  },
  plugins: [],
}

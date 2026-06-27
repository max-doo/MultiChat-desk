/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: '#3b82f6', /* Deepened blue theme color */
        app: '#fcfdff', /* Slightly blueish white for app bg */
        sidebar: 'rgba(255, 255, 255, 0.8)', /* Glassmorphic sidebar bg */
        'text-primary': '#1f2937', /* Softer dark for primary text */
        'text-secondary': '#6b7280',
        'diffuse-yellow': '#FFF5D6',
        'diffuse-pink': '#FFC8DA',
        'diffuse-blue-light': '#D2E8FF',
        'diffuse-blue': '#3b82f6',
      },
      fontFamily: {
        display: ['Roboto', 'sans-serif']
      },
      borderRadius: {
        DEFAULT: '0.75rem'
      }
    }
  },
  plugins: [
    require('@tailwindcss/typography')
  ]
}


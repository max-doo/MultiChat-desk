/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: '#4dff88',
        'background-dark': '#121417',
        'background-light': '#f0f2f5'
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


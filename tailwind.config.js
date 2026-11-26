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
      fontSize: {
        // 语义字号 token：以已认可区域（SettingsDrawer 的 text-sm=14px 正文）为基准
        // tiny    10px  角标/计数 badge
        // caption 11px  说明/次要文字
        // label   12px  表单标签、tab
        // body    14px  正文（≈原 text-sm）
        // body-lg 16px  大正文/编辑器（≈原 text-base）
        // title   19px  弹窗/区块标题
        // title-lg 24px 页面级标题
        tiny: ['10px', { lineHeight: '14px' }],
        caption: ['11px', { lineHeight: '16px' }],
        label: ['12px', { lineHeight: '16px' }],
        body: ['14px', { lineHeight: '21px' }],
        'body-lg': ['16px', { lineHeight: '24px' }],
        title: ['19px', { lineHeight: '28px' }],
        'title-lg': ['24px', { lineHeight: '32px' }],
        'title-xl': ['32px', { lineHeight: '40px' }]
      },
      zIndex: {
        dropdown: '30',
        popover: '50',
        modal: '100'
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


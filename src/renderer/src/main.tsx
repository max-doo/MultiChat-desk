import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'
import 'material-symbols/outlined.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './assets/index.css'

window.addEventListener('error', (event) => {
  console.error('Global Error:', event.error || event.message)
})
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled Promise Rejection:', event.reason)
})

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)


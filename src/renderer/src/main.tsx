import React from 'react'
import ReactDOM from 'react-dom/client'
import 'katex/dist/katex.min.css'
import './styles/index.css'
import App from './App'
import { runClientMigration } from './utils/migration'

// Run automatic client-side key migration from clickcode / clickcoder namespaces
runClientMigration()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

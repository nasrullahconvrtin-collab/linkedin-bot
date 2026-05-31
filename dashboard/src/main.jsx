import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

const savedTheme = localStorage.getItem('lf_theme') === 'light' ? 'light' : 'dark';
document.documentElement.dataset.theme = savedTheme;
document.documentElement.style.colorScheme = savedTheme;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

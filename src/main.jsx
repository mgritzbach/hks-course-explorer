import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import posthog from 'posthog-js'
import App from './App.jsx'
import './index.css'

// PostHog — set VITE_POSTHOG_KEY in Cloudflare Pages environment variables
const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY
if (POSTHOG_KEY) {
  posthog.init(POSTHOG_KEY, {
    api_host: 'https://us.i.posthog.com',
    autocapture: true,
    capture_pageview: true,
    capture_pageleave: true,
    session_recording: { maskAllInputs: false },
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)

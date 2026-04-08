import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import posthog from 'posthog-js'
import App from './App.jsx'
import './index.css'

// PostHog — public project token (safe to commit). VITE_POSTHOG_KEY env var overrides if set.
// import.meta.env.PROD is true only in Vite production builds, keeping local dev clean.
const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY
  || (import.meta.env.PROD ? 'phc_uhzvPmZ8B6jUEhX2ymp6QL75dkcuyt5HS8VA4zcgYiyx' : null)
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

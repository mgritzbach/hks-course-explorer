import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import posthog from 'posthog-js'
import * as Sentry from '@sentry/react'
import App from './App.jsx'
import { TourProvider } from './components/TutorialOverlay.jsx'
import './index.css'

// Sentry — error monitoring and performance tracking
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  enabled: !!import.meta.env.VITE_SENTRY_DSN, // only runs if DSN is set
  tracesSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
  ],
})

// PostHog — public project token (safe to commit). VITE_POSTHOG_KEY env var overrides if set.
// import.meta.env.PROD is true only in Vite production builds, keeping local dev clean.
const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY
  || (import.meta.env.PROD ? 'phc_uhzvPmZ8B6jUEhX2ymp6QL75dkcuyt5HS8VA4zcgYiyx' : null)
if (POSTHOG_KEY) {
  posthog.init(POSTHOG_KEY, {
    api_host: 'https://us.i.posthog.com',
    defaults: '2026-01-30',
    person_profiles: 'identified_only',
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <TourProvider>
        <App />
      </TourProvider>
    </BrowserRouter>
  </React.StrictMode>
)

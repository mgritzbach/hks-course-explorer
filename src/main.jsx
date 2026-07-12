import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import * as Sentry from '@sentry/react'
import App from './App.jsx'
import { TourProvider } from './components/TutorialOverlay.jsx'
import { useWelcomeEntry, WelcomeEntryProvider } from './components/WelcomeEntryProvider.jsx'
import { initializeAnalytics } from './lib/analytics.js'
import { SENTRY_REPLAY_OPTIONS } from './lib/sentryReplayConfig.js'
import { installStaleAssetRecovery } from './lib/staleAssetRecovery.js'
import './index.css'

// An open tab can outlive a deployment and request a lazy chunk that belonged
// to the previous release. Refresh once so it adopts the current asset map.
installStaleAssetRecovery()

// Sentry — error monitoring and performance tracking
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  enabled: !!import.meta.env.VITE_SENTRY_DSN, // only runs if DSN is set
  tracesSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(SENTRY_REPLAY_OPTIONS),
  ],
})

// PostHog — public project token (safe to commit). VITE_POSTHOG_KEY env var overrides if set.
// import.meta.env.PROD is true only in Vite production builds, keeping local dev clean.
const POSTHOG_KEY =
  import.meta.env.VITE_POSTHOG_KEY ||
  (import.meta.env.PROD ? 'phc_uhzvPmZ8B6jUEhX2ymp6QL75dkcuyt5HS8VA4zcgYiyx' : null)
function AnalyticsBootstrap() {
  const { isWelcomeDecisionPending } = useWelcomeEntry()

  React.useEffect(() => {
    if (!POSTHOG_KEY || isWelcomeDecisionPending) return
    initializeAnalytics(POSTHOG_KEY, {
      api_host: 'https://us.i.posthog.com',
      defaults: '2026-01-30',
      person_profiles: 'identified_only',
    })
  }, [isWelcomeDecisionPending])

  return null
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <WelcomeEntryProvider>
        <AnalyticsBootstrap />
        <TourProvider>
          <App />
        </TourProvider>
      </WelcomeEntryProvider>
    </BrowserRouter>
  </React.StrictMode>,
)

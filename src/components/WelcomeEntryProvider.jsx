import { createContext, useContext, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import LandingSplash from './LandingSplash.jsx'
import { skipAllTutorials } from '../lib/tutorialPreferences.js'

const WelcomeEntryContext = createContext(null)

/**
 * Owns the first-visit choice independently from the application shell. The
 * provider stays mounted during data loading, so the welcome page is always
 * the first experience while Home receives a deterministic tour handoff.
 */
export function WelcomeEntryProvider({ children }) {
  const navigate = useNavigate()
  const [deferHomeOnboarding, setDeferHomeOnboarding] = useState(
    () => typeof window !== 'undefined' && !window.localStorage.getItem('hks-splash-shown'),
  )
  const [homeTourRequest, setHomeTourRequest] = useState(null)
  const [mainFocusRequest, setMainFocusRequest] = useState(0)

  useEffect(() => {
    if (mainFocusRequest === 0 || deferHomeOnboarding || typeof document === 'undefined') {
      return undefined
    }

    let focusFrame = 0
    let observer
    const focusWhenReady = () => {
      const main = document.getElementById('main-content')
      if (!main) return false

      // The landing portal restores #root before the next frame. Waiting for
      // that boundary prevents a focus attempt against an element that is
      // still inert while also covering lazy Home rendering.
      focusFrame = window.requestAnimationFrame(() => main.focus())
      return true
    }

    if (!focusWhenReady()) {
      observer = new MutationObserver(() => {
        if (!focusWhenReady()) return
        observer.disconnect()
      })
      observer.observe(document.body, { childList: true, subtree: true })
    }

    const timeout = window.setTimeout(() => observer?.disconnect(), 5_000)
    return () => {
      window.clearTimeout(timeout)
      window.cancelAnimationFrame(focusFrame)
      observer?.disconnect()
    }
  }, [deferHomeOnboarding, mainFocusRequest])

  const requestMainFocus = () => setMainFocusRequest((request) => request + 1)

  const continueDirectly = () => {
    skipAllTutorials()
    setHomeTourRequest(null)
    setDeferHomeOnboarding(false)
    navigate('/')
    requestMainFocus()
  }

  const continueWithTutorial = () => {
    window.localStorage.removeItem('hks-tour-home')
    setHomeTourRequest('tutorial')
    setDeferHomeOnboarding(false)
    navigate('/')
    requestMainFocus()
  }

  return (
    <WelcomeEntryContext.Provider
      value={{
        deferHomeOnboarding,
        // The landing choice applies to every tutorial, not just the legacy
        // Home tour. Route-level tours are mounted before data has loaded, so
        // they must wait until the visitor has explicitly chosen Direct or
        // Tutorial; otherwise a portal can escape the landing modal's inert
        // application root.
        isWelcomeDecisionPending: deferHomeOnboarding,
        homeTourRequest,
        consumeHomeTourRequest: () => setHomeTourRequest(null),
      }}
    >
      <LandingSplash onDirect={continueDirectly} onTutorial={continueWithTutorial} />
      {children}
    </WelcomeEntryContext.Provider>
  )
}

export function useWelcomeEntry() {
  const context = useContext(WelcomeEntryContext)
  if (!context) throw new Error('useWelcomeEntry must be used within WelcomeEntryProvider')
  return context
}

/**
 * Optional form for reusable tutorial components, which also render in
 * isolated unit tests outside the application entry provider.
 */
export function useOptionalWelcomeEntry() {
  return useContext(WelcomeEntryContext)
}

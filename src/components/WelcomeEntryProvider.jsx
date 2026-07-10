import { createContext, useContext, useState } from 'react'
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

  const focusMainContent = () => {
    window.setTimeout(() => document.getElementById('main-content')?.focus(), 0)
  }

  const continueDirectly = () => {
    skipAllTutorials()
    setHomeTourRequest(null)
    setDeferHomeOnboarding(false)
    navigate('/')
    focusMainContent()
  }

  const continueWithTutorial = () => {
    window.localStorage.removeItem('hks-tour-home')
    setHomeTourRequest('tutorial')
    setDeferHomeOnboarding(false)
    navigate('/')
    focusMainContent()
  }

  return (
    <WelcomeEntryContext.Provider
      value={{
        deferHomeOnboarding,
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

import { lazy } from 'react'
import { useWelcomeEntry } from './WelcomeEntryProvider.jsx'

const Home = lazy(() => import('../pages/Home.jsx'))

/** Bridges the landing-page decision into Home without coupling the app shell to it. */
export default function WelcomeHome(props) {
  const { deferHomeOnboarding, homeTourRequest, consumeHomeTourRequest } = useWelcomeEntry()
  return (
    <Home
      {...props}
      deferOnboarding={deferHomeOnboarding}
      welcomeTourRequest={homeTourRequest}
      onWelcomeTourRequestHandled={consumeHomeTourRequest}
    />
  )
}

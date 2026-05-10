import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  COURSES_TOUR,
  FACULTY_TOUR,
  HOME_TOUR,
  REQUIREMENTS_TOUR,
  SCHEDULE_TOUR,
  TOUR_NAMES,
} from '../lib/tourIds.js'
import config from '../school.config.js'

const TOUR_STORAGE_PREFIX = 'hks-tour-seen-'
const SPOTLIGHT_PADDING = 8
const TOOLTIP_MARGIN = 16

const TOURS = {
  [TOUR_NAMES.HOME]: [
    {
      id: HOME_TOUR.SCATTER_PLOT,
      title: 'Start with the course landscape',
      body: 'This view clusters courses so you can spot neighborhoods of similar topics and quickly identify where the catalog is dense or specialized.',
    },
    {
      id: HOME_TOUR.PRESET_PILLS,
      title: 'Use presets to narrow fast',
      body: 'Preset filters give you an immediate way to pivot by themes and priorities without rebuilding a query from scratch.',
    },
    {
      id: HOME_TOUR.COURSE_LIST,
      title: 'Review the matching course list',
      body: 'The list translates the visual exploration into concrete course options, making it easy to shortlist what deserves a closer look.',
    },
  ],
  [TOUR_NAMES.COURSES]: [
    {
      id: COURSES_TOUR.SEARCH,
      title: 'Search the catalog directly',
      body: 'Start here when you already know a keyword, course number, instructor, or topic area you want to investigate.',
    },
    {
      id: COURSES_TOUR.TOP_BIDDING,
      title: 'Watch bidding pressure',
      body: 'This panel highlights the most competitive courses so you can gauge demand before committing to a plan.',
    },
    {
      id: COURSES_TOUR.DETAIL,
      title: 'Open the full course profile',
      body: 'The detail view combines bids, ratings, workload, and student feedback so you can evaluate fit in one place.',
    },
    {
      id: COURSES_TOUR.BID_SUMMARY,
      title: 'Check the bid summary',
      body: 'Use the bidding section to understand historical clearing levels and decide whether a course is realistic for your strategy.',
    },
    {
      id: COURSES_TOUR.SHORTLIST_BUTTON,
      title: 'Save strong candidates',
      body: 'Shortlisting lets you carry promising options into later comparison and schedule-building workflows without losing momentum.',
    },
  ],
  [TOUR_NAMES.FACULTY]: [
    {
      id: FACULTY_TOUR.SEARCH,
      title: 'Search by faculty name',
      body: 'Look up instructors directly when you want to see their recent teaching record or compare teaching style signals.',
    },
    {
      id: FACULTY_TOUR.ACTIVE_SINCE,
      title: 'Focus on recent teaching',
      body: 'This filter helps you exclude older history so the page emphasizes faculty who have been active in the classroom lately.',
    },
    {
      id: FACULTY_TOUR.RATINGS,
      title: 'Scan teaching outcomes',
      body: 'Ratings summarize how students experienced the instructor across offerings, giving you a fast read on strengths and tradeoffs.',
    },
    {
      id: FACULTY_TOUR.QUICK_STATS,
      title: 'Review the quick stats',
      body: 'These headline numbers provide immediate context on volume, consistency, and the shape of the instructor\'s course portfolio.',
    },
    {
      id: FACULTY_TOUR.COURSES_TABLE,
      title: 'See the taught course list',
      body: 'The course table shows what this faculty member has actually taught, which is often the best predictor of what to explore next.',
    },
  ],
  [TOUR_NAMES.SCHEDULE]: [
    {
      id: SCHEDULE_TOUR.PLAN_SELECTOR,
      title: 'Switch between saved plans',
      body: 'Use plan tabs to sketch multiple schedules in parallel without overwriting earlier ideas.',
    },
    {
      id: SCHEDULE_TOUR.SEARCH_PANEL,
      title: 'Search and add candidate courses',
      body: config.tutorialSourceHint,
    },
    {
      id: SCHEDULE_TOUR.GRID,
      title: 'Place courses on the weekly grid',
      body: 'The grid is where conflicts become obvious and the practical shape of a semester starts to emerge.',
    },
    {
      id: SCHEDULE_TOUR.SHORTLIST,
      title: 'Manage the shortlist on the side',
      body: 'Keep a working set of courses visible while you promote, demote, and compare options during schedule construction.',
    },
    {
      id: SCHEDULE_TOUR.REQUIREMENTS,
      title: 'Track requirements as you build',
      body: 'The planner is most useful when timing and degree progress are visible together, so you can avoid elegant but noncompliant plans.',
    },
  ],
  [TOUR_NAMES.REQUIREMENTS]: [
    {
      id: REQUIREMENTS_TOUR.PROGRAM_SELECTOR,
      title: 'Choose the degree program',
      body: 'Select the program view that matches your path so every progress calculation is grounded in the right rule set.',
    },
    {
      id: REQUIREMENTS_TOUR.OVERALL_PROGRESS,
      title: 'Read total progress first',
      body: 'The overall bar gives you a fast answer to how far along you are before you dive into the categories behind it.',
    },
    {
      id: REQUIREMENTS_TOUR.PLAN_SNAPSHOT,
      title: 'Use the plan snapshot for context',
      body: 'This summary tells you how many courses are currently contributing and whether your saved plan is substantial enough to judge.',
    },
    {
      id: REQUIREMENTS_TOUR.CATEGORY_GRID,
      title: 'Inspect category-by-category coverage',
      body: 'Each requirement card shows what is already satisfied and where the remaining credit gaps still live.',
    },
    {
      id: REQUIREMENTS_TOUR.SUGGESTIONS,
      title: 'Pull targeted suggestions when blocked',
      body: 'Suggestion panels are the quickest way to turn an abstract missing requirement into a concrete next course to consider.',
    },
  ],
}

const TourContext = createContext(null)

function getStorageKey(tourName) {
  return `${TOUR_STORAGE_PREFIX}${tourName}`
}

function getCurrentPageTour() {
  if (typeof window === 'undefined') return null

  const pathname = window.location.pathname.replace(/\/+$/, '') || '/'

  if (pathname === '/') return TOUR_NAMES.HOME
  if (pathname === '/courses') return TOUR_NAMES.COURSES
  if (pathname === '/faculty') return TOUR_NAMES.FACULTY
  if (pathname === '/schedule-builder') return TOUR_NAMES.SCHEDULE
  if (pathname === '/requirements') return TOUR_NAMES.REQUIREMENTS

  return null
}

function readHasSeen(tourName) {
  if (typeof window === 'undefined' || !tourName) return false
  return window.localStorage.getItem(getStorageKey(tourName)) === '1'
}

export function TourProvider({ children }) {
  const [activeTour, setActiveTour] = useState(null)
  const [stepIndex, setStepIndex] = useState(0)

  const startTour = useCallback((tourName) => {
    if (!tourName || !TOURS[tourName]?.length) return
    setActiveTour(tourName)
    setStepIndex(0)
  }, [])

  const closeTour = useCallback(() => {
    setActiveTour(null)
    setStepIndex(0)
  }, [])

  const markSeen = useCallback((tourName) => {
    if (typeof window === 'undefined' || !tourName) return
    window.localStorage.setItem(getStorageKey(tourName), '1')
  }, [])

  useEffect(() => {
    const currentTour = getCurrentPageTour()
    if (!currentTour || readHasSeen(currentTour)) return
    startTour(currentTour)
  }, [startTour])

  const value = useMemo(() => ({
    activeTour,
    stepIndex,
    setStepIndex,
    startTour,
    closeTour,
    markSeen,
  }), [activeTour, closeTour, markSeen, startTour, stepIndex])

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>
}

export function useTour(tourName) {
  const context = useContext(TourContext)

  if (!context) {
    throw new Error('useTour must be used within a TourProvider')
  }

  const startTour = useCallback(() => {
    context.startTour(tourName)
  }, [context, tourName])

  return {
    startTour,
    hasSeen: readHasSeen(tourName),
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function getTooltipPosition(rect, cardHeight) {
  if (typeof window === 'undefined' || !rect) return null

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const cardWidth = Math.min(340, viewportWidth - TOOLTIP_MARGIN * 2)
  const resolvedCardHeight = Math.max(cardHeight || 0, 180)

  const belowTop = rect.top + rect.height + TOOLTIP_MARGIN
  const aboveTop = rect.top - resolvedCardHeight - TOOLTIP_MARGIN
  const fitsBelow = belowTop + resolvedCardHeight <= viewportHeight - TOOLTIP_MARGIN
  const top = fitsBelow
    ? belowTop
    : clamp(aboveTop, TOOLTIP_MARGIN, viewportHeight - resolvedCardHeight - TOOLTIP_MARGIN)

  const centeredLeft = rect.left + rect.width / 2 - cardWidth / 2
  const left = clamp(centeredLeft, TOOLTIP_MARGIN, viewportWidth - cardWidth - TOOLTIP_MARGIN)

  return { top, left, width: cardWidth }
}

const styles = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 9999,
    background: 'transparent',
  },
  spotlight: {
    position: 'fixed',
    zIndex: 10000,
    borderRadius: 8,
    boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
    transition: 'top 0.25s ease, left 0.25s ease, width 0.25s ease, height 0.25s ease',
    pointerEvents: 'none',
  },
  tooltip: {
    position: 'fixed',
    zIndex: 10001,
    background: '#fff',
    borderRadius: 12,
    boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
    padding: '20px 24px',
  },
  skipLink: {
    appearance: 'none',
    border: 'none',
    background: 'transparent',
    color: '#999',
    cursor: 'pointer',
    fontSize: 11,
    lineHeight: 1.2,
    padding: 0,
  },
  counter: {
    color: '#999',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.08em',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  title: {
    color: '#1a1a1a',
    fontSize: 16,
    fontWeight: 700,
    lineHeight: 1.3,
    margin: 0,
  },
  body: {
    color: '#555',
    fontSize: 14,
    lineHeight: 1.6,
    margin: '8px 0 0',
  },
  buttonRow: {
    alignItems: 'center',
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  ghostButton: {
    appearance: 'none',
    background: 'transparent',
    border: '1px solid #ddd',
    borderRadius: 999,
    color: '#555',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    padding: '10px 16px',
  },
  primaryButton: {
    appearance: 'none',
    background: '#C41230',
    border: '1px solid #C41230',
    borderRadius: 999,
    color: '#fff',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 700,
    padding: '10px 18px',
  },
}

export default function TutorialOverlay({ tourName }) {
  const context = useContext(TourContext)
  const [targetRect, setTargetRect] = useState(null)
  const [cardHeight, setCardHeight] = useState(0)
  const cardRef = useRef(null)
  const resizeHandlerRef = useRef(null)
  const rafRef = useRef(0)

  if (!context) {
    throw new Error('TutorialOverlay must be used within a TourProvider')
  }

  const { activeTour, closeTour, markSeen, setStepIndex, stepIndex } = context
  const steps = TOURS[tourName] || []
  const step = steps[stepIndex] || null
  const isActive = activeTour === tourName

  const finishTour = useCallback(() => {
    markSeen(tourName)
    closeTour()
    setTargetRect(null)
  }, [closeTour, markSeen, tourName])

  const goToStep = useCallback((nextIndex) => {
    if (nextIndex >= steps.length) {
      finishTour()
      return
    }

    setStepIndex(nextIndex)
  }, [finishTour, setStepIndex, steps.length])

  const syncToStep = useCallback((options = {}) => {
    if (!isActive || !step || typeof document === 'undefined') return

    const { allowScroll = false } = options
    const target = document.querySelector(`[data-tour="${step.id}"]`)

    if (!target) {
      goToStep(stepIndex + 1)
      return
    }

    if (allowScroll && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    }

    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      const bounds = target.getBoundingClientRect()

      if (bounds.width <= 0 || bounds.height <= 0) {
        goToStep(stepIndex + 1)
        return
      }

      setTargetRect({
        top: bounds.top - SPOTLIGHT_PADDING,
        left: bounds.left - SPOTLIGHT_PADDING,
        width: bounds.width + SPOTLIGHT_PADDING * 2,
        height: bounds.height + SPOTLIGHT_PADDING * 2,
      })
    })
  }, [goToStep, isActive, step, stepIndex])

  useEffect(() => {
    if (!isActive) {
      setTargetRect(null)
      return undefined
    }

    syncToStep({ allowScroll: true })
    resizeHandlerRef.current = () => syncToStep()
    window.addEventListener('resize', resizeHandlerRef.current)

    return () => {
      if (resizeHandlerRef.current) {
        window.removeEventListener('resize', resizeHandlerRef.current)
      }
      cancelAnimationFrame(rafRef.current)
    }
  }, [isActive, syncToStep])

  useLayoutEffect(() => {
    if (!isActive || !cardRef.current) return
    setCardHeight(cardRef.current.getBoundingClientRect().height)
  }, [isActive, stepIndex, targetRect])

  if (!isActive || !step || !targetRect || typeof document === 'undefined') {
    return null
  }

  const tooltipPosition = getTooltipPosition(targetRect, cardHeight)
  const isFirstStep = stepIndex === 0
  const isLastStep = stepIndex === steps.length - 1

  return createPortal(
    <>
      <div aria-hidden="true" style={styles.backdrop} />
      <div
        aria-hidden="true"
        style={{
          ...styles.spotlight,
          top: targetRect.top,
          left: targetRect.left,
          width: targetRect.width,
          height: targetRect.height,
        }}
      />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        style={{
          ...styles.tooltip,
          left: tooltipPosition.left,
          maxWidth: 340,
          top: tooltipPosition.top,
          width: tooltipPosition.width,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <button type="button" onClick={finishTour} style={styles.skipLink}>
            Skip tour
          </button>
        </div>
        <div style={styles.counter}>
          STEP {stepIndex + 1} OF {steps.length}
        </div>
        <h3 style={styles.title}>{step.title}</h3>
        <p style={styles.body}>{step.body}</p>
        <div style={styles.buttonRow}>
          <button
            type="button"
            onClick={() => goToStep(stepIndex - 1)}
            disabled={isFirstStep}
            style={{
              ...styles.ghostButton,
              cursor: isFirstStep ? 'not-allowed' : styles.ghostButton.cursor,
              opacity: isFirstStep ? 0.45 : 1,
            }}
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => (isLastStep ? finishTour() : goToStep(stepIndex + 1))}
            style={styles.primaryButton}
          >
            {isLastStep ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </>,
    document.body
  )
}

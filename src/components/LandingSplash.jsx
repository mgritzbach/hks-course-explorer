import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const STORAGE_KEY = 'hks-splash-shown'

/**
 * A full first-visit page. Direct opens Home immediately; Tutorial sends an
 * explicit, one-time request to start the Home tour.
 */
export default function LandingSplash({ onDirect, onTutorial }) {
  const [visible, setVisible] = useState(false)
  const [fading, setFading] = useState(false)
  const dismissTimerRef = useRef(null)
  const pageRef = useRef(null)

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) setVisible(true)
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!visible) return undefined

    // The portal is a true first-visit modal. Keep the already-rendered app
    // out of the accessibility tree and keyboard order until the visitor has
    // made an explicit Direct/Tutorial choice.
    const appRoot = document.getElementById('root')
    const previousAriaHidden = appRoot?.getAttribute('aria-hidden')
    const previousInert = appRoot?.inert
    const previousBodyOverflow = document.body.style.overflow
    if (appRoot) {
      appRoot.inert = true
      appRoot.setAttribute('aria-hidden', 'true')
    }
    document.body.style.overflow = 'hidden'
    pageRef.current?.focus()

    return () => {
      if (appRoot) {
        appRoot.inert = previousInert
        if (previousAriaHidden == null) appRoot.removeAttribute('aria-hidden')
        else appRoot.setAttribute('aria-hidden', previousAriaHidden)
      }
      document.body.style.overflow = previousBodyOverflow
    }
  }, [visible])

  const trapFocus = (event) => {
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      pageRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) || [],
    )
    if (focusable.length === 0) return

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const dismiss = (next) => {
    setFading(true)
    dismissTimerRef.current = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, '1')
      setVisible(false)
      next?.()
    }, 280)
  }

  if (!visible) return null

  return createPortal(
    <div
      ref={pageRef}
      className="landing-splash"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-heading"
      aria-describedby="welcome-description"
      tabIndex={-1}
      onKeyDown={trapFocus}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9100,
        overflowY: 'auto',
        background: '#f5f2ee',
        color: '#211d1a',
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.28s ease',
      }}
    >
      <div
        className="landing-splash-content"
        style={{
          boxSizing: 'border-box',
          display: 'flex',
          minHeight: '100%',
          width: 'min(100%, 940px)',
          margin: '0 auto',
          padding: 'clamp(36px, 8vh, 96px) clamp(24px, 7vw, 80px)',
          alignItems: 'center',
        }}
      >
        <div style={{ width: '100%' }}>
          <div
            className="landing-splash-accent"
            style={{ width: 56, height: 5, marginBottom: 30, background: '#a51c30' }}
          />
          <h1
            id="welcome-heading"
            className="landing-splash-heading"
            style={{
              maxWidth: 720,
              margin: 0,
              fontFamily: 'Georgia, serif',
              fontSize: 'clamp(38px, 6vw, 64px)',
              fontWeight: 600,
              letterSpacing: '-0.045em',
              lineHeight: 1.06,
            }}
          >
            Welcome to the HKS Course Explorer
          </h1>
          <p
            id="welcome-description"
            className="landing-splash-intro"
            style={{
              maxWidth: 720,
              margin: '30px 0 0',
              fontSize: 'clamp(18px, 2.2vw, 22px)',
              lineHeight: 1.58,
            }}
          >
            This is a student-built initiative to help HKS students get the course experience they
            desire.
          </p>
          <p
            className="landing-splash-credit"
            style={{ maxWidth: 720, margin: '18px 0 0', fontSize: 16, lineHeight: 1.58 }}
          >
            The code and maintenance are provided by Michael Gritzbach, MPA&apos;26, KSSG 2025/26.
          </p>

          <section
            aria-labelledby="disclaimer-heading"
            className="landing-splash-section landing-splash-disclaimer"
            style={{
              maxWidth: 760,
              marginTop: 42,
              paddingTop: 25,
              borderTop: '1px solid #c9c0b8',
            }}
          >
            <h2
              id="disclaimer-heading"
              style={{ margin: 0, color: '#8c1628', fontSize: 16, fontWeight: 800 }}
            >
              Disclaimer
            </h2>
            <p style={{ margin: '9px 0 0', fontSize: 16, lineHeight: 1.6 }}>
              This is not an official University website, and all use of this website and its data
              is at your own personal risk. Please confirm all course information, requirements,
              enrollment decisions, and schedules through official sources.
            </p>
          </section>

          <section
            aria-labelledby="attention-heading"
            className="landing-splash-section landing-splash-attention"
            style={{
              maxWidth: 760,
              marginTop: 24,
              padding: '20px 22px',
              borderLeft: '4px solid #a51c30',
              background: '#ece5df',
            }}
          >
            <h2
              id="attention-heading"
              style={{ margin: 0, color: '#8c1628', fontSize: 16, fontWeight: 800 }}
            >
              Attention
            </h2>
            <p style={{ margin: '9px 0 0', fontSize: 16, lineHeight: 1.6 }}>
              Due to new coding models, the repository is currently under review. We apologize for
              potential disruptions or errors while the codebase is being optimized and rewritten.
            </p>
          </section>

          <section
            className="landing-splash-continue"
            aria-labelledby="continue-heading"
            style={{ marginTop: 42 }}
          >
            <h2
              id="continue-heading"
              style={{ margin: 0, fontFamily: 'Georgia, serif', fontSize: 27, fontWeight: 600 }}
            >
              Would you like to continue?
            </h2>
            <p style={{ margin: '10px 0 18px', fontSize: 16, lineHeight: 1.55 }}>
              You can go directly to the first page and skip all tutorial boxes, or you can begin
              with a short tutorial.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <button
                type="button"
                aria-label="Continue directly and skip all tutorial boxes"
                onClick={() => dismiss(onDirect)}
                style={{
                  minWidth: 160,
                  border: '1px solid #a51c30',
                  borderRadius: 2,
                  padding: '13px 24px',
                  background: '#a51c30',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 16,
                  fontWeight: 700,
                }}
              >
                Direct
              </button>
              <button
                type="button"
                aria-label="Continue with the guided tutorial"
                onClick={() => dismiss(onTutorial)}
                style={{
                  minWidth: 160,
                  border: '1px solid #a51c30',
                  borderRadius: 2,
                  padding: '13px 24px',
                  background: 'transparent',
                  color: '#8c1628',
                  cursor: 'pointer',
                  fontSize: 16,
                  fontWeight: 700,
                }}
              >
                Tutorial
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  )
}

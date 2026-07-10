import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const STORAGE_KEY = 'hks-splash-shown'

/**
 * First-visit entry page. It deliberately requires a choice: Direct opens
 * Home without onboarding, while Tutorial hands Home an explicit tour start.
 */
export default function LandingSplash({ onDirect, onTutorial }) {
  const [visible, setVisible] = useState(false)
  const [fading, setFading] = useState(false)
  const dismissTimerRef = useRef(null)
  const dialogRef = useRef(null)

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) setVisible(true)
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
    }
  }, [])

  useEffect(() => {
    // Focusing the first button scrolls a compact mobile dialog past its HKS
    // header. Focus the modal instead; Tab still reaches Direct first.
    if (visible) dialogRef.current?.focus()
  }, [visible])

  const dismiss = (next) => {
    setFading(true)
    dismissTimerRef.current = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, '1')
      setVisible(false)
      next?.()
    }, 280)
  }

  const trapFocus = (event) => {
    if (event.key !== 'Tab') return
    const controls = dialogRef.current?.querySelectorAll('button:not([disabled])')
    if (!controls?.length) return
    const first = controls[0]
    const last = controls[controls.length - 1]

    if (
      event.shiftKey &&
      (document.activeElement === dialogRef.current || document.activeElement === first)
    ) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  if (!visible) return null

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-heading"
      aria-describedby="welcome-description welcome-disclaimer"
      onKeyDown={trapFocus}
      tabIndex={-1}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9100,
        overflowY: 'auto',
        background:
          'linear-gradient(135deg, rgba(33, 11, 16, 0.96), rgba(91, 19, 33, 0.96) 55%, rgba(36, 10, 14, 0.98))',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        // On compact screens the card can be taller than the viewport. Start
        // at the top there; on larger screens the viewport-based padding
        // retains the intended centered presentation.
        padding: 'max(24px, calc((100vh - 800px) / 2)) 16px',
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.28s ease',
      }}
    >
      <section
        style={{
          width: 'min(100%, 760px)',
          overflow: 'hidden',
          border: '1px solid rgba(224, 195, 145, 0.5)',
          borderRadius: 12,
          background: '#fffdf9',
          boxShadow: '0 30px 90px rgba(0, 0, 0, 0.48)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '18px 24px',
            background: '#a51c30',
            color: '#fff',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              display: 'grid',
              width: 42,
              height: 42,
              placeItems: 'center',
              border: '1px solid rgba(255, 255, 255, 0.68)',
              borderRadius: 2,
              fontFamily: 'Georgia, serif',
              fontSize: 25,
              fontWeight: 700,
            }}
          >
            H
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em' }}>
              HARVARD KENNEDY SCHOOL
            </p>
            <p style={{ margin: '3px 0 0', fontFamily: 'Georgia, serif', fontSize: 18 }}>
              HKS Course Explorer
            </p>
          </div>
        </div>

        <div style={{ padding: '32px 24px 28px' }}>
          <p
            style={{
              margin: '0 0 12px',
              color: '#a51c30',
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: '0.1em',
            }}
          >
            STUDENT-BUILT INITIATIVE
          </p>
          <h1
            id="welcome-heading"
            style={{
              margin: 0,
              color: '#1f1a17',
              fontFamily: 'Georgia, serif',
              fontSize: 'clamp(30px, 5vw, 46px)',
              fontWeight: 600,
              letterSpacing: '-0.035em',
              lineHeight: 1.08,
            }}
          >
            Welcome to the HKS Course Explorer
          </h1>
          <p
            id="welcome-description"
            style={{
              maxWidth: 610,
              margin: '18px 0 0',
              color: '#4d4540',
              fontSize: 17,
              lineHeight: 1.6,
            }}
          >
            This student-built initiative helps HKS students find the course experience they desire.
          </p>
          <p style={{ margin: '14px 0 0', color: '#655b54', fontSize: 14, lineHeight: 1.55 }}>
            Code and maintenance are provided by Michael Gritzbach, MPA&apos;26, KSSG 2025/26.
          </p>

          <div
            id="welcome-disclaimer"
            style={{
              marginTop: 26,
              borderLeft: '4px solid #a51c30',
              background: '#f6f0ea',
              padding: '15px 17px',
            }}
          >
            <p style={{ margin: 0, color: '#42131b', fontSize: 13, fontWeight: 800 }}>Disclaimer</p>
            <p style={{ margin: '5px 0 0', color: '#514641', fontSize: 13, lineHeight: 1.55 }}>
              This is not an official University website. Use of this tool and interpretation of its
              data are at your own discretion. Confirm schedules, requirements, enrollment, and
              other decisions with official HKS sources.
            </p>
          </div>

          <div
            role="note"
            style={{
              marginTop: 12,
              border: '1px solid #ddc78e',
              background: '#fff8df',
              padding: '14px 16px',
            }}
          >
            <p style={{ margin: 0, color: '#5b4212', fontSize: 13, fontWeight: 800 }}>Attention</p>
            <p style={{ margin: '5px 0 0', color: '#5b4a29', fontSize: 13, lineHeight: 1.55 }}>
              Due to new coding models, the repository is currently under review. We apologize for
              potential disruptions or errors while the codebase is optimized and rewritten.
            </p>
          </div>

          <div style={{ marginTop: 28, borderTop: '1px solid #dfd6ce', paddingTop: 22 }}>
            <p
              style={{
                margin: '0 0 14px',
                color: '#2f2925',
                fontFamily: 'Georgia, serif',
                fontSize: 19,
              }}
            >
              Would you like to continue?
            </p>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 10,
              }}
            >
              <button
                type="button"
                aria-label="Continue directly without the tutorial"
                onClick={() => dismiss(onDirect)}
                style={{
                  minWidth: 154,
                  border: '1px solid #a51c30',
                  borderRadius: 3,
                  padding: '12px 18px',
                  background: '#a51c30',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 15,
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
                  minWidth: 154,
                  border: '1px solid #7d171f',
                  borderRadius: 3,
                  padding: '12px 18px',
                  background: '#fffdf9',
                  color: '#7d171f',
                  cursor: 'pointer',
                  fontSize: 15,
                  fontWeight: 700,
                }}
              >
                Tutorial
              </button>
            </div>
            <p style={{ margin: '10px 0 0', color: '#746a63', fontSize: 12, lineHeight: 1.45 }}>
              Direct opens Course Explorer immediately. Tutorial starts a short guided tour of the
              first page.
            </p>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  )
}

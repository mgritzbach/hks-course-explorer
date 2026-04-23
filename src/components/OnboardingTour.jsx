import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Lightweight spotlight tour.
 *
 * Props:
 *   steps        — array of { target: string, title: string, body: string }
 *                  target is a data-tour="…" attribute value
 *   storageKey   — localStorage key; tour shown only if key is absent
 *   autoStart    — boolean; if true, shows even if user skipped the splash
 *   onDone       — called when the tour finishes or is skipped
 */
export default function OnboardingTour({ steps, storageKey, autoStart = false, onDone, onStepChange }) {
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(false)
  const [fading, setFading] = useState(false)
  const [tick, setTick] = useState(-1)

  useEffect(() => {
    const alreadySeen = localStorage.getItem(storageKey)
    if (autoStart || !alreadySeen) {
      const t = setTimeout(() => {
        setVisible(true)
      }, 400)
      return () => clearTimeout(t)
    }
    return undefined
  }, [storageKey, autoStart])

  useEffect(() => {
    if (visible) setIndex(0)
  }, [visible])

  useEffect(() => {
    if (!visible) return undefined
    onStepChange?.(index)
    // Use -1 as a "waiting for drawer animation" sentinel so tick=0 is always
    // a fresh state transition (avoids React bailing out on same-value setState).
    // On mobile give 360ms for the 260ms drawer CSS transition to finish.
    setTick(-1)
    const delay = window.innerWidth < 768 ? 360 : 0
    const t = setTimeout(() => setTick(0), delay)
    return () => clearTimeout(t)
  }, [index, visible]) // eslint-disable-line react-hooks/exhaustive-deps

  const step = steps[index]
  const rect = step
    ? (() => {
        const elements = document.querySelectorAll(`[data-tour="${step.target}"]`)
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight
        for (const element of elements) {
          const nextRect = element.getBoundingClientRect()
          if (
            nextRect.width > 0 && nextRect.height > 0 &&
            nextRect.right > 0 && nextRect.bottom > 0 &&
            nextRect.left < viewportWidth && nextRect.top < viewportHeight
          ) return nextRect
        }
    // All matching elements exist but are hidden — return null so we wait
        return null
      })()
    : null

  useEffect(() => {
    if (!visible) return undefined
    const handleWindowChange = () => {
      setTick((t) => t + 1)
    }
    window.addEventListener('resize', handleWindowChange, { passive: true })
    window.addEventListener('scroll', handleWindowChange, { passive: true, capture: true })
    return () => {
      window.removeEventListener('resize', handleWindowChange)
      window.removeEventListener('scroll', handleWindowChange, { capture: true })
    }
  }, [visible])

  useEffect(() => {
    if (!visible || rect || tick < 0 || tick >= 40) return undefined
    const t = setTimeout(() => {
      setTick((value) => value + 1)
    }, 60)
    return () => clearTimeout(t)
  }, [visible, index, tick, rect])

  // Skip a step whose target element is absent or permanently off-screen.
  // Runs after render so state updates happen outside the render cycle.
  useEffect(() => {
    if (!visible || rect || tick < 0) return
    const currentStep = steps[index]
    const anyEl = currentStep ? document.querySelectorAll(`[data-tour="${currentStep.target}"]`).length > 0 : false
    if (!anyEl || tick >= 40) {
      if (index + 1 < steps.length) {
        setIndex((i) => i + 1)
      } else {
        dismiss()
      }
    }
  }, [visible, tick]) // eslint-disable-line react-hooks/exhaustive-deps

  const dismiss = () => {
    setFading(true)
    setTimeout(() => {
      localStorage.setItem(storageKey, '1')
      setVisible(false)
      setFading(false)
      onDone?.()
    }, 200)
  }

  const next = () => {
    if (index + 1 >= steps.length) {
      dismiss()
    } else {
      setIndex((i) => i + 1)
    }
  }

  if (!visible) return null

  if (!rect) {
    // tick=-1 means we're in the drawer-open delay — don't evaluate yet
    if (tick < 0) return null
    // Use the outer `step` variable (no re-declaration needed — same value)
    const anyEl = step ? document.querySelectorAll(`[data-tour="${step.target}"]`).length > 0 : false
    // Element absent or has been hidden/off-screen too long — the skip
    // itself is handled by the useEffect below to avoid calling setState
    // during render (anti-pattern). Just return null here.
    if (!anyEl || tick >= 40) return null
    return null
  }

  const isLight = document.documentElement.getAttribute('data-theme') === 'light'

  const PAD = 8
  const spotX = rect.left - PAD
  const spotY = rect.top - PAD
  const spotW = rect.width + PAD * 2
  const spotH = rect.height + PAD * 2

  // Tooltip size — responsive on small screens
  const vw = window.innerWidth
  const vh = window.innerHeight
  const TW = Math.min(272, vw - 24)
  const TH_EST = 150

  // Prefer below, fallback above; account for mobile bottom nav (88px)
  const BOTTOM_SAFE = vw < 768 ? 88 : 12
  let tipTop = rect.bottom + 14
  if (tipTop + TH_EST > vh - BOTTOM_SAFE) tipTop = rect.top - TH_EST - 14
  tipTop = Math.max(8, tipTop)

  let tipLeft = rect.left + rect.width / 2 - TW / 2
  tipLeft = Math.max(8, Math.min(tipLeft, vw - TW - 8))

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 8800,
        pointerEvents: 'none',
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.2s ease',
      }}
    >
      {/* Dark overlay with spotlight cut-out via box-shadow */}
      <div
        style={{
          position: 'fixed',
          left: spotX, top: spotY,
          width: spotW, height: spotH,
          borderRadius: 12,
          boxShadow: [
            isLight ? '0 0 0 9999px rgba(140,110,100,0.55)' : '0 0 0 9999px rgba(0,0,0,0.60)',
            '0 0 0 2px var(--accent)',
            '0 0 0 4px rgba(212,168,106,0.22)',
          ].join(', '),
          pointerEvents: 'none',
          transition: 'left 0.18s ease, top 0.18s ease, width 0.18s ease, height 0.18s ease',
        }}
      />

      {/* Tooltip card */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        style={{
          position: 'fixed',
          left: tipLeft, top: tipTop,
          width: TW,
          background: 'var(--panel-strong)',
          border: '1px solid var(--line-strong)',
          borderRadius: 18,
          padding: '16px 18px 14px',
          boxShadow: isLight
            ? '0 16px 48px rgba(80,40,40,0.18), 0 1px 0 rgba(255,255,255,0.9) inset'
            : '0 20px 48px rgba(0,0,0,0.48)',
          pointerEvents: 'all',
          transition: 'left 0.18s ease, top 0.18s ease',
        }}
      >
        {/* Step counter + close */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span
            style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
              color: 'var(--accent-strong)',
            }}
          >
            {index + 1} / {steps.length}
          </span>
          <button
            onClick={dismiss}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', fontSize: 18, lineHeight: 1,
              padding: '0 2px', display: 'flex', alignItems: 'center',
            }}
            aria-label="Close tour"
          >
            ×
          </button>
        </div>

        <p id="tour-title" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 5 }}>
          {step.title}
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-soft)', lineHeight: 1.6, marginBottom: 14 }}>
          {step.body}
        </p>

        {/* Dot indicators */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', gap: 4, flex: 1 }}>
            {steps.map((_, i) => (
              <div
                key={i}
                style={{
                  height: 4, borderRadius: 999,
                  flex: i === index ? 2 : 1,
                  background: i === index ? 'var(--accent)' : 'var(--line)',
                  transition: 'flex 0.2s ease, background 0.2s ease',
                }}
              />
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={dismiss}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 11, color: 'var(--text-muted)',
                padding: '6px 8px',
                minHeight: 44,
                transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-soft)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}
            >
              Skip
            </button>
            <button
              onClick={next}
              style={{
                borderRadius: 999, padding: '8px 18px',
                fontSize: 12, fontWeight: 600,
                background: 'var(--accent)', color: '#fff8f5',
                border: 'none', cursor: 'pointer',
                minHeight: 44,
                boxShadow: '0 4px 12px rgba(165,28,48,0.28)',
              }}
            >
              {index + 1 >= steps.length ? 'Done ✓' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

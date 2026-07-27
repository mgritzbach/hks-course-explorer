import { useEffect, useState } from 'react'
import { capture } from '../lib/analytics.js'

export const SUPPORT_PROMPT_DELAY_MS = 25_000
export const SUPPORT_PROMPT_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000
export const SUPPORT_PROMPT_STORAGE_KEY = 'hks-support-prompt-seen-at'
export const VENMO_PROFILE_URL = 'https://venmo.com/u/mgritzbach'
export const ZELLE_QR_IMAGE_URL = '/zelle-qr.jpg'

function wasSeenRecently() {
  try {
    const seenAt = Number(window.localStorage.getItem(SUPPORT_PROMPT_STORAGE_KEY))
    return Number.isFinite(seenAt) && seenAt > 0 && Date.now() - seenAt < SUPPORT_PROMPT_COOLDOWN_MS
  } catch {
    return false
  }
}

function rememberPrompt() {
  try {
    window.localStorage.setItem(SUPPORT_PROMPT_STORAGE_KEY, String(Date.now()))
  } catch {
    // Storage can be unavailable in privacy modes. The prompt still remains dismissible.
  }
}

export default function SupportProjectPrompt({ mobileNavExpanded = false }) {
  const [open, setOpen] = useState(false)
  const [zelleOpen, setZelleOpen] = useState(false)

  useEffect(() => {
    if (wasSeenRecently()) return undefined

    let retryTimer
    const showWhenClear = () => {
      if (wasSeenRecently()) return
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
        retryTimer = window.setTimeout(showWhenClear, 5_000)
        return
      }
      setOpen(true)
      capture('support_prompt_shown')
    }

    const timer = window.setTimeout(showWhenClear, SUPPORT_PROMPT_DELAY_MS)
    return () => {
      window.clearTimeout(timer)
      window.clearTimeout(retryTimer)
    }
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return
      rememberPrompt()
      setOpen(false)
      capture('support_prompt_dismissed', { method: 'escape' })
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open])

  const acknowledge = (method) => {
    rememberPrompt()
    setOpen(false)
    setZelleOpen(false)
    capture(method === 'venmo' ? 'support_venmo_opened' : 'support_prompt_dismissed', {
      method,
    })
  }

  const showZelle = () => {
    setOpen(true)
    setZelleOpen(true)
    capture('support_zelle_qr_opened')
  }

  return (
    <div
      className="support-project-host"
      style={{ '--support-mobile-nav-offset': mobileNavExpanded ? '154px' : '96px' }}
    >
      {open && (
        <aside
          className="support-project-popup"
          role="dialog"
          aria-modal="false"
          aria-labelledby="support-project-title"
          aria-describedby="support-project-description"
        >
          <button
            type="button"
            className="support-project-close"
            aria-label="Dismiss support request"
            onClick={() => acknowledge('close')}
          >
            ×
          </button>
          <p className="support-project-kicker">Independent and free</p>
          <h2 id="support-project-title">Did this save you some time?</h2>
          <p id="support-project-description">
            I build and maintain HKS Course Explorer unpaid. If it helped, a small coffee keeps this
            student tool improving for everyone.
          </p>
          <a
            className="support-project-primary"
            href={VENMO_PROFILE_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => acknowledge('venmo')}
          >
            Buy me a coffee on Venmo
          </a>
          <button
            type="button"
            className="support-project-secondary"
            onClick={() => (zelleOpen ? setZelleOpen(false) : showZelle())}
            aria-expanded={zelleOpen}
          >
            {zelleOpen ? 'Hide Zelle QR' : 'Buy me a coffee with Zelle'}
          </button>
          {zelleOpen && (
            <div className="support-project-zelle">
              <img
                src={ZELLE_QR_IMAGE_URL}
                alt="Zelle QR code for Michael Gritzbach"
                width="220"
                height="310"
              />
              <p>Scan with your banking app to send a coffee via Zelle.</p>
            </div>
          )}

          <button
            type="button"
            className="support-project-later"
            onClick={() => acknowledge('later')}
          >
            Maybe later
          </button>
          <p className="support-project-trust">Optional · Venmo @mgritzbach or Zelle</p>
        </aside>
      )}

      <aside className="support-project-strip" aria-label="Support this free project">
        <span aria-hidden="true" className="support-project-coffee">
          ☕
        </span>
        <span>
          <strong>Useful?</strong> Help keep this independent student tool free.
        </span>
        <a
          href={VENMO_PROFILE_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => acknowledge('venmo')}
        >
          Buy a coffee · @mgritzbach
        </a>
        <button type="button" className="support-project-strip-zelle" onClick={showZelle}>
          Zelle QR
        </button>
      </aside>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

const STORAGE_KEY = 'hks-splash-shown'

export default function LandingSplash({ onStart, onSkip }) {
  const [visible, setVisible] = useState(false)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) setVisible(true)
  }, [])

  const dismiss = (cb) => {
    setFading(true)
    setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, '1')
      setVisible(false)
      cb?.()
    }, 280)
  }

  if (!visible) return null

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9100,
        backdropFilter: 'blur(28px)',
        background: 'rgba(8, 8, 16, 0.84)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
        transition: 'opacity 0.28s ease',
        opacity: fading ? 0 : 1,
      }}
    >
      <div
        style={{
          maxWidth: 460, width: '100%',
          background: 'var(--surface)',
          borderRadius: 28,
          border: '1px solid var(--line)',
          padding: '40px 36px 32px',
          textAlign: 'center',
          boxShadow: '0 48px 96px rgba(0,0,0,0.56)',
        }}
      >
        <p className="kicker mb-4">Harvard Kennedy School</p>

        <div
          style={{
            width: 64, height: 64, borderRadius: 18,
            background: 'linear-gradient(135deg, rgba(165,28,48,0.28), rgba(212,168,106,0.14))',
            border: '1px solid rgba(212,168,106,0.22)',
            margin: '0 auto 20px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 28,
          }}
        >
          📚
        </div>

        <h1
          className="serif-display text-3xl font-semibold"
          style={{ color: 'var(--text)', marginBottom: 10 }}
        >
          Course Explorer
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-soft)', marginBottom: 6, lineHeight: 1.6 }}>
          Browse HKS courses, compare evaluation data, and build your shortlist — all in one place.
        </p>
        <p className="text-xs" style={{ color: 'var(--text-muted)', marginBottom: 32 }}>
          Student-built · Independent · Real evaluation data
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            onClick={() => dismiss(onStart)}
            style={{
              width: '100%', borderRadius: 999,
              padding: '12px 24px',
              fontSize: 14, fontWeight: 600,
              background: 'linear-gradient(180deg, rgba(165,28,48,0.9), rgba(140,20,38,0.95))',
              color: '#fff8f5',
              border: '1px solid rgba(212,168,106,0.28)',
              cursor: 'pointer',
              boxShadow: '0 8px 24px rgba(165,28,48,0.32)',
              transition: 'transform 0.12s ease, box-shadow 0.12s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 12px 28px rgba(165,28,48,0.4)' }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 8px 24px rgba(165,28,48,0.32)' }}
          >
            Start Exploring →
          </button>
          <button
            onClick={() => dismiss(onSkip)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 12, color: 'var(--text-muted)',
              padding: '6px 0',
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-soft)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            Skip intro
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

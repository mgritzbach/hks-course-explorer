import { useEffect, useRef, useState } from 'react'

// Allowed domain hint shown to users
const ALLOWED_HINT = 'harvard.edu or hks.harvard.edu'

export default function AuthGate({ onAuthSuccess }) {
  const [step, setStep] = useState('email') // 'email' | 'otp' | 'success'
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)
  const cooldownRef = useRef(null)
  const otpInputRef = useRef(null)

  const isLight = typeof document !== 'undefined'
    ? document.documentElement.getAttribute('data-theme') === 'light'
    : false

  // Focus OTP input when step changes
  useEffect(() => {
    if (step === 'otp' && otpInputRef.current) {
      otpInputRef.current.focus()
    }
  }, [step])

  // Cleanup cooldown timer
  useEffect(() => () => { if (cooldownRef.current) clearInterval(cooldownRef.current) }, [])

  const startCooldown = () => {
    setResendCooldown(60)
    cooldownRef.current = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  const handleRequestOTP = async (e) => {
    e.preventDefault()
    setError('')
    if (!email.trim()) return

    setLoading(true)
    try {
      const res = await fetch('/api/auth/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Something went wrong.')
      } else {
        setStep('otp')
        startCooldown()
      }
    } catch {
      setError('Network error. Please check your connection.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOTP = async (e) => {
    e.preventDefault()
    setError('')
    if (!otp.trim()) return

    setLoading(true)
    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim().toLowerCase(), otp: otp.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Invalid code.')
        setOtp('')
      } else {
        setStep('success')
        setTimeout(() => onAuthSuccess(data.email), 600)
      }
    } catch {
      setError('Network error. Please check your connection.')
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    if (resendCooldown > 0) return
    setError('')
    setOtp('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to resend.')
      } else {
        startCooldown()
      }
    } catch {
      setError('Network error.')
    } finally {
      setLoading(false)
    }
  }

  const cardBg = isLight ? 'var(--panel-strong)' : 'var(--panel-strong)'
  const overlayBg = isLight ? 'rgba(180,160,148,0.82)' : 'rgba(8,8,16,0.92)'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: overlayBg,
        backdropFilter: 'blur(12px)',
        padding: '20px',
      }}
    >
      <div
        style={{
          background: cardBg,
          border: '1px solid var(--line)',
          borderRadius: 20,
          padding: '36px 32px',
          width: '100%',
          maxWidth: 420,
          boxShadow: isLight
            ? '0 32px 80px rgba(80,40,40,0.18), 0 2px 0 rgba(255,255,255,0.9) inset'
            : '0 32px 80px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <p className="kicker" style={{ marginBottom: 6 }}>Harvard Kennedy School</p>
          <h1 className="serif-display" style={{ fontSize: 26, fontWeight: 700, color: 'var(--text)', margin: 0, lineHeight: 1.2 }}>
            Course Explorer
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
            {step === 'email' && `Sign in with your Harvard email address to continue.`}
            {step === 'otp' && `We sent a 6-digit code to`}
            {step === 'success' && `You're in! Loading your data…`}
          </p>
          {step === 'otp' && (
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginTop: 2 }}>{email}</p>
          )}
        </div>

        {/* Email step */}
        {step === 'email' && (
          <form onSubmit={handleRequestOTP} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label className="filter-label" style={{ display: 'block', marginBottom: 6 }}>Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={`yourname@${ALLOWED_HINT.split(' ')[0]}`}
                required
                autoFocus
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: '1px solid var(--line)',
                  background: 'var(--panel-subtle)',
                  color: 'var(--text)',
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {error && (
              <p style={{ fontSize: 12, color: 'var(--danger)', margin: 0, lineHeight: 1.5 }}>{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !email.trim()}
              style={{
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 10,
                padding: '11px 0',
                fontSize: 14,
                fontWeight: 600,
                cursor: loading ? 'wait' : 'pointer',
                opacity: loading || !email.trim() ? 0.6 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              {loading ? 'Sending…' : 'Send login code →'}
            </button>

            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5, textAlign: 'center' }}>
              Requires a <span style={{ color: 'var(--gold)' }}>harvard.edu</span> email address.
              <br />Institutional subdomains (hks, hms, hbs, etc.) are all accepted.
            </p>
          </form>
        )}

        {/* OTP step */}
        {step === 'otp' && (
          <form onSubmit={handleVerifyOTP} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label className="filter-label" style={{ display: 'block', marginBottom: 6 }}>Enter the 6-digit code</label>
              <input
                ref={otpInputRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                required
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: '1px solid var(--line)',
                  background: 'var(--panel-subtle)',
                  color: 'var(--text)',
                  fontSize: 28,
                  fontFamily: 'monospace',
                  letterSpacing: '0.2em',
                  textAlign: 'center',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {error && (
              <p style={{ fontSize: 12, color: 'var(--danger)', margin: 0, lineHeight: 1.5 }}>{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || otp.length !== 6}
              style={{
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 10,
                padding: '11px 0',
                fontSize: 14,
                fontWeight: 600,
                cursor: loading ? 'wait' : 'pointer',
                opacity: loading || otp.length !== 6 ? 0.6 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              {loading ? 'Verifying…' : 'Verify code →'}
            </button>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => { setStep('email'); setOtp(''); setError('') }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, padding: 0 }}
              >
                ← Change email
              </button>
              <button
                type="button"
                onClick={handleResend}
                disabled={resendCooldown > 0 || loading}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: resendCooldown > 0 ? 'default' : 'pointer',
                  color: resendCooldown > 0 ? 'var(--text-muted)' : 'var(--gold)',
                  fontSize: 12,
                  padding: 0,
                }}
              >
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
              </button>
            </div>
          </form>
        )}

        {/* Success step */}
        {step === 'success' && (
          <div style={{ textAlign: 'center', paddingTop: 8 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
            <p style={{ color: 'var(--text)', fontWeight: 600, marginBottom: 4 }}>Access granted</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Welcome, {email}</p>
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--line)' }}>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5, textAlign: 'center' }}>
            Built independently for HKS students by{' '}
            <a href="https://www.linkedin.com/in/michael-gritzbach/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)' }}>
              Michael Gritzbach
            </a>
            . Issues? <a href="mailto:mgritzbach@hks.harvard.edu" style={{ color: 'var(--gold)' }}>Contact</a>
          </p>
        </div>
      </div>
    </div>
  )
}

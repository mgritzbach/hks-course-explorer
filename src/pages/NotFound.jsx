import { useNavigate } from 'react-router-dom'

function JFKIllustration() {
  return (
    <svg
      viewBox="0 0 220 300"
      width="180"
      height="245"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Comic illustration of JFK gesturing dramatically"
      role="img"
    >
      {/* ── Body / suit ─────────────────────────────────── */}
      <path
        d="M 68 180 L 80 165 L 110 180 L 140 165 L 152 180 L 158 300 L 62 300 Z"
        fill="#1B2B45"
      />
      {/* Suit lapels */}
      <path d="M 80 165 L 110 180 L 100 200 L 88 168 Z" fill="#243550" />
      <path d="M 140 165 L 110 180 L 120 200 L 132 168 Z" fill="#243550" />
      {/* White shirt */}
      <polygon points="110,172 97,168 102,195 110,188 118,195 123,168" fill="#F8F6F0" />
      {/* Tie — Harvard crimson */}
      <path d="M 107 174 L 110 178 L 113 174 L 111 205 L 110 208 L 109 205 Z" fill="#A51C30" />
      {/* Tie knot */}
      <ellipse cx="110" cy="174" rx="4" ry="3" fill="#8B1525" />
      {/* Pocket square */}
      <path d="M 138 178 L 146 176 L 148 184 L 140 185 Z" fill="#F8F6F0" opacity="0.7" />

      {/* ── Left arm (relaxed, down) ─────────────────────── */}
      <path
        d="M 80 172 Q 65 205 62 228"
        stroke="#1B2B45" strokeWidth="20" strokeLinecap="round" fill="none"
      />
      {/* Left hand */}
      <ellipse cx="61" cy="234" rx="11" ry="9" fill="#F2C18A" />

      {/* ── Right arm (raised, pointing UP) ─────────────── */}
      <path
        d="M 140 172 Q 162 148 172 122"
        stroke="#1B2B45" strokeWidth="20" strokeLinecap="round" fill="none"
      />
      {/* Right hand / fist */}
      <ellipse cx="175" cy="115" rx="12" ry="10" fill="#F2C18A" />
      {/* Index finger pointing up */}
      <path
        d="M 174 105 Q 176 90 177 78"
        stroke="#F2C18A" strokeWidth="7" strokeLinecap="round" fill="none"
      />
      {/* Fingernail hint */}
      <ellipse cx="177" cy="76" rx="3.5" ry="2.5" fill="#E8AA70" />

      {/* ── Neck ─────────────────────────────────────────── */}
      <rect x="102" y="148" width="16" height="20" rx="4" fill="#F2C18A" />

      {/* ── Head ─────────────────────────────────────────── */}
      {/* Face */}
      <ellipse cx="110" cy="118" rx="44" ry="50" fill="#F2C18A" />
      {/* Jaw / chin emphasis */}
      <path
        d="M 74 128 Q 72 148 88 160 Q 110 168 132 160 Q 148 148 146 128"
        fill="#F2C18A" stroke="none"
      />
      {/* Chin cleft (iconic!) */}
      <path d="M 108 160 Q 110 164 112 160" stroke="#D4956A" strokeWidth="1.5" fill="none" />

      {/* ── Hair — the Kennedy sweep ──────────────────────── */}
      {/* Hair base covering top of head */}
      <path
        d="M 66 105 Q 68 65 110 68 Q 152 65 154 105 Q 148 78 130 74 Q 110 65 90 74 Q 72 78 66 105 Z"
        fill="#2C1E10"
      />
      {/* The swept wave to the right */}
      <path
        d="M 90 68 Q 118 58 148 70 Q 158 78 154 92 Q 145 72 128 70 Q 110 63 90 68 Z"
        fill="#3D2B14"
      />
      {/* Hair part line and volume */}
      <path
        d="M 88 68 Q 105 62 122 66"
        stroke="#1A0F08" strokeWidth="2" fill="none" opacity="0.5"
      />
      {/* Sideburns */}
      <path d="M 68 108 Q 65 118 67 128" stroke="#2C1E10" strokeWidth="5" strokeLinecap="round" fill="none" />
      <path d="M 152 108 Q 155 118 153 128" stroke="#2C1E10" strokeWidth="5" strokeLinecap="round" fill="none" />

      {/* ── Face features ─────────────────────────────────── */}
      {/* Left eyebrow — slightly raised (quizzical) */}
      <path d="M 84 100 Q 91 95 98 99" stroke="#2C1E10" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {/* Right eyebrow — raised higher (dramatic) */}
      <path d="M 120 97 Q 127 91 135 96" stroke="#2C1E10" strokeWidth="2.5" fill="none" strokeLinecap="round" />

      {/* Eyes */}
      <ellipse cx="91" cy="107" rx="6" ry="4.5" fill="#fff" />
      <ellipse cx="91" cy="107" rx="4" ry="3.5" fill="#3D2B14" />
      <ellipse cx="92" cy="106" rx="1.5" ry="1.5" fill="#fff" opacity="0.6" />

      <ellipse cx="129" cy="107" rx="6" ry="4.5" fill="#fff" />
      <ellipse cx="129" cy="107" rx="4" ry="3.5" fill="#3D2B14" />
      <ellipse cx="130" cy="106" rx="1.5" ry="1.5" fill="#fff" opacity="0.6" />

      {/* Nose — straight, slight shadow */}
      <path d="M 110 113 L 107 124 Q 110 127 113 124" stroke="#D4956A" strokeWidth="1.5" fill="none" strokeLinecap="round" />

      {/* Mouth — wry grin, one side up */}
      <path d="M 95 136 Q 110 144 126 136" stroke="#B87050" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* Lower lip */}
      <path d="M 99 137 Q 110 141 122 137" stroke="#D4806A" strokeWidth="1" fill="none" opacity="0.5" />

      {/* ── Ear ──────────────────────────────────────────── */}
      <path d="M 66 112 Q 60 118 62 128 Q 66 134 70 128 Q 68 120 70 112 Z" fill="#EAB07A" />
      <path d="M 154 112 Q 160 118 158 128 Q 154 134 150 128 Q 152 120 150 112 Z" fill="#EAB07A" />

      {/* ── Flag pin on lapel ─────────────────────────────── */}
      <circle cx="96" cy="178" r="4" fill="#A51C30" />
      <rect x="94.5" y="173" width="3" height="5" fill="#A51C30" rx="1" />

      {/* ── Speech bubble ─────────────────────────────────── */}
      <path
        d="M 158 35 Q 158 10 185 10 Q 215 10 215 35 Q 215 58 190 60 Q 188 65 182 68 Q 183 62 180 60 Q 158 58 158 35 Z"
        fill="#FFFEF8" stroke="#D4C090" strokeWidth="1.5"
      />
      <text x="187" y="30" textAnchor="middle" fontSize="9" fill="#3B2A1A" fontFamily="serif" fontStyle="italic">Ask</text>
      <text x="187" y="42" textAnchor="middle" fontSize="9" fill="#3B2A1A" fontFamily="serif" fontStyle="italic">not…</text>
      <text x="187" y="54" textAnchor="middle" fontSize="8" fill="#A51C30" fontFamily="serif" fontStyle="italic">wait.</text>
    </svg>
  )
}

export default function NotFound() {
  const navigate = useNavigate()

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-6 py-16 text-center"
      style={{ background: 'var(--bg)' }}
    >
      {/* 404 label */}
      <p
        className="mb-2 font-mono text-sm font-bold tracking-widest uppercase"
        style={{ color: 'var(--accent)', opacity: 0.5 }}
      >
        Error 404
      </p>

      {/* JFK illustration */}
      <div className="mb-4 select-none" style={{ filter: 'drop-shadow(0 4px 16px rgba(0,0,0,0.12))' }}>
        <JFKIllustration />
      </div>

      {/* Headline */}
      <h1
        className="serif-display mb-3 max-w-sm text-2xl font-bold leading-snug md:text-3xl"
        style={{ color: 'var(--text)' }}
      >
        "I know it says{' '}
        <span style={{ color: 'var(--accent)' }}>'Ask what you can do'</span>
        …"
      </h1>

      {/* Punchline */}
      <p
        className="mb-1 max-w-xs text-base leading-relaxed"
        style={{ color: 'var(--text-soft)' }}
      >
        "…but I am afraid this cannot be done at the moment."
      </p>

      {/* Attribution */}
      <p
        className="mb-8 text-xs italic"
        style={{ color: 'var(--text-muted)' }}
      >
        — John F. Kennedy, probably, from the afterlife
      </p>

      {/* Nav buttons */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={() => navigate('/')}
          className="rounded-full px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-85"
          style={{ background: 'var(--accent)', color: '#fff8f5' }}
        >
          ← Back to Home
        </button>
        <button
          onClick={() => navigate('/courses')}
          className="rounded-full border px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ borderColor: 'var(--line)', color: 'var(--text-soft)', background: 'var(--panel-subtle)' }}
        >
          Browse Courses
        </button>
      </div>

      {/* Tiny footer note */}
      <p className="mt-10 text-[11px]" style={{ color: 'var(--text-muted)', opacity: 0.5 }}>
        HKS Course Explorer · Page not found
      </p>
    </div>
  )
}

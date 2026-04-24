import { HKS_RESOURCES } from '../resourceLinks.js'

export default function Resources() {
  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <p className="kicker mb-1">Official Links</p>
      <h1 className="serif-display text-2xl font-semibold mb-1" style={{ color: 'var(--text)' }}>HKS Resources</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
        Curated links for course planning, registration, and programs.
      </p>

      {/* Android APK download card */}
      <a
        href="https://github.com/mgritzbach/hks-course-explorer/releases/download/v1.0-android/HKS-Course-Explorer-v1.0.apk"
        className="mb-6 flex items-center gap-4 rounded-2xl px-5 py-4 transition-opacity hover:opacity-90"
        style={{ background: 'linear-gradient(135deg, var(--accent) 0%, #7a1020 100%)', textDecoration: 'none' }}
        aria-label="Download Android APK"
      >
        <span style={{ fontSize: 36, lineHeight: 1 }}>🤖</span>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-sm" style={{ color: '#fff' }}>Download for Android</p>
          <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11 }}>HKS-Course-Explorer-v1.0.apk · 9.7 MB</p>
        </div>
        <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: 20 }}>↓</span>
      </a>

      <div className="flex flex-col gap-6">
        {HKS_RESOURCES.map((section) => (
          <div key={section.group}>
            <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 6 }}>
              {section.group}
            </p>
            <div
              className="rounded-[14px] overflow-hidden"
              style={{ border: '1px solid var(--line)', background: 'var(--panel-strong)' }}
            >
              {section.links.map((link, i) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    textDecoration: 'none',
                    borderTop: i > 0 ? '1px solid var(--line)' : 'none',
                    gap: 12,
                  }}
                  className="transition-colors"
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--panel-subtle)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
                >
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{link.label}</p>
                    {link.desc && (
                      <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{link.desc}</p>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {link.auth && (
                      <span
                        style={{
                          fontSize: 9.5,
                          fontWeight: 600,
                          color: 'var(--gold)',
                          background: 'var(--gold-soft)',
                          border: '1px solid var(--gold-soft)',
                          borderRadius: 6,
                          padding: '2px 6px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        🔒 {link.auth}
                      </span>
                    )}
                    <span style={{ fontSize: 13, color: 'var(--text-muted)', opacity: 0.5 }}>↗</span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

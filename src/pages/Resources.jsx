import { HKS_RESOURCES } from '../resourceLinks.js'

export default function Resources() {
  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <p className="kicker mb-1">Official Links</p>
      <h1 className="serif-display text-2xl font-semibold mb-1" style={{ color: 'var(--text)' }}>HKS Resources</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
        Curated links for course planning, registration, and programs.
      </p>

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
                          background: 'rgba(212,168,106,0.12)',
                          border: '1px solid rgba(212,168,106,0.22)',
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

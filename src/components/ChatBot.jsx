import posthog from 'posthog-js'
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import config from '../school.config.js'

function dedupeCourseSummaries(items, limit = 30) {
  const seen = new Set()
  const deduped = []
  for (const item of items) {
    if (!item?.code || seen.has(item.code)) continue
    seen.add(item.code)
    deduped.push(item)
    if (deduped.length >= limit) break
  }
  return deduped
}

function toCourseSummary(course) {
  return {
    code: course.course_code,
    name: course.course_name,
    instructor: course.professor_display || course.professor,
    concentration: course.concentration,
    term: course.term,
    rating_pct: Math.round(coursesafe(course.metrics_pct?.Course_Rating)),
    workload_pct: Math.round(coursesafe(course.metrics_pct?.Workload)),
    instructor_pct: Math.round(coursesafe(course.metrics_pct?.Instructor_Rating)),
    bid_price_pts: course.last_bid_price ?? null,
    is_core: course.is_core,
    stem: course.stem_group ?? null,
  }
}

function coursesafe(value) {
  return Number.isFinite(value) ? value : 0
}

function rankCourse(course) {
  if (course.is_average) return 3
  return course.year || 0
}

function condenseCourses(courses, query, shortlistedCodes = []) {
  if (!courses?.length) return []
  const keywords = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2)
  const shortlistedSet = new Set(shortlistedCodes)

  // Use the most recent year with eval data for keyword matching
  const recentYear = Math.max(...courses.filter((c) => !c.is_average && c.has_eval && c.year).map((c) => c.year), 0)

  const keywordMatches = courses
    .filter((c) => !c.is_average && c.year === recentYear)
    .map((c) => {
      const haystack = [c.course_name, c.course_code, c.professor_display, c.concentration].join(' ').toLowerCase()
      const score = keywords.reduce((s, kw) => s + (haystack.includes(kw) ? 1 : 0), 0)
      return { c, score }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 25)
    .map(({ c }) => toCourseSummary(c))

  const shortlistedCourses = courses
    .filter((course) => shortlistedSet.has(course.course_code_base || course.course_code))
    .sort((a, b) => rankCourse(b) - rankCourse(a) || (b.year || 0) - (a.year || 0))
    .map((course) => toCourseSummary(course))

  return dedupeCourseSummaries([...shortlistedCourses, ...keywordMatches], 30)
}

// Routes where the ChatBot FAB would collide with UI elements
const HIDDEN_ROUTES = ['/schedule-builder', '/admin']

export default function ChatBot({ courses, favs, isLight = false }) {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  const isHidden = HIDDEN_ROUTES.some((route) => location.pathname.startsWith(route))

  useEffect(() => {
    if (isHidden || !open) return
    if (messages.length === 0) {
      setMessages([{ role: 'assistant', content: config.chatWelcome }])
      posthog.capture('chatbot_opened')
    }
    const timer = setTimeout(() => inputRef.current?.focus(), 120)
    return () => clearTimeout(timer)
  }, [open, isHidden])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const send = async () => {
    if (!input.trim() || loading) return
    const userMsg = input.trim()
    setInput('')
    posthog.capture('chatbot_message_sent', { message_length: userMsg.length, turn: messages.filter(m => m.role === 'user').length + 1 })
    const next = [...messages, { role: 'user', content: userMsg }]
    setMessages(next)
    setLoading(true)

    try {
      const shortlistedCodes = Array.from(favs?.favorites || [])
      const shortlistedNames = shortlistedCodes
        .map((code) => courses.find((course) => (course.course_code_base || course.course_code) === code)?.course_name)
        .filter(Boolean)

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          history: next.slice(-4).map((m) => ({ role: m.role, content: m.content })),
          courses: condenseCourses(courses, userMsg, shortlistedCodes),
          context: { shortlisted: shortlistedNames },
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${data.error || res.status}` }])
        return
      }

      const contentType = res.headers.get('content-type') || ''
      const isStream = contentType.includes('text/event-stream')

      if (!isStream) {
        // Fallback: plain JSON response
        const data = await res.json().catch(() => ({}))
        setMessages((prev) => [...prev, { role: 'assistant', content: data.reply || `Error: ${data.error || 'No response'}` }])
        return
      }

      // Stream tokens in as they arrive
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let reply = ''
      setLoading(false)
      setMessages((prev) => [...prev, { role: 'assistant', content: '…' }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (payload === '[DONE]') break
          try {
            const { token, error } = JSON.parse(payload)
            if (error) { reply = `Error: ${error}`; break }
            if (token) {
              reply += token
              setMessages((prev) => {
                const updated = [...prev]
                updated[updated.length - 1] = { role: 'assistant', content: reply }
                return updated
              })
            }
          } catch {
            // Ignore stream parsing errors
          }
        }
      }

      // If stream ended with nothing, surface an error
      if (!reply) {
        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: 'No response received. Please try again.' }
          return updated
        })
      }
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Connection error. Please try again.' }])
    } finally {
      setLoading(false)
    }
  }

  // Don't render on routes where the FAB collides with tool UI (guard is here, after all hooks)
  if (isHidden) return null

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close course advisor' : 'Open course advisor'}
        className="chat-fab"
        style={{
          background: open ? 'var(--panel-strong)' : 'var(--accent)',
          color: open ? 'var(--text-muted)' : '#fff8f5',
          border: open ? '1px solid var(--line)' : 'none',
          boxShadow: open ? 'none' : '0 8px 24px rgba(165,28,48,0.42)',
        }}
      >
        {open ? '✕' : '✦ Find my course'}
      </button>

      {/* Panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Course Advisor"
          aria-modal="false"
          className="chat-panel"
          style={{
            background: 'var(--panel-strong)',
            border: '1px solid var(--line-strong)',
            boxShadow: isLight
              ? '0 -16px 48px rgba(80,40,40,0.14)'
              : '0 -16px 48px rgba(0,0,0,0.48)',
          }}
        >
          {/* Header */}
          <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16, color: 'var(--accent)' }}>✦</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Course Advisor</p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{config.chatFootnote}</p>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close Course Advisor"
              title="Close"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, padding: '0 2px', lineHeight: 1 }}
            >
              ×
            </button>
          </div>

          {/* Disclaimer */}
          <div style={{ padding: '7px 14px', borderBottom: '1px solid var(--line)', background: 'rgba(165,28,48,0.04)' }}>
            <p style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              ⚠️ Based on free AI models — use as orientation only, not a reliable source of truth.
            </p>
          </div>

          {/* Messages */}
          <div aria-live="polite" aria-atomic="false" style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 8px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {messages.map((msg, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div
                  style={{
                    maxWidth: '86%',
                    padding: '10px 14px',
                    borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                    background: msg.role === 'user'
                      ? 'linear-gradient(160deg, rgba(165,28,48,0.30), rgba(165,28,48,0.14))'
                      : 'var(--panel-subtle)',
                    border: '1px solid var(--line)',
                    fontSize: 13,
                    lineHeight: 1.65,
                    color: 'var(--text)',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{ padding: '10px 16px', borderRadius: '18px 18px 18px 4px', background: 'var(--panel-subtle)', border: '1px solid var(--line)', fontSize: 13, color: 'var(--text-muted)' }}>
                  thinking…
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ padding: '8px 12px calc(env(safe-area-inset-bottom, 0px) + 12px)', borderTop: '1px solid var(--line)', display: 'flex', gap: 8 }}>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder="light workload, climate policy, good ratings…"
              style={{
                flex: 1,
                background: 'var(--panel-subtle)',
                border: '1px solid var(--line)',
                borderRadius: 12,
                padding: '10px 14px',
                fontSize: 13,
                color: 'var(--text)',
                outline: 'none',
                minHeight: 44,
              }}
            />
            <button
              onClick={send}
              disabled={!input.trim() || loading}
              aria-label="Send message"
              title="Send"
              style={{
                background: 'var(--accent)',
                color: '#fff8f5',
                border: 'none',
                borderRadius: 12,
                padding: '10px 16px',
                fontSize: 15,
                fontWeight: 700,
                cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
                opacity: input.trim() && !loading ? 1 : 0.45,
                minHeight: 44,
                transition: 'opacity 0.15s',
              }}
            >
              →
            </button>
          </div>
        </div>
      )}
    </>
  )
}

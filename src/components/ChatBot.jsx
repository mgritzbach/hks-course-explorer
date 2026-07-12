import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import config from '../school.config.js'
import { capture } from '../lib/analytics.js'

function dedupeCourseSummaries(items, limit = 30) {
  const seen = new Set()
  const deduped = []
  for (const item of items) {
    if (!item?.code) continue
    const key = [item.code, item.instructor, item.year, item.term, item.is_average].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(item)
    if (deduped.length >= limit) break
  }
  return deduped
}

const QUERY_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'course',
  'courses',
  'does',
  'for',
  'instructor',
  'is',
  'professor',
  's',
  'teach',
  'teaches',
  'the',
  'what',
  'which',
  'who',
])

function searchableText(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function meaningfulQueryTerms(query) {
  return searchableText(query)
    .split(/\s+/)
    .filter((term) => term.length > 1 && !QUERY_STOP_WORDS.has(term))
}

export function normalizeOptionalBoolean(value) {
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1' || value === 'true') return true
  if (value === 0 || value === '0' || value === 'false') return false
  return undefined
}

export function toCourseSummary(course) {
  return {
    code: course.course_code,
    base_code: course.course_code_base || course.course_code,
    name: course.course_name,
    instructor: course.professor_display || course.professor,
    concentration: course.concentration,
    term: course.term,
    year: Number.isFinite(course.year) ? course.year : undefined,
    rating_pct: optionalRounded(course.metrics_pct?.Course_Rating),
    workload_pct: optionalRounded(course.metrics_pct?.Workload),
    instructor_pct: optionalRounded(course.metrics_pct?.Instructor_Rating),
    bid_price_pts: course.last_bid_price ?? null,
    // Older catalogue rows can contain 0/1, strings, or null. The Worker
    // accepts only a real boolean, so normalize known values and omit unknowns.
    is_core: normalizeOptionalBoolean(course.is_core),
    is_average: normalizeOptionalBoolean(course.is_average),
    stem: course.stem_group ?? null,
  }
}

function optionalRounded(value) {
  return Number.isFinite(value) ? Math.round(value) : undefined
}

function rankCourse(course) {
  if (course.is_average) return 3
  return course.year || 0
}

export function condenseCourses(courses, query, shortlistedCodes = []) {
  if (!courses?.length) return []
  const keywords = meaningfulQueryTerms(query)
  const shortlistedSet = new Set(shortlistedCodes)

  const scoredCourses = courses
    .map((c) => {
      const instructor = searchableText(c.professor_display || c.professor)
      const courseText = searchableText(
        [c.course_name, c.course_code, c.course_code_base, c.concentration].join(' '),
      )
      const instructorHits = keywords.filter((keyword) => instructor.includes(keyword)).length
      const courseHits = keywords.filter((keyword) => courseText.includes(keyword)).length
      const exactInstructor = keywords.length >= 2 && instructorHits === keywords.length
      return {
        c,
        exactInstructor,
        instructorHits,
        score: instructorHits * 20 + courseHits * 5,
      }
    })
    .sort(
      (a, b) =>
        Number(b.exactInstructor) - Number(a.exactInstructor) ||
        b.score - a.score ||
        rankCourse(b.c) - rankCourse(a.c) ||
        (b.c.year || 0) - (a.c.year || 0),
    )

  // A named-faculty question needs the complete matching history, not rows
  // from only the catalogue's globally newest year. Supplying unrelated rows
  // in this case caused the model/fallback to pad factual answers.
  const exactInstructorMatches = scoredCourses.filter(({ exactInstructor }) => exactInstructor)
  // A follow-up can use only part of the name (for example, "Is Hong a good
  // professor?"). Once any instructor token matches, keep the context focused
  // on those instructors and never mix in incidental title matches from words
  // such as "good". The LLM receives the conversation history separately.
  const instructorMatches = scoredCourses.filter(({ instructorHits }) => instructorHits > 0)
  const asksAboutInstructor = /\b(?:faculty|instructor|professor|teach|teaches|taught)\b/.test(
    searchableText(query),
  )
  const focusedInstructorMatches =
    exactInstructorMatches.length > 0 || asksAboutInstructor ? instructorMatches : []
  const relevantMatches =
    focusedInstructorMatches.length > 0
      ? focusedInstructorMatches
      : scoredCourses.filter(({ score }) => score > 0).slice(0, 25)

  const recentYear = Math.max(
    ...courses
      .filter((course) => !course.is_average && course.has_eval && course.year)
      .map((course) => course.year),
    0,
  )
  const fallbackMatches = courses
    .filter((course) => !course.is_average && course.year === recentYear)
    .sort((left, right) => rankCourse(right) - rankCourse(left))
    .slice(0, 25)
    .map((course) => ({ c: course }))

  const keywordMatches = (relevantMatches.length > 0 ? relevantMatches : fallbackMatches).map(
    ({ c }) => toCourseSummary(c),
  )

  const shortlistedCourses = courses
    .filter((course) => shortlistedSet.has(course.course_code_base || course.course_code))
    .sort((a, b) => rankCourse(b) - rankCourse(a) || (b.year || 0) - (a.year || 0))
    .map((course) => toCourseSummary(course))

  return dedupeCourseSummaries(
    focusedInstructorMatches.length > 0
      ? keywordMatches
      : [...keywordMatches, ...shortlistedCourses],
    30,
  )
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
  const toggleRef = useRef(null)
  const welcomeShownRef = useRef(false)

  const isHidden = HIDDEN_ROUTES.some((route) => location.pathname.startsWith(route))

  useEffect(() => {
    if (isHidden || !open) return
    if (!welcomeShownRef.current) {
      welcomeShownRef.current = true
      setMessages([{ role: 'assistant', content: config.chatWelcome }])
      capture('chatbot_opened')
    }
    const timer = setTimeout(() => inputRef.current?.focus(), 120)
    return () => clearTimeout(timer)
  }, [open, isHidden])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const closeAdvisor = useCallback(() => {
    setOpen(false)
    // The panel is rendered next to its persistent trigger. Restore focus
    // after React removes the dialog so keyboard users never fall back to the
    // document body or lose their place in the page.
    requestAnimationFrame(() => toggleRef.current?.focus())
  }, [])

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeAdvisor()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [closeAdvisor, open])

  const send = async () => {
    if (!input.trim() || loading) return
    const userMsg = input.trim()
    setInput('')
    capture('chatbot_message_sent', {
      message_length: userMsg.length,
      turn: messages.filter((m) => m.role === 'user').length + 1,
    })
    const next = [...messages, { role: 'user', content: userMsg }]
    setMessages(next)
    setLoading(true)

    try {
      const shortlistedCodes = Array.from(favs?.favorites || [])
      const shortlistedNames = shortlistedCodes
        .map(
          (code) =>
            courses.find((course) => (course.course_code_base || course.course_code) === code)
              ?.course_name,
        )
        .filter(Boolean)

      const history = next
        .slice(0, -1)
        .filter((message) => message.role === 'user' || message.kind === 'ai')
        .slice(-4)
        .map((message) => ({ role: message.role, content: message.content }))
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          history,
          courses: condenseCourses(courses, userMsg, shortlistedCodes),
          context: { shortlisted: shortlistedNames },
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            kind: 'error',
            content: data.error || 'The free AI course advisor is temporarily unavailable.',
          },
        ])
        return
      }

      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        throw new Error('Unexpected AI response type')
      }
      const data = await res.json().catch(() => ({}))
      if (
        data.source !== 'openrouter' ||
        !data.reply ||
        data.cost !== 0 ||
        typeof data.model !== 'string' ||
        !data.model.endsWith(':free')
      ) {
        throw new Error('Unverified AI response')
      }
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          kind: 'ai',
          content: data.reply,
          provenance: { model: data.model, cost: data.cost },
        },
      ])
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          kind: 'error',
          content: 'The free AI response could not be verified. Please try again.',
        },
      ])
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
        ref={toggleRef}
        onClick={() => (open ? closeAdvisor() : setOpen(true))}
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
          <div
            style={{
              padding: '14px 18px 12px',
              borderBottom: '1px solid var(--line)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span style={{ fontSize: 16, color: 'var(--accent)' }}>✦</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Course Advisor</p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{config.chatFootnote}</p>
            </div>
            <button
              onClick={closeAdvisor}
              aria-label="Close Course Advisor"
              title="Close"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                fontSize: 18,
                padding: '0 2px',
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>

          {/* Disclaimer */}
          <div
            style={{
              padding: '7px 14px',
              borderBottom: '1px solid var(--line)',
              background: 'rgba(165,28,48,0.04)',
            }}
          >
            <p style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              ⚠️ Answers come from a free OpenRouter LLM grounded in selected course-database
              records. If the model is unavailable, no automatic recommendation is substituted. Use
              responses as orientation, not as an official source.
            </p>
          </div>

          {/* Messages */}
          <div
            aria-live="polite"
            aria-atomic="false"
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '14px 14px 8px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <div
                  style={{
                    maxWidth: '86%',
                    padding: '10px 14px',
                    borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                    background:
                      msg.role === 'user'
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
                  {msg.kind === 'ai' && msg.provenance && (
                    <p
                      style={{
                        marginTop: 8,
                        paddingTop: 6,
                        borderTop: '1px solid var(--line)',
                        color: 'var(--text-muted)',
                        fontSize: 10,
                        lineHeight: 1.4,
                      }}
                    >
                      Free AI response · {msg.provenance.model} · verified cost $0.00
                    </p>
                  )}
                  {msg.kind === 'error' && (
                    <p
                      style={{
                        marginTop: 8,
                        color: 'var(--accent-strong)',
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      No AI answer was accepted
                    </p>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div
                  style={{
                    padding: '10px 16px',
                    borderRadius: '18px 18px 18px 4px',
                    background: 'var(--panel-subtle)',
                    border: '1px solid var(--line)',
                    fontSize: 13,
                    color: 'var(--text-muted)',
                  }}
                >
                  thinking…
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div
            style={{
              padding: '8px 12px calc(env(safe-area-inset-bottom, 0px) + 12px)',
              borderTop: '1px solid var(--line)',
              display: 'flex',
              gap: 8,
            }}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
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

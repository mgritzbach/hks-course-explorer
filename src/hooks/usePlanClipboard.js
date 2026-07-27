import { useEffect, useRef, useState } from 'react'
import { getExplicitCourseCredits } from '../lib/courseCredits.js'

function formatPlanText(activePlan, courses) {
  const totalCredits = courses.reduce(
    (sum, course) => sum + (getExplicitCourseCredits(course) ?? 0),
    0,
  )
  return [
    `${activePlan} — ${totalCredits} credits`,
    '',
    ...courses.map((course) => {
      const instructor = course.instructors?.length ? ` — ${course.instructors[0]}` : ''
      return `• ${course.courseCode}: ${course.title} (${getExplicitCourseCredits(course) ?? 0} cr)${instructor}`
    }),
  ].join('\n')
}

export function usePlanClipboard({ activePlan, courses, announce }) {
  const [message, setMessage] = useState(null)
  const messageTimeoutRef = useRef(null)

  useEffect(
    () => () => {
      if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current)
    },
    [],
  )

  const copy = () => {
    if (!courses.length) return
    navigator.clipboard
      .writeText(formatPlanText(activePlan, courses))
      .then(() => {
        if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current)
        setMessage('Copied!')
        announce('Plan copied to clipboard')
        messageTimeoutRef.current = setTimeout(() => setMessage(null), 2500)
      })
      .catch(() => {
        if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current)
        setMessage('Failed')
        messageTimeoutRef.current = setTimeout(() => setMessage(null), 2500)
      })
  }

  return { message, copy }
}

import { useCallback, useState } from 'react'

const KEY = 'hks_course_notes'

function loadNotes() {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function useNotes() {
  const [notes, setNotes] = useState(loadNotes)

  const getNote = useCallback((code) => notes[code] || '', [notes])

  const setNote = useCallback((code, text) => {
    setNotes((prev) => {
      const next = { ...prev }

      if (text.trim()) next[code] = text
      else delete next[code]

      try {
        window.localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        return next
      }
      return next
    })
  }, [])

  return { getNote, setNote, notes }
}

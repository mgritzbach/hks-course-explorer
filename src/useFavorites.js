import posthog from 'posthog-js'
import { useCallback, useEffect, useState } from 'react'

const KEY = 'hks_favorites'

function load() {
  if (typeof window !== 'undefined') {
    try {
      const favsParam = new URLSearchParams(window.location.search).get('favs')
      if (favsParam) {
        return new Set(
          favsParam
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
        )
      }
    } catch {
      // no-op — Ignore if URL parsing fails
    }
  }

  if (typeof window === 'undefined') return new Set()

  try { return new Set(JSON.parse(window.localStorage.getItem(KEY) || '[]')) }
  catch { return new Set() }
}

export function useFavorites() {
  const [favorites, setFavorites] = useState(load)

  // Sync to localStorage whenever it changes
  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify([...(favorites || [])]))
    } catch {
      return undefined
    }
    return undefined
  }, [favorites])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const url = new URL(window.location.href)
    if ((favorites?.size || 0) > 0) url.searchParams.set('favs', [...favorites].join(','))
    else url.searchParams.delete('favs')

    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    return undefined
  }, [favorites])

  const toggle = useCallback((courseCodeBase) => {
    setFavorites((prev) => {
      const adding = !prev.has(courseCodeBase)
      posthog.capture(adding ? 'course_shortlisted' : 'course_unshortlisted', {
        course_code: courseCodeBase,
        shortlist_size: prev.size + (adding ? 1 : -1),
      })
      const next = new Set(prev)
      adding ? next.add(courseCodeBase) : next.delete(courseCodeBase)
      return next
    })
  }, [])

  const isFavorite = useCallback((courseCodeBase) => favorites?.has(courseCodeBase) || false, [favorites])

  return { favorites, toggle, isFavorite, count: favorites?.size || 0 }
}

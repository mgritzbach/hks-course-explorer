import { useCallback, useEffect, useState } from 'react'

const KEY = 'hks_favorites'

function load() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')) }
  catch { return new Set() }
}

export function useFavorites() {
  const [favorites, setFavorites] = useState(load)

  // Sync to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify([...favorites]))
  }, [favorites])

  const toggle = useCallback((courseCodeBase) => {
    setFavorites((prev) => {
      const next = new Set(prev)
      next.has(courseCodeBase) ? next.delete(courseCodeBase) : next.add(courseCodeBase)
      return next
    })
  }, [])

  const isFavorite = useCallback((courseCodeBase) => favorites.has(courseCodeBase), [favorites])

  return { favorites, toggle, isFavorite, count: favorites.size }
}

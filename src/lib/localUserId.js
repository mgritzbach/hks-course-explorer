import { v4 as uuidv4 } from 'uuid'

const STORAGE_KEY = 'hks_uid'

export function getLocalUserId() {
  if (typeof window === 'undefined') return null

  const existing = window.localStorage.getItem(STORAGE_KEY)
  if (existing) return existing

  const nextId = uuidv4()
  window.localStorage.setItem(STORAGE_KEY, nextId)
  return nextId
}

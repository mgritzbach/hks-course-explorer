import { getLocalUserId } from './localUserId.js'
import { supabase } from './supabase.js'

export const PLANS = ['Plan A', 'Plan B', 'Plan C', 'Plan D']
export const DEFAULT_PLAN = 'Plan A'
const COMPLETED_KEY = 'hks_completed_courses'

export function loadCompleted() {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(COMPLETED_KEY)
    return Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : []
  } catch { return [] }
}

export function saveCompleted(courses) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(COMPLETED_KEY, JSON.stringify(Array.isArray(courses) ? courses : []))
}

function storageKey(planName) {
  return `hks_plan_${planName}`
}

function normalizePlan(planName, value) {
  if (Array.isArray(value)) {
    return {
      name: planName,
      courses: value,
      updatedAt: null,
    }
  }

  if (value && typeof value === 'object') {
    return {
      name: value.name || planName,
      courses: Array.isArray(value.courses) ? value.courses : [],
      updatedAt: value.updatedAt || null,
    }
  }

  return emptyPlan(planName)
}

export function emptyPlan(planName = DEFAULT_PLAN) {
  return {
    name: planName,
    courses: [],
    updatedAt: null,
  }
}

export function loadPlan(planName = DEFAULT_PLAN) {
  if (typeof window === 'undefined') return emptyPlan(planName)

  const raw = window.localStorage.getItem(storageKey(planName))
  if (!raw) return emptyPlan(planName)

  try {
    return normalizePlan(planName, JSON.parse(raw))
  } catch {
    return emptyPlan(planName)
  }
}

export async function savePlan(planName = DEFAULT_PLAN, planValue = emptyPlan(planName)) {
  const nextPlan = normalizePlan(planName, planValue)
  const stampedPlan = {
    ...nextPlan,
    updatedAt: new Date().toISOString(),
  }

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(storageKey(planName), JSON.stringify(stampedPlan))
    window.dispatchEvent(new CustomEvent('hks-plan-updated', { detail: { planName: stampedPlan.name } }))
  }

  const userId = getLocalUserId()
  if (!userId) return stampedPlan

  try {
    await supabase.from('schedules').upsert({
      user_id: userId,
      plan_name: stampedPlan.name,
      plan_data: stampedPlan,
      updated_at: stampedPlan.updatedAt,
    }, { onConflict: 'user_id,plan_name' })
  } catch {
    // Local storage remains the source of truth when sync is unavailable.
  }

  return stampedPlan
}

import { TOUR_NAMES } from './tourIds.js'

const LEGACY_ONBOARDING_KEYS = [
  'hks-tour-home',
  'hks-tour-courses',
  'hks-tour-course-detail',
  'hks-tour-faculty',
  'hks-tour-faculty-detail',
  'hks-tour-compare',
]

const OVERLAY_TOUR_KEYS = Object.values(TOUR_NAMES).map((tourName) => `hks-tour-seen-${tourName}`)

/** Marks every optional product tutorial as completed without changing user data. */
export function skipAllTutorials(storage = window.localStorage) {
  for (const key of [...LEGACY_ONBOARDING_KEYS, ...OVERLAY_TOUR_KEYS]) {
    storage.setItem(key, '1')
  }
}

export const ALL_TUTORIAL_STORAGE_KEYS = [...LEGACY_ONBOARDING_KEYS, ...OVERLAY_TOUR_KEYS]

import { afterEach, describe, expect, it } from 'vitest'
import { ALL_TUTORIAL_STORAGE_KEYS, skipAllTutorials } from '../lib/tutorialPreferences.js'

describe('skipAllTutorials', () => {
  afterEach(() => window.localStorage.clear())

  it('marks every current tutorial as completed without removing user data', () => {
    window.localStorage.setItem('hks-favorites', 'keep')

    skipAllTutorials()

    expect(ALL_TUTORIAL_STORAGE_KEYS).not.toHaveLength(0)
    expect(ALL_TUTORIAL_STORAGE_KEYS.every((key) => window.localStorage.getItem(key) === '1')).toBe(
      true,
    )
    expect(window.localStorage.getItem('hks-favorites')).toBe('keep')
  })
})

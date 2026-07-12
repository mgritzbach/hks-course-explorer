import { describe, expect, it } from 'vitest'
import { normalizeOptionalBoolean, toCourseSummary } from '../components/ChatBot.jsx'

describe('chat course context', () => {
  it.each([
    [true, true],
    [false, false],
    [1, true],
    [0, false],
    ['true', true],
    ['false', false],
    [null, undefined],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeOptionalBoolean(input)).toBe(expected)
  })

  it('never sends a non-boolean is_core value to the chat Worker', () => {
    const summary = toCourseSummary({ course_code: 'IGA-550', is_core: null })
    expect(summary.is_core).toBeUndefined()
    expect(JSON.parse(JSON.stringify(summary))).not.toHaveProperty('is_core')
  })
})

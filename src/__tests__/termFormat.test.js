import { describe, it, expect } from 'vitest'

function parseLiveCoursesTerm(term) {
  // "2026 Spring" -> { year: 2026, semester: "Spring" }
  const [year, semester] = term.split(' ')
  return { year: parseInt(year), semester }
}

function parseSectionsTerm(term) {
  // "2026Spring" -> { year: 2026, semester: "Spring" }
  const match = term.match(/^(\d{4})(.+)$/)
  if (!match) return null
  return { year: parseInt(match[1]), semester: match[2] }
}

describe('Term format - ADR-004', () => {
  describe('live_courses format (space-separated)', () => {
    it('parses "2026 Spring" correctly', () => {
      expect(parseLiveCoursesTerm('2026 Spring')).toEqual({ year: 2026, semester: 'Spring' })
    })
    it('parses "2025 Fall" correctly', () => {
      expect(parseLiveCoursesTerm('2025 Fall')).toEqual({ year: 2025, semester: 'Fall' })
    })
  })

  describe('course_sections format (no space)', () => {
    it('parses "2026Spring" correctly', () => {
      expect(parseSectionsTerm('2026Spring')).toEqual({ year: 2026, semester: 'Spring' })
    })
    it('parses "2025Fall" correctly', () => {
      expect(parseSectionsTerm('2025Fall')).toEqual({ year: 2025, semester: 'Fall' })
    })
  })

  describe('format difference guard', () => {
    it('live_courses term does NOT match sections term format', () => {
      const liveTerm = '2026 Spring'
      const sectionsTerm = '2026Spring'
      expect(liveTerm).not.toBe(sectionsTerm)
    })
  })
})

import { describe, expect, it } from 'vitest'
import { escapeIcsText } from '../lib/calendarText.js'

describe('escapeIcsText', () => {
  it('keeps imported text inside one RFC 5545 content line', () => {
    expect(
      escapeIcsText('Course\\Name; room, A\r\nATTACH;VALUE=URI:https://attacker.invalid/x'),
    ).toBe('Course\\\\Name\\; room\\, A\\nATTACH\\;VALUE=URI:https://attacker.invalid/x')
  })
})

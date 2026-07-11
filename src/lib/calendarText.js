// RFC 5545 text values must escape their own syntax characters. In
// particular, CR/LF may never reach a content line from an imported plan,
// otherwise it can create a separate iCalendar property in the export.
export function escapeIcsText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
}

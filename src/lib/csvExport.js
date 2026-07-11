// Keep exported shortlist cells inert when a spreadsheet application opens the
// CSV. Course and note data can originate outside the browser, so a leading
// formula marker must never be interpreted as a spreadsheet formula.
export function csvCell(value) {
  const text = String(value ?? '')
    .replace(/,/g, ';')
    .replace(/[\r\n]+/g, ' ')

  return /^[\t ]*[=+\-@]/.test(text) ? `'${text}` : text
}

const SEASON_BY_MONTH = [
  'January',
  'Spring',
  'Spring',
  'Spring',
  'Spring',
  'Summer',
  'Summer',
  'Summer',
  'Fall',
  'Fall',
  'Fall',
  'Fall',
]

/** Return the visitor-facing freshness label for the homepage summary. */
export function currentAcademicSeasonLabel(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(date.getTime())) return 'Current cycle'
  return `${SEASON_BY_MONTH[date.getMonth()]} ${date.getFullYear()}`
}

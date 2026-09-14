const TERM_ORDER = { January: 0, Spring: 1, Summer: 2, Fall: 3 }

// Oldest to newest, with calendar terms ordered within each year.
export function compareCourseChronology(a, b) {
  return (a.year || 0) - (b.year || 0) || (TERM_ORDER[a.term] ?? 4) - (TERM_ORDER[b.term] ?? 4)
}

const TERM_ORDER = { January: 0, Spring: 1, Summer: 2, Fall: 3 }

// Oldest to newest, with undated aggregate rows after the dated history.
export function compareCourseChronology(a, b) {
  return (
    (a.year || Infinity) - (b.year || Infinity) ||
    (TERM_ORDER[a.term] ?? 4) - (TERM_ORDER[b.term] ?? 4)
  )
}

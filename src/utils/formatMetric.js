/**
 * Shared metric formatting utilities.
 *
 * The app has two display modes:
 *   'score'       — raw÷5×100, a true percentage   → shows "{n}%"
 *   'percentile'  — rank vs all HKS courses         → shows "{n} pct"
 *
 * Using different suffixes makes it immediately clear which you're reading.
 */

/**
 * Format a 0–100 metric value with a clear mode-aware suffix.
 * Optionally appends the raw 0–5 value in parentheses.
 *
 * @param {number|null} value  - The score (0–100) or percentile (0–100)
 * @param {'score'|'percentile'} mode
 * @param {number|null} raw    - Optional raw 0–5 Likert average
 * @returns {string|null}
 */
export function formatMetric(value, mode, raw = null) {
  if (value == null) return null
  const n = Math.round(value)
  const rawStr = raw != null ? ` (${raw.toFixed(2)}/5)` : ''
  return mode === 'percentile' ? `${n} pct${rawStr}` : `${n}%${rawStr}`
}

/**
 * Compact one-liner for badges and small cells (no raw suffix).
 *
 * @param {number|null} value
 * @param {'score'|'percentile'} mode
 * @returns {string}
 */
export function fmtShort(value, mode) {
  if (value == null) return '—'
  const n = Math.round(value)
  return mode === 'percentile' ? `${n} pct` : `${n}%`
}

/**
 * Human-readable sub-label for a mode, e.g. under a big headline number.
 *
 * @param {'score'|'percentile'} mode
 * @returns {string}
 */
export function modeSubLabel(mode) {
  return mode === 'percentile' ? 'global percentile avg' : 'score avg (÷5 × 100)'
}

/**
 * Column header unit suffix, e.g. for table headers.
 * Returns 'pct' or '%' to append after a metric name.
 *
 * @param {'score'|'percentile'} mode
 * @returns {string}
 */
export function modeUnit(mode) {
  return mode === 'percentile' ? 'pct' : '%'
}

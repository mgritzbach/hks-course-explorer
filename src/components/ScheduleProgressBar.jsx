/** Shared, accessible progress indicator for the schedule's requirement summaries. */
export default function ScheduleProgressBar({ value, tone = 'var(--accent)', label }) {
  const pct = Math.max(0, Math.min(100, value || 0))
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label || `${pct}%`}
      className="h-2 overflow-hidden rounded-full"
      style={{ background: 'var(--track-bg)', border: '1px solid var(--line-strong)' }}
    >
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, background: tone }}
      />
    </div>
  )
}

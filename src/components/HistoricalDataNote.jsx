export default function HistoricalDataNote({ course }) {
  const evaluation = course?.evaluation_source
  const bidding = course?.bidding_source
  if (!evaluation && !bidding) return null
  return (
    <div className="my-2 text-xs leading-5" style={{ color: 'var(--text-soft)' }}>
      {evaluation && (
        <p>
          <strong>
            Historical evaluations: {evaluation.term} {evaluation.year}.
          </strong>{' '}
          Evaluated instructor: {evaluation.professor}. From a previous offering.
        </p>
      )}
      {bidding && (
        <p>
          <strong>Historical bidding: {bidding.label}.</strong> From a previous offering.
        </p>
      )}
    </div>
  )
}

export default function SkeletonCard() {
  return (
    <div className="surface-card rounded-[22px] p-5">
      <div className="skeleton-shimmer mb-3 h-6" style={{ width: '70%' }} />
      <div className="skeleton-shimmer mb-5 h-4" style={{ width: '40%' }} />

      <div className="space-y-3">
        <div className="skeleton-shimmer h-3" style={{ width: '100%' }} />
        <div className="skeleton-shimmer h-3" style={{ width: '82%' }} />
        <div className="skeleton-shimmer h-3" style={{ width: '64%' }} />
      </div>

      <div className="mt-6 flex gap-3">
        <div className="skeleton-shimmer h-10 flex-1" />
        <div className="skeleton-shimmer h-10" style={{ width: 120 }} />
      </div>
    </div>
  )
}

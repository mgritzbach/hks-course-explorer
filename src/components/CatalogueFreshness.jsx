import { useEffect, useState } from 'react'
import { snapshotStatus } from '../lib/catalogueSnapshot.js'

export default function CatalogueFreshness() {
  const [status, setStatus] = useState(snapshotStatus)
  useEffect(() => {
    const update = () => setStatus(snapshotStatus())
    window.addEventListener('catalogue-snapshot-status', update)
    return () => window.removeEventListener('catalogue-snapshot-status', update)
  }, [])
  const affected = status.filter((item) => item.stale || item.fallback)
  if (!affected.length) return null
  const oldest = Math.min(...affected.map((item) => Date.parse(item.exportedAt)))
  return (
    <aside
      role="status"
      className="border-b px-4 py-2 text-sm"
      style={{ background: 'var(--panel)', color: 'var(--text)', borderColor: 'var(--line)' }}
    >
      Showing the last available catalogue from {new Date(oldest).toLocaleDateString()}. Check
      course meeting times before finalizing your schedule.
    </aside>
  )
}

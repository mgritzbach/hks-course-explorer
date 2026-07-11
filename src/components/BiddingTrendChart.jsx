import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'

function BiddingTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload

  return (
    <div
      className="rounded-lg px-3 py-2 text-xs shadow-xl"
      style={{ background: 'var(--panel-strong)', border: '1px solid var(--line)' }}
    >
      <p className="mb-1 font-semibold text-label">{point.label}</p>
      {point.price != null && (
        <p style={{ color: 'var(--accent-strong)' }}>
          Clearing price: <span className="font-bold">{point.price} pts</span>
        </p>
      )}
      {point.bids != null && (
        <p className="text-muted">
          Bids: {point.bids}
          {point.cap != null ? ` / ${point.cap} seats` : ''}
        </p>
      )}
      {point.over != null && point.over > 0 && (
        <p style={{ color: 'var(--warning)' }}>+{point.over} oversubscribed</p>
      )}
    </div>
  )
}

/** Lazy-only chart for the Course Explorer bidding-history tab. */
export default function BiddingTrendChart({ trendData }) {
  const tickColor =
    document.documentElement.getAttribute('data-theme') === 'light'
      ? 'rgba(0,0,0,0.45)'
      : 'rgba(243,233,226,0.5)'

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={trendData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
        <XAxis
          dataKey="label"
          tick={{ fill: tickColor, fontSize: 10 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fill: tickColor, fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          domain={['auto', 'auto']}
          tickFormatter={(value) => `${value}`}
          width={36}
        />
        <RechartsTooltip
          content={<BiddingTooltip />}
          cursor={{ stroke: 'var(--accent-strong)', strokeWidth: 1, strokeDasharray: '3 3' }}
        />
        <Line
          type="monotone"
          dataKey="price"
          stroke="var(--accent-strong)"
          strokeWidth={2}
          dot={{ r: 4, fill: 'var(--accent-strong)', strokeWidth: 0 }}
          activeDot={{ r: 6 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

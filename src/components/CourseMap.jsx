import simCoords from '../data/sim_coords.json'

const COLORS = {
  API: '#4285f4', DPI: '#34a853', HKS: '#a51c30', MPA: '#fbbc04',
  MPP: '#ea4335', SUP: '#9c27b0', PAL: '#00bcd4', HBS: '#ff5722',
}

const VARIANTS = [
  { key: 'combined', label: 'Ratings + Subject', xKey: 'sim_x',         yKey: 'sim_y',         desc: 'Eval metrics (2.5×) + course subject similarity' },
  { key: 'ratings',  label: 'Ratings only',      xKey: 'sim_x_ratings', yKey: 'sim_y_ratings', desc: 'Proximity by evaluation scores only — ignores topic' },
  { key: 'text',     label: 'Subject only',       xKey: 'sim_x_text',   yKey: 'sim_y_text',    desc: 'Proximity by course names & descriptions — ignores ratings' },
]

const ALL_CONCS = ['All', ...new Set(simCoords.map(c => c.concentration).filter(Boolean))].sort()
const DEFAULT = { variant: 'combined', conc: 'All', stem: false }

// Lazy-load Plotly to keep the initial bundle small
import { useEffect, useState } from 'react'

export default function CourseMap() {
  const [Plot, setPlot] = useState(null)
  const [applied, setApplied] = useState(DEFAULT)
  const [pending, setPending] = useState(DEFAULT)

  // Load Plotly once on mount
  useEffect(() => {
    import('react-plotly.js').then(m => setPlot(() => m.default))
  }, [])

  const isDirty = pending.variant !== applied.variant || pending.conc !== applied.conc || pending.stem !== applied.stem

  // Derive plot data directly — no useMemo, ~1ms for 4130 pts
  const v = VARIANTS.find(x => x.key === applied.variant) || VARIANTS[0]
  const shown = simCoords.filter(c =>
    (applied.conc === 'All' || c.concentration === applied.conc) &&
    (!applied.stem || c.is_stem)
  )

  const groups = {}
  for (const c of shown) {
    const k = c.concentration || 'Other'
    if (!groups[k]) groups[k] = { x: [], y: [], data: [] }
    groups[k].x.push(c[v.xKey])
    groups[k].y.push(c[v.yKey])
    groups[k].data.push(c)
  }

  const traces = Object.entries(groups).map(([conc, g]) => ({
    type: 'scattergl',
    mode: 'markers',
    name: conc,
    x: g.x,
    y: g.y,
    customdata: g.data,
    hovertemplate: '<b>%{customdata.course_code}</b><br>%{customdata.course_name}<br>%{customdata.professor_display}<extra></extra>',
    marker: { size: 8, color: COLORS[conc] || '#888', opacity: 0.8, line: { color: 'rgba(255,255,255,0.18)', width: 0.5 } },
  }))

  const plotLayout = {
    autosize: true,
    uirevision: `${applied.variant}-${applied.conc}-${applied.stem}`,
    margin: { t: 8, r: 12, b: 32, l: 12 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    dragmode: 'pan', hovermode: 'closest', showlegend: true,
    legend: { title: { text: 'Concentration', font: { color: 'var(--text-muted)', size: 10 } }, font: { color: 'var(--text-muted)', size: 10 }, bgcolor: 'rgba(0,0,0,0)', orientation: 'v', x: 1, xanchor: 'right', y: 1 },
    xaxis: { showgrid: false, zeroline: false, showticklabels: false, showline: false },
    yaxis: { showgrid: false, zeroline: false, showticklabels: false, showline: false },
  }

  return (
    <div className="surface-card shrink-0 rounded-[24px] overflow-hidden">

      {/* Controls */}
      <div className="border-b px-4 py-3 flex flex-wrap items-start gap-4" style={{ borderColor: 'var(--line)' }}>
        <p className="text-[10px] uppercase tracking-wider text-muted self-center shrink-0">Similarity Map</p>

        <div className="flex flex-col gap-1">
          <p className="text-[9px] uppercase tracking-wider text-muted">Feature set</p>
          <div className="flex gap-2">
            {VARIANTS.map(x => (
              <button key={x.key} onClick={() => setPending(p => ({ ...p, variant: x.key }))}
                className="rounded-full px-3 py-1 text-[11px] font-medium transition-all"
                style={pending.variant === x.key
                  ? { background: 'var(--accent)', color: '#fff8f5', border: '1px solid transparent' }
                  : { border: '1px solid var(--line)', background: 'var(--panel-subtle)', color: 'var(--text-muted)' }}>
                {x.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <p className="text-[9px] uppercase tracking-wider text-muted">Concentration</p>
          <div className="select-wrap">
            <select value={pending.conc} onChange={e => setPending(p => ({ ...p, conc: e.target.value }))} style={{ fontSize: 11, padding: '3px 24px 3px 6px' }}>
              {ALL_CONCS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-label self-end pb-0.5">
          <input type="checkbox" checked={pending.stem} onChange={e => setPending(p => ({ ...p, stem: e.target.checked }))} className="h-3 w-3" style={{ accentColor: 'var(--accent)' }} />
          STEM only
        </label>

        <button onClick={() => setApplied({ ...pending })}
          className="ml-auto self-end rounded-full px-4 py-1.5 text-xs font-semibold transition-all"
          style={isDirty
            ? { background: 'var(--accent)', color: '#fff8f5', border: '1px solid transparent', boxShadow: '0 0 0 2px rgba(165,28,48,0.25)' }
            : { border: '1px solid var(--line)', background: 'var(--panel-subtle)', color: 'var(--text-muted)' }}>
          {isDirty ? '⟳ Generate Map' : '✓ Up to date'}
        </button>
      </div>

      {/* Hint */}
      <div className="px-4 pt-2 pb-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
        <span className="font-medium" style={{ color: 'var(--text-soft)' }}>{v.label}:</span> {v.desc}
        <span className="ml-3 opacity-60">{shown.length} courses</span>
      </div>

      {/* Plot */}
      <div style={{ height: 360 }}>
        {Plot ? (
          <Plot data={traces} layout={plotLayout}
            config={{ responsive: true, displaylogo: false, scrollZoom: true, doubleClick: 'reset', modeBarButtonsToRemove: ['select2d', 'lasso2d', 'toggleSpikelines', 'hoverClosestCartesian', 'hoverCompareCartesian'] }}
            useResizeHandler style={{ width: '100%', height: '360px' }} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-muted">Loading map…</p>
          </div>
        )}
      </div>

      <div className="border-t px-4 py-2 text-[10px] text-muted" style={{ borderColor: 'var(--line)' }}>
        Courses closer together share similar characteristics · drag to pan, scroll to zoom, double-click to reset
      </div>
    </div>
  )
}

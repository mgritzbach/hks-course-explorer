import { useEffect, useMemo, useRef, useState } from 'react'
import Plot from 'react-plotly.js'

const CONCENTRATION_COLORS = {
  API: '#4285f4',
  DPI: '#34a853',
  HKS: '#a51c30',
  MPA: '#fbbc04',
  MPP: '#ea4335',
  SUP: '#9c27b0',
  PAL: '#00bcd4',
  HBS: '#ff5722',
}

const VARIANTS = [
  { key: 'combined', label: 'Ratings + Subject', xKey: 'sim_x',         yKey: 'sim_y',         desc: 'Eval metrics (2.5×) combined with course name & description similarity' },
  { key: 'ratings',  label: 'Ratings only',      xKey: 'sim_x_ratings', yKey: 'sim_y_ratings', desc: 'Proximity based purely on evaluation scores — ignores topic/subject' },
  { key: 'text',     label: 'Subject only',       xKey: 'sim_x_text',   yKey: 'sim_y_text',    desc: 'Proximity based on course names & descriptions — ignores ratings' },
]

export default function CourseMap() {
  const [simData, setSimData] = useState(null)
  const [loadError, setLoadError] = useState(false)

  // "pending" = user is tweaking options; "applied" = what the plot actually shows
  const [pendingVariant, setPendingVariant] = useState('combined')
  const [pendingConc, setPendingConc] = useState('All')
  const [pendingStem, setPendingStem] = useState(false)

  const [appliedVariant, setAppliedVariant] = useState('combined')
  const [appliedConc, setAppliedConc] = useState('All')
  const [appliedStem, setAppliedStem] = useState(false)

  const isDirty =
    pendingVariant !== appliedVariant ||
    pendingConc !== appliedConc ||
    pendingStem !== appliedStem

  useEffect(() => {
    fetch('/sim_coords.json', { cache: 'no-cache' })
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then(data => { setSimData(data); setAppliedVariant('combined'); setAppliedConc('All'); setAppliedStem(false) })
      .catch(() => setLoadError(true))
  }, [])

  const concentrations = useMemo(() => {
    if (!simData) return ['All']
    return ['All', ...new Set(simData.map(c => c.concentration).filter(Boolean))].sort()
  }, [simData])

  const plotData = useMemo(() => {
    if (!simData) return []
    // Compute variant inside memo so the closure is always fresh
    const v = VARIANTS.find(v => v.key === appliedVariant) || VARIANTS[0]
    let list = simData
    if (appliedConc !== 'All') list = list.filter(c => c.concentration === appliedConc)
    if (appliedStem) list = list.filter(c => c.is_stem)

    const byConc = {}
    for (const c of list) {
      const key = c.concentration || 'Other'
      if (!byConc[key]) byConc[key] = []
      byConc[key].push(c)
    }

    return Object.entries(byConc).map(([conc, cs]) => ({
      type: 'scattergl',
      mode: 'markers',
      name: conc,
      x: cs.map(c => c[v.xKey]),
      y: cs.map(c => c[v.yKey]),
      customdata: cs,
      hovertemplate: '<b>%{customdata.course_code}</b><br>%{customdata.course_name}<br>%{customdata.professor_display}<extra></extra>',
      marker: {
        size: 8,
        color: CONCENTRATION_COLORS[conc] || '#888',
        opacity: 0.8,
        line: { color: 'rgba(255,255,255,0.18)', width: 0.5 },
      },
    }))
  }, [simData, appliedVariant, appliedConc, appliedStem])

  const variant = VARIANTS.find(v => v.key === appliedVariant) || VARIANTS[0]

  const totalShown = plotData.reduce((s, t) => s + t.x.length, 0)

  const plotLayout = {
    autosize: true,
    uirevision: `sim-${appliedVariant}-${appliedConc}-${appliedStem}`,
    margin: { t: 8, r: 12, b: 32, l: 12 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    dragmode: 'pan',
    hovermode: 'closest',
    showlegend: true,
    legend: {
      title: { text: 'Concentration', font: { color: 'var(--text-muted)', size: 10 } },
      font: { color: 'var(--text-muted)', size: 10 },
      bgcolor: 'rgba(0,0,0,0)',
      orientation: 'v',
      x: 1,
      xanchor: 'right',
      y: 1,
    },
    xaxis: { showgrid: false, zeroline: false, showticklabels: false, showline: false },
    yaxis: { showgrid: false, zeroline: false, showticklabels: false, showline: false },
  }

  if (loadError) return (
    <div className="surface-card rounded-[24px] px-8 py-12 text-center">
      <p className="mb-2 font-medium text-label">Similarity Map not available</p>
      <p className="text-xs text-muted">Run <code>python scripts/build_data.py</code> with scikit-learn installed.</p>
    </div>
  )

  return (
    <div className="surface-card shrink-0 rounded-[24px] overflow-hidden">

      {/* Controls bar */}
      <div className="border-b px-4 py-3 flex flex-wrap items-start gap-4" style={{ borderColor: 'var(--line)' }}>
        <p className="text-[10px] uppercase tracking-wider text-muted self-center shrink-0">Similarity Map</p>

        {/* Feature mode */}
        <div className="flex flex-col gap-1">
          <p className="text-[9px] uppercase tracking-wider text-muted">Feature set</p>
          <div className="flex gap-2">
            {VARIANTS.map(v => (
              <button
                key={v.key}
                onClick={() => setPendingVariant(v.key)}
                className="rounded-full px-3 py-1 text-[11px] font-medium transition-all"
                style={pendingVariant === v.key
                  ? { background: 'var(--accent)', color: '#fff8f5', border: '1px solid transparent' }
                  : { border: '1px solid var(--line)', background: 'var(--panel-subtle)', color: 'var(--text-muted)' }}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {/* Concentration */}
        <div className="flex flex-col gap-1">
          <p className="text-[9px] uppercase tracking-wider text-muted">Concentration</p>
          <div className="select-wrap">
            <select value={pendingConc} onChange={e => setPendingConc(e.target.value)} style={{ fontSize: 11, padding: '3px 24px 3px 6px' }}>
              {concentrations.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* STEM */}
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-label self-end pb-0.5">
          <input type="checkbox" checked={pendingStem} onChange={e => setPendingStem(e.target.checked)} className="h-3 w-3" style={{ accentColor: 'var(--accent)' }} />
          STEM only
        </label>

        {/* Generate Map button */}
        <button
          onClick={() => { setAppliedVariant(pendingVariant); setAppliedConc(pendingConc); setAppliedStem(pendingStem) }}
          className="ml-auto self-end rounded-full px-4 py-1.5 text-xs font-semibold transition-all"
          style={isDirty
            ? { background: 'var(--accent)', color: '#fff8f5', border: '1px solid transparent', boxShadow: '0 0 0 2px rgba(165,28,48,0.25)' }
            : { border: '1px solid var(--line)', background: 'var(--panel-subtle)', color: 'var(--text-muted)' }}
        >
          {isDirty ? '⟳ Generate Map' : '✓ Up to date'}
        </button>
      </div>

      {/* Variant description hint */}
      {VARIANTS.find(v => v.key === appliedVariant) && (
        <div className="px-4 pt-2 pb-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
          <span className="font-medium" style={{ color: 'var(--text-soft)' }}>{variant.label}:</span> {variant.desc}
          {!simData && <span className="ml-2 italic">Loading…</span>}
          {simData && <span className="ml-3 opacity-60">{totalShown} courses shown</span>}
        </div>
      )}

      {/* Plot */}
      <div style={{ height: 360 }}>
        {simData ? (
          <Plot
            data={plotData}
            layout={plotLayout}
            config={{
              responsive: true,
              displaylogo: false,
              scrollZoom: true,
              doubleClick: 'reset',
              modeBarButtonsToRemove: ['select2d', 'lasso2d', 'toggleSpikelines', 'hoverClosestCartesian', 'hoverCompareCartesian'],
            }}
            useResizeHandler
            style={{ width: '100%', height: '360px' }}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-muted">Loading similarity data…</p>
          </div>
        )}
      </div>

      <div className="border-t px-4 py-2 text-[10px] text-muted" style={{ borderColor: 'var(--line)' }}>
        Courses closer together share similar characteristics · drag to pan, scroll to zoom, double-click to reset
      </div>
    </div>
  )
}

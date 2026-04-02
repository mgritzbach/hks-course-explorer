import { useEffect, useMemo, useState } from 'react'
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

export default function CourseMap() {
  const [simData, setSimData] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [filterConc, setFilterConc] = useState('All')
  const [stemOnly, setStemOnly] = useState(false)

  // Self-fetch the slim coords file — independent of the courses prop/cache
  useEffect(() => {
    fetch('/sim_coords.json', { cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then(setSimData)
      .catch(() => setLoadError(true))
  }, [])

  const concentrations = useMemo(() => {
    if (!simData) return ['All']
    return ['All', ...new Set(simData.map(c => c.concentration).filter(Boolean))].sort()
  }, [simData])

  const filtered = useMemo(() => {
    if (!simData) return []
    let list = simData
    if (filterConc !== 'All') list = list.filter(c => c.concentration === filterConc)
    if (stemOnly) list = list.filter(c => c.is_stem)
    return list
  }, [simData, filterConc, stemOnly])

  if (loadError) {
    return (
      <div className="surface-card rounded-[24px] px-8 py-12 text-center">
        <p className="mb-2 font-medium text-label">Similarity Map not available</p>
        <p className="text-xs text-muted">Run <code>python scripts/build_data.py</code> with scikit-learn installed to generate similarity coordinates.</p>
      </div>
    )
  }

  if (!simData) {
    return (
      <div className="surface-card rounded-[24px] px-8 py-12 text-center">
        <p className="text-xs text-muted">Loading similarity map…</p>
      </div>
    )
  }

  // Group by concentration for separate traces (for color legend)
  const byConc = {}
  for (const c of filtered) {
    const key = c.concentration || 'Other'
    if (!byConc[key]) byConc[key] = []
    byConc[key].push(c)
  }

  const plotData = Object.entries(byConc).map(([conc, cs]) => ({
    type: 'scattergl',
    mode: 'markers',
    name: conc,
    x: cs.map(c => c.sim_x),
    y: cs.map(c => c.sim_y),
    customdata: cs,
    hovertemplate: '<b>%{customdata.course_code}</b><br>%{customdata.course_name}<br>%{customdata.professor_display}<extra></extra>',
    marker: {
      size: 9,
      color: CONCENTRATION_COLORS[conc] || '#888',
      opacity: 0.75,
      line: { color: 'rgba(255,255,255,0.15)', width: 0.5 },
    },
  }))

  const plotLayout = {
    autosize: true,
    uirevision: `sim-${filterConc}-${stemOnly}`,
    margin: { t: 8, r: 12, b: 12, l: 12 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    dragmode: 'pan',
    hovermode: 'closest',
    showlegend: true,
    legend: {
      font: { color: 'var(--text-muted)', size: 10 },
      bgcolor: 'rgba(0,0,0,0)',
      orientation: 'h',
      y: -0.08,
    },
    xaxis: { showgrid: false, zeroline: false, showticklabels: false, showline: false },
    yaxis: { showgrid: false, zeroline: false, showticklabels: false, showline: false },
  }

  return (
    <div className="surface-card shrink-0 rounded-[24px] overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--line)' }}>
        <p className="text-[10px] uppercase tracking-wider text-muted">Similarity Map</p>
        <div className="select-wrap">
          <select value={filterConc} onChange={e => setFilterConc(e.target.value)} style={{ fontSize: 11, padding: '3px 24px 3px 6px' }}>
            {concentrations.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-label">
          <input type="checkbox" checked={stemOnly} onChange={e => setStemOnly(e.target.checked)} className="h-3 w-3" style={{ accentColor: 'var(--accent)' }} />
          STEM only
        </label>
        <p className="ml-auto text-[10px] text-muted">{filtered.length} courses · PCA of ratings + descriptions</p>
      </div>
      <div style={{ height: 340 }}>
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
          style={{ width: '100%', height: '340px' }}
        />
      </div>
      <div className="border-t px-4 py-2 text-[10px] text-muted" style={{ borderColor: 'var(--line)' }}>
        Courses closer together share similar ratings and subject matter · colors = concentration
      </div>
    </div>
  )
}

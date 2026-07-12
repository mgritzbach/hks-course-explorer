const buttonStyle = {
  border: '1px solid var(--line)',
  background: 'var(--panel-subtle)',
  color: 'var(--text-muted)',
}

export default function ScatterControls({ isZoomed, onZoomOut, onZoomIn, onReset }) {
  return (
    <div aria-label="Graph controls" className="flex flex-wrap items-center gap-2 md:col-span-2">
      <button
        onClick={onZoomOut}
        aria-label="Zoom out"
        className="rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors hover:text-label"
        style={buttonStyle}
      >
        Zoom out
      </button>
      <button
        onClick={onZoomIn}
        aria-label="Zoom in"
        className="rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors hover:text-label"
        style={buttonStyle}
      >
        Zoom in
      </button>
      <button
        onClick={onReset}
        aria-label="Reset axes"
        className="rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors hover:text-label"
        style={buttonStyle}
      >
        Reset axes
      </button>
      {isZoomed && (
        <span className="text-[10px]" style={{ color: 'var(--blue)' }}>
          Zoomed in
        </span>
      )}
    </div>
  )
}

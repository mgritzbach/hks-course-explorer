/**
 * Schedule Builder's desktop plan-management header.
 *
 * The parent owns storage and action orchestration. This component only
 * renders the current plan controls and forwards user intent through explicit
 * callbacks, keeping the schedule grid page independent of header layout.
 */
export default function SchedulePlanHeader({
  plans,
  activePlan,
  onSwitchPlan,
  termOptions,
  term,
  onTermChange,
  showWeekends,
  onToggleWeekends,
  importInputRef,
  onLoadPlan,
  saveLoadMsg,
  onSavePlan,
  onRequestLoad,
  hasCourses,
  copyPlanMsg,
  onCopyPlan,
  exportMsg,
  onExport,
}) {
  return (
    <div
      className="flex items-center justify-between gap-6 border-b px-6 py-4"
      style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
    >
      <div className="flex items-end gap-4">
        <div>
          <p className="kicker">Advanced Planning</p>
          <h1
            className="serif-display mt-2 text-3xl font-semibold"
            style={{ color: 'var(--text)' }}
          >
            Schedule Builder
          </h1>
        </div>
        <div data-tour="plan-tabs" className="flex gap-2">
          {plans.map((planName) => {
            const active = planName === activePlan
            return (
              <button
                key={planName}
                type="button"
                onClick={() => onSwitchPlan(planName)}
                className="border-b-2 px-1 pb-2 pt-3 text-sm font-semibold transition-colors"
                style={{
                  borderColor: active ? 'var(--accent)' : 'transparent',
                  color: active ? 'var(--text)' : 'var(--text-muted)',
                }}
              >
                {planName}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div
          className="inline-flex rounded-full border p-1"
          style={{ background: 'var(--panel-soft)', borderColor: 'var(--line)' }}
        >
          {termOptions.map((option) => {
            const active = option === term
            return (
              <button
                key={option}
                type="button"
                onClick={() => onTermChange(option)}
                className="rounded-full px-4 py-2 text-sm font-semibold transition-colors"
                style={{
                  background: active ? 'var(--accent-soft)' : 'transparent',
                  color: active ? 'var(--text)' : 'var(--text-muted)',
                }}
              >
                {option === 'FULL' ? 'Full Term' : option}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          onClick={onToggleWeekends}
          title="Show Saturday and Sunday columns"
          className="rounded-full border px-3 py-2 text-sm font-semibold transition-colors"
          style={{
            background: showWeekends ? 'var(--panel-subtle)' : 'transparent',
            borderColor: showWeekends ? 'var(--line-strong)' : 'var(--line)',
            color: showWeekends ? 'var(--text)' : 'var(--text-muted)',
          }}
        >
          {showWeekends ? 'Hide Weekends' : '+ Weekends'}
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept=".json,application/json"
          onChange={onLoadPlan}
          className="hidden"
          aria-label="Load plan from JSON"
        />
        <button
          type="button"
          onClick={onSavePlan}
          title="Save all plans + completed courses to a JSON file"
          className="rounded-full border px-4 py-2 text-sm font-semibold transition-all hover:-translate-y-[1px]"
          style={{
            background: saveLoadMsg === 'Saved!' ? 'var(--success-soft)' : 'var(--panel-soft)',
            borderColor: saveLoadMsg === 'Saved!' ? 'var(--success)' : 'var(--line-strong)',
            color: saveLoadMsg === 'Saved!' ? 'var(--success)' : 'var(--text-soft)',
          }}
        >
          {saveLoadMsg === 'Saved!' ? '✓ Saved' : '💾 Save'}
        </button>
        <button
          type="button"
          onClick={onRequestLoad}
          title="Load a previously saved plan JSON file"
          className="rounded-full border px-4 py-2 text-sm font-semibold transition-all hover:-translate-y-[1px]"
          style={{
            background:
              saveLoadMsg === 'Loaded!'
                ? 'var(--success-soft)'
                : saveLoadMsg && saveLoadMsg !== 'Saved!'
                  ? 'var(--warning-soft)'
                  : 'var(--panel-soft)',
            borderColor:
              saveLoadMsg === 'Loaded!'
                ? 'var(--success)'
                : saveLoadMsg && saveLoadMsg !== 'Saved!'
                  ? 'var(--warning)'
                  : 'var(--line-strong)',
            color:
              saveLoadMsg === 'Loaded!'
                ? 'var(--success)'
                : saveLoadMsg && saveLoadMsg !== 'Saved!'
                  ? 'var(--warning)'
                  : 'var(--text-soft)',
          }}
        >
          {saveLoadMsg === 'Loaded!'
            ? '✓ Loaded'
            : saveLoadMsg && saveLoadMsg !== 'Saved!'
              ? `⚠ ${saveLoadMsg}`
              : '📂 Load'}
        </button>
        {hasCourses && (
          <button
            type="button"
            onClick={onCopyPlan}
            title="Copy plan as text for sharing with advisors"
            className="rounded-full border px-4 py-2 text-sm font-semibold transition-all hover:-translate-y-[1px]"
            style={{
              background:
                copyPlanMsg === 'Copied!' ? 'rgba(100,180,100,0.12)' : 'var(--panel-soft)',
              borderColor: copyPlanMsg === 'Copied!' ? 'var(--success)' : 'var(--line-strong)',
              color: copyPlanMsg === 'Copied!' ? 'var(--success)' : 'var(--text-soft)',
            }}
          >
            {copyPlanMsg === 'Copied!' ? '✓ Copied' : copyPlanMsg || '📋 Copy Plan'}
          </button>
        )}
        <button
          type="button"
          onClick={onExport}
          title={exportMsg?.text}
          className="rounded-full border px-4 py-2 text-sm font-semibold transition-all hover:-translate-y-[1px]"
          style={{
            background: exportMsg?.error
              ? 'var(--warning-soft)'
              : exportMsg
                ? 'var(--success-soft)'
                : 'var(--gold-soft)',
            borderColor: exportMsg?.error
              ? 'var(--warning)'
              : exportMsg
                ? 'var(--success)'
                : 'var(--gold)',
            color: exportMsg?.error
              ? 'var(--warning)'
              : exportMsg
                ? 'var(--success)'
                : 'var(--text)',
          }}
        >
          {exportMsg?.error
            ? '⚠ No grid courses'
            : exportMsg
              ? `✓ ${exportMsg.text}`
              : '📅 Export iCal'}
        </button>
      </div>
    </div>
  )
}

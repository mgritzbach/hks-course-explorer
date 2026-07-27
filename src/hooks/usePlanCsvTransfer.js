import { useEffect, useRef, useState } from 'react'
import { getBaseCourseKey } from '../lib/courseIdentity.js'
import { mergePlanCsvRecords, parsePlansCsv, serializePlansCsv } from '../lib/planCsv.js'
import { loadPlan, PLANS, savePlan } from '../lib/scheduleStorage.js'

function plansSnapshot(activePlan, planData) {
  return Object.fromEntries(
    PLANS.map((name) => [name, name === activePlan ? planData : loadPlan(name)]),
  )
}

export function usePlanCsvTransfer({ activePlan, planData, setPlanData, announce }) {
  const csvImportInputRef = useRef(null)
  const csvMessageTimeoutRef = useRef(null)
  const [csvMsg, setCsvMsg] = useState(null)

  useEffect(
    () => () => {
      if (csvMessageTimeoutRef.current) clearTimeout(csvMessageTimeoutRef.current)
    },
    [],
  )

  const showCsvMessage = (message) => {
    if (csvMessageTimeoutRef.current) clearTimeout(csvMessageTimeoutRef.current)
    setCsvMsg(message)
    csvMessageTimeoutRef.current = setTimeout(() => setCsvMsg(null), 3500)
  }

  const exportCsv = () => {
    try {
      const plansByName = plansSnapshot(activePlan, planData)
      const courseCount = PLANS.reduce(
        (total, name) => total + (plansByName[name]?.courses?.length || 0),
        0,
      )
      if (!courseCount) return showCsvMessage('No plan courses to export')

      const blob = new Blob([serializePlansCsv(plansByName)], {
        type: 'text/csv;charset=utf-8',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `hks-plans-${new Date().toISOString().slice(0, 10)}.csv`
      link.click()
      URL.revokeObjectURL(url)
      showCsvMessage(`Exported ${courseCount} course${courseCount === 1 ? '' : 's'}`)
    } catch {
      showCsvMessage('CSV export failed')
    }
  }

  const importCsv = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ''
    const reader = new FileReader()
    reader.onload = (loadEvent) => {
      try {
        const records = parsePlansCsv(loadEvent.target.result, activePlan)
        const mergedPlans = mergePlanCsvRecords(plansSnapshot(activePlan, planData), records)
        PLANS.forEach((name) => savePlan(name, mergedPlans[name]))
        setPlanData(mergedPlans[activePlan])
        const importedKeys = new Set(
          records.map(({ plan, course }) => `${plan}:${getBaseCourseKey(course)}`),
        )
        showCsvMessage(`Imported ${importedKeys.size} course${importedKeys.size === 1 ? '' : 's'}`)
        announce('CSV courses imported')
      } catch (error) {
        showCsvMessage(error instanceof Error ? error.message : 'Invalid CSV file')
      }
    }
    reader.onerror = () => showCsvMessage('Could not read CSV file')
    reader.readAsText(file)
  }

  return {
    csvImportInputRef,
    csvMsg,
    exportCsv,
    importCsv,
    requestCsvImport: () => csvImportInputRef.current?.click(),
  }
}

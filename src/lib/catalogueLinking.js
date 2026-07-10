/**
 * Course identity linking for the future unified catalogue.
 *
 * This module intentionally does not use title, instructor, or suffix-stripped
 * matching. A false historical rating is worse than an explicit "unmatched"
 * state. Renumberings are linked only through the reviewed alias registry.
 */
export function normaliseCourseCode(value) {
  if (typeof value !== 'string') return null

  const code = value
    .trim()
    .toUpperCase()
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, '-')

  return code || null
}

function codeFrom(record) {
  return normaliseCourseCode(record?.course_code_base || record?.course_code)
}

export function buildHistoricalCourseIndex(records, historicalCodeMap = {}) {
  const direct = new Map()
  const mapped = new Map()

  const aliases = new Map(
    Object.entries(historicalCodeMap)
      .map(([from, to]) => [normaliseCourseCode(from), normaliseCourseCode(to)])
      .filter(([from, to]) => from && to),
  )

  for (const record of records || []) {
    const historicalCode = codeFrom(record)
    if (!historicalCode) continue

    if (!direct.has(historicalCode)) direct.set(historicalCode, [])
    direct.get(historicalCode).push(record)

    const canonicalCode = aliases.get(historicalCode)
    if (!canonicalCode) continue
    if (!mapped.has(canonicalCode)) mapped.set(canonicalCode, [])
    mapped.get(canonicalCode).push(record)
  }

  return { direct, mapped }
}

export function linkOfferingToHistory(offering, historicalIndex) {
  const offeringCode = codeFrom(offering)
  if (!offeringCode) {
    return { matchStatus: 'unmatched', matchMethod: null, historicalCodes: [], records: [] }
  }

  const directRecords = historicalIndex?.direct?.get(offeringCode) || []
  if (directRecords.length) {
    return {
      matchStatus: 'verified',
      matchMethod: 'exact_code',
      historicalCodes: [offeringCode],
      records: directRecords,
    }
  }

  const aliasRecords = historicalIndex?.mapped?.get(offeringCode) || []
  if (aliasRecords.length) {
    return {
      matchStatus: 'verified',
      matchMethod: 'approved_alias',
      historicalCodes: [...new Set(aliasRecords.map(codeFrom).filter(Boolean))].sort(),
      records: aliasRecords,
    }
  }

  return { matchStatus: 'unmatched', matchMethod: null, historicalCodes: [], records: [] }
}

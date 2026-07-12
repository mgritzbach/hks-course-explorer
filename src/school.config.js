/**
 * school.config.js
 * ================
 * Single source of truth for all school-specific branding and metadata.
 *
 * FORKING THIS REPO?
 * Change the values in this file. Everything else in the frontend
 * reads from here — you should not need to touch individual components.
 *
 * See FORK.md for the complete guide.
 */

const schoolConfig = {
  // ── Identity ────────────────────────────────────────────────────────────────
  schoolCode: 'HKS', // Short code used in filters/labels
  schoolName: 'Harvard Kennedy School', // Full name
  universityName: 'Harvard University',
  appTitle: 'HKS Course Explorer', // Browser tab + header title
  appTagline:
    'Browse courses, compare evaluation data, and build your shortlist — all in one place.',

  // ── Data source ─────────────────────────────────────────────────────────────
  dataSource: 'HKS QReports', // Shown in footer / sidebar
  evalSystem: 'QReports', // Name of the evaluation system

  // ── Attribution (required — see FORK.md) ────────────────────────────────────
  creatorName: 'Michael Gritzbach',
  creatorUrl: 'https://www.linkedin.com/in/michael-gritzbach/',
  creatorDegrees: "VUS'18, MPA'26",

  // ── Chatbot ─────────────────────────────────────────────────────────────────
  chatWelcome:
    "Hi! I'm your HKS course advisor. Tell me what you're looking for — topic, workload, instructor, bidding pressure — and I'll find the best matches from the course catalog.",
  chatFootnote: 'HKS course data · free AI when available',

  // ── Tutorial copy ────────────────────────────────────────────────────────────
  tutorialSourceHint:
    'HKS courses are shown by default. Toggle the source filter to include cross-registration courses from other Harvard schools.',
}

/** @returns {never} */
function contractError(message) {
  throw new Error(`School configuration contract: ${message}`)
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function requireConfiguration(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    contractError('configuration must be an object')
  return /** @type {Record<string, unknown>} */ (value)
}

/**
 * Validate the required branding and copy fields for a forked deployment.
 * @param {unknown} config Candidate school configuration.
 * @returns {true} True when all required fields are safe for the frontend.
 * @throws {Error} When a required string is missing or the creator URL is unsafe.
 */
export function assertSchoolConfig(config = schoolConfig) {
  const candidate = requireConfiguration(config)
  const required = [
    'schoolCode',
    'schoolName',
    'universityName',
    'appTitle',
    'appTagline',
    'dataSource',
    'evalSystem',
    'creatorName',
    'creatorUrl',
    'creatorDegrees',
    'chatWelcome',
    'chatFootnote',
    'tutorialSourceHint',
  ]
  for (const key of required) {
    if (typeof candidate[key] !== 'string' || !candidate[key].trim())
      contractError(`${key} must be a non-empty string`)
  }
  let creatorUrl
  try {
    creatorUrl = new URL(/** @type {string} */ (candidate.creatorUrl))
  } catch {
    contractError('creatorUrl must be a valid HTTPS URL')
  }
  if (creatorUrl.protocol !== 'https:') contractError('creatorUrl must use HTTPS')
  return true
}

export default schoolConfig

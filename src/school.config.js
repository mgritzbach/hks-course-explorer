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
  schoolCode:    'HKS',                        // Short code used in filters/labels
  schoolName:    'Harvard Kennedy School',      // Full name
  universityName: 'Harvard University',
  appTitle:      'HKS Course Explorer',         // Browser tab + header title
  appTagline:    'Browse courses, compare evaluation data, and build your shortlist — all in one place.',

  // ── Data source ─────────────────────────────────────────────────────────────
  dataSource:    'HKS QReports',               // Shown in footer / sidebar
  evalSystem:    'QReports',                   // Name of the evaluation system

  // ── Attribution (required — see FORK.md) ────────────────────────────────────
  creatorName:   'Michael Gritzbach',
  creatorUrl:    'https://www.linkedin.com/in/michael-gritzbach/',
  creatorDegrees: "VUS'18, MPA'26",

  // ── Chatbot ─────────────────────────────────────────────────────────────────
  chatWelcome:   "Hi! I'm your HKS course advisor. Tell me what you're looking for — topic, workload, instructor, bidding pressure — and I'll find the best matches from the course catalog.",
  chatFootnote:  'AI · HKS course data · free',

  // ── Tutorial copy ────────────────────────────────────────────────────────────
  tutorialSourceHint: 'HKS courses are shown by default. Toggle the source filter to include cross-registration courses from other Harvard schools.',
}

export default schoolConfig

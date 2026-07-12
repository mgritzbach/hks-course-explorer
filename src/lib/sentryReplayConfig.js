// Course and schedule content can contain student-specific information. Keep
// session replay useful for diagnosing UI failures without recording that text
// or media by default.
export const SENTRY_REPLAY_OPTIONS = Object.freeze({
  maskAllText: true,
  blockAllMedia: true,
})

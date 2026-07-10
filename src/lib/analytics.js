/**
 * Non-critical product analytics must not delay the first course-search UI.
 * Events are queued until the explicitly configured PostHog client is ready;
 * when analytics is disabled, capture is a safe no-op.
 */
let clientPromise
let enabled = false
let initialized = false
const pendingEvents = []

function loadClient() {
  if (!clientPromise) {
    clientPromise = import('posthog-js').then(({ default: client }) => client)
  }
  return clientPromise
}

export function initializeAnalytics(key, options) {
  if (!key || initialized || enabled) return
  enabled = true
  void loadClient()
    .then((client) => {
      client.init(key, options)
      initialized = true
      for (const [event, properties] of pendingEvents.splice(0)) {
        client.capture(event, properties)
      }
    })
    .catch(() => {
      enabled = false
      pendingEvents.splice(0)
    })
}

export function capture(event, properties) {
  if (!enabled) return
  if (!initialized) {
    pendingEvents.push([event, properties])
    return
  }
  void loadClient()
    .then((client) => client.capture(event, properties))
    .catch(() => {})
}

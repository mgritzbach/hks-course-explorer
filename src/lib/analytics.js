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

function loadClientAfterFirstPaint() {
  const start = () => loadClient()

  if (typeof window === 'undefined') return start()

  return new Promise((resolve, reject) => {
    const beginWhenIdle = () => {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(() => start().then(resolve, reject), { timeout: 3000 })
      } else {
        window.setTimeout(() => start().then(resolve, reject), 0)
      }
    }

    // Give the entered application two paint opportunities before parsing a
    // non-critical third-party analytics client on the main thread.
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => window.requestAnimationFrame(beginWhenIdle))
    } else {
      beginWhenIdle()
    }
  })
}

export function initializeAnalytics(key, options) {
  if (!key || initialized || enabled) return
  enabled = true
  void loadClientAfterFirstPaint()
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

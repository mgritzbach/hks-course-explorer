/**
 * Non-critical product analytics must not delay the first course-search UI.
 * Events are queued until the explicitly configured PostHog client is ready;
 * when analytics is disabled, capture is a safe no-op.
 */
let clientPromise
let enabled = false
let initialized = false
const pendingEvents = []

const URL_LIKE_PROPERTY = /(?:^|[_$])(?:url|referrer)$/i

function removeQueryAndFragment(value) {
  if (typeof value !== 'string' || (!value.includes('?') && !value.includes('#'))) return value
  try {
    const parsed = new URL(value, 'https://analytics-sanitizer.invalid')
    return parsed.origin === 'https://analytics-sanitizer.invalid'
      ? parsed.pathname
      : `${parsed.origin}${parsed.pathname}`
  } catch {
    return value.split(/[?#]/, 1)[0]
  }
}

/**
 * Final PostHog boundary for URL privacy. The SDK enriches events after
 * `capture()`, so query/hash removal must run in `before_send`, not only when
 * individual custom-event properties are assembled.
 */
export function sanitizePostHogEvent(event) {
  if (!event || typeof event !== 'object' || !event.properties) return event
  const properties = { ...event.properties }
  for (const [key, value] of Object.entries(properties)) {
    if (URL_LIKE_PROPERTY.test(key)) properties[key] = removeQueryAndFragment(value)
  }
  return { ...event, properties }
}

function withPrivacyBoundary(options = {}) {
  const callerBeforeSend = options.before_send
  return {
    ...options,
    before_send: (event) =>
      sanitizePostHogEvent(
        typeof callerBeforeSend === 'function' ? callerBeforeSend(event) : event,
      ),
  }
}

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
      client.init(key, withPrivacyBoundary(options))
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

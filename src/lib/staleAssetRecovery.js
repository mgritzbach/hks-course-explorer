const PRELOAD_RELOAD_KEY = 'hks-preload-reload-at'
const RELOAD_COOLDOWN_MS = 60_000

/**
 * Recover an already-open browser tab after a new Vite deployment replaces a
 * lazy-loaded chunk. Vite emits `vite:preloadError` before the route error is
 * thrown; one reload picks up the current no-cache HTML and its new asset map.
 *
 * The cooldown prevents a reload loop when the network itself is unavailable.
 * Dependencies are injectable so the behavior can be verified without
 * mutating the real browser location during tests.
 */
export function installStaleAssetRecovery({
  eventTarget = window,
  storage = window.sessionStorage,
  reload = () => window.location.reload(),
  now = () => Date.now(),
} = {}) {
  const handlePreloadError = (event) => {
    const currentTime = now()
    let storedValue
    try {
      storedValue = storage.getItem(PRELOAD_RELOAD_KEY)
    } catch {
      // Without reload-persistent storage there is no safe way to distinguish
      // a fresh recovery from a reload loop. Leave the event unprevented so the
      // route ErrorBoundary can offer a visible manual retry.
      return
    }
    const previousReload = storedValue ? Number(storedValue) : Number.NaN
    if (Number.isFinite(previousReload) && currentTime - previousReload < RELOAD_COOLDOWN_MS) {
      // Do not swallow a repeated failure. The route ErrorBoundary remains
      // available while the cooldown protects the tab from a reload loop.
      return
    }

    try {
      storage.setItem(PRELOAD_RELOAD_KEY, String(currentTime))
    } catch {
      // Do not reload unless the cooldown survived the navigation.
      return
    }
    event.preventDefault()
    reload()
  }

  eventTarget.addEventListener('vite:preloadError', handlePreloadError)
  return () => eventTarget.removeEventListener('vite:preloadError', handlePreloadError)
}

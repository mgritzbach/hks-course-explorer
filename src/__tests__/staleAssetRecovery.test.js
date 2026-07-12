import { describe, expect, it, vi } from 'vitest'
import { installStaleAssetRecovery } from '../lib/staleAssetRecovery.js'

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

describe('stale deployment asset recovery', () => {
  it('reloads once when a Vite lazy chunk belongs to an older deployment', () => {
    const eventTarget = new EventTarget()
    const storage = memoryStorage()
    const reload = vi.fn()
    const remove = installStaleAssetRecovery({
      eventTarget,
      storage,
      reload,
      now: () => 100_000,
    })

    const firstError = new Event('vite:preloadError', { cancelable: true })
    eventTarget.dispatchEvent(firstError)
    const cooldownError = new Event('vite:preloadError', { cancelable: true })
    eventTarget.dispatchEvent(cooldownError)

    expect(firstError.defaultPrevented).toBe(true)
    expect(cooldownError.defaultPrevented).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
    remove()
  })

  it('allows recovery again after the bounded reload cooldown', () => {
    const eventTarget = new EventTarget()
    const storage = memoryStorage()
    const reload = vi.fn()
    let currentTime = 100_000
    installStaleAssetRecovery({
      eventTarget,
      storage,
      reload,
      now: () => currentTime,
    })

    eventTarget.dispatchEvent(new Event('vite:preloadError', { cancelable: true }))
    currentTime += 60_001
    eventTarget.dispatchEvent(new Event('vite:preloadError', { cancelable: true }))

    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('still reloads safely when session storage is unavailable', () => {
    const eventTarget = new EventTarget()
    const reload = vi.fn()
    const storage = {
      getItem: () => {
        throw new Error('storage disabled')
      },
      setItem: () => {
        throw new Error('storage disabled')
      },
    }
    installStaleAssetRecovery({ eventTarget, storage, reload, now: () => 100_000 })

    const firstError = new Event('vite:preloadError', { cancelable: true })
    const cooldownError = new Event('vite:preloadError', { cancelable: true })
    eventTarget.dispatchEvent(firstError)
    eventTarget.dispatchEvent(cooldownError)

    expect(firstError.defaultPrevented).toBe(true)
    expect(cooldownError.defaultPrevented).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

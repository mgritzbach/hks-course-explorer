import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OnboardingTour from '../components/OnboardingTour.jsx'

const STEPS = [
  { target: 'available-target', title: 'Available step', body: 'This target is visible.' },
  { target: 'missing-target', title: 'Missing step', body: 'This target is intentionally absent.' },
]

describe('OnboardingTour', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
  })

  afterEach(() => {
    vi.useRealTimers()
    window.localStorage.clear()
  })

  it('reports its visible step, skips an absent follow-up, and calls the latest completion callback once', async () => {
    const initialDone = vi.fn()
    const latestDone = vi.fn()
    const onStepChange = vi.fn()
    const view = render(
      <>
        <button data-tour="available-target">Target</button>
        <OnboardingTour
          steps={STEPS}
          storageKey="test-tour"
          autoStart
          onDone={initialDone}
          onStepChange={onStepChange}
        />
      </>,
    )

    const target = screen.getByRole('button', { name: 'Target' })
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      bottom: 40,
      height: 24,
      left: 20,
      right: 120,
      top: 16,
      width: 100,
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    expect(screen.getByRole('dialog').textContent).toContain('Available step')
    expect(onStepChange).toHaveBeenCalledWith(0)

    // Inline parent callbacks are common. The tour must use the newest one
    // without restarting its control flow when the parent rerenders.
    view.rerender(
      <>
        <button data-tour="available-target">Target</button>
        <OnboardingTour
          steps={STEPS}
          storageKey="test-tour"
          autoStart
          onDone={latestDone}
          onStepChange={onStepChange}
        />
      </>,
    )
    const rerenderedTarget = screen.getByRole('button', { name: 'Target' })
    vi.spyOn(rerenderedTarget, 'getBoundingClientRect').mockReturnValue({
      bottom: 40,
      height: 24,
      left: 20,
      right: 120,
      top: 16,
      width: 100,
    })

    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    // First let the missing step's desktop measurement tick run, then allow
    // the asynchronous dismissal transition to complete.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(window.localStorage.getItem('test-tour')).toBe('1')
    expect(initialDone).not.toHaveBeenCalled()
    expect(latestDone).toHaveBeenCalledTimes(1)
    expect(onStepChange).toHaveBeenCalledWith(1)
  })

  it('contains modal focus, closes on Escape, and restores the invoking control', async () => {
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.appendChild(appRoot)
    const view = render(
      <>
        <button data-tour="available-target">Replay tour</button>
        <OnboardingTour steps={[STEPS[0]]} storageKey="focus-tour" autoStart />
      </>,
      { container: appRoot },
    )

    const replay = screen.getByRole('button', { name: 'Replay tour' })
    vi.spyOn(replay, 'getBoundingClientRect').mockReturnValue({
      bottom: 40,
      height: 24,
      left: 20,
      right: 120,
      top: 16,
      width: 100,
    })
    replay.focus()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    const dialog = screen.getByRole('dialog')
    const close = screen.getByRole('button', { name: 'Close tour' })
    const done = screen.getByRole('button', { name: /done/i })
    expect(document.activeElement).toBe(dialog)
    expect(appRoot.inert).toBe(true)
    expect(appRoot.getAttribute('aria-hidden')).toBe('true')

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(done)
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(close)

    fireEvent.keyDown(dialog, { key: 'Escape' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(Boolean(appRoot.inert)).toBe(false)
    expect(appRoot.hasAttribute('aria-hidden')).toBe(false)
    expect(document.activeElement).toBe(replay)

    view.unmount()
    appRoot.remove()
  })
})

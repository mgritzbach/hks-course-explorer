import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SupportProjectPrompt, {
  SUPPORT_PROMPT_COOLDOWN_MS,
  SUPPORT_PROMPT_DELAY_MS,
  SUPPORT_PROMPT_STORAGE_KEY,
  VENMO_PROFILE_URL,
} from '../components/SupportProjectPrompt.jsx'

describe('SupportProjectPrompt', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    window.localStorage.clear()
  })

  it('always offers a compact, transparent Venmo support link', () => {
    render(<SupportProjectPrompt />)

    const link = screen.getByRole('link', { name: /buy a coffee/i })
    expect(link.getAttribute('href')).toBe(VENMO_PROFILE_URL)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(screen.getByText(/keep this independent student tool free/i)).toBeTruthy()
  })

  it('shows a dismissible, non-modal prompt after respectful delay', () => {
    render(<SupportProjectPrompt />)

    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => vi.advanceTimersByTime(SUPPORT_PROMPT_DELAY_MS))

    const dialog = screen.getByRole('dialog', { name: /did this save you some time/i })
    expect(dialog.getAttribute('aria-modal')).toBe('false')
    expect(screen.getByText(/build and maintain hks course explorer unpaid/i)).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(Number(window.localStorage.getItem(SUPPORT_PROMPT_STORAGE_KEY))).toBeGreaterThan(0)
  })

  it('does not nag visitors again during the 30-day cooldown', () => {
    window.localStorage.setItem(
      SUPPORT_PROMPT_STORAGE_KEY,
      String(Date.now() - SUPPORT_PROMPT_COOLDOWN_MS + 1_000),
    )

    render(<SupportProjectPrompt />)
    act(() => vi.advanceTimersByTime(SUPPORT_PROMPT_DELAY_MS + 10_000))

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('waits until a true modal is gone before showing', () => {
    const modal = document.createElement('div')
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')
    document.body.appendChild(modal)

    render(<SupportProjectPrompt />)
    act(() => vi.advanceTimersByTime(SUPPORT_PROMPT_DELAY_MS))
    expect(screen.queryByRole('dialog', { name: /did this save you some time/i })).toBeNull()

    modal.remove()
    act(() => vi.advanceTimersByTime(5_000))
    expect(screen.getByRole('dialog', { name: /did this save you some time/i })).toBeTruthy()
  })
})

import { describe, expect, it } from 'vitest'
import {
  DESKTOP_NAV_ITEMS,
  MOBILE_MORE_NAV_ITEMS,
  MOBILE_PRIMARY_NAV_ITEMS,
  VISITOR_NAV_ITEMS,
} from '../lib/visitorNavigation.js'

describe('visitor navigation contract', () => {
  it('keeps every visitor destination uniquely identified and labelled', () => {
    expect(VISITOR_NAV_ITEMS.map((item) => item.to)).toEqual([
      '/',
      '/courses',
      '/faculty',
      '/compare',
      '/schedule-builder',
      '/requirements',
      '/resources',
    ])
    expect(new Set(VISITOR_NAV_ITEMS.map((item) => item.to)).size).toBe(VISITOR_NAV_ITEMS.length)
    expect(VISITOR_NAV_ITEMS.every((item) => item.label && item.mobileLabel && item.icon)).toBe(
      true,
    )
  })

  it('keeps the high-value planning destinations directly reachable on mobile', () => {
    expect(MOBILE_PRIMARY_NAV_ITEMS.map((item) => item.to)).toEqual([
      '/',
      '/courses',
      '/schedule-builder',
      '/requirements',
    ])
    expect(MOBILE_MORE_NAV_ITEMS.map((item) => item.to)).toEqual([
      '/faculty',
      '/compare',
      '/resources',
    ])
  })

  it('keeps Resources mobile-only while retaining every other visitor item on desktop', () => {
    expect(DESKTOP_NAV_ITEMS.map((item) => item.to)).toEqual([
      '/',
      '/courses',
      '/faculty',
      '/compare',
      '/schedule-builder',
      '/requirements',
    ])
    expect(DESKTOP_NAV_ITEMS).not.toContainEqual(expect.objectContaining({ to: '/resources' }))
  })
})

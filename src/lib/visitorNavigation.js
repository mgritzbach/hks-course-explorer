// Visitor-facing navigation is deliberately separate from route element
// definitions. It is safe to share with UI tests and gives each viewport a
// single, reviewable set of reachable destinations.

export const VISITOR_NAV_ITEMS = Object.freeze([
  Object.freeze({
    to: '/',
    label: 'Home',
    mobileLabel: 'Home',
    icon: '⌂',
    end: true,
    desktop: true,
    mobile: 'primary',
  }),
  Object.freeze({
    to: '/courses',
    label: 'Courses',
    mobileLabel: 'Courses',
    icon: '📖',
    desktop: true,
    mobile: 'primary',
  }),
  Object.freeze({
    to: '/faculty',
    label: 'Faculty',
    mobileLabel: 'Faculty',
    icon: '👤',
    desktop: true,
    mobile: 'more',
  }),
  Object.freeze({
    to: '/compare',
    label: 'Compare',
    mobileLabel: 'Compare',
    icon: '⚖',
    desktop: true,
    mobile: 'more',
  }),
  Object.freeze({
    to: '/schedule-builder',
    label: 'Schedule Builder',
    mobileLabel: 'Schedule',
    icon: '🗓',
    desktop: true,
    mobile: 'primary',
  }),
  Object.freeze({
    to: '/requirements',
    label: 'My Degree',
    mobileLabel: 'Degree',
    icon: '✅',
    desktop: true,
    mobile: 'primary',
  }),
  Object.freeze({
    to: '/resources',
    label: 'Resources',
    mobileLabel: 'Resources',
    icon: '🔗',
    desktop: false,
    mobile: 'more',
  }),
])

export const DESKTOP_NAV_ITEMS = Object.freeze(VISITOR_NAV_ITEMS.filter((item) => item.desktop))
export const MOBILE_PRIMARY_NAV_ITEMS = Object.freeze(
  VISITOR_NAV_ITEMS.filter((item) => item.mobile === 'primary'),
)
export const MOBILE_MORE_NAV_ITEMS = Object.freeze(
  VISITOR_NAV_ITEMS.filter((item) => item.mobile === 'more'),
)

/** @returns {never} */
function contractError(message) {
  throw new Error(`Visitor navigation contract: ${message}`)
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function requireNavigationItem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    contractError('each item must be an object')
  return /** @type {Record<string, unknown>} */ (value)
}

/**
 * Validate visitor-navigation metadata before it is used to render desktop or
 * mobile links. Admin-only routes deliberately do not belong to this list.
 * @param {unknown} items Candidate visitor-navigation items.
 * @returns {true} True when every route is uniquely and completely described.
 * @throws {Error} When a route, label, viewport flag, or mobile placement is invalid.
 */
export function assertVisitorNavigationContract(items = VISITOR_NAV_ITEMS) {
  if (!Array.isArray(items) || items.length === 0) contractError('items must be a non-empty array')
  const routes = new Set()
  for (const item of items) {
    const candidate = requireNavigationItem(item)
    const { to, label, mobileLabel, icon, desktop, mobile } = candidate
    if (typeof to !== 'string' || !to.startsWith('/'))
      contractError('each item must have an absolute route')
    if (routes.has(to)) contractError(`route "${to}" must be unique`)
    routes.add(to)
    if (
      typeof label !== 'string' ||
      !label ||
      typeof mobileLabel !== 'string' ||
      !mobileLabel ||
      typeof icon !== 'string' ||
      !icon
    ) {
      contractError(`route "${to}" must have label, mobileLabel, and icon`)
    }
    if (typeof desktop !== 'boolean') contractError(`route "${to}" must declare desktop visibility`)
    if (mobile !== 'primary' && mobile !== 'more')
      contractError(`route "${to}" must use mobile placement primary or more`)
  }
  return true
}

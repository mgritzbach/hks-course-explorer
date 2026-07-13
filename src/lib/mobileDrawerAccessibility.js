/**
 * Keeps a translated-offscreen drawer mounted for its closing animation while
 * removing its controls from keyboard navigation and the accessibility tree.
 */
export function closedMobileDrawerAttributes(isOpen) {
  return isOpen ? {} : { 'aria-hidden': true, inert: '' }
}

/** Welcome-entry tutorials restore main focus; explicit replays restore the drawer trigger. */
export function shouldRestoreReplayDrawer(isReplay, restoreFocusToMain = false) {
  return isReplay && !restoreFocusToMain
}

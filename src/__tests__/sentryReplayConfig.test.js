import { describe, expect, it } from 'vitest'
import { SENTRY_REPLAY_OPTIONS } from '../lib/sentryReplayConfig.js'

describe('Sentry replay privacy configuration', () => {
  it('masks text and blocks media in all session replays', () => {
    expect(SENTRY_REPLAY_OPTIONS).toEqual({
      maskAllText: true,
      blockAllMedia: true,
    })
  })
})
